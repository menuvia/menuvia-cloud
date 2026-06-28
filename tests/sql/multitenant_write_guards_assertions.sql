-- ═══════════════════════════════════════════════════════════════
-- Multi-tenant write guards — mig 161 (P2 round-5)
-- ═══════════════════════════════════════════════════════════════
--   MT1 — order_items: INSERT/DELETE revocate pentru authenticated (#A);
--   MT2 — recipes: product A + ingredient B → respins (#B); same-tenant → OK;
--   MT3 — waiter_table_assignments: table/user din alt restaurant → respins (#C);
--   MT4 — purchase_orders: supplier din alt restaurant → respins (#D); same-tenant → OK.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_ua uuid := 'b1111111-2222-3333-4444-555555555501'::uuid;
  v_ub uuid := 'b1111111-2222-3333-4444-555555555502'::uuid;
  v_ra uuid := 'b1111111-2222-3333-4444-5555555555a1'::uuid;
  v_rb uuid := 'b1111111-2222-3333-4444-5555555555a2'::uuid;
  v_pa uuid; v_pb uuid; v_ia uuid; v_ib uuid; v_sa uuid; v_sb uuid;
  v_tb uuid;  -- masa restaurant B
  v_blocked boolean;
begin
  -- MT1: privilege check
  if has_table_privilege('authenticated','public.order_items','INSERT')
     or has_table_privilege('authenticated','public.order_items','DELETE') then
    raise exception 'MT1 FAIL: authenticated inca are INSERT/DELETE pe order_items';
  end if;
  raise notice 'MT1 PASS: order_items INSERT/DELETE revocate pentru authenticated (#A)';

  insert into auth.users (id, email) values (v_ua,'mt-a@menuvia.ro'),(v_ub,'mt-b@menuvia.ro');
  update public.profiles set plan='growth' where id in (v_ua, v_ub);
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    (v_ra, v_ua, 'MT A', 'mt-a-slug', 'Cluj', true),
    (v_rb, v_ub, 'MT B', 'mt-b-slug', 'Cluj', true);
  insert into public.products (restaurant_id, name, price, is_active) values (v_ra,'PA',10,true) returning id into v_pa;
  insert into public.products (restaurant_id, name, price, is_active) values (v_rb,'PB',10,true) returning id into v_pb;
  insert into public.ingredients (restaurant_id, name, unit) values (v_ra,'IA','kg') returning id into v_ia;
  insert into public.ingredients (restaurant_id, name, unit) values (v_rb,'IB','kg') returning id into v_ib;
  insert into public.suppliers (restaurant_id, name) values (v_ra,'SA') returning id into v_sa;
  insert into public.suppliers (restaurant_id, name) values (v_rb,'SB') returning id into v_sb;
  insert into public.tables (restaurant_id, name, slug, is_active) values (v_rb,'MasaB','mt-b-1',true) returning id into v_tb;

  -- MT2: recipes cross-tenant
  v_blocked := false;
  begin
    insert into public.recipes (product_id, ingredient_id, quantity) values (v_pa, v_ib, 1);
  exception when others then if sqlerrm like '%acelasi restaurant%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'MT2 FAIL: recipe cross-tenant acceptat (#B)'; end if;
  insert into public.recipes (product_id, ingredient_id, quantity) values (v_pa, v_ia, 1);  -- same-tenant OK
  raise notice 'MT2 PASS: recipes same-tenant impus (#B)';

  -- MT3: wta cross-tenant (masa B + user oarecare pe restaurant A)
  v_blocked := false;
  begin
    insert into public.waiter_table_assignments (restaurant_id, table_id, user_id) values (v_ra, v_tb, v_ua);
  exception when others then if sqlerrm like '%nu apartine%' or sqlerrm like '%not member%' or sqlerrm like '%nu e membru%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'MT3 FAIL: wta cross-tenant table acceptat (#C)'; end if;
  raise notice 'MT3 PASS: wta tenancy table/user impusa (#C)';

  -- MT4: purchase_orders supplier cross-tenant
  v_blocked := false;
  begin
    insert into public.purchase_orders (restaurant_id, supplier_id) values (v_ra, v_sb);
  exception when others then if sqlerrm like '%nu apartine%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'MT4 FAIL: PO supplier cross-tenant acceptat (#D)'; end if;
  insert into public.purchase_orders (restaurant_id, supplier_id) values (v_ra, v_sa);  -- same-tenant OK
  raise notice 'MT4 PASS: PO supplier same-tenant impus (#D)';

  raise notice 'ALL PASS';
end$$;

rollback;
