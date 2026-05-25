-- =============================================================
-- Menuvia — Migration 006
-- create_order RPC — atomic order creation
-- SECURITY DEFINER: bypasses RLS; runs as function owner.
-- This is the ONLY write path for orders and order_items.
-- Both anon (QR) and authenticated (waiter) callers use this function.
-- =============================================================

create or replace function public.create_order(
  p_restaurant_id   uuid,
  p_source          text,
  p_table_id        uuid,
  p_qr_token_id     uuid,
  p_created_by      uuid,
  p_notes           text,
  p_items           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id    uuid;
  v_created_at  timestamptz;
  v_total       numeric(10,2);
  v_short_id    text;
begin

  -- ----------------------------------------------------------
  -- 1. Validate by source
  -- ----------------------------------------------------------
  if p_source = 'qr' then

    if p_qr_token_id is null then
      raise exception 'create_order: p_qr_token_id is required when source=qr';
    end if;

    if not exists (
      select 1 from public.qr_tokens qt
      where qt.id              = p_qr_token_id
        and qt.restaurant_id   = p_restaurant_id
        and qt.is_active       = true
        and (qt.expires_at is null or qt.expires_at > now())
    ) then
      raise exception 'create_order: qr_token is invalid, inactive, expired, or does not belong to restaurant';
    end if;

  elsif p_source = 'waiter' then

    if p_created_by is null then
      raise exception 'create_order: p_created_by is required when source=waiter';
    end if;

  else
    raise exception 'create_order: p_source must be ''qr'' or ''waiter'', got: %', p_source;
  end if;

  -- ----------------------------------------------------------
  -- 2. Validate items array is not empty
  -- ----------------------------------------------------------
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order: p_items must contain at least one item';
  end if;

  -- ----------------------------------------------------------
  -- 3. Calculate total
  --    (unit_price_snapshot + sum of selected_modifiers[*].price_delta) * quantity
  -- ----------------------------------------------------------
  select coalesce(
    sum(
      (
        (item ->> 'unit_price_snapshot')::numeric
        +
        coalesce(
          (
            select sum((mod_elem ->> 'price_delta')::numeric)
            from jsonb_array_elements(item -> 'selected_modifiers') as mod_elem
          ),
          0
        )
      )
      * (item ->> 'quantity')::integer
    ),
    0
  )::numeric(10,2)
  into v_total
  from jsonb_array_elements(p_items) as item;

  -- ----------------------------------------------------------
  -- 4. Insert order row
  -- ----------------------------------------------------------
  insert into public.orders (
    restaurant_id,
    source,
    table_id,
    qr_token_id,
    created_by,
    notes,
    status,
    total
  )
  values (
    p_restaurant_id,
    p_source::public.order_source,
    p_table_id,
    p_qr_token_id,
    p_created_by,
    p_notes,
    'new',
    v_total
  )
  returning id, created_at
  into v_order_id, v_created_at;

  -- ----------------------------------------------------------
  -- 5. Insert all order_items atomically in a single statement
  -- ----------------------------------------------------------
  insert into public.order_items (
    order_id,
    product_id,
    product_name_snapshot,
    unit_price_snapshot,
    quantity,
    item_total,
    selected_modifiers,
    notes
  )
  select
    v_order_id,
    nullif(item ->> 'product_id', '')::uuid,
    item ->> 'product_name_snapshot',
    (item ->> 'unit_price_snapshot')::numeric(10,2),
    (item ->> 'quantity')::smallint,
    (
      (
        (item ->> 'unit_price_snapshot')::numeric
        +
        coalesce(
          (
            select sum((mod_elem ->> 'price_delta')::numeric)
            from jsonb_array_elements(item -> 'selected_modifiers') as mod_elem
          ),
          0
        )
      )
      * (item ->> 'quantity')::integer
    )::numeric(10,2),
    coalesce(item -> 'selected_modifiers', '[]'::jsonb),
    nullif(item ->> 'notes', '')
  from jsonb_array_elements(p_items) as item;

  -- ----------------------------------------------------------
  -- 6. Build short_id: last 6 characters of uuid, uppercased
  -- ----------------------------------------------------------
  v_short_id := upper(right(v_order_id::text, 6));

  -- ----------------------------------------------------------
  -- 7. Return confirmation payload
  -- ----------------------------------------------------------
  return jsonb_build_object(
    'id',         v_order_id,
    'short_id',   v_short_id,
    'status',     'new',
    'total',      v_total,
    'created_at', v_created_at
  );

exception
  when others then
    -- Re-raise; entire transaction rolls back automatically
    raise;
end;
$$;

-- Grant execute to anon and authenticated.
-- Neither role has direct INSERT on orders or order_items.
grant execute on function public.create_order(uuid, text, uuid, uuid, uuid, text, jsonb)
  to anon, authenticated;
