-- tests/sql/stock_deduction_assertions.sql
-- =============================================================================
-- Aserții pentru mig 250 — deduct_stock_on_order_paid deduce la intrarea în
-- ('paid','closed'), nu doar 'paid':
--   SD1  comandă growth (→'closed', fără fiscal) → ingredientul scade.
--   SD2  comandă pro (→'paid') → ingredientul scade.
--   SD3  re-intrarea în starea terminală pe plan fiscal (paid→served→paid) NU
--        mai scade a doua oară (anti dublă, backstop mig 252).
--   SD4  re-intrarea closed→served→closed pe growth NU dublează.
--
-- Planul OWNER-ului se comută per scenariu, fiindcă cele două stări terminale
-- aparțin unor planuri diferite: `closed` e finalul pe growth (Plan 2), `paid`
-- e finalul pe planurile cu bon. Din mig 264, `trg_orders_closed_fiscal_gate`
-- RESPINGE →'closed' pe planurile fiscale, deci un test care închidea o comandă
-- enterprise modela o stare imposibilă în producție (se contrazicea și cu
-- propriul comentariu „growth, fără fiscal").
--
-- Self-contained, ROLLBACK la final. Trigger-ul e `after update of status`.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('5d000000-0000-4000-8000-0000000000a0','sd-owner@sd.test');
update public.profiles set plan = 'enterprise'
 where id = '5d000000-0000-4000-8000-0000000000a0';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('5d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-0000000000a0',
   'SD Bistro','sd-bistro-slug','Cluj',true);

insert into public.products (id, restaurant_id, name, price, is_active)
values ('5d000000-0000-4000-8000-0000000000b0','5d000000-0000-4000-8000-000000000001',
        'Produs SD', 20, true);

-- Ingredient cu stoc 100, rețetă: produsul consumă 2 unități/bucată.
insert into public.ingredients (id, restaurant_id, name, unit, current_stock, cost_per_unit)
values ('5d000000-0000-4000-8000-0000000000c0','5d000000-0000-4000-8000-000000000001',
        'Faina SD','kg',100,5);
insert into public.recipes (product_id, ingredient_id, quantity)
values ('5d000000-0000-4000-8000-0000000000b0','5d000000-0000-4000-8000-0000000000c0',2);

-- ── SD1: comandă growth (→'closed', fără trecere prin 'paid') scade stocul ────
update public.profiles set plan = 'growth' where id = '5d000000-0000-4000-8000-0000000000a0';
do $$
declare v_stock numeric;
begin
  insert into public.orders (id, restaurant_id, source, status)
  values ('5d000000-0000-4000-8000-0000000000d1','5d000000-0000-4000-8000-000000000001','waiter','new');
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values ('5d000000-0000-4000-8000-0000000000d1','5d000000-0000-4000-8000-0000000000b0','Produs SD',3,20,60);

  update public.orders set status = 'closed' where id = '5d000000-0000-4000-8000-0000000000d1';

  select current_stock into v_stock from public.ingredients where id='5d000000-0000-4000-8000-0000000000c0';
  -- 100 - 2*3 = 94
  if v_stock <> 94 then
    raise exception 'SD1 FAIL: după →closed stoc=% (așteptat 94 — growth nu scădea deloc înainte)', v_stock;
  end if;
  raise notice 'SD1 OK: comandă →closed scade stocul (94)';
end $$;

-- ── SD2 + SD3: comandă pe plan fiscal →'paid' scade; re-intrarea NU dublează ──
update public.profiles set plan = 'enterprise' where id = '5d000000-0000-4000-8000-0000000000a0';
do $$
declare v_stock numeric;
begin
  insert into public.orders (id, restaurant_id, source, status)
  values ('5d000000-0000-4000-8000-0000000000d2','5d000000-0000-4000-8000-000000000001','waiter','new');
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values ('5d000000-0000-4000-8000-0000000000d2','5d000000-0000-4000-8000-0000000000b0','Produs SD',2,20,40);

  -- →paid (enterprise are fiscal_receipt, deci gate-ul din mig 124 permite)
  update public.orders set status = 'paid', paid_at = now() where id = '5d000000-0000-4000-8000-0000000000d2';
  select current_stock into v_stock from public.ingredients where id='5d000000-0000-4000-8000-0000000000c0';
  -- 94 - 2*2 = 90
  if v_stock <> 90 then
    raise exception 'SD2 FAIL: după →paid stoc=% (așteptat 90)', v_stock;
  end if;

  -- Re-intrare în starea terminală pe plan fiscal: paid→served→paid prin UPDATE
  -- direct (owner care „corectează" o comandă). A doua tranziție are OLD='served',
  -- deci guard-ul de status NU o oprește — se bazează pe tabela-claim din mig 252.
  -- (Vechiul paid→closed testa o tranziție pe care mig 264 o interzice acum pe
  -- planurile fiscale; gate-ul e verificat separat de AC3.)
  update public.orders set status = 'served' where id = '5d000000-0000-4000-8000-0000000000d2';
  update public.orders set status = 'paid', paid_at = now() where id = '5d000000-0000-4000-8000-0000000000d2';
  select current_stock into v_stock from public.ingredients where id='5d000000-0000-4000-8000-0000000000c0';
  if v_stock <> 90 then
    raise exception 'SD3 FAIL: re-intrarea în paid a dedus DIN NOU stoc=% (așteptat 90 — dublă scădere)', v_stock;
  end if;
  raise notice 'SD2+SD3 OK: →paid scade (90), re-intrarea în paid nu dublează';
end $$;

-- ── SD4 (mig 252): re-intrare closed→served→closed NU dublează (backstop DB) ──
update public.profiles set plan = 'growth' where id = '5d000000-0000-4000-8000-0000000000a0';
do $$
declare v_before numeric; v_after numeric;
begin
  insert into public.orders (id, restaurant_id, source, status)
  values ('5d000000-0000-4000-8000-0000000000d4','5d000000-0000-4000-8000-000000000001','waiter','new');
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values ('5d000000-0000-4000-8000-0000000000d4','5d000000-0000-4000-8000-0000000000b0','Produs SD',1,20,20);

  update public.orders set status = 'closed' where id = '5d000000-0000-4000-8000-0000000000d4';
  select current_stock into v_before from public.ingredients where id='5d000000-0000-4000-8000-0000000000c0';

  -- Re-intrare prin UPDATE DIRECT (ocolind advance_order), ca un owner care
  -- „corectează" o comandă închisă: served (non-terminal) apoi iar closed.
  update public.orders set status = 'served' where id = '5d000000-0000-4000-8000-0000000000d4';
  update public.orders set status = 'closed' where id = '5d000000-0000-4000-8000-0000000000d4';
  select current_stock into v_after from public.ingredients where id='5d000000-0000-4000-8000-0000000000c0';

  if v_after <> v_before then
    raise exception 'SD4 FAIL: re-intrarea closed→served→closed a dedus DIN NOU (before=%, after=% — backstop mig 252 lipsă)', v_before, v_after;
  end if;
  raise notice 'SD4 OK: backstop DB (mig 252) — re-intrarea nu dublează deducerea';
end $$;

rollback;
