-- tests/sql/stock_deduction_assertions.sql
-- =============================================================================
-- Aserții pentru mig 250 — deduct_stock_on_order_paid deduce la intrarea în
-- ('paid','closed'), nu doar 'paid':
--   SD1  comandă growth (→'closed', fără fiscal) → ingredientul scade.
--   SD2  comandă pro (→'paid') → ingredientul scade.
--   SD3  aceeași comandă pro →'closed' după 'paid' → NU se mai scade (anti dublă).
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

-- ── SD2 + SD3: comandă pro →'paid' scade; →'closed' după NU dublează ──────────
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

  -- →closed după paid: NU trebuie să mai scadă (OLD deja terminal)
  update public.orders set status = 'closed' where id = '5d000000-0000-4000-8000-0000000000d2';
  select current_stock into v_stock from public.ingredients where id='5d000000-0000-4000-8000-0000000000c0';
  if v_stock <> 90 then
    raise exception 'SD3 FAIL: paid→closed a dedus DIN NOU stoc=% (așteptat 90 — dublă scădere)', v_stock;
  end if;
  raise notice 'SD2+SD3 OK: →paid scade (90), paid→closed nu dublează';
end $$;

rollback;
