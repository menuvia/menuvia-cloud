-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 023 — Câmpuri produs opționale + Upsell
-- ═══════════════════════════════════════════════════════════════
-- Toate câmpurile sunt OPȚIONALE — owner-ul poate da Next fără să le completeze.
--   • prep_time_minutes: timp pregătire estimat
--   • portion_size: text liber (ex: "350g", "500ml", "2 buc.")
--   • product_extras: add-on-uri plătite (ex: "+5 lei brânză extra")
--   • product_pairings: produse sugerate după Add (ex: "merge bine cu vin")
--   • checkout_suggestions: per-restaurant settings pentru sugestie la coș

-- ── Coloane noi pe products ──────────────────────────────────

alter table public.products
  add column if not exists prep_time_minutes smallint
    check (prep_time_minutes is null or (prep_time_minutes > 0 and prep_time_minutes <= 999));

alter table public.products
  add column if not exists portion_size text
    check (portion_size is null or length(portion_size) <= 50);

comment on column public.products.prep_time_minutes is
  'Timp estimat de pregătire în minute. Afișat ca "~15 min". Opțional.';

comment on column public.products.portion_size is
  'Cantitate / porție liber text (ex: "350g", "500ml"). Opțional.';

-- ── Tabela: product_extras (add-ons plătite per produs) ──────

create table if not exists public.product_extras (
  id            uuid primary key default uuid_generate_v4(),
  product_id    uuid not null references public.products(id) on delete cascade,
  name          text not null check (length(name) > 0 and length(name) <= 100),
  price         numeric(10,2) not null check (price >= 0),
  emoji         text check (emoji is null or length(emoji) <= 10),
  display_order smallint not null default 0,
  is_available  boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_extras_product
  on public.product_extras (product_id, display_order);

alter table public.product_extras enable row level security;

-- Anon poate citi extras pentru produsele active (afișate în meniul QR)
create policy "extras: public read"
  on public.product_extras for select
  using (
    is_available = true
    and exists (
      select 1 from public.products p
      where p.id = product_extras.product_id
        and p.is_active = true
        and p.is_draft = false
    )
  );

-- Admin poate gestiona toate extras
create policy "extras: admin manage"
  on public.product_extras for all
  using (
    exists (
      select 1 from public.products p
      where p.id = product_extras.product_id
        and public.is_admin(p.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_extras.product_id
        and public.is_admin(p.restaurant_id)
    )
  );

comment on table public.product_extras is
  'Add-on-uri plătite per produs (ex: "+5 lei brânză extra"). Sunt SEPARATE de modifiers (variațiuni la produs).';

-- ── Tabela: product_pairings (sugestii după Add) ─────────────

create table if not exists public.product_pairings (
  id                uuid primary key default uuid_generate_v4(),
  product_id        uuid not null references public.products(id) on delete cascade,
  paired_product_id uuid not null references public.products(id) on delete cascade,
  display_order     smallint not null default 0,
  created_at        timestamptz not null default now(),

  check (product_id != paired_product_id),
  unique (product_id, paired_product_id)
);

create index if not exists idx_pairings_product
  on public.product_pairings (product_id, display_order);

alter table public.product_pairings enable row level security;

-- Anon poate citi pairings pentru produse active
create policy "pairings: public read"
  on public.product_pairings for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_pairings.product_id
        and p.is_active = true
        and p.is_draft = false
    )
    and exists (
      select 1 from public.products p
      where p.id = product_pairings.paired_product_id
        and p.is_active = true
        and p.is_draft = false
        and p.is_sold_out = false
    )
  );

-- Admin poate gestiona pairings
create policy "pairings: admin manage"
  on public.product_pairings for all
  using (
    exists (
      select 1 from public.products p
      where p.id = product_pairings.product_id
        and public.is_admin(p.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_pairings.product_id
        and public.is_admin(p.restaurant_id)
    )
  );

comment on table public.product_pairings is
  'Produse sugerate după ce clientul adaugă un produs în coș (popup "merge bine cu"). Maxim 3 per produs (recomandat).';

-- ── Coloana: checkout_suggestion_settings pe restaurants ─────

alter table public.restaurants
  add column if not exists checkout_suggestion_settings jsonb
  default '{
    "enabled": false,
    "categories": [],
    "max_suggestions": 2,
    "message": "🍰 Înainte să trimiți... ai vrea ceva în plus?"
  }'::jsonb;

comment on column public.restaurants.checkout_suggestion_settings is
  'Configurare sugestie la coș înainte de checkout. Owner-ul poate alege ce categorii apar (deserts, beverages, etc.)';

-- ── Tracking: order_items extras + upsell source ─────────────

alter table public.order_items
  add column if not exists upsell_source text
    check (upsell_source is null or upsell_source in ('extra', 'pairing', 'checkout_suggestion'));

alter table public.order_items
  add column if not exists extras_added jsonb not null default '[]'::jsonb;

comment on column public.order_items.upsell_source is
  'NULL = produs adăugat normal, "extra" = via add-on, "pairing" = sugerat după Add, "checkout_suggestion" = sugerat la coș';

comment on column public.order_items.extras_added is
  'JSON array cu extras adăugate la acest item: [{"name": "Brânză extra", "price": 5.00}]';

-- ═══════════════════════════════════════════════════════════════
-- Extend create_order RPC to support extras + upsell_source
-- ═══════════════════════════════════════════════════════════════
-- Server-authoritative: prețurile extras-urilor sunt verificate din DB,
-- nu trustăm clientul pentru sumele extras-urilor.
-- Backward compatible: items vechi fără 'extras' / 'upsell_source' merg ok.

create or replace function public.create_order(
  p_restaurant_id   uuid,
  p_source          text,
  p_table_id        uuid,
  p_qr_token_id     uuid,
  p_notes           text,
  p_items           jsonb,
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id  uuid;
  v_existing_order_id uuid;
  v_existing_total numeric;
  v_existing_short_id text;
  v_existing_status text;
  v_short_id  text;
  v_total     numeric := 0;
  v_item      jsonb;
  v_product   record;
  v_extra_id  text;
  v_extra_row record;
  v_extras_total numeric;
  v_extras_json jsonb;
  v_options_total numeric;
  v_options_json  jsonb;
  v_unit_price    numeric;
  v_item_qty      smallint;
  v_item_total    numeric;
  v_item_notes    text;
  v_upsell_source text;
begin
  -- Idempotency check
  if p_idempotency_key is not null then
    select id, total, short_id, status into v_existing_order_id, v_existing_total, v_existing_short_id, v_existing_status
    from public.orders
    where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_order_id is not null then
      return jsonb_build_object(
        'id',         v_existing_order_id,
        'short_id',   v_existing_short_id,
        'status',     v_existing_status,
        'total',      v_existing_total,
        'created_at', (select created_at from public.orders where id = v_existing_order_id)
      );
    end if;
  end if;

  -- Validate source
  if p_source not in ('qr', 'waiter') then
    raise exception 'Invalid source: %', p_source;
  end if;

  -- Rate limit for QR orders
  perform public.check_qr_order_rate_limit(p_qr_token_id);

  -- Validate items array
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must have at least one item';
  end if;

  -- Create order skeleton (total=0, will update at end)
  insert into public.orders (
    restaurant_id, table_id, source, status, notes,
    total, idempotency_key
  ) values (
    p_restaurant_id, p_table_id, p_source, 'new', p_notes,
    0, p_idempotency_key
  ) returning id into v_order_id;

  -- Process each item
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- Validate product
    select id, name, price, is_active, is_draft, is_sold_out, restaurant_id
      into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if v_product is null then
      raise exception 'Product not found: %', v_item ->> 'product_id';
    end if;
    if v_product.restaurant_id != p_restaurant_id then
      raise exception 'Product does not belong to this restaurant';
    end if;
    if not v_product.is_active or v_product.is_draft or v_product.is_sold_out then
      raise exception 'Product not available: %', v_product.name;
    end if;

    v_item_qty := greatest(1, least(99, coalesce((v_item ->> 'quantity')::smallint, 1)));
    v_item_notes := v_item ->> 'notes';

    -- Process modifier options (server-authoritative pricing)
    v_options_total := 0;
    v_options_json := '[]'::jsonb;

    if v_item ? 'option_ids' and jsonb_array_length(v_item -> 'option_ids') > 0 then
      select coalesce(sum(mo.price_delta), 0),
             coalesce(jsonb_agg(jsonb_build_object(
               'group_id', mg.id,
               'group_name', mg.name,
               'option_id', mo.id,
               'option_name', mo.name,
               'price_delta', mo.price_delta
             )), '[]'::jsonb)
        into v_options_total, v_options_json
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      where mo.id::text in (
        select x from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
      ) and mo.is_available = true;
    end if;

    -- Process extras (server-authoritative pricing — NOU)
    v_extras_total := 0;
    v_extras_json := '[]'::jsonb;

    if v_item ? 'extra_ids' and jsonb_array_length(v_item -> 'extra_ids') > 0 then
      select coalesce(sum(pe.price), 0),
             coalesce(jsonb_agg(jsonb_build_object(
               'id', pe.id,
               'name', pe.name,
               'price', pe.price
             )), '[]'::jsonb)
        into v_extras_total, v_extras_json
      from public.product_extras pe
      where pe.id::text in (
        select x from jsonb_array_elements_text(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) as x
      )
        and pe.product_id = v_product.id  -- doar extras pentru ACEST produs
        and pe.is_available = true;
    end if;

    -- Validate upsell_source if provided
    v_upsell_source := v_item ->> 'upsell_source';
    if v_upsell_source is not null and v_upsell_source not in ('extra', 'pairing', 'checkout_suggestion') then
      v_upsell_source := null; -- ignore invalid values
    end if;

    -- Calculate item total = (price + options_total + extras_total) × qty
    v_unit_price := v_product.price;
    v_item_total := (v_unit_price + v_options_total + v_extras_total) * v_item_qty;

    -- Insert item with server-authoritative data
    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, notes,
      extras_added, upsell_source
    )
    values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_unit_price,
      v_item_qty,
      v_item_total,
      v_options_json,
      v_item_notes,
      v_extras_json,
      v_upsell_source
    );

    v_total := v_total + v_item_total;
  end loop;

  -- Update order total
  update public.orders
  set total = v_total
  where id = v_order_id;

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

comment on function public.create_order is
  'Server-authoritative order creation. Validates products, modifiers, AND extras prices from DB. Tracks upsell_source.';

-- ═══════════════════════════════════════════════════════════════
-- Update resolve_qr_token to include checkout_suggestion_settings
-- ═══════════════════════════════════════════════════════════════

create or replace function public.resolve_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr         public.qr_tokens%rowtype;
  v_table      public.tables%rowtype;
  v_restaurant jsonb;
  v_ordering   boolean := true;
begin
  select * into v_qr
  from public.qr_tokens
  where token = p_token and is_active = true;

  if not found then return null; end if;

  if v_qr.expires_at is not null and v_qr.expires_at < now() then
    return null;
  end if;

  select * into v_table
  from public.tables
  where id = v_qr.table_id;

  if not found then return null; end if;

  select jsonb_build_object(
    'id',                            r.id,
    'name',                          r.name,
    'primary_color',                 r.primary_color,
    'logo_url',                      r.logo_url,
    'address',                       r.address,
    'phone',                         r.phone,
    'hours',                         r.hours,
    'checkout_suggestion_settings',  r.checkout_suggestion_settings
  ) into v_restaurant
  from public.restaurants r
  where r.id = v_qr.restaurant_id and r.is_active = true;

  if v_restaurant is null then return null; end if;

  select coalesce(rs.ordering_enabled, true) into v_ordering
  from public.restaurant_settings rs
  where rs.restaurant_id = v_qr.restaurant_id;

  return jsonb_build_object(
    'token',           to_jsonb(v_qr),
    'table',           to_jsonb(v_table),
    'restaurant',      v_restaurant,
    'orderingAllowed', coalesce(v_ordering, true)
  );
end;
$$;

grant execute on function public.resolve_qr_token(text) to anon, authenticated;
