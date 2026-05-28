-- ════════════════════════════════════════════════════════════════════════
-- supabase/tests/build_fiscalnet_payload_test.sql
-- ════════════════════════════════════════════════════════════════════════
-- Unit test suite pentru funcția SQL `public.build_fiscalnet_payload(uuid)`
-- (definită în migration_031_order_discounts.sql, suprascrie versiunea v1
-- din migration_030_bridge_receipts.sql).
--
-- Generatorul produce payload-ul .txt FiscalNet care e inserat în
-- `pending_receipts.payload` și transportat de Bridge desktop la casa de
-- marcat. Bug aici = bon fiscal greșit → ANAF risk pentru restaurant.
--
-- Format așteptat (per Documentatie.pdf EconMedia):
--   CF^<cod_fiscal>                opțional, prima linie (CUI client)
--   S^DENUMIRE^PRET^CANT^UM^GRTVA^GRDEP   per articol
--   DP^<percent*100> / DV^<amount_cents>  discount post-articol opțional
--   ST^                            subtotal opțional
--   P^TipPlata^VALOARE            1=Numerar, 2=Card, 3=Credit, ...
--
-- RULARE:
--   psql -d <db> -f supabase/tests/build_fiscalnet_payload_test.sql
--   (necesită Postgres cu toate migrațiile aplicate)
--
-- AVERTISMENT:
--   Suite-ul lasă date orfane în tabele (orders, order_items, products,
--   restaurants, vat_rates) — rulează contra unei DB efemere / dev.
--   NU rula contra production.
-- ════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP off
\timing off

-- Suite-ul folosește o tabelă temporară pentru a colecta rezultatele.
-- La final, un SELECT arată summary-ul + detaliile.
drop table if exists _test_results;
create temp table _test_results (
  ord serial primary key,
  test_id text not null,           -- "TEST 01", "TEST 02", ...
  description text not null,
  status text not null check (status in ('PASS','FAIL','SKIP','TODO','ERROR')),
  actual text,
  expected text,
  notes text                       -- bug ID, edge case explanation
);

-- ────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS (in _test_helpers schema for cleanup)
-- ────────────────────────────────────────────────────────────────────────

create schema if not exists _test_helpers;

-- _test_helpers.mk_restaurant() — creează un restaurant. ATENȚIE:
-- trigger `create_vat_rates_trigger` auto-creează vat_rates default
-- la insert pe restaurants, deci NU mai inserăm noi. Doar facem UPDATE
-- ca să garantăm valorile fiscalnet_group corecte (1..4).
create or replace function _test_helpers.mk_restaurant(p_slug text default null)
returns uuid language plpgsql as $$
declare
  v_owner_id uuid;
  v_restaurant_id uuid := gen_random_uuid();
  v_slug text := coalesce(p_slug, 'r-' || replace(v_restaurant_id::text, '-', ''));
begin
  -- Owner placeholder
  insert into auth.users(id, email) values (gen_random_uuid(), v_slug || '@test') returning id into v_owner_id;
  insert into public.restaurants(id, owner_id, name, slug) values (v_restaurant_id, v_owner_id, 'Test', v_slug);
  -- Trigger create_vat_rates_trigger a creat deja vat_rates. Forțăm mapare 1:1
  -- vat_group → fiscalnet_group ca să fie predictibil în tests.
  update public.vat_rates set fiscalnet_group = vat_group where restaurant_id = v_restaurant_id;
  return v_restaurant_id;
end;
$$;

-- mk_product(restaurant_id, name, price, vat_group) → product_id
create or replace function _test_helpers.mk_product(
  p_restaurant_id uuid, p_name text, p_price numeric, p_vat_group int default 1
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.products(id, restaurant_id, name, price, vat_group)
    values (v_id, p_restaurant_id, p_name, p_price, p_vat_group::smallint);
  return v_id;
end;
$$;

-- mk_order(restaurant_id, payment_method, total, discount_type, discount_value)
-- Note: setăm status='paid' DAR insertăm direct (skip trigger) pentru izolare.
create or replace function _test_helpers.mk_order(
  p_restaurant_id uuid,
  p_payment public.payment_method default 'cash',
  p_total numeric default 0,
  p_discount_type public.order_discount_type default null,
  p_discount_value numeric default null
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders(id, restaurant_id, source, status, payment_method, total,
                            discount_type, discount_value)
    values (v_id, p_restaurant_id, 'waiter', 'new', p_payment, p_total,
            p_discount_type, p_discount_value);
  return v_id;
end;
$$;

-- add_item(order_id, product_id, name_snapshot, unit_price, qty, item_total)
create or replace function _test_helpers.add_item(
  p_order_id uuid, p_product_id uuid, p_name text,
  p_unit_price numeric, p_qty int, p_item_total numeric
) returns void language plpgsql as $$
begin
  insert into public.order_items(order_id, product_id, product_name_snapshot,
                                  unit_price_snapshot, quantity, item_total)
    values (p_order_id, p_product_id, p_name, p_unit_price, p_qty::smallint, p_item_total);
end;
$$;

-- record(test_id, desc, status, actual, expected, notes)
create or replace function _test_helpers.record(
  p_id text, p_desc text, p_status text, p_actual text, p_expected text, p_notes text default ''
) returns void language plpgsql as $$
begin
  insert into _test_results(test_id, description, status, actual, expected, notes)
    values (p_id, p_desc, p_status, p_actual, p_expected, p_notes);
end;
$$;

-- assert_eq(test_id, desc, expected, actual) — compară string by-string
create or replace function _test_helpers.assert_eq(
  p_id text, p_desc text, p_expected text, p_actual text, p_notes text default ''
) returns void language plpgsql as $$
begin
  if p_actual = p_expected then
    perform _test_helpers.record(p_id, p_desc, 'PASS', p_actual, p_expected, p_notes);
  else
    perform _test_helpers.record(p_id, p_desc, 'FAIL', p_actual, p_expected, p_notes);
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- SECȚIUNEA A — HAPPY PATH (tests 01-08)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 01: 1 articol, cash, fără CUI
do $$
declare
  r uuid; p uuid; o uuid; actual text;
  expected text := E'S^Burger^2500^1000^buc^1^1\nST^\nP^1^2500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Burger', 25.00, 1);
  o := _test_helpers.mk_order(r, 'cash', 25.00);
  perform _test_helpers.add_item(o, p, 'Burger', 25.00, 1, 25.00);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 01', '1 item, cash, no CUI', expected, actual);
exception when others then
  perform _test_helpers.record('TEST 01', '1 item, cash', 'ERROR', SQLERRM, expected, 'unexpected exception');
end $$;

-- TEST 02: 1 articol, card
do $$
declare
  r uuid; p uuid; o uuid; actual text;
  expected text := E'S^Cafea^800^1000^buc^1^1\nST^\nP^2^800';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Cafea', 8.00, 1);
  o := _test_helpers.mk_order(r, 'card_pos', 8.00);
  perform _test_helpers.add_item(o, p, 'Cafea', 8.00, 1, 8.00);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 02', '1 item, card', expected, actual);
exception when others then
  perform _test_helpers.record('TEST 02', '1 item, card', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 03: 3 articole diferite, cash
do $$
declare
  r uuid; p1 uuid; p2 uuid; p3 uuid; o uuid; actual text;
  expected text :=
    E'S^Pizza^3500^1000^buc^1^1\nS^Salata^1500^1000^buc^1^1\nS^Bere^900^1000^buc^1^1\nST^\nP^1^5900';
begin
  r := _test_helpers.mk_restaurant();
  p1 := _test_helpers.mk_product(r, 'Pizza', 35, 1);
  p2 := _test_helpers.mk_product(r, 'Salata', 15, 1);
  p3 := _test_helpers.mk_product(r, 'Bere', 9, 1);
  o := _test_helpers.mk_order(r, 'cash', 59);
  perform _test_helpers.add_item(o, p1, 'Pizza', 35, 1, 35);
  perform pg_sleep(0.005);  -- ensure created_at distinct for ORDER BY
  perform _test_helpers.add_item(o, p2, 'Salata', 15, 1, 15);
  perform pg_sleep(0.005);
  perform _test_helpers.add_item(o, p3, 'Bere', 9, 1, 9);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 03', '3 items diferite, cash', expected, actual);
exception when others then
  perform _test_helpers.record('TEST 03', '3 items', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 04: split payment (cash + card)
-- Generatorul actual NU suportă split payment — folosește doar v_order.payment_method.
-- Marcăm ca TODO documentând limitarea.
do $$ begin
  perform _test_helpers.record('TEST 04', 'split payment cash+card', 'TODO',
    NULL, NULL,
    'BUG #4 — generatorul folosește un singur P^ cu v_order.payment_method. Nu există suport pentru split (multiple P^). order_payments tabela ar trebui interogată dar nu e.');
end $$;

-- TEST 05: cantitate > 1 — testează BUG #2 (quantity hardcodat în payload)
do $$
declare
  r uuid; p uuid; o uuid; actual text;
  -- "Expected" în sensul ANAF: 2 buc × 30 RON = 60. Payload ar trebui:
  --   S^Friptura^3000^2000^buc^1^1     (PRET=unit_price, CANT=2.000)
  -- DAR generatorul produce:
  --   S^Friptura^6000^1000^buc^1^1     (PRET=item_total, CANT=1.000 hardcoded)
  expected text := E'S^Friptura^3000^2000^buc^1^1\nST^\nP^1^6000';
  observed text;
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Friptura', 30, 1);
  o := _test_helpers.mk_order(r, 'cash', 60);
  perform _test_helpers.add_item(o, p, 'Friptura', 30, 2, 60);
  observed := public.build_fiscalnet_payload(o);
  if observed = expected then
    perform _test_helpers.record('TEST 05', 'qty > 1 (2 buc × 30)', 'PASS', observed, expected, '');
  else
    perform _test_helpers.record('TEST 05', 'qty > 1 (2 buc × 30)', 'FAIL', observed, expected,
      'BUG #2 — generatorul hardcodează CANT=1000 (1.000 buc) și pune item_total în PRET. Ar trebui CANT=qty*1000, PRET=unit_price*100. Risk ANAF: cantitatea declarată pe bon e mereu 1, indiferent de cât s-a vândut.');
  end if;
exception when others then
  perform _test_helpers.record('TEST 05', 'qty > 1', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 06: preț non-rotund 4.99 RON
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^Cola^499^1000^buc^1^1\nST^\nP^1^499';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Cola', 4.99, 1);
  o := _test_helpers.mk_order(r, 'cash', 4.99);
  perform _test_helpers.add_item(o, p, 'Cola', 4.99, 1, 4.99);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 06', 'price 4.99 → 499', expected, actual);
exception when others then perform _test_helpers.record('TEST 06', 'price 4.99', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 07 & 08: CUI client (CF^) — generatorul NICIODATĂ nu emite CF^
do $$ begin
  perform _test_helpers.record('TEST 07', 'CUI client (CF^RO12345)', 'TODO',
    NULL, NULL,
    'BUG #5 — generatorul nu suportă deloc CF^. Nu există coloană pe orders pentru CIF client. B2B billing imposibil.');
  perform _test_helpers.record('TEST 08', 'CUI cu spațiu (CF^RO 12345)', 'TODO',
    NULL, NULL,
    'BUG #5 — same (CF^ nu există).');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SECȚIUNEA B — VAT GROUPS (tests 09-13)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 09: GRTVA=1 (19%) deja testat în TEST 01, dar marcăm explicit
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1900^1000^buc^1^1\nST^\nP^1^1900';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 19, 1);
  o := _test_helpers.mk_order(r, 'cash', 19);
  perform _test_helpers.add_item(o, p, 'X', 19, 1, 19);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 09', 'GRTVA=1 (19%)', expected, actual);
exception when others then perform _test_helpers.record('TEST 09', 'GRTVA=1', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 10: GRTVA=2 (9%)
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^900^1000^buc^2^1\nST^\nP^1^900';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 9, 2);
  o := _test_helpers.mk_order(r, 'cash', 9);
  perform _test_helpers.add_item(o, p, 'X', 9, 1, 9);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 10', 'GRTVA=2 (9%)', expected, actual);
exception when others then perform _test_helpers.record('TEST 10', 'GRTVA=2', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 11: GRTVA=3 (5%)
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^500^1000^buc^3^1\nST^\nP^1^500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 5, 3);
  o := _test_helpers.mk_order(r, 'cash', 5);
  perform _test_helpers.add_item(o, p, 'X', 5, 1, 5);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 11', 'GRTVA=3 (5%)', expected, actual);
exception when others then perform _test_helpers.record('TEST 11', 'GRTVA=3', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 12: GRTVA=4 (0%) — schema permite vat_group=4
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1000^1000^buc^4^1\nST^\nP^1^1000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 10, 4);
  o := _test_helpers.mk_order(r, 'cash', 10);
  perform _test_helpers.add_item(o, p, 'X', 10, 1, 10);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 12', 'GRTVA=4 (0%)', expected, actual);
exception when others then perform _test_helpers.record('TEST 12', 'GRTVA=4', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 13: GRTVA=5 (neplătitor TVA) — products.vat_group NU permite 5
-- (check 1<=vat_group<=4). Trebuie folosit vat_rates.fiscalnet_group=5
-- ca să mapăm produsul cu vat_group=1 la grupa fiscală 5.
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1200^1000^buc^5^1\nST^\nP^1^1200';
begin
  r := _test_helpers.mk_restaurant();
  -- Suprascrie maparea: vat_group 1 → fiscalnet_group 5
  update public.vat_rates set fiscalnet_group = 5 where restaurant_id = r and vat_group = 1;
  p := _test_helpers.mk_product(r, 'X', 12, 1);
  o := _test_helpers.mk_order(r, 'cash', 12);
  perform _test_helpers.add_item(o, p, 'X', 12, 1, 12);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 13', 'GRTVA=5 (via fiscalnet_group)', expected, actual);
exception when others then perform _test_helpers.record('TEST 13', 'GRTVA=5', 'ERROR', SQLERRM, expected, '');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SECȚIUNEA C — DECIMALE / FORMATARE (tests 14-21)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 14: preț 0.01 → "1"
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1^1000^buc^1^1\nST^\nP^1^1';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 0.01, 1);
  o := _test_helpers.mk_order(r, 'cash', 0.01);
  perform _test_helpers.add_item(o, p, 'X', 0.01, 1, 0.01);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 14', 'price 0.01 RON → "1" cents', expected, actual);
exception when others then perform _test_helpers.record('TEST 14', 'price 0.01', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 15: preț 10.00 → "1000"
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1000^1000^buc^1^1\nST^\nP^1^1000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 10, 1);
  o := _test_helpers.mk_order(r, 'cash', 10);
  perform _test_helpers.add_item(o, p, 'X', 10, 1, 10);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 15', 'price 10.00 → "1000"', expected, actual);
exception when others then perform _test_helpers.record('TEST 15', 'price 10.00', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 16: preț 99.99 → "9999"
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^9999^1000^buc^1^1\nST^\nP^1^9999';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 99.99, 1);
  o := _test_helpers.mk_order(r, 'cash', 99.99);
  perform _test_helpers.add_item(o, p, 'X', 99.99, 1, 99.99);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 16', 'price 99.99 → "9999"', expected, actual);
exception when others then perform _test_helpers.record('TEST 16', 'price 99.99', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 17: preț 100.00 → "10000"
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^10000^1000^buc^1^1\nST^\nP^1^10000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 100, 1);
  o := _test_helpers.mk_order(r, 'cash', 100);
  perform _test_helpers.add_item(o, p, 'X', 100, 1, 100);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 17', 'price 100.00 → "10000"', expected, actual);
exception when others then perform _test_helpers.record('TEST 17', 'price 100', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 18-21: cantitate decimală — IMPOSIBIL în schema actuală.
-- order_items.quantity e smallint cu check 1<=qty<=99. Decimale (0.001, 1.5)
-- NU se pot stoca. Generatorul oricum ignoră quantity (BUG #2), deci impactul
-- pentru tests-uri e moot.
do $$ begin
  perform _test_helpers.record('TEST 18', 'quantity 0.001', 'SKIP', NULL, NULL,
    'Schema previne — order_items.quantity smallint check 1..99. Plus BUG #2 (qty ignorat in payload).');
  perform _test_helpers.record('TEST 19', 'quantity 1.000', 'SKIP', NULL, NULL,
    'Acoperit de TEST 01 (qty=1 default). Plus BUG #2.');
  perform _test_helpers.record('TEST 20', 'quantity 1.500', 'SKIP', NULL, NULL,
    'Schema previne fracționalul. Plus BUG #2.');
  perform _test_helpers.record('TEST 21', 'rounding 1.2345', 'SKIP', NULL, NULL,
    'Schema previne fracționalul. Plus BUG #2.');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SECȚIUNEA D — EDGE CASES CRITICE (tests 22-31)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 22: preț 0 — testează dacă se rejectează sau acceptă
do $$
declare r uuid; p uuid; o uuid; actual text;
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Free', 0, 1);
  o := _test_helpers.mk_order(r, 'cash', 0);
  perform _test_helpers.add_item(o, p, 'Free', 0, 1, 0);
  actual := public.build_fiscalnet_payload(o);
  -- Așteptat: REJECT cu RAISE. Observat: generator acceptă, produce S^Free^0^1000^buc^1^1
  if actual like 'S^Free^0^%' then
    perform _test_helpers.record('TEST 22', 'price = 0 (free item)', 'FAIL', actual,
      '<should raise: invalid price 0>',
      'BUG #6 — generator acceptă preț 0 fără validare. Bon fiscal cu "0 RON" e suspect ANAF.');
  else
    perform _test_helpers.record('TEST 22', 'price = 0', 'PASS', actual, '<raised exception>', '');
  end if;
exception when others then
  perform _test_helpers.record('TEST 22', 'price = 0 → exception', 'PASS', SQLERRM, '<exception>',
    'OK: generator raises pe item gratis.');
end $$;

-- TEST 23: cantitate 0 — schema rejectează (check qty >= 1)
do $$
declare r uuid; p uuid; o uuid;
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 10, 1);
  o := _test_helpers.mk_order(r, 'cash', 0);
  begin
    perform _test_helpers.add_item(o, p, 'X', 10, 0, 0);
    perform _test_helpers.record('TEST 23', 'quantity = 0', 'FAIL',
      '<insert succeeded>', '<should reject at schema check>', '');
  exception when check_violation then
    perform _test_helpers.record('TEST 23', 'quantity = 0', 'PASS',
      'check_violation', 'check_violation', 'Schema check oi_quantity_range previne.');
  end;
end $$;

-- TEST 24: preț negativ — schema rejectează
do $$
declare r uuid; p uuid;
begin
  r := _test_helpers.mk_restaurant();
  begin
    p := _test_helpers.mk_product(r, 'X', -5, 1);
    perform _test_helpers.record('TEST 24', 'price negative -5', 'FAIL',
      '<insert succeeded>', '<should reject>', '');
  exception when check_violation then
    perform _test_helpers.record('TEST 24', 'price negative -5', 'PASS',
      'check_violation', 'check_violation', 'Schema check products_price_nonneg previne.');
  end;
end $$;

-- TEST 25: cart gol — order fără items
do $$
declare r uuid; o uuid; actual text;
begin
  r := _test_helpers.mk_restaurant();
  o := _test_helpers.mk_order(r, 'cash', 0);
  begin
    actual := public.build_fiscalnet_payload(o);
    perform _test_helpers.record('TEST 25', 'cart empty', 'FAIL',
      actual, '<should raise: no items>', 'BUG: generator nu validează lipsa items DACĂ ajunge aici (improbabil prin trigger normal).');
  exception when others then
    perform _test_helpers.record('TEST 25', 'cart empty → exception', 'PASS',
      SQLERRM, '<exception>', 'OK: "Order % has no items" raised.');
  end;
end $$;

-- TEST 26: suma plăților ≠ suma articolelor — guard de consistency.
-- DUPĂ migration_051 fix BUG #7: generator RAISE EXCEPTION dacă
-- SUM(item_total) != total + discount_amount. Forțăm orders.total = 70 dar
-- item de 50 RON cu PG_TRY ca să evităm trigger-ul recalc_order_subtotal.
do $$
declare r uuid; p uuid; o uuid; actual text;
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 50, 1);
  o := _test_helpers.mk_order(r, 'cash', 50);
  perform _test_helpers.add_item(o, p, 'X', 50, 1, 50);
  -- Force inconsistency: setez total la 70 fără să trigger recalc
  update public.orders set total = 70 where id = o;
  begin
    actual := public.build_fiscalnet_payload(o);
    perform _test_helpers.record('TEST 26', 'mismatch SUM(items) ≠ total', 'FAIL',
      actual, '<should raise (BUG #7 fixed)>',
      'BUG #7 — generator NU validează consistency. Risk: bonul are sumă greșită.');
  exception when others then
    perform _test_helpers.record('TEST 26', 'mismatch raises (BUG #7 fix)', 'PASS',
      SQLERRM, '<raised>',
      'OK: migration_051 guard refuză payload când SUM(items) ≠ total + discount.');
  end;
end $$;

-- TEST 27: GRTVA invalid (0, 6, 99) — schema permite vat_rates.fiscalnet_group 1-5.
-- Dacă product.vat_group = 1..4 dar vat_rates lipsește pentru restaurant,
-- coalesce-ul folosește vat_group internal. Verificăm: produs cu vat_group=1
-- și vat_rates STERS pentru grupa 1 → fn_group=1 (fallback).
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1000^1000^buc^1^1\nST^\nP^1^1000';
begin
  r := _test_helpers.mk_restaurant();
  delete from public.vat_rates where restaurant_id = r;  -- fără vat_rates deloc
  p := _test_helpers.mk_product(r, 'X', 10, 1);
  o := _test_helpers.mk_order(r, 'cash', 10);
  perform _test_helpers.add_item(o, p, 'X', 10, 1, 10);
  actual := public.build_fiscalnet_payload(o);
  if actual = expected then
    perform _test_helpers.record('TEST 27', 'fallback fără vat_rates', 'PASS',
      actual, expected, 'OK: coalesce returnează vat_group internal.');
  else
    perform _test_helpers.record('TEST 27', 'fallback fără vat_rates', 'FAIL', actual, expected, '');
  end if;
exception when others then perform _test_helpers.record('TEST 27', 'vat fallback', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 28: denumire cu ^ în ea (injection!)
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^Mușchi  ofertă^2000^1000^buc^1^1\nST^\nP^1^2000';
  -- "Mușchi^^ofertă" → după sanitize → "Mușchi  ofertă" (^ replaced cu space)
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 20, 1);
  o := _test_helpers.mk_order(r, 'cash', 20);
  perform _test_helpers.add_item(o, p, 'Mușchi^^ofertă', 20, 1, 20);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 28', 'name cu ^ (injection)', expected, actual,
    'fiscalnet_sanitize înlocuiește ^ cu space — OK, fără injection.');
exception when others then perform _test_helpers.record('TEST 28', 'name cu ^', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 29: denumire cu \n
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- "Salat\nverde" → sanitize → "Salat verde"
  expected text := E'S^Salat verde^1500^1000^buc^1^1\nST^\nP^1^1500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 15, 1);
  o := _test_helpers.mk_order(r, 'cash', 15);
  perform _test_helpers.add_item(o, p, E'Salat\nverde', 15, 1, 15);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 29', 'name cu \\n', expected, actual,
    'fiscalnet_sanitize înlocuiește \\n cu space.');
exception when others then perform _test_helpers.record('TEST 29', 'name cu \n', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 30: denumire foarte lungă (>40 chars) — fiscalnet_sanitize trunchează la 36
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- 50 chars "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstwxyz"
  -- Trunchiat la 36: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
  expected text := E'S^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij^1000^1000^buc^1^1\nST^\nP^1^1000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 10, 1);
  o := _test_helpers.mk_order(r, 'cash', 10);
  perform _test_helpers.add_item(o, p, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstwxyz', 10, 1, 10);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 30', 'long name truncated to 36 chars', expected, actual,
    'OBSERVAȚIE: nu se păstrează cuvinte întregi. Trunchierea poate genera 2 produse identice in payload daca primele 36 chars matchează.');
exception when others then perform _test_helpers.record('TEST 30', 'long name', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 31: diacritice românești (ă, â, î, ș, ț, Țuică)
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^Țuică pălincă șuncă^2500^1000^buc^1^1\nST^\nP^1^2500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 25, 1);
  o := _test_helpers.mk_order(r, 'cash', 25);
  perform _test_helpers.add_item(o, p, 'Țuică pălincă șuncă', 25, 1, 25);
  actual := public.build_fiscalnet_payload(o);
  if actual = expected then
    perform _test_helpers.record('TEST 31', 'diacritice românești', 'PASS', actual, expected,
      'OK: Postgres TEXT e UTF-8 nativ. ATENȚIE: casa fiscală EconMedia poate cere CP1250/ASCII — verifică spec Bridge encoding!');
  else
    perform _test_helpers.record('TEST 31', 'diacritice', 'FAIL', actual, expected,
      'BUG #8 — encoding diacritice (UTF-8 → ?). Verifică Bridge pentru conversie CP1250.');
  end if;
exception when others then perform _test_helpers.record('TEST 31', 'diacritice', 'ERROR', SQLERRM, expected, '');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SECȚIUNEA E — FORBIDDEN COMMANDS (test 32)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 32: generator NICIODATĂ nu emite POS^
do $$
declare r uuid; p uuid; o uuid; actual text;
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 10, 1);
  o := _test_helpers.mk_order(r, 'cash', 10);
  perform _test_helpers.add_item(o, p, 'X', 10, 1, 10);
  actual := public.build_fiscalnet_payload(o);
  if actual like '%POS^%' then
    perform _test_helpers.record('TEST 32', 'NO POS^ ever', 'FAIL', actual, '<no POS^>',
      'CRITICAL: generator emite POS^ care e out-of-scope pilot fiscal!');
  else
    perform _test_helpers.record('TEST 32', 'NO POS^ ever', 'PASS', actual, '<no POS^>', '');
  end if;
exception when others then perform _test_helpers.record('TEST 32', 'POS^', 'ERROR', SQLERRM, '', '');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SECȚIUNEA F — SCENARII COMPLEXE (tests 33-35)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 33: order cu modifiers — item_total include delta-urile, dar
-- payload-ul folosește doar product_name_snapshot. Modifierii sunt invizibili
-- pe bon.
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- Cafea 8 RON + lapte extra 2 RON + zahăr extra 1 RON = item_total 11
  -- Payload: S^Cafea^1100^1000^buc^1^1 — NU menționează lapte/zahăr
  expected text := E'S^Cafea^1100^1000^buc^1^1\nST^\nP^1^1100';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 8, 1);
  o := _test_helpers.mk_order(r, 'cash', 11);
  insert into public.order_items(order_id, product_id, product_name_snapshot,
    unit_price_snapshot, quantity, item_total, selected_modifiers)
    values (o, p, 'Cafea', 8, 1, 11,
            '[{"option_name":"+lapte","price_delta":2},{"option_name":"+zahăr","price_delta":1}]'::jsonb);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 33', 'order cu modifiers (silent în payload)', expected, actual,
    'OBSERVAȚIE: modifierii afectează prețul (item_total include delta) DAR numele și deltele NU apar în bon. Posibil OK din POV ANAF (totalul e corect) dar nu vede clientul "ce a luat extra".');
exception when others then perform _test_helpers.record('TEST 33', 'modifiers', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 34: happy hour discount aplicat — discount_type='percent', value=10
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- Item 100 RON, discount 10% → DP^1000 (10*100), total = 90 RON
  expected text := E'S^X^10000^1000^buc^1^1\nST^\nDP^1000\nP^1^9000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 100, 1);
  o := _test_helpers.mk_order(r, 'cash', 90, 'percent', 10);
  perform _test_helpers.add_item(o, p, 'X', 100, 1, 100);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 34', 'discount procent 10%', expected, actual);
exception when others then perform _test_helpers.record('TEST 34', 'discount %', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 34b: discount sumă fixă DV^
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- Item 100 RON, discount 5 RON → DV^500
  expected text := E'S^X^10000^1000^buc^1^1\nST^\nDV^500\nP^1^9500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 100, 1);
  o := _test_helpers.mk_order(r, 'cash', 95, 'amount', 5);
  perform _test_helpers.add_item(o, p, 'X', 100, 1, 100);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 34b', 'discount sumă fixă 5 RON', expected, actual);
exception when others then perform _test_helpers.record('TEST 34b', 'discount sum', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 35: split bill între clienți — IMPOSIBIL la nivel de generator
do $$ begin
  perform _test_helpers.record('TEST 35', 'split bill între 2-3 clienți', 'TODO',
    NULL, NULL,
    'BUG #4 — generator emite UN singur P^ pentru întregul order. order_payments.tabela există (vezi migration_032) DAR nu e citită aici. Split bill = bon fiscal monolit cu doar o metodă plată.');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- BONUS — tips_amount (BUG #3 din audit)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 36 (bonus): tips_amount NU intră în P^
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- Item 50 RON, tips 5 RON, paid 55 RON. v_order.total = 50 (nu include tips).
  -- Payload: P^1^5000 — tips NU intră.
  expected text := E'S^X^5000^1000^buc^1^1\nST^\nP^1^5000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 50, 1);
  o := _test_helpers.mk_order(r, 'cash', 50);
  update public.orders set tips_amount = 5, paid_amount = 55 where id = o;
  perform _test_helpers.add_item(o, p, 'X', 50, 1, 50);
  actual := public.build_fiscalnet_payload(o);
  if actual = expected then
    perform _test_helpers.record('TEST 36', 'tips_amount NU intră în bon', 'FAIL',
      actual, '<should include tips: P^1^5500>',
      'BUG #3 — tips_amount (din migration_043) NU e select-uit. Casa de marcat NU înregistrează bacșișul. Risk: ANAF poate considera că restaurantul a încasat 55 dar a emis bon pentru 50 → diferență neînregistrată.');
  else
    perform _test_helpers.record('TEST 36', 'tips_amount în bon', 'PASS', actual, expected,
      'Generator include tips în total.');
  end if;
exception when others then perform _test_helpers.record('TEST 36', 'tips', 'ERROR', SQLERRM, expected, '');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- BONUS — payment method 'other' → cod fiscal 8
-- ════════════════════════════════════════════════════════════════════════

-- TEST 37: payment 'other' → cod 8
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^1000^1000^buc^1^1\nST^\nP^8^1000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 10, 1);
  o := _test_helpers.mk_order(r, 'other', 10);
  perform _test_helpers.add_item(o, p, 'X', 10, 1, 10);
  actual := public.build_fiscalnet_payload(o);
  perform _test_helpers.assert_eq('TEST 37', 'payment other → code 8', expected, actual);
exception when others then perform _test_helpers.record('TEST 37', 'payment other', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 38: tichete masă (cod 4) și tichete valorice (cod 5) — IMPOSIBIL
do $$ begin
  perform _test_helpers.record('TEST 38', 'tichete masă/valorice', 'TODO',
    NULL, NULL,
    'BUG #9 — payment_method enum nu include "ticket_meal" / "voucher". fiscalnet_payment_code() are doar 3 mapări (cash, card_pos, other). Codurile 3 (Credit), 4 (Tichet masă), 5 (Tichet valoric), 6 (Voucher), 7 (Plată modernă) sunt indisponibile.');
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- BONUS — order inexistent
-- ════════════════════════════════════════════════════════════════════════

-- TEST 39: order_id care nu există
do $$
declare actual text;
begin
  begin
    actual := public.build_fiscalnet_payload(gen_random_uuid());
    perform _test_helpers.record('TEST 39', 'order_id inexistent', 'FAIL',
      actual, '<should raise: not found>', '');
  exception when others then
    perform _test_helpers.record('TEST 39', 'order_id inexistent → raise', 'PASS',
      SQLERRM, '<exception>', 'OK: "Order % not found" raised.');
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- BUG #4 FIX VERIFICATION — split payment (migration_051)
-- ════════════════════════════════════════════════════════════════════════

-- TEST 40: split 2-way cash 30 + card_pos 20 pe order de 50 RON
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^Burger^5000^1000^buc^1^1\nST^\nP^1^3000\nP^2^2000';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Burger', 50, 1);
  o := _test_helpers.mk_order(r, 'cash', 50);
  perform _test_helpers.add_item(o, p, 'Burger', 50, 1, 50);
  insert into public.order_payments(order_id, method, amount, created_at)
    values (o, 'cash', 30, now()), (o, 'card_pos', 20, now() + interval '1 ms');
  actual := public.build_fiscalnet_payload(o);
  if actual = expected then
    perform _test_helpers.record('TEST 40', 'split 2-way cash+card (BUG #4 fix)', 'PASS',
      actual, expected, 'OK: generator emite P^ per row order_payments.');
  else
    perform _test_helpers.record('TEST 40', 'split 2-way', 'FAIL', actual, expected, '');
  end if;
exception when others then perform _test_helpers.record('TEST 40', 'split 2-way', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 41: split 3-way (cash 10 + card 25 + other 15) pe order 50
do $$
declare r uuid; p uuid; o uuid; actual text;
  expected text := E'S^X^5000^1000^buc^1^1\nST^\nP^1^1000\nP^2^2500\nP^8^1500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 50, 1);
  o := _test_helpers.mk_order(r, 'cash', 50);
  perform _test_helpers.add_item(o, p, 'X', 50, 1, 50);
  insert into public.order_payments(order_id, method, amount, created_at)
    values (o, 'cash',     10, now()),
           (o, 'card_pos', 25, now() + interval '1 ms'),
           (o, 'other',    15, now() + interval '2 ms');
  actual := public.build_fiscalnet_payload(o);
  if actual = expected then
    perform _test_helpers.record('TEST 41', 'split 3-way (cash+card+other)', 'PASS',
      actual, expected, 'OK: 3 P^ în ordinea created_at.');
  else
    perform _test_helpers.record('TEST 41', 'split 3-way', 'FAIL', actual, expected, '');
  end if;
exception when others then perform _test_helpers.record('TEST 41', 'split 3-way', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 42: split fără rows → fallback la single P^ cu tips (BUG #3 behavior preserved)
do $$
declare r uuid; p uuid; o uuid; actual text;
  -- 40 RON + 5 tips → P^1^4500 (single, tips inclus). Niciun row în order_payments.
  expected text := E'S^X^4000^1000^buc^1^1\nST^\nP^1^4500';
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'X', 40, 1);
  o := _test_helpers.mk_order(r, 'cash', 40);
  update public.orders set tips_amount = 5 where id = o;
  perform _test_helpers.add_item(o, p, 'X', 40, 1, 40);
  actual := public.build_fiscalnet_payload(o);
  if actual = expected then
    perform _test_helpers.record('TEST 42', 'fallback fără split: single P^ cu tips', 'PASS',
      actual, expected, 'OK: fallback la comportament migration_050 când lipsesc order_payments.');
  else
    perform _test_helpers.record('TEST 42', 'fallback', 'FAIL', actual, expected, '');
  end if;
exception when others then perform _test_helpers.record('TEST 42', 'fallback', 'ERROR', SQLERRM, expected, '');
end $$;

-- TEST 43: BUG #6 fix verification — item cu unit_price = 0 → RAISE
-- (TEST 22 deja verifică acest path; aici testez exact că eroarea conține
--  marker "BUG #6 guard" ca să confirmăm că noul guard din migration_051 trage.)
do $$
declare r uuid; p uuid; o uuid; actual text;
begin
  r := _test_helpers.mk_restaurant();
  p := _test_helpers.mk_product(r, 'Free', 0, 1);
  o := _test_helpers.mk_order(r, 'cash', 0);
  perform _test_helpers.add_item(o, p, 'Free', 0, 1, 0);
  begin
    actual := public.build_fiscalnet_payload(o);
    perform _test_helpers.record('TEST 43', 'guard BUG #6 (price 0)', 'FAIL',
      actual, '<should raise BUG #6 guard>', '');
  exception when others then
    if SQLERRM like '%BUG #6 guard%' then
      perform _test_helpers.record('TEST 43', 'guard BUG #6 mesaj explicit', 'PASS',
        SQLERRM, 'BUG #6 guard', 'OK: eroarea conține marker-ul explicit pentru debug.');
    else
      perform _test_helpers.record('TEST 43', 'guard BUG #6 mesaj generic', 'FAIL',
        SQLERRM, '<should mention BUG #6 guard>', 'Guard a tras dar mesajul nu e diagnostic.');
    end if;
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SUMMARY
-- ════════════════════════════════════════════════════════════════════════

\echo ''
\echo '════════════════════════════════════════════════════════════════════════'
\echo 'BUILD_FISCALNET_PAYLOAD — TEST SUITE RESULTS'
\echo '════════════════════════════════════════════════════════════════════════'
\echo ''

select status, count(*) as count
from _test_results
group by status
order by case status
  when 'PASS' then 1 when 'FAIL' then 2 when 'ERROR' then 3
  when 'SKIP' then 4 when 'TODO' then 5
end;

\echo ''
\echo '── DETAILS ──────────────────────────────────────────────────────────────'

select test_id, status, description from _test_results order by ord;

\echo ''
\echo '── BUG-URI / OBSERVAȚII (FAIL + TODO + SKIP + ERROR cu mesaj scurt) ─────'

select test_id, status, description, coalesce(notes, '<no notes>') as notes,
       case when status='ERROR' then left(actual, 200) else null end as error_msg
from _test_results
where status in ('FAIL', 'TODO', 'SKIP', 'ERROR')
order by ord;
