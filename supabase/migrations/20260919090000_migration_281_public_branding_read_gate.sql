-- migration_281_public_branding_read_gate.sql
-- =============================================================================
-- `hide_branding` se gate-uiește și la CITIRE, nu doar la scriere (RESID-28).
--
-- ── Ce era ───────────────────────────────────────────────────────────────────
-- Mig 225 a pus un gate de SCRIERE (`trg_normalize_hide_branding`, BEFORE
-- INSERT/UPDATE OF theme_settings pe `restaurants`): pe un plan fără feature-ul
-- `remove_branding` flag-ul se normalizează tăcut la false. Antetul ei
-- consemnează reziduul „la DOWNGRADE flag-ul rămâne până la următoarea scriere"
-- ca fiind ne-critic, cu motivul: „beneficiul dispare oricum din UI".
--
-- ── De ce motivul acela e GREȘIT ─────────────────────────────────────────────
-- Beneficiul plătit NU e comutatorul din SettingsTab — e badge-ul ASCUNS pe
-- meniul public. Iar citirea publică nu re-verifică planul nicăieri:
--   • `get_restaurant_by_slug` (148→217→219) și `resolve_qr_token` (022→…→206)
--     proiectează `theme_settings` BRUT către anon;
--   • `PublicMenuPage`/`QrMenuPage` randează pe `!resolveHideBranding(...)`
--     (`lib/themes.ts`), care citește doar boolean-ul stocat.
-- Deci: local pe growth stinge badge-ul → coboară pe free → păstrează beneficiul
-- PE TERMEN NELIMITAT, până când cineva salvează din întâmplare o temă. Mic ca
-- bani, dar e exact clasa „gate doar în UI / doar la scriere" pe care repo-ul a
-- reparat-o deja la `order_qr` (127) și `accent_override`.
-- (Mig 225 nu se editează — migrațiile aplicate nu se ating. Corectura stă aici
-- și în bullet-ul din CLAUDE.md.)
--
-- ── Fix: normalizare la CITIRE, în proiecțiile anon ──────────────────────────
-- Un singur helper, folosit de ambele proiecții, ca regula să aibă o singură
-- definiție. Gate-ul de SCRIERE din 225 RĂMÂNE (defense-in-depth: ce nu se
-- scrie nu trebuie nici curățat), dar autoritatea pentru ce VEDE oaspetele e
-- acum la citire — singurul loc care închide clasa indiferent ce e stocat.
-- `get_menu_by_slug`/`resolve_qr_menu` (245) sunt compuneri PURE → moștenesc.
--
-- ── Paritate exactă cu clientul ──────────────────────────────────────────────
-- `resolveHideBranding` (themes.ts) ascunde badge-ul DOAR pe `true` explicit.
-- Helperul compară `p_theme->'hide_branding' = 'true'::jsonb` — fără cast, deci
-- (a) aceeași semantică, (b) imun la jsonb malformat: un `"da"` sau un număr nu
-- aruncă (un `::boolean` ar fi aruncat și ar fi rupt TOATĂ proiecția publică,
-- adică meniul, pentru o valoare de temă stricată).
--
-- ── Capcană la recreare ──────────────────────────────────────────────────────
-- Mig 262 a adăugat `pg_temp` la TOATE funcțiile DEFINER prin ALTER FUNCTION.
-- Un `create or replace` REscrie `proconfig` cu ce e în textul nou, deci
-- `set search_path = public, pg_temp` se scrie EXPLICIT mai jos — altfel
-- pg_temp s-ar pierde tăcut (clichetul RP5 l-ar prinde, dar prea târziu).
--
-- Teste permanente: tests/sql/public_branding_gate_assertions.sql (PB1–PB8).
-- =============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Helperul — sursa UNICĂ a regulii de citire.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.public_theme_settings(
  p_restaurant_id uuid,
  p_theme         jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case
    when p_theme is null then null
    -- NU e nevoie de o gardă explicită pe ne-obiect: `->` cu o cheie TEXT
    -- întoarce NULL pentru orice scalar sau array, deci condiția de mai jos e
    -- deja falsă și ramura cu `jsonb_set` (singura care ar arunca) e
    -- INACCESIBILĂ. Avusesem aici un `when jsonb_typeof(...) <> 'object'` — l-am
    -- scos fiindcă mutația care îl ștergea NU pica niciun test: era cod mort pe
    -- care PB5 doar PĂREA să-l acopere, exact tiparul de gate mort vânat în 274
    -- și 272. PB5 rămâne, dar aserteză comportamentul REAL al ramurii `else`.
    when p_theme -> 'hide_branding' = 'true'::jsonb
         and not public.restaurant_has_feature(p_restaurant_id, 'remove_branding')
      then jsonb_set(p_theme, '{hide_branding}', 'false'::jsonb)
    else p_theme
  end;
$fn$;

comment on function public.public_theme_settings(uuid, jsonb) is
  'mig 281 (RESID-28): normalizeaza theme_settings pentru proiectiile PUBLICE — hide_branding devine false cand restaurantul nu are feature-ul remove_branding. Gate la CITIRE: mig 225 gate-uieste doar scrierea, deci un DOWNGRADE lasa badge-ul ascuns pe veci. Paritate exacta cu resolveHideBranding din themes.ts (doar `true` explicit ascunde).';

-- Helper intern: niciun apelant client. Revoke EXPLICIT per rol — pe stack-ul
-- Supabase default privileges acorda EXECUTE oricarei functii NOI direct lui
-- service_role (si anon/authenticated pe CLI-ul nou), iar `revoke ... from
-- public` nu atinge un grant direct (clasa CJ9, mig 274). Apelantii sunt cele
-- doua proiectii, ambele DEFINER, deci ruleaza ca proprietar.
revoke all on function public.public_theme_settings(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. `get_restaurant_by_slug` — copie VERBATIM a lui 219 + helperul.
--    Lanț 148→217→219→281. Orice recreare viitoare pornește de AICI și
--    păstrează TOT: slug case-insensitive (148), `null::text` pe qr_token și
--    wifi_password (217), `menu_languages` (219), helperul de branding (281).
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
  menu_languages    jsonb
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
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
    r.menu_languages
  from public.restaurants r
  where lower(r.slug) = lower(p_slug)
    and r.is_active = true
  limit 1;
$$;

grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. `resolve_qr_token` — copie VERBATIM a lui 206 + helperul.
--    Lanț 022→023→024→127→206→281. Orice recreare păstrează TOT: gate-ul de
--    plan `order_qr` INLINE (127 — inline deliberat ca să meargă pe anon),
--    `menu_languages` + `currency` (206), expirarea token-ului, masa.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.resolve_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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
    'currency',                      r.currency
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
$fn$;

grant execute on function public.resolve_qr_token(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Asserțiuni la aplicare (centură; acoperirea permanentă e suita PB1–PB8).
--    Se RE-afirmă și invariantele moștenite: o recreare care le pierde trebuie
--    să pice AICI, nu peste trei luni într-un audit.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_slug text; v_qr text;
begin
  v_slug := pg_get_functiondef('public.get_restaurant_by_slug(text)'::regprocedure);
  v_qr   := pg_get_functiondef('public.resolve_qr_token(text)'::regprocedure);

  -- mig 281: helperul e chiar folosit în AMBELE proiecții.
  if position('public_theme_settings' in v_slug) = 0 then
    raise exception 'mig 281: get_restaurant_by_slug nu trece theme_settings prin gate-ul de branding';
  end if;
  if position('public_theme_settings' in v_qr) = 0 then
    raise exception 'mig 281: resolve_qr_token nu trece theme_settings prin gate-ul de branding';
  end if;

  -- mig 217: secretele NU au reapărut.
  if position('r.wifi_password' in v_slug) > 0 or position('r.qr_token' in v_slug) > 0 then
    raise exception 'mig 281: get_restaurant_by_slug a reintrodus leak-ul wifi/qr_token (mig 217)';
  end if;
  -- mig 219 + 148.
  if position('r.menu_languages' in v_slug) = 0 then
    raise exception 'mig 281: get_restaurant_by_slug a pierdut menu_languages (mig 219)';
  end if;
  if position('lower(r.slug)' in v_slug) = 0 then
    raise exception 'mig 281: get_restaurant_by_slug a pierdut slug-ul case-insensitive (mig 148)';
  end if;
  -- mig 127: gate-ul de plan pe comanda QR.
  if position('order_qr' in v_qr) = 0 then
    raise exception 'mig 281: resolve_qr_token a pierdut gate-ul de plan order_qr (mig 127)';
  end if;

  -- pg_temp pe toate trei (mig 262 l-a adăugat prin ALTER; un create or replace
  -- fără el l-ar fi șters tăcut).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid in ('public.get_restaurant_by_slug(text)'::regprocedure,
                     'public.resolve_qr_token(text)'::regprocedure,
                     'public.public_theme_settings(uuid,jsonb)'::regprocedure)
       and coalesce(array_to_string(p.proconfig, ','), '') not like '%pg_temp%'
  ) then
    raise exception 'mig 281: o functie DEFINER a ramas fara pg_temp in search_path';
  end if;

  -- Suprafața: proiecțiile rămân anon, helperul NU.
  if not has_function_privilege('anon', 'public.get_restaurant_by_slug(text)', 'execute')
     or not has_function_privilege('anon', 'public.resolve_qr_token(text)', 'execute') then
    raise exception 'mig 281: proiectiile publice trebuie sa ramana apelabile de anon';
  end if;
  if has_function_privilege('anon', 'public.public_theme_settings(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.public_theme_settings(uuid,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.public_theme_settings(uuid,jsonb)', 'execute') then
    raise exception 'mig 281: helperul de branding e apelabil de un rol client';
  end if;
end$$;

-- E. Gate-ul de SCRIERE din 225 trebuie să fie încă acolo (defense-in-depth).
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'restaurants' and t.tgname = 'trg_normalize_hide_branding'
       and not t.tgisinternal
  ) then
    raise exception 'mig 281: trg_normalize_hide_branding (mig 225) a disparut — gate-ul de scriere ramane';
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. BONUS — gate-ul de SCRIERE din 225 nu funcționa deloc la INSERT.
--
-- Găsit de garda anti-vacuitate a suitei PB (fixtura a refuzat să pornească
-- fiindcă flag-ul nu se stocase). Cauza, reprodusă pe replay:
-- `fn_normalize_hide_branding` întreabă `restaurant_has_feature(NEW.id, …)`,
-- iar acela face `join restaurants r ... where r.id = p_restaurant_id`. La
-- BEFORE INSERT rândul NU e încă în tabelă, deci join-ul nu găsește nimic →
-- `false` → flag-ul se normalizează la false ORICARE ar fi planul.
--
-- Măsurat (owner pe `growth`, care ARE remove_branding):
--   INSERT cu {"hide_branding":true}  → stocat `false`   ← întotdeauna
--   UPDATE  cu {"hide_branding":true}  → stocat `true`    ← corect
--
-- Consecința reală e mică (azi `create_restaurant` nu scrie `theme_settings`,
-- deci flag-ul se pune oricum printr-un UPDATE din SettingsTab), dar un preset
-- de onboarding sau un import care ar crea restaurantul CU tema ar pierde tăcut
-- o setare plătită. Se repară aici fiindcă e ACELAȘI defect: gate-ul nu face ce
-- spune antetul lui.
--
-- Fix: planul se rezolvă prin `NEW.owner_id`, care există pe rândul NOU în
-- ambele operații — nu prin `NEW.id`, care cere ca rândul să fie deja vizibil.
-- Fail-safe-ul pe jsonb malformat (225) se PĂSTREAZĂ.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_normalize_hide_branding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_has_feature boolean;
begin
  if new.theme_settings is null then
    return new;
  end if;

  -- Paritate cu helperul de citire: doar `true` EXPLICIT înseamnă „ascuns".
  if new.theme_settings -> 'hide_branding' is distinct from 'true'::jsonb then
    return new;
  end if;

  -- mig 281: pe OWNER, nu pe restaurant — la BEFORE INSERT rândul nu există.
  select coalesce(pf.enabled, false) into v_has_feature
    from public.profiles pr
    left join public.plan_features pf
      on pf.plan = pr.plan and pf.feature = 'remove_branding'
   where pr.id = new.owner_id;

  if not coalesce(v_has_feature, false) then
    new.theme_settings := jsonb_set(new.theme_settings, '{hide_branding}', 'false'::jsonb);
  end if;
  return new;
exception when others then
  -- Fail-safe moștenit din 225: pe orice surpriză normalizăm în loc să blocăm
  -- tot UPDATE-ul de restaurant (o salvare legitimă de temă nu trebuie să pice).
  if new.theme_settings is not null and jsonb_typeof(new.theme_settings) = 'object' then
    new.theme_settings := jsonb_set(new.theme_settings, '{hide_branding}', 'false'::jsonb);
  end if;
  return new;
end$fn$;

comment on function public.fn_normalize_hide_branding() is
  'Gate server-side de SCRIERE pentru theme_settings.hide_branding (feature remove_branding, growth+). mig 281: planul se rezolva prin NEW.owner_id — pe NEW.id gate-ul era INUTIL la INSERT (randul nu exista inca, deci feature-ul iesea mereu false si flagul se stergea pe ORICE plan). Autoritatea pentru ce vede oaspetele e gate-ul de CITIRE (public_theme_settings); asta ramane defense-in-depth.';

commit;
