-- tests/sql/auto/305_admin_list_affiliates_sales_role.sql
-- =============================================================================
-- Mig 305: `admin_list_affiliates` (lanț 186→188→224→236→295→305) proiectează
-- `sales_role` (mig 304), ca lista „Rețeaua” din panoul fondatorului să afișeze
-- rolul REAL (Șef / Agent / Partener din programul public) în loc de
-- „Partener” pentru toată lumea. Rulează din tests/sql/auto/ pe AMBELE medii
-- (Postgres gol din sql-verify + stack-ul Supabase din E2E). Autonom, ROLLBACK.
--
-- Apelurile se fac SUB rolul REAL (`authenticated` / `anon`): ca `postgres`,
-- EXECUTE e ocolit și `auth.uid()` e NULL, deci un „non-fondatorul e respins”
-- ar fi vacuu, iar un „fondatorul vede” ar fi imposibil (clasa PF/TP24).
--
--   AL1  rândurile șef / agent / program public poartă `sales_role` corect
--        ('head', 'agent', null) — cheia e PREZENTĂ pe toate trei, inclusiv cu
--        valoare JSON null (un `->>` NULL ar trece și cu cheia ABSENTĂ, adică
--        exact proiecția veche)
--   AL2  forma cheilor e SUPERSET al celei din 295 (cele 20 de chei vechi,
--        înghețate cu collate "C") + `sales_role`; la fel cheile obiectului
--        imbricat din `restaurants` (control pozitiv: agentul are un restaurant
--        atribuit, altfel verificarea imbricată ar fi vacuă)
--   AL3  refuzul neschimbat: cont simplu și afiliat (non-fondatori) → P0001
--        „Acces interzis”; anon → 42501 pe FUNCȚIE (nu pe schemă)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- F fondator · N cont simplu · H șef · G agentul lui H · P afiliat din programul
-- public · O patronul atribuit lui G
insert into auth.users (id, email) values
  ('30500000-0000-4000-8000-0000000000f1', 'al-founder@in305.test'),
  ('30500000-0000-4000-8000-0000000000e1', 'al-nobody@in305.test'),
  ('30500000-0000-4000-8000-000000000001', 'al-head@in305.test'),
  ('30500000-0000-4000-8000-000000000011', 'al-agent@in305.test'),
  ('30500000-0000-4000-8000-000000000021', 'al-public@in305.test'),
  ('30500000-0000-4000-8000-000000000031', 'al-owner@in305.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'al-%@in305.test'
  on conflict (id) do nothing;

update public.profiles set is_platform_admin = true
 where id = '30500000-0000-4000-8000-0000000000f1';
update public.profiles set full_name = 'Șef AL305'     where id = '30500000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Agent AL305'   where id = '30500000-0000-4000-8000-000000000011';
update public.profiles set full_name = 'Partener AL305' where id = '30500000-0000-4000-8000-000000000021';

insert into public.affiliates (id, profile_id, referral_code, status, parent_affiliate_id, sales_role) values
  ('305a0000-0000-4000-8000-000000000001', '30500000-0000-4000-8000-000000000001', 'al305hd1', 'active', null, 'head'),
  ('305a0000-0000-4000-8000-000000000011', '30500000-0000-4000-8000-000000000011', 'al305ag1', 'active',
     '305a0000-0000-4000-8000-000000000001', 'agent'),
  ('305a0000-0000-4000-8000-000000000021', '30500000-0000-4000-8000-000000000021', 'al305pb1', 'active', null, null);

-- Fixtura e o stare VALIDĂ: invariantele deferred (D8 din 304, depth-1 din 097)
-- se verifică ACUM, nu la un COMMIT care nu vine (testul face rollback).
set constraints all immediate;
set constraints all deferred;

-- Un restaurant atribuit agentului (pentru forma obiectului imbricat, AL2).
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('305b0000-0000-4000-8000-000000000001', '30500000-0000-4000-8000-000000000031', 'AL305 Bistro', 'al305-bistro', 'Cluj', true);
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source) values
  ('305c0000-0000-4000-8000-000000000001', '305a0000-0000-4000-8000-000000000011',
   '30500000-0000-4000-8000-000000000031', 'active', 'link');

-- Rulează un apel jsonb SUB rolul indicat, ca utilizatorul dat. Întoarce
-- rezultatul sau {raised:true, sqlstate, error} dacă apelul aruncă.
create function pg_temp.al_as(p_role text, p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute 'select (' || p_sql || ')::jsonb' into v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $f$;

-- Lista văzută de fondator, SUB `authenticated` (calea reală din FounderPage).
create temp table al_list (v jsonb) on commit drop;
insert into al_list
  select pg_temp.al_as('authenticated', '30500000-0000-4000-8000-0000000000f1',
                       'public.admin_list_affiliates()');

-- ── AL1: sales_role pe rândurile șef / agent / program public ────────────────
do $$
declare
  v jsonb := (select v from al_list);
  v_row jsonb;
  r record;
begin
  if jsonb_typeof(v) is distinct from 'array' then
    raise exception 'AL1 FAIL (control pozitiv): fondatorul nu a primit lista: %', v;
  end if;
  for r in select * from (values
      ('305a0000-0000-4000-8000-000000000001', '"head"'::jsonb,  'șef'),
      ('305a0000-0000-4000-8000-000000000011', '"agent"'::jsonb, 'agent'),
      ('305a0000-0000-4000-8000-000000000021', 'null'::jsonb,    'program public')
    ) t(id, expected, label)
  loop
    select e into v_row from jsonb_array_elements(v) e where e->>'affiliate_id' = r.id;
    if v_row is null then
      raise exception 'AL1 FAIL: rândul % (%) lipsește din lista fondatorului', r.label, r.id;
    end if;
    -- `?` cere cheia PREZENTĂ: pe proiecția veche `v_row->'sales_role'` e NULL
    -- SQL, iar un test pe `->>` ar confunda „absent” cu „program public”.
    if not (v_row ? 'sales_role') then
      raise exception 'AL1 FAIL: rândul % (%) nu are cheia sales_role: %', r.label, r.id, v_row;
    end if;
    if (v_row->'sales_role') is distinct from r.expected then
      raise exception 'AL1 FAIL: rândul % are sales_role = % (așteptat %)',
        r.label, v_row->'sales_role', r.expected;
    end if;
  end loop;
  raise notice 'AL1 OK: șef = "head", agent = "agent", program public = null (cheia prezentă pe toate)';
end $$;

-- ── AL2: forma e superset al celei din 295 ───────────────────────────────────
do $$
declare
  v jsonb := (select v from al_list);
  -- Cheile de nivel 1 ale lui 295 (TOATE 20), în ordinea collate "C".
  c_old constant text := 'affiliate_id,application_note,balance_ron_cents,brand_domain,'
    || 'brand_logo_url,brand_name,cascade_bps,created_at,email,erased_at,full_name,'
    || 'parent_affiliate_id,phone,recurring_bps,recurring_cap_months,referral_code,'
    || 'restaurants,reviewed_at,setup_bps,status';
  -- Cheile obiectului imbricat din `restaurants` (neschimbate din 186).
  c_rest constant text := 'is_active,name,plan,restaurant_id,slug';
  v_old text[];
  v_row jsonb;
  v_rest jsonb;
  v_have text;
  v_missing text;
  v_id text;
begin
  v_old := string_to_array(c_old, ',');
  -- Ancoră anti-vacuitate: lista înghețată are exact 20 de chei distincte.
  if cardinality(v_old) <> 20
     or (select count(distinct x) from unnest(v_old) x) <> 20 then
    raise exception 'AL2 FAIL (ancoră): lista cheilor vechi nu mai are 20 de intrări distincte';
  end if;

  foreach v_id in array array['305a0000-0000-4000-8000-000000000001',
                            '305a0000-0000-4000-8000-000000000011',
                            '305a0000-0000-4000-8000-000000000021'] loop
    select e into v_row from jsonb_array_elements(v) e where e->>'affiliate_id' = v_id;
    if v_row is null then
      raise exception 'AL2 FAIL (control pozitiv): rândul % lipsește', v_id;
    end if;
    -- Cheile vechi PREZENTE, în ordinea C — trebuie să fie EXACT lista înghețată.
    select string_agg(k, ',' order by k collate "C") into v_have
      from jsonb_object_keys(v_row) k
     where k = any (v_old);
    if v_have is distinct from c_old then
      select string_agg(x, ',' order by x collate "C") into v_missing
        from unnest(v_old) x where not (v_row ? x);
      raise exception 'AL2 FAIL: rândul % a pierdut chei din 295: % (are: %)',
        v_id, v_missing,
        (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(v_row) k);
    end if;
    if not (v_row ? 'sales_role') then
      raise exception 'AL2 FAIL: rândul % fără sales_role', v_id;
    end if;
    if jsonb_typeof(v_row->'restaurants') is distinct from 'array' then
      raise exception 'AL2 FAIL: rândul % are restaurants ne-array: %', v_id, v_row->'restaurants';
    end if;
  end loop;

  -- Obiectul imbricat: agentul are EXACT restaurantul atribuit.
  select e into v_row from jsonb_array_elements(v) e
   where e->>'affiliate_id' = '305a0000-0000-4000-8000-000000000011';
  if jsonb_array_length(v_row->'restaurants') <> 1 then
    raise exception 'AL2 FAIL (control pozitiv): agentul trebuie să aibă 1 restaurant atribuit: %',
      v_row->'restaurants';
  end if;
  v_rest := v_row->'restaurants'->0;
  select string_agg(k, ',' order by k collate "C") into v_have
    from jsonb_object_keys(v_rest) k;
  if v_have is distinct from c_rest then
    raise exception 'AL2 FAIL: forma restaurantului atribuit s-a schimbat: % (așteptat %)', v_have, c_rest;
  end if;
  if v_rest->>'slug' is distinct from 'al305-bistro' then
    raise exception 'AL2 FAIL: restaurantul atribuit e altul: %', v_rest;
  end if;
  raise notice 'AL2 OK: cele 20 de chei din 295 + sales_role pe toate rândurile; restaurantul imbricat are forma veche';
end $$;

-- ── AL3: refuzul neschimbat pentru non-fondatori și anon ─────────────────────
do $$
declare v jsonb;
begin
  -- Cont simplu, autentificat.
  v := pg_temp.al_as('authenticated', '30500000-0000-4000-8000-0000000000e1', 'public.admin_list_affiliates()');
  if v->>'sqlstate' is distinct from 'P0001' or v->>'error' is distinct from 'Acces interzis' then
    raise exception 'AL3 FAIL: contul simplu nu a fost refuzat ca înainte: %', v;
  end if;
  -- Un afiliat (șeful însuși) nu e fondator.
  v := pg_temp.al_as('authenticated', '30500000-0000-4000-8000-000000000001', 'public.admin_list_affiliates()');
  if v->>'sqlstate' is distinct from 'P0001' or v->>'error' is distinct from 'Acces interzis' then
    raise exception 'AL3 FAIL: șeful de vânzări a citit lista fondatorului: %', v;
  end if;
  -- anon: fără EXECUTE. Mesajul pe FUNCȚIE — un 42501 pe schemă ar fi tot 42501.
  v := pg_temp.al_as('anon', null, 'public.admin_list_affiliates()');
  if v->>'sqlstate' is distinct from '42501' or v->>'error' not like '%for function%' then
    raise exception 'AL3 FAIL: anon nu a fost refuzat pe funcție: %', v;
  end if;
  raise notice 'AL3 OK: cont simplu și afiliat → P0001 „Acces interzis”; anon → 42501 pe funcție';
end $$;

rollback;
\echo '✅ ADMIN_LIST_AFFILIATES SALES_ROLE OK (AL1-AL3)'
