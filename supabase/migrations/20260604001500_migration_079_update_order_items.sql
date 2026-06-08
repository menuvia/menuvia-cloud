-- Migration 079: update_order_items RPC + happy hour re-evaluation
-- ─────────────────────────────────────────────────────────────────────
-- Permite owner/manager/waiter să editeze item-urile unei comenzi după
-- creare: schimbă cantități, șterge, adaugă produse + modificatori noi.
-- Logica și validările sunt copiate din create_order ca să fie consistente
-- (server-authoritative: nume + preț + delta modificatori din DB).
--
-- BLOCAJE INTENȚIONATE (decizii business):
--   1. Status terminal (paid/cancelled) → REJECTED. Nu rescrii istorie.
--   2. Plăți parțiale înregistrate (split bill) → REJECTED. Forțează
--      anularea plăților întâi (decizie contabilă: dacă reduci totalul
--      sub sum(payments), incassezi mai mult decât consumă clientul).
--   3. Items array gol → REJECTED. Pentru anulare, folosește advance_order.
--   4. Bridge fiscal (ANAF): nu se declanșează decât la 'paid', deci edit
--      pre-paid e safe.
--   5. Stocurile (ingredients): se decrementează doar la 'paid' via trigger
--      deduct_stock_trigger (mig 026). Edit pre-paid e safe.
--
-- AUDIT: order_items au triggere globale audit_log (mig 044) care
-- capturează INSERT/DELETE automat → istoric complet.

create or replace function public.update_order_items(
  p_order_id uuid,
  p_items    jsonb  -- [{product_id, quantity, option_ids:[uuid], notes}]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_role          text;
  v_item          jsonb;
  v_product       record;
  v_option_ids    uuid[];
  v_valid_count   integer;
  v_unit_price    numeric(10,2);
  v_options_delta numeric(10,2);
  v_options_json  jsonb;
  v_item_total    numeric(10,2);
  v_item_qty      integer;
  v_item_notes    text;
  v_payments_sum  numeric(10,2);
  v_items_count   integer;
begin
  -- ============================================================
  -- 1. AUTH + LOOKUP COMANDA
  -- ============================================================
  if v_caller_uid is null then
    raise exception 'update_order_items: authentication required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'update_order_items: order % not found', p_order_id;
  end if;

  -- ============================================================
  -- 2. ROLE CHECK — owner/manager/waiter
  -- ============================================================
  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  if v_role is null then
    raise exception 'update_order_items: caller is not a member of this restaurant';
  end if;

  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'update_order_items: role % cannot edit orders', v_role;
  end if;

  -- ============================================================
  -- 3. STATE CHECK — non-terminal only
  -- ============================================================
  if v_order.status in ('paid', 'cancelled') then
    raise exception 'update_order_items: order is % — cannot edit terminal state', v_order.status;
  end if;

  -- ============================================================
  -- 4. PAYMENTS CHECK — block edits if partial payments exist
  -- ============================================================
  select coalesce(sum(amount), 0) into v_payments_sum
  from public.order_payments
  where order_id = p_order_id;

  if v_payments_sum > 0 then
    raise exception
      'update_order_items: order has partial payments (% lei). Anulează plățile întâi.',
      v_payments_sum;
  end if;

  -- ============================================================
  -- 5. INPUT VALIDATION — at least one item required
  -- ============================================================
  v_items_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_items_count = 0 then
    raise exception 'update_order_items: items array empty. Pentru anulare folosește advance_order(cancel).';
  end if;
  if v_items_count > 100 then
    raise exception 'update_order_items: too many items (max 100)';
  end if;

  -- ============================================================
  -- 6. DELETE EXISTING ITEMS
  -- ============================================================
  delete from public.order_items where order_id = p_order_id;

  -- ============================================================
  -- 7. INSERT NEW ITEMS (server-authoritative, copy din create_order)
  -- ============================================================
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := (v_item ->> 'quantity')::integer;
    if v_item_qty is null or v_item_qty < 1 or v_item_qty > 99 then
      raise exception 'update_order_items: invalid quantity (1-99)';
    end if;

    select id, restaurant_id, name, price, is_active
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'update_order_items: product % not found', v_item ->> 'product_id';
    end if;
    if v_product.restaurant_id <> v_order.restaurant_id then
      raise exception 'update_order_items: product does not belong to this restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'update_order_items: product "%" is inactive', v_product.name;
    end if;

    v_unit_price := v_product.price;

    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );

    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;

    if array_length(v_option_ids, 1) > 0 then
      select count(*) into v_valid_count
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
      where mo.id = any(v_option_ids)
        and mo.is_available = true
        and pmg.product_id = v_product.id
        and mg.restaurant_id = v_order.restaurant_id;

      if v_valid_count <> array_length(v_option_ids, 1) then
        raise exception 'update_order_items: invalid options for product "%"', v_product.name;
      end if;

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

    v_item_total := (v_unit_price + v_options_delta) * v_item_qty;
    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, notes
    )
    values (
      p_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_item_notes
    );
  end loop;

  -- ============================================================
  -- 8. REFRESH TOTALS (păstrează discount-ul cached, recalculează net)
  -- ============================================================
  perform public._refresh_order_totals(p_order_id);

  -- ============================================================
  -- 9. RETURN updated snapshot
  -- ============================================================
  select * into v_order from public.orders where id = p_order_id;
  return jsonb_build_object(
    'id',              v_order.id,
    'total',           v_order.total,
    'discount_amount', v_order.discount_amount,
    'items_count',     v_items_count
  );
end;
$$;

revoke all on function public.update_order_items(uuid, jsonb) from public;
grant execute on function public.update_order_items(uuid, jsonb) to authenticated;

comment on function public.update_order_items(uuid, jsonb) is
  'Editează item-urile unei comenzi non-terminale fără plăți parțiale. Owner/manager/waiter only.';
