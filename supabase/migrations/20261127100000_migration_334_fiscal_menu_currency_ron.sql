-- migration_334_fiscal_menu_currency_ron.sql
-- =============================================================================
-- Lotul M1 (Partea III): moneda meniului pe un restaurant cu BON FISCAL e RON,
-- impusă în DATE (regula de aur: bani + bon fiscal = Planul 3, gate-uit în
-- RPC/RLS, nu doar în UI).
--
-- ── Defectul ────────────────────────────────────────────────────────────────
-- `restaurants.currency` (007, activată în 205) e scriibilă de owner/manager
-- (grant pe coloană, 205) pe ORICE plan, iar SettingsTab îi oferea selectorul
-- și unui restaurant românesc pe Planul 3, cu textul „Abonamentul Menuvia și
-- fiscalizarea nu sunt afectate”. Fals: un local pe Fiscalizare care alegea EUR
-- își arăta oaspeților prețuri în € (proiecțiile anon `get_restaurant_by_slug`
-- 148→…→309 și `resolve_qr_token` 022→…→326 proiectau coloana BRUT), în timp ce
-- bonul (FiscalNet), factura Oblio, Acasă și Rapoartele spun lei, iar plata
-- online e RON-only (209, `currency_not_supported`). Aceeași sumă, două monede.
--
-- ── Remediul (tiparul 281 `hide_branding` / 309 `pickup_settings`) ─────────
-- 1. CITIRE = autoritatea. Helperul `public_menu_currency(uuid, text)` —
--    `language sql stable security definer`, `search_path = public, pg_temp`,
--    ZERO EXECUTE pentru roluri client — întoarce 'RON' când restaurantul are
--    feature-ul de bon fiscal (rezolvat prin `restaurant_has_feature`, punctul
--    de trecere din 296 care poartă și gate-ul de ȚARĂ), altfel moneda stocată.
--    Aplicat în cele DOUĂ proiecții anon care poartă moneda; compunerile
--    `get_menu_by_slug`/`resolve_qr_menu` (245) moștenesc fără recreare.
--    Acoperă tot ce scrierea nu poate vedea: UPGRADE cu EUR salvat (planul stă
--    pe `profiles`, nu pe `restaurants` — nimic nu se scrie pe restaurant la
--    schimbarea planului), drift istoric, un PATCH care a trecut înainte de 334.
--    Rândul stocat NU se atinge: un DOWNGRADE de pe Fiscalizare redă moneda
--    aleasă de owner (paritate cu 309).
-- 2. SCRIERE = defense-in-depth. Trigger `trg_restaurants_fiscal_currency_ron`
--    BEFORE INSERT OR UPDATE OF currency, country ROW (tgtype 23): pe un rând
--    NOU care ar ajunge restaurant cu bon fiscal și monedă ≠ RON → refuz,
--    hint `fiscal_currency_ron_only`, ERRCODE check_violation, mesaj românesc
--    fără nume de plan (PD1).
--      • Planul se rezolvă pe `NEW.owner_id` + `NEW.country`, NU pe `NEW.id`:
--        la BEFORE INSERT rândul nu există încă, iar la BEFORE UPDATE tabela
--        arată încă țara VECHE — lecția §F din 281. Un owner pe Plan 3 care
--        mută localul RO→DE și alege EUR în ACEEAȘI salvare (SettingsTab
--        trimite tot formularul; locația nouă copiază țara+moneda într-un
--        singur UPDATE, lib/pendingCountry.ts) trebuie să treacă.
--      • De aici helperul `restaurant_row_has_feature(owner, țară, feature)`:
--        aceeași regulă ca `restaurant_has_feature` (296), pe un rând IPOTETIC.
--        E un cititor DIRECT al tabelei de feature-uri, deci intră în registrul
--        clichetului CC6 (restaurant_country_assertions.sql) cu motiv; nu
--        numește niciun feature românesc între ghilimele (îl primește ca
--        parametru), iar paritatea cu punctul de trecere e testată (FCR5).
--      • Fără schimbare reală nu se refuză nimic: un UPDATE cu moneda ȘI țara
--        neschimbate trece chiar pe un rând cu drift — salvarea formularului
--        (care trimite mereu `currency`) nu are voie să fie blocată de o stare
--        pe care n-a creat-o. `UPDATE OF col` se declanșează pe coloana din SET,
--        nu pe valoarea schimbată.
--      • `owner_id` NU e în listă: e imuabil (096c), iar singura cale de
--        schimbare (scripts/apply_ownership_remediation.sql) nu trebuie să pice
--        pe monedă; citirea acoperă cazul.
--      • DEFINER: funcția cheamă helperul, care are ZERO EXECUTE pentru roluri
--        client; un trigger NE-definer ar rula ca `authenticated` și orice
--        salvare a setărilor ar pica pe 42501. Gate-ul e pe TOATE rolurile
--        (nu doar client) — niciun scriitor legitim nu pune EUR pe un local cu
--        bon (grep: zero); TP9 (209) ajunge acum la starea EUR pe calea REALĂ:
--        moneda salvată pe un plan fără bon, apoi UPGRADE.
-- 3. Datele existente: NU se rescriu (citirea le face sigure; rescrierea ar
--    pierde alegerea owner-ului la un downgrade ulterior). Numărul lor e
--    consemnat la aplicare (NOTICE) — pe producție se așteaptă 0.
--
-- ── Lanțuri ─────────────────────────────────────────────────────────────────
--   get_restaurant_by_slug  148→217→219→281→298→309→**334** (copie VERBATIM a
--     lui 309 + helperul pe `currency`; forma coloanelor identică, create or
--     replace fără DROP — ACL-ul anon+authenticated se păstrează).
--   resolve_qr_token        022→023→024→127→206→281→298→326→**334** (copie
--     VERBATIM a lui 326 + helperul; fără grant/revoke, ca 326 — ACL viu păstrat).
--   `set search_path = public, pg_temp` scris EXPLICIT pe ambele: `create or
--   replace` rescrie `proconfig` (capcana (a) din 281).
--
-- ── Reziduuri consemnate, NEadresate ────────────────────────────────────────
--   • Drift (Plan 3 cu EUR salvat după un upgrade): oaspetele vede lei, dar
--     plata online rămâne refuzată fail-closed (`begin_table_payment`/
--     `begin_split_payment` citesc moneda STOCATĂ, 209/292) și nota împărțită
--     (`get_table_bill`, service_role) o afișează pe cea stocată, până când
--     owner-ul salvează RON (SettingsTab îi spune exact asta). Banii nu pleacă
--     greșit; recrearea RPC-urilor de bani nu e a acestui lot.
--   • Panoul personalului afișează prețurile în lei oricum (ecranele de bani
--     sunt românești); doar previzualizarea din Setări urma formularul — acum
--     urmează moneda EFECTIVĂ.
--
-- Teste permanente: tests/sql/auto/334_fiscal_menu_currency_ron.sql (FCR1–FCR8,
-- rulat NECONDIȚIONAT de scripts/run-sql-auto.sh în sql-verify ȘI în jobul E2E)
-- + src/lib/__tests__/fiscalCurrency.test.ts (FCL1–FCL5)
-- + src/components/__tests__/SettingsTabCurrency.test.tsx (FCS1–FCS5).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Helperul de rând IPOTETIC (scriere) — regula din 296 pe (owner, țară).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.restaurant_row_has_feature(
  p_owner_id uuid,
  p_country  text,
  p_feature  text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- Oglinda EXACTĂ a lui restaurant_has_feature (296), cu owner-ul și țara
  -- date explicit în loc de citite din rândul stocat: planul e al owner-ului,
  -- iar feature-urile românești cad în afara României (feature_requires_ro).
  select coalesce((
    select pf.enabled
           and (p_country = 'RO' or not public.feature_requires_ro(p_feature))
      from public.profiles pr
      left join public.plan_features pf on pf.plan = pr.plan and pf.feature = p_feature
     where pr.id = p_owner_id
  ), false);
$fn$;

comment on function public.restaurant_row_has_feature(uuid, text, text) is
  'mig 334: feature-ul unui restaurant IPOTETIC (owner + tara) - aceeasi regula ca restaurant_has_feature (296), pentru gate-urile BEFORE INSERT/UPDATE care nu pot citi randul nou din tabela. Helper intern: zero EXECUTE pentru roluri client.';

-- Helper intern. Revoke EXPLICIT per rol: default privileges ale Supabase
-- acordă EXECUTE direct lui service_role (și anon/authenticated pe CLI-ul nou)
-- pe orice funcție NOUĂ, iar `revoke ... from public` nu atinge un grant direct
-- (clasa CJ9, mig 274).
revoke all on function public.restaurant_row_has_feature(uuid, text, text)
  from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Helperul de CITIRE — sursa UNICĂ a regulii pentru ce vede oaspetele.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.public_menu_currency(
  p_restaurant_id uuid,
  p_currency      text
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case
    -- Calea comună (aproape toate localurile): nimic de verificat.
    when p_currency is not distinct from 'RON' then p_currency
    -- Bonul fiscal, factura și plata online sunt în lei: meniul la fel.
    when public.restaurant_has_feature(p_restaurant_id, 'fiscal_receipt') then 'RON'
    else p_currency
  end;
$fn$;

comment on function public.public_menu_currency(uuid, text) is
  'mig 334 (lotul M1): moneda meniului pentru proiectiile PUBLICE - RON cand restaurantul are bon fiscal (regula de aur; restaurant_has_feature poarta si gate-ul de tara din 296), altfel moneda stocata. Gate la CITIRE: acopera upgrade-ul cu EUR salvat si orice drift; randul stocat nu se atinge. Oglinda public_theme_settings (281) / public_pickup_settings (309).';

revoke all on function public.public_menu_currency(uuid, text)
  from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Gate-ul de SCRIERE (defense-in-depth).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_fiscal_menu_currency_ron()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.currency is not distinct from 'RON' then
    return new;
  end if;

  -- Nimic nou: moneda și țara neschimbate. Un drift moștenit (upgrade cu EUR
  -- salvat) nu blochează o salvare fără legătură — formularul trimite mereu
  -- `currency`; autoritatea pentru ce vede oaspetele e helperul de citire.
  if tg_op = 'UPDATE'
     and new.currency is not distinct from old.currency
     and new.country is not distinct from old.country then
    return new;
  end if;

  -- Pe owner + țara NOUĂ, nu pe new.id (rândul nou nu e vizibil — §F din 281).
  if public.restaurant_row_has_feature(new.owner_id, new.country, 'fiscal_receipt') then
    raise exception
      'Pe un restaurant cu bon fiscal, moneda meniului rămâne RON (lei): bonul, factura și plata online sunt în lei.'
      using errcode = 'check_violation', hint = 'fiscal_currency_ron_only';
  end if;
  return new;
end;
$fn$;

comment on function public.enforce_fiscal_menu_currency_ron() is
  'mig 334 (lotul M1): gate de SCRIERE pe restaurants.currency - pe un restaurant cu bon fiscal (owner + tara NOUA, prin restaurant_row_has_feature) moneda e RON (hint fiscal_currency_ron_only). Doar tranzitiile noi: moneda si tara neschimbate trec. Autoritatea e la citire (public_menu_currency).';

-- Funcție de trigger: Postgres nu verifică EXECUTE la declanșare, deci nimeni
-- nu are ce face cu ea prin /rpc (RP13).
revoke all on function public.enforce_fiscal_menu_currency_ron()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_restaurants_fiscal_currency_ron on public.restaurants;
create trigger trg_restaurants_fiscal_currency_ron
  before insert or update of currency, country on public.restaurants
  for each row execute function public.enforce_fiscal_menu_currency_ron();

-- ─────────────────────────────────────────────────────────────────────────────
-- D. `get_restaurant_by_slug` — copie VERBATIM a lui 309 + helperul de monedă.
--    Lanț 148→217→219→281→298→309→334. Orice recreare viitoare pornește de AICI.
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
    -- mig 334: moneda se re-verifică la CITIRE (pe un local cu bon fiscal e RON).
    null::text, public.public_menu_currency(r.id, r.currency), r.tax_included, r.language,
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

-- `create or replace` păstrează ACL-ul lui 309; grant-ul e idempotent.
grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. `resolve_qr_token` — copie VERBATIM a lui 326 + helperul de monedă.
--    Lanț 022→023→024→127→206→281→298→326→334. Fără grant/revoke (ca 326):
--    `create or replace` cu același retur păstrează ACL-ul viu.
-- ─────────────────────────────────────────────────────────────────────────────
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
    -- mig 334: moneda la CITIRE — pe un local cu bon fiscal e RON (helperul).
    'currency',                      public.public_menu_currency(r.id, r.currency),
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

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Coloana: comentariul de la 205 spunea „fiscalizarea RO rămâne pe fluxurile
--    ei” — acum regula e explicită.
-- ─────────────────────────────────────────────────────────────────────────────
comment on column public.restaurants.currency is
  $$Moneda meniului (mig 007, activată în mig 205). DOAR afișare client-side
(fmtPrice, lib/currency.ts). Pe un restaurant cu bon fiscal (Planul 3 în
România) e RON, impus în DATE (mig 334): la scriere trg_restaurants_fiscal_
currency_ron, la citire public_menu_currency în proiecțiile anon. Whitelist prin
CHECK; extinderea listei = migrație nouă.$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Datele existente: doar consemnate (vezi antetul, punctul 3).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from public.restaurants r
   where r.currency <> 'RON'
     and public.restaurant_has_feature(r.id, 'fiscal_receipt');
  raise notice 'mig 334: % restaurant(e) cu bon fiscal și monedă salvată ≠ RON (rămân stocate; oaspeții văd RON prin public_menu_currency)', v_n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Asserții fail-closed la aplicare (centură; acoperirea permanentă e suita
--    FCR1–FCR8, care rulează pe starea FINALĂ a lanțului). Verificările
--    TEXTUALE se fac pe COD, fără comentarii (prosrc le include).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  c_read   constant text := 'public.public_menu_currency(uuid,text)';
  c_row    constant text := 'public.restaurant_row_has_feature(uuid,text,text)';
  c_trgfn  constant text := 'public.enforce_fiscal_menu_currency_ron()';
  c_slug   constant text := 'public.get_restaurant_by_slug(text)';
  c_qr     constant text := 'public.resolve_qr_token(text)';
  c_none   constant uuid := '00000000-0000-0000-0000-000000000000';
  c_block  constant text := '/\*.*?\*/';
  c_line   constant text := '--[^\n]*';
  v_fn   text;
  v_src  text;
  v_bad  text;
  v_cols text;
  v_n    int;
begin
  -- (a) cele trei funcții noi: o semnătură, DEFINER, pg_temp, zero EXECUTE client.
  foreach v_fn in array array[c_read, c_row, c_trgfn] loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = split_part(split_part(v_fn, '.', 2), '(', 1);
    if v_n <> 1 then
      raise exception 'mig 334: % are % semnături (așteptat 1)', v_fn, v_n;
    end if;
    if not exists (select 1 from pg_proc
                    where oid = v_fn::regprocedure and prosecdef
                      and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
      raise exception 'mig 334: % nu e DEFINER cu search_path = public, pg_temp', v_fn;
    end if;
    select string_agg(r.rol, ', ') into v_bad
      from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
     where has_function_privilege(r.rol, v_fn, 'execute');
    if v_bad is not null then
      raise exception 'mig 334: % e apelabil de roluri client: %', v_fn, v_bad;
    end if;
  end loop;

  -- (b) citirea trece prin punctul de trecere din 296 (care poartă țara), nu
  --     ocolindu-l; scrierea nu citește tabela de feature-uri direct.
  select regexp_replace(regexp_replace(prosrc, c_block, '', 'g'), c_line, '', 'g') into v_src
    from pg_proc where oid = c_read::regprocedure;
  if position('restaurant_has_feature(p_restaurant_id, ''fiscal_receipt'')' in v_src) = 0
     or position('plan_features' in v_src) > 0 then
    raise exception 'mig 334: public_menu_currency nu rezolvă bonul fiscal prin restaurant_has_feature';
  end if;
  select regexp_replace(regexp_replace(prosrc, c_block, '', 'g'), c_line, '', 'g') into v_src
    from pg_proc where oid = c_trgfn::regprocedure;
  if position('restaurant_row_has_feature(new.owner_id, new.country, ''fiscal_receipt'')' in v_src) = 0
     or position('plan_features' in v_src) > 0
     or position('fiscal_currency_ron_only' in v_src) = 0 then
    raise exception 'mig 334: gate-ul de scriere nu rezolvă pe owner + țara NOUĂ (sau a pierdut hint-ul)';
  end if;
  -- helperul de rând: cititor direct, dar FĂRĂ feature românesc între ghilimele (CC6).
  select prosrc into v_src from pg_proc where oid = c_row::regprocedure;
  if v_src ~ '''(fiscal_receipt|online_payments|split_bill|shifts|reports_vat)'''
     or position('feature_requires_ro(p_feature)' in v_src) = 0 then
    raise exception 'mig 334: restaurant_row_has_feature numește un feature românesc sau a pierdut gate-ul de țară';
  end if;

  -- (c) comportament pe un id/owner inexistent (fără niciun feature).
  if public.public_menu_currency(c_none, 'EUR') is distinct from 'EUR'
     or public.public_menu_currency(c_none, 'RON') is distinct from 'RON'
     or public.restaurant_row_has_feature(c_none, 'RO', 'fiscal_receipt') then
    raise exception 'mig 334: helperii nu respectă contractul pe un restaurant/owner fără feature';
  end if;

  -- (d) trigger-ul: BEFORE INSERT OR UPDATE OF (currency, country) ROW, pornit.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.restaurants'::regclass
       and t.tgname = 'trg_restaurants_fiscal_currency_ron'
       and t.tgtype = 23 and t.tgenabled = 'O'
       and t.tgfoid = c_trgfn::regprocedure
       and (select array_agg(a.attname::text order by a.attname::text collate "C")
              from pg_attribute a
             where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[]))
           = array['country', 'currency']
  ) then
    raise exception 'mig 334: trigger-ul de monedă lipsește sau are altă formă (tgtype 23, UPDATE OF country, currency)';
  end if;

  -- (e) get_restaurant_by_slug: helperul folosit, coloana NU mai pleacă brut,
  --     forma identică cu 309, invarianții moșteniți.
  v_src := regexp_replace(regexp_replace(pg_get_functiondef(c_slug::regprocedure),
                                         c_block, '', 'g'), c_line, '', 'g');
  if position('public.public_menu_currency(r.id, r.currency)' in v_src) = 0
     or (length(v_src) - length(replace(v_src, 'r.currency', ''))) / length('r.currency') <> 1 then
    raise exception 'mig 334: get_restaurant_by_slug nu trece moneda (doar) prin gate-ul de citire';
  end if;
  select string_agg(a.n, ',' order by a.o) into v_cols
    from unnest((select proargnames from pg_proc where oid = c_slug::regprocedure),
                (select proargmodes::text[] from pg_proc where oid = c_slug::regprocedure))
         with ordinality as a(n, m, o)
   where a.m = 't';
  if v_cols is distinct from
     'id,name,slug,description,tagline,address,phone,hours,logo_url,cover_url,primary_color,is_active,qr_token,currency,tax_included,language,socials,amenities,hours_structured,wifi_password,timezone,theme_settings,pickup_settings,google_review_url,menu_languages,country' then
    raise exception 'mig 334: forma lui get_restaurant_by_slug s-a schimbat: %', v_cols;
  end if;
  if position('r.wifi_password' in v_src) > 0 or position('r.qr_token' in v_src) > 0 then
    raise exception 'mig 334: get_restaurant_by_slug scurge wifi_password/qr_token (217)'; end if;
  if position('r.menu_languages' in v_src) = 0
     or position('public.public_theme_settings(r.id, r.theme_settings)' in v_src) = 0
     or position('public.public_pickup_settings(r.id, r.pickup_settings)' in v_src) = 0
     or position('lower(r.slug) = lower(p_slug)' in v_src) = 0
     or position('r.is_active = true' in v_src) = 0
     or position('r.country' in v_src) = 0 then
    raise exception 'mig 334: get_restaurant_by_slug a pierdut un invariant (219/281/309/148/298)'; end if;
  if not exists (select 1 from pg_proc
                  where oid = c_slug::regprocedure and prosecdef
                    and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
    raise exception 'mig 334: get_restaurant_by_slug și-a pierdut DEFINER/search_path'; end if;

  -- (f) resolve_qr_token: helperul folosit, invarianții din 326, fără feature
  --     românesc între ghilimele în corp (CC6 citește prosrc CU comentarii).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_qr_token';
  if v_n <> 1 then
    raise exception 'mig 334: resolve_qr_token are % semnături (așteptat 1)', v_n; end if;
  if not exists (select 1 from pg_proc
                  where oid = c_qr::regprocedure and prosecdef and provolatile = 'v'
                    and 'search_path=public, pg_temp' = any (proconfig)) then
    raise exception 'mig 334: resolve_qr_token și-a pierdut DEFINER/VOLATILE/pg_temp'; end if;
  select prosrc into v_src from pg_proc where oid = c_qr::regprocedure;
  if v_src ~ '''(fiscal_receipt|online_payments|split_bill|shifts|reports_vat)''' then
    raise exception 'mig 334: resolve_qr_token numește un feature românesc între ghilimele (CC6)'; end if;
  v_src := regexp_replace(regexp_replace(v_src, c_block, '', 'g'), c_line, '', 'g');
  if position('public.public_menu_currency(r.id, r.currency)' in v_src) = 0
     or (length(v_src) - length(replace(v_src, 'r.currency', ''))) / length('r.currency') <> 1 then
    raise exception 'mig 334: resolve_qr_token nu trece moneda (doar) prin gate-ul de citire'; end if;
  foreach v_fn in array array[
    '''timezone''', 'r.timezone', 'public.public_theme_settings(r.id, r.theme_settings)',
    '''order_qr''', 'r.menu_languages', 'r.language', 'r.is_active = true', 'expires_at'
  ] loop
    if position(v_fn in v_src) = 0 then
      raise exception 'mig 334: resolve_qr_token a pierdut „%"', v_fn;
    end if;
  end loop;
  foreach v_fn in array array[
    'r.wifi_password', 'r.qr_token', 'pickup_settings', 'to_jsonb(r)', 'r.*', 'safe_time_zone('
  ] loop
    if position(v_fn in v_src) > 0 then
      raise exception 'mig 334: resolve_qr_token conține „%" (proiecție anon interzisă)', v_fn;
    end if;
  end loop;

  -- (g) ACL-ul viu al proiecțiilor și al compunerilor (245) — anon + authenticated.
  foreach v_fn in array array[c_slug, c_qr, 'public.get_menu_by_slug(text)', 'public.resolve_qr_menu(text)'] loop
    if not has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'mig 334: % nu mai e apelabilă de anon/authenticated', v_fn;
    end if;
  end loop;

  raise notice 'mig 334: moneda meniului pe bon fiscal = RON (citire + scriere) OK';
end $$;

commit;
