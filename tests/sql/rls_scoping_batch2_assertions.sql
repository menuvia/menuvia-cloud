-- ═══════════════════════════════════════════════════════════════
-- RLS scoping BATCH 2 — pmg (mig 152, #13) + reads scopate (mig 153)
-- ═══════════════════════════════════════════════════════════════
--   RS1 — admin RA: pmg(product RA, group RA) → OK;
--   RS2 — admin RA: pmg(product RB, group RA) → respins (cross-tenant, #13);
--   RS3 — anon: categories restaurant ACTIV vizibile, INACTIV ascunse (#18/#22);
--   RS4 — authenticated non-membru: restaurant_modules ACTIV vizibile, INACTIV ascunse (#30);
--   RS5 — vat_rates: membru vede, non-membru NU (#29).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

-- ── SETUP (superuser, RLS bypass) ────────────────────────────────────────────
do $$
declare
  v_ra  uuid := '81111111-2222-3333-4444-5555555555a1'::uuid; -- restaurant A activ
  v_rb  uuid := '81111111-2222-3333-4444-5555555555a2'::uuid; -- restaurant B activ
  v_ri  uuid := '81111111-2222-3333-4444-5555555555a3'::uuid; -- restaurant inactiv
  v_ura uuid := '81111111-2222-3333-4444-555555555501'::uuid;
  v_urb uuid := '81111111-2222-3333-4444-555555555502'::uuid;
  v_uri uuid := '81111111-2222-3333-4444-555555555503'::uuid;
  v_oth uuid := '81111111-2222-3333-4444-555555555504'::uuid;
begin
  insert into auth.users (id, email) values
    (v_ura,'rs-ra@menuvia.ro'),(v_urb,'rs-rb@menuvia.ro'),
    (v_uri,'rs-ri@menuvia.ro'),(v_oth,'rs-oth@menuvia.ro');

  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    (v_ra, v_ura, 'RA', 'rs-ra-slug', 'Cluj', true),
    (v_rb, v_urb, 'RB', 'rs-rb-slug', 'Cluj', true),
    (v_ri, v_uri, 'RI', 'rs-ri-slug', 'Cluj', false);

  insert into public.products (id, restaurant_id, name, price, is_active) values
    ('8a000000-0000-4000-8000-0000000000a1', v_ra, 'PA', 10.00, true),
    ('8a000000-0000-4000-8000-0000000000b1', v_rb, 'PB', 10.00, true);
  insert into public.modifier_groups (id, restaurant_id, name, selection_type) values
    ('8c000000-0000-4000-8000-0000000000a1', v_ra, 'GA', 'single');

  insert into public.categories (restaurant_id, name) values
    (v_ra, 'Cat A'), (v_ri, 'Cat I');
  insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
    (v_ra, 'reservations', true), (v_ri, 'reservations', true)
    on conflict (restaurant_id, module_key) do update set enabled = true;
  -- vat_rates sunt auto-seed-uite de trigger la insert restaurant → RA are deja cote.
end $$;

-- ── RS1/RS2: pmg write ca authenticated admin RA ─────────────────────────────
set local role authenticated;
do $$
declare v_blocked boolean;
begin
  perform set_config('request.jwt.claim.role','authenticated', true);
  perform set_config('request.jwt.claim.sub','81111111-2222-3333-4444-555555555501', true); -- u_ra

  -- RS1: pmg(product RA, group RA) → OK
  insert into public.product_modifier_groups (product_id, modifier_group_id)
    values ('8a000000-0000-4000-8000-0000000000a1','8c000000-0000-4000-8000-0000000000a1');
  raise notice 'RS1 PASS: pmg same-tenant acceptat';

  -- RS2: pmg(product RB, group RA) → respins (cross-tenant)
  v_blocked := false;
  begin
    insert into public.product_modifier_groups (product_id, modifier_group_id)
      values ('8a000000-0000-4000-8000-0000000000b1','8c000000-0000-4000-8000-0000000000a1');
  exception when insufficient_privilege or check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'RS2 FAIL: pmg cross-tenant (product RB + group RA) acceptat (#13)';
  end if;
  raise notice 'RS2 PASS: pmg cross-tenant respins (#13)';
end $$;
reset role;

-- ── RS3: categories ca anon ──────────────────────────────────────────────────
set local role anon;
do $$
declare n_a int; n_i int;
begin
  perform set_config('request.jwt.claim.role','anon', true);
  perform set_config('request.jwt.claim.sub','', true);
  select count(*) into n_a from public.categories where restaurant_id='81111111-2222-3333-4444-5555555555a1';
  select count(*) into n_i from public.categories where restaurant_id='81111111-2222-3333-4444-5555555555a3';
  if n_a < 1 then raise exception 'RS3 FAIL: categoriile restaurantului activ invizibile (% )', n_a; end if;
  if n_i <> 0 then raise exception 'RS3 FAIL: LEAK — categoriile restaurantului inactiv vizibile (% )', n_i; end if;
  raise notice 'RS3 PASS: categories scopate pe restaurant activ (#18/#22)';
end $$;
reset role;

-- ── RS4 + RS5: modules + vat_rates ca authenticated ──────────────────────────
set local role authenticated;
do $$
declare n_a int; n_i int; n_m int; n_o int;
begin
  perform set_config('request.jwt.claim.role','authenticated', true);
  -- RS4: non-membru vede module ale restaurantului ACTIV, nu ale celui inactiv
  perform set_config('request.jwt.claim.sub','81111111-2222-3333-4444-555555555504', true); -- u_other
  select count(*) into n_a from public.restaurant_modules where restaurant_id='81111111-2222-3333-4444-5555555555a1';
  select count(*) into n_i from public.restaurant_modules where restaurant_id='81111111-2222-3333-4444-5555555555a3';
  if n_a < 1 then raise exception 'RS4 FAIL: modulele restaurantului activ invizibile (% )', n_a; end if;
  if n_i <> 0 then raise exception 'RS4 FAIL: LEAK — modulele restaurantului inactiv vizibile (% )', n_i; end if;
  raise notice 'RS4 PASS: restaurant_modules scopate pe restaurant activ (#30)';

  -- RS5: vat_rates — non-membru NU vede
  select count(*) into n_o from public.vat_rates where restaurant_id='81111111-2222-3333-4444-5555555555a1';
  if n_o <> 0 then raise exception 'RS5 FAIL: LEAK — non-membru vede % cote TVA', n_o; end if;

  -- RS5: membru (owner RA) VEDE
  perform set_config('request.jwt.claim.sub','81111111-2222-3333-4444-555555555501', true); -- u_ra
  select count(*) into n_m from public.vat_rates where restaurant_id='81111111-2222-3333-4444-5555555555a1';
  if n_m < 1 then raise exception 'RS5 FAIL: membrul nu-și vede cotele TVA (% )', n_m; end if;
  raise notice 'RS5 PASS: vat_rates doar pentru membri (#29)';
end $$;
reset role;

do $$ begin raise notice 'ALL PASS'; end $$;

rollback;
