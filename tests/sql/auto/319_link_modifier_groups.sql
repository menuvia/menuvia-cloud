-- tests/sql/auto/319_link_modifier_groups.sql
-- =============================================================================
-- LG1–LG6 — clichetul PERMANENT al mig 319: grupurile de opțiuni se pot lega de
-- produse, iar meniul oaspetelui le vede. Totul sub rolul REAL `authenticated`
-- (ca postgres RLS-ul ar fi ocolit și testul ar fi orb la autoritatea politicii
-- „pmg: admin write”). Autonom, ROLLBACK la final.
--
--   LG1  Proprietarul leagă două grupuri de un produs, în ordinea aleasă; meniul
--        oaspetelui (get_menu_for_restaurant) le arată în ACEA ordine; o nouă
--        listă scoate grupul lipsă. [PICĂ: delete-ul scos — grupul rămâne]
--   LG2  Din partea grupului: „Alege produsele” leagă grupul de alt produs (intră
--        ULTIMUL în fișa lui, legăturile existente își păstrează locul) și îl
--        scoate de pe produsul care nu mai e în listă.
--   LG3  Străinul (proprietarul altui restaurant) NU poate: nici să adauge, nici
--        să golească (DELETE-ul nepermis afectează 0 rânduri fără eroare sub RLS
--        — funcția îl numără și refuză cu 42501 `not_allowed`); grupul altui
--        restaurant nu se poate lega de produs. Legăturile rămân INTACTE. (Grupul
--        altui restaurant nu e nici măcar vizibil străinului: refuzul lui vine
--        ca P0002 „nu există”.)
--        [PICĂ: verificarea `v_deleted < v_expected` scoasă — golirea străinului
--         „reușește” fără să schimbe nimic]
--   LG4  Ospătarul (membru, nu admin) NU poate; partenerul cu acces ACORDAT
--        poate (aceeași suprafață ca politica, mig 286).
--   LG5  Liste invalide (duplicate, NULL) → 22023; produs/grup inexistent → P0002.
--   LG6  Suprafața: INVOKER, `public, pg_temp`, doar authenticated; anon NU (apel
--        REAL, eroarea e pe FUNCȚIE). [PICĂ: `security definer`; grant anon]
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('31900000-0000-4000-8000-000000000001', 'lg-owner-a@lg319.test'),
  ('31900000-0000-4000-8000-000000000002', 'lg-owner-b@lg319.test'),
  ('31900000-0000-4000-8000-000000000003', 'lg-waiter@lg319.test'),
  ('31900000-0000-4000-8000-000000000004', 'lg-partner@lg319.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'lg-%@lg319.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('31900000-0000-4000-8000-000000000001', '31900000-0000-4000-8000-000000000002');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('319b0000-0000-4000-8000-000000000001', '31900000-0000-4000-8000-000000000001', 'LG A', 'lg319-a', 'Cluj', true),
  ('319b0000-0000-4000-8000-000000000002', '31900000-0000-4000-8000-000000000002', 'LG B', 'lg319-b', 'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('319b0000-0000-4000-8000-000000000001', '31900000-0000-4000-8000-000000000003', 'waiter');
insert into public.categories (id, restaurant_id, name, display_order) values
  ('319f0000-0000-4000-8000-000000000001', '319b0000-0000-4000-8000-000000000001', 'Pizza', 0);
insert into public.products (id, restaurant_id, category_id, name, price, is_active) values
  ('319d0000-0000-4000-8000-000000000001', '319b0000-0000-4000-8000-000000000001', '319f0000-0000-4000-8000-000000000001', 'Margherita', 30, true),
  ('319d0000-0000-4000-8000-000000000002', '319b0000-0000-4000-8000-000000000001', '319f0000-0000-4000-8000-000000000001', 'Diavola', 34, true);
insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required, min_select, display_order) values
  ('319a0000-0000-4000-8000-000000000001', '319b0000-0000-4000-8000-000000000001', 'Blat', 'single', true, 1, 0),
  ('319a0000-0000-4000-8000-000000000002', '319b0000-0000-4000-8000-000000000001', 'Sos', 'single', false, 0, 1),
  ('319a0000-0000-4000-8000-000000000003', '319b0000-0000-4000-8000-000000000002', 'Blat B', 'single', false, 0, 0);
insert into public.modifier_options (modifier_group_id, name, price_delta) values
  ('319a0000-0000-4000-8000-000000000001', 'Subțire', 0),
  ('319a0000-0000-4000-8000-000000000002', 'Picant', 3),
  ('319a0000-0000-4000-8000-000000000003', 'Pufos B', 0);

-- Partenerul (LG4): afiliat activ care l-a adus pe owner-ul A, cu acces ACORDAT.
insert into public.affiliates (id, profile_id, referral_code) values
  ('319c0000-0000-4000-8000-000000000001', '31900000-0000-4000-8000-000000000004', 'lgpartner319');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source, owner_consented_at) values
  ('319c0000-0000-4000-8000-0000000000a1', '319c0000-0000-4000-8000-000000000001',
   '31900000-0000-4000-8000-000000000001', 'active', 'link', now());

-- Apel SUB rolul și identitatea date; null = a trecut, altfel 'SQLSTATE|hint|mesaj'.
-- `set_config('role')` stă în afara sub-blocului (s-ar derula odată cu el);
-- EXECUTE dinamic, ca verificarea de ACL să nu fie cache-uită pe primul rol.
create function pg_temp.lg_call(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare v_state text; v_hint text; v_msg text; v_out text := null;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
    v_out := v_state || '|' || coalesce(v_hint, '') || '|' || v_msg;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_out;
end $f$;

-- Grupurile unui produs, în ordine: 'Blat,Sos'.
create function pg_temp.lg_groups(p uuid) returns text
language sql as $f$
  select coalesce(string_agg(mg.name, ',' order by pmg.display_order, mg.name), '')
    from public.product_modifier_groups pmg
    join public.modifier_groups mg on mg.id = pmg.modifier_group_id
   where pmg.product_id = p
$f$;

-- ── LG1: proprietarul leagă grupuri de produs; meniul oaspetelui le vede ────
do $$
declare v_err text; v_menu jsonb; v_names text;
begin
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000001',
        array['319a0000-0000-4000-8000-000000000002','319a0000-0000-4000-8000-000000000001']::uuid[])$q$);
  if v_err is not null then raise exception 'LG1 FAIL: proprietarul nu poate lega grupuri: %', v_err; end if;
  if pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001') <> 'Sos,Blat' then
    raise exception 'LG1 FAIL: ordinea legăturilor = %, aștept Sos,Blat',
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001');
  end if;

  v_menu := public.get_menu_for_restaurant('319b0000-0000-4000-8000-000000000001')::jsonb;
  select string_agg(g->>'name', ',' order by ord) into v_names
    from jsonb_array_elements(v_menu) c,
         jsonb_array_elements(c->'products') p,
         jsonb_array_elements(p->'modifier_groups') with ordinality as t(g, ord)
   where p->>'id' = '319d0000-0000-4000-8000-000000000001';
  if v_names is distinct from 'Sos,Blat' then
    raise exception 'LG1 FAIL: meniul oaspetelui arată grupurile %, aștept Sos,Blat', v_names;
  end if;

  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000001',
        array['319a0000-0000-4000-8000-000000000001']::uuid[])$q$);
  if v_err is not null or pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001') <> 'Blat' then
    raise exception 'LG1 FAIL: lista nouă trebuia să lase doar Blat (%, %)', v_err,
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001');
  end if;
  raise notice 'LG1 PASS: legăturile se salvează în ordine și ajung în meniul oaspetelui';
end $$;

-- ── LG2: din partea grupului ─────────────────────────────────────────────────
do $$
declare v_err text;
begin
  -- Diavola are deja Sos; Blat se adaugă ULTIMUL la ea.
  insert into public.product_modifier_groups (product_id, modifier_group_id, display_order)
  values ('319d0000-0000-4000-8000-000000000002', '319a0000-0000-4000-8000-000000000002', 0);
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_modifier_group_products('319a0000-0000-4000-8000-000000000001',
        array['319d0000-0000-4000-8000-000000000001','319d0000-0000-4000-8000-000000000002']::uuid[])$q$);
  if v_err is not null then raise exception 'LG2 FAIL: %', v_err; end if;
  if pg_temp.lg_groups('319d0000-0000-4000-8000-000000000002') <> 'Sos,Blat'
     or pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001') <> 'Blat' then
    raise exception 'LG2 FAIL: Diavola = %, Margherita = %',
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000002'),
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001');
  end if;
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_modifier_group_products('319a0000-0000-4000-8000-000000000001',
        array['319d0000-0000-4000-8000-000000000002']::uuid[])$q$);
  if v_err is not null or pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001') <> '' then
    raise exception 'LG2 FAIL: Margherita trebuia să rămână fără Blat (%, %)', v_err,
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001');
  end if;
  raise notice 'LG2 PASS: grupul se aplică pe produsele alese, la finalul fișei lor';
end $$;

-- ── LG3: străinul nu poate, nici prin golire ───────────────────────────────
do $$
declare v_err text; v_before text := pg_temp.lg_groups('319d0000-0000-4000-8000-000000000002');
begin
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000002',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000002', '{}'::uuid[])$q$);
  if v_err is null or split_part(v_err, '|', 1) <> '42501' or split_part(v_err, '|', 2) <> 'not_allowed' then
    raise exception 'LG3 FAIL: străinul a golit grupurile altui restaurant (%)', v_err;
  end if;
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000002',
    $q$select public.set_modifier_group_products('319a0000-0000-4000-8000-000000000001', '{}'::uuid[])$q$);
  -- Grupul altui restaurant nu e vizibil străinului (RLS pe modifier_groups):
  -- refuzul vine ca „nu există”. Oricare dintre cele două, nimic nu se schimbă.
  if v_err is null or split_part(v_err, '|', 1) not in ('42501', 'P0002') then
    raise exception 'LG3 FAIL: străinul a golit produsele unui grup străin (%)', v_err;
  end if;
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000002',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000002',
        array['319a0000-0000-4000-8000-000000000002','319a0000-0000-4000-8000-000000000001']::uuid[])$q$);
  if v_err is null or split_part(v_err, '|', 1) <> '42501' then
    raise exception 'LG3 FAIL: străinul a scris legături pe produsul altui restaurant (%)', v_err;
  end if;
  -- Proprietarul A nu poate lega grupul lui B de produsul lui.
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000002',
        array['319a0000-0000-4000-8000-000000000003']::uuid[])$q$);
  if v_err is null or split_part(v_err, '|', 1) <> '42501' then
    raise exception 'LG3 FAIL: grupul altui restaurant a fost legat de produs (%)', v_err;
  end if;
  if pg_temp.lg_groups('319d0000-0000-4000-8000-000000000002') <> v_before then
    raise exception 'LG3 FAIL: legăturile s-au schimbat după refuzuri: % → %', v_before,
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000002');
  end if;
  raise notice 'LG3 PASS: străinul nu adaugă și nu golește; grupul străin nu se leagă';
end $$;

-- ── LG4: ospătarul nu; partenerul cu acces acordat da ──────────────────────
do $$
declare v_err text;
begin
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000003',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000002', '{}'::uuid[])$q$);
  if v_err is null or split_part(v_err, '|', 1) <> '42501' then
    raise exception 'LG4 FAIL: ospătarul a schimbat opțiunile produsului (%)', v_err;
  end if;
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000004',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000001',
        array['319a0000-0000-4000-8000-000000000002']::uuid[])$q$);
  if v_err is not null or pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001') <> 'Sos' then
    raise exception 'LG4 FAIL: partenerul cu acces acordat nu poate lega grupuri (%, %)', v_err,
      pg_temp.lg_groups('319d0000-0000-4000-8000-000000000001');
  end if;
  raise notice 'LG4 PASS: ospătarul nu, partenerul cu acces da';
end $$;

-- ── LG5: liste invalide ─────────────────────────────────────────────────────
do $$
declare v_err text;
begin
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000001',
        array['319a0000-0000-4000-8000-000000000002','319a0000-0000-4000-8000-000000000002']::uuid[])$q$);
  if split_part(coalesce(v_err, ''), '|', 2) <> 'duplicate_groups' then
    raise exception 'LG5 FAIL: lista cu dubluri: %', v_err;
  end if;
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_modifier_group_products('319a0000-0000-4000-8000-000000000001', array[null]::uuid[])$q$);
  if split_part(coalesce(v_err, ''), '|', 1) <> '22023' then
    raise exception 'LG5 FAIL: lista cu NULL: %', v_err;
  end if;
  v_err := pg_temp.lg_call('authenticated', '31900000-0000-4000-8000-000000000001',
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-0000000000ff', '{}'::uuid[])$q$);
  if split_part(coalesce(v_err, ''), '|', 2) <> 'product_not_found' then
    raise exception 'LG5 FAIL: produs inexistent: %', v_err;
  end if;
  raise notice 'LG5 PASS: dubluri / NULL / inexistent refuzate cu hint';
end $$;

-- ── LG6: suprafața ─────────────────────────────────────────────────────────
do $$
declare v_sig text; v_cfg text; v_err text;
begin
  foreach v_sig in array array[
    'public.set_product_modifier_groups(uuid, uuid[])',
    'public.set_modifier_group_products(uuid, uuid[])'] loop
    select lower(regexp_replace(coalesce(array_to_string(proconfig, ','), ''), '[[:space:]]+', '', 'g'))
      into v_cfg from pg_proc where oid = v_sig::regprocedure;
    if (select prosecdef from pg_proc where oid = v_sig::regprocedure)
       or v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)'
       or has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'LG6 FAIL: suprafața lui % (definer/search_path/grant): %', v_sig, v_cfg;
    end if;
  end loop;
  v_err := pg_temp.lg_call('anon', null,
    $q$select public.set_product_modifier_groups('319d0000-0000-4000-8000-000000000001', '{}'::uuid[])$q$);
  if v_err is null or split_part(v_err, '|', 1) <> '42501' or v_err not like '%for function%' then
    raise exception 'LG6 FAIL: anon trebuia refuzat pe funcție: %', v_err;
  end if;
  raise notice 'LG6 PASS: INVOKER, public+pg_temp, doar authenticated';
end $$;

rollback;
