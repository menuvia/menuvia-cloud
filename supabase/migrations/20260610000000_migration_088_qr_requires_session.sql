-- Migration 088: FIX create_order rupt (P0) + Poarta B strict pe sesiune
-- ─────────────────────────────────────────────────────────────────────
-- CINCI fix-uri pe create_order (CREATE OR REPLACE, semnătură identică cu 084).
-- Rewrite-ul din 084 a rupt complet crearea comenzilor pe TOATE canalele;
-- niciun test nu a prins-o (toate foloseau product_id fals → eșuau înainte).
--
-- 1. [P0] Ordine INSERT: order_items insera ÎNAINTE de rândul orders → FK
--    violation la ORICE comandă. orders ÎNAINTE de buclă (total=0) + update după.
-- 2. [P0] Coloană extras: `selected_extras` (inexistentă) → `extras_added` (mig 023).
-- 3. [P0] Happy hour: apel `_apply_happy_hour_auto(uuid)` pe funcție fără args →
--    scos; trigger-ul trg_apply_happy_hour_auto (AFTER INSERT deferred) îl aplică.
-- 4. [P0] Pickup: citea `restaurant_settings.pickup_enabled` (coloană inexistentă)
--    → citim `restaurants.pickup_settings->>'enabled'` (jsonb, mig 025/046).
-- 5. [Plan 2] source='qr' cere acum p_session_id OBLIGATORIU (fără fallback permisiv).
--
-- Aplică 083→088 în ordine: 084 creează create_order (rupt), 088 îl repară.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.create_order(
  p_restaurant_id   uuid,
  p_source          text,
  p_table_id        uuid,
  p_qr_token_id     uuid,
  p_notes           text,
  p_items           jsonb,
  p_idempotency_key uuid      default null,
  p_pickup_time     timestamptz default null,
  p_customer_name   text      default null,
  p_customer_phone  text      default null,
  p_session_id      uuid      default null  -- NOU: trimis de frontend după open_table_session
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
  v_session         record;
begin
  -- ─── IDEMPOTENCY ─────────────────────────────────────────────
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

  -- ─── SOURCE VALIDATION ───────────────────────────────────────
  if p_source not in ('qr', 'waiter', 'pickup') then
    raise exception 'Invalid source: %', p_source
      using errcode = 'P0001', hint = 'invalid_source';
  end if;

  -- ─── ITEMS BASIC VALIDATION ──────────────────────────────────
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must have at least one item'
      using errcode = 'P0001', hint = 'no_items';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count > 30 then
    raise exception 'Order has too many lines: % (max 30)', v_item_count
      using errcode = 'P0001', hint = 'too_many_items';
  end if;

  -- ─── SOURCE-SPECIFIC VALIDATIONS ─────────────────────────────
  if p_source = 'qr' then
    if p_qr_token_id is null then
      raise exception 'QR orders require p_qr_token_id'
        using errcode = 'P0001', hint = 'missing_qr_token';
    end if;

    select * into v_qr_token
    from public.qr_tokens
    where id = p_qr_token_id
      and restaurant_id = p_restaurant_id
      and is_active = true
      and (expires_at is null or expires_at > now());

    if not found then
      raise exception 'QR token invalid sau expirat'
        using errcode = 'P0001', hint = 'invalid_qr_token';
    end if;

    v_effective_table_id := v_qr_token.table_id;

    -- ── GUARD SESIUNE (Spec §4.3 — Plan 2 STRICT, mig 088) ───
    if p_session_id is null then
      raise exception 'Sesiunea mesei lipsește. Scanează din nou QR-ul ca să începi o comandă.'
        using errcode = 'P0001', hint = 'session_required';
    end if;

    select * into v_session
    from public.table_sessions
    where id = p_session_id
      and table_id = v_qr_token.table_id
      and status = 'open';

    if not found then
      raise exception 'Masa a fost închisă sau sesiunea a expirat. Scanează din nou QR-ul ca să începi o comandă nouă.'
        using errcode = 'P0001', hint = 'session_closed';
    end if;

    update public.table_sessions
      set last_activity_at = now()
    where id = p_session_id;

  elsif p_source = 'waiter' then
    v_user_id := auth.uid();
    if v_user_id is null then
      raise exception 'Waiter orders require authentication'
        using errcode = 'P0001', hint = 'auth_required';
    end if;

    if not exists (
      select 1 from public.restaurant_memberships
      where restaurant_id = p_restaurant_id
        and user_id = v_user_id
        and role in ('owner', 'manager', 'waiter')
    ) then
      raise exception 'Nu ești autorizat să creezi comenzi pentru acest restaurant'
        using errcode = 'P0001', hint = 'unauthorized';
    end if;

    v_created_by := v_user_id;
    v_effective_table_id := p_table_id;

  elsif p_source = 'pickup' then
    if p_customer_name is null or length(trim(p_customer_name)) = 0 then
      raise exception 'Pickup orders require customer name'
        using errcode = 'P0001', hint = 'missing_customer_name';
    end if;

    -- Pickup = add-on OFF-default: citim restaurants.pickup_settings (jsonb,
    -- mig 025), nu restaurant_settings.pickup_enabled (coloană inexistentă —
    -- alt bug 084). Permis doar dacă pickup_settings.enabled=true.
    select pickup_settings into v_pickup_settings
    from public.restaurants
    where id = p_restaurant_id;

    v_pickup_enabled := coalesce((v_pickup_settings ->> 'enabled')::boolean, false);
    if not v_pickup_enabled then
      raise exception 'Comenzile pickup sunt dezactivate pentru acest restaurant.'
        using errcode = 'P0001', hint = 'pickup_disabled';
    end if;

    perform public.check_pickup_order_rate_limit(p_restaurant_id, p_customer_phone);

    v_effective_table_id := null;
  end if;

  -- ─── NOTES SANITIZATION ──────────────────────────────────────
  v_clean_notes := nullif(trim(coalesce(p_notes, '')), '');
  if v_clean_notes is not null and length(v_clean_notes) > 500 then
    raise exception 'Notes too long (max 500 chars)'
      using errcode = 'P0001', hint = 'notes_too_long';
  end if;

  -- ─── ITEMS PROCESSING ────────────────────────────────────────
  v_order_id := gen_random_uuid();

  -- ─── INSERT ORDER ─────────────────────────────────────────────
  insert into public.orders (
    id,
    restaurant_id, table_id, qr_token_id, source, status,
    total, notes, idempotency_key,
    pickup_time, customer_name, customer_phone,
    created_by, session_id
  ) values (
    v_order_id,
    p_restaurant_id, v_effective_table_id, p_qr_token_id,
    p_source::public.order_source, 'new',
    0, v_clean_notes, p_idempotency_key,  -- total=0; actualizat după buclă
    p_pickup_time, p_customer_name, p_customer_phone,
    v_created_by,
    case when p_source = 'qr' then p_session_id else null end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := coalesce((v_item->>'quantity')::smallint, 1);
    if v_item_qty < 1 or v_item_qty > 20 then
      raise exception 'Invalid quantity: % (must be 1-20)', v_item_qty
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;

    select id, price, is_active, restaurant_id, name
    into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'Product not found: %', v_item->>'product_id'
        using errcode = 'P0001', hint = 'product_not_found';
    end if;
    if v_product.restaurant_id != p_restaurant_id then
      raise exception 'Product % does not belong to this restaurant', v_product.id
        using errcode = 'P0001', hint = 'product_wrong_restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'Product "%" is not available', v_product.name
        using errcode = 'P0001', hint = 'product_inactive';
    end if;

    v_unit_price := v_product.price;

    -- Modifier options validation
    v_options_total := 0;
    v_options_json  := '[]'::jsonb;
    if v_item ? 'option_ids' and jsonb_array_length(v_item->'option_ids') > 0 then
      v_options_count_expected := jsonb_array_length(v_item->'option_ids');
      select
        count(*),
        coalesce(sum(mo.price_delta), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'group_id',    mg.id,
          'group_name',  mg.name,
          'option_id',   mo.id,
          'option_name', mo.name,
          'price_delta', mo.price_delta
        )), '[]'::jsonb)
      into v_options_count_found, v_options_total, v_options_json
      from jsonb_array_elements_text(v_item->'option_ids') opt_id
      join public.modifier_options mo on mo.id = opt_id::uuid
      join public.modifier_groups mg  on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
      where pmg.product_id = v_product.id
        and mo.is_available = true
        and mg.restaurant_id = p_restaurant_id;

      if v_options_count_found != v_options_count_expected then
        raise exception 'Invalid or unavailable modifier options for product "%"', v_product.name
          using errcode = 'P0001', hint = 'invalid_options';
      end if;
    end if;

    -- Extras validation
    v_extras_total := 0;
    v_extras_json  := '[]'::jsonb;
    if v_item ? 'extra_ids' and jsonb_array_length(v_item->'extra_ids') > 0 then
      select
        coalesce(sum(pe.price), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'extra_id',   pe.id,
          'extra_name', pe.name,
          'price',      pe.price
        )), '[]'::jsonb)
      into v_extras_total, v_extras_json
      from jsonb_array_elements_text(v_item->'extra_ids') eid
      join public.product_extras pe on pe.id = eid::uuid
      where pe.product_id = v_product.id
        and pe.restaurant_id = p_restaurant_id
        and pe.is_available = true;
    end if;

    v_item_notes := nullif(trim(coalesce(v_item->>'notes', '')), '');
    if v_item_notes is not null and length(v_item_notes) > 300 then
      raise exception 'Item notes too long (max 300 chars)'
        using errcode = 'P0001', hint = 'item_notes_too_long';
    end if;

    v_item_total := (v_unit_price + v_options_total + v_extras_total) * v_item_qty;
    v_total      := v_total + v_item_total;

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, extras_added, notes
    ) values (
      v_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_extras_json, v_item_notes
    );
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

revoke all on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text, uuid) from public;
grant execute on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text, uuid) to anon, authenticated;


grant execute on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text, uuid) to anon, authenticated;
