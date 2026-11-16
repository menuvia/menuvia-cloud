-- tests/sql/auto/326_qr_time_zone.sql
-- =============================================================================
-- QX1–QX6 — clichetul PERMANENT al mig 326: proiecția QR (`resolve_qr_token`)
-- expune fusul LOCALULUI, brut, ca `get_restaurant_by_slug`, fără să piardă
-- niciun invariant al proiecției anon. Rulează din tests/sql/auto/
-- (scripts/run-sql-auto.sh) pe AMBELE medii; autonom, ROLLBACK la final.
--
-- DE CE AICI ȘI NU DOAR ÎN MIGRAȚIE: asserțiile din corpul mig 326 se evaluează
-- o SINGURĂ dată, la poziția 326 din lanț (clasa DP6 / VS8); fișierul ăsta
-- rulează pe starea FINALĂ a lanțului, deci o recreare VIITOARE a funcției care
-- pierde cheia sau un gate face CI roșu.
--
-- Apelurile oaspetelui se fac SUB rolul REAL `anon` (și `authenticated`), prin
-- `execute` DINAMIC: ca `postgres`, EXECUTE și RLS sunt ocolite (un test „anon
-- poate” ar fi vacuu), iar un apel STATIC își cachează verificarea EXECUTE per
-- tranzacție (capcana TS4 din 312). Comparațiile sunt `is distinct from`;
-- seturile de chei se compară ordonate cu `collate "C"`.
--
--   QX1  CONTROL POZITIV, ca anon: `resolve_qr_token(tok_NY)->restaurant->>timezone`
--        = America/New_York; `resolve_qr_menu` (compunere 245) dă ACELAȘI fus;
--        controlul RO dă Europe/Bucharest.
--        [PICĂ: migrația fără cheie (= replay fără 326); funcția trecută pe
--         `security invoker` (anon nu citește `restaurants` → null)]
--   QX2  PARITATE /q ↔ /m pe NY, RO și un fus INVALID (Mars/Olympus, coloana n-are
--        CHECK): fusul din proiecția QR coincide cu cel din `get_restaurant_by_slug`,
--        ambele ca anon; pe fusul invalid valoarea e BRUTĂ și apelul NU aruncă.
--        [PICĂ: `public.safe_time_zone(r.timezone)` (R_BAD → București ≠ slug);
--         o conversie `now() at time zone r.timezone` (aruncă pe R_BAD)]
--   QX3  Token EXPIRAT → null; token inexistent → null (ca anon); control: același
--        restaurant pe un token valid întoarce rândul.
--        [PICĂ: garda `expires_at` scoasă]
--   QX4  FORMA ÎNGHEȚATĂ: cheile obiectului `restaurant` = EXACT cele 13
--        (address, checkout_suggestion_settings, currency, hours, id, language,
--        logo_url, menu_languages, name, phone, primary_color, theme_settings,
--        timezone); cheile de sus = {orderingAllowed, restaurant, table, token};
--        parola de wifi și token-ul legacy STOCATE pe R_NY nu apar nicăieri în
--        răspuns (control: chiar sunt stocate).
--        [PICĂ: `'country'` / `'pickup_settings'` / `'wifi_password'` adăugat;
--         orice cheie scoasă]
--   QX5  Gate-urile MOȘTENITE, pe ieșirea reală ca anon: R_BR (stocat
--        hide_branding=true pe growth, apoi DOWNGRADE la free) → `hide_branding`
--        distinct de true (281); R_BR (free) → `orderingAllowed = false`, R_NY
--        (growth) → true (127); restaurant INACTIV → null.
--        [PICĂ: `public_theme_settings` ocolit (theme brut); gate-ul `order_qr`
--         scos; filtrul `r.is_active = true` scos]
--   QX6  SUPRAFAȚA: exact 1 semnătură; DEFINER, VOLATILE, `search_path = public,
--        pg_temp`; anon și authenticated pot executa AMBELE proiecții QR
--        (`has_function_privilege`) ȘI un apel REAL ca `authenticated` întoarce
--        rândul cu fusul; `resolve_qr_menu` rămâne compunere PURĂ.
--        [PICĂ: `revoke execute … from public, anon`; un overload cu 2 argumente;
--         `search_path` fără pg_temp]
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- Un owner per restaurant: `enforce_restaurant_limit` (131) dă UN local pe growth.
insert into auth.users (id, email) values
  ('32600000-0000-4000-8000-000000000001', 'qx-ny@qx326.test'),
  ('32600000-0000-4000-8000-000000000002', 'qx-ro@qx326.test'),
  ('32600000-0000-4000-8000-000000000003', 'qx-bad@qx326.test'),
  ('32600000-0000-4000-8000-000000000004', 'qx-br@qx326.test'),
  ('32600000-0000-4000-8000-000000000005', 'qx-off@qx326.test'),
  ('32600000-0000-4000-8000-000000000006', 'qx-guest@qx326.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'qx-%@qx326.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('32600000-0000-4000-8000-000000000001', '32600000-0000-4000-8000-000000000002',
              '32600000-0000-4000-8000-000000000003', '32600000-0000-4000-8000-000000000004',
              '32600000-0000-4000-8000-000000000005');

insert into public.restaurants (id, owner_id, name, slug, city, is_active, country, timezone, wifi_password, qr_token) values
  ('326b0000-0000-4000-8000-000000000001', '32600000-0000-4000-8000-000000000001', 'QX NY',  'qx326-ny',  'New York', true,  'US', 'America/New_York', 'wifi-qx326', 'legacy-qx326'),
  ('326b0000-0000-4000-8000-000000000002', '32600000-0000-4000-8000-000000000002', 'QX RO',  'qx326-ro',  'Cluj',     true,  'RO', 'Europe/Bucharest', null, null),
  ('326b0000-0000-4000-8000-000000000003', '32600000-0000-4000-8000-000000000003', 'QX BAD', 'qx326-bad', 'Nicăieri', true,  'US', 'Mars/Olympus',     null, null),
  ('326b0000-0000-4000-8000-000000000004', '32600000-0000-4000-8000-000000000004', 'QX BR',  'qx326-br',  'Cluj',     true,  'RO', 'Europe/Bucharest', null, null),
  ('326b0000-0000-4000-8000-000000000005', '32600000-0000-4000-8000-000000000005', 'QX OFF', 'qx326-off', 'New York', false, 'US', 'America/New_York', null, null);

-- Branding: se SCRIE pe growth (are remove_branding — gate-ul de scriere 225 l-ar
-- normaliza pe un plan mic), apoi DOWNGRADE la free: scenariul în care gate-ul
-- de CITIRE (281) face muncă reală (tiparul PB1).
update public.restaurants
   set theme_settings = '{"hide_branding": true, "accent": "#123456"}'::jsonb
 where id = '326b0000-0000-4000-8000-000000000004';
update public.profiles set plan = 'free' where id = '32600000-0000-4000-8000-000000000004';

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('326c0000-0000-4000-8000-000000000001', '326b0000-0000-4000-8000-000000000001', 'Masa NY',  'qx-masa-ny',  4, true),
  ('326c0000-0000-4000-8000-000000000006', '326b0000-0000-4000-8000-000000000001', 'Masa NY 2', 'qx-masa-ny2', 4, true),
  ('326c0000-0000-4000-8000-000000000002', '326b0000-0000-4000-8000-000000000002', 'Masa RO',  'qx-masa-ro',  4, true),
  ('326c0000-0000-4000-8000-000000000003', '326b0000-0000-4000-8000-000000000003', 'Masa BAD', 'qx-masa-bad', 4, true),
  ('326c0000-0000-4000-8000-000000000004', '326b0000-0000-4000-8000-000000000004', 'Masa BR',  'qx-masa-br',  4, true),
  ('326c0000-0000-4000-8000-000000000005', '326b0000-0000-4000-8000-000000000005', 'Masa OFF', 'qx-masa-off', 4, true);

-- Un token ACTIV per masă (un token nou îl dezactivează pe cel vechi), deci
-- token-ul expirat stă pe a doua masă a lui R_NY.
insert into public.qr_tokens (token, restaurant_id, table_id, is_active, expires_at) values
  ('qx326-tok-ny',      '326b0000-0000-4000-8000-000000000001', '326c0000-0000-4000-8000-000000000001', true, null),
  ('qx326-tok-ny-exp',  '326b0000-0000-4000-8000-000000000001', '326c0000-0000-4000-8000-000000000006', true, now() - interval '1 day'),
  ('qx326-tok-ro',      '326b0000-0000-4000-8000-000000000002', '326c0000-0000-4000-8000-000000000002', true, null),
  ('qx326-tok-bad',     '326b0000-0000-4000-8000-000000000003', '326c0000-0000-4000-8000-000000000003', true, null),
  ('qx326-tok-br',      '326b0000-0000-4000-8000-000000000004', '326c0000-0000-4000-8000-000000000004', true, null),
  ('qx326-tok-off',     '326b0000-0000-4000-8000-000000000005', '326c0000-0000-4000-8000-000000000005', true, null);

-- Apel al unei proiecții QR sub un rol REAL, prin execute DINAMIC. Excepția se
-- întoarce ca obiect `{raised, sqlstate, error}` (o proiecție nu are voie să
-- arunce pe un fus invalid — QX2 o verifică explicit). Rolul se pune ÎN AFARA
-- sub-blocului cu excepție: un set_config din sub-bloc s-ar rula înapoi.
create function pg_temp.qx_call(p_role text, p_fn text, p_arg text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute format('select public.%I($1)', p_fn) into v using p_arg;
  exception when others then
    v := jsonb_build_object('raised', true, 'sqlstate', sqlstate, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  return v;
end $$;

-- Fusul din proiecția pe slug (/m, /rezervare), sub un rol REAL.
create function pg_temp.qx_slug_tz(p_role text, p_slug text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform set_config('role', p_role, true);
  begin
    execute 'select timezone from public.get_restaurant_by_slug($1)' into v using p_slug;
  exception when others then
    v := 'RAISED: ' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('role', 'none', true);
  return v;
end $$;

-- ── QX1: control pozitiv ─────────────────────────────────────────────────────
do $$
declare
  v_q  jsonb;
  v_m  jsonb;
  v_ro jsonb;
begin
  v_q  := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-ny');
  v_m  := pg_temp.qx_call('anon', 'resolve_qr_menu',  'qx326-tok-ny');
  v_ro := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-ro');
  if v_q is null or v_q ? 'raised' then
    raise exception 'QX1 FAIL: resolve_qr_token(NY) ca anon → % (fixtura sau suprafața e greșită)', v_q;
  end if;
  if v_q -> 'restaurant' ->> 'timezone' is distinct from 'America/New_York' then
    raise exception 'QX1 FAIL: resolve_qr_token(NY) nu expune fusul localului (restaurant: %)', v_q -> 'restaurant';
  end if;
  if v_m #>> '{resolved,restaurant,timezone}' is distinct from 'America/New_York' then
    raise exception 'QX1 FAIL: resolve_qr_menu(NY) nu moștenește fusul (resolved: %)', v_m -> 'resolved';
  end if;
  if v_ro -> 'restaurant' ->> 'timezone' is distinct from 'Europe/Bucharest' then
    raise exception 'QX1 FAIL: controlul RO → % (așteptat Europe/Bucharest)', v_ro -> 'restaurant' -> 'timezone';
  end if;
  raise notice 'QX1 PASS: /q expune fusul localului (NY, RO), iar compunerea 245 îl moștenește';
end $$;

-- ── QX2: paritate /q ↔ /m, inclusiv pe un fus invalid ─────────────────────────
do $$
declare
  v_case record;
  v_q    jsonb;
  v_slug text;
begin
  for v_case in
    select * from (values
      ('qx326-tok-ny',  'qx326-ny',  'America/New_York'),
      ('qx326-tok-ro',  'qx326-ro',  'Europe/Bucharest'),
      ('qx326-tok-bad', 'qx326-bad', 'Mars/Olympus')
    ) as t(tok, slug, expected)
  loop
    v_q    := pg_temp.qx_call('anon', 'resolve_qr_token', v_case.tok);
    v_slug := pg_temp.qx_slug_tz('anon', v_case.slug);
    if v_q is null or v_q ? 'raised' then
      raise exception 'QX2 FAIL: resolve_qr_token(%) ca anon → % (o proiecție nu are voie să arunce pe un fus invalid)', v_case.tok, v_q;
    end if;
    if v_slug is distinct from v_case.expected then
      raise exception 'QX2 FAIL (control): get_restaurant_by_slug(%) → % (așteptat %)', v_case.slug, v_slug, v_case.expected;
    end if;
    if v_q -> 'restaurant' ->> 'timezone' is distinct from v_slug then
      raise exception 'QX2 FAIL: /q dă % iar /m dă % pentru același local (%) — fusul trebuie să fie BRUT pe ambele',
        v_q -> 'restaurant' ->> 'timezone', v_slug, v_case.slug;
    end if;
  end loop;
  raise notice 'QX2 PASS: /q și /m expun același fus brut (NY, RO, fus invalid fără excepție)';
end $$;

-- ── QX3: token expirat / inexistent ──────────────────────────────────────────
do $$
declare
  v_exp  jsonb;
  v_none jsonb;
  v_ok   jsonb;
begin
  v_ok   := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-ny');
  v_exp  := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-ny-exp');
  v_none := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-nu-exista');
  if v_ok is null or v_ok ? 'raised' then
    raise exception 'QX3 FAIL (control): token-ul valid al aceluiași local → %', v_ok;
  end if;
  if v_exp is not null then
    raise exception 'QX3 FAIL: un token EXPIRAT întoarce %', v_exp;
  end if;
  if v_none is not null then
    raise exception 'QX3 FAIL: un token inexistent întoarce %', v_none;
  end if;
  raise notice 'QX3 PASS: token expirat / inexistent → null; valid → rândul';
end $$;

-- ── QX4: forma înghețată ─────────────────────────────────────────────────────
do $$
declare
  v_q        jsonb;
  v_keys     text[];
  v_expected text[] := array(
    select k from unnest(array[
      'address', 'checkout_suggestion_settings', 'currency', 'hours', 'id', 'language',
      'logo_url', 'menu_languages', 'name', 'phone', 'primary_color', 'theme_settings',
      'timezone'
    ]) k order by k collate "C");
  v_top_exp  text[] := array(
    select k from unnest(array['orderingAllowed', 'restaurant', 'table', 'token']) k
     order by k collate "C");
begin
  -- Control: valorile secrete chiar sunt STOCATE (altfel absența lor e vacuă).
  if (select wifi_password from public.restaurants where id = '326b0000-0000-4000-8000-000000000001')
       is distinct from 'wifi-qx326'
     or (select qr_token from public.restaurants where id = '326b0000-0000-4000-8000-000000000001')
       is distinct from 'legacy-qx326' then
    raise exception 'QX4 FAIL (control): parola de wifi / token-ul legacy nu s-au stocat pe R_NY';
  end if;

  v_q := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-ny');
  if v_q is null or v_q ? 'raised' then
    raise exception 'QX4 FAIL: resolve_qr_token(NY) → %', v_q;
  end if;

  select array_agg(k order by k collate "C") into v_keys
    from jsonb_object_keys(v_q -> 'restaurant') k;
  if v_keys is distinct from v_expected then
    raise exception 'QX4 FAIL: cheile restaurantului pe /q = % (așteptat EXACT %)', v_keys, v_expected;
  end if;

  select array_agg(k order by k collate "C") into v_keys
    from jsonb_object_keys(v_q) k;
  if v_keys is distinct from v_top_exp then
    raise exception 'QX4 FAIL: cheile de sus = % (așteptat %)', v_keys, v_top_exp;
  end if;

  if position('wifi-qx326' in v_q::text) > 0 or position('legacy-qx326' in v_q::text) > 0 then
    raise exception 'QX4 FAIL: proiecția QR scoate parola de wifi sau token-ul legacy: %', v_q;
  end if;
  raise notice 'QX4 PASS: 13 chei exacte pe restaurant, 4 sus, fără secrete';
end $$;

-- ── QX5: gate-urile moștenite (281, 127, is_active) ──────────────────────────
do $$
declare
  v_br  jsonb;
  v_ny  jsonb;
  v_off jsonb;
begin
  if (select theme_settings -> 'hide_branding' from public.restaurants
       where id = '326b0000-0000-4000-8000-000000000004') is distinct from 'true'::jsonb then
    raise exception 'QX5 FAIL (control): hide_branding nu s-a stocat true pe R_BR — testul ar fi vacuu';
  end if;
  if (select plan from public.profiles where id = '32600000-0000-4000-8000-000000000004')
       is distinct from 'free' then
    raise exception 'QX5 FAIL (control): owner-ul R_BR nu e pe free după downgrade';
  end if;

  v_br  := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-br');
  v_ny  := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-ny');
  v_off := pg_temp.qx_call('anon', 'resolve_qr_token', 'qx326-tok-off');

  if v_br is null or v_br ? 'raised' then
    raise exception 'QX5 FAIL: resolve_qr_token(BR) → %', v_br;
  end if;
  if v_br #> '{restaurant,theme_settings,hide_branding}' is not distinct from 'true'::jsonb then
    raise exception 'QX5 FAIL: gate-ul de branding la citire (281) a dispărut: theme %', v_br #> '{restaurant,theme_settings}';
  end if;
  if v_br #>> '{restaurant,theme_settings,accent}' is distinct from '#123456' then
    raise exception 'QX5 FAIL: restul temei nu mai trece neatins (%)', v_br #> '{restaurant,theme_settings}';
  end if;
  if (v_br ->> 'orderingAllowed')::boolean is distinct from false then
    raise exception 'QX5 FAIL: gate-ul order_qr (127) lasă comanda pe free (orderingAllowed %)', v_br -> 'orderingAllowed';
  end if;
  if (v_ny ->> 'orderingAllowed')::boolean is distinct from true then
    raise exception 'QX5 FAIL (control): pe growth comanda QR e închisă (orderingAllowed %)', v_ny -> 'orderingAllowed';
  end if;
  if v_off is not null then
    raise exception 'QX5 FAIL: restaurantul INACTIV întoarce %', v_off;
  end if;
  raise notice 'QX5 PASS: branding la citire, gate order_qr și restaurant inactiv — moștenite';
end $$;

-- ── QX6: suprafața ───────────────────────────────────────────────────────────
do $$
declare
  v_n    int;
  v_def  boolean;
  v_vol  "char";
  v_cfg  text[];
  v_menu text;
  v_sig  text;
  v_auth jsonb;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_qr_token';
  if v_n <> 1 then
    raise exception 'QX6 FAIL: resolve_qr_token are % semnături (anti PGRST203: exact 1)', v_n;
  end if;

  select p.prosecdef, p.provolatile, p.proconfig into v_def, v_vol, v_cfg
    from pg_proc p where p.oid = 'public.resolve_qr_token(text)'::regprocedure;
  if not v_def or v_vol <> 'v' then
    raise exception 'QX6 FAIL: DEFINER/VOLATILE pierdute (prosecdef=%, provolatile=%)', v_def, v_vol;
  end if;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'QX6 FAIL: search_path fără pg_temp (proconfig=%)', v_cfg;
  end if;

  foreach v_sig in array array['public.resolve_qr_token(text)', 'public.resolve_qr_menu(text)'] loop
    if not has_function_privilege('anon', v_sig, 'execute') then
      raise exception 'QX6 FAIL: anon nu mai poate executa %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'QX6 FAIL: authenticated nu mai poate executa %', v_sig;
    end if;
  end loop;

  -- Apel REAL ca un oaspete logat (cont fără restaurant).
  perform set_config('request.jwt.claim.sub', '32600000-0000-4000-8000-000000000006', true);
  v_auth := pg_temp.qx_call('authenticated', 'resolve_qr_token', 'qx326-tok-ny');
  perform set_config('request.jwt.claim.sub', '', true);
  if v_auth is null or v_auth ? 'raised'
     or v_auth -> 'restaurant' ->> 'timezone' is distinct from 'America/New_York' then
    raise exception 'QX6 FAIL: apelul REAL ca authenticated → %', v_auth;
  end if;

  select p.prosrc into v_menu
    from pg_proc p where p.oid = 'public.resolve_qr_menu(text)'::regprocedure;
  if position('public.resolve_qr_token(' in v_menu) = 0 or position('restaurants' in v_menu) > 0 then
    raise exception 'QX6 FAIL: resolve_qr_menu nu mai e compunere pură peste resolve_qr_token (245/LH7)';
  end if;
  raise notice 'QX6 PASS: o semnătură, DEFINER/VOLATILE/pg_temp, anon+authenticated, compunere pură';
end $$;

rollback;
