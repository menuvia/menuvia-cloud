-- tests/sql/auto/334_fiscal_menu_currency_ron.sql
-- =============================================================================
-- FCR1–FCR8 — clichetul PERMANENT al mig 334 (lotul M1): pe un restaurant cu
-- BON FISCAL moneda meniului e RON, impusă în DATE. Rulează pe starea FINALĂ a
-- lanțului, NECONDIȚIONAT, din tests/sql/auto/ (scripts/run-sql-auto.sh, legat
-- în sql-verify.yml ȘI în jobul E2E din ci.yml — Postgres gol + stack-ul
-- Supabase real); autonom, ROLLBACK la final.
--
-- DE CE AICI ȘI NU DOAR ÎN MIGRAȚIE: blocul de asserții din 334 se evaluează o
-- SINGURĂ dată, la poziția 334 din lanț (clasa DP6 / VS8); o recreare viitoare
-- a uneia dintre proiecții care uită helperul ar trece de el.
--
-- Scrierile și apelurile oaspetelui rulează SUB rolurile REALE `authenticated`
-- / `anon`, prin `execute` DINAMIC: ca `postgres`, RLS și EXECUTE sunt ocolite
-- (un test „anon poate” ar fi vacuu). Comparațiile sunt `is distinct from`.
--
--   FCR1  SCRIERE sub `authenticated`: owner-ul ȘI managerul unui local RO pe
--         Plan 3 nu pot pune EUR (23514 / `fiscal_currency_ron_only`), rândul
--         rămâne RON; control POZITIV: growth RO pune EUR, Plan 3 din DE pune USD.
--         [PICĂ: trigger-ul șters / dezactivat; hint-ul schimbat]
--   FCR2  rândul IPOTETIC: INSERT RO+EUR pe Plan 3 respins, DE+EUR trece; pe
--         un local din DE, mutarea țării în RO cu EUR păstrat e respinsă, iar
--         țara+moneda schimbate ÎMPREUNĂ (RO→DE, RON→EUR, o singură salvare)
--         trec.
--         [PICĂ: gate-ul rezolvat pe `restaurant_has_feature(new.id, …)` (INSERT
--          trece, salvarea RO→DE e respinsă); `UPDATE OF currency` fără country
--          (DE→RO cu EUR trece)]
--   FCR3  CITIRE = autoritatea, scenariul de UPGRADE/DOWNGRADE, ca anon: un
--         local salvat cu EUR pe growth, urcat pe Plan 3 → TOATE cele patru
--         proiecții (slug, QR, compunerile 245) dau RON, deși rândul stocat e
--         EUR; coborât înapoi → EUR (alegerea owner-ului revine); Plan 3 din DE
--         → EUR (feature_requires_ro); growth → EUR; RON → RON.
--         [PICĂ: proiecția înapoi pe `r.currency` (drift → EUR); helperul care
--          întoarce mereu RON (growth/DE → RON); helperul pe plan, fără țară
--          (DE → RON)]
--   FCR4  un drift moștenit NU blochează o salvare fără legătură (formularul
--         trimite mereu moneda), dar o monedă NOUĂ ≠ RON rămâne respinsă, iar
--         RON vindecă rândul.
--         [PICĂ: scurtătura „moneda și țara neschimbate” scoasă (salvarea
--          numelui pică pe drift)]
--   FCR5  PARITATE: `restaurant_row_has_feature(owner, țară, f)` ==
--         `restaurant_has_feature(id, f)` pe fiecare restaurant al fixturii și
--         FIECARE feature din plan_features (anti-vacuitate: ≥ 20 de feature-uri).
--         [PICĂ: gate-ul de țară scos din helperul de rând; join pe alt plan]
--   FCR6  invarianții MOȘTENIȚI ai celor două proiecții recreate, pe ieșirea
--         reală ca anon: parola de wifi și token-ul legacy nu se scurg (217),
--         `menu_languages` (219), badge-ul și ridicarea gate-uite la citire după
--         DOWNGRADE (281/309), `country` (298), slug case-insensitive (148);
--         QR: cele 13 chei EXACTE (326), gate-ul `order_qr` (127).
--         [PICĂ: oricare invariant pierdut la o recreare viitoare]
--   FCR7  CATALOG: helperii și funcția de trigger DEFINER cu `public, pg_temp`,
--         ZERO EXECUTE pentru anon/authenticated/service_role (RP13/AH1/CJ9), un
--         apel REAL ca anon pe helper → 42501; trigger-ul BEFORE INSERT OR
--         UPDATE OF (country, currency) ROW (tgtype 23), pornit; o semnătură per
--         proiecție, apelabile de anon+authenticated; helperul de citire trece
--         prin `restaurant_has_feature` (pe COD, fără comentarii).
--         [PICĂ: grant pe helper; trigger `after`/fără `country`; helperul cu
--          citire directă a tabelei de feature-uri]
--   FCR8  CLASĂ: orice funcție din `public` apelabilă de anon al cărei COD
--         pomenește `currency` e în registru (azi: get_restaurant_by_slug,
--         resolve_qr_token) și trece moneda prin `public_menu_currency(`;
--         compunerile 245 nu o pomenesc deloc (o moștenesc). Anti-vacuitate:
--         ambele intrări trebuie găsite.
--         [PICĂ: o proiecție anon nouă care scoate moneda brut]
--
-- Mutații verificate pe un cluster de replay (fiecare pică, prima asserție
-- atinsă în paranteză): proiecția slug pe `r.currency` brut (FCR3); proiecția
-- QR pe `r.currency` brut (FCR3); trigger-ul șters (FCR1); helperul de citire
-- care întoarce mereu RON (FCR3, downgrade); helperul de citire pe plan, fără
-- țară (FCR3, Plan 3 din DE); gate-ul de scriere pe
-- `restaurant_has_feature(new.id, …)` (FCR2, INSERT); `UPDATE OF currency`
-- fără `country` (FCR2); scurtătura „moneda și țara neschimbate” scoasă
-- (FCR4); `grant execute` pe helper către anon (FCR7); helperul de rând fără
-- gate de țară (fixtura: localul Plan 3 din DE cu EUR e respins la INSERT).
-- =============================================================================

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- Paritate cu stack-ul Supabase (prod + jobul E2E): acolo `authenticated` are
-- USAGE pe schema `auth`, iar bootstrap-ul din sql-verify nu i-l dă. Trigger-ul
-- de țară (296, NE-definer) citește `auth.uid()` SUB rolul apelantului, deci
-- fără grant prima lui planificare sub `authenticated` pică pe „permission
-- denied for schema auth” — un artefact de mediu, nu ce testăm aici. Grant-ul
-- e în tranzacția suitei (ROLLBACK la final) și se dă DOAR unde lipsește: pe
-- stack-ul Supabase `authenticated` îl are deja, iar `postgres` nu e acolo
-- proprietarul schemei. Fără el, FCR2 pică pe 42501 — verificat.
do $$
begin
  if not has_schema_privilege('authenticated', 'auth', 'usage') then
    grant usage on schema auth to authenticated;
  end if;
end $$;

-- `enforce_restaurant_limit` (131): pro = 2 localuri, growth = 1.
--   O1/R_PRO   pro, RO, RON (+ managerul M)       — gate-ul de scriere
--   O2/R_GR    growth, RO                          — control pozitiv; FCR6 (downgrade)
--   O3/R_DE    pro, DE, EUR                        — feature_requires_ro
--   O4/R_DRIFT growth → pro, RO, EUR salvat       — upgrade/downgrade (FCR3/FCR4)
--   M          manager pe R_PRO
insert into auth.users (id, email) values
  ('33400000-0000-4000-8000-000000000001', 'fcr-o1@fcr334.test'),
  ('33400000-0000-4000-8000-000000000002', 'fcr-o2@fcr334.test'),
  ('33400000-0000-4000-8000-000000000003', 'fcr-o3@fcr334.test'),
  ('33400000-0000-4000-8000-000000000004', 'fcr-o4@fcr334.test'),
  ('33400000-0000-4000-8000-000000000005', 'fcr-m@fcr334.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'fcr-%@fcr334.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'pro'
 where id in ('33400000-0000-4000-8000-000000000001', '33400000-0000-4000-8000-000000000003');
update public.profiles set plan = 'growth'
 where id in ('33400000-0000-4000-8000-000000000002', '33400000-0000-4000-8000-000000000004');

insert into public.restaurants
  (id, owner_id, name, slug, city, is_active, country, currency, timezone,
   wifi_password, qr_token, menu_languages, pickup_settings)
values
  ('334b0000-0000-4000-8000-000000000001', '33400000-0000-4000-8000-000000000001',
   'FCR Pro', 'fcr334-pro', 'Cluj', true, 'RO', 'RON', 'Europe/Bucharest',
   'fcr334-wifi', 'fcr334-legacy', '["ro","en"]'::jsonb, null),
  ('334b0000-0000-4000-8000-000000000002', '33400000-0000-4000-8000-000000000002',
   'FCR Growth', 'fcr334-gr', 'Cluj', true, 'RO', 'RON', 'Europe/Bucharest',
   null, null, '[]'::jsonb, '{"enabled": true, "min_lead_time_minutes": 20}'::jsonb),
  ('334b0000-0000-4000-8000-000000000003', '33400000-0000-4000-8000-000000000003',
   'FCR Berlin', 'fcr334-de', 'Berlin', true, 'DE', 'EUR', 'Europe/Berlin',
   null, null, '[]'::jsonb, null),
  -- Salvat cu EUR cât owner-ul e pe growth (gate-ul îl lasă — fără bon fiscal).
  ('334b0000-0000-4000-8000-000000000004', '33400000-0000-4000-8000-000000000004',
   'FCR Drift', 'fcr334-drift', 'Cluj', true, 'RO', 'EUR', 'Europe/Bucharest',
   null, null, '[]'::jsonb, null);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('334b0000-0000-4000-8000-000000000001', '33400000-0000-4000-8000-000000000005', 'manager');

-- Tema cu badge-ul ascuns pe growth (are remove_branding; gate-ul de scriere
-- 225 o lasă) — FCR6 o coboară pe free.
update public.restaurants
   set theme_settings = '{"hide_branding": true, "accent": "#334334"}'::jsonb
 where id = '334b0000-0000-4000-8000-000000000002';

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('334c0000-0000-4000-8000-000000000001', '334b0000-0000-4000-8000-000000000001', 'Masa Pro',   'fcr-masa-pro',   4, true),
  ('334c0000-0000-4000-8000-000000000002', '334b0000-0000-4000-8000-000000000002', 'Masa Gr',    'fcr-masa-gr',    4, true),
  ('334c0000-0000-4000-8000-000000000003', '334b0000-0000-4000-8000-000000000003', 'Masa DE',    'fcr-masa-de',    4, true),
  ('334c0000-0000-4000-8000-000000000004', '334b0000-0000-4000-8000-000000000004', 'Masa Drift', 'fcr-masa-drift', 4, true);
insert into public.qr_tokens (token, restaurant_id, table_id, is_active, expires_at) values
  ('fcr334-tok-pro',   '334b0000-0000-4000-8000-000000000001', '334c0000-0000-4000-8000-000000000001', true, null),
  ('fcr334-tok-gr',    '334b0000-0000-4000-8000-000000000002', '334c0000-0000-4000-8000-000000000002', true, null),
  ('fcr334-tok-de',    '334b0000-0000-4000-8000-000000000003', '334c0000-0000-4000-8000-000000000003', true, null),
  ('fcr334-tok-drift', '334b0000-0000-4000-8000-000000000004', '334c0000-0000-4000-8000-000000000004', true, null);

-- Urcarea pe Plan 3 cu EUR salvat: planul stă pe `profiles`, deci nimic nu
-- atinge rândul restaurantului — exact starea pe care doar CITIREA o vede.
update public.profiles set plan = 'pro' where id = '33400000-0000-4000-8000-000000000004';

-- Control de fixtură: starea stocată e cea așteptată (fără ea restul e vacuu).
do $$
begin
  if (select currency from public.restaurants where id = '334b0000-0000-4000-8000-000000000004') is distinct from 'EUR'
     or not public.restaurant_has_feature('334b0000-0000-4000-8000-000000000004', 'fiscal_receipt')
     or not public.restaurant_has_feature('334b0000-0000-4000-8000-000000000001', 'fiscal_receipt')
     or public.restaurant_has_feature('334b0000-0000-4000-8000-000000000003', 'fiscal_receipt')
     or public.restaurant_has_feature('334b0000-0000-4000-8000-000000000002', 'fiscal_receipt') then
    raise exception 'FIXTURA: drift-ul (Plan 3 cu EUR) sau feature-urile nu sunt cum se aștepta — suita ar fi vacuă';
  end if;
end $$;

-- ── Helperi ──────────────────────────────────────────────────────────────────
-- Execută un statement SUB rolul dat, ca utilizatorul dat. NULL = a trecut,
-- altfel 'SQLSTATE/hint'. `set_config('role', …)` stă ÎN AFARA sub-blocului cu
-- excepție: în interior s-ar derula înapoi odată cu subtranzacția.
create function pg_temp.fcr_exec(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $f$
declare v text; v_state text; v_hint text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
    v := null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    v := v_state || '/' || coalesce(v_hint, '');
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

-- O expresie jsonb SUB rolul dat. {raised, sqlstate, error} dacă aruncă.
create function pg_temp.fcr_json(p_role text, p_sql text) returns jsonb
language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute 'select (' || p_sql || ')::jsonb' into v;
  exception when others then
    v := jsonb_build_object('raised', true, 'sqlstate', sqlstate, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

-- Moneda pe care o vede oaspetele ANONIM, pe fiecare dintre cele 4 proiecții.
create function pg_temp.fcr_seen(p_slug text, p_token text) returns text[]
language sql as $f$
  select array[
    pg_temp.fcr_json('anon', format('(select to_jsonb(x) from public.get_restaurant_by_slug(%L) x)', p_slug)) ->> 'currency',
    pg_temp.fcr_json('anon', format('public.resolve_qr_token(%L)', p_token)) #>> '{restaurant,currency}',
    pg_temp.fcr_json('anon', format('public.get_menu_by_slug(%L)', p_slug)) #>> '{restaurant,currency}',
    pg_temp.fcr_json('anon', format('public.resolve_qr_menu(%L)', p_token)) #>> '{resolved,restaurant,currency}'
  ]
$f$;

-- CODUL unei funcții, fără comentarii, cu literalele de șir PĂSTRATE (pu_code, 309).
create function pg_temp.fcr_code(p_src text) returns text
language sql immutable as $f$
  select regexp_replace(p_src,
           $re$('([^']|'')*')|--[^\n]*|/\*([^*]|\*+[^*/])*\*+/$re$, '\1', 'g')
$f$;

-- ── FCR1: gate-ul de scriere, sub rolul REAL authenticated ──────────────────
do $$
declare
  c_pro constant uuid := '334b0000-0000-4000-8000-000000000001';
  v text;
begin
  v := pg_temp.fcr_exec('authenticated', '33400000-0000-4000-8000-000000000001',
         format('update public.restaurants set currency = %L where id = %L', 'EUR', c_pro));
  if v is distinct from '23514/fiscal_currency_ron_only' then
    raise exception 'FCR1 FAIL: owner-ul unui local RO pe Plan 3 a pus EUR (rezultat: %)', coalesce(v, 'TRECUT');
  end if;
  v := pg_temp.fcr_exec('authenticated', '33400000-0000-4000-8000-000000000005',
         format('update public.restaurants set currency = %L where id = %L', 'USD', c_pro));
  if v is distinct from '23514/fiscal_currency_ron_only' then
    raise exception 'FCR1 FAIL: managerul unui local RO pe Plan 3 a pus USD (rezultat: %)', coalesce(v, 'TRECUT');
  end if;
  if (select currency from public.restaurants where id = c_pro) is distinct from 'RON' then
    raise exception 'FCR1 FAIL: rândul nu mai e RON după refuz';
  end if;

  -- Control POZITIV: fără bon fiscal moneda rămâne liberă.
  v := pg_temp.fcr_exec('authenticated', '33400000-0000-4000-8000-000000000002',
         format('update public.restaurants set currency = %L where id = %L', 'EUR',
                '334b0000-0000-4000-8000-000000000002'));
  if v is not null then
    raise exception 'FCR1 FAIL (control): growth RO nu mai poate pune EUR (%)', v;
  end if;
  v := pg_temp.fcr_exec('authenticated', '33400000-0000-4000-8000-000000000003',
         format('update public.restaurants set currency = %L where id = %L', 'USD',
                '334b0000-0000-4000-8000-000000000003'));
  if v is not null then
    raise exception 'FCR1 FAIL (control): Plan 3 din DE nu mai poate pune USD (%)', v;
  end if;
  if (select currency from public.restaurants where id = '334b0000-0000-4000-8000-000000000002') is distinct from 'EUR'
     or (select currency from public.restaurants where id = '334b0000-0000-4000-8000-000000000003') is distinct from 'USD' then
    raise exception 'FCR1 FAIL (control): UPDATE-urile permise nu s-au scris (RLS / grant pe coloană?)';
  end if;
  update public.restaurants set currency = 'EUR' where id = '334b0000-0000-4000-8000-000000000003';
  raise notice 'FCR1 PASS: owner și manager respinși pe Plan 3 RO; growth și Plan 3 din DE liberi';
end $$;

-- ── FCR2: rândul IPOTETIC (owner + țara NOUĂ) ────────────────────────────────
do $$
declare
  c_de constant uuid := '334b0000-0000-4000-8000-000000000003';
  c_o3 constant uuid := '33400000-0000-4000-8000-000000000003';
  v text;
begin
  -- INSERT (ca postgres — gate-ul e pe TOATE rolurile): rândul nu e încă în tabelă.
  v := pg_temp.fcr_exec('postgres', null, $s$
    insert into public.restaurants (id, owner_id, name, slug, city, is_active, country, currency)
    values ('334b0000-0000-4000-8000-0000000000a1', '33400000-0000-4000-8000-000000000001',
            'FCR Nou RO', 'fcr334-nou-ro', 'Cluj', true, 'RO', 'EUR')$s$);
  if v is distinct from '23514/fiscal_currency_ron_only' then
    raise exception 'FCR2 FAIL: INSERT RO+EUR pe Plan 3 a trecut (rezultat: %) — gate-ul nu vede rândul nou?', coalesce(v, 'TRECUT');
  end if;
  v := pg_temp.fcr_exec('postgres', null, $s$
    insert into public.restaurants (id, owner_id, name, slug, city, is_active, country, currency)
    values ('334b0000-0000-4000-8000-0000000000a2', '33400000-0000-4000-8000-000000000001',
            'FCR Nou DE', 'fcr334-nou-de', 'Berlin', true, 'DE', 'EUR')$s$);
  if v is not null then
    raise exception 'FCR2 FAIL (control): INSERT DE+EUR pe Plan 3 respins (%)', v;
  end if;

  -- DE → RO cu EUR păstrat: tranziția intră în starea interzisă prin ȚARĂ.
  v := pg_temp.fcr_exec('authenticated', c_o3,
         format('update public.restaurants set country = %L where id = %L', 'RO', c_de));
  if v is distinct from '23514/fiscal_currency_ron_only' then
    raise exception 'FCR2 FAIL: mutarea țării în RO cu EUR păstrat a trecut (rezultat: %)', coalesce(v, 'TRECUT');
  end if;
  -- Control: țara + RON împreună trec.
  v := pg_temp.fcr_exec('authenticated', c_o3,
         format('update public.restaurants set country = %L, currency = %L where id = %L', 'RO', 'RON', c_de));
  if v is not null then
    raise exception 'FCR2 FAIL (control): DE→RO cu RON respins (%)', v;
  end if;
  -- RO → DE și RON → EUR în ACEEAȘI salvare (SettingsTab / locația nouă): tabela
  -- arată încă RO, dar rândul NOU e în DE — trebuie să treacă.
  v := pg_temp.fcr_exec('authenticated', c_o3,
         format('update public.restaurants set country = %L, currency = %L where id = %L', 'DE', 'EUR', c_de));
  if v is not null then
    raise exception 'FCR2 FAIL: salvarea RO→DE + EUR într-un singur UPDATE e respinsă (%) — gate-ul citește rândul VECHI?', v;
  end if;
  if (select country || '/' || currency from public.restaurants where id = c_de) is distinct from 'DE/EUR' then
    raise exception 'FCR2 FAIL (control): R_DE nu a ajuns DE/EUR';
  end if;
  raise notice 'FCR2 PASS: INSERT și schimbarea de țară judecate pe rândul NOU';
end $$;

-- ── FCR3: citirea e autoritatea (upgrade / downgrade), ca anon ──────────────
do $$
declare
  v text[];
begin
  -- Drift: Plan 3 RO cu EUR STOCAT → toate proiecțiile RON.
  v := pg_temp.fcr_seen('fcr334-drift', 'fcr334-tok-drift');
  if v is distinct from array['RON','RON','RON','RON'] then
    raise exception 'FCR3 FAIL: Plan 3 RO cu EUR salvat arată oaspetelui % (slug, QR, meniu slug, meniu QR)', v;
  end if;
  if (select currency from public.restaurants where id = '334b0000-0000-4000-8000-000000000004') is distinct from 'EUR' then
    raise exception 'FCR3 FAIL: gate-ul de citire a RESCRIS rândul stocat';
  end if;

  -- DOWNGRADE: alegerea owner-ului revine.
  update public.profiles set plan = 'growth' where id = '33400000-0000-4000-8000-000000000004';
  v := pg_temp.fcr_seen('fcr334-drift', 'fcr334-tok-drift');
  if v is distinct from array['EUR','EUR','EUR','EUR'] then
    raise exception 'FCR3 FAIL: după downgrade oaspetele vede % în loc de EUR (helperul întoarce mereu RON?)', v;
  end if;
  update public.profiles set plan = 'pro' where id = '33400000-0000-4000-8000-000000000004';
  v := pg_temp.fcr_seen('fcr334-drift', 'fcr334-tok-drift');
  if v is distinct from array['RON','RON','RON','RON'] then
    raise exception 'FCR3 FAIL: după re-urcare oaspetele vede %', v;
  end if;

  -- Plan 3 din DE: feature-urile românești nu există acolo → moneda lui.
  v := pg_temp.fcr_seen('fcr334-de', 'fcr334-tok-de');
  if v is distinct from array['EUR','EUR','EUR','EUR'] then
    raise exception 'FCR3 FAIL: Plan 3 din DE arată % (gate-ul de țară din 296 ocolit?)', v;
  end if;
  -- growth (RO, EUR din FCR1): fără bon fiscal → EUR.
  v := pg_temp.fcr_seen('fcr334-gr', 'fcr334-tok-gr');
  if v is distinct from array['EUR','EUR','EUR','EUR'] then
    raise exception 'FCR3 FAIL: growth RO cu EUR arată %', v;
  end if;
  -- Plan 3 RO cu RON → RON (calea comună).
  v := pg_temp.fcr_seen('fcr334-pro', 'fcr334-tok-pro');
  if v is distinct from array['RON','RON','RON','RON'] then
    raise exception 'FCR3 FAIL: Plan 3 RO cu RON arată %', v;
  end if;
  raise notice 'FCR3 PASS: proiecțiile anon dau RON pe bon fiscal, moneda stocată în rest';
end $$;

-- ── FCR4: drift-ul nu blochează o salvare fără legătură ─────────────────────
do $$
declare
  c_dr constant uuid := '334b0000-0000-4000-8000-000000000004';
  c_o4 constant uuid := '33400000-0000-4000-8000-000000000004';
  v text;
begin
  -- Ce trimite SettingsTab: tot formularul, cu moneda și țara NESCHIMBATE.
  v := pg_temp.fcr_exec('authenticated', c_o4,
         format('update public.restaurants set name = %L, currency = %L, country = %L where id = %L',
                'FCR Drift 2', 'EUR', 'RO', c_dr));
  if v is not null then
    raise exception 'FCR4 FAIL: o salvare fără legătură pe un drift moștenit e respinsă (%)', v;
  end if;
  if (select name from public.restaurants where id = c_dr) is distinct from 'FCR Drift 2' then
    raise exception 'FCR4 FAIL (control): salvarea nu s-a scris';
  end if;
  -- O monedă NOUĂ ≠ RON rămâne interzisă.
  v := pg_temp.fcr_exec('authenticated', c_o4,
         format('update public.restaurants set currency = %L where id = %L', 'USD', c_dr));
  if v is distinct from '23514/fiscal_currency_ron_only' then
    raise exception 'FCR4 FAIL: pe drift, USD a trecut (rezultat: %)', coalesce(v, 'TRECUT');
  end if;
  -- RON vindecă rândul.
  v := pg_temp.fcr_exec('authenticated', c_o4,
         format('update public.restaurants set currency = %L where id = %L', 'RON', c_dr));
  if v is not null
     or (select currency from public.restaurants where id = c_dr) is distinct from 'RON' then
    raise exception 'FCR4 FAIL: RON nu vindecă rândul (%)', v;
  end if;
  raise notice 'FCR4 PASS: drift-ul nu blochează salvarea; moneda nouă ≠ RON respinsă; RON vindecă';
end $$;

-- ── FCR5: paritatea helperului de rând cu punctul de trecere (296) ──────────
do $$
declare
  v_bad text;
  v_n   int;
begin
  select count(distinct feature) into v_n from public.plan_features;
  if v_n < 20 then
    raise exception 'FCR5 FAIL (anti-vacuitate): plan_features are doar % feature-uri', v_n;
  end if;
  select string_agg(r.slug || ':' || f.feature, ', ') into v_bad
    from public.restaurants r
   cross join (select distinct feature from public.plan_features) f
   where r.slug like 'fcr334-%'
     and public.restaurant_row_has_feature(r.owner_id, r.country, f.feature)
         is distinct from public.restaurant_has_feature(r.id, f.feature);
  if v_bad is not null then
    raise exception 'FCR5 FAIL: restaurant_row_has_feature diverge de restaurant_has_feature pe: %', v_bad;
  end if;
  -- Și pe un rând IPOTETIC: același owner pe Plan 3, altă țară.
  if public.restaurant_row_has_feature('33400000-0000-4000-8000-000000000001', 'DE', 'fiscal_receipt')
     or not public.restaurant_row_has_feature('33400000-0000-4000-8000-000000000001', 'DE', 'order_qr')
     or not public.restaurant_row_has_feature('33400000-0000-4000-8000-000000000003', 'RO', 'fiscal_receipt') then
    raise exception 'FCR5 FAIL: gate-ul de țară pe rândul ipotetic nu e cel din 296';
  end if;
  raise notice 'FCR5 PASS: helperul de rând == restaurant_has_feature pe % feature-uri', v_n;
end $$;

-- ── FCR6: invarianții moșteniți ai proiecțiilor recreate ────────────────────
do $$
declare
  v_slug jsonb;
  v_qr   jsonb;
  v_gr   jsonb;
  v_keys text;
begin
  v_slug := pg_temp.fcr_json('anon', $s$(select to_jsonb(x) from public.get_restaurant_by_slug('FCR334-PRO') x)$s$);
  if v_slug ->> 'id' is distinct from '334b0000-0000-4000-8000-000000000001' then
    raise exception 'FCR6 FAIL: slug-ul case-insensitive (148) s-a pierdut: %', v_slug;
  end if;
  if v_slug ->> 'wifi_password' is not null or v_slug ->> 'qr_token' is not null
     or position('fcr334-wifi' in v_slug::text) > 0 or position('fcr334-legacy' in v_slug::text) > 0 then
    raise exception 'FCR6 FAIL: wifi_password / qr_token s-au scurs la anon (217): %', v_slug;
  end if;
  if v_slug -> 'menu_languages' is distinct from '["ro","en"]'::jsonb
     or v_slug ->> 'country' is distinct from 'RO' then
    raise exception 'FCR6 FAIL: menu_languages (219) sau country (298) lipsesc: %', v_slug;
  end if;

  v_qr := pg_temp.fcr_json('anon', $s$public.resolve_qr_token('fcr334-tok-pro')$s$);
  select string_agg(k, ',' order by k collate "C") into v_keys
    from jsonb_object_keys(v_qr -> 'restaurant') k;
  if v_keys is distinct from
     'address,checkout_suggestion_settings,currency,hours,id,language,logo_url,menu_languages,name,phone,primary_color,theme_settings,timezone' then
    raise exception 'FCR6 FAIL: forma proiecției QR s-a schimbat (326): %', v_keys;
  end if;
  if position('fcr334-wifi' in v_qr::text) > 0 or position('fcr334-legacy' in v_qr::text) > 0 then
    raise exception 'FCR6 FAIL: proiecția QR scurge wifi / token-ul legacy';
  end if;
  if (v_qr ->> 'orderingAllowed')::boolean is distinct from true then
    raise exception 'FCR6 FAIL (control): pe Plan 3 comanda QR e închisă: %', v_qr -> 'orderingAllowed';
  end if;

  -- DOWNGRADE pe free: badge-ul, ridicarea și comanda QR se re-verifică la citire.
  update public.profiles set plan = 'free' where id = '33400000-0000-4000-8000-000000000002';
  v_gr := pg_temp.fcr_json('anon', $s$(select to_jsonb(x) from public.get_restaurant_by_slug('fcr334-gr') x)$s$);
  if v_gr #> '{theme_settings,hide_branding}' is not distinct from 'true'::jsonb
     or v_gr #>> '{theme_settings,accent}' is distinct from '#334334' then
    raise exception 'FCR6 FAIL: gate-ul de branding la citire (281) s-a pierdut: %', v_gr -> 'theme_settings';
  end if;
  if v_gr #> '{pickup_settings,enabled}' is distinct from 'false'::jsonb then
    raise exception 'FCR6 FAIL: gate-ul de ridicare la citire (309) s-a pierdut: %', v_gr -> 'pickup_settings';
  end if;
  if (pg_temp.fcr_json('anon', $s$public.resolve_qr_token('fcr334-tok-gr')$s$) ->> 'orderingAllowed')::boolean
       is distinct from false then
    raise exception 'FCR6 FAIL: gate-ul order_qr (127) lasă comanda pe free';
  end if;
  raise notice 'FCR6 PASS: invarianții 148/217/219/281/298/309/326/127 moșteniți';
end $$;

-- ── FCR7: catalog ────────────────────────────────────────────────────────────
do $$
declare
  v_fn  text;
  v_bad text;
  v_src text;
  v_n   int;
  v_err text;
begin
  foreach v_fn in array array[
    'public.public_menu_currency(uuid,text)',
    'public.restaurant_row_has_feature(uuid,text,text)',
    'public.enforce_fiscal_menu_currency_ron()'
  ] loop
    if not exists (select 1 from pg_proc
                    where oid = v_fn::regprocedure and prosecdef
                      and 'search_path=public, pg_temp' = any (proconfig)) then
      raise exception 'FCR7 FAIL: % nu e DEFINER cu search_path = public, pg_temp', v_fn;
    end if;
    select string_agg(r.rol, ', ') into v_bad
      from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
     where has_function_privilege(r.rol, v_fn, 'execute');
    if v_bad is not null then
      raise exception 'FCR7 FAIL: % e executabil de %', v_fn, v_bad;
    end if;
  end loop;

  -- Apel REAL ca anon pe helper (nu doar catalog): refuz pe FUNCȚIE.
  perform set_config('role', 'anon', true);
  begin
    perform public.public_menu_currency('334b0000-0000-4000-8000-000000000001', 'EUR');
    v_err := 'TRECUT';
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('role', 'none', true);
  if v_err not like '42501%for function%' then
    raise exception 'FCR7 FAIL: anon a putut chema helperul de citire (%)', v_err;
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.restaurants'::regclass
       and t.tgname = 'trg_restaurants_fiscal_currency_ron'
       and t.tgtype = 23 and t.tgenabled = 'O'
       and t.tgfoid = 'public.enforce_fiscal_menu_currency_ron()'::regprocedure
       and (select array_agg(a.attname::text order by a.attname::text collate "C")
              from pg_attribute a
             where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[]))
           = array['country', 'currency']
  ) then
    raise exception 'FCR7 FAIL: trigger-ul de monedă lipsește sau are altă formă (BEFORE INSERT OR UPDATE OF country, currency ROW)';
  end if;

  foreach v_fn in array array['get_restaurant_by_slug', 'resolve_qr_token',
                              'public_menu_currency', 'restaurant_row_has_feature'] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'FCR7 FAIL: % are % semnături (anti PGRST203: exact 1)', v_fn, v_n;
    end if;
  end loop;
  foreach v_fn in array array['public.get_restaurant_by_slug(text)', 'public.resolve_qr_token(text)',
                              'public.get_menu_by_slug(text)', 'public.resolve_qr_menu(text)'] loop
    if not has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'FCR7 FAIL: % nu mai e apelabilă de anon/authenticated', v_fn;
    end if;
  end loop;

  select pg_temp.fcr_code(prosrc) into v_src
    from pg_proc where oid = 'public.public_menu_currency(uuid,text)'::regprocedure;
  if position($q$restaurant_has_feature(p_restaurant_id, 'fiscal_receipt')$q$ in v_src) = 0
     or position('plan_features' in v_src) > 0 then
    raise exception 'FCR7 FAIL: helperul de citire nu mai trece prin restaurant_has_feature (gate-ul de țară 296)';
  end if;
  raise notice 'FCR7 PASS: helperi interni, trigger în formă, proiecții publice';
end $$;

-- ── FCR8: clasă — cine mai scoate moneda la anon ────────────────────────────
do $$
declare
  v_registry text[] := array['get_restaurant_by_slug', 'resolve_qr_token'];
  v_found    text[];
  v_raw      text;
begin
  select array_agg(p.proname::text order by p.proname::text collate "C") into v_found
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
     and pg_temp.fcr_code(p.prosrc) ~* 'currency';
  if v_found is distinct from
     (select array_agg(x order by x collate "C") from unnest(v_registry) x) then
    raise exception 'FCR8 FAIL: funcțiile anon care pomenesc moneda: % (registru: %) — o proiecție nouă trece prin public_menu_currency și intră în registru', v_found, v_registry;
  end if;
  -- Fiecare intrare trece moneda prin helper și n-o mai scoate brut.
  select string_agg(p.proname, ', ') into v_raw
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (v_registry)
     and (position('public.public_menu_currency(r.id, r.currency)' in pg_temp.fcr_code(p.prosrc)) = 0
          or (length(pg_temp.fcr_code(p.prosrc)) - length(replace(pg_temp.fcr_code(p.prosrc), 'r.currency', '')))
             / length('r.currency') <> 1);
  if v_raw is not null then
    raise exception 'FCR8 FAIL: % scot moneda pe lângă helper', v_raw;
  end if;
  raise notice 'FCR8 PASS: % proiecții anon cu monedă, toate prin public_menu_currency', array_length(v_found, 1);
end $$;

rollback;
