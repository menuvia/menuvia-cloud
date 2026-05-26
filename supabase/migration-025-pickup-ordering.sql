-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 025 — Click-and-collect (pickup ordering)
-- ═══════════════════════════════════════════════════════════════
-- Owner activates pickup mode. Clients order from public menu page,
-- choose pickup time, pay cash on arrival (Stripe in next iteration).

-- ── Settings on restaurant ────────────────────────────────────

alter table public.restaurants
  add column if not exists pickup_settings jsonb
  default '{
    "enabled": false,
    "min_lead_time_minutes": 20,
    "slot_interval_minutes": 15,
    "open_hours": {"start": "09:00", "end": "21:00"},
    "instructions": null
  }'::jsonb;

comment on column public.restaurants.pickup_settings is
  'Click-and-collect settings. enabled=true activates ordering on public menu page (/r/slug). min_lead_time=cât trebuie să comande clientul în avans. slot_interval=intervalul între time slots.';

-- ── New columns on orders ─────────────────────────────────────

-- Source extends to include 'pickup'
alter table public.orders
  drop constraint if exists orders_source_check;

alter table public.orders
  add constraint orders_source_check
  check (source in ('qr', 'waiter', 'pickup'));

alter table public.orders
  add column if not exists pickup_time timestamptz;

alter table public.orders
  add column if not exists customer_name text
    check (customer_name is null or length(customer_name) <= 100);

alter table public.orders
  add column if not exists customer_phone text
    check (customer_phone is null or length(customer_phone) <= 20);

comment on column public.orders.pickup_time is
  'Pentru pickup orders: ora la care clientul vine să ridice comanda';

comment on column public.orders.customer_name is
  'Numele clientului pentru pickup orders (ospătarul îl strigă)';

comment on column public.orders.customer_phone is
  'Telefon client pentru pickup (apel dacă întârzie)';

-- ── Update create_order RPC to support pickup ────────────────

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
  v_order_id  uuid;
  v_existing_order_id uuid;
  v_existing_total numeric;
  v_existing_short_id text;
  v_existing_status text;
  v_short_id  text;
  v_total     numeric := 0;
  v_item      jsonb;
  v_product   record;
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
  if p_source not in ('qr', 'waiter', 'pickup') then
    raise exception 'Invalid source: %', p_source;
  end if;

  -- Pickup orders require customer_name (so the waiter can call them)
  if p_source = 'pickup' and (p_customer_name is null or length(trim(p_customer_name)) = 0) then
    raise exception 'Pickup orders require customer_name';
  end if;

  -- Rate limit for QR orders only
  if p_source = 'qr' then
    perform public.check_qr_order_rate_limit(p_qr_token_id);
  end if;

  -- Validate items
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must have at least one item';
  end if;

  -- Create order skeleton
  insert into public.orders (
    restaurant_id, table_id, source, status, notes,
    total, idempotency_key,
    pickup_time, customer_name, customer_phone
  ) values (
    p_restaurant_id, p_table_id, p_source, 'new', p_notes,
    0, p_idempotency_key,
    p_pickup_time, p_customer_name, p_customer_phone
  ) returning id into v_order_id;

  -- Process items (same as before)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
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

    -- Modifier options
    v_options_total := 0;
    v_options_json := '[]'::jsonb;

    if v_item ? 'option_ids' and jsonb_array_length(v_item -> 'option_ids') > 0 then
      select coalesce(sum(mo.price_delta), 0),
             coalesce(jsonb_agg(jsonb_build_object(
               'group_id', mg.id, 'group_name', mg.name,
               'option_id', mo.id, 'option_name', mo.name,
               'price_delta', mo.price_delta
             )), '[]'::jsonb)
        into v_options_total, v_options_json
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      where mo.id::text in (
        select x from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
      ) and mo.is_available = true;
    end if;

    -- Extras
    v_extras_total := 0;
    v_extras_json := '[]'::jsonb;

    if v_item ? 'extra_ids' and jsonb_array_length(v_item -> 'extra_ids') > 0 then
      select coalesce(sum(pe.price), 0),
             coalesce(jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name, 'price', pe.price)), '[]'::jsonb)
        into v_extras_total, v_extras_json
      from public.product_extras pe
      where pe.id::text in (
        select x from jsonb_array_elements_text(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) as x
      )
        and pe.product_id = v_product.id
        and pe.is_available = true;
    end if;

    -- upsell_source
    v_upsell_source := v_item ->> 'upsell_source';
    if v_upsell_source is not null and v_upsell_source not in ('extra', 'pairing', 'checkout_suggestion') then
      v_upsell_source := null;
    end if;

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
    'id', v_order_id, 'short_id', v_short_id,
    'status', 'new', 'total', v_total, 'created_at', now()
  );
end;
$$;

comment on function public.create_order is
  'Server-authoritative order creation. Supports QR, waiter manual, and pickup (click-and-collect) orders.';

-- Anon can call create_order for pickup (will validate source server-side)
grant execute on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text) to anon, authenticated;
