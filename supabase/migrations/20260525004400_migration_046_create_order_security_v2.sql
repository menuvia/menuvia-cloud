-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 046 v2 — create_order: SECURITY HARDENING (FIXED)
-- ═══════════════════════════════════════════════════════════════
-- Fixes față de v1:
--   - FIX short_id: era SELECT din coloană inexistentă. Acum
--     reconstruim short_id din uuid în memorie (consistent cu
--     migration-006 și migration-025 vechi).
--   - FIX pickup enum: orders.source e ENUM order_source. Vechea
--     migration-025 a adăugat CHECK constraint dar NU a extins
--     enum-ul. Acum adăugăm 'pickup' la enum în mod idempotent
--     PRIMA. Fără asta, p_source::order_source cu 'pickup' eșuează.
--
-- Restul comportamentului identic cu v1: validări stricte pe QR,
-- waiter, pickup, modifier_options, extras, quantity, notes.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 0) FIX BUG MOȘTENIT: extinde enum order_source cu 'pickup'
-- ───────────────────────────────────────────────────────────────
-- Migration-025 a presupus că poți pune CHECK constraint cu 'pickup'
-- pe o coloană enum care nu îl conține. NU.
-- PostgreSQL acceptă ALTER TYPE ... ADD VALUE doar IF NOT EXISTS
-- de la PG 12+, ceea ce Supabase folosește.

do $$
begin
  -- Adaugă 'pickup' dacă nu există deja în enum
  if not exists (
    select 1 from pg_enum
     where enumlabel = 'pickup'
       and enumtypid = (
         select oid from pg_type where typname = 'order_source'
       )
  ) then
    alter type public.order_source add value 'pickup';
  end if;
end$$;


-- ───────────────────────────────────────────────────────────────
-- 1) Rate limit helper pentru pickup (pe customer_phone)
-- ───────────────────────────────────────────────────────────────
create or replace function public.check_pickup_order_rate_limit(
  p_restaurant_id uuid,
  p_customer_phone text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_customer_phone is null or length(trim(p_customer_phone)) = 0 then
    return;
  end if;

  if (
    select count(*)
      from public.orders
     where restaurant_id = p_restaurant_id
       and source = 'pickup'
       and customer_phone = trim(p_customer_phone)
       and created_at > now() - interval '30 minutes'
       and status not in ('cancelled')
  ) >= 3 then
    raise exception 'Prea multe comenzi de la acest număr în ultimele 30 minute. Te rugăm reîncearcă mai târziu.'
      using errcode = 'P0001', hint = 'pickup_rate_limit';
  end if;
end;
$$;

revoke all on function public.check_pickup_order_rate_limit(uuid, text) from public;
grant execute on function public.check_pickup_order_rate_limit(uuid, text) to anon, authenticated;


-- ───────────────────────────────────────────────────────────────
-- 2) Phone validation helper
-- ───────────────────────────────────────────────────────────────
create or replace function public.is_valid_phone(p_phone text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  if p_phone is null then return false; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  return length(v_digits) between 7 and 15;
end;
$$;


-- ───────────────────────────────────────────────────────────────
-- 3) REWRITE create_order cu validări stricte (FIX short_id)
-- ───────────────────────────────────────────────────────────────
create or replace function public.create_order(
  p_restaurant_id   uuid,
  p_source          text,
  p_table_id        uuid,
  p_qr_token_id     uuid,
  p_notes           text,
  p_items           jsonb,
  p_idempotency_key uuid default null,
  p_pickup_time     timestamptz default null,
  p_customer_name   text default null,
  p_customer_phone  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id       uuid;
  v_existing_id    uuid;
  v_existing_total numeric;
  v_existing_status text;
  v_existing_created timestamptz;
  v_short_id       text;
  v_total          numeric := 0;
  v_item           jsonb;
  v_product        record;
  v_extras_total   numeric;
  v_extras_json    jsonb;
  v_options_total  numeric;
  v_options_json   jsonb;
  v_options_count_expected int;
  v_options_count_found    int;
  v_unit_price     numeric;
  v_item_qty       smallint;
  v_item_total     numeric;
  v_item_notes     text;
  v_upsell_source  text;
  v_item_count     int;
  v_qr_token       record;
  v_effective_table_id uuid;
  v_pickup_settings jsonb;
  v_pickup_enabled  boolean;
  v_min_lead_min    int;
  v_user_id         uuid;
  v_created_by      uuid;
  v_clean_notes     text;
begin
  -- ═══════════════════════════════════════════════════════════════
  -- IDEMPOTENCY CHECK
  -- FIX v2: nu mai selectăm short_id (coloană inexistentă),
  -- îl reconstruim din id în return statement.
  -- ═══════════════════════════════════════════════════════════════
  if p_idempotency_key is not null then
    select id, total, status, created_at
      into v_existing_id, v_existing_total, v_existing_status, v_existing_created
      from public.orders
     where restaurant_id = p_restaurant_id
       and idempotency_key = p_idempotency_key
     limit 1;

    if v_existing_id is not null then
      return jsonb_build_object(
        'id',         v_existing_id,
        'short_id',   upper(right(v_existing_id::text, 6)),
        'status',     v_existing_status,
        'total',      v_existing_total,
        'created_at', v_existing_created
      );
    end if;
  end if;

  -- ═══════════════════════════════════════════════════════════════
  -- SOURCE VALIDATION
  -- ═══════════════════════════════════════════════════════════════
  if p_source not in ('qr', 'waiter', 'pickup') then
    raise exception 'Invalid source: %', p_source
      using errcode = 'P0001', hint = 'invalid_source';
  end if;

  -- ═══════════════════════════════════════════════════════════════
  -- ITEMS BASIC VALIDATION
  -- ═══════════════════════════════════════════════════════════════
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must have at least one item'
      using errcode = 'P0001', hint = 'no_items';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count > 30 then
    raise exception 'Order has too many lines: % (max 30)', v_item_count
      using errcode = 'P0001', hint = 'too_many_items';
  end if;

  -- ═══════════════════════════════════════════════════════════════
  -- SOURCE-SPECIFIC VALIDATIONS
  -- ═══════════════════════════════════════════════════════════════

  if p_source = 'qr' then
    if p_qr_token_id is null then
      raise exception 'QR orders require p_qr_token_id'
        using errcode = 'P0001', hint = 'missing_qr_token';
    end if;

    select id, restaurant_id, table_id, is_active, expires_at
      into v_qr_token
      from public.qr_tokens
     where id = p_qr_token_id
     limit 1;

    if v_qr_token.id is null then
      raise exception 'QR token unknown'
        using errcode = 'P0001', hint = 'qr_token_not_found';
    end if;

    if v_qr_token.restaurant_id <> p_restaurant_id then
      raise exception 'QR token belongs to another restaurant'
        using errcode = 'P0001', hint = 'qr_token_wrong_restaurant';
    end if;

    if not v_qr_token.is_active then
      raise exception 'QR token is deactivated'
        using errcode = 'P0001', hint = 'qr_token_inactive';
    end if;

    if v_qr_token.expires_at is not null and v_qr_token.expires_at < now() then
      raise exception 'QR token expired'
        using errcode = 'P0001', hint = 'qr_token_expired';
    end if;

    v_effective_table_id := v_qr_token.table_id;
    v_created_by := null;
    v_clean_notes := p_notes;

    perform public.check_qr_order_rate_limit(p_qr_token_id);

  elsif p_source = 'waiter' then
    v_user_id := auth.uid();
    if v_user_id is null then
      raise exception 'Waiter orders require authentication'
        using errcode = 'P0001', hint = 'no_auth';
    end if;

    if not public.is_member(p_restaurant_id) then
      raise exception 'User is not a member of this restaurant'
        using errcode = 'P0001', hint = 'not_a_member';
    end if;

    if p_table_id is not null then
      if not exists (
        select 1 from public.tables
         where id = p_table_id
           and restaurant_id = p_restaurant_id
      ) then
        raise exception 'Table does not belong to this restaurant'
          using errcode = 'P0001', hint = 'table_wrong_restaurant';
      end if;
    end if;

    v_effective_table_id := p_table_id;
    v_created_by := v_user_id;
    v_clean_notes := p_notes;

  elsif p_source = 'pickup' then
    if p_table_id is not null then
      raise exception 'Pickup orders cannot have table_id'
        using errcode = 'P0001', hint = 'pickup_no_table';
    end if;
    if p_qr_token_id is not null then
      raise exception 'Pickup orders cannot have qr_token_id'
        using errcode = 'P0001', hint = 'pickup_no_qr';
    end if;
    if p_customer_name is null or length(trim(p_customer_name)) = 0 then
      raise exception 'Pickup orders require customer_name'
        using errcode = 'P0001', hint = 'missing_customer_name';
    end if;
    if not public.is_valid_phone(p_customer_phone) then
      raise exception 'Pickup orders require valid customer_phone (7-15 digits)'
        using errcode = 'P0001', hint = 'invalid_customer_phone';
    end if;
    if p_pickup_time is null then
      raise exception 'Pickup orders require pickup_time'
        using errcode = 'P0001', hint = 'missing_pickup_time';
    end if;

    select pickup_settings into v_pickup_settings
      from public.restaurants
     where id = p_restaurant_id;

    if v_pickup_settings is null then
      raise exception 'Pickup not configured for this restaurant'
        using errcode = 'P0001', hint = 'pickup_not_configured';
    end if;

    v_pickup_enabled := coalesce((v_pickup_settings ->> 'enabled')::boolean, false);
    if not v_pickup_enabled then
      raise exception 'Pickup is not enabled for this restaurant'
        using errcode = 'P0001', hint = 'pickup_disabled';
    end if;

    v_min_lead_min := coalesce((v_pickup_settings ->> 'min_lead_time_minutes')::int, 20);

    if p_pickup_time < now() + make_interval(mins => v_min_lead_min) then
      raise exception 'Pickup time too soon. Minimum lead time: % minutes', v_min_lead_min
        using errcode = 'P0001', hint = 'pickup_time_too_soon';
    end if;

    if p_pickup_time > now() + interval '24 hours' then
      raise exception 'Pickup time too far in future (max 24h)'
        using errcode = 'P0001', hint = 'pickup_time_too_far';
    end if;

    perform public.check_pickup_order_rate_limit(p_restaurant_id, p_customer_phone);

    v_effective_table_id := null;
    v_created_by := null;
    v_clean_notes := p_notes;
  end if;

  -- ═══════════════════════════════════════════════════════════════
  -- NOTES SANITIZATION
  -- ═══════════════════════════════════════════════════════════════
  if v_clean_notes is not null then
    v_clean_notes := substring(trim(v_clean_notes), 1, 500);
    if length(v_clean_notes) = 0 then
      v_clean_notes := null;
    end if;
  end if;

  -- ═══════════════════════════════════════════════════════════════
  -- CREATE ORDER SKELETON
  -- ═══════════════════════════════════════════════════════════════
  insert into public.orders (
    restaurant_id, table_id, qr_token_id, source, status,
    notes, total, idempotency_key,
    pickup_time, customer_name, customer_phone,
    created_by
  ) values (
    p_restaurant_id, v_effective_table_id, p_qr_token_id, p_source::public.order_source, 'new',
    v_clean_notes, 0, p_idempotency_key,
    p_pickup_time,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    v_created_by
  ) returning id into v_order_id;

  -- ═══════════════════════════════════════════════════════════════
  -- PROCESS ITEMS
  -- ═══════════════════════════════════════════════════════════════
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select id, name, price, is_active, is_draft, is_sold_out, restaurant_id
      into v_product
      from public.products
     where id = (v_item ->> 'product_id')::uuid;

    if v_product is null then
      raise exception 'Product not found: %', v_item ->> 'product_id'
        using errcode = 'P0001', hint = 'product_not_found';
    end if;

    if v_product.restaurant_id <> p_restaurant_id then
      raise exception 'Product does not belong to this restaurant: %', v_product.name
        using errcode = 'P0001', hint = 'product_wrong_restaurant';
    end if;

    if not v_product.is_active or v_product.is_draft or v_product.is_sold_out then
      raise exception 'Product not available: %', v_product.name
        using errcode = 'P0001', hint = 'product_unavailable';
    end if;

    v_item_qty := greatest(1, least(20, coalesce((v_item ->> 'quantity')::smallint, 1)));

    v_item_notes := v_item ->> 'notes';
    if v_item_notes is not null then
      v_item_notes := substring(trim(v_item_notes), 1, 300);
      if length(v_item_notes) = 0 then v_item_notes := null; end if;
    end if;

    -- ─── MODIFIER OPTIONS — JOIN OBLIGATORIU cu product_modifier_groups ───
    v_options_total := 0;
    v_options_json := '[]'::jsonb;
    v_options_count_expected := 0;
    v_options_count_found := 0;

    if v_item ? 'option_ids' and jsonb_array_length(v_item -> 'option_ids') > 0 then
      v_options_count_expected := jsonb_array_length(v_item -> 'option_ids');

      select
        coalesce(sum(mo.price_delta), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'group_id', mg.id, 'group_name', mg.name,
          'option_id', mo.id, 'option_name', mo.name,
          'price_delta', mo.price_delta
        )), '[]'::jsonb),
        count(distinct mo.id)
        into v_options_total, v_options_json, v_options_count_found
      from public.modifier_options mo
      join public.modifier_groups mg
        on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg
        on pmg.modifier_group_id = mg.id
       and pmg.product_id = v_product.id
      where mo.id::text in (
        select x from jsonb_array_elements_text(v_item -> 'option_ids') as x
      )
        and mo.is_available = true
        and mg.restaurant_id = p_restaurant_id;

      if v_options_count_found <> v_options_count_expected then
        raise exception 'Invalid modifier options for product %: % sent, % valid',
          v_product.name, v_options_count_expected, v_options_count_found
          using errcode = 'P0001', hint = 'invalid_modifier_options';
      end if;
    end if;

    -- ─── EXTRAS ───
    v_extras_total := 0;
    v_extras_json := '[]'::jsonb;

    if v_item ? 'extra_ids' and jsonb_array_length(v_item -> 'extra_ids') > 0 then
      select
        coalesce(sum(pe.price), 0),
        coalesce(jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name, 'price', pe.price)), '[]'::jsonb)
        into v_extras_total, v_extras_json
      from public.product_extras pe
      where pe.id::text in (
        select x from jsonb_array_elements_text(v_item -> 'extra_ids') as x
      )
        and pe.product_id = v_product.id
        and pe.is_available = true;
    end if;

    -- ─── upsell_source whitelist ───
    v_upsell_source := v_item ->> 'upsell_source';
    if v_upsell_source is not null
       and v_upsell_source not in ('extra', 'pairing', 'checkout_suggestion')
    then
      v_upsell_source := null;
    end if;

    -- ─── PRICE: DIN DB ───
    v_unit_price := v_product.price;
    v_item_total := (v_unit_price + v_options_total + v_extras_total) * v_item_qty;

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, notes,
      extras_added, upsell_source
    )
    values (
      v_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_item_notes,
      v_extras_json, v_upsell_source
    );

    v_total := v_total + v_item_total;
  end loop;

  update public.orders set total = v_total where id = v_order_id;

  v_short_id := upper(right(v_order_id::text, 6));

  return jsonb_build_object(
    'id',         v_order_id,
    'short_id',   v_short_id,
    'status',     'new',
    'total',      v_total,
    'created_at', now()
  );
end;
$$;
grant execute on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text) to anon, authenticated;
