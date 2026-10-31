-- migration_309_public_pickup_read_gate.sql
-- =============================================================================
-- Ridicarea (click & collect) se gate-uiește și la CITIRE pe /m/:slug
-- (audit ux-guest-10, pasul B). Aceeași clasă cu `hide_branding` (mig 281).
--
-- ── Ce era ───────────────────────────────────────────────────────────────────
-- `get_restaurant_by_slug` (lanț 148→217→219→281→298) proiecta
-- `restaurants.pickup_settings` BRUT către anon. Pe /m/:slug, PublicMenuPage
-- decide `pickupEnabled = restaurant?.pickup_settings?.enabled ?? false` și, pe
-- adevărat, arată badge-ul de ridicare, coșul și „Continuă spre ridicare”.
-- Planul NU se verifica nicăieri pe drumul ăsta:
--   • NU există niciun gate pe `pickup_settings.enabled` — nici în DB (fără
--     trigger de scriere), nici în UI. Comutatorul „Comenzi pentru ridicare
--     (click-and-collect)” din SettingsTab se randează pe ORICE plan, iar
--     butonul „Nu am mese — doar ridicare (food truck)” din onboarding scrie
--     `{enabled:true, pickup_only:true}` pe Planul 1 INTENȚIONAT (flag inert,
--     cu hint de plan sub buton). Expresia `planTier(plan) >= 2 || enabled`
--     din SettingsTab gate-uiește o NOTĂ despre flipbook, NU comutatorul.
--     Deci originea principală a stării „stocat pornit, plan fără ridicare” e
--     Planul 1 ÎNSUȘI (onboarding-ul food truck sau comutatorul de pe
--     free/starter), alături de downgrade-ul de pe growth cu ridicarea lăsată
--     pornită;
--   • `create_order` (191) refuză comanda abia la FINAL: `enforce_ordering_enabled`
--     (290) cere feature-ul `pickup_orders` pe sursa `pickup`.
-- Deci oaspetele unui local de pe Planul 1 (sau retrogradat) își umple coșul,
-- își alege ora, își scrie numele și telefonul — și primește la trimitere
-- „Comenzile nu sunt disponibile pe planul curent”. Un flux pe care serverul îl
-- refuză nu are ce căuta pe ecran.
--
-- ── Fix: normalizare la CITIRE, sursă UNICĂ ─────────────────────────────────
-- Helperul `public_pickup_settings(uuid, jsonb)` — oglinda lui
-- `public_theme_settings` (281): `language sql stable security definer`,
-- `search_path = public, pg_temp`, ZERO EXECUTE pentru roluri client, feature-ul
-- rezolvat prin `restaurant_has_feature` (punctul de trecere din 296 — NU prin
-- tabela de feature-uri direct, clichetul CC6). Pe un local FĂRĂ `pickup_orders`
-- cheia `enabled` devine `false`; restul cheilor rămân neatinse, nicio cheie nu
-- se inventează, iar NULL rămâne NULL. Pe un local CU feature setările trec
-- neschimbate. Rândul stocat NU se atinge: o re-urcare pe growth reactivează
-- ridicarea exact cum o lăsase owner-ul.
--
-- ── Predicatul de „pornit”: paritate cu CLIENTUL de AICI, nu cu 281 ──────────
-- 281 compară `= 'true'::jsonb` fiindcă `resolveHideBranding` ascunde badge-ul
-- DOAR pe `true` explicit. Aici clientul e altul: `pickupEnabled` e un test de
-- ADEVĂR JavaScript, iar `create_order` citește `(->> 'enabled')::boolean`, care
-- acceptă și șirul "true". O egalitate strictă cu `true` ar fi lăsat să treacă
-- exact valorile pe care AMBELE capete le tratează ca „pornit” ("true", 1).
-- Gate-ul e deci FAIL-CLOSED: pe un local fără feature, ORICE valoare a lui
-- `enabled` în afară de JSON `false` / JSON `null` / cheie absentă devine
-- `false` (pentru acestea trei clientul vede deja „oprit”: `null ?? false`).
-- Ce păstrăm din 281: comparația e pe valori jsonb, FĂRĂ cast — un `::boolean`
-- pe o valoare stricată ("da") ar arunca și ar rupe TOATĂ proiecția publică,
-- adică meniul. Și NU există gardă separată pe ne-obiect: `->` cu cheie TEXT
-- întoarce NULL pe scalari și array-uri, deci ramura `jsonb_set` e deja
-- inaccesibilă pentru ele (o gardă ar fi cod mort — lecția M5 din 281).
--
-- ── `get_restaurant_by_slug`: copie VERBATIM a lui 298 + helperul ───────────
-- Singura schimbare: `r.pickup_settings` → `public.public_pickup_settings(r.id,
-- r.pickup_settings)`. Forma coloanelor (nume, tipuri, ordine) e IDENTICĂ cu
-- 298, deci `create or replace` e suficient — fără DROP, ACL-ul (anon +
-- authenticated) se păstrează; grant-ul de mai jos e doar idempotent.
-- `set search_path = public, pg_temp` se scrie EXPLICIT: `create or replace`
-- rescrie `proconfig` cu ce e în textul nou (capcana (a) din 281).
-- Invarianți păstrați: slug case-insensitive (148), `null::text` pe `qr_token`
-- și `wifi_password` (217), `menu_languages` (219), `public_theme_settings`
-- (281), `country` la final (296/298), DEFINER.
--
-- ── Cine mai proiectează `pickup_settings` către anon (descoperit pe replay) ─
-- Funcțiile din `public` apelabile de anon al căror corp pomenește
-- `pickup_settings` sunt exact două: `get_restaurant_by_slug` (proiecția, acum
-- prin helper) și `create_order` (CITEȘTE `enabled`/`min_lead_time_minutes`
-- ca să valideze comanda — nu proiectează nimic). `get_menu_by_slug` (245) e o
-- compunere PURĂ (`select * from get_restaurant_by_slug`) → moștenește gate-ul
-- fără recreare. `resolve_qr_token`/`resolve_qr_menu` nu proiectează
-- `pickup_settings` deloc (QR-ul n-are ridicare). Tabela `restaurants` NU e
-- citibilă de anon (fără politică pentru anon; pe Postgres gol nici privilegiu),
-- deci proiecția e singura ușă. Clichetul PU8 din suită îngheață setul pe DOUĂ
-- detectoare: literalul `pickup_settings` ȘI rândul ÎNTREG (`to_jsonb(r)`,
-- `r.*`, `select * from restaurants`, `returns setof restaurants`, variabilă
-- de tipul rândului) — forma cea mai probabilă a unei proiecții anon noi nu
-- pomenește numele coloanei, dar o scoate brut (azi: zero funcții anon).
--
-- ── Client ───────────────────────────────────────────────────────────────────
-- OASPETE: nicio schimbare, forma răspunsului e neschimbată. PublicMenuPage
-- citește restaurantul DOAR prin `fetchMenuBySlug` → `get_menu_by_slug`, cu
-- fallback pe `fetchRestaurantBySlug` → `get_restaurant_by_slug` (qr.ts);
-- ambele trec prin helper, deci nici fallback-ul (care NU se șterge) nu
-- ocolește gate-ul. Cu `enabled=false` pagina cade singură pe „Lista mea”
-- (meniu digital), adică exact ce vinde Planul 1.
-- STAFF (același PR): gate-ul de mai sus face pagina oaspetelui corectă, dar
-- transformă divergența stocat≠efectiv într-una TĂCUTĂ pentru owner — până
-- acum refuzul de la `create_order` era SINGURUL semnal că ridicarea cere alt
-- plan, iar Setările/Mesele spuneau în continuare „clienții pot comanda”.
-- `lib/pickupCopy.ts` + SettingsTab (cardul de ridicare) + TablesManager (QR-ul
-- general, empty state-ul „doar ridicare”) citesc `pickup_orders` prin
-- `useFeatures(restaurant.id)` (planul RESTAURANTULUI, regula 3): feature
-- CUNOSCUT absent → avertisment cu numele planului și fără promisiunea de
-- comenzi; necunoscut (`null`) → nici promisiune, nici avertisment (tiparul
-- tristate `paymentsEnabled`). Comutatorul rămâne activ: setarea se păstrează
-- pentru re-urcare.
--
-- ── Reziduuri consemnate, NEadresate ────────────────────────────────────────
--   • Fără gate de SCRIERE pe `pickup_settings`, DELIBERAT: onboarding-ul food
--     truck îl pornește pe Planul 1 prin design, iar re-urcarea trebuie să
--     găsească setarea neatinsă. Autoritatea pentru ce VEDE oaspetele e la
--     citire (singurul loc care închide clasa indiferent ce e stocat), pentru
--     ce se COMANDĂ e `enforce_ordering_enabled` (290), iar pentru ce i se
--     SPUNE owner-ului e `lib/pickupCopy.ts`.
--   • Pe un local CU feature, un `enabled` stocat ca șir "false" e „pornit”
--     pentru client (test de adevăr) și „oprit” pentru `create_order`
--     (`::boolean`). Nu e o chestiune de plan, deci nu e a acestui helper;
--     scriitorii reali (SettingsTab, Onboarding) scriu boolean.
--
-- Teste permanente: tests/sql/auto/309_public_pickup_read_gate.sql (PU1–PU10)
-- + src/lib/__tests__/pickupCopy.test.ts (PK1–PK6, textele de staff).
-- =============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Helperul — sursa UNICĂ a regulii de citire.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.public_pickup_settings(
  p_restaurant_id uuid,
  p_settings      jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case
    -- Fail-closed: orice în afară de JSON false / JSON null / cheie absentă
    -- e „pornit” pentru client (test de adevăr) — vezi antetul mig 309.
    -- `->` dă NULL pe NULL, pe scalari și pe array-uri, deci acestea cad pe
    -- ramura `else` fără gardă separată.
    when p_settings -> 'enabled' is not null
         and p_settings -> 'enabled' not in ('false'::jsonb, 'null'::jsonb)
         and not public.restaurant_has_feature(p_restaurant_id, 'pickup_orders')
      then jsonb_set(p_settings, '{enabled}', 'false'::jsonb)
    else p_settings
  end;
$fn$;

comment on function public.public_pickup_settings(uuid, jsonb) is
  'mig 309 (ux-guest-10 B): normalizeaza pickup_settings pentru proiectia PUBLICA pe /m/:slug — enabled devine false cand restaurantul nu are feature-ul pickup_orders (downgrade / Plan 1), altfel neschimbat. Gate la CITIRE: create_order refuza oricum comanda, dar abia la final. Fail-closed pe orice valoare de enabled pe care clientul o trateaza ca adevarata. Oglinda public_theme_settings (mig 281).';

-- Helper intern: niciun apelant client. Revoke EXPLICIT per rol — pe stack-ul
-- Supabase default privileges acordă EXECUTE oricărei funcții NOI direct lui
-- service_role (și anon/authenticated pe CLI-ul nou), iar `revoke ... from
-- public` nu atinge un grant direct (clasa CJ9, mig 274). Apelantul e
-- proiecția DEFINER, care rulează ca proprietar.
revoke all on function public.public_pickup_settings(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. `get_restaurant_by_slug` — copie VERBATIM a lui 298 + helperul.
--    Lanț 148→217→219→281→298→309. Orice recreare viitoare pornește de AICI.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_restaurant_by_slug(p_slug text)
returns table (
  id                uuid,
  name              text,
  slug              text,
  description       text,
  tagline           text,
  address           text,
  phone             text,
  hours             text,
  logo_url          text,
  cover_url         text,
  primary_color     text,
  is_active         boolean,
  qr_token          text,
  currency          text,
  tax_included      boolean,
  language          text,
  socials           jsonb,
  amenities         text[],
  hours_structured  jsonb,
  wifi_password     text,
  timezone          text,
  theme_settings    jsonb,
  pickup_settings   jsonb,
  google_review_url text,
  menu_languages    jsonb,
  country           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    r.id, r.name, r.slug, r.description, r.tagline, r.address, r.phone,
    r.hours, r.logo_url, r.cover_url, r.primary_color, r.is_active,
    -- mig 217: qr_token + wifi_password nu se scurg la anon (nefolosite public).
    null::text, r.currency, r.tax_included, r.language,
    r.socials, r.amenities, r.hours_structured, null::text, r.timezone,
    -- mig 281: badge-ul se re-verifică la CITIRE (downgrade-ul nu mai păstrează
    -- beneficiul plătit).
    public.public_theme_settings(r.id, r.theme_settings),
    -- mig 309: ridicarea se re-verifică la CITIRE (fără feature-ul de ridicare
    -- pagina nu mai arată un flux pe care create_order îl refuză la final).
    public.public_pickup_settings(r.id, r.pickup_settings),
    r.google_review_url,
    -- mig 219: limbile meniului — publice prin definiție (whitelist pe /m/:slug).
    r.menu_languages,
    -- mig 298: țara (prefixul telefonic implicit al oaspetelui).
    r.country
  from public.restaurants r
  where lower(r.slug) = lower(p_slug)
    and r.is_active = true
  limit 1;
$function$;

-- `create or replace` păstrează ACL-ul lui 298; grant-ul e idempotent.
grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Asserții fail-closed la aplicare (centură; acoperirea permanentă e suita
--    PU1–PU10, care rulează pe starea FINALĂ a lanțului la fiecare replay).
--    Se RE-afirmă și invariantele moștenite: o recreare care le pierde trebuie
--    să pice AICI. Verificările TEXTUALE se fac pe COD, fără comentarii:
--    `prosrc`/`pg_get_functiondef` includ comentariile din corp, deci un
--    literal rămas într-un comentariu ar satisface o asserție de prezență.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  c_helper constant text := 'public.public_pickup_settings(uuid,jsonb)';
  c_slug   constant text := 'public.get_restaurant_by_slug(text)';
  c_none   constant uuid := '00000000-0000-0000-0000-000000000000';
  -- comentariile (`/* … */`, apoi `-- …`) scoase înainte de orice potrivire.
  c_block  constant text := '/\*.*?\*/';
  c_line   constant text := '--[^\n]*';
  v_src  text;
  v_cols text;
  v_bad  text;
  v_n    int;
begin
  -- (a) helperul: o singură semnătură, DEFINER, pg_temp, zero EXECUTE client.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'public_pickup_settings';
  if v_n <> 1 then
    raise exception 'mig 309: public_pickup_settings are % semnături (așteptat 1)', v_n;
  end if;
  if not exists (select 1 from pg_proc
                  where oid = c_helper::regprocedure and prosecdef
                    and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
    raise exception 'mig 309: public_pickup_settings nu e DEFINER cu search_path = public, pg_temp';
  end if;
  select string_agg(r.rol, ', ') into v_bad
    from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
   where has_function_privilege(r.rol, c_helper, 'execute');
  if v_bad is not null then
    raise exception 'mig 309: public_pickup_settings e apelabil de roluri client: %', v_bad;
  end if;
  -- feature-ul se rezolvă prin punctul de trecere din 296, nu ocolindu-l (CC6).
  -- Pe COD: un `'pickup_orders'` rămas într-un comentariu nu contează (suita
  -- PU10 leagă apoi feature-ul pe COMPORTAMENT).
  if position('restaurant_has_feature(p_restaurant_id, ''pickup_orders'')'
              in (select regexp_replace(regexp_replace(prosrc, c_block, '', 'g'), c_line, '', 'g')
                    from pg_proc where oid = c_helper::regprocedure)) = 0 then
    raise exception 'mig 309: public_pickup_settings nu rezolvă feature-ul pickup_orders prin restaurant_has_feature';
  end if;

  -- (b) helperul: comportament. Un id inexistent n-are niciun feature
  -- (restaurant_has_feature → false), deci e ramura „fără ridicare”.
  if public.public_pickup_settings(c_none, '{"enabled":true,"min_lead_time_minutes":20}'::jsonb)
       is distinct from '{"enabled":false,"min_lead_time_minutes":20}'::jsonb
     or public.public_pickup_settings(c_none, '{"enabled":"true"}'::jsonb)
       is distinct from '{"enabled":false}'::jsonb
     or public.public_pickup_settings(c_none, '{"enabled":false,"x":1}'::jsonb)
       is distinct from '{"enabled":false,"x":1}'::jsonb
     or public.public_pickup_settings(c_none, '{"x":1}'::jsonb)
       is distinct from '{"x":1}'::jsonb
     or public.public_pickup_settings(c_none, null) is not null
     or public.public_pickup_settings(c_none, '5'::jsonb) is distinct from '5'::jsonb then
    raise exception 'mig 309: public_pickup_settings nu respectă contractul (enabled→false fără feature; restul neatins; fără chei inventate; NULL→NULL)';
  end if;

  -- (c) proiecția: helperul e folosit, iar coloana NU mai pleacă brut.
  v_src := regexp_replace(regexp_replace(pg_get_functiondef(c_slug::regprocedure),
                                         c_block, '', 'g'), c_line, '', 'g');
  if position('public.public_pickup_settings(r.id, r.pickup_settings)' in v_src) = 0 then
    raise exception 'mig 309: get_restaurant_by_slug nu trece pickup_settings prin gate-ul de citire';
  end if;
  if (length(v_src) - length(replace(v_src, 'r.pickup_settings', ''))) / length('r.pickup_settings') <> 1 then
    raise exception 'mig 309: get_restaurant_by_slug mai referă r.pickup_settings în afara helperului (proiecție brută?)';
  end if;

  -- (d) forma coloanelor — identică cu 298 (create or replace fără DROP).
  select string_agg(a.n, ',' order by a.o) into v_cols
    from unnest((select proargnames from pg_proc where oid = c_slug::regprocedure),
                (select proargmodes::text[] from pg_proc where oid = c_slug::regprocedure))
         with ordinality as a(n, m, o)
   where a.m = 't';
  if v_cols is distinct from
     'id,name,slug,description,tagline,address,phone,hours,logo_url,cover_url,primary_color,is_active,qr_token,currency,tax_included,language,socials,amenities,hours_structured,wifi_password,timezone,theme_settings,pickup_settings,google_review_url,menu_languages,country' then
    raise exception 'mig 309: forma lui get_restaurant_by_slug s-a schimbat: %', v_cols;
  end if;

  -- (e) invarianții moșteniți: 217 / 219 / 281 / 148 / 298 + DEFINER + ACL.
  if position('r.wifi_password' in v_src) > 0 or position('r.qr_token' in v_src) > 0 then
    raise exception 'mig 309: get_restaurant_by_slug scurge wifi_password/qr_token (217)'; end if;
  if position('r.menu_languages' in v_src) = 0
     or position('public.public_theme_settings(r.id, r.theme_settings)' in v_src) = 0
     or position('lower(r.slug) = lower(p_slug)' in v_src) = 0
     or position('r.country' in v_src) = 0 then
    raise exception 'mig 309: get_restaurant_by_slug a pierdut un invariant (219 menu_languages / 281 branding / 148 slug / 298 country)'; end if;
  if not exists (select 1 from pg_proc
                  where oid = c_slug::regprocedure and prosecdef
                    and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
    raise exception 'mig 309: get_restaurant_by_slug și-a pierdut DEFINER/search_path'; end if;
  if not has_function_privilege('anon', c_slug, 'execute')
     or not has_function_privilege('authenticated', c_slug, 'execute') then
    raise exception 'mig 309: get_restaurant_by_slug nu mai e apelabil de anon/authenticated'; end if;

  -- (f) get_menu_by_slug rămâne compunere PURĂ → moștenește gate-ul (245).
  --     Capcană de regex: în ARE-ul Postgres `\b` e BACKSPACE, nu graniță de
  --     cuvânt — `restaurants\b` nu se potrivea NICIODATĂ (verificare moartă în
  --     prima variantă a acestui fișier); granița de final e `\M`.
  v_src := regexp_replace(regexp_replace(pg_get_functiondef('public.get_menu_by_slug(text)'::regprocedure),
                                         c_block, '', 'g'), c_line, '', 'g');
  if position('public.get_restaurant_by_slug(p_slug)' in v_src) = 0
     or v_src ~* '(from|join)\s+(public\.)?restaurants\M'
     or position('pickup_settings' in v_src) > 0 then
    raise exception 'mig 309: get_menu_by_slug nu mai e compunere pură peste get_restaurant_by_slug (n-ar moșteni gate-ul)'; end if;

  raise notice 'mig 309: ridicarea pe /m/:slug gate-uită la citire (public_pickup_settings) OK';
end $$;

commit;
