-- tests/sql/happy_hour_auto_apply_assertions.sql
-- =============================================================================
-- Asserții permanente pentru invariantul de BANI „Happy Hour se aplică
-- SERVER-side" (`trg_apply_happy_hour_auto`, mig 077 — constraint trigger
-- DEFERRED la COMMIT; re-evaluare la editare în `update_order_items`, mig 192).
-- Audit v3 RES-34: trigger-ul era corect, dar nimic nu-l exersa — întăririle
-- 137/157/163 verifică FORMA regulilor, nu EFECTUL pe comandă.
--
--   HH0  structural: trigger DEFERRABLE INITIALLY DEFERRED, AFTER INSERT ROW.
--   HH1  QR, scope=all, 10%: răspunsul lui create_order poartă totalul
--        PRE-discount (contractul mig 191, documentat în CLAUDE.md), iar după
--        COMMIT rândul are discount 'amount' 2.40 și total 21.60.
--   HH2  comanda de OSPĂTAR nu primește Happy Hour (guard pe sursă).
--   HH3  comanda PICKUP primește (al doilea literal din guard).
--   HH4  scope=category + max_discount + alegerea celei mai BUNE reguli.
--   HH5  reducerea MANUALĂ nu e suprascrisă.
--   HH6  regulă inactivă / zi greșită → fără reducere.
--   HH7  editarea (update_order_items) re-evaluează: mai multe bucăți → discount
--        recalculat; regula dezactivată → discount-ul dispare.
--
-- CAPCANĂ: `set constraints all immediate` se pune DUPĂ create_order (trage
-- trigger-ul DEFERRED în interiorul tranzacției de test), apoi se revine la
-- `deferred` ÎNAINTE de următoarea comandă — altfel trigger-ul trage pe
-- INSERT-ul din create_order, înaintea itemilor (subtotal 0 → fără reducere).
-- Regula e activă indiferent de ora runner-ului: 00:00–24:00, toate zilele.
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('72000000-0000-4000-8000-000000000001', 'hh-owner@hh.test');
update public.profiles set plan = 'growth' where id = '72000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active, pickup_settings) values
  ('72b00000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'HH Bistro', 'hh-bistro', 'Cluj', true,
   '{"enabled": true, "min_lead_time_minutes": 20}'::jsonb);

-- Patru mese/token-uri: rate-limit-ul QR per masă (mig 090) ar respinge a
-- treia comandă în 2 minute pe aceeași masă — fiecare comandă QR are masa ei.
insert into public.tables (id, restaurant_id, name, slug, is_active, seats) values
  ('72c00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001', 'Masa HH 1', 'masa-hh-1', true, 4),
  ('72c00000-0000-4000-8000-000000000002', '72b00000-0000-4000-8000-000000000001', 'Masa HH 2', 'masa-hh-2', true, 4),
  ('72c00000-0000-4000-8000-000000000003', '72b00000-0000-4000-8000-000000000001', 'Masa HH 3', 'masa-hh-3', true, 4),
  ('72c00000-0000-4000-8000-000000000004', '72b00000-0000-4000-8000-000000000001', 'Masa HH 4', 'masa-hh-4', true, 4);
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('72d00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001', '72c00000-0000-4000-8000-000000000001', 'tok_hh_auto1', true),
  ('72d00000-0000-4000-8000-000000000002', '72b00000-0000-4000-8000-000000000001', '72c00000-0000-4000-8000-000000000002', 'tok_hh_auto2', true),
  ('72d00000-0000-4000-8000-000000000003', '72b00000-0000-4000-8000-000000000001', '72c00000-0000-4000-8000-000000000003', 'tok_hh_auto3', true),
  ('72d00000-0000-4000-8000-000000000004', '72b00000-0000-4000-8000-000000000001', '72c00000-0000-4000-8000-000000000004', 'tok_hh_auto4', true);

insert into public.categories (id, restaurant_id, name) values
  ('72e00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001', 'HH Cafele'),
  ('72e00000-0000-4000-8000-000000000002', '72b00000-0000-4000-8000-000000000001', 'HH Ape');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('72f00000-0000-4000-8000-000000000001', '72b00000-0000-4000-8000-000000000001',
   '72e00000-0000-4000-8000-000000000001', 'HH Cafea', 12.00, 1, true, false),
  ('72f00000-0000-4000-8000-000000000002', '72b00000-0000-4000-8000-000000000001',
   '72e00000-0000-4000-8000-000000000002', 'HH Apa', 5.00, 1, true, false);

-- Regula A: 10% pe tot, mereu activă (00:00–24:00, toate zilele).
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, discount_type, discount_value) values
  ('72a00000-0000-4000-8000-00000000000a', '72b00000-0000-4000-8000-000000000001', 'HH Regula A',
   true, '00:00:00', '24:00:00', array[]::smallint[], 'all', 'percent', 10);

-- ── HH0: forma trigger-ului ───────────────────────────────────────────────────
do $$
declare t record;
begin
  select tgtype, tgdeferrable, tginitdeferred, tgfoid::regproc::text as fn into t
    from pg_trigger
   where tgname = 'trg_apply_happy_hour_auto'
     and tgrelid = 'public.orders'::regclass and not tgisinternal;
  if t is null then raise exception 'HH0 FAIL: trg_apply_happy_hour_auto lipsește de pe orders'; end if;
  if not t.tgdeferrable or not t.tginitdeferred then
    raise exception 'HH0 FAIL: trigger-ul nu e DEFERRABLE INITIALLY DEFERRED — ar trage înaintea itemilor'; end if;
  if (t.tgtype & 1) = 0 or (t.tgtype & 4) = 0 or (t.tgtype & 2) <> 0 then
    raise exception 'HH0 FAIL: trigger-ul trebuie să fie AFTER INSERT FOR EACH ROW (tgtype=%)', t.tgtype; end if;
  if t.fn not like '%_apply_happy_hour_auto%' then
    raise exception 'HH0 FAIL: trigger-ul nu mai cheamă _apply_happy_hour_auto (%)', t.fn; end if;
  raise notice 'HH0 OK: constraint trigger DEFERRED, AFTER INSERT ROW';
end $$;

-- ── HH1: QR + scope=all 10% → răspuns pre-discount, rând post-discount ───────
select set_config('request.jwt.claim.role', 'anon', true);
do $$
declare v_sess jsonb; v_sid uuid; v_res jsonb; v_oid uuid; o record;
begin
  v_sess := public.open_table_session('tok_hh_auto1');
  v_sid  := (v_sess->>'session_id')::uuid;
  v_res := public.create_order(
    '72b00000-0000-4000-8000-000000000001', 'qr',
    '72c00000-0000-4000-8000-000000000001', '72d00000-0000-4000-8000-000000000001', null,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    null, null, null, null, v_sid);
  v_oid := (v_res->>'id')::uuid;
  -- Contractul mig 191: răspunsul poartă totalul PRE-discount (trigger-ul e
  -- DEFERRED, trage la COMMIT). Ancorat aici ca să nu fie „reparat" în două
  -- locuri diferit (OrderTracker afișează prețul întreg — CLAUDE.md).
  if (v_res->>'total')::numeric <> 24.00 then
    raise exception 'HH1 FAIL: create_order a întors % (contractul pre-discount cere 24.00)', v_res->>'total'; end if;

  set constraints all immediate;
  select discount_type::text as dt, discount_value as dv, discount_amount as da, discount_reason as dr, total
    into o from public.orders where id = v_oid;
  if o.dt is distinct from 'amount' or o.dv <> 2.40 or o.da <> 2.40 or coalesce(o.dr, '') not like '%Happy Hour%' then
    raise exception 'HH1 FAIL: reducerea nu s-a aplicat server-side (type=%, value=%, amount=%, reason=%)', o.dt, o.dv, o.da, o.dr; end if;
  if o.total <> 21.60 then
    raise exception 'HH1 FAIL: totalul nu e post-discount (% — așteptat 21.60)', o.total; end if;
  perform set_config('hh.oid1', v_oid::text, true);
  raise notice 'HH1 OK: QR 24.00 → 21.60 (10%% server-side), răspuns pre-discount';
end $$;
set constraints all deferred;

-- ── HH2: comanda de ospătar NU primește Happy Hour ───────────────────────────
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare v_res jsonb; v_oid uuid; o record;
begin
  v_res := public.create_order(
    '72b00000-0000-4000-8000-000000000001', 'waiter',
    '72c00000-0000-4000-8000-000000000001', '72d00000-0000-4000-8000-000000000001', null,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;
  set constraints all immediate;
  select discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.dr is not null or o.total <> 24.00 then
    raise exception 'HH2 FAIL: comanda de ospătar a primit Happy Hour (reason=%, total=%)', o.dr, o.total; end if;
  raise notice 'HH2 OK: sursa waiter e exclusă';
end $$;
set constraints all deferred;

-- ── HH3: pickup primește Happy Hour ──────────────────────────────────────────
select set_config('request.jwt.claim.role', 'anon', true);
do $$
declare v_res jsonb; v_oid uuid; o record;
begin
  v_res := public.create_order(
    '72b00000-0000-4000-8000-000000000001', 'pickup', null, null, null,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    null, now() + interval '40 minutes', 'Ion HH', '0722000111', null);
  v_oid := (v_res->>'id')::uuid;
  set constraints all immediate;
  select discount_reason as dr, total into o from public.orders where id = v_oid;
  if coalesce(o.dr, '') not like '%Happy Hour%' or o.total <> 21.60 then
    raise exception 'HH3 FAIL: comanda pickup nu a primit Happy Hour (reason=%, total=%)', o.dr, o.total; end if;
  raise notice 'HH3 OK: sursa pickup primește reducerea';
end $$;
set constraints all deferred;

-- ── HH4: scope=category + cap + cea mai bună regulă ──────────────────────────
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, category_id, discount_type, discount_value, max_discount) values
  ('72a00000-0000-4000-8000-00000000000b', '72b00000-0000-4000-8000-000000000001', 'HH Regula B',
   true, '00:00:00', '24:00:00', array[]::smallint[], 'category',
   '72e00000-0000-4000-8000-000000000001', 'percent', 50, 5.00);
do $$
declare v_sess jsonb; v_sid uuid; v_res jsonb; v_oid uuid; o record;
begin
  v_sess := public.open_table_session('tok_hh_auto2');
  v_sid  := (v_sess->>'session_id')::uuid;
  -- Cafea×2 (cat A, 24) + Apa×1 (cat B, 5) = 29. A: 2.90. B: 12.00 plafonat 5.00 → câștigă B.
  v_res := public.create_order(
    '72b00000-0000-4000-8000-000000000001', 'qr',
    '72c00000-0000-4000-8000-000000000002', '72d00000-0000-4000-8000-000000000002', null,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":2},{"product_id":"72f00000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    null, null, null, null, v_sid);
  v_oid := (v_res->>'id')::uuid;
  set constraints all immediate;
  select discount_amount as da, discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.da <> 5.00 or o.total <> 24.00 or coalesce(o.dr, '') not like '%HH Regula B%' then
    raise exception 'HH4 FAIL: așteptat cap 5.00 pe regula B (amount=%, total=%, reason=%)', o.da, o.total, o.dr; end if;
  raise notice 'HH4 OK: scope category, max_discount 5.00, regula cea mai bună';
end $$;
set constraints all deferred;

-- ── HH5: reducerea manuală NU e suprascrisă ──────────────────────────────────
do $$
declare v_oid uuid := '72900000-0000-4000-8000-000000000005'; o record;
begin
  insert into public.orders (id, restaurant_id, source, status, total, discount_type, discount_value, discount_reason,
                             customer_name, customer_phone, pickup_time)
    values (v_oid, '72b00000-0000-4000-8000-000000000001', 'pickup', 'new', 0, 'percent', 5, 'client fidel',
            'Ana HH', '0722000222', now() + interval '1 hour');
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_oid, '72f00000-0000-4000-8000-000000000001', 'HH Cafea', 2, 12, 24);
  set constraints all immediate;
  select discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.dr is distinct from 'client fidel' or o.total <> 22.80 then
    raise exception 'HH5 FAIL: reducerea manuală a fost suprascrisă (reason=%, total=%)', o.dr, o.total; end if;
  raise notice 'HH5 OK: reducerea manuală rămâne (5%% → 22.80)';
end $$;
set constraints all deferred;

-- ── HH6: regulă inactivă / zi greșită → fără reducere ────────────────────────
update public.happy_hour_rules set is_active = false
 where restaurant_id = '72b00000-0000-4000-8000-000000000001';
do $$
declare v_sess jsonb; v_sid uuid; v_res jsonb; v_oid uuid; o record; v_dow smallint; v_wrong smallint;
begin
  v_sess := public.open_table_session('tok_hh_auto3');
  v_sid  := (v_sess->>'session_id')::uuid;
  v_res := public.create_order(
    '72b00000-0000-4000-8000-000000000001', 'qr',
    '72c00000-0000-4000-8000-000000000003', '72d00000-0000-4000-8000-000000000003', null,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    null, null, null, null, v_sid);
  v_oid := (v_res->>'id')::uuid;
  set constraints all immediate;
  select discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.dr is not null or o.total <> 24.00 then
    raise exception 'HH6a FAIL: regula INACTIVĂ a redus comanda (reason=%, total=%)', o.dr, o.total; end if;
  set constraints all deferred;

  -- Zi greșită, cu ACEEAȘI conversie ca mig 077 (isodow 7→1, altfel +1).
  v_dow := extract(isodow from (now() at time zone 'Europe/Bucharest'))::smallint;
  v_dow := case when v_dow = 7 then 1 else v_dow + 1 end;
  v_wrong := (v_dow % 7) + 1;
  update public.happy_hour_rules set is_active = true, days_of_week = array[v_wrong]
   where id = '72a00000-0000-4000-8000-00000000000a';
  v_sess := public.open_table_session('tok_hh_auto4');
  v_sid  := (v_sess->>'session_id')::uuid;
  v_res := public.create_order(
    '72b00000-0000-4000-8000-000000000001', 'qr',
    '72c00000-0000-4000-8000-000000000004', '72d00000-0000-4000-8000-000000000004', null,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    null, null, null, null, v_sid);
  v_oid := (v_res->>'id')::uuid;
  set constraints all immediate;
  select discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.dr is not null or o.total <> 24.00 then
    raise exception 'HH6b FAIL: regula pe ALTĂ zi a redus comanda (reason=%, total=%)', o.dr, o.total; end if;
  raise notice 'HH6 OK: inactivă / zi greșită → fără reducere';
end $$;
set constraints all deferred;

-- ── HH7: editarea re-evaluează (mig 192) ─────────────────────────────────────
update public.happy_hour_rules set is_active = true, days_of_week = array[]::smallint[]
 where id = '72a00000-0000-4000-8000-00000000000a';
update public.happy_hour_rules set is_active = false
 where id = '72a00000-0000-4000-8000-00000000000b';
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare v_oid uuid := current_setting('hh.oid1')::uuid; o record;
begin
  perform public.update_order_items(v_oid,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":3}]'::jsonb, null);
  select discount_value as dv, discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.dv <> 3.60 or o.total <> 32.40 or coalesce(o.dr, '') not like '%Happy Hour%' then
    raise exception 'HH7a FAIL: editarea nu a recalculat reducerea (value=%, total=%, reason=%)', o.dv, o.total, o.dr; end if;

  update public.happy_hour_rules set is_active = false
   where id = '72a00000-0000-4000-8000-00000000000a';
  perform public.update_order_items(v_oid,
    '[{"product_id":"72f00000-0000-4000-8000-000000000001","quantity":3}]'::jsonb, null);
  select discount_type::text as dt, discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.dt is not null or o.dr is not null or o.total <> 36.00 then
    raise exception 'HH7b FAIL: după dezactivarea regulii reducerea a rămas (type=%, reason=%, total=%)', o.dt, o.dr, o.total; end if;
  raise notice 'HH7 OK: editarea re-evaluează Happy Hour (3.60 → 32.40; regulă oprită → 36.00)';
end $$;

rollback;
