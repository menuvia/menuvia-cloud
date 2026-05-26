-- =============================================================
-- Menuvia — Migration 012
-- Production hardening: server-authoritative create_order,
-- invite preview RPC, idempotency, rate limiting.
--
-- Run AFTER migration-011.
-- This migration REPLACES the create_order from migration-006.
-- =============================================================


-- =============================================================
-- 0. Schema additions
-- =============================================================

-- Idempotency key on orders
alter table public.orders
  add column if not exists idempotency_key uuid;

create unique index if not exists orders_idempotency_uq
  on public.orders (restaurant_id, idempotency_key)
  where idempotency_key is not null;

-- DB constraints (safety net)
do $$ begin
  alter table public.products    add constraint products_price_nonneg     check (price >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders      add constraint orders_total_nonneg       check (total >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.order_items add constraint oi_quantity_range         check (quantity between 1 and 99);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.order_items add constraint oi_unit_price_nonneg      check (unit_price_snapshot >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.order_items add constraint oi_item_total_nonneg      check (item_total >= 0);
exception when duplicate_object then null; end $$;


-- =============================================================
-- 1. Rate limit helper for QR orders
-- =============================================================

create or replace function public.check_qr_order_rate_limit(p_qr_token_id uuid)
returns void language plpgsql security definer as $$
begin
  if p_qr_token_id is null then return; end if;
  if (
    select count(*) from public.orders
    where qr_token_id = p_qr_token_id
      and created_at > now() - interval '2 minutes'
      and status not in ('cancelled', 'paid')
  ) >= 3 then
    raise exception 'Prea multe comenzi în ultimele 2 minute de la această masă.';
  end if;
end;
$$;


-- =============================================================
-- 2. create_order — COMPLETE REWRITE
--
-- Client sends ONLY:
--   product_id, quantity, option_ids (uuid[]), notes
-- Server looks up ALL prices, names, modifiers from DB.
-- Server validates ALL relationships and constraints.
--
-- Replaces the old create_order from migration-006.
-- =============================================================

-- Drop old signatures (may have varying arg lists from previous migrations)
drop function if exists public.create_order(uuid, text, uuid, uuid, uuid, text, jsonb);
drop function if exists public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid);

create or replace function public.create_order(
  p_restaurant_id    uuid,
  p_source           text,          -- 'qr' or 'waiter'
  p_table_id         uuid,          -- for waiter: optional table. for qr: ignored (derived from token)
  p_qr_token_id      uuid,          -- required for source='qr'
  p_notes            text,          -- order-level notes
  p_items            jsonb,         -- [{product_id, quantity, option_ids:[uuid], notes}]
  p_idempotency_key  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order_id      uuid;
  v_created_at    timestamptz;
  v_total         numeric(10,2) := 0;
  v_short_id      text;
  v_item          jsonb;
  v_product       record;
  v_qr            public.qr_tokens%rowtype;
  v_option_ids    uuid[];
  v_valid_count   integer;
  v_unit_price    numeric(10,2);
  v_options_delta numeric(10,2);
  v_options_json  jsonb;
  v_item_total    numeric(10,2);
  v_item_qty      integer;
  v_item_notes    text;
  v_existing_id   uuid;
begin

  -- ============================================================
  -- IDEMPOTENCY: if key was already used, return existing order
  -- ============================================================
  if p_idempotency_key is not null then
    select id into v_existing_id
    from public.orders
    where restaurant_id = p_restaurant_id
      and idempotency_key = p_idempotency_key;

    if v_existing_id is not null then
      return (
        select jsonb_build_object(
          'id',         o.id,
          'short_id',   upper(right(o.id::text, 6)),
          'status',     o.status,
          'total',      o.total,
          'created_at', o.created_at,
          'idempotent_replay', true
        )
        from public.orders o
        where o.id = v_existing_id
      );
    end if;
  end if;

  -- ============================================================
  -- SOURCE VALIDATION
  -- ============================================================
  if p_source = 'qr' then
    -- QR token required
    if p_qr_token_id is null then
      raise exception 'create_order: p_qr_token_id required for source=qr';
    end if;

    -- Fetch and validate QR token
    select * into v_qr from public.qr_tokens where id = p_qr_token_id;
    if not found then
      raise exception 'create_order: qr_token not found';
    end if;
    if v_qr.restaurant_id <> p_restaurant_id then
      raise exception 'create_order: qr_token does not belong to this restaurant';
    end if;
    if not v_qr.is_active or (v_qr.expires_at is not null and v_qr.expires_at <= now()) then
      raise exception 'create_order: qr_token is inactive or expired';
    end if;

    -- FORCE table_id from the QR token — never trust client
    p_table_id := v_qr.table_id;

    -- Rate limit
    perform public.check_qr_order_rate_limit(p_qr_token_id);

  elsif p_source = 'waiter' then
    -- Waiter MUST be authenticated
    if v_caller_uid is null then
      raise exception 'create_order: authentication required for source=waiter';
    end if;

    -- Waiter MUST be a member of this restaurant
    if not exists (
      select 1 from public.restaurant_memberships
      where restaurant_id = p_restaurant_id
        and user_id = v_caller_uid
    ) then
      raise exception 'create_order: caller is not a member of this restaurant';
    end if;

    -- If table_id provided, it must belong to this restaurant
    if p_table_id is not null then
      if not exists (
        select 1 from public.tables
        where id = p_table_id and restaurant_id = p_restaurant_id
      ) then
        raise exception 'create_order: table does not belong to this restaurant';
      end if;
    end if;

  else
    raise exception 'create_order: p_source must be qr or waiter, got: %', p_source;
  end if;

  -- ============================================================
  -- ITEMS VALIDATION
  -- ============================================================
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order: at least one item required';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'create_order: too many items (max 50)';
  end if;

  -- ============================================================
  -- INSERT ORDER SHELL (total=0, updated after items)
  -- ============================================================
  insert into public.orders (
    restaurant_id, source, table_id, qr_token_id,
    created_by, notes, status, total, idempotency_key
  )
  values (
    p_restaurant_id,
    p_source::public.order_source,
    p_table_id,
    p_qr_token_id,
    case when p_source = 'waiter' then v_caller_uid else null end,
    nullif(trim(coalesce(p_notes, '')), ''),
    'new',
    0,
    p_idempotency_key
  )
  returning id, created_at
  into v_order_id, v_created_at;

  -- ============================================================
  -- PROCESS EACH ITEM — all lookups from DB, zero client trust
  -- ============================================================
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- Quantity
    v_item_qty := (v_item ->> 'quantity')::integer;
    if v_item_qty is null or v_item_qty < 1 or v_item_qty > 99 then
      raise exception 'create_order: invalid quantity (1-99)';
    end if;

    -- Product lookup — must exist, belong to restaurant, be active
    select id, restaurant_id, name, price, is_active
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'create_order: product % not found', v_item ->> 'product_id';
    end if;
    if v_product.restaurant_id <> p_restaurant_id then
      raise exception 'create_order: product does not belong to this restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'create_order: product "%" is inactive', v_product.name;
    end if;

    v_unit_price := v_product.price;

    -- Options lookup
    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );

    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;

    if array_length(v_option_ids, 1) > 0 then
      -- Every option must: exist, be available, belong to a group
      -- that is linked to THIS product via product_modifier_groups,
      -- and the group must belong to THIS restaurant.
      select count(*) into v_valid_count
      from public.modifier_options mo
      join public.modifier_groups mg
        on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg
        on pmg.modifier_group_id = mg.id
      where mo.id = any(v_option_ids)
        and mo.is_available = true
        and pmg.product_id = v_product.id
        and mg.restaurant_id = p_restaurant_id;

      if v_valid_count <> array_length(v_option_ids, 1) then
        raise exception 'create_order: invalid options for product "%"', v_product.name;
      end if;

      -- Build snapshot from DB — server-authoritative names and prices
      select
        coalesce(sum(mo.price_delta), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'group_id',    mg.id,
          'group_name',  mg.name,
          'option_id',   mo.id,
          'option_name', mo.name,
          'price_delta', mo.price_delta
        )), '[]'::jsonb)
      into v_options_delta, v_options_json
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      where mo.id = any(v_option_ids);
    end if;

    -- Calculate item total server-side
    v_item_total := (v_unit_price + v_options_delta) * v_item_qty;

    -- Item notes
    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    -- Insert item with server-authoritative data
    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, notes
    )
    values (
      v_order_id,
      v_product.id,
      v_product.name,       -- FROM DB
      v_unit_price,          -- FROM DB
      v_item_qty,
      v_item_total,          -- CALCULATED SERVER-SIDE
      v_options_json,        -- FROM DB
      v_item_notes
    );

    v_total := v_total + v_item_total;
  end loop;

  -- ============================================================
  -- UPDATE ORDER TOTAL
  -- ============================================================
  update public.orders
  set total = v_total
  where id = v_order_id;

  v_short_id := upper(right(v_order_id::text, 6));

  return jsonb_build_object(
    'id',         v_order_id,
    'short_id',   v_short_id,
    'status',     'new',
    'total',      v_total,
    'created_at', v_created_at,
    'idempotent_replay', false
  );
end;
$$;

-- QR orders: anon + authenticated. Waiter orders: authenticated only.
-- The RPC itself enforces auth.uid() for waiter source.
grant execute on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid)
  to anon, authenticated;


-- =============================================================
-- 3. preview_invite(p_token text)
--
-- Returns only what the invite accept page needs:
--   restaurant name, role, email, status (valid/expired/used)
-- Does NOT expose: internal IDs, invited_by, token value
-- Works for anon and authenticated callers.
-- =============================================================

create or replace function public.preview_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select
    it.email,
    it.role,
    it.expires_at,
    it.accepted_at,
    r.name as restaurant_name
  into v_invite
  from public.invite_tokens it
  join public.restaurants r on r.id = it.restaurant_id
  where it.token = p_token;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_invite.accepted_at is not null then
    return jsonb_build_object('status', 'used');
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  return jsonb_build_object(
    'status',          'valid',
    'email',           v_invite.email,
    'role',            v_invite.role,
    'restaurant_name', v_invite.restaurant_name,
    'expires_at',      v_invite.expires_at
  );
end;
$$;

grant execute on function public.preview_invite(text) to anon, authenticated;
