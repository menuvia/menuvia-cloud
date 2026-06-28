-- ═══════════════════════════════════════════════════════════════
-- slug case-insensitive — asserțiuni pentru mig 148 (#4)
-- ═══════════════════════════════════════════════════════════════
--   SL1 — create_restaurant cu p_slug mixed-case → stocat lowercase;
--   SL2 — get_restaurant_by_slug cu alt case → găsește restaurantul;
--   SL3 — create_restaurant cu slug care coincide case-insensitive → sufixat;
--   SL4 — indexul UNIQUE pe lower(slug) respinge două slug-uri care diferă doar prin case.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_u1    uuid := '41111111-2222-3333-4444-555555555501'::uuid;
  v_u2    uuid := '41111111-2222-3333-4444-555555555502'::uuid;
  v_res   jsonb;
  v_slug1 text;
  v_slug3 text;
  v_get   text;
  v_owner  uuid := '41111111-2222-3333-4444-5555555555aa'::uuid;
  v_owner2 uuid := '41111111-2222-3333-4444-5555555555bb'::uuid;
  v_blocked boolean;
begin
  insert into auth.users (id, email) values (v_u1, 'slug-ci@menuvia.ro');
  perform set_config('request.jwt.claim.sub', v_u1::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- ─── SL1: create cu slug mixed-case → lowercase ────────────────
  v_res := public.create_restaurant('Test One', 'Cluj', 'MyResto', '#C8963C');
  v_slug1 := v_res->>'restaurant_slug';
  if v_slug1 is distinct from 'myresto' then
    raise exception 'SL1 FAIL: slug ar trebui lowercase ''myresto'', e: %', v_slug1;
  end if;
  raise notice 'SL1 PASS: create_restaurant a normalizat slug-ul la ''myresto''';

  -- ─── SL2: get cu alt case → găsește ────────────────────────────
  select g.slug into v_get from public.get_restaurant_by_slug('MYRESTO') g limit 1;
  if v_get is null or v_get is distinct from 'myresto' then
    raise exception 'SL2 FAIL: get_restaurant_by_slug(''MYRESTO'') nu a găsit restaurantul: %', v_get;
  end if;
  raise notice 'SL2 PASS: get_restaurant_by_slug găsește case-insensitive';

  -- ─── SL3: alt user creează slug ce coincide case-insensitive → sufixat ─
  -- (user nou ca să nu lovim limita de restaurante/plan a lui v_u1)
  insert into auth.users (id, email) values (v_u2, 'slug-ci2@menuvia.ro');
  perform set_config('request.jwt.claim.sub', v_u2::text, true);
  v_res := public.create_restaurant('Test Two', 'Cluj', 'MyResto', '#C8963C');
  v_slug3 := v_res->>'restaurant_slug';
  if v_slug3 = 'myresto' or v_slug3 not like 'myresto-%' then
    raise exception 'SL3 FAIL: al doilea slug ar trebui sufixat (myresto-XXXX), e: %', v_slug3;
  end if;
  raise notice 'SL3 PASS: coliziune case-insensitive dezambiguizată: %', v_slug3;

  -- ─── SL4: indexul UNIQUE pe lower(slug) respinge case-diff ──────
  -- doi owneri diferiți (fiecare la limita free de 1 restaurant) cu slug care diferă
  -- doar prin case → al doilea insert lovește indexul UNIQUE pe lower(slug).
  insert into auth.users (id, email) values (v_owner,  'slug-idx@menuvia.ro');
  insert into auth.users (id, email) values (v_owner2, 'slug-idx2@menuvia.ro');
  insert into public.restaurants (owner_id, name, slug, city, is_active)
    values (v_owner, 'Idx One', 'Foobar', 'Cluj', true);
  v_blocked := false;
  begin
    insert into public.restaurants (owner_id, name, slug, city, is_active)
      values (v_owner2, 'Idx Two', 'foobar', 'Cluj', true);
  exception when unique_violation then
    v_blocked := true;
    raise notice 'SL4 PASS: index UNIQUE lower(slug) a respins ''foobar'' vs ''Foobar''';
  end;
  if not v_blocked then
    raise exception 'SL4 FAIL: indexul UNIQUE pe lower(slug) a permis duplicat case-diff';
  end if;

  raise notice 'ALL PASS';
end$$;

rollback;
