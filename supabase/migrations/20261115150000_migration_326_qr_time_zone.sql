-- migration_326_qr_time_zone.sql
-- =============================================================================
-- G2c: meniul QR (/q) află fusul LOCALULUI, ca /m și /rezervare.
--
-- ── Problema ────────────────────────────────────────────────────────────────
-- Pe /m/:slug și /rezervare/:slug oaspetele vede orele în fusul restaurantului:
-- `get_restaurant_by_slug` (013→…→298→309) proiectează `timezone` brut, iar
-- `get_menu_by_slug` (245, compunere pură) îl moștenește. Pe /q, proiecția e
-- `resolve_qr_token`, care NU expune fusul — deci „Masa ta” (QrCartSheet:
-- `#A1B2 · 19:05` pentru fiecare comandă trimisă) formata ora în fusul
-- TELEFONULUI. Un turist cu telefonul pe ora lui vedea alt „19:05” decât
-- ospătarul, pentru aceeași comandă, la aceeași masă.
--
-- ── Remediul ────────────────────────────────────────────────────────────────
-- `resolve_qr_token` (lanț 022→023→024→127→206→281→298→**326**; 262 a schimbat
-- doar `search_path` prin ALTER) = copie VERBATIM a definiției vii din 298
-- (luată cu `pg_get_functiondef` pe replay, nu din textul unui fișier vechi) +
-- O SINGURĂ cheie nouă, la FINALUL obiectului restaurantului:
-- `'timezone', r.timezone`.
--   * BRUT, nu prin helperul de fus validat: paritate EXACTĂ cu
--     `get_restaurant_by_slug` (/q și /m văd același șir pentru același local),
--     iar calea lentă a helperului (scanarea `pg_timezone_names`) ar costa ~10 ms
--     per scanare pe orice local din afara Bucureștiului (măsurat în 324).
--     Clientul aplică oricum `safeTimeZone` (fus invalid → București).
--   * Fără `country`: pe /q n-are niciun consumator, deci whitelist-ul rămâne
--     minim (disciplina 217/219/281).
--   * `resolve_qr_menu` (245) e compunere PURĂ peste `resolve_qr_token`, deci
--     moștenește cheia fără recreare (LH7 + asserția din 245 rămân neatinse).
--
-- ── Suprafața ───────────────────────────────────────────────────────────────
-- `create or replace`, FĂRĂ DROP: returul rămâne `jsonb`, deci semnătura,
-- proprietarul și ACL-ul viu (`=X`, anon, authenticated — EXECUTE vine și prin
-- PUBLIC, deci și service_role) se păstrează. Fără grant/revoke: un `revoke ...
-- from public` ar schimba ACL-ul viu, ar tăia service_role și ar cere
-- revalidarea allowlist-ului AH1 (297). `search_path` se scrie EXPLICIT:
-- `create or replace` rescrie `proconfig`, iar PB7/RP5 cer pg_temp.
--
-- ── Invariante păstrate (verbatim din 298) ──────────────────────────────────
--   * token activ + garda `expires_at` → null; masa lipsă → null;
--   * proiecție cu chei EXPLICITE pe `restaurants` (PU8, auto/309) — acum 13:
--     id, name, primary_color, logo_url, address, phone, hours,
--     checkout_suggestion_settings, theme_settings, menu_languages, currency,
--     language, timezone;
--   * `theme_settings` trece prin `public_theme_settings` (281, PB2/PB6);
--   * fără parola de wifi, fără token-ul legacy al restaurantului, fără setările
--     de ridicare (217/262/PB6/PU8);
--   * restaurant inactiv → null; `ordering_enabled` cu `coalesce true`;
--   * gate-ul de plan `order_qr` inline pe tabela de feature-uri, cu join pe
--     planul owner-ului (127, PB6) — funcția rămâne în registrul CC6 (296);
--   * returul `{token, table, restaurant, orderingAllowed}`;
--   * SECURITY DEFINER, VOLATILE, o singură semnătură.
-- Comentariile din corp nu numesc între ghilimele niciun feature românesc:
-- clichetul CC6 citește `prosrc` CU comentarii.
--
-- ── Toleranța clientului / ordinea de deploy ────────────────────────────────
-- Bază fără 326 → cheia lipsește → `mapResolvedQrPayload` dă `timezone: null`
-- → `safeTimeZone(null)` = București, exact comportamentul de dinainte. Client
-- vechi pe bază cu 326 → cheia în plus e ignorată de maparea pe whitelist.
-- Ordinea e liberă. Migrația nu conține DROP, deci se poate aplica și prin MCP.
-- Independentă funcțional de 324/325 (atinge o singură funcție, pe care
-- niciuna dintre ele n-o redefinește).
--
-- Asserții fail-closed la final (a)–(g); clichetul PERMANENT, pe starea finală
-- a lanțului, e `tests/sql/auto/326_qr_time_zone.sql` (QX1–QX6).
-- =============================================================================

begin;

set local lock_timeout = '10s';

-- ── §1. resolve_qr_token, lanț …→281→298→326: + timezone ────────────────────
create or replace function public.resolve_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_qr         public.qr_tokens%rowtype;
  v_table      public.tables%rowtype;
  v_restaurant jsonb;
  v_ordering   boolean := true;
  v_feature    boolean := false;
begin
  select * into v_qr
  from public.qr_tokens
  where token = p_token and is_active = true;

  if not found then return null; end if;

  if v_qr.expires_at is not null and v_qr.expires_at < now() then
    return null;
  end if;

  select * into v_table
  from public.tables
  where id = v_qr.table_id;

  if not found then return null; end if;

  select jsonb_build_object(
    'id',                            r.id,
    'name',                          r.name,
    'primary_color',                 r.primary_color,
    'logo_url',                      r.logo_url,
    'address',                       r.address,
    'phone',                         r.phone,
    'hours',                         r.hours,
    'checkout_suggestion_settings',  r.checkout_suggestion_settings,
    -- mig 281: gate de branding la CITIRE (vezi antetul).
    'theme_settings',                public.public_theme_settings(r.id, r.theme_settings),
    'menu_languages',                r.menu_languages,
    'currency',                      r.currency,
    -- mig 298: limba de BAZĂ a meniului — QR-ul pornește pe ea, nu pe 'ro'.
    'language',                      r.language,
    -- mig 326: fusul localului, BRUT (paritate cu get_restaurant_by_slug);
    -- clientul îl validează (fus invalid → București).
    'timezone',                      r.timezone
  ) into v_restaurant
  from public.restaurants r
  where r.id = v_qr.restaurant_id and r.is_active = true;

  if v_restaurant is null then return null; end if;

  select coalesce(rs.ordering_enabled, true) into v_ordering
  from public.restaurant_settings rs
  where rs.restaurant_id = v_qr.restaurant_id;

  -- Gate de plan (mig 127): comanda QR e Plan 2+ (feature order_qr). Inline pe
  -- plan_features ca enforce_feature_for_restaurant, ca sa mearga si pe anon.
  select coalesce(pf.enabled, false) into v_feature
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf on pf.plan = pr.plan and pf.feature = 'order_qr'
  where r.id = v_qr.restaurant_id;

  return jsonb_build_object(
    'token',           to_jsonb(v_qr),
    'table',           to_jsonb(v_table),
    'restaurant',      v_restaurant,
    'orderingAllowed', coalesce(v_ordering, true) and coalesce(v_feature, false)
  );
end;
$function$;

-- ── §2. Asserții fail-closed ────────────────────────────────────────────────
do $$
declare
  v_n     int;
  v_src   text;
  v_menu  text;
  v_def   boolean;
  v_vol   "char";
  v_cfg   text[];
  v_sig   text;
begin
  -- (a) exact o semnătură (anti PGRST203)
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_qr_token';
  if v_n <> 1 then
    raise exception 'mig 326: resolve_qr_token are % semnături (așteptat 1)', v_n;
  end if;

  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_src, v_def, v_vol, v_cfg
    from pg_proc p
   where p.oid = 'public.resolve_qr_token(text)'::regprocedure;

  -- (b) DEFINER + VOLATILE
  if not v_def or v_vol <> 'v' then
    raise exception 'mig 326: resolve_qr_token și-a pierdut DEFINER/VOLATILE (prosecdef=%, provolatile=%)', v_def, v_vol;
  end if;

  -- (c) search_path cu pg_temp
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 326: resolve_qr_token și-a pierdut search_path = public, pg_temp (proconfig=%)', v_cfg;
  end if;

  -- (d) invariantele proiecției + cheia nouă
  foreach v_sig in array array[
    '''timezone''', 'r.timezone',
    'public.public_theme_settings(r.id, r.theme_settings)',
    '''order_qr''', 'r.menu_languages', 'r.language', 'r.currency',
    'r.is_active = true', 'expires_at'
  ] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 326: resolve_qr_token a pierdut „%"', v_sig;
    end if;
  end loop;

  -- (e) nimic din ce nu are voie în proiecția anon; fusul BRUT, nu validat
  foreach v_sig in array array[
    'r.wifi_password', 'r.qr_token', 'pickup_settings', 'to_jsonb(r)', 'r.*',
    'safe_time_zone('
  ] loop
    if position(v_sig in v_src) > 0 then
      raise exception 'mig 326: resolve_qr_token conține „%" (proiecție anon interzisă)', v_sig;
    end if;
  end loop;
  if v_src ~ '''(fiscal_receipt|online_payments|split_bill|shifts|reports_vat)''' then
    raise exception 'mig 326: resolve_qr_token numește un feature românesc între ghilimele (CC6)';
  end if;

  -- (f) ACL-ul viu: anon + authenticated pe proiecție ȘI pe compunere
  foreach v_sig in array array['public.resolve_qr_token(text)', 'public.resolve_qr_menu(text)'] loop
    if not has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'mig 326: % nu mai e apelabilă de anon/authenticated', v_sig;
    end if;
  end loop;

  -- (g) resolve_qr_menu rămâne compunere PURĂ (245/LH7)
  select p.prosrc into v_menu
    from pg_proc p
   where p.oid = 'public.resolve_qr_menu(text)'::regprocedure;
  if position('public.resolve_qr_token(' in v_menu) = 0 or position('restaurants' in v_menu) > 0 then
    raise exception 'mig 326: resolve_qr_menu nu mai e compunere pură peste resolve_qr_token';
  end if;
end $$;

commit;
