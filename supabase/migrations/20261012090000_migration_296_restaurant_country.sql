-- migration_296_restaurant_country.sql
-- =============================================================================
-- `restaurants.country` + regula de aur coborâtă în DATE pe țară: Plan 3
-- (fiscalizare, bani în aplicație) există DOAR pentru restaurantele din România.
--
-- ── Context ─────────────────────────────────────────────────────────────────
-- Fundația pentru a doua piață (menuvia.com, decizie de fondator): UN cod, UN
-- proiect Supabase, UN deploy. menuvia.ro = română, RON, toate cele 3 planuri
-- (NESCHIMBAT). menuvia.com = engleză, EUR, DOAR Planurile 1–2. Fiscalizarea
-- (FiscalNet, bon pe casa RO, TVA RO, Oblio) e prin construcție românească — un
-- restaurant din Germania nu are casă de marcat Datecs înregistrată la ANAF.
--
-- Planul stă pe OWNER (`profiles.plan`, peretele din ECOSISTEM §4), nu pe
-- restaurant. Deci un owner pe `pro` cu o locație în România ȘI una în afara
-- ei (Plan 3 include 2 locații) ar primi `fiscal_receipt` pe AMBELE dacă gate-ul
-- ar rămâne doar pe plan. Regula nouă: feature-urile românești se rezolvă pe
-- (plan AL OWNER-ULUI) ȘI (țara RESTAURANTULUI).
--
-- ── §1. Coloana ─────────────────────────────────────────────────────────────
-- `country text not null default 'RO'` + CHECK ISO 3166-1 alpha-2 în MAJUSCULE.
-- Backfill IMPLICIT prin default (Postgres ≥ 11 nu rescrie tabela pentru un
-- default constant) → toate restaurantele existente sunt 'RO', deci TOATE
-- rezoluțiile de feature de mai jos dau EXACT ce dădeau înainte (CC1).
--
-- ── §2. Cine o poate schimba ────────────────────────────────────────────────
-- Editabilă de OWNER din Setări/Onboarding: `grant update (country)` (restaurants
-- e column-gated din 096B) — sincronizat în cele 4 locuri (aici, whitelist-ul
-- RW1, `RESTAURANT_UPDATE_FIELDS`, testul JS). DAR politica de UPDATE e
-- `is_admin` (owner ȘI manager), iar schimbarea țării unui local RO pe Plan 3
-- STINGE fiscalizarea, adică deschide închiderea NEfiscală (`close_order`) pe
-- un local care operează în România. E echivalentul unui downgrade de plan —
-- decizie a OWNER-ului (cel care plătește și răspunde fiscal), nu a unui
-- manager. Trigger `trg_restaurants_country_owner_only` (BEFORE UPDATE OF
-- country, NE-definer: trebuie să vadă rolul APELANTULUI, ca 262/270) respinge
-- schimbarea din `anon`/`authenticated` dacă apelantul nu e owner-ul sau
-- fondatorul (`is_platform_admin`); hint `country_owner_only`. `service_role` /
-- `postgres` (suport, migrații) trec.
--
-- ── §3. Rezoluția de feature (singurele trei puncte de trecere) ─────────────
-- Măsurat pe replay-ul lanțului până la 295, prin DESCOPERIRE pe `prosrc`:
-- singurele funcții din `public` care citesc `plan_features` DIRECT sunt
-- `restaurant_has_feature`, `enforce_feature_for_restaurant`,
-- `get_restaurant_features` + șapte gate-uri care NU ating niciun feature
-- românesc (ordering, team limit, SMS, branding, resolve_qr_token). TOATE
-- gate-urile de bani și bon (trigger-ele →paid 124 / →closed 264, enqueue-ul
-- fiscal 133, facturile 158, oblio_config, bridge 149/227, `advance_order`,
-- `add_partial_payment`, `close_session_orders`, `begin_table_payment`,
-- `settle`/split, view-urile de raportare 267/272) trec prin primele DOUĂ. Deci
-- recrearea celor trei închide clasa, fără să atingem vreun gate individual.
-- CC6 e clichetul care ține asta adevărat: o funcție NOUĂ care citește
-- `plan_features` direct face CI roșu până e adăugată în registrul ei.
--
-- Feature-urile românești (`feature_requires_ro`): fiscal_receipt (bon pe casa
-- RO), online_payments (Stripe Connect RON-only, mig 209, + bon), split_bill și
-- shifts (bani în aplicație / sertar — regula de aur: bani = bon), reports_vat
-- (TVA RO). NU: floor_plan / analytics_advanced (Plan 3, dar nefiscale) — nu
-- sunt vândute în afara RO fiindcă Plan 3 nu e vândut acolo, nu fiindcă ar fi
-- ilegale. Lista se lărgește DOAR prin migrație nouă.
--
-- Contractele rămân IDENTICE: semnături, tipuri de retur, ACL-uri (`create or
-- replace` le păstrează — verificat în asserții), `search_path = public,
-- pg_temp` scris EXPLICIT (create or replace rescrie proconfig), hint-ul
-- `feature_disabled` (table-payment.js îl mapează la 403; PayTableSheet/
-- SplitBillSheet pe el; PD2 îl cere literal), mesajul gate-ului de plan
-- neschimbat (PD1: fără nume intern de plan; „plan superior" rămâne).
-- `get_restaurant_features` întoarce aceeași formă (`plan` = planul REAL al
-- owner-ului, facturarea îl afișează) — doar `enabled` reflectă țara.
--
-- ── §4. White-label: menuvia.com e domeniu de PLATFORMĂ ──────────────────────
-- `admin_set_affiliate_branding` (236) rezerva doar `menuvia.ro`; o agenție
-- putea „revendica" menuvia.com. Recreată VERBATIM din 236 + `menuvia.com`.
-- Clientul (`lib/whiteLabel.ts` → `lib/domain.ts`) are aceeași listă.
--
-- ── Ce NU face ──────────────────────────────────────────────────────────────
-- `create_restaurant` (221) rămâne NEATINS: un parametru nou = semnătură nouă =
-- DROP + CREATE (anti PGRST203) + rescrierea listelor RP/G6 — iar țara se poate
-- seta imediat după creare prin UPDATE-ul de owner (§2). Moneda/fusul NU se
-- deduc în DB (sunt coloane editabile separat, 205/049); clientul le propune
-- din țară la onboarding.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── §1. Coloana ─────────────────────────────────────────────────────────────
alter table public.restaurants
  add column if not exists country text not null default 'RO';

alter table public.restaurants
  drop constraint if exists restaurants_country_check;
alter table public.restaurants
  add constraint restaurants_country_check check (country ~ '^[A-Z]{2}$');

comment on column public.restaurants.country is
  $$Țara restaurantului, ISO 3166-1 alpha-2 (mig 296). Default 'RO'. Feature-urile
românești (feature_requires_ro: fiscal, plăți în aplicație, TVA) se rezolvă la
false când country <> 'RO', indiferent de planul owner-ului. Schimbarea: doar
owner-ul / fondatorul (trg_restaurants_country_owner_only).$$;

-- ── §2. Grant + owner-only ──────────────────────────────────────────────────
grant update (country) on table public.restaurants to authenticated;

create or replace function public.enforce_restaurant_country_owner_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.country is distinct from old.country
     and current_user in ('anon', 'authenticated')
     and not (coalesce(old.owner_id = auth.uid(), false)
              or coalesce(public.is_platform_admin(), false)) then
    raise exception 'Doar proprietarul restaurantului poate schimba țara.'
      using errcode = 'insufficient_privilege', hint = 'country_owner_only';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_restaurant_country_owner_only()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_restaurants_country_owner_only on public.restaurants;
create trigger trg_restaurants_country_owner_only
  before update of country on public.restaurants
  for each row execute function public.enforce_restaurant_country_owner_only();

-- ── §3. Rezoluția de feature ────────────────────────────────────────────────
create or replace function public.feature_requires_ro(p_feature text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_feature = any (array[
    'fiscal_receipt', 'online_payments', 'split_bill', 'shifts', 'reports_vat'
  ]);
$$;

-- Helper intern: îl cheamă doar funcțiile DEFINER de mai jos (proprietar
-- postgres). Niciun rol client nu are ce face cu el.
revoke all on function public.feature_requires_ro(text)
  from public, anon, authenticated, service_role;

-- restaurant_has_feature (lanț 122 → ALTER 262 → 296)
create or replace function public.restaurant_has_feature(
  p_restaurant_id uuid,
  p_feature       text
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select pf.enabled
           and (r.country = 'RO' or not public.feature_requires_ro(p_feature))
    from public.restaurants r
    join public.profiles pr on pr.id = r.owner_id
    left join public.plan_features pf on pf.plan = pr.plan and pf.feature = p_feature
    where r.id = p_restaurant_id
  ), false);
$$;

-- enforce_feature_for_restaurant (lanț 087 → ALTER 262 → 290 → 296)
create or replace function public.enforce_feature_for_restaurant(p_restaurant_id uuid, p_feature text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan       text;
  v_enabled    boolean;
  v_country    text;
begin
  select
    coalesce(pr.plan, 'free'),
    coalesce(pf.enabled, false),
    r.country
  into v_plan, v_enabled, v_country
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf
         on pf.plan = pr.plan and pf.feature = p_feature
  where r.id = p_restaurant_id;

  if not coalesce(v_enabled, false) then
    -- mig 290: fără numele intern al planului (regula 4). Hint-ul e contractul.
    raise exception
      'Funcția „%” nu e disponibilă pe planul curent al restaurantului. Funcția cere un plan superior.',
      p_feature
      using errcode = 'check_violation', hint = 'feature_disabled';
  end if;

  -- mig 296: feature-urile românești (fiscal, bani în aplicație, TVA) nu există
  -- în afara României, oricare ar fi planul owner-ului. ACELAȘI hint — pentru
  -- client e tot „funcția nu e disponibilă aici".
  if v_country is distinct from 'RO' and public.feature_requires_ro(p_feature) then
    raise exception
      'Funcția „%” e disponibilă doar pentru restaurantele din România (țara restaurantului: %).',
      p_feature, v_country
      using errcode = 'check_violation', hint = 'feature_disabled';
  end if;
end;
$function$;

-- get_restaurant_features (lanț 028 → 068 → ALTER 262 → 296). Forma întoarsă e
-- IDENTICĂ ({plan, features:{nume:{enabled,limit}}}); `plan` rămâne planul REAL.
create or replace function public.get_restaurant_features(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan     text;
  v_country  text;
  v_features jsonb;
begin
  -- Planul e pe profiles (al owner-ului), nu pe restaurants
  select coalesce(p.plan, 'free'), r.country into v_plan, v_country
  from public.restaurants r
  join public.profiles p on p.id = r.owner_id
  where r.id = p_restaurant_id;

  if v_plan is null then return null; end if;

  -- Build features map: { feature_name: { enabled, limit } }
  -- mig 296: feature-urile românești sunt dezactivate în afara RO.
  select jsonb_object_agg(
    pf.feature,
    jsonb_build_object(
      'enabled', pf.enabled and (v_country = 'RO' or not public.feature_requires_ro(pf.feature)),
      'limit', pf.limit_value)
  ) into v_features
  from public.plan_features pf
  where pf.plan = v_plan;

  return jsonb_build_object(
    'plan', v_plan,
    'features', coalesce(v_features, '{}'::jsonb)
  );
end;
$function$;

-- ── §4. White-label: menuvia.com rezervat (lanț 236 → 296, verbatim + .com) ──
create or replace function public.admin_set_affiliate_branding(p_affiliate_id uuid, p_domain text, p_name text, p_logo_url text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_domain text;
  v_old    record;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  select id, brand_domain, brand_name, brand_logo_url
    into v_old
    from public.affiliates where id = p_affiliate_id;
  if v_old.id is null then
    return jsonb_build_object('ok', false, 'error', 'affiliate_not_found');
  end if;

  -- Normalizare + validare domeniu: lowercase, fără protocol/cale, format
  -- hostname. NULL/gol = ștergerea brandingului de domeniu.
  v_domain := nullif(lower(btrim(coalesce(p_domain, ''))), '');
  if v_domain is not null then
    v_domain := regexp_replace(v_domain, '^https?://', '');
    v_domain := split_part(v_domain, '/', 1);
    if v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_domain');
    end if;
    -- Domeniile platformei nu pot fi „revendicate" de o agenție (mig 296: +.com).
    if v_domain = 'menuvia.ro' or v_domain like '%.menuvia.ro'
       or v_domain = 'menuvia.com' or v_domain like '%.menuvia.com'
       or v_domain like '%.netlify.app' then
      return jsonb_build_object('ok', false, 'error', 'reserved_domain');
    end if;
  end if;

  begin
    update public.affiliates
       set brand_domain   = v_domain,
           brand_name     = nullif(btrim(coalesce(p_name, '')), ''),
           brand_logo_url = nullif(btrim(coalesce(p_logo_url, '')), '')
     where id = p_affiliate_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'domain_taken');
  end;

  perform public.log_platform_action(
    'founder', null, 'affiliate_branding_set',
    jsonb_build_object(
      'affiliate_id', p_affiliate_id,
      'old', jsonb_build_object('domain', v_old.brand_domain, 'name', v_old.brand_name),
      'new', jsonb_build_object('domain', v_domain, 'name', nullif(btrim(coalesce(p_name, '')), ''))
    )
  );

  return jsonb_build_object('ok', true, 'brand_domain', v_domain);
end;
$function$;

-- ── Asserții fail-closed ────────────────────────────────────────────────────
do $$
declare
  v_bad text;
begin
  -- coloana + CHECK + default
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'country' and is_nullable = 'NO'
       and column_default like '%''RO''%'
  ) then
    raise exception 'mig 296: restaurants.country lipsă / nullable / fără default RO';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'restaurants_country_check'
                    and conrelid = 'public.restaurants'::regclass) then
    raise exception 'mig 296: CHECK restaurants_country_check lipsă';
  end if;
  if exists (select 1 from public.restaurants where country <> 'RO') then
    raise exception 'mig 296: backfill-ul implicit trebuia să lase TOATE restaurantele pe RO';
  end if;

  -- grant column-level (sincron cu RW1 / RESTAURANT_UPDATE_FIELDS)
  if not has_column_privilege('authenticated', 'public.restaurants', 'country', 'UPDATE') then
    raise exception 'mig 296: authenticated fără UPDATE pe restaurants.country';
  end if;
  if has_column_privilege('anon', 'public.restaurants', 'country', 'UPDATE') then
    raise exception 'mig 296: anon poate scrie restaurants.country';
  end if;

  -- trigger-ul owner-only: BEFORE UPDATE OF country ROW (tgtype 19), NE-definer
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.restaurants'::regclass
       and t.tgname = 'trg_restaurants_country_owner_only'
       and t.tgtype = 19 and t.tgenabled = 'O'
  ) then
    raise exception 'mig 296: trg_restaurants_country_owner_only lipsă / formă greșită';
  end if;
  if (select prosecdef from pg_proc
       where oid = 'public.enforce_restaurant_country_owner_only()'::regprocedure) then
    raise exception 'mig 296: funcția owner-only trebuie să fie NE-definer (vede rolul apelantului)';
  end if;

  -- cele trei puncte de trecere: DEFINER + pg_temp + citesc țara
  select string_agg(f, ', ') into v_bad
    from unnest(array[
      'public.restaurant_has_feature(uuid,text)',
      'public.enforce_feature_for_restaurant(uuid,text)',
      'public.get_restaurant_features(uuid)']) f
    join pg_proc p on p.oid = f::regprocedure
   where not p.prosecdef
      or not ('search_path=public, pg_temp' = any (p.proconfig))
      or position('feature_requires_ro' in p.prosrc) = 0;
  if v_bad is not null then
    raise exception 'mig 296: punct de trecere fără gate de țară / ne-DEFINER / fără pg_temp: %', v_bad;
  end if;

  -- ACL-uri păstrate (create or replace nu le atinge — verificat, nu presupus)
  if has_function_privilege('anon', 'public.restaurant_has_feature(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.enforce_feature_for_restaurant(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.get_restaurant_features(uuid)', 'execute') then
    raise exception 'mig 296: o funcție de feature a devenit executabilă de anon';
  end if;
  if not has_function_privilege('authenticated', 'public.get_restaurant_features(uuid)', 'execute') then
    raise exception 'mig 296: authenticated a pierdut get_restaurant_features (useFeatures ar muri)';
  end if;
  if has_function_privilege('authenticated', 'public.feature_requires_ro(text)', 'execute')
     or has_function_privilege('anon', 'public.feature_requires_ro(text)', 'execute') then
    raise exception 'mig 296: feature_requires_ro e helper intern';
  end if;

  -- contractele de hint rămân (PD2 / table-payment.js)
  if (select prosrc from pg_proc where oid = 'public.enforce_feature_for_restaurant(uuid,text)'::regprocedure)
     not like '%hint = ''feature_disabled''%' then
    raise exception 'mig 296: enforce_feature_for_restaurant a pierdut hint-ul feature_disabled';
  end if;

  -- menuvia.com rezervat în white-label
  if position('menuvia.com' in (select prosrc from pg_proc
        where oid = 'public.admin_set_affiliate_branding(uuid,text,text,text)'::regprocedure)) = 0 then
    raise exception 'mig 296: admin_set_affiliate_branding nu rezervă menuvia.com';
  end if;
  if exists (select 1 from public.affiliates
              where brand_domain = 'menuvia.com' or brand_domain like '%.menuvia.com') then
    raise exception 'mig 296: un afiliat are deja un domeniu menuvia.com — decizie de fondator';
  end if;
end $$;

commit;
