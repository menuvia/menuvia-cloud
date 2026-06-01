-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 051 — Fix-uri P2 fiscal payload (BUG #4, #6, #7)
-- ════════════════════════════════════════════════════════════════════════
-- Suprascrie `public.build_fiscalnet_payload(uuid)` definită în
-- migration_050 cu o versiune ce adaugă:
--
--  BUG #6 (P2) — generator accepta `unit_price_snapshot = 0` sau
--                `item_total = 0` fără validare. Bonul fiscal cu "0 RON"
--                este suspect ANAF (Legea 227/2015 art. 319: bonul trebuie
--                să reflecte o "tranzacție" reală). Free items / cadouri
--                trebuie tratate separat de aplicație — NU pe bonul fiscal.
--                Fix: RAISE EXCEPTION dacă vreun item are preț ≤ 0 sau
--                total ≤ 0.
--
--  BUG #7 (P2) — generator NU verifica consistency între `SUM(item_total)`
--                și `orders.total + orders.discount_amount`. Dacă trigger
--                `recalc_order_subtotal` eșua silent sau cineva updata
--                `orders.total` direct, bonul fiscal era inconsistent
--                (lines arătau o sumă, P^ alta).
--                Fix: RAISE EXCEPTION dacă diferența > 0.01 RON.
--
--  BUG #4 (P2) — split payment: dacă există rows în `order_payments`,
--                generam un singur P^ cu metoda din `orders.payment_method`
--                pentru întreaga sumă. Bonul nu reflecta plata mixtă
--                (ex: jumate cash, jumate card).
--                Fix: dacă există rows în `order_payments`, generăm câte
--                un P^ pe rând (preserve ordine `created_at`). Fallback
--                la single P^ (cu BUG #3 tips fix) când nu există split.
--                Notă: split-ul trustează amounts din order_payments. Dacă
--                aplicația le populează corect cu tips inclus, suma reflectă
--                ce a încasat efectiv casa.
--
-- Bug-uri rămase după 050 + 051 (toate P2/feature, out of scope):
--   #5 CF^ client CIF (feature: requires UI + ALTER TABLE invoices)
--   #8 encoding diacritice → Bridge (necesită testare cu casa fiscală reală)
--   #9 payment_method enum incomplet — tichete masă/valorice/voucher
--      (feature: ALTER TYPE + fiscalnet_payment_code mapping)
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.build_fiscalnet_payload(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        record;
  v_item         record;
  v_pay          record;
  v_lines        text[] := array[]::text[];
  v_payment_code smallint;
  v_total_with_tips numeric(10,2);
  v_items_sum    numeric(10,2);
  v_expected     numeric(10,2);
  v_split_count  integer;
begin
  -- Pull order header.
  select o.id, o.restaurant_id, o.payment_method, o.total,
         coalesce(o.tips_amount, 0) as tips_amount,
         coalesce(o.discount_amount, 0) as discount_amount,
         o.discount_type, o.discount_value
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Item lines.
  for v_item in
    select
      oi.id,
      oi.product_name_snapshot,
      oi.unit_price_snapshot,
      oi.quantity,
      oi.item_total,
      coalesce(p.vat_group, 1) as vat_group_internal,
      coalesce(vr.fiscalnet_group, coalesce(p.vat_group, 1)) as fn_group
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.vat_rates vr on vr.restaurant_id = v_order.restaurant_id
                                  and vr.vat_group = coalesce(p.vat_group, 1)
    where oi.order_id = p_order_id
    order by oi.created_at
  loop
    -- BUG #6 fix: refuz item cu preț 0. Free items pe bon ar fi declarație
    -- de venit 0 lei pentru o tranzacție — risc ANAF. Aplicația trebuie să
    -- gestioneze gratis-uri separat (de ex să nu le includă în order).
    if v_item.item_total is null or v_item.item_total <= 0 then
      raise exception
        'Order %: item % (%) has non-positive total (%) — refused by fiscal payload (BUG #6 guard)',
        p_order_id, v_item.id, v_item.product_name_snapshot, v_item.item_total;
    end if;
    if v_item.unit_price_snapshot is null or v_item.unit_price_snapshot <= 0 then
      raise exception
        'Order %: item % (%) has non-positive unit price (%) — refused by fiscal payload (BUG #6 guard)',
        p_order_id, v_item.id, v_item.product_name_snapshot, v_item.unit_price_snapshot;
    end if;

    v_lines := array_append(v_lines, format(
      'S^%s^%s^%s^buc^%s^1',
      public.fiscalnet_sanitize(v_item.product_name_snapshot),
      round((v_item.item_total / v_item.quantity) * 100)::bigint,
      (v_item.quantity * 1000)::bigint,
      v_item.fn_group
    ));
  end loop;

  if array_length(v_lines, 1) is null then
    raise exception 'Order % has no items', p_order_id;
  end if;

  -- BUG #7 fix: invariant SUM(item_total) == total + discount_amount.
  -- Toleranță 0.01 pentru artefacte de rounding (e.g. discount procentual).
  select coalesce(sum(item_total), 0) into v_items_sum
    from public.order_items where order_id = p_order_id;
  v_expected := v_order.total + v_order.discount_amount;
  if abs(v_items_sum - v_expected) > 0.01 then
    raise exception
      'Order %: items sum (%) != total (%) + discount (%) — inconsistent state, refused by fiscal payload (BUG #7 guard). Run _refresh_order_totals to recompute.',
      p_order_id, v_items_sum, v_order.total, v_order.discount_amount;
  end if;

  v_lines := array_append(v_lines, 'ST^'::text);

  -- Discount linie (după ST^).
  if v_order.discount_type = 'percent' and v_order.discount_value > 0 then
    v_lines := array_append(v_lines,
      format('DP^%s', round(v_order.discount_value * 100)::bigint));
  elsif v_order.discount_type = 'amount' and v_order.discount_value > 0 then
    v_lines := array_append(v_lines,
      format('DV^%s', round(v_order.discount_value * 100)::bigint));
  end if;

  -- BUG #4 fix: split payment. Dacă există rows în order_payments,
  -- emitem câte un P^ pe rând (preserve ordine inserție). Altfel
  -- fallback la single P^ cu total + tips (= comportament migration_050).
  select count(*) into v_split_count
    from public.order_payments
   where order_id = p_order_id;

  if v_split_count > 0 then
    for v_pay in
      select method, amount
        from public.order_payments
       where order_id = p_order_id
       order by created_at, id
    loop
      v_lines := array_append(v_lines, format(
        'P^%s^%s',
        public.fiscalnet_payment_code(v_pay.method::public.payment_method),
        round(v_pay.amount * 100)::bigint
      ));
    end loop;
  else
    v_payment_code := public.fiscalnet_payment_code(v_order.payment_method);
    v_total_with_tips := v_order.total + v_order.tips_amount;
    v_lines := array_append(v_lines,
      format('P^%s^%s', v_payment_code, round(v_total_with_tips * 100)::bigint));
  end if;

  return array_to_string(v_lines, E'\n');
end;
$$;

comment on function public.build_fiscalnet_payload(uuid) is
  'Generează payload-ul .txt FiscalNet pentru un order. Folosit de trigger '
  'enqueue_fiscal_receipt la order.paid. V4 (migration_051): fix BUG '
  '#4 (split payment din order_payments), #6 (refuz price 0), #7 (guard '
  'invariant SUM(items) = total + discount). Pe lângă fix-urile #1/2/3 '
  'din migration_050.';
