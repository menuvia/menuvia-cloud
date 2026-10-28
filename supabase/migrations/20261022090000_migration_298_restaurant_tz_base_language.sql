-- migration_298_restaurant_tz_base_language.sql
-- =============================================================================
-- G0 (defecte care strică deja restaurantele de pe menuvia.com): rezervarea
-- publică se validează în fusul RESTAURANTULUI, iar limba de bază a meniului
-- devine editabilă și vizibilă oaspetelui.
--
-- ── §1. Rezervarea publică judeca ora în fusul BUCUREȘTIULUI ────────────────
-- Formularul (`ReservationSheet`) construiește sloturile ca ore de PERETE ale
-- localului și le convertește în instant în `restaurants.timezone` (mig 049).
-- Serverul (`create_reservation_public`, ultima definiție vie = 273 + rescrierea
-- MECANICĂ din 289 care a adăugat `'expired'`) scotea însă ora de perete și ziua
-- săptămânii cu `at time zone 'Europe/Bucharest'` HARDCODAT. Pentru un local din
-- New York deschis 18:00–23:00:
--   * 19:00 la New York = 02:00 la București → RESPINSĂ („în afara programului");
--   * 12:00 la New York = 19:00 la București → ACCEPTATĂ, deși localul e închis;
--   * ziua săptămânii se decidea tot pe București (sâmbătă 19:00 NY = duminică).
-- Pentru localurile din România (toate de azi) cele două fusuri coincid, deci
-- comportamentul românesc e IDENTIC — RS1–RS3 și RZ4 o țin.
--
-- Remediu: fusul vine din rând, VALIDAT o singură dată per apel prin helperul
-- nou `safe_time_zone(text)` — oglinda lui `safeTimeZone` din src/lib/dates.ts:
--   * NULL / necunoscut în `pg_timezone_names` → 'Europe/Bucharest';
--   * potrivire CASE-INSENSITIVE și numele CANONIC întors (Intl acceptă
--     „america/new_york", deci clientul ar fi folosit New York; serverul trebuie
--     să judece la fel, altfel formularul și serverul diverg exact pe rândul
--     ăsta);
--   * FĂRĂ trim (Intl ARUNCĂ pe un nume cu spații → clientul cade pe București;
--     dacă serverul ar face trim, ar judeca în alt fus decât formularul);
--   * excluse `localtime` / `posixrules` / `Factory` (intrări ale bazei de
--     fusuri pe care Intl nu le cunoaște) și, implicit, orice șir POSIX de
--     forma 'UTC+3' — pe care `at time zone` l-ar ACCEPTA (cu semnul inversat!),
--     dar care nu e în `pg_timezone_names`. De aceea validarea e pe catalog, nu
--     un try/catch în jurul lui `at time zone`.
--
-- Lanț `create_reservation_public` 151→199→201→241→273→(289, mecanic)→**298**.
-- Corpul = textul din 273 + înlocuirea din 289 (`'expired'` în ambele predicate
-- de disponibilitate) + fusul restaurantului; verificat prin diff pe
-- `pg_get_functiondef` față de definiția vie de după 297: singurele diferențe
-- sunt citirea lui `timezone`, apelul `safe_time_zone` și cele trei
-- `at time zone v_tz`. Aceeași semnătură (11 argumente) → `create or replace`
-- (păstrează ACL-ul: anon + authenticated), `search_path` scris EXPLICIT.
-- Invarianții păstrați (CLAUDE.md): p_table_id + `table_unavailable` (199),
-- plafonul de durată `least(...)` (151), gate-ul `is_module_enabled` (200),
-- wrap-around (201), ziua de SERVICIU (241), idempotența cu DOUĂ lookup-uri +
-- backstop care RE-ARUNCĂ (273), lacătul advisory (199), `expired` (289).
--
-- Alte obiecte VII cu ore/zile de rezervare, verificate prin descoperire pe
-- replay (`pg_get_functiondef` ~ open_time|isodow|at time zone): DOAR
-- `create_reservation_public` interpretează ora de PERETE a oaspetelui.
-- `get_tables_availability`, `check_availability`, `auto_mark_reservation_no_show`,
-- `expire_stale_pending_reservations`, `claim_reservation_reminders`,
-- `cancel_reservation_by_code` lucrează pe INSTANTE (starts_at/ends_at, now()),
-- deci sunt independente de fus. Obiectele de raport/fiscale/plafon SMS/Happy
-- Hour (București) rămân pentru G1.3, deliberat.
--
-- ── §2. Limba de bază a meniului era fixată pe română ───────────────────────
-- `restaurants.language` (mig 038, default 'ro') nu era editabilă (fără grant de
-- UPDATE — `restaurants` e column-gated din 096B), iar clientul trata literal
-- 'ro' drept limba originalului din `name`/`description`. Un local de pe .com
-- cu meniul scris în engleză apărea oaspeților ca „Română" în switcher.
--   a. CHECK pe cele 7 limbi ale meniului (ro/en/de/fr/it/hu/es — MENU_LANGS).
--      Pre-verificare fail-closed: dacă vreun rând are altă valoare, migrația
--      PICĂ cu lista valorilor (decizie de fondator, nu normalizare tăcută).
--      Coloana n-a avut niciodată scriitor client (doar default-ul și seed-ul
--      demo, care scrie 'ro'), deci pe prod e de așteptat zero rânduri.
--   b. `grant update (language) to authenticated` — sincronizat în cele 4
--      locuri (aici, RW1, `RESTAURANT_UPDATE_FIELDS`, testul JS).
--   c. `resolve_qr_token` (lanț 022→…→206→281→**298**) proiectează și
--      `language` — QR-ul pornea pe 'ro' fiindcă nu primea limba deloc.
--      Copie VERBATIM a lui 281 + o cheie; întoarce jsonb, deci `create or
--      replace` (semnătură și ACL neschimbate).
--
-- ── §3. Prefixul telefonic al oaspetelui din țara restaurantului ────────────
-- `get_restaurant_by_slug` (lanț 148→217→219→281→**298**) proiectează și
-- `country` (mig 296), la FINAL. `returns table` schimbat → DROP + CREATE
-- (un `create or replace` nu poate schimba tipul de retur, ca 219). Corp
-- VERBATIM 281: `wifi_password`/`qr_token` rămân `null::text` (217),
-- `menu_languages` rămâne (219), tema trece prin `public_theme_settings` (281),
-- slug case-insensitive (148). `get_menu_by_slug` (245) face `select *` +
-- `to_jsonb(v_row)` → moștenește coloana fără recreare. ACL-ul de dinainte
-- (anon + authenticated) e re-acordat explicit.
--
-- Teste permanente RZ1–RZ6: tests/sql/reservation_timezone_assertions.sql
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── §1a. Helperul de fus (oglinda safeTimeZone din src/lib/dates.ts) ─────────
create or replace function public.safe_time_zone(p_tz text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  -- Numele CANONIC din catalog pentru o potrivire case-insensitive (fără trim,
  -- paritate cu Intl), altfel fusul implicit al platformei.
  select coalesce(
    (select n.name
       from pg_catalog.pg_timezone_names n
      where lower(n.name) = lower(p_tz)
        and n.name not in ('localtime', 'posixrules', 'Factory')
      order by n.name collate "C"
      limit 1),
    'Europe/Bucharest');
$$;

comment on function public.safe_time_zone(text) is
  'mig 298: fusul IANA validat pe pg_timezone_names (case-insensitive, nume canonic); NULL/necunoscut → Europe/Bucharest. Oglinda safeTimeZone din src/lib/dates.ts.';

-- Helper intern: îl cheamă doar funcțiile DEFINER (rulează ca proprietarul).
revoke all on function public.safe_time_zone(text)
  from public, anon, authenticated, service_role;

-- ── §1b. create_reservation_public, lanț …→273→(289)→298 ────────────────────
create or replace function public.create_reservation_public(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_party_size smallint,
  p_starts_at timestamp with time zone,
  p_customer_email text default null::text,
  p_special_requests text default null::text,
  p_duration_minutes smallint default null::smallint,
  p_zone text default null::text,
  p_table_id uuid default null::uuid,
  p_idempotency_key uuid default null::uuid
)
returns table(
  reservation_id uuid,
  confirmation_code text,
  status text,
  table_name text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  requested_zone text,
  party_size smallint
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_restaurant_id   uuid;
  v_settings        public.reservation_settings%rowtype;
  v_duration        smallint;
  v_ends_at         timestamptz;
  v_table_id        uuid;
  v_table_name      text;
  v_status          text;
  v_new_id          uuid;
  v_new_code        text;
  v_dow             smallint;
  v_local_time      time;
  v_zone            text;
  v_ex              record;
  v_tz              text;
begin
  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Numele este obligatoriu';
  end if;
  if length(trim(coalesce(p_customer_phone, ''))) = 0 then
    raise exception 'Telefonul este obligatoriu';
  end if;
  if p_party_size is null or p_party_size <= 0 then
    raise exception 'Numărul de persoane trebuie să fie mai mare ca 0';
  end if;
  if p_starts_at is null then
    raise exception 'Data și ora sunt obligatorii';
  end if;

  v_zone := nullif(trim(coalesce(p_zone, '')), '');

  -- mig 298: și fusul restaurantului (validat mai jos, o singură dată).
  select id, timezone into v_restaurant_id, v_tz
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    raise exception 'Restaurantul nu a fost găsit';
  end if;

  -- mig 273: LOOKUP de idempotență, ÎNAINTEA oricărei validări de setări.
  -- O retrimitere trebuie să întoarcă rezervarea deja creată, nu să pice pe o
  -- regulă de program care între timp a devenit adevărată (tipic:
  -- `min_advance_hours`, care se apropie cu fiecare secundă).
  if p_idempotency_key is not null then
    select r.id, r.confirmation_code, r.status, t.name as table_name,
           r.starts_at, r.ends_at, r.requested_zone, r.party_size
      into v_ex
      from public.reservations r
      left join public.tables t on t.id = r.table_id
     where r.restaurant_id  = v_restaurant_id
       and r.idempotency_key = p_idempotency_key;
    if found then
      return query select v_ex.id, v_ex.confirmation_code, v_ex.status,
                          v_ex.table_name, v_ex.starts_at, v_ex.ends_at,
                          v_ex.requested_zone, v_ex.party_size;
      return;
    end if;
  end if;

  if not public.is_module_enabled(v_restaurant_id, 'reservations') then
    raise exception 'Rezervările nu sunt activate pentru acest restaurant'
      using errcode = 'check_violation', hint = 'module_disabled';
  end if;

  select * into v_settings
  from public.reservation_settings
  where restaurant_id = v_restaurant_id;
  if not found then
    insert into public.reservation_settings (restaurant_id)
    values (v_restaurant_id)
    returning * into v_settings;
  end if;

  if p_party_size > v_settings.max_party_size then
    raise exception 'Numărul maxim de persoane permis este %', v_settings.max_party_size;
  end if;
  if p_starts_at < now() + (v_settings.min_advance_hours || ' hours')::interval then
    raise exception 'Rezervările se fac cu minim % ore înainte', v_settings.min_advance_hours;
  end if;
  if p_starts_at > now() + (v_settings.max_advance_days || ' days')::interval then
    raise exception 'Rezervările se fac cu maxim % zile înainte', v_settings.max_advance_days;
  end if;

  -- mig 298: ora de PERETE și ziua se judecă în fusul RESTAURANTULUI (aceleași
  -- ore de perete din care formularul a construit sloturile), nu în București.
  -- Fus NULL/invalid → București (paritate cu safeTimeZone din client).
  v_tz := public.safe_time_zone(v_tz);
  v_local_time := (p_starts_at at time zone v_tz)::time;
  -- Ziua de SERVICIU (mig 241): pe program peste miezul nopții (close <= open),
  -- un slot din fereastra [00:00, close) aparține serviciului zilei PRECEDENTE
  -- (ex. 01:00 dintr-un 18:00–02:00 = serviciul de sâmbătă, nu duminică).
  if v_settings.close_time <= v_settings.open_time and v_local_time < v_settings.close_time then
    v_dow := extract(isodow from (p_starts_at at time zone v_tz) - interval '1 day')::smallint;
  else
    v_dow := extract(isodow from p_starts_at at time zone v_tz)::smallint;
  end if;
  if not (v_dow = any (v_settings.open_days)) then
    raise exception 'Restaurantul nu acceptă rezervări în această zi';
  end if;
  -- Fereastra normală [open, close). Dacă close <= open, programul trece peste
  -- miezul nopții → fereastra validă e [open, 24:00) ∪ [00:00, close); respingem
  -- DOAR când ora e sub open ȘI peste/egal close.
  if (v_settings.close_time > v_settings.open_time
        and (v_local_time < v_settings.open_time or v_local_time >= v_settings.close_time))
     or (v_settings.close_time <= v_settings.open_time
        and (v_local_time < v_settings.open_time and v_local_time >= v_settings.close_time))
  then
    raise exception 'Ora aleasă este în afara programului (% - %)',
      to_char(v_settings.open_time, 'HH24:MI'),
      to_char(v_settings.close_time, 'HH24:MI');
  end if;

  v_duration := least(
                  greatest(coalesce(p_duration_minutes, v_settings.reservation_duration), 1),
                  v_settings.reservation_duration
                );
  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  perform pg_advisory_xact_lock(hashtext('reservation:' || v_restaurant_id::text));

  -- mig 273: AL DOILEA lookup, sub lacăt. Primul (de sus) rezolvă retrimiterea
  -- SECVENȚIALĂ. Pe cea CONCURENTĂ nu e de ajuns: două cereri identice trec
  -- amândouă de el (niciuna nu vede încă rândul celeilalte), iar pe ramura cu
  -- masă ALEASĂ (`p_table_id`) garda de disponibilitate de mai jos rulează
  -- ÎNAINTEA insert-ului și ar respinge-o pe a doua cu `table_unavailable`,
  -- văzând rezervarea tocmai comisă de prima — deci backstop-ul de pe insert
  -- nu s-ar atinge niciodată și clientul ar primi o eroare în loc de rezervarea
  -- lui. `pg_advisory_xact_lock` se ține până la COMMIT, deci cine intră al
  -- doilea intră abia după ce primul a comis și, sub READ COMMITTED, îi VEDE
  -- rândul. Verificat cu două sesiuni concurente reale (RI9).
  if p_idempotency_key is not null then
    select r.id, r.confirmation_code, r.status, t.name as table_name,
           r.starts_at, r.ends_at, r.requested_zone, r.party_size
      into v_ex
      from public.reservations r
      left join public.tables t on t.id = r.table_id
     where r.restaurant_id  = v_restaurant_id
       and r.idempotency_key = p_idempotency_key;
    if found then
      return query select v_ex.id, v_ex.confirmation_code, v_ex.status,
                          v_ex.table_name, v_ex.starts_at, v_ex.ends_at,
                          v_ex.requested_zone, v_ex.party_size;
      return;
    end if;
  end if;

  if p_table_id is not null then
    select t.id, t.name into v_table_id, v_table_name
    from public.tables t
    where t.id = p_table_id
      and t.restaurant_id = v_restaurant_id
      and t.is_active = true
      and t.seats is not null
      and t.seats >= p_party_size
      and not exists (
        select 1 from public.reservations r
        where r.restaurant_id = v_restaurant_id
          and r.table_id = t.id
          and r.status not in ('cancelled','no_show','expired')
          and (r.starts_at, r.ends_at) overlaps (p_starts_at, v_ends_at)
      );
    if v_table_id is null then
      raise exception 'Masa aleasă nu mai este disponibilă pentru acest interval'
        using errcode = 'check_violation', hint = 'table_unavailable';
    end if;
  else
    select t.id, t.name into v_table_id, v_table_name
    from public.tables t
    where t.restaurant_id = v_restaurant_id
      and t.is_active = true
      and t.seats is not null
      and t.seats >= p_party_size
      and (v_zone is null or t.zone = v_zone)
      and not exists (
        select 1 from public.reservations r
        where r.restaurant_id = v_restaurant_id
          and r.table_id = t.id
          and r.status not in ('cancelled','no_show','expired')
          and (r.starts_at, r.ends_at) overlaps (p_starts_at, v_ends_at)
      )
    order by t.seats asc, t.name asc
    limit 1;
  end if;

  if v_table_id is null then
    v_status := 'pending';
    v_table_name := null;
  else
    v_status := case when v_settings.auto_confirm then 'confirmed' else 'pending' end;
  end if;

  -- mig 273: BACKSTOP. Două cereri identice simultane trec amândouă de lookup
  -- (niciuna nu vede încă rândul celeilalte); indexul unic lasă doar una să
  -- insereze, iar cealaltă re-citește rândul câștigător și îl întoarce.
  begin
    insert into public.reservations as r (
      restaurant_id, table_id,
      customer_name, customer_phone, customer_email,
      party_size, special_requests,
      starts_at, ends_at,
      status, source,
      requested_zone, idempotency_key
    )
    values (
      v_restaurant_id, v_table_id,
      trim(coalesce(p_customer_name, '')), trim(coalesce(p_customer_phone, '')),
      nullif(trim(coalesce(p_customer_email, '')), ''),
      p_party_size,
      nullif(trim(coalesce(p_special_requests, '')), ''),
      p_starts_at, v_ends_at,
      v_status, 'public',
      v_zone, p_idempotency_key
    )
    returning r.id, r.confirmation_code into v_new_id, v_new_code;
  exception when unique_violation then
    -- DOAR violarea cheii NOASTRE se traduce în „rezervarea există deja". O
    -- coliziune pe `confirmation_code` (sau orice alt index unic) trebuie să
    -- iasă ca eroare: un handler care înghite orice unique_violation ar
    -- răspunde fals „a mers" pe o rezervare care NU s-a scris.
    select r.id, r.confirmation_code, r.status, t.name as table_name,
           r.starts_at, r.ends_at, r.requested_zone, r.party_size
      into v_ex
      from public.reservations r
      left join public.tables t on t.id = r.table_id
     where r.restaurant_id  = v_restaurant_id
       and r.idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    return query select v_ex.id, v_ex.confirmation_code, v_ex.status,
                        v_ex.table_name, v_ex.starts_at, v_ex.ends_at,
                        v_ex.requested_zone, v_ex.party_size;
    return;
  end;

  return query select
    v_new_id, v_new_code, v_status,
    v_table_name, p_starts_at, v_ends_at,
    v_zone, p_party_size;
end;
$function$;

-- `create or replace` păstrează ACL-ul; re-afirmat explicit (suprafață publică).
revoke all on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid
) from public;
grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid
) to anon, authenticated;

-- ── §2a. CHECK pe limba de bază (pre-verificare fail-closed) ────────────────
do $$
declare v_bad text;
begin
  select string_agg(distinct coalesce(language, '<NULL>'), ', ')
    into v_bad
    from public.restaurants
   where language is null
      or language not in ('ro', 'en', 'de', 'fr', 'it', 'hu', 'es');
  if v_bad is not null then
    raise exception 'mig 298: restaurants.language are valori în afara celor 7 limbi ale meniului: % — decide valoarea corectă (fondator) înainte de migrație', v_bad;
  end if;
end $$;

alter table public.restaurants
  drop constraint if exists restaurants_language_check;
alter table public.restaurants
  add constraint restaurants_language_check
  check (language in ('ro', 'en', 'de', 'fr', 'it', 'hu', 'es'));

comment on column public.restaurants.language is
  $$Limba de BAZĂ a meniului (mig 038; editabilă din mig 298): limba în care sunt scrise name/description ale produselor și categoriilor. Traducerile stau în `translations` pe celelalte limbi. Una din ro/en/de/fr/it/hu/es (MENU_LANGS).$$;

-- ── §2b. Grant de scriere (restaurants e column-gated din 096B) ──────────────
grant update (language) on table public.restaurants to authenticated;

-- ── §2c. resolve_qr_token, lanț …→281→298: + language ───────────────────────
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
    'language',                      r.language
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

-- ── §3. get_restaurant_by_slug, lanț …→281→298: + country (la final) ────────
drop function if exists public.get_restaurant_by_slug(text);

create function public.get_restaurant_by_slug(p_slug text)
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
    r.pickup_settings, r.google_review_url,
    -- mig 219: limbile meniului — publice prin definiție (whitelist pe /m/:slug).
    r.menu_languages,
    -- mig 298: țara (prefixul telefonic implicit al oaspetelui).
    r.country
  from public.restaurants r
  where lower(r.slug) = lower(p_slug)
    and r.is_active = true
  limit 1;
$function$;

revoke all on function public.get_restaurant_by_slug(text) from public, anon, authenticated, service_role;
grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_src  text;
  v_sig  text;
  v_n    int;
  v_cols text;
  c_crp  constant text := 'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)';
begin
  -- (a) helperul: comportament + suprafață
  if public.safe_time_zone(null) is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('Mars/Olympus') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('UTC+3') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone(' America/New_York') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('localtime') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('America/New_York') is distinct from 'America/New_York'
     or public.safe_time_zone('america/new_york') is distinct from 'America/New_York'
     or public.safe_time_zone('Europe/Bucharest') is distinct from 'Europe/Bucharest' then
    raise exception 'mig 298: safe_time_zone nu respectă contractul (NULL/invalid/POSIX → București; case-insensitive → canonic)';
  end if;
  select string_agg(r.rol, ', ') into v_sig
    from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
   where has_function_privilege(r.rol, 'public.safe_time_zone(text)', 'execute');
  if v_sig is not null then
    raise exception 'mig 298: safe_time_zone e apelabil de roluri client: %', v_sig;
  end if;

  -- (b) create_reservation_public: o singură semnătură + fusul restaurantului
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n <> 1 then
    raise exception 'mig 298: create_reservation_public are % semnături (așteptat 1)', v_n;
  end if;
  v_src := pg_get_functiondef(c_crp::regprocedure);
  if position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'mig 298: create_reservation_public încă judecă ora în fusul București hardcodat';
  end if;
  if position('public.safe_time_zone(v_tz)' in v_src) = 0
     or (length(v_src) - length(replace(v_src, 'at time zone v_tz', ''))) / length('at time zone v_tz') <> 3 then
    raise exception 'mig 298: create_reservation_public nu folosește fusul validat al restaurantului în toate cele 3 locuri';
  end if;
  -- invarianții lanțului (273 + 289)
  foreach v_sig in array array[
    'p_idempotency_key', 'unique_violation', 'raise;',
    '- interval ''1 day''', 'close_time <= v_settings.open_time',
    'p_table_id', 'table_unavailable', 'is_module_enabled', 'least(',
    'v_settings.reservation_duration', 'pg_advisory_xact_lock'
  ] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 298: create_reservation_public a pierdut „%"', v_sig;
    end if;
  end loop;
  if (length(v_src) - length(replace(v_src, $q$not in ('cancelled','no_show','expired')$q$, '')))
     / length($q$not in ('cancelled','no_show','expired')$q$) <> 2 then
    raise exception 'mig 298: create_reservation_public a pierdut excluderea lui expired (289) din predicatele de disponibilitate';
  end if;
  if (length(v_src) - length(replace(v_src, 'r.idempotency_key = p_idempotency_key', '')))
     / length('r.idempotency_key = p_idempotency_key') < 3 then
    raise exception 'mig 298: lipsește un lookup de idempotență (273: pre-validări, sub lacăt, backstop)';
  end if;
  if position('r.idempotency_key = p_idempotency_key' in v_src)
     > position('(v_settings.min_advance_hours ||' in v_src)
     or position('(v_settings.min_advance_hours ||' in v_src) = 0 then
    raise exception 'mig 298: lookup-ul de idempotență nu mai e ÎNAINTEA validărilor de setări (273)';
  end if;
  if position('r.idempotency_key = p_idempotency_key'
              in substring(v_src from position('pg_advisory_xact_lock' in v_src))) = 0 then
    raise exception 'mig 298: lipsește lookup-ul de idempotență de SUB lacăt (273)';
  end if;
  if v_src not like '%search_path%pg_temp%' or v_src not like '%SECURITY DEFINER%' then
    raise exception 'mig 298: create_reservation_public și-a pierdut DEFINER/search_path';
  end if;
  if not has_function_privilege('anon', c_crp, 'execute')
     or not has_function_privilege('authenticated', c_crp, 'execute') then
    raise exception 'mig 298: create_reservation_public și-a pierdut grant-ul anon/authenticated';
  end if;

  -- (c) limba: CHECK + grant
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.restaurants'::regclass
                    and conname = 'restaurants_language_check' and convalidated) then
    raise exception 'mig 298: CHECK-ul pe restaurants.language lipsește sau nu e validat';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'language', 'UPDATE') then
    raise exception 'mig 298: authenticated nu poate scrie restaurants.language';
  end if;
  if has_column_privilege('anon', 'public.restaurants', 'language', 'UPDATE') then
    raise exception 'mig 298: anon poate scrie restaurants.language';
  end if;

  -- (d) resolve_qr_token: + language, invarianții 127/217/281
  v_src := pg_get_functiondef('public.resolve_qr_token(text)'::regprocedure);
  if position('''language'',' in v_src) = 0 then
    raise exception 'mig 298: resolve_qr_token nu proiectează language'; end if;
  if position('r.wifi_password' in v_src) > 0 or position('r.qr_token' in v_src) > 0 then
    raise exception 'mig 298: resolve_qr_token scurge wifi_password/qr_token (217)'; end if;
  if position('public_theme_settings' in v_src) = 0 or position('order_qr' in v_src) = 0 then
    raise exception 'mig 298: resolve_qr_token a pierdut gate-ul de branding (281) sau de plan (127)'; end if;
  if v_src not like '%search_path%pg_temp%' then
    raise exception 'mig 298: resolve_qr_token și-a pierdut search_path'; end if;
  if not has_function_privilege('anon', 'public.resolve_qr_token(text)', 'execute') then
    raise exception 'mig 298: resolve_qr_token nu mai e apelabil de anon'; end if;

  -- (e) get_restaurant_by_slug: + country la FINAL, invarianții 148/217/219/281
  v_src := pg_get_functiondef('public.get_restaurant_by_slug(text)'::regprocedure);
  select string_agg(a.n, ',' order by a.o) into v_cols
    from unnest((select proargnames from pg_proc where oid = 'public.get_restaurant_by_slug(text)'::regprocedure),
                (select proargmodes::text[] from pg_proc where oid = 'public.get_restaurant_by_slug(text)'::regprocedure))
         with ordinality as a(n, m, o)
   where a.m = 't';
  if v_cols is distinct from
     'id,name,slug,description,tagline,address,phone,hours,logo_url,cover_url,primary_color,is_active,qr_token,currency,tax_included,language,socials,amenities,hours_structured,wifi_password,timezone,theme_settings,pickup_settings,google_review_url,menu_languages,country' then
    raise exception 'mig 298: forma lui get_restaurant_by_slug nu e cea așteptată (country la final): %', v_cols;
  end if;
  if position('r.wifi_password' in v_src) > 0 or position('r.qr_token' in v_src) > 0 then
    raise exception 'mig 298: get_restaurant_by_slug scurge wifi_password/qr_token (217)'; end if;
  if position('r.menu_languages' in v_src) = 0 or position('public_theme_settings' in v_src) = 0
     or position('lower(r.slug) = lower(p_slug)' in v_src) = 0 then
    raise exception 'mig 298: get_restaurant_by_slug a pierdut un invariant (219 menu_languages / 281 branding / 148 slug)'; end if;
  if v_src not like '%search_path%pg_temp%' or v_src not like '%SECURITY DEFINER%' then
    raise exception 'mig 298: get_restaurant_by_slug și-a pierdut DEFINER/search_path'; end if;
  if not has_function_privilege('anon', 'public.get_restaurant_by_slug(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_restaurant_by_slug(text)', 'execute') then
    raise exception 'mig 298: get_restaurant_by_slug nu mai e apelabil de anon/authenticated'; end if;

  raise notice 'mig 298: rezervarea în fusul restaurantului + limba de bază editabilă + country pe /m/:slug OK';
end $$;

commit;
