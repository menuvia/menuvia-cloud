-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 050 — Fix-uri fiscal payload generator (BUG #1, #2, #3)
-- ════════════════════════════════════════════════════════════════════════
-- Suprascrie `public.build_fiscalnet_payload(uuid)` definită ultima dată în
-- migration_031_order_discounts.sql:237 cu o versiune corectată pentru:
--
--  BUG #1 — Funcția crash-uia cu "malformed array literal" la `v_lines ||
--           'ST^'` în Postgres ≥15. Cauza: operatorul `||` cu text literal
--           untyped era interpretat ca array literal. Fix: folosesc
--           `array_append(v_lines, 'ST^'::text)` pentru toate adăugările
--           de elemente individuale.
--
--  BUG #2 — `quantity` din `order_items` era IGNORAT. Linia S^ folosea
--           `1000` hardcoded pentru CANT și `item_total` (incl. qty) pentru
--           PRET. Bonul fiscal afișa "1 buc × <item_total>" în loc de
--           "<qty> × <unit_price>". ANAF risk sub Legea 227/2015 art. 319(20)
--           care cere "cantitatea livrată / serviciilor prestate".
--           Fix: PRET = `unit_price_snapshot * 100`, CANT = `quantity * 1000`.
--
--  BUG #3 — `tips_amount` din `orders` (adăugat în migration_043) NU intra
--           în P^. Restaurantul încasa total + tips, dar bonul declara doar
--           total. ANAF risk: 5-10% diferență neînregistrată per tranzacție
--           cu bacșiș.
--           Fix: includ tips_amount în P^ ca parte din suma totală pe ultimul
--           rând de plată (suma efectiv încasată).
--
-- Pentru fiecare fix există teste corespunzătoare în:
--   supabase/tests/build_fiscalnet_payload_test.sql
-- TEST 01-39 trebuie să treacă PASS după aplicare migrației.
--
-- Bug-uri RĂMASE după această migrație (out of scope acest PR, P2):
--   #4 split payment (P^ multipli din order_payments) — feature
--   #5 CF^ client CIF — feature
--   #6 validare preț 0 — P2
--   #7 verificare consistency SUM(items) vs total — P2
--   #8 encoding diacritice → Bridge — investigație
--   #9 payment_method enum incomplet (tichete) — feature
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
  v_lines        text[] := array[]::text[];
  v_payment_code smallint;
  v_total_with_tips numeric(10,2);
begin
  -- Pull order header. Notă: include tips_amount (BUG #3 fix).
  select o.id, o.restaurant_id, o.payment_method, o.total,
         coalesce(o.tips_amount, 0) as tips_amount,
         o.discount_type, o.discount_value
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Item lines (BUG #2 fix): CANT = qty*1000 ca bonul fiscal să declare
  -- cantitatea reală (Legea 227/2015 art. 319). Pentru PRET, folosim
  -- `item_total / quantity` ca să păstrăm și modifier deltas (item_total
  -- include unit_price + modifier extras). În cazul comun fără modifiers,
  -- asta = unit_price_snapshot exact.
  --
  -- Atenție: dacă item_total nu se împarte exact la qty, rounding poate
  -- introduce 1 bani diferență per item raportat la totalul order-ului.
  -- Modifiers care nu sunt multipli de qty rămân o limitare cunoscută;
  -- soluția completă ar emite S^ separate per modifier (out of scope acest PR).
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
    -- BUG #1 fix: array_append cu cast explicit la text. Operatorul ||
    -- cu text literal e ambiguu în Postgres ≥15 când stânga e text[].
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

  -- BUG #1 fix: array_append cu cast explicit (vezi mai sus).
  v_lines := array_append(v_lines, 'ST^'::text);

  -- Discount linie (după ST^, conform docs EconMedia).
  -- BUG #1 fix aplicat și aici.
  if v_order.discount_type = 'percent' and v_order.discount_value > 0 then
    v_lines := array_append(v_lines,
      format('DP^%s', round(v_order.discount_value * 100)::bigint));
  elsif v_order.discount_type = 'amount' and v_order.discount_value > 0 then
    v_lines := array_append(v_lines,
      format('DV^%s', round(v_order.discount_value * 100)::bigint));
  end if;

  -- Plată: total cu bacșiș (BUG #3 fix). v_order.total e DEJA post-discount
  -- (recalculat de trigger recalc_order_subtotal din migration_031).
  -- Adăugăm tips_amount ca să reflectăm suma efectiv încasată.
  v_payment_code := public.fiscalnet_payment_code(v_order.payment_method);
  v_total_with_tips := v_order.total + v_order.tips_amount;
  v_lines := array_append(v_lines,
    format('P^%s^%s', v_payment_code, round(v_total_with_tips * 100)::bigint));

  return array_to_string(v_lines, E'\n');
end;
$$;

comment on function public.build_fiscalnet_payload(uuid) is
  'Generează payload-ul .txt FiscalNet pentru un order. Folosit de trigger '
  'enqueue_fiscal_receipt la order.paid. V3 (migration_050): fix BUG #1/2/3 '
  '(array literal crash, quantity ignorat, tips_amount ignorat). Spec '
  'oficial format: S^NUME^PRET^CANT^UM^GRTVA^GRDEP, ST^, DP^/DV^, P^TIP^TOTAL.';
