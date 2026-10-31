-- tests/sql/auto/309_public_pickup_read_gate.sql
-- =============================================================================
-- PU1–PU10 — clichetul PERMANENT al mig 309: ridicarea pe /m/:slug se
-- gate-uiește la CITIRE (`public_pickup_settings`), ca `hide_branding` în 281.
-- Rulează din tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii
-- (Postgres gol din sql-verify + stack-ul Supabase din E2E). Autonom, ROLLBACK
-- la final.
--
-- DE CE AICI ȘI NU DOAR ÎN MIGRAȚIE: blocul din corpul mig 309 se evaluează o
-- SINGURĂ dată, la poziția 309 din lanț (clasa DP6 / VS8). Fișierul ăsta
-- rulează la FIECARE replay, pe starea FINALĂ a lanțului.
--
-- Apelurile oaspetelui se fac SUB rolul REAL `anon` (și `authenticated` pentru
-- un cont fără restaurant): ca `postgres`, EXECUTE e ocolit, deci „helperul nu e
-- apelabil" ar fi vacuu (clasa PF/TP24). Planul se schimbă ÎNAPOI ca postgres.
--
--   PU1  Scenariul de DOWNGRADE pe `get_restaurant_by_slug` — singurul în care
--        gate-ul face muncă reală (tiparul PB1/PM6): același rând stocat cu
--        `enabled=true` se citește `true` pe growth (CONTROL POZITIV), `false`
--        pe starter și pe free, cu TOATE celelalte chei identice cu cele
--        stocate; rândul din tabelă rămâne neatins; re-urcarea pe growth
--        reactivează ridicarea.
--        [PICĂ: proiecția revine la `r.pickup_settings` brut (mutația a);
--         helperul ignoră feature-ul — fie nu normalizează niciodată (a doua
--         jumătate), fie normalizează mereu (controlul pozitiv) (mutația b)]
--   PU2  Gate-ul de CITIRE spune exact ce face gate-ul de COMANDĂ: pe starter
--        proiecția zice „oprit” ȘI `create_order(pickup)` real, ca anon, e
--        refuzat cu hint `plan_upgrade_required`; pe growth proiecția zice
--        „pornit” ȘI aceeași comandă trece. Fără a doua jumătate, PU1 ar putea
--        trece pe un gate care ascunde ridicarea și când ea chiar merge.
--        [PICĂ: mutația a / b. NU prinde un feature GREȘIT în helper dacă are
--         ACELAȘI rând de plan ca `pickup_orders` (order_qr, remove_branding,
--         loyalty, kitchen_tickets… — free/starter/growth nu le pot distinge):
--         asta e treaba lui PU10]
--   PU3  `get_menu_by_slug` (245, compunere PURĂ) moștenește gate-ul — calea
--        pe care o folosește PublicMenuPage întâi.
--        [PICĂ: mutația a; o recreare a lui 245 care citește tabela direct]
--   PU4  „Oprit” rămâne oprit și NULL rămâne NULL, BYTE-identic, pe ambele
--        planuri (gate-ul nu inventează și nu rescrie).
--        [PICĂ: un helper care transformă NULL în obiect / inventează cheia
--         (ex. `coalesce(p, '{}') || '{"enabled":false}'`) sau rescrie restul]
--   PU5  Matricea helperului: fără feature, ORICE valoare pe care clientul o
--        tratează ca adevărată (true, "true", 1, "false") devine `false`; JSON
--        false / JSON null / cheie absentă / scalar / array / NULL rămân
--        neatinse; un id inexistent e „fără feature” (fail-closed); CU feature,
--        totul trece neschimbat.
--        [PICĂ: comparație strictă `= 'true'::jsonb` (șirul "true" ar trece);
--         un `::boolean` (ar arunca pe "da"); o cheie inventată]
--   PU6  `pickup_orders` NU e feature românesc (`feature_requires_ro`, 296):
--        un local growth cu țara DE păstrează ridicarea — control pozitiv
--        contra unui gate prea zelos (ex. pe nivelul de bani).
--        [PICĂ: helperul rezolvat pe un predicat de țară / nivel de bani]
--   PU7  Suprafața: helperul NU e apelabil de anon / authenticated /
--        service_role — apel REAL, eroare pe FUNCȚIE (nu pe schemă); o singură
--        semnătură, DEFINER + `search_path = public, pg_temp`. Proiecția rămâne
--        apelabilă de anon ȘI de un `authenticated` fără restaurant (oaspete
--        logat), care vede ACEEAȘI vedere gate-uită.
--        [PICĂ: `grant execute on public_pickup_settings to anon` (mutația c)]
--   PU8  CLICHET DE CLASĂ prin descoperire, pe DOUĂ detectoare. (1) Literal:
--        setul funcțiilor din `public` apelabile de anon al căror corp pomenește
--        `pickup_settings` e EXACT registrul de mai jos (fiecare cu motiv).
--        (2) RÂNDUL ÎNTREG: o funcție nouă scrisă `to_jsonb(r)` / `r.*` /
--        `select * from restaurants` / `returns setof restaurants` / variabilă
--        `restaurants%rowtype` nu pomenește NICIODATĂ numele coloanei, dar
--        proiectează `pickup_settings` brut (și `theme_settings` fără 281,
--        `wifi_password`/`qr_token` fără 217) — setul acestora, apelabile de
--        anon, trebuie să fie GOL (sau în registru, cu motiv). Plus: niciun view
--        citibil de anon nu poartă coloana, iar tabela `restaurants` nu e
--        citibilă de anon. Control POZITIV pe fiecare detector (sonde noi
--        TREBUIE prinse: una pe literal, patru pe formele rândului întreg) și
--        NEGATIV (o sondă care pomenește `to_jsonb(r)`/`r.*` doar în COMENTARII
--        nu e prinsă — detectorul citește codul, nu comentariile).
--        [PICĂ: o proiecție anon nouă pe rândul întreg; un detector care nu
--         mai prinde sondele]
--   PU9  Invariantele MOȘTENITE de copia verbatim (pe IEȘIREA reală, ca anon):
--        `wifi_password`/`qr_token` NULL deși stocate (217), `menu_languages`
--        (219), gate-ul de branding (281), slug case-insensitive (148), `country`
--        (298); sursa (pe COD, fără comentarii): helperul folosit,
--        `r.pickup_settings` o SINGURĂ dată. Centura TEXTUALĂ „același feature
--        în 290 și 309” stă tot aici, dar autoritatea e PU10 (comportament).
--   PU10 Același feature în gate-ul de CITIRE și în cel de COMANDĂ, pe
--        COMPORTAMENT (în tranzacția suitei, deci derulat la ROLLBACK): stins
--        DOAR `pickup_orders` pe growth → proiecția zice „oprit” ȘI
--        `create_order(pickup)` ca anon e refuzat cu `plan_upgrade_required`.
--        Contra-control: oricare ALT feature activ pe growth, stins pe rând,
--        NU atinge proiecția; cu `order_qr` stins, comanda de ridicare trece.
--        PU9 se potrivea pe TEXT (și pe comentarii): un helper cu
--        `'remove_branding'` în cod și `'pickup_orders'` într-un comentariu
--        trecea PU1–PU9; la fel `enforce_ordering_enabled` cu
--        `when 'pickup' then 'order_qr'` și maparea veche comentată.
--        [PICĂ: ambele mutații de mai sus]
--
-- Mutații verificate pe un cluster de replay (fiecare pică, prima asserție
-- atinsă în paranteză): (a) proiecția revine la `r.pickup_settings` brut (PU1);
-- (b1) helperul nu normalizează niciodată (PU1); (b2) helperul normalizează și
-- pe planul CU feature (PU1, controlul pozitiv); (b3) predicat strict
-- `= 'true'::jsonb` (PU5); (c) `grant execute` pe helper către anon (PU7);
-- (d) helperul pe `'remove_branding'`, `'pickup_orders'` rămas în comentariu
-- (PU9 pe cod, apoi PU10); (e) `enforce_ordering_enabled` mapează `pickup` pe
-- `order_qr`, maparea veche în comentariu (PU9 pe cod, apoi PU10); (f) o
-- funcție anon DEFINER nouă `select to_jsonb(r) from restaurants r` (PU8).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- Câte un owner per restaurant: `enforce_restaurant_limit` (131) dă 1 restaurant
-- pe growth/starter/free, deci al doilea INSERT pe același cont ar pica pe
-- limită, nu pe ce testăm.
--   U1/R1 growth, ridicare pornită (scenariul de downgrade + comenzile reale)
--   U2/R2 growth, ridicare OPRITĂ
--   U3/R3 growth, pickup_settings NULL
--   U4/R4 growth, țara DE, ridicare pornită
--   U5    cont autentificat fără niciun restaurant (oaspete logat)
insert into auth.users (id, email) values
  ('30900000-0000-4000-8000-000000000001', 'pu-owner1@pg309.test'),
  ('30900000-0000-4000-8000-000000000002', 'pu-owner2@pg309.test'),
  ('30900000-0000-4000-8000-000000000003', 'pu-owner3@pg309.test'),
  ('30900000-0000-4000-8000-000000000004', 'pu-owner4@pg309.test'),
  ('30900000-0000-4000-8000-000000000005', 'pu-guest@pg309.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'pu-%@pg309.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('30900000-0000-4000-8000-000000000001', '30900000-0000-4000-8000-000000000002',
              '30900000-0000-4000-8000-000000000003', '30900000-0000-4000-8000-000000000004');
update public.profiles set plan = 'free' where id = '30900000-0000-4000-8000-000000000005';

insert into public.restaurants
  (id, owner_id, name, slug, city, is_active, wifi_password, qr_token, menu_languages, pickup_settings)
values
  ('309b0000-0000-4000-8000-000000000001', '30900000-0000-4000-8000-000000000001',
   'PU Bistro', 'pu309-bistro', 'Cluj', true, 'pu309-wifi-secret', 'pu309-qr-secret', '["ro","en"]'::jsonb,
   '{"enabled": true, "min_lead_time_minutes": 25, "slot_interval_minutes": 10,
     "open_hours": {"start": "00:00", "end": "23:59"}, "instructions": "Ridicare la bar",
     "pickup_only": false}'::jsonb),
  ('309b0000-0000-4000-8000-000000000002', '30900000-0000-4000-8000-000000000002',
   'PU Oprit', 'pu309-off', 'Cluj', true, null, null, '[]'::jsonb,
   '{"enabled": false, "min_lead_time_minutes": 20, "instructions": null}'::jsonb),
  ('309b0000-0000-4000-8000-000000000003', '30900000-0000-4000-8000-000000000003',
   'PU Null', 'pu309-null', 'Cluj', true, null, null, '[]'::jsonb, null);
insert into public.restaurants
  (id, owner_id, name, slug, city, is_active, country, currency, timezone, pickup_settings)
values
  ('309b0000-0000-4000-8000-000000000004', '30900000-0000-4000-8000-000000000004',
   'PU Berlin', 'pu309-de', 'Berlin', true, 'DE', 'EUR', 'Europe/Berlin',
   '{"enabled": true, "min_lead_time_minutes": 20}'::jsonb);

-- Tema cu badge-ul ascuns, pusă prin UPDATE (calea reală; gate-ul de scriere
-- din 225 o lasă pe growth) — PU9 verifică că gate-ul 281 a supraviețuit copiei.
update public.restaurants
   set theme_settings = '{"hide_branding": true, "accent": "#123456"}'::jsonb
 where id = '309b0000-0000-4000-8000-000000000001';

-- Produs pentru comenzile reale din PU2 (inserat cât owner-ul e pe growth).
insert into public.categories (id, restaurant_id, name) values
  ('309c0000-0000-4000-8000-000000000001', '309b0000-0000-4000-8000-000000000001', 'PU Cafele');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('309d0000-0000-4000-8000-000000000001', '309b0000-0000-4000-8000-000000000001',
   '309c0000-0000-4000-8000-000000000001', 'PU Espresso', 9.00, 1, true, false);

-- Control de fixtură: setările s-au stocat EXACT (fără ele restul e vacuu).
do $$
begin
  if (select pickup_settings -> 'enabled' from public.restaurants
       where id = '309b0000-0000-4000-8000-000000000001') is distinct from 'true'::jsonb
     or (select pickup_settings from public.restaurants
          where id = '309b0000-0000-4000-8000-000000000003') is not null
     or (select theme_settings -> 'hide_branding' from public.restaurants
          where id = '309b0000-0000-4000-8000-000000000001') is distinct from 'true'::jsonb then
    raise exception 'FIXTURA: pickup_settings / theme_settings nu s-au stocat cum se aștepta — suita ar fi vacuă';
  end if;
end $$;

-- Rulează o expresie jsonb SUB rolul indicat, ca utilizatorul dat. Întoarce
-- rezultatul sau {raised:true, sqlstate, hint, error} dacă apelul aruncă.
-- `set_config('role', …)` stă ÎN AFARA sub-blocului cu excepție: în interior
-- s-ar derula înapoi odată cu subtranzacția (capcana din CLAUDE.md, lot B).
create function pg_temp.pu_as(p_role text, p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text; v_hint text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute 'select (' || p_sql || ')::jsonb' into v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'hint', v_hint, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

-- Proiecția publică, ca oaspete anonim: rândul întreg ca jsonb.
create function pg_temp.pu_slug(p_slug text) returns jsonb
language sql as $f$
  select pg_temp.pu_as('anon', null,
    format('(select to_jsonb(x) from public.get_restaurant_by_slug(%L) x)', p_slug))
$f$;

create function pg_temp.pu_plan(p_owner uuid, p_plan text) returns void
language sql as $f$
  update public.profiles set plan = p_plan where id = p_owner
$f$;

-- CODUL unei funcții, fără comentarii (`/* … */` apoi `-- …`). `prosrc` și
-- `pg_get_functiondef` includ comentariile din corp, deci o potrivire textuală
-- pe sursa brută e satisfăcută și de un literal rămas într-un comentariu
-- (mutațiile d/e din antet). Un `--` într-un literal de șir ar tăia restul
-- rândului — eșec ZGOMOTOS pe o asserție de prezență, nu verde tăcut.
create function pg_temp.pu_code(p_src text) returns text
language sql immutable as $f$
  select regexp_replace(regexp_replace(p_src, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g')
$f$;

-- ── PU1: DOWNGRADE pe /m/:slug ──────────────────────────────────────────────
do $$
declare
  c_owner  constant uuid := '30900000-0000-4000-8000-000000000001';
  v_stored jsonb;
  v_row    jsonb;
  v_ps     jsonb;
  v_plan   text;
begin
  select pickup_settings into v_stored from public.restaurants
   where id = '309b0000-0000-4000-8000-000000000001';

  -- CONTROL POZITIV: pe growth ridicarea e reală, proiecția o arată neatinsă.
  v_row := pg_temp.pu_slug('pu309-bistro');
  if v_row is null or v_row ? 'raised' then
    raise exception 'PU1: get_restaurant_by_slug ca anon n-a întors rândul (%)', v_row; end if;
  if v_row -> 'pickup_settings' is distinct from v_stored then
    raise exception 'PU1 (control pozitiv): pe growth setările trebuie să treacă NEATINSE (primit %, stocat %)',
      v_row -> 'pickup_settings', v_stored; end if;

  -- DOWNGRADE: starter, apoi free — rândul stocat rămâne neatins (nimeni nu
  -- scrie pickup_settings), exact situația din producție.
  foreach v_plan in array array['starter', 'free'] loop
    perform pg_temp.pu_plan(c_owner, v_plan);
    v_ps := pg_temp.pu_slug('pu309-bistro') -> 'pickup_settings';
    if v_ps -> 'enabled' is distinct from 'false'::jsonb then
      raise exception 'PU1: pe % (fără pickup_orders) proiecția anunță ridicarea (enabled=%) — oaspetele ajunge la un flux refuzat la final',
        v_plan, v_ps -> 'enabled'; end if;
    if (v_ps - 'enabled') is distinct from (v_stored - 'enabled') then
      raise exception 'PU1: pe % gate-ul a atins și alte chei (primit %, stocat %)', v_plan, v_ps, v_stored; end if;
  end loop;

  -- Gate la CITIRE, nu migrare de date.
  if (select pickup_settings from public.restaurants
       where id = '309b0000-0000-4000-8000-000000000001') is distinct from v_stored then
    raise exception 'PU1: gate-ul de CITIRE nu are voie să rescrie rândul stocat'; end if;

  -- Re-urcarea pe growth reactivează ridicarea exact cum o lăsase owner-ul.
  perform pg_temp.pu_plan(c_owner, 'growth');
  if pg_temp.pu_slug('pu309-bistro') -> 'pickup_settings' is distinct from v_stored then
    raise exception 'PU1: după re-urcarea pe growth setările nu mai sunt cele stocate'; end if;
  raise notice 'PU1 OK: downgrade-ul stinge ridicarea pe /m/:slug, re-urcarea o repornește';
end $$;

-- ── PU2: gate-ul de CITIRE == gate-ul de COMANDĂ (apeluri reale, ca anon) ───
do $$
declare
  c_owner constant uuid := '30900000-0000-4000-8000-000000000001';
  v_items constant text := '[{"product_id":"309d0000-0000-4000-8000-000000000001","quantity":1}]';
  v_res   jsonb;
begin
  -- starter: proiecția zice „oprit” ȘI comanda e refuzată de gate-ul de plan.
  perform pg_temp.pu_plan(c_owner, 'starter');
  if pg_temp.pu_slug('pu309-bistro') #> '{pickup_settings,enabled}' is distinct from 'false'::jsonb then
    raise exception 'PU2: pe starter proiecția nu zice „oprit”'; end if;
  v_res := pg_temp.pu_as('anon', null, format(
    $q$public.create_order(%L::uuid, 'pickup', null, null, null, %L::jsonb, null,
       now() + interval '40 minutes', 'Ion PU', '0722309001', null)$q$,
    '309b0000-0000-4000-8000-000000000001', v_items));
  if coalesce((v_res ->> 'raised')::boolean, false) is not true
     or v_res ->> 'hint' is distinct from 'plan_upgrade_required' then
    raise exception 'PU2: premisa s-a schimbat — pe starter create_order(pickup) trebuia refuzat cu plan_upgrade_required (primit %)', v_res;
  end if;

  -- growth: proiecția zice „pornit” ȘI aceeași comandă trece (control pozitiv:
  -- gate-ul nu ascunde ridicarea când ea chiar funcționează).
  perform pg_temp.pu_plan(c_owner, 'growth');
  if pg_temp.pu_slug('pu309-bistro') #> '{pickup_settings,enabled}' is distinct from 'true'::jsonb then
    raise exception 'PU2: pe growth proiecția nu zice „pornit”'; end if;
  v_res := pg_temp.pu_as('anon', null, format(
    $q$public.create_order(%L::uuid, 'pickup', null, null, null, %L::jsonb, null,
       now() + interval '40 minutes', 'Ion PU', '0722309002', null)$q$,
    '309b0000-0000-4000-8000-000000000001', v_items));
  if v_res is null or v_res ? 'raised' or v_res ->> 'id' is null then
    raise exception 'PU2 (control pozitiv): pe growth comanda de ridicare trebuia să treacă (primit %)', v_res;
  end if;
  raise notice 'PU2 OK: proiecția spune „pornit” exact când create_order(pickup) trece gate-ul de plan';
end $$;

-- ── PU3: get_menu_by_slug moștenește gate-ul ─────────────────────────────────
do $$
declare c_owner constant uuid := '30900000-0000-4000-8000-000000000001';
        v jsonb;
begin
  perform pg_temp.pu_plan(c_owner, 'starter');
  v := pg_temp.pu_as('anon', null, $q$public.get_menu_by_slug('pu309-bistro')$q$);
  if v is null or v ? 'raised' then
    raise exception 'PU3: get_menu_by_slug ca anon a eșuat (%)', v; end if;
  if v #> '{restaurant,pickup_settings,enabled}' is distinct from 'false'::jsonb then
    raise exception 'PU3: get_menu_by_slug nu moștenește gate-ul (enabled=%)', v #> '{restaurant,pickup_settings,enabled}'; end if;
  if v #> '{restaurant,pickup_settings,instructions}' is distinct from '"Ridicare la bar"'::jsonb then
    raise exception 'PU3: get_menu_by_slug a pierdut restul setărilor'; end if;

  perform pg_temp.pu_plan(c_owner, 'growth');
  v := pg_temp.pu_as('anon', null, $q$public.get_menu_by_slug('pu309-bistro')$q$);
  if v #> '{restaurant,pickup_settings,enabled}' is distinct from 'true'::jsonb then
    raise exception 'PU3 (control pozitiv): pe growth get_menu_by_slug trebuie să arate ridicarea'; end if;
  raise notice 'PU3 OK: get_menu_by_slug (calea principală a PublicMenuPage) moștenește gate-ul';
end $$;

-- ── PU4: „oprit” și NULL rămân neatinse, pe ambele planuri ──────────────────
do $$
declare v_plan text; v_off jsonb;
begin
  select pickup_settings into v_off from public.restaurants
   where id = '309b0000-0000-4000-8000-000000000002';
  foreach v_plan in array array['growth', 'free'] loop
    perform pg_temp.pu_plan('30900000-0000-4000-8000-000000000002', v_plan);
    perform pg_temp.pu_plan('30900000-0000-4000-8000-000000000003', v_plan);
    if pg_temp.pu_slug('pu309-off') -> 'pickup_settings' is distinct from v_off then
      raise exception 'PU4: pe % setările OPRITE au fost rescrise (primit %)',
        v_plan, pg_temp.pu_slug('pu309-off') -> 'pickup_settings'; end if;
    if pg_temp.pu_slug('pu309-null') is null then
      raise exception 'PU4: restaurantul cu setări NULL nu mai e găsit'; end if;
    if pg_temp.pu_slug('pu309-null') -> 'pickup_settings' is distinct from 'null'::jsonb then
      raise exception 'PU4: pe % setările NULL au devenit %', v_plan, pg_temp.pu_slug('pu309-null') -> 'pickup_settings'; end if;
  end loop;
  raise notice 'PU4 OK: „oprit” și NULL trec byte-identic pe growth și pe free';
end $$;

-- ── PU5: matricea helperului ────────────────────────────────────────────────
do $$
declare
  c_none   constant uuid := '00000000-0000-0000-0000-000000000000';
  c_nofeat constant uuid := '309b0000-0000-4000-8000-000000000002';  -- owner pe free după PU4
  c_feat   constant uuid := '309b0000-0000-4000-8000-000000000001';  -- owner pe growth după PU3
  v_in     jsonb;
begin
  if public.restaurant_has_feature(c_nofeat, 'pickup_orders')
     or not public.restaurant_has_feature(c_feat, 'pickup_orders') then
    raise exception 'PU5: fixtura de plan nu e cea așteptată (fără feature / cu feature)'; end if;

  -- Fără feature: ORICE valoare „adevărată” pentru client devine false, restul
  -- cheilor rămâne. "false" (șir) e adevărat în JS — fail-closed și pe el.
  foreach v_in in array array[
    '{"enabled": true,    "x": {"y": 1}}'::jsonb,
    '{"enabled": "true",  "x": {"y": 1}}'::jsonb,
    '{"enabled": 1,       "x": {"y": 1}}'::jsonb,
    '{"enabled": "false", "x": {"y": 1}}'::jsonb,
    '{"enabled": "da",    "x": {"y": 1}}'::jsonb
  ] loop
    if public.public_pickup_settings(c_nofeat, v_in)
         is distinct from '{"enabled": false, "x": {"y": 1}}'::jsonb then
      raise exception 'PU5: fără feature, % trebuia să devină {"enabled": false, "x": {"y": 1}} (primit %)',
        v_in, public.public_pickup_settings(c_nofeat, v_in); end if;
    -- id inexistent = „fără feature” (fail-closed)
    if public.public_pickup_settings(c_none, v_in) -> 'enabled' is distinct from 'false'::jsonb then
      raise exception 'PU5: un restaurant inexistent nu e tratat ca „fără feature” pentru %', v_in; end if;
    -- CU feature: neschimbat, oricare ar fi valoarea.
    if public.public_pickup_settings(c_feat, v_in) is distinct from v_in then
      raise exception 'PU5: cu feature, % a fost modificat (primit %)', v_in, public.public_pickup_settings(c_feat, v_in); end if;
  end loop;

  -- Fără feature: ce clientul vede deja „oprit” sau nu e obiect → neatins.
  foreach v_in in array array[
    '{"enabled": false, "x": 1}'::jsonb,
    '{"enabled": null,  "x": 1}'::jsonb,
    '{"x": 1}'::jsonb,           -- fără cheie: NU se inventează
    '{}'::jsonb,
    '5'::jsonb,
    '"enabled"'::jsonb,
    '["enabled", true]'::jsonb,
    'null'::jsonb
  ] loop
    if public.public_pickup_settings(c_nofeat, v_in) is distinct from v_in then
      raise exception 'PU5: fără feature, % trebuia să rămână neatins (primit %)', v_in, public.public_pickup_settings(c_nofeat, v_in); end if;
  end loop;
  if public.public_pickup_settings(c_nofeat, null) is not null then
    raise exception 'PU5: NULL trebuie să rămână NULL'; end if;
  raise notice 'PU5 OK: fail-closed pe orice „pornit”, neatins în rest, fără chei inventate';
end $$;

-- ── PU6: țara nu contează pentru ridicare ───────────────────────────────────
do $$
begin
  if public.feature_requires_ro('pickup_orders') then
    raise exception 'PU6: premisa s-a schimbat — pickup_orders a devenit feature românesc (decizie de produs: actualizează suita)'; end if;
  if pg_temp.pu_slug('pu309-de') #> '{pickup_settings,enabled}' is distinct from 'true'::jsonb then
    raise exception 'PU6: un local growth din DE și-a pierdut ridicarea (primit %) — gate prea zelos',
      pg_temp.pu_slug('pu309-de') -> 'pickup_settings'; end if;
  raise notice 'PU6 OK: ridicarea rămâne pe un local growth din afara României';
end $$;

-- ── PU7: suprafața ──────────────────────────────────────────────────────────
do $$
declare
  c_helper constant text := 'public.public_pickup_settings(uuid,jsonb)';
  v_rol text; v jsonb; v_bad text; v_n int;
begin
  -- Catalog: zero EXECUTE pentru roluri client.
  select string_agg(r.rol, ', ') into v_bad
    from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
   where has_function_privilege(r.rol, c_helper, 'execute');
  if v_bad is not null then
    raise exception 'PU7: helperul de ridicare e apelabil de: %', v_bad; end if;

  -- Apel REAL: refuzul trebuie să vină de pe ACL-ul FUNCȚIEI (un 42501 pe
  -- schemă ar fi tot 42501 și ar face testul vacuu).
  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    v := pg_temp.pu_as(v_rol, '30900000-0000-4000-8000-000000000005',
      $q$public.public_pickup_settings('309b0000-0000-4000-8000-000000000001'::uuid, '{"enabled":true}'::jsonb)$q$);
    if coalesce((v ->> 'raised')::boolean, false) is not true
       or v ->> 'sqlstate' is distinct from '42501'
       or v ->> 'error' not like '%permission denied for function%public_pickup_settings%' then
      raise exception 'PU7: % poate apela helperul sau refuzul nu e pe funcție (%)', v_rol, v; end if;
  end loop;

  -- O singură semnătură, DEFINER, search_path fixat.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'public_pickup_settings';
  if v_n <> 1 then
    raise exception 'PU7: public_pickup_settings are % semnături (așteptat 1)', v_n; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.oid in (c_helper::regprocedure, 'public.get_restaurant_by_slug(text)'::regprocedure)
     and not (p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%');
  if v_bad is not null then
    raise exception 'PU7: fără DEFINER / search_path = public, pg_temp: %', v_bad; end if;

  -- Proiecția rămâne publică; oaspetele LOGAT (fără restaurant) vede aceeași
  -- vedere gate-uită ca anonimul.
  if not has_function_privilege('anon', 'public.get_restaurant_by_slug(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_restaurant_by_slug(text)', 'execute') then
    raise exception 'PU7: get_restaurant_by_slug nu mai e apelabil de anon/authenticated'; end if;
  perform pg_temp.pu_plan('30900000-0000-4000-8000-000000000001', 'starter');
  v := pg_temp.pu_as('authenticated', '30900000-0000-4000-8000-000000000005',
    $q$(select to_jsonb(x) from public.get_restaurant_by_slug('pu309-bistro') x)$q$);
  if v is null or v ? 'raised' then
    raise exception 'PU7: un oaspete autentificat nu poate citi proiecția (%)', v; end if;
  if v #> '{pickup_settings,enabled}' is distinct from 'false'::jsonb then
    raise exception 'PU7: oaspetele autentificat vede ridicarea pe starter (gate ocolit pe authenticated)'; end if;
  perform pg_temp.pu_plan('30900000-0000-4000-8000-000000000001', 'growth');
  raise notice 'PU7 OK: helperul e intern (refuz pe funcție), proiecția rămâne publică și gate-uită';
end $$;

-- ── PU8: clichet de clasă — cine mai scoate pickup_settings la anon ─────────
create function pg_temp.pu_leakers() returns text
language sql as $f$
  select coalesce(string_agg(x, ',' order by x collate "C"), '')
    from (select distinct p.proname::text as x
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.prosrc like '%pickup_settings%'
             and has_function_privilege('anon', p.oid, 'execute')) d
$f$;

do $$
declare
  -- Registrul, cu motiv. O intrare NOUĂ cere decizie: trece prin helper sau nu
  -- proiectează pickup_settings către oaspete.
  --   create_order           — CITEȘTE enabled / min_lead_time_minutes ca să
  --                            valideze comanda; nu proiectează nimic.
  --   get_restaurant_by_slug — proiecția /m/:slug, prin public_pickup_settings.
  c_expected constant text := 'create_order,get_restaurant_by_slug';
  v_found text;
  v_views text;
  v jsonb;
begin
  v_found := pg_temp.pu_leakers();
  if v_found is distinct from c_expected then
    raise exception 'PU8 FAIL: funcțiile apelabile de anon care pomenesc pickup_settings au derivat: % (așteptat %) — o proiecție nouă trebuie să treacă prin public_pickup_settings',
      v_found, c_expected; end if;

  -- Niciun view citibil de anon nu poartă coloana.
  select string_agg(c.relname, ', ') into v_views
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and pg_get_viewdef(c.oid) like '%pickup_settings%'
     and has_table_privilege('anon', c.oid, 'select');
  if v_views is not null then
    raise exception 'PU8 FAIL: view-uri citibile de anon expun pickup_settings: %', v_views; end if;

  -- Tabela însăși nu e o ușă laterală: anon ori n-are privilegiu (Postgres
  -- gol), ori RLS nu-i dă niciun rând (stack-ul Supabase, unde default
  -- privileges îi acordă SELECT).
  v := pg_temp.pu_as('anon', null,
    $q$(select to_jsonb(count(*)) from public.restaurants where slug like 'pu309-%')$q$);
  if not ((coalesce((v ->> 'raised')::boolean, false) and v ->> 'sqlstate' = '42501')
          or v = '0'::jsonb) then
    raise exception 'PU8 FAIL: anon citește restaurants direct (%) — gate-ul de citire ar avea o ușă laterală', v; end if;
end $$;

-- Control POZITIV al detectorului: o funcție-sondă nouă, apelabilă de anon,
-- care scoate coloana brut, TREBUIE prinsă (altfel PU8 ar putea fi vacuu).
create function public.pu309_probe_leak(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $f$ select r.pickup_settings from public.restaurants r where r.slug = p_slug $f$;
grant execute on function public.pu309_probe_leak(text) to anon;
do $$
begin
  if pg_temp.pu_leakers() not like '%pu309_probe_leak%' then
    raise exception 'PU8 FAIL: detectorul nu prinde o funcție nouă care proiectează pickup_settings — clichetul e vacuu'; end if;
end $$;
drop function public.pu309_probe_leak(text);
do $$
begin
  if pg_temp.pu_leakers() is distinct from 'create_order,get_restaurant_by_slug' then
    raise exception 'PU8: sonda a rămas în catalog'; end if;
end $$;

-- (2) RÂNDUL ÎNTREG. Detectorul literal de mai sus e ORB la forma cea mai
-- probabilă a unei proiecții anon noi: `select to_jsonb(r) from restaurants r`
-- (tiparul există deja în repo — `jsonb_agg(to_jsonb(r))` din exportul GDPR,
-- mig 042, azi doar pentru autentificați) nu conține numele coloanei, dar o
-- scoate brut, împreună cu tot rândul. Formele prinse, pe CODUL fără
-- comentarii: tipul de retur (sau un parametru OUT/TABLE) = rândul
-- `restaurants`; `select * [into …] from restaurants`; o variabilă de tipul
-- rândului (`restaurants%rowtype` / `v public.restaurants;`); `restaurants.*`
-- și `to_jsonb(restaurants)`; iar prin ALIAS (`from restaurants [as] r`):
-- `r.*` sau `to_jsonb(r)` / `to_json` / `row_to_json` / `jsonb_agg` /
-- `json_agg` / `array_agg` / `hstore` pe alias. Un fals pozitiv intră în
-- registru CU MOTIV — mai bine zgomotos decât orb.
create function pg_temp.pu_whole_row(p_code text) returns boolean
language sql immutable as $f$
  select
       p_code ~* 'select\s+\*\s+(into\s+(strict\s+)?[a-z0-9_.]+\s+)?from\s+(public\.)?restaurants\M'
    or p_code ~* '\m(public\.)?restaurants\s*%\s*rowtype'
    or p_code ~* '\m(public\.)?restaurants\.\*'
    or p_code ~* '\m(to_jsonb|to_json|row_to_json|jsonb_agg|json_agg|array_agg|hstore)\s*\(\s*(public\.)?restaurants\s*\)'
    or exists (
         select 1
           from regexp_matches(p_code, '([a-z_][a-z0-9_]*)\s+(public\.)?restaurants\s*(;|:=)', 'gi') m
          where lower(m[1]) not in ('from', 'join', 'into', 'update', 'table', 'only', 'on'))
    or exists (
         select 1
           from regexp_matches(p_code,
                  '(from|join)\s+(public\.)?restaurants\s+(as\s+)?([a-z_][a-z0-9_]*)', 'gi') m
          where lower(m[4]) not in ('where', 'join', 'left', 'right', 'inner', 'full', 'cross',
                                    'natural', 'lateral', 'on', 'using', 'group', 'order', 'limit',
                                    'offset', 'for', 'union', 'except', 'intersect', 'having',
                                    'window', 'returning', 'into', 'set', 'fetch')
            and (p_code ~* ('\m' || m[4] || '\.\*')
                 or p_code ~* ('\m(to_jsonb|to_json|row_to_json|jsonb_agg|json_agg|array_agg|hstore)\s*\(\s*'
                               || m[4] || '\s*\)')))
$f$;

create function pg_temp.pu_whole_row_leakers() returns text
language sql as $f$
  select coalesce(string_agg(x, ',' order by x collate "C"), '')
    from (select distinct p.proname::text as x
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and has_function_privilege('anon', p.oid, 'execute')
             and (p.prorettype = 'public.restaurants'::regtype
                  or 'public.restaurants'::regtype = any(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                  or pg_temp.pu_whole_row(pg_temp.pu_code(p.prosrc)))) d
$f$;

do $$
declare
  -- Registrul, cu motiv. Azi e GOL: nicio funcție apelabilă de anon nu scoate
  -- rândul întreg al lui `restaurants`. O intrare nouă cere decizie scrisă
  -- (și, dacă proiectează către oaspete, trecerea prin helperii 281/309).
  c_expected constant text := '';
  v_found text;
begin
  v_found := pg_temp.pu_whole_row_leakers();
  if v_found is distinct from c_expected then
    raise exception 'PU8 FAIL: funcții apelabile de anon scot RÂNDUL ÎNTREG al lui restaurants (deci pickup_settings brut, theme_settings fără 281, wifi_password/qr_token fără 217): % (așteptat „%”)',
      v_found, c_expected; end if;
end $$;

-- Control POZITIV: patru sonde noi, câte una pe fiecare formă, TREBUIE prinse;
-- control NEGATIV: o sondă care pomenește formele DOAR în comentarii și
-- proiectează o singură coloană nu e prinsă.
create function public.pu309_probe_to_jsonb(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $f$ select to_jsonb(r) from public.restaurants r where lower(r.slug) = lower(p_slug) $f$;
create function public.pu309_probe_setof(p_slug text) returns setof public.restaurants
language sql stable security definer set search_path = public, pg_temp
as $f$ select * from public.restaurants where lower(slug) = lower(p_slug) $f$;
create function public.pu309_probe_alias_star(p_slug text) returns json
language sql stable security definer set search_path = public, pg_temp
as $f$ select json_agg(x) from (select rr.name, rr.* from public.restaurants as rr where rr.slug = p_slug) x $f$;
create function public.pu309_probe_rowvar(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $f$
declare v public.restaurants;
begin
  select * into v from public.restaurants where slug = p_slug;
  return to_jsonb(v);
end $f$;
create function public.pu309_probe_comment_only(p_slug text) returns text
language sql stable security definer set search_path = public, pg_temp
as $f$
  -- to_jsonb(r), r.*, select * from public.restaurants
  select r.name from public.restaurants r where r.slug = p_slug /* row_to_json(r) */
$f$;
grant execute on function public.pu309_probe_to_jsonb(text), public.pu309_probe_setof(text),
  public.pu309_probe_alias_star(text), public.pu309_probe_rowvar(text),
  public.pu309_probe_comment_only(text) to anon;
do $$
begin
  if pg_temp.pu_whole_row_leakers()
       is distinct from 'pu309_probe_alias_star,pu309_probe_rowvar,pu309_probe_setof,pu309_probe_to_jsonb' then
    raise exception 'PU8 FAIL: detectorul de rând întreg nu prinde exact sondele (primit „%”) — clichetul e vacuu sau prinde comentarii',
      pg_temp.pu_whole_row_leakers(); end if;
end $$;
drop function public.pu309_probe_to_jsonb(text);
drop function public.pu309_probe_setof(text);
drop function public.pu309_probe_alias_star(text);
drop function public.pu309_probe_rowvar(text);
drop function public.pu309_probe_comment_only(text);
do $$
begin
  if pg_temp.pu_whole_row_leakers() <> '' then
    raise exception 'PU8: sondele de rând întreg au rămas în catalog'; end if;
  raise notice 'PU8 OK: proiecția e singura ușă anon spre pickup_settings (literal ȘI rând întreg), iar ambele detectoare sunt vii';
end $$;

-- ── PU9: invariantele moștenite de copia verbatim ───────────────────────────
do $$
declare v_row jsonb; v_src text; v_up jsonb; v_order text; v_helper text;
begin
  -- Pe starter: și tema trece prin gate-ul 281 (badge-ul reapare).
  perform pg_temp.pu_plan('30900000-0000-4000-8000-000000000001', 'starter');
  v_row := pg_temp.pu_slug('pu309-bistro');
  if v_row ->> 'wifi_password' is not null or v_row ->> 'qr_token' is not null then
    raise exception 'PU9: wifi_password/qr_token s-au scurs la anon (217): %', v_row; end if;
  if v_row -> 'menu_languages' is distinct from '["ro","en"]'::jsonb then
    raise exception 'PU9: menu_languages a dispărut din proiecție (219): %', v_row -> 'menu_languages'; end if;
  if v_row #> '{theme_settings,hide_branding}' is distinct from 'false'::jsonb
     or v_row #> '{theme_settings,accent}' is distinct from '"#123456"'::jsonb then
    raise exception 'PU9: gate-ul de branding (281) nu mai e aplicat: %', v_row -> 'theme_settings'; end if;
  if v_row ->> 'country' is distinct from 'RO' or not (v_row ? 'country') then
    raise exception 'PU9: country lipsește din proiecție (298): %', v_row; end if;
  v_up := pg_temp.pu_slug('PU309-BISTRO');
  if v_up ->> 'id' is distinct from '309b0000-0000-4000-8000-000000000001' then
    raise exception 'PU9: slug-ul case-insensitive s-a pierdut (148)'; end if;
  perform pg_temp.pu_plan('30900000-0000-4000-8000-000000000001', 'growth');

  -- Sursa (pe COD, fără comentarii): helperul e folosit, iar coloana nu mai
  -- pleacă brut pe altă cale.
  v_src := pg_temp.pu_code(pg_get_functiondef('public.get_restaurant_by_slug(text)'::regprocedure));
  if position('public.public_pickup_settings(r.id, r.pickup_settings)' in v_src) = 0 then
    raise exception 'PU9: get_restaurant_by_slug nu mai trece pickup_settings prin helper'; end if;
  if (length(v_src) - length(replace(v_src, 'r.pickup_settings', ''))) / length('r.pickup_settings') <> 1 then
    raise exception 'PU9: get_restaurant_by_slug referă r.pickup_settings și în afara helperului'; end if;

  -- Același feature în gate-ul de COMANDĂ (290) și în cel de CITIRE (309) —
  -- centura TEXTUALĂ, pe cod fără comentarii; autoritatea e PU10.
  select pg_temp.pu_code(prosrc) into v_order from pg_proc where oid = 'public.enforce_ordering_enabled()'::regprocedure;
  select pg_temp.pu_code(prosrc) into v_helper from pg_proc where oid = 'public.public_pickup_settings(uuid,jsonb)'::regprocedure;
  if v_order !~ $q$when\s+'pickup'\s+then\s+'pickup_orders'$q$
     or position($q$restaurant_has_feature(p_restaurant_id, 'pickup_orders')$q$ in v_helper) = 0 then
    raise exception 'PU9: gate-ul de comandă și cel de citire nu mai folosesc același feature (pickup_orders) — ar diverge tăcut'; end if;
  raise notice 'PU9 OK: invariantele 148/217/219/281/298 + feature-ul comun cu gate-ul de comandă';
end $$;

-- ── PU10: același feature în gate-ul de CITIRE și în cel de COMANDĂ ─────────
-- Pe COMPORTAMENT, nu pe text: `plan_features` se modifică în tranzacția
-- suitei (ROLLBACK la final — nimic nu supraviețuiește). PU1/PU2 schimbă doar
-- planul owner-ului, iar pe free/starter/growth `pickup_orders` are ACELAȘI
-- rând ca order_qr, remove_branding, loyalty… — un helper pe oricare dintre ele
-- trecea. Aici se stinge FEATURE-UL, pe planul la care owner-ul rămâne.
do $$
declare
  c_owner constant uuid := '30900000-0000-4000-8000-000000000001';
  c_rid   constant text := '309b0000-0000-4000-8000-000000000001';
  v_items constant text := '[{"product_id":"309d0000-0000-4000-8000-000000000001","quantity":1}]';
  c_order constant text := $q$public.create_order(%L::uuid, 'pickup', null, null, null, %L::jsonb, null,
       now() + interval '40 minutes', 'Ion PU', %L, null)$q$;
  v_res   jsonb;
  v_feat  text;
  v_seen  text[] := '{}';
begin
  perform pg_temp.pu_plan(c_owner, 'growth');
  if pg_temp.pu_slug('pu309-bistro') #> '{pickup_settings,enabled}' is distinct from 'true'::jsonb then
    raise exception 'PU10: premisa — pe growth, cu matricea neatinsă, proiecția trebuia să zică „pornit”'; end if;

  -- (1) Stins DOAR pickup_orders pe growth: ambele gate-uri trebuie să-l vadă.
  update public.plan_features set enabled = false where plan = 'growth' and feature = 'pickup_orders';
  if not found then
    raise exception 'PU10: fixtura — rândul (growth, pickup_orders) lipsește din plan_features'; end if;
  if pg_temp.pu_slug('pu309-bistro') #> '{pickup_settings,enabled}' is distinct from 'false'::jsonb then
    raise exception 'PU10 FAIL: cu pickup_orders stins pe growth proiecția anunță încă ridicarea — gate-ul de CITIRE nu întreabă de pickup_orders'; end if;
  v_res := pg_temp.pu_as('anon', null, format(c_order, c_rid, v_items, '0722309003'));
  if coalesce((v_res ->> 'raised')::boolean, false) is not true
     or v_res ->> 'hint' is distinct from 'plan_upgrade_required' then
    raise exception 'PU10 FAIL: cu pickup_orders stins pe growth create_order(pickup) trebuia refuzat cu plan_upgrade_required (primit %) — gate-ul de COMANDĂ nu întreabă de pickup_orders',
      v_res; end if;
  update public.plan_features set enabled = true where plan = 'growth' and feature = 'pickup_orders';

  -- (2) Contra-control pe CITIRE: oricare ALT feature activ pe growth, stins pe
  -- rând, NU atinge proiecția (un helper care depinde și de altceva pică aici).
  for v_feat in
    select feature from public.plan_features
     where plan = 'growth' and enabled and feature <> 'pickup_orders'
     order by feature collate "C"
  loop
    update public.plan_features set enabled = false where plan = 'growth' and feature = v_feat;
    if pg_temp.pu_slug('pu309-bistro') #> '{pickup_settings,enabled}' is distinct from 'true'::jsonb then
      raise exception 'PU10 FAIL: stins % pe growth, proiecția a ascuns ridicarea — gate-ul de citire depinde de alt feature decât pickup_orders', v_feat; end if;
    update public.plan_features set enabled = true where plan = 'growth' and feature = v_feat;
    v_seen := v_seen || v_feat;
  end loop;
  -- Anti-vacuitate: contra-controlul a trecut prin feature-urile pe care PU1/PU2
  -- NU le pot deosebi de pickup_orders (același rând de plan).
  if not (v_seen @> array['order_qr', 'remove_branding', 'loyalty', 'kitchen_tickets', 'waiter_manual']) then
    raise exception 'PU10: contra-controlul n-a acoperit feature-urile cu același rând de plan ca pickup_orders (văzute: %)', v_seen; end if;

  -- (3) Contra-control pe COMANDĂ: cu order_qr (feature-ul comenzilor QR) stins
  -- pe growth, ridicarea rămâne ȘI vizibilă, ȘI comandabilă.
  update public.plan_features set enabled = false where plan = 'growth' and feature = 'order_qr';
  v_res := pg_temp.pu_as('anon', null, format(c_order, c_rid, v_items, '0722309004'));
  if v_res is null or v_res ? 'raised' or v_res ->> 'id' is null then
    raise exception 'PU10 FAIL: cu order_qr stins pe growth comanda de ridicare trebuia să treacă (primit %) — gate-ul de comandă nu mai e pe pickup_orders',
      v_res; end if;
  update public.plan_features set enabled = true where plan = 'growth' and feature = 'order_qr';
  raise notice 'PU10 OK: citirea și comanda depind EXACT de pickup_orders (stins → ambele refuză; orice alt feature stins → niciuna)';
end $$;

rollback;

\echo '✅ RIDICAREA PE /m/:slug GATE-UITĂ LA CITIRE OK (PU1-PU10)'
