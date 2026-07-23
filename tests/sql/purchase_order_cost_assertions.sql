-- tests/sql/purchase_order_cost_assertions.sql
-- =============================================================================
-- Aserții pentru mig 251 — receive_purchase_order calculează un cost mediu
-- robust chiar și pe stoc NEGATIV (supra-vânzare growth, mig 250):
--   PC1  recepție pe stoc pozitiv → medie ponderată corectă (WAC clasic).
--   PC2  recepție pe stoc NEGATIV → costul devine prețul livrării (nu WAC
--        negativ care ar încălca CHECK-ul cost_per_unit >= 0 și ar bloca NIR-ul).
--   PC3  recepția reușește (status→'received') pe stoc negativ — înainte de
--        mig 251 arunca și lăsa PO-ul blocat în 'draft'.
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('9c000000-0000-4000-8000-0000000000a0','pc-owner@pc.test');
update public.profiles set plan = 'enterprise'
 where id = '9c000000-0000-4000-8000-0000000000a0';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-0000000000a0',
   'PC Bistro','pc-bistro-slug','Cluj',true);

-- Owner membership (is_admin trece prin restaurant_memberships)
insert into public.restaurant_memberships (restaurant_id, user_id, role)
values ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-0000000000a0','owner')
on conflict do nothing;

-- Rulăm ca owner-ul: is_admin(restaurant) în RPC citește auth.uid() din GUC.
-- Rămânem pe rolul superuser (seed-ul ocolește RLS); doar sub-ul contează pentru RPC.
set local request.jwt.claim.sub = '9c000000-0000-4000-8000-0000000000a0';
set local request.jwt.claim.role = 'authenticated';

-- ── PC1: stoc pozitiv → WAC clasic ──────────────────────────────────────────
-- Ingredient: stoc 10 @ cost 4. Recepție 10 @ 6 → (10*4 + 10*6)/20 = 5.
do $$
declare v_cost numeric;
begin
  insert into public.ingredients (id, restaurant_id, name, unit, current_stock, cost_per_unit)
  values ('9c000000-0000-4000-8000-0000000000c1','9c000000-0000-4000-8000-000000000001',
          'Faina PC1','kg',10,4);

  insert into public.purchase_orders (id, restaurant_id, status)
  values ('9c000000-0000-4000-8000-0000000000e1','9c000000-0000-4000-8000-000000000001','draft');
  insert into public.purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_price, line_total)
  values ('9c000000-0000-4000-8000-0000000000e1','9c000000-0000-4000-8000-0000000000c1',10,6,60);

  perform public.receive_purchase_order('9c000000-0000-4000-8000-0000000000e1');

  select cost_per_unit into v_cost from public.ingredients where id='9c000000-0000-4000-8000-0000000000c1';
  if v_cost <> 5 then
    raise exception 'PC1 FAIL: WAC=% (așteptat 5)', v_cost;
  end if;
  raise notice 'PC1 OK: WAC clasic pe stoc pozitiv (5)';
end $$;

-- ── PC2 + PC3: stoc NEGATIV → cost = prețul livrării, recepția reușește ──────
-- Ingredient: stoc -5 @ cost 4 (supra-vânzare). Recepție 2 @ 9.
-- WAC vechi = (-5*4 + 2*9)/(-5+2) = (-20+18)/(-3) = -2/-3 ≈ 0.67 (aici pozitiv),
-- dar cazul periculos: recepție 2 @ 20 → (-20+40)/(-3) = 20/-3 ≈ -6.67 < 0 → CHECK.
-- Verificăm ramura robustă: costul devine unit_price (9), fără WAC negativ.
do $$
declare v_cost numeric; v_status text; v_stock numeric;
begin
  insert into public.ingredients (id, restaurant_id, name, unit, current_stock, cost_per_unit)
  values ('9c000000-0000-4000-8000-0000000000c2','9c000000-0000-4000-8000-000000000001',
          'Faina PC2','kg',-5,4);

  insert into public.purchase_orders (id, restaurant_id, status)
  values ('9c000000-0000-4000-8000-0000000000e2','9c000000-0000-4000-8000-000000000001','draft');
  -- preț mare intenționat: cu formula veche numitorul negativ ar da WAC negativ
  insert into public.purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_price, line_total)
  values ('9c000000-0000-4000-8000-0000000000e2','9c000000-0000-4000-8000-0000000000c2',2,20,40);

  -- PC3: nu trebuie să arunce (înainte de mig 251 arunca pe CHECK)
  perform public.receive_purchase_order('9c000000-0000-4000-8000-0000000000e2');

  select cost_per_unit, current_stock into v_cost, v_stock
    from public.ingredients where id='9c000000-0000-4000-8000-0000000000c2';
  if v_cost <> 20 then
    raise exception 'PC2 FAIL: cost pe stoc negativ=% (așteptat 20 = prețul livrării)', v_cost;
  end if;
  if v_stock <> -3 then
    raise exception 'PC2 FAIL: stoc după recepție=% (așteptat -3)', v_stock;
  end if;

  select status into v_status from public.purchase_orders where id='9c000000-0000-4000-8000-0000000000e2';
  if v_status <> 'received' then
    raise exception 'PC3 FAIL: PO status=% (așteptat received — recepția a eșuat)', v_status;
  end if;
  raise notice 'PC2+PC3 OK: cost=prețul livrării pe stoc negativ (20), recepția reușește';
end $$;

rollback;
