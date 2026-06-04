-- Migration 066: create_purchase_order_atomic — RPC tranzacțional pentru NIR
-- ─────────────────────────────────────────────────────────────────────
-- Bug confirmat în audit (P1): src/lib/stocks.ts:createPurchaseOrder face
-- 2 cereri separate (insert PO + insert PO items). Dacă cererea 2 eșuează
-- (network, RLS, validare), rămâne PO orfan fără items → date incomplete
-- în NIR (Notă de Recepție Marfă) → ownerul vede chitanțe goale.
--
-- Fix: o RPC singură care face ambele insert-uri într-o tranzacție implicită
-- plpgsql. Calculează subtotal/VAT/total server-side (nu mai are încredere
-- în client) și întoarce PO-ul creat.

create or replace function public.create_purchase_order_atomic(
  p_restaurant_id  uuid,
  p_supplier_id    uuid,
  p_invoice_number text,
  p_invoice_date   date,
  p_notes          text,
  p_items          jsonb  -- [{ingredient_id, quantity, unit_price, vat_rate}, ...]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id      uuid;
  v_subtotal   numeric := 0;
  v_vat_total  numeric := 0;
  v_total      numeric;
  v_item       jsonb;
  v_qty        numeric;
  v_price      numeric;
  v_vat_rate   numeric;
  v_line_net   numeric;
begin
  -- Auth + rol (doar admin/manager pot crea NIR)
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owner/manager can create purchase orders'
      using errcode = 'P0001', hint = 'forbidden';
  end if;

  -- Validare items: trebuie să fie array non-empty
  if p_items is null or jsonb_typeof(p_items) != 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Purchase order must have at least one item'
      using errcode = 'P0001', hint = 'no_items';
  end if;

  -- Calcul subtotal/VAT server-side (nu credem client-ul pentru bani)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty      := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_price    := coalesce((v_item ->> 'unit_price')::numeric, 0);
    v_vat_rate := coalesce((v_item ->> 'vat_rate')::numeric, 19);

    if v_qty <= 0 then
      raise exception 'Item quantity must be positive (got %)', v_qty
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;
    if v_price < 0 then
      raise exception 'Item unit_price cannot be negative'
        using errcode = 'P0001', hint = 'invalid_price';
    end if;
    if v_vat_rate < 0 or v_vat_rate > 100 then
      raise exception 'VAT rate out of range (got %)', v_vat_rate
        using errcode = 'P0001', hint = 'invalid_vat';
    end if;

    -- Validează că ingredientul aparține restaurantului (anti-cross-restaurant)
    if not exists (
      select 1 from public.ingredients
      where id = (v_item ->> 'ingredient_id')::uuid
        and restaurant_id = p_restaurant_id
    ) then
      raise exception 'Ingredient % does not belong to this restaurant',
        (v_item ->> 'ingredient_id')
        using errcode = 'P0001', hint = 'ingredient_wrong_restaurant';
    end if;

    v_line_net  := v_qty * v_price;
    v_subtotal  := v_subtotal + v_line_net;
    v_vat_total := v_vat_total + v_line_net * (v_vat_rate / 100);
  end loop;

  v_total := v_subtotal + v_vat_total;

  -- Insert PO header
  insert into public.purchase_orders (
    restaurant_id, supplier_id, invoice_number, invoice_date,
    status, subtotal, vat_total, total, notes
  ) values (
    p_restaurant_id, p_supplier_id, p_invoice_number, p_invoice_date,
    'draft', v_subtotal, v_vat_total, v_total, p_notes
  )
  returning id into v_po_id;

  -- Insert PO items
  insert into public.purchase_order_items (
    purchase_order_id, ingredient_id, quantity, unit_price, vat_rate, line_total
  )
  select
    v_po_id,
    (v_item ->> 'ingredient_id')::uuid,
    (v_item ->> 'quantity')::numeric,
    (v_item ->> 'unit_price')::numeric,
    coalesce((v_item ->> 'vat_rate')::numeric, 19),
    (v_item ->> 'quantity')::numeric * (v_item ->> 'unit_price')::numeric
      * (1 + coalesce((v_item ->> 'vat_rate')::numeric, 19) / 100)
  from jsonb_array_elements(p_items) v_item;

  return jsonb_build_object(
    'id', v_po_id,
    'subtotal', v_subtotal,
    'vat_total', v_vat_total,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_purchase_order_atomic(uuid, uuid, text, date, text, jsonb) from public;
grant execute on function public.create_purchase_order_atomic(uuid, uuid, text, date, text, jsonb) to authenticated;
