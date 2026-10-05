-- tests/sql/plan_dead_data_assertions.sql
-- =============================================================================
-- Asserții permanente pentru mig 290 (mesaje de plan neutre + date de plan
-- moarte). Self-contained, ROLLBACK la final. Rulează pe starea FINALĂ a
-- lanțului la fiecare CI — deci o migrație VIITOARE care reintroduce un nume
-- intern de plan într-un mesaj de eroare sau reînvie datele moarte îl face roșu
-- (verificările din corpul mig 290 rulează o singură dată, la poziția 290).
--
--   PD1  CLASĂ (descoperire pe `prosrc`): niciun `raise exception` din `public`
--        nu pomenește growth/starter/pro/enterprise/free/business și nu
--        interpolează o variabilă de plan (v_plan, owner_plan(), .plan, p_plan).
--        Anti-vacuitate: descoperirea TREBUIE să vadă ≥ 9 gate-uri cu „plan
--        superior" — altfel regexul e orb (ex. `prosrc` gol după un restore).
--   PD2  Contractul stabil: fiecare din cele 9 gate-uri își păstrează HINT-ul
--        (clientul și table-payment.js mapează pe hint, nu pe text), e DEFINER
--        cu `search_path = public, pg_temp`, iar funcțiile de trigger NU sunt
--        executabile de anon/authenticated.
--   PD3  COMPORTAMENT, cu control POZITIV: pe free, gate-urile resping la fel
--        (SQLSTATE + hint neschimbate) cu un mesaj fără nume de plan; pe
--        growth/pro aceleași operații TREC.
--   PD4  Datele moarte lipsesc (2 funcții, 2 coloane, 2 feature-uri) și nu sunt
--        re-citite de nicio funcție vie; datele VII de lângă ele au rămas
--        (control pozitiv: limitele max_* pe 5 planuri, get_restaurant_features
--        întoarce în continuare feature-urile vii).
--   PD5  Matricea `plan_features` (enabled, 5 planuri, fără `max_*`) == blocul
--        FIXTURE, oglinda fixturii TS a paginii de prețuri (PL6 leagă capătul TS).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Helperi (pg_temp, dispar la final) ───────────────────────────────────────
-- Rulează un statement și întoarce {sqlstate, mesaj, hint}; NULL = a trecut.
create function pg_temp.pd_catch(p_sql text) returns text[]
language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return array[v_state, v_msg, v_hint];
end $$;

-- Același predicat ca descoperirea din PD1, aplicat pe TEXTUL produs la runtime.
create function pg_temp.pd_has_plan_name(p_msg text) returns boolean
language sql immutable as $$
  select p_msg ~* '\m(growth|starter|enterprise|free|business)\M' or p_msg ~ '\mPro\M'
$$;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('29000000-0000-4000-8000-000000000001','pd-free@pd.test'),
  ('29000000-0000-4000-8000-000000000002','pd-growth@pd.test'),
  ('29000000-0000-4000-8000-000000000003','pd-pro@pd.test'),
  ('29000000-0000-4000-8000-000000000004','pd-staff@pd.test');

update public.profiles set plan='free'   where id='29000000-0000-4000-8000-000000000001';
update public.profiles set plan='growth' where id='29000000-0000-4000-8000-000000000002';
update public.profiles set plan='pro'    where id='29000000-0000-4000-8000-000000000003';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('29b00000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','PD Free','pd-free','Cluj',true),
  ('29b00000-0000-4000-8000-000000000002','29000000-0000-4000-8000-000000000002','PD Growth','pd-growth','Cluj',true),
  ('29b00000-0000-4000-8000-000000000003','29000000-0000-4000-8000-000000000003','PD Pro','pd-pro','Cluj',true);

-- ── PD1: clasă — niciun mesaj cu nume intern de plan ─────────────────────────
do $$
declare v_bad text; v_gates int;
begin
  select string_agg(p.oid::regprocedure::text || ' → ' || regexp_replace(m[1], '\s+', ' ', 'g'), E'\n')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         regexp_matches(p.prosrc, '(raise\s+exception[^;]*;)', 'gi') m
   where n.nspname = 'public'
     and (m[1] ~* '\m(growth|starter|enterprise|free|business)\M'
          or m[1] ~ '\mPro\M'
          or m[1] ~* '(v_plan|owner_plan\(|\.plan\M|p_plan\M|v_tier\M)');
  if v_bad is not null then
    raise exception E'PD1 FAIL: mesaje de eroare cu nume intern de plan (regula 4 — numele comerciale doar în UI; pune contractul în HINT):\n%', v_bad;
  end if;

  -- anti-vacuitate: aceeași descoperire trebuie să VADĂ gate-urile neutre
  select count(distinct p.oid) into v_gates
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         regexp_matches(p.prosrc, '(raise\s+exception[^;]*;)', 'gi') m
   where n.nspname = 'public' and m[1] like '%plan superior%';
  if v_gates < 9 then
    raise exception 'PD1 FAIL (anti-vacuitate): descoperirea vede doar % gate-uri cu „plan superior” (așteptat ≥ 9)', v_gates;
  end if;
  raise notice 'PD1 OK: zero nume interne de plan în mesaje; % gate-uri neutre văzute', v_gates;
end $$;

-- ── PD2: hint-uri, DEFINER + pg_temp, ACL ────────────────────────────────────
do $$
declare
  v_gates text[] := array[
    'public.enforce_feature_for_restaurant(uuid,text)', 'public.enforce_ordering_enabled()',
    'public.enforce_product_limit()', 'public.enforce_product_limit_stmt()',
    'public.enforce_restaurant_limit()', 'public.enforce_table_limit()',
    'public.enforce_table_limit_stmt()', 'public.enforce_team_member_limit()',
    'public.enforce_team_member_limit_stmt()'];
  v_hints text[] := array[
    'feature_disabled', 'plan_upgrade_required', 'upgrade_plan', 'product_limit',
    'upgrade_plan', 'upgrade_plan', 'table_limit', 'team_member_limit', 'team_member_limit'];
  i int;
begin
  for i in 1 .. array_length(v_gates, 1) loop
    if to_regprocedure(v_gates[i]) is null then
      raise exception 'PD2 FAIL: gate-ul % lipsește', v_gates[i];
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure(v_gates[i])
         and p.prosecdef
         and p.prosrc like '%hint = ''' || v_hints[i] || '''%'
         and 'search_path=public, pg_temp' = any(p.proconfig)
    ) then
      raise exception 'PD2 FAIL: % — hint % pierdut, ne-DEFINER sau fără pg_temp', v_gates[i], v_hints[i];
    end if;
    if i > 1 and (has_function_privilege('anon', v_gates[i]::regprocedure, 'execute')
               or has_function_privilege('authenticated', v_gates[i]::regprocedure, 'execute')) then
      raise exception 'PD2 FAIL: funcția de trigger % e executabilă de client', v_gates[i];
    end if;
  end loop;
  if has_function_privilege('anon', 'public.enforce_feature_for_restaurant(uuid,text)', 'execute') then
    raise exception 'PD2 FAIL: anon poate executa enforce_feature_for_restaurant';
  end if;
  raise notice 'PD2 OK: 9 gate-uri cu hint-ul neschimbat, DEFINER + pg_temp, ACL intact';
end $$;

-- ── PD3: comportament pe free (respins, mesaj neutru) vs growth/pro (trece) ──
do $$
declare
  r text[];
  v_free   constant uuid := '29b00000-0000-4000-8000-000000000001';
  v_growth constant uuid := '29b00000-0000-4000-8000-000000000002';
  v_pro    constant uuid := '29b00000-0000-4000-8000-000000000003';
begin
  -- (a) gate-ul de comenzi (mig 083), mesajul pe care îl vede oaspetele
  r := pg_temp.pd_catch(format(
    $q$insert into public.orders (restaurant_id, source, status, total) values (%L, 'waiter', 'new', 0)$q$, v_free));
  if r is null then raise exception 'PD3a FAIL: free a creat o comandă'; end if;
  if r[1] is distinct from '23514' or r[3] is distinct from 'plan_upgrade_required' then
    raise exception 'PD3a FAIL: contract schimbat (sqlstate %, hint %): %', r[1], r[3], r[2]; end if;
  if pg_temp.pd_has_plan_name(r[2]) or r[2] not like '%plan superior%' then
    raise exception 'PD3a FAIL: mesaj cu nume intern / fără „plan superior”: %', r[2]; end if;
  r := pg_temp.pd_catch(format(
    $q$insert into public.orders (restaurant_id, source, status, total) values (%L, 'waiter', 'new', 0)$q$, v_growth));
  if r is not null then raise exception 'PD3a FAIL (control +): growth nu poate crea comandă: %', r[2]; end if;

  -- (b) helperul generic (mig 087), pe un feature de Plan 3
  r := pg_temp.pd_catch(format($q$select public.enforce_feature_for_restaurant(%L, 'fiscal_receipt')$q$, v_free));
  if r is null then raise exception 'PD3b FAIL: free trece de gate-ul fiscal_receipt'; end if;
  if r[1] is distinct from '23514' or r[3] is distinct from 'feature_disabled' then
    raise exception 'PD3b FAIL: contract schimbat (sqlstate %, hint %): %', r[1], r[3], r[2]; end if;
  if pg_temp.pd_has_plan_name(r[2]) or r[2] not like '%plan superior%' then
    raise exception 'PD3b FAIL: mesaj cu nume intern / fără „plan superior”: %', r[2]; end if;
  r := pg_temp.pd_catch(format($q$select public.enforce_feature_for_restaurant(%L, 'fiscal_receipt')$q$, v_pro));
  if r is not null then raise exception 'PD3b FAIL (control +): pro respins pe fiscal_receipt: %', r[2]; end if;

  -- (c) limita de produse (free = 15): 16 într-un singur statement
  r := pg_temp.pd_catch(format(
    $q$insert into public.products (restaurant_id, name) select %L, 'P' || g from generate_series(1, 16) g$q$, v_free));
  if r is null then raise exception 'PD3c FAIL: free a depășit limita de produse'; end if;
  if r[1] is distinct from 'P0001' or r[3] not in ('upgrade_plan', 'product_limit') then
    raise exception 'PD3c FAIL: contract schimbat (sqlstate %, hint %): %', r[1], r[3], r[2]; end if;
  if pg_temp.pd_has_plan_name(r[2]) or r[2] not like '%plan superior%' then
    raise exception 'PD3c FAIL: mesaj cu nume intern / fără „plan superior”: %', r[2]; end if;
  r := pg_temp.pd_catch(format(
    $q$insert into public.products (restaurant_id, name) select %L, 'P' || g from generate_series(1, 16) g$q$, v_growth));
  if r is not null then raise exception 'PD3c FAIL (control +): growth nu poate adăuga 16 produse: %', r[2]; end if;

  -- (d) limita de mese (free = 3)
  r := pg_temp.pd_catch(format(
    $q$insert into public.tables (restaurant_id, name, slug) select %L, 'M' || g, 'pd-m' || g from generate_series(1, 4) g$q$, v_free));
  if r is null then raise exception 'PD3d FAIL: free a depășit limita de mese'; end if;
  if r[1] is distinct from 'P0001' or r[3] not in ('upgrade_plan', 'table_limit') then
    raise exception 'PD3d FAIL: contract schimbat (sqlstate %, hint %): %', r[1], r[3], r[2]; end if;
  if pg_temp.pd_has_plan_name(r[2]) or r[2] not like '%plan superior%' then
    raise exception 'PD3d FAIL: mesaj cu nume intern / fără „plan superior”: %', r[2]; end if;
  r := pg_temp.pd_catch(format(
    $q$insert into public.tables (restaurant_id, name, slug) select %L, 'M' || g, 'pd-g' || g from generate_series(1, 4) g$q$, v_growth));
  if r is not null then raise exception 'PD3d FAIL (control +): growth nu poate adăuga 4 mese: %', r[2]; end if;

  -- (e) limita de restaurante (free = 1): al doilea local al aceluiași owner
  r := pg_temp.pd_catch(
    $q$insert into public.restaurants (owner_id, name, slug, city, is_active)
       values ('29000000-0000-4000-8000-000000000001', 'PD Free 2', 'pd-free-2', 'Cluj', true)$q$);
  if r is null then raise exception 'PD3e FAIL: free a creat al doilea restaurant'; end if;
  if r[1] is distinct from 'P0001' or r[3] is distinct from 'upgrade_plan' then
    raise exception 'PD3e FAIL: contract schimbat (sqlstate %, hint %): %', r[1], r[3], r[2]; end if;
  if pg_temp.pd_has_plan_name(r[2]) or r[2] not like '%plan superior%' then
    raise exception 'PD3e FAIL: mesaj cu nume intern / fără „plan superior”: %', r[2]; end if;

  -- (f) limita de membri (free = 1, owner-ul o ocupă)
  r := pg_temp.pd_catch(format(
    $q$insert into public.restaurant_memberships (restaurant_id, user_id, role)
       values (%L, '29000000-0000-4000-8000-000000000004', 'waiter')$q$, v_free));
  if r is null then raise exception 'PD3f FAIL: free a adăugat un membru peste limită'; end if;
  if r[1] is distinct from 'P0001' or r[3] is distinct from 'team_member_limit' then
    raise exception 'PD3f FAIL: contract schimbat (sqlstate %, hint %): %', r[1], r[3], r[2]; end if;
  if pg_temp.pd_has_plan_name(r[2]) or r[2] not like '%plan superior%' then
    raise exception 'PD3f FAIL: mesaj cu nume intern / fără „plan superior”: %', r[2]; end if;
  r := pg_temp.pd_catch(format(
    $q$insert into public.restaurant_memberships (restaurant_id, user_id, role)
       values (%L, '29000000-0000-4000-8000-000000000004', 'waiter')$q$, v_growth));
  if r is not null then raise exception 'PD3f FAIL (control +): growth nu poate adăuga un ospătar: %', r[2]; end if;

  raise notice 'PD3 OK: 6 gate-uri resping pe free cu SQLSTATE/hint neschimbate și mesaj neutru; growth/pro trec';
end $$;

-- ── PD4: datele moarte lipsesc, cele vii au rămas ────────────────────────────
do $$
declare v_feat jsonb; v_bad text;
begin
  if to_regprocedure('public.reserve_ai_import_slot(uuid,uuid)') is not null
     or to_regprocedure('public.check_ai_import_quota(uuid)') is not null then
    raise exception 'PD4 FAIL: funcțiile de cotă AI moarte au reapărut (cota reală e ai_quota)'; end if;
  if exists (select 1 from pg_attribute
              where attrelid = 'public.plan_limits'::regclass and not attisdropped
                and attname in ('ai_imports_month', 'features')) then
    raise exception 'PD4 FAIL: plan_limits are din nou coloane moarte (ai_imports_month/features)'; end if;
  if exists (select 1 from public.plan_features where feature in ('ai_import', 'kitchen_dashboard')) then
    raise exception 'PD4 FAIL: plan_features are din nou ai_import/kitchen_dashboard (zero cititori)'; end if;

  -- nicio funcție vie nu (re)citește obiectele șterse
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '(ai_imports_month|reserve_ai_import_slot|check_ai_import_quota|kitchen_dashboard|''ai_import'')';
  if v_bad is not null then
    raise exception 'PD4 FAIL: funcții vii care citesc date moarte: %', v_bad; end if;

  -- control POZITIV: limitele vii pe toate cele 5 planuri canonice
  if (select count(*) from public.plan_limits
       where plan in ('free','starter','growth','pro','enterprise')
         and max_products > 0 and max_tables > 0 and max_restaurants > 0) <> 5 then
    raise exception 'PD4 FAIL (control +): plan_limits a pierdut limite vii'; end if;

  -- control POZITIV pe suprafața clientului: get_restaurant_features (useFeatures)
  -- întoarce feature-urile vii, fără cele moarte
  perform set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000003', true);
  v_feat := public.get_restaurant_features('29b00000-0000-4000-8000-000000000003') -> 'features';
  perform set_config('request.jwt.claim.sub', '', true);
  if v_feat is null or not (v_feat ? 'order_qr') or not (v_feat ? 'fiscal_receipt') then
    raise exception 'PD4 FAIL (control +): get_restaurant_features nu mai întoarce feature-urile vii: %', v_feat; end if;
  if v_feat ? 'ai_import' or v_feat ? 'kitchen_dashboard' then
    raise exception 'PD4 FAIL: get_restaurant_features încă trimite feature-uri moarte'; end if;

  raise notice 'PD4 OK: 2 funcții + 2 coloane + 2 feature-uri moarte absente; limitele și feature-urile vii intacte';
end $$;

-- ── PD5: matricea plan_features == fixtura înghețată a paginii de prețuri ────
-- Blocul dintre markerii FIXTURE e OGLINDA lui
-- src/lib/__tests__/planFeatureMatrix.fixture.ts (PL6 din planCopy.test.ts îl
-- parsează și cere egalitate cu obiectul TS). Aici se cere egalitate cu DB-ul
-- REAL (doar rândurile `enabled`, cele 5 planuri canonice, fără limitele
-- `max_*`). Fără PD5, fixtura putea păstra rânduri șterse de o migrație (exact
-- `kitchen_dashboard`/`ai_import` după mig 290), iar PL1/PL2 „verificau"
-- promisiuni de preț pe date care nu mai existau.
do $$
declare v_bad text; v_n int;
begin
  with real as (
    select feature,
           string_agg(plan, ',' order by array_position(
             array['free','starter','growth','pro','enterprise'], plan)) as plans
      from public.plan_features
     where enabled
       and plan in ('free','starter','growth','pro','enterprise')
       and feature not like 'max\_%'
     group by feature
  ), frozen(feature, plans) as (values
    -- FIXTURE-BEGIN
    ('menu_qr',              'free,starter,growth,pro,enterprise'),
    ('themes',               'starter,growth,pro,enterprise'),
    ('order_qr',             'growth,pro,enterprise'),
    ('kitchen_tickets',      'growth,pro,enterprise'),
    ('waiter_manual',        'growth,pro,enterprise'),
    ('pickup_orders',        'growth,pro,enterprise'),
    ('table_lifecycle',      'growth,pro,enterprise'),
    ('loyalty',              'growth,pro,enterprise'),
    ('extras_pairings',      'growth,pro,enterprise'),
    ('modifiers',            'growth,pro,enterprise'),
    ('stocks',               'growth,pro,enterprise'),
    ('recipes',              'growth,pro,enterprise'),
    ('profitability',        'growth,pro,enterprise'),
    ('remove_branding',      'growth,pro,enterprise'),
    ('reports_pdf',          'growth,pro,enterprise'),
    ('reservations_revenue', 'growth,pro,enterprise'),
    ('sms_notifications',    'starter,growth,pro,enterprise'),
    ('analytics_advanced',   'pro,enterprise'),
    ('fiscal_receipt',       'pro,enterprise'),
    ('floor_plan',           'pro,enterprise'),
    ('online_payments',      'pro,enterprise'),
    ('reports_vat',          'pro,enterprise'),
    ('shifts',               'pro,enterprise'),
    ('split_bill',           'pro,enterprise')
    -- FIXTURE-END
  )
  select string_agg(coalesce(r.feature, f.feature) || ': db=' || coalesce(r.plans, '∅')
                    || ' fixtură=' || coalesce(f.plans, '∅'), '; '
                    order by coalesce(r.feature, f.feature) collate "C")
    into v_bad
    from real r full join frozen f on f.feature = r.feature
   where r.plans is distinct from f.plans;
  if v_bad is not null then
    raise exception 'PD5 FAIL: plan_features diferă de fixtura paginii de prețuri (actualizează planFeatureMatrix.fixture.ts ȘI blocul FIXTURE din PD5 în același PR): %', v_bad;
  end if;
  -- anti-vacuitate: DB-ul chiar are matricea (un restore gol ar da „egal" pe ∅)
  select count(distinct feature) into v_n from public.plan_features
   where enabled and feature not like 'max\_%';
  if v_n < 20 then
    raise exception 'PD5 FAIL (control +): doar % feature-uri active în plan_features', v_n;
  end if;
  raise notice 'PD5 OK: % feature-uri, matricea == fixtura', v_n;
end $$;

do $$ begin raise notice '════ plan dead data assertions (PD1–PD5): ALL PASS ════'; end $$;

rollback;
