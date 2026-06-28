-- ═══════════════════════════════════════════════════════════════
-- BATCH 3 — gates/tenant (migs 154-157)
-- ═══════════════════════════════════════════════════════════════
--   B3-1 (156) product.category_id cross-tenant respins; same-tenant + null OK;
--   B3-2 (157) happy_hour scope=all (null) OK; category cross-tenant respins;
--   B3-3 (155) dezactivarea mesei închide sesiunile deschise;
--   B3-4 (154) save_floor_layout: growth respins (floor_plan), pro OK, oversize respins.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_ua uuid := '91111111-2222-3333-4444-555555555501'::uuid;
  v_ub uuid := '91111111-2222-3333-4444-555555555502'::uuid;
  v_upro uuid := '91111111-2222-3333-4444-555555555503'::uuid;
  v_ugrw uuid := '91111111-2222-3333-4444-555555555504'::uuid;
  v_ra uuid := '91111111-2222-3333-4444-5555555555a1'::uuid;
  v_rb uuid := '91111111-2222-3333-4444-5555555555a2'::uuid;
  v_rp uuid := '91111111-2222-3333-4444-5555555555a3'::uuid;
  v_rg uuid := '91111111-2222-3333-4444-5555555555a4'::uuid;
  v_ca uuid; v_cb uuid;
  v_tbl uuid := '91111111-2222-3333-4444-5555555555b1'::uuid;
  v_sess uuid := '91111111-2222-3333-4444-5555555555c1'::uuid;
  v_blocked boolean;
  v_pid uuid;
  v_open int;
begin
  insert into auth.users (id, email) values
    (v_ua,'b3-a@menuvia.ro'),(v_ub,'b3-b@menuvia.ro'),
    (v_upro,'b3-pro@menuvia.ro'),(v_ugrw,'b3-grw@menuvia.ro');
  update public.profiles set plan='pro' where id=v_upro;
  update public.profiles set plan='growth' where id=v_ugrw;

  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    (v_ra, v_ua, 'B3 A', 'b3-a-slug', 'Cluj', true),
    (v_rb, v_ub, 'B3 B', 'b3-b-slug', 'Cluj', true),
    (v_rp, v_upro, 'B3 Pro', 'b3-pro-slug', 'Cluj', true),
    (v_rg, v_ugrw, 'B3 Grw', 'b3-grw-slug', 'Cluj', true);

  insert into public.categories (restaurant_id, name) values (v_ra,'Cat A') returning id into v_ca;
  insert into public.categories (restaurant_id, name) values (v_rb,'Cat B') returning id into v_cb;

  -- ─── B3-1: product.category_id cross-tenant (156) ──────────────
  v_blocked := false;
  begin
    insert into public.products (restaurant_id, category_id, name, price, is_active)
      values (v_ra, v_cb, 'Prod X', 10.00, true);  -- categoria lui B pe produsul lui A
  exception when others then
    if sqlerrm like '%aparține%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'B3-1 FAIL: product cu categoria altui restaurant acceptat'; end if;
  -- same-tenant + null → OK
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_ra, v_ca, 'Prod OK', 10.00, true) returning id into v_pid;
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_ra, null, 'Prod Null', 10.00, true);
  raise notice 'B3-1 PASS: product.category_id same-tenant impus (#26)';

  -- ─── B3-2: happy_hour tenant (157) ─────────────────────────────
  -- scope=all (null cat/prod) → OK
  insert into public.happy_hour_rules (restaurant_id, name, is_active, starts_at, ends_at, days_of_week, scope, discount_type, discount_value)
    values (v_ra, 'HH all', true, '16:00', '18:00', '{1,2,3,4,5}', 'all', 'percent', 10);
  -- category cross-tenant → respins
  v_blocked := false;
  begin
    insert into public.happy_hour_rules (restaurant_id, name, is_active, starts_at, ends_at, days_of_week, scope, category_id, discount_type, discount_value)
      values (v_ra, 'HH bad', true, '16:00', '18:00', '{1,2,3,4,5}', 'category', v_cb, 'percent', 10);
  exception when others then
    if sqlerrm like '%aparține%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'B3-2 FAIL: happy_hour cu categoria altui restaurant acceptat'; end if;
  raise notice 'B3-2 PASS: happy_hour scope=all OK + category cross-tenant respins (#28)';

  -- ─── B3-3: dezactivare masă închide sesiunea (155) ─────────────
  insert into public.tables (id, restaurant_id, name, slug, is_active, seats)
    values (v_tbl, v_ra, 'Masa B3', 'b3-masa-1', true, 4);
  insert into public.table_sessions (id, restaurant_id, table_id, status, opened_at, last_activity_at)
    values (v_sess, v_ra, v_tbl, 'open', now(), now());
  update public.tables set is_active = false where id = v_tbl;
  select count(*) into v_open from public.table_sessions where table_id = v_tbl and status = 'open';
  if v_open <> 0 then raise exception 'B3-3 FAIL: sesiunea a rămas deschisă după dezactivarea mesei (% open)', v_open; end if;
  raise notice 'B3-3 PASS: dezactivarea mesei a închis sesiunea deschisă (#21)';

  -- ─── B3-4: save_floor_layout gate + size (154) ─────────────────
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  -- growth → respins (floor_plan)
  perform set_config('request.jwt.claim.sub', v_ugrw::text, true);
  v_blocked := false;
  begin
    perform public.save_floor_layout(v_rg, '{"tables":[]}'::jsonb);
  exception when others then
    if sqlerrm like '%floor_plan%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'B3-4 FAIL: save_floor_layout permis pe growth (gate floor_plan)'; end if;

  -- pro → OK
  perform set_config('request.jwt.claim.sub', v_upro::text, true);
  perform public.save_floor_layout(v_rp, '{"tables":[]}'::jsonb);

  -- pro oversize → respins
  v_blocked := false;
  begin
    perform public.save_floor_layout(v_rp, jsonb_build_object('blob', repeat('a', 1100000)));
  exception when others then
    if sqlerrm like '%prea mare%' or sqlerrm like '%too_large%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'B3-4 FAIL: save_floor_layout a acceptat un layout > 1MB'; end if;
  raise notice 'B3-4 PASS: save_floor_layout gate floor_plan + size cap (#24/#25)';

  raise notice 'ALL PASS';
end$$;

rollback;
