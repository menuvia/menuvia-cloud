-- tests/sql/fiscal_enqueue_parity_assertions.sql
-- =============================================================================
-- Aserții pentru mig 259 (paritate INSERT pe enqueue-ul fiscal).
-- Self-contained, ROLLBACK la final.
--
--   FP1  INSERT direct cu status='paid' (permis pe Plan 3 de „orders: admin
--        all") → trigger-ul FIRES: există un rând în pending_receipts pentru
--        comandă (payload sau 'error' vizibil — înainte era TĂCERE totală).
--   FP2  Calea normală (INSERT 'served' + itemi → UPDATE la 'paid') produce
--        exact UN rând 'pending' cu payload real (recrearea n-a stricat UPDATE).
--   FP3  UPDATE 'paid'→'paid' NU dublează rândul (guard-ul TG_OP + idempotența).
--   FP4  INSERT 'paid' FĂRĂ bridge configurat → zero rânduri (skip-ul rămâne).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed: owner pro cu bridge + owner pro FĂRĂ bridge ────────────────────────
insert into auth.users (id, email) values
  ('59000000-0000-4000-8000-000000000001','fp-owner@fp.test'),
  ('59000000-0000-4000-8000-000000000002','fp-owner-nobridge@fp.test');
update public.profiles set plan='pro'
 where id in ('59000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000002');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('59b00000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','FP Bridge','fp-bridge','Cluj',true),
  ('59b00000-0000-4000-8000-000000000002','59000000-0000-4000-8000-000000000002','FP NoBridge','fp-nobridge','Cluj',true);

insert into public.bridge_devices (id, restaurant_id, name, device_secret) values
  ('59e00000-0000-4000-8000-000000000001','59b00000-0000-4000-8000-000000000001','Casa FP','FPSECRET');

-- Produs pentru calea normală (FP2) — itemii cer snapshot de nume/preț.
insert into public.categories (id, restaurant_id, name) values
  ('59c00000-0000-4000-8000-000000000001','59b00000-0000-4000-8000-000000000001','FP Cat');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group) values
  ('59d00000-0000-4000-8000-000000000001','59b00000-0000-4000-8000-000000000001',
   '59c00000-0000-4000-8000-000000000001','FP Cafea',10,1);

-- ── FP1: INSERT direct 'paid' → trigger-ul fires (rând în pending_receipts) ──
do $$
declare v_cnt int;
begin
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount) values
    ('59f00000-0000-4000-8000-000000000001','59b00000-0000-4000-8000-000000000001','waiter','paid',25,25);
  select count(*) into v_cnt from public.pending_receipts
   where order_id = '59f00000-0000-4000-8000-000000000001';
  if v_cnt = 0 then
    raise exception 'FP1 FAIL: INSERT direct paid NU a generat niciun rând fiscal (asimetria mig 259 a revenit)';
  end if;
  raise notice 'FP1 OK: INSERT direct paid → % rând(uri) în coada fiscală (vizibil, nu tăcere)', v_cnt;
end $$;

-- ── FP2: calea normală served→paid produce UN rând pending cu payload real ───
do $$
declare v_cnt int; v_status text; v_payload text;
begin
  insert into public.orders (id, restaurant_id, source, status, total) values
    ('59f00000-0000-4000-8000-000000000002','59b00000-0000-4000-8000-000000000001','waiter','served',10);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values ('59f00000-0000-4000-8000-000000000002','59d00000-0000-4000-8000-000000000001','FP Cafea',1,10,10);

  -- payment_method e obligatoriu pentru payload (build_fiscalnet_payload
  -- aruncă fără el) — fluxurile reale (advance_order/add_partial_payment)
  -- îl setează întotdeauna la plată.
  update public.orders set status='paid', paid_amount=10, paid_at=now(), payment_method='cash'
   where id = '59f00000-0000-4000-8000-000000000002';

  select count(*) into v_cnt from public.pending_receipts
   where order_id = '59f00000-0000-4000-8000-000000000002';
  if v_cnt <> 1 then
    raise exception 'FP2 FAIL: calea served→paid a produs % rânduri (așteptat 1)', v_cnt; end if;
  select status, payload into v_status, v_payload from public.pending_receipts
   where order_id = '59f00000-0000-4000-8000-000000000002';
  if v_status <> 'pending' or length(coalesce(v_payload,'')) = 0 then
    raise exception 'FP2 FAIL: rândul nu e pending cu payload real (status=%, len=%)', v_status, length(coalesce(v_payload,'')); end if;
  raise notice 'FP2 OK: served→paid → exact 1 rând pending cu payload';
end $$;

-- ── FP3: UPDATE paid→paid nu dublează ────────────────────────────────────────
do $$
declare v_cnt int;
begin
  update public.orders set paid_amount = 10
   where id = '59f00000-0000-4000-8000-000000000002';  -- fără schimbare de status
  update public.orders set status = 'paid'
   where id = '59f00000-0000-4000-8000-000000000002';  -- paid→paid explicit
  select count(*) into v_cnt from public.pending_receipts
   where order_id = '59f00000-0000-4000-8000-000000000002';
  if v_cnt <> 1 then
    raise exception 'FP3 FAIL: paid→paid a dublat coada fiscală (% rânduri)', v_cnt; end if;
  raise notice 'FP3 OK: paid→paid nu re-enqueue-uiește';
end $$;

-- ── FP4: fără bridge configurat → skip (zero rânduri) ────────────────────────
do $$
declare v_cnt int;
begin
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount) values
    ('59f00000-0000-4000-8000-000000000003','59b00000-0000-4000-8000-000000000002','waiter','paid',15,15);
  select count(*) into v_cnt from public.pending_receipts
   where order_id = '59f00000-0000-4000-8000-000000000003';
  if v_cnt <> 0 then
    raise exception 'FP4 FAIL: fără bridge s-au creat % rânduri (skip-ul mig 030 a regresat)', v_cnt; end if;
  raise notice 'FP4 OK: fără bridge configurat → zero rânduri (skip păstrat)';
end $$;

select 'FISCAL ENQUEUE PARITY ASSERTIONS: FP1–FP4 PASS' as result;

rollback;
