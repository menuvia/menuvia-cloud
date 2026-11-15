-- migration_324_restaurant_time_zone.sql
-- =============================================================================
-- G2a: Happy Hour și plafonul lunar de SMS se judecă în fusul RESTAURANTULUI,
-- nu în fusul Bucureștiului.
--
-- ── Problema ────────────────────────────────────────────────────────────────
-- Platforma vinde și în afara României (menuvia.com), iar `restaurants.timezone`
-- e editabil (G1). Mig 298 a mutat pe fusul localului doar rezervarea publică;
-- printre obiectele cu fusul Bucureștiului scris de mână (descoperire pe replay:
-- `prosrc ~ 'Europe/Bucharest'` + definițiile view-urilor — clasificarea
-- completă e la „Rămân pe București” mai jos), două au semnificație PER
-- RESTAURANT pe bani sau pe plafon și nicio dependență de suprafețe în lucru:
--   * Happy Hour — `public_happy_hour_now` (077) și geamănul lui nedocumentat
--     `evaluate_happy_hour_for_now` (036). Un local din New York cu Happy Hour
--     vineri 17:00–19:00 primea reducerea vineri 10:00–12:00 la el acasă (= 17–19
--     la București) și NU o primea la 17:00–19:00. Banii sunt server-side
--     (`_apply_happy_hour_auto`, `update_order_items`), deci oaspetele plătea
--     prețul greșit, nu doar vedea un badge greșit. Ziua săptămânii se decidea
--     tot pe București (vineri 18:00 la New York = sâmbătă 01:00 la București).
--   * Plafonul lunar de SMS — `enqueue_sms` și contorul `get_sms_usage` (228):
--     luna începea la miezul nopții de 1 la București (31 oct 22:00Z), adică
--     abia la 1 noiembrie 11:00 ora unui local din Auckland și încă din
--     31 octombrie 18:00 ora unui local din New York.
-- Pentru localurile din România (toate de azi pe producție) fusul localului ESTE
-- Bucureștiul, deci comportamentul românesc e IDENTIC — TZ6/TZ8d îl țin.
--
-- ── Remediul ────────────────────────────────────────────────────────────────
-- Fusul intră în SQL printr-un SINGUR loc: `restaurant_time_zone(uuid)` =
-- `safe_time_zone(restaurants.timezone)` (298). Restaurant inexistent / fus
-- invalid → București, exact ca `safeTimeZone` din src/lib/dates.ts. Helperul e
-- INVOKER și închis pentru TOATE rolurile client + service_role: îl cheamă doar
-- funcțiile DEFINER, care rulează ca proprietarul lor (un obiect INVOKER sau un
-- view `security_invoker` NU-l poate chema — RZ5; calea lor se decide în G2b).
--   * Happy Hour: nucleul UNIC `_happy_hour_rules_at(uuid, timestamptz)` — predicatul
--     036/077 VERBATIM, cu instantul ca parametru (testabil pe instante FIXE: DST,
--     wrap-around, ziua săptămânii). Cele două RPC-uri devin învelișuri subțiri
--     care îi dau `now()` (momentul tranzacției, ca înainte — trigger-ul DEFERRED
--     la COMMIT vede același `now()`). Geamănul nedocumentat se închide prin
--     construcție: nu mai există două copii ale calculului de oră/zi.
--     Consumatorii moștenesc FĂRĂ recreare: `_apply_happy_hour_auto` (077),
--     `update_order_items` (…→313→320), `suggest_happy_hour_discount_for_order`
--     (077) — recrearea lor ar risca invariantele lanțurilor lungi fără câștig.
--   * SMS: luna plafonului se ȘTAMPILEAZĂ pe rând, la INSERT:
--     `sms_queue.cap_month date` (prima zi a lunii locale), scrisă de trigger-ul
--     `trg_sms_queue_stamp_cap_month` (BEFORE INSERT ROW) din `_restaurant_month(
--     uuid, timestamptz)` — sursa UNICĂ a etichetei lunii — cu fusul localului din
--     ACEL moment. Plafonul (`enqueue_sms`) și contorul (`get_sms_usage`) numără
--     `cap_month = luna locală de acum`, deci nu mai pot diverge.
--     DE CE ștampilă și nu fereastră (recenzie adversarială pe G2a, reprodus pe
--     replay): o fereastră `created_at >= începutul lunii în fusul CURENT` se
--     recalculează la fiecare apel, iar `restaurants.timezone` e scris de orice
--     admin (grant pe coloană + `is_admin`, fără CHECK). La granița lunii, un
--     admin trece de pe Pacific/Kiritimati (UTC+14: luna începe la 31 oct 10:00Z)
--     pe Pacific/Pago_Pago (UTC−11: 1 nov 11:00Z) și toate SMS-urile din banda de
--     ~25 h cad din numărătoare — plafon RESETAT, lună de lună (+300 SMS pe growth,
--     +1000 pe enterprise, plătite de platformă). Cu ștampila, un rând trimis
--     rămâne în luna lui oricum s-ar schimba fusul după: fiecare etichetă de lună
--     are cel mult un plafon (TZ8f). Schimbarea fusului poate doar MUTA granița cu
--     diferența de ofset (o lună începe câteva ore mai devreme sau mai târziu),
--     nu poate da un plafon în plus.
--     plpgsql cu variabilă, NU sql cu subinterogare: planificatorul poate aplatiza
--     `(select f() as tz) z` și ar evalua funcția de două ori.
--   * `safe_time_zone` primește o scurtătură IDENTICĂ pentru 'Europe/Bucharest'.
--     MĂSURAT pe replay (PG 16): 100 de apeluri pe calea lentă = 1009 ms
--     (~10 ms/apel — scanarea `pg_timezone_names`, materializată la fiecare
--     apel), cu scurtătura = 1,2 ms (~0,01 ms/apel). Fără ea, fiecare încărcare
--     de meniu QR, fiecare COMMIT de comandă QR/pickup, fiecare editare și
--     fiecare SMS de pe localurile din România ar plăti +10 ms. Rezultatul e
--     identic prin construcție: pentru acest argument calea lentă întoarce fie
--     numele canonic 'Europe/Bucharest', fie fallback-ul 'Europe/Bucharest'; un
--     singur nume se potrivește case-insensitive. Scurtătura NU e pe `lower()`
--     (ar întoarce 'europe/bucharest', necanonic) — TZ1 o compară cu calea lentă.
--
-- ── Lanțuri ─────────────────────────────────────────────────────────────────
--   safe_time_zone              298→**324** (aceeași semnătură, `create or replace`)
--   public_happy_hour_now       077→**324** (pg_temp pus prin ALTER în 262; acum explicit)
--   evaluate_happy_hour_for_now 036→**324** (idem)
--   enqueue_sms / get_sms_usage 228→**324** (copii VERBATIM 228 + numărătoarea pe ștampilă)
--   NOI: restaurant_time_zone, _happy_hour_rules_at, _restaurant_month,
--        sms_queue_stamp_cap_month (+ coloana sms_queue.cap_month, indexul ei).
-- Nicio migrație ulterioară nu redefinește aceste funcții (capcana 290/296 nu
-- se aplică). Aceleași semnături → `create or replace` (păstrează ACL-ul);
-- `search_path = public, pg_temp` e scris EXPLICIT pe fiecare corp (un `create or
-- replace` rescrie `proconfig`, deci pg_temp-ul pus de 262 prin ALTER s-ar fi
-- pierdut tăcut altfel).
--
-- ── Invariante păstrate ─────────────────────────────────────────────────────
--   Happy Hour: filtrul pe restaurant ACTIV și FĂRĂ `is_member` pe învelișul
--   public (allowlist-ul AH1: „badge HH pe meniu”); `is_member` + mesajul verbatim
--   pe `evaluate_…`; convenția 1 = duminică; fereastra inclusivă la ambele capete;
--   wrap-around `ends_at < starts_at`; pe wrap-around contează ziua CURENTĂ, nu
--   ziua de serviciu (comportament existent, înghețat de TZ4 ca să nu se schimbe
--   tăcut — o schimbare în stilul 241 cere decizie); forma de retur (qr.ts
--   `HappyHourRule`); coloane EXPLICITE în învelișul anon (PU8, auto/309).
--   SMS: gate modul → gate plan, `return null` pe TOATE ramurile negative (zero
--   `raise` — triggerele SMS sunt exception-wrapped, SQ9), se numără tot ce nu e
--   'cancelled', `fn_sms_normalize_ro_phone`, `on conflict (dedup_key) do nothing`,
--   interogarea limitei NESCHIMBATĂ (CC6 o ține în registrul cititorilor);
--   `get_sms_usage`: gate `is_admin` + 42501 + aceleași patru chei jsonb.
--   ACL: instantaneu înainte/după pe cele cinci funcții preexistente (pică dacă
--   s-a schimbat ceva), helperii noi închiși EXPLICIT pe fiecare rol (default
--   privileges ale Supabase acordă direct pe funcțiile noi — capcana 274; sql-verify
--   e orb, jobul E2E vede). Același PROPRIETAR pentru helperi și învelișuri: pe
--   calea triggerelor SMS (exception-wrapped) un 42501 ar opri SMS-urile TĂCUT.
--
-- ── Rămân pe București, DELIBERAT ───────────────────────────────────────────
--   (b) fiscal / doar-România: `report_by_hour` (033→122, NEATINS: singurul
--       consumator e `fetchHourlySales`, chemat doar sub `fiscalReports` din
--       ReportsTab, adică pe suprafața fiscală `money === 3`, care cere
--       `fiscal_receipt`, pe care `feature_requires_ro` (296) îl stinge pentru
--       orice țară ≠ RO — un local străin nu vede niciodată histograma; pe un local
--       românesc cu fus ≠ București ora localului ar fi contrazis fereastra, care
--       e ziua ROMÂNEASCĂ; se decide în G2b împreună cu fereastra și graficul zilnic),
--       `vat_report_daily`, `v_daily_orders`,
--       `v_daily_payments_by_method` + `get_daily_payments_by_method`, urmele din
--       `bridge_retry_receipt` / `bridge_force_resolve_stuck`, Oblio,
--       `compute_daily_report` / `compute_weekly_report` (numără doar `paid`, deci
--       doar România; se mută în L8a când vor număra `closed`);
--   (c) platformă: `admin_monthly_benchmark`, payout + `get_affiliate_dashboard`,
--       cote AI, rate-limit, cron/janitoare (CJ7);
--   (d) pe instante, deci fără fus: rezervările (298 deja pe fusul localului),
--       disponibilitatea, no-show, expirările, sesiunile, stocul, loyalty.
-- Trec în G2b: `get_locations_summary` (obiect MIXT, INVOKER), `v_hourly_distribution`
-- (INVOKER) și granițele de zi calculate în client. Pe L8: tichetul de bucătărie
-- (L8c), orele din SMS/emailuri (L8a/L8b).
--
-- Teste permanente TZ1–TZ9: tests/sql/auto/324_restaurant_time_zone.sql
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── §0. Precondiții + instantaneu ───────────────────────────────────────────
do $$
declare
  v_dist text;
  v_ro_other text;
begin
  -- 324 depinde de helperul din 298; producția aplică lanțul în ordine.
  if to_regprocedure('public.safe_time_zone(text)') is null then
    raise exception 'mig 324: lipsește public.safe_time_zone(text) — aplică întâi mig 298';
  end if;

  -- Distribuția fusurilor (așteptat pe prod: totul pe București). Un local
  -- românesc cu alt fus trece la ora LUI pentru Happy Hour și SMS —
  -- intenționat, dar trebuie văzut la aplicare.
  select string_agg(format('%s/%s=%s', country, timezone, n), ', ' order by n desc, country, timezone)
    into v_dist
    from (select country, timezone, count(*) as n from public.restaurants group by 1, 2) d;
  raise notice 'mig 324: restaurante pe (țară/fus): %', coalesce(v_dist, '(niciunul)');
  select string_agg(format('%s (%s)', slug, timezone), ', ' order by slug)
    into v_ro_other
    from public.restaurants
   where country = 'RO'
     and timezone is distinct from 'Europe/Bucharest'   -- ieftin întâi: calea lentă ~10 ms/rând
     and public.safe_time_zone(timezone) <> 'Europe/Bucharest';
  if v_ro_other is not null then
    raise notice 'mig 324: ATENȚIE — localuri din România cu alt fus decât Bucureștiul (Happy Hour/SMS le urmează fusul de acum): %', v_ro_other;
  end if;
end $$;

create temp table m324_acl_before on commit drop as
select p.oid,
       p.oid::regprocedure::text as sig,
       coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '<implicit>') as acl
  from pg_proc p
 where p.oid in ('public.safe_time_zone(text)'::regprocedure,
                 'public.public_happy_hour_now(uuid)'::regprocedure,
                 'public.evaluate_happy_hour_for_now(uuid)'::regprocedure,
                 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)'::regprocedure,
                 'public.get_sms_usage(uuid)'::regprocedure);

-- ── §1. safe_time_zone 298→324: scurtătura identică pentru București ────────
create or replace function public.safe_time_zone(p_tz text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  -- Scurtătura (mig 324): fusul implicit, scris exact, e deja numele canonic —
  -- rezultat IDENTIC cu calea lentă, fără scanarea catalogului (~10 ms/apel).
  -- Altfel: numele CANONIC din catalog pentru o potrivire case-insensitive (fără
  -- trim, paritate cu Intl), altfel fusul implicit al platformei.
  select case
    when p_tz = 'Europe/Bucharest' then p_tz
    else coalesce(
      (select n.name
         from pg_catalog.pg_timezone_names n
        where lower(n.name) = lower(p_tz)
          and n.name not in ('localtime', 'posixrules', 'Factory')
        order by n.name collate "C"
        limit 1),
      'Europe/Bucharest')
  end;
$$;

comment on function public.safe_time_zone(text) is
  'mig 298 (+ scurtătura identică pentru Europe/Bucharest în 324): fusul IANA validat pe pg_timezone_names (case-insensitive, nume canonic); NULL/necunoscut → Europe/Bucharest. Oglinda safeTimeZone din src/lib/dates.ts.';

revoke all on function public.safe_time_zone(text)
  from public, anon, authenticated, service_role;

-- ── §2. restaurant_time_zone: SINGURA definiție SQL a „fusului localului” ───
create or replace function public.restaurant_time_zone(p_restaurant_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  -- Fusul din rândul restaurantului, validat. Restaurant inexistent → NULL →
  -- fallback-ul helperului de validare (București); niciun literal de fus aici.
  select public.safe_time_zone(
    (select r.timezone from public.restaurants r where r.id = p_restaurant_id));
$$;

comment on function public.restaurant_time_zone(uuid) is
  'mig 324: fusul restaurantului = safe_time_zone(restaurants.timezone) (G1 îl face editabil); oglinda safeTimeZone(restaurant.timezone) din client. INVOKER, închis pentru toate rolurile client: îl cheamă doar funcții DEFINER, o singură dată per apel (clauza SET împiedică inlinierea).';

revoke all on function public.restaurant_time_zone(uuid)
  from public, anon, authenticated, service_role;

-- ── §3. Happy Hour: nucleul unic, instantul ca parametru ────────────────────
create or replace function public._happy_hour_rules_at(
  p_restaurant_id uuid,
  p_at            timestamptz
)
returns table (
  id              uuid,
  name            text,
  scope           text,
  category_id     uuid,
  product_id      uuid,
  discount_type   public.order_discount_type,
  discount_value  numeric,
  max_discount    numeric
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local    timestamp;
  v_now_time time;
  v_now_dow  smallint;
begin
  -- Ora de perete a LOCALULUI la instantul dat (fusul o singură dată).
  v_local    := p_at at time zone public.restaurant_time_zone(p_restaurant_id);
  v_now_time := v_local::time;
  -- Ziua ISO (1 = luni … 7 = duminică) → convenția regulilor: 1 = duminică,
  -- 2 = luni, …, 7 = sâmbătă.
  v_now_dow  := extract(isodow from v_local)::smallint;
  v_now_dow  := case when v_now_dow = 7 then 1 else v_now_dow + 1 end;

  -- Predicatul 036/077, verbatim. Pe wrap-around (ends_at < starts_at) contează
  -- ziua CURENTĂ a orei de perete, nu ziua de serviciu (comportament existent).
  return query
    select
      r.id, r.name, r.scope, r.category_id, r.product_id,
      r.discount_type, r.discount_value, r.max_discount
    from public.happy_hour_rules r
    where r.restaurant_id = p_restaurant_id
      and r.is_active = true
      and (
        cardinality(r.days_of_week) = 0 OR v_now_dow = ANY(r.days_of_week)
      )
      and (
        (r.ends_at >= r.starts_at AND v_now_time >= r.starts_at AND v_now_time <= r.ends_at)
        OR
        (r.ends_at < r.starts_at AND (v_now_time >= r.starts_at OR v_now_time <= r.ends_at))
      );
end;
$$;

comment on function public._happy_hour_rules_at(uuid, timestamptz) is
  'mig 324: nucleul unic Happy Hour — regulile active la instantul dat, în fusul restaurantului (predicatul 036/077). Îl cheamă doar public_happy_hour_now și evaluate_happy_hour_for_now (DEFINER).';

revoke all on function public._happy_hour_rules_at(uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Învelișul PUBLIC (meniul QR, /m/:slug, banii prin _apply_happy_hour_auto și
-- update_order_items). Fără is_member — endpoint public.
create or replace function public.public_happy_hour_now(
  p_restaurant_id uuid
)
returns table (
  id              uuid,
  name            text,
  scope           text,
  category_id     uuid,
  product_id      uuid,
  discount_type   public.order_discount_type,
  discount_value  numeric,
  max_discount    numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Doar restaurante active (fără is_member — e endpoint public)
  if not exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.is_active = true
  ) then
    return;
  end if;

  -- Ora și ziua se calculează în nucleu, în fusul localului (mig 324).
  return query
    select
      h.id, h.name, h.scope, h.category_id, h.product_id,
      h.discount_type, h.discount_value, h.max_discount
    from public._happy_hour_rules_at(p_restaurant_id, now()) h;
end;
$$;

revoke all on function public.public_happy_hour_now(uuid) from public;
grant execute on function public.public_happy_hour_now(uuid) to anon, authenticated;

-- Învelișul de PERSONAL (HappyHourTab, sugestia ospătarului prin
-- suggest_happy_hour_discount_for_order).
create or replace function public.evaluate_happy_hour_for_now(
  p_restaurant_id uuid
)
returns table (
  id              uuid,
  name            text,
  scope           text,
  category_id     uuid,
  product_id      uuid,
  discount_type   public.order_discount_type,
  discount_value  numeric,
  max_discount    numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;

  -- Aceeași sursă ca învelișul public: nucleul, în fusul localului (mig 324).
  return query
    select
      h.id, h.name, h.scope, h.category_id, h.product_id,
      h.discount_type, h.discount_value, h.max_discount
    from public._happy_hour_rules_at(p_restaurant_id, now()) h;
end;
$$;

revoke all on function public.evaluate_happy_hour_for_now(uuid) from public;
grant execute on function public.evaluate_happy_hour_for_now(uuid) to authenticated;

-- ── §4. SMS: luna plafonului ștampilată pe rând ─────────────────────────────
-- Eticheta lunii (prima zi a lunii locale) la instantul dat: sursa UNICĂ.
create or replace function public._restaurant_month(
  p_restaurant_id uuid,
  p_at            timestamptz
)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  -- Fusul o singură dată, în variabilă (nu sql cu subinterogare: aplatizarea
  -- ar putea evalua helperul de două ori).
  v_tz text := public.restaurant_time_zone(p_restaurant_id);
begin
  -- Ora de perete a localului → prima zi a lunii ei. Independent de TimeZone-ul
  -- sesiunii: trunchierea lucrează pe timestamp fără fus.
  return date_trunc('month', p_at at time zone v_tz)::date;
end;
$$;

comment on function public._restaurant_month(uuid, timestamptz) is
  'mig 324: luna (prima zi) a instantului dat, în fusul restaurantului. Sursa UNICĂ a etichetei plafonului SMS: ștampila de la INSERT (sms_queue.cap_month) și luna curentă din enqueue_sms + get_sms_usage.';

revoke all on function public._restaurant_month(uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Coloana: luna în care rândul CONSUMĂ plafonul, fixată la INSERT. O schimbare
-- ulterioară a fusului nu mai re-etichetează rândurile deja trimise — altfel
-- trecerea est→vest la granița lunii scotea din numărătoare banda de ~25 h
-- dintre cele două începuturi de lună (plafon resetat lunar).
alter table public.sms_queue add column if not exists cap_month date;

comment on column public.sms_queue.cap_month is
  'mig 324: luna locală (prima zi) în care SMS-ul consumă plafonul; scrisă DOAR de trg_sms_queue_stamp_cap_month la INSERT, cu fusul localului din acel moment. Plafonul și contorul numără cap_month = luna locală de acum.';

create or replace function public.sms_queue_stamp_cap_month()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Mereu suprascris (nu „doar dacă lipsește”): nicio cale de scriere nu își
  -- alege singură luna. INVOKER: singurii care inserează sunt enqueue_sms
  -- (DEFINER, rulează ca proprietarul) și proprietarul; rolurile client și
  -- service_role n-au INSERT pe tabelă (228).
  new.cap_month := public._restaurant_month(new.restaurant_id, new.created_at);
  return new;
end;
$$;

comment on function public.sms_queue_stamp_cap_month() is
  'mig 324: BEFORE INSERT pe sms_queue — ștampilează cap_month = _restaurant_month(restaurant_id, created_at).';

revoke all on function public.sms_queue_stamp_cap_month()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_sms_queue_stamp_cap_month on public.sms_queue;
create trigger trg_sms_queue_stamp_cap_month
  before insert on public.sms_queue
  for each row execute function public.sms_queue_stamp_cap_month();

-- Backfill: rândurile de dinainte primesc luna locală a creării în fusul de
-- ACUM (pe producție toate localurile sunt pe București → exact luna pe care
-- o număra fereastra 228). One-shot, pe helperul unic; pe București scurtătura
-- face apelul per rând ieftin.
update public.sms_queue q
   set cap_month = public._restaurant_month(q.restaurant_id, q.created_at)
 where q.cap_month is null;

alter table public.sms_queue alter column cap_month set not null;

create index if not exists idx_sms_queue_restaurant_cap_month
  on public.sms_queue (restaurant_id, cap_month);

create or replace function public.enqueue_sms(
  p_restaurant_id   uuid,
  p_recipient_phone text,
  p_template_kind   public.sms_template_kind,
  p_template_data   jsonb default '{}'::jsonb,
  p_dedup_key       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit       integer;
  v_used        bigint;
  v_phone       text;
  v_id          uuid;
  v_month       date;
begin
  -- 1) Gate modul (opt-in explicit al ownerului; default OFF).
  if not public.is_module_enabled(p_restaurant_id, 'sms_notifications') then
    return null;
  end if;

  -- 2) Gate plan (free = OFF; doar planurile plătite).
  if not public.restaurant_has_feature(p_restaurant_id, 'sms_notifications') then
    return null;
  end if;

  -- 3) Plafonul lunar (luna LOCALĂ, ștampilată pe rând la INSERT — mig 324).
  -- Numără tot ce nu e 'cancelled' — și tentativele eșuate consumă plafonul
  -- (anti-abuz).
  select pf.limit_value into v_limit
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  join public.plan_features pf on pf.plan = pr.plan and pf.feature = 'sms_notifications'
  where r.id = p_restaurant_id;

  if v_limit is not null then
    -- Fusul NU se poate schimba între numărătoare și ștampilă (recenzie
    -- CodeRabbit pe #376): sub READ COMMITTED, trigger-ul de ștampilă citește
    -- fusul într-o instrucțiune NOUĂ, deci o schimbare comisă între ele ar
    -- ștampila rândul într-o lună al cărei plafon nu s-a verificat — repetat,
    -- o lună se umple în timp ce luna verificată rămâne la zero. FOR SHARE
    -- face UPDATE-ul concurent pe restaurant să aștepte COMMIT-ul nostru (FK-ul
    -- inserției ia deja KEY SHARE pe același rând); doar pe ramura cu plafon.
    perform 1 from public.restaurants r where r.id = p_restaurant_id for share;
    v_month := public._restaurant_month(p_restaurant_id, now());
    select count(*) into v_used
    from public.sms_queue
    where restaurant_id = p_restaurant_id
      and status <> 'cancelled'
      and cap_month = v_month;
    if v_used >= v_limit then
      return null;
    end if;
  end if;

  -- 4) Doar mobile RO.
  v_phone := public.fn_sms_normalize_ro_phone(p_recipient_phone);
  if v_phone is null then
    return null;
  end if;

  -- 5) Insert cu dedup (on conflict do nothing → null la duplicat).
  insert into public.sms_queue
    (restaurant_id, recipient_phone, template_kind, template_data, dedup_key)
  values (p_restaurant_id, v_phone, p_template_kind, coalesce(p_template_data, '{}'::jsonb), p_dedup_key)
  on conflict (dedup_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)
  to service_role;

create or replace function public.get_sms_usage(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit       integer;
  v_used        bigint;
  v_month       date;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Acces interzis' using errcode = 'insufficient_privilege';
  end if;

  select pf.limit_value into v_limit
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  join public.plan_features pf on pf.plan = pr.plan and pf.feature = 'sms_notifications'
  where r.id = p_restaurant_id;

  -- Aceeași lună ca plafonul din enqueue_sms (mig 324: ștampila de pe rând).
  v_month := public._restaurant_month(p_restaurant_id, now());
  select count(*) into v_used
  from public.sms_queue
  where restaurant_id = p_restaurant_id
    and status <> 'cancelled'
    and cap_month = v_month;

  return jsonb_build_object(
    'used',           v_used,
    'cap',            v_limit,
    'module_enabled', public.is_module_enabled(p_restaurant_id, 'sms_notifications'),
    'plan_enabled',   public.restaurant_has_feature(p_restaurant_id, 'sms_notifications')
  );
end;
$$;

revoke all on function public.get_sms_usage(uuid) from public, anon;
grant execute on function public.get_sms_usage(uuid) to authenticated;

-- Comentariul de tabelă descria luna pe București — documentație care ar minți.
comment on table public.sms_queue is
  $$Coadă SMS tranzacționale (mig 228). Scrierile trec EXCLUSIV prin enqueue_sms
  (triggere DB) și claim_sms_batch / update-urile workerului (service_role).
  Plafonul lunar per restaurant se numără pe (restaurant_id, cap_month): luna
  LOCALĂ ștampilată la INSERT (mig 324 — o schimbare ulterioară a fusului nu
  re-etichetează rândurile trimise), excluzând doar 'cancelled' (anti-abuz: și
  eșecurile consumă plafonul).$$;

-- ── §5. Asserții fail-closed ────────────────────────────────────────────────
do $$
declare
  c_helpers constant text[] := array[
    'public.restaurant_time_zone(uuid)',
    'public._happy_hour_rules_at(uuid, timestamptz)',
    'public._restaurant_month(uuid, timestamptz)',
    'public.sms_queue_stamp_cap_month()'];
  c_wrappers constant text[] := array[
    'public.public_happy_hour_now(uuid)',
    'public.evaluate_happy_hour_for_now(uuid)',
    'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)',
    'public.get_sms_usage(uuid)'];
  v_sig  text;
  v_src  text;
  v_cfg  text;
  v_def  boolean;
  v_bad  text;
  v_n    int;
  v_role text;
begin
  -- (a) contractul safe_time_zone (298) + scurtătura
  if public.safe_time_zone(null) is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('Mars/Olympus') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('UTC+3') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone(' America/New_York') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('Europe/Bucharest ') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('localtime') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('America/New_York') is distinct from 'America/New_York'
     or public.safe_time_zone('america/new_york') is distinct from 'America/New_York'
     or public.safe_time_zone('europe/bucharest') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('Europe/Bucharest') is distinct from 'Europe/Bucharest' then
    raise exception 'mig 324: safe_time_zone nu mai respectă contractul 298';
  end if;
  if position($q$p_tz = 'Europe/Bucharest'$q$ in
       (select prosrc from pg_proc where oid = 'public.safe_time_zone(text)'::regprocedure)) = 0 then
    raise exception 'mig 324: safe_time_zone fără scurtătura pentru București';
  end if;

  -- (b) helperii pe un restaurant inexistent cad pe București (granița 31 oct 22:00Z)
  if public.restaurant_time_zone('00000000-0000-4000-8000-000000000324') is distinct from 'Europe/Bucharest' then
    raise exception 'mig 324: restaurant_time_zone pe restaurant inexistent ≠ București';
  end if;
  if public._restaurant_month('00000000-0000-4000-8000-000000000324', timestamptz '2026-10-31 21:59:00+00')
       is distinct from date '2026-10-01'
     or public._restaurant_month('00000000-0000-4000-8000-000000000324', timestamptz '2026-10-31 22:00:00+00')
       is distinct from date '2026-11-01' then
    raise exception 'mig 324: _restaurant_month pe restaurant inexistent ≠ luna Bucureștiului';
  end if;

  -- (c) o singură semnătură pe fiecare nume
  foreach v_sig in array array['safe_time_zone', 'restaurant_time_zone', '_happy_hour_rules_at',
                               'public_happy_hour_now', 'evaluate_happy_hour_for_now',
                               '_restaurant_month', 'sms_queue_stamp_cap_month',
                               'enqueue_sms', 'get_sms_usage'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_sig;
    if v_n <> 1 then
      raise exception 'mig 324: % are % semnături (PGRST203)', v_sig, v_n;
    end if;
  end loop;

  -- (d) niciun fus fix în corpurile recreate / noi; delegarea e reală
  foreach v_sig in array c_helpers || c_wrappers loop
    select prosrc, coalesce(array_to_string(proconfig, ','), ''), prosecdef
      into v_src, v_cfg, v_def from pg_proc where oid = v_sig::regprocedure;
    if position('''Europe/Bucharest''' in v_src) > 0 then
      raise exception 'mig 324: % are încă fusul București scris de mână', v_sig;
    end if;
    if v_cfg !~ 'search_path=public, ?pg_temp' then
      raise exception 'mig 324: % fără search_path cu pg_temp (%)', v_sig, v_cfg;
    end if;
    if (v_sig = any(c_helpers)) = v_def then
      raise exception 'mig 324: % are SECURITY % greșit (helper = INVOKER, înveliș = DEFINER)',
        v_sig, case when v_def then 'DEFINER' else 'INVOKER' end;
    end if;
  end loop;
  foreach v_sig in array array['public.public_happy_hour_now(uuid)', 'public.evaluate_happy_hour_for_now(uuid)'] loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    if position('_happy_hour_rules_at(' in v_src) = 0 or position('isodow' in v_src) > 0 then
      raise exception 'mig 324: % nu deleagă nucleului (sau și-a păstrat calculul propriu de zi)', v_sig;
    end if;
  end loop;
  -- perechea SMS numără pe ștampilă, nu pe o fereastră recalculată din fusul
  -- CURENT (aceea se ocolea schimbând fusul la granița lunii)
  foreach v_sig in array array['public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)',
                               'public.get_sms_usage(uuid)'] loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    if position('_restaurant_month(' in v_src) = 0 or position('cap_month = v_month' in v_src) = 0
       or position('date_trunc(' in v_src) > 0 or position('created_at >=' in v_src) > 0
       -- luna curentă pe ACEST restaurant, la now() — exact ca ștampila (TZ9/M31)
       or position('v_month := public._restaurant_month(p_restaurant_id, now());' in v_src) = 0 then
      raise exception 'mig 324: % nu numără pe luna ștampilată (cap_month)', v_sig;
    end if;
  end loop;
  -- fusul O SINGURĂ dată per apel, în variabilă — niciodată per rând
  foreach v_sig in array array['public._happy_hour_rules_at(uuid, timestamptz)',
                               'public._restaurant_month(uuid, timestamptz)'] loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    v_n := (length(v_src) - length(replace(v_src, 'restaurant_time_zone(', ''))) / length('restaurant_time_zone(');
    if v_n <> 1 or position('safe_time_zone(' in v_src) > 0 then
      raise exception 'mig 324: % cheamă fusul de % ori (așteptat o dată, în variabilă)', v_sig, v_n;
    end if;
  end loop;
  select prosrc into v_src from pg_proc where oid = 'public._happy_hour_rules_at(uuid, timestamptz)'::regprocedure;
  if position('restaurant_time_zone(' in v_src) > position('return query' in v_src) then
    raise exception 'mig 324: nucleul Happy Hour evaluează fusul în interogare (per rând)';
  end if;
  if position('new.cap_month := public._restaurant_month(new.restaurant_id, new.created_at)' in
       (select prosrc from pg_proc where oid = 'public.sms_queue_stamp_cap_month()'::regprocedure)) = 0 then
    raise exception 'mig 324: ștampila nu vine din _restaurant_month(restaurant_id, created_at)';
  end if;

  -- (d') ștampila: coloană NOT NULL + trigger BEFORE INSERT ROW (tgtype 7 EXACT —
  -- un `or update` = 23 ar RE-eticheta rândurile, adică exact ocolirea)
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.sms_queue'::regclass and attname = 'cap_month'
                    and atttypid = 'date'::regtype and attnotnull and not attisdropped) then
    raise exception 'mig 324: sms_queue.cap_month lipsește / nu e date NOT NULL';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.sms_queue'::regclass
                    and t.tgname = 'trg_sms_queue_stamp_cap_month'
                    and t.tgtype = 7 and t.tgenabled = 'O' and not t.tgisinternal
                    and t.tgfoid = 'public.sms_queue_stamp_cap_month()'::regprocedure) then
    raise exception 'mig 324: trg_sms_queue_stamp_cap_month lipsește / nu e BEFORE INSERT ROW (tgtype 7) activ';
  end if;

  -- (e) invariantele lanțurilor
  select prosrc into v_src from pg_proc where oid = 'public._happy_hour_rules_at(uuid, timestamptz)'::regprocedure;
  if position('when v_now_dow = 7 then 1 else v_now_dow + 1' in v_src) = 0
     or position('v_now_time <= r.ends_at' in v_src) = 0
     or position('r.ends_at < r.starts_at' in v_src) = 0
     or position('cardinality(r.days_of_week) = 0' in v_src) = 0
     or position('r.is_active = true' in v_src) = 0 then
    raise exception 'mig 324: nucleul Happy Hour a pierdut predicatul 036/077';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.public_happy_hour_now(uuid)'::regprocedure;
  if position('r.is_active = true' in v_src) = 0 or position('public.is_member(' in v_src) > 0
     or v_src ~* 'select\s+\*' then
    raise exception 'mig 324: public_happy_hour_now a pierdut filtrul pe restaurant activ / a primit is_member / proiectează select *';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.evaluate_happy_hour_for_now(uuid)'::regprocedure;
  if position('public.is_member(p_restaurant_id)' in v_src) = 0
     or position('Not a member of this restaurant' in v_src) = 0 then
    raise exception 'mig 324: evaluate_happy_hour_for_now a pierdut gate-ul is_member';
  end if;
  select prosrc into v_src from pg_proc
   where oid = 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)'::regprocedure;
  if position('is_module_enabled' in v_src) = 0 or position('restaurant_has_feature' in v_src) = 0
     or position('fn_sms_normalize_ro_phone' in v_src) = 0
     or position('on conflict (dedup_key) do nothing' in v_src) = 0
     or position('where r.id = p_restaurant_id for share;' in v_src) = 0
     or position($q$status <> 'cancelled'$q$ in v_src) = 0
     or v_src ~* '\mraise\M' then
    raise exception 'mig 324: enqueue_sms a pierdut un invariant 228 (gate-uri / dedup / zero raise) sau lacătul pe fus';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.get_sms_usage(uuid)'::regprocedure;
  if position('public.is_admin(p_restaurant_id)' in v_src) = 0
     or position('insufficient_privilege' in v_src) = 0
     or position($q$status <> 'cancelled'$q$ in v_src) = 0
     or position($q$'module_enabled'$q$ in v_src) = 0 or position($q$'plan_enabled'$q$ in v_src) = 0 then
    raise exception 'mig 324: get_sms_usage a pierdut un invariant 228';
  end if;
  -- consumatorii moșteniți cheamă în continuare învelișurile
  if position('public_happy_hour_now' in (select prosrc from pg_proc
        where oid = 'public._apply_happy_hour_auto()'::regprocedure)) = 0
     or position('public_happy_hour_now' in pg_get_functiondef('public.update_order_items(uuid, jsonb, numeric)'::regprocedure)) = 0
     or position('evaluate_happy_hour_for_now' in (select prosrc from pg_proc
        where oid = 'public.suggest_happy_hour_discount_for_order(uuid)'::regprocedure)) = 0 then
    raise exception 'mig 324: un consumator Happy Hour (trigger / update_order_items / suggest) nu mai cheamă învelișul';
  end if;

  -- (f) ACL: funcțiile preexistente neschimbate; contractul efectiv
  select string_agg(b.sig || ': ' || b.acl || ' → ' || a.acl, '; ') into v_bad
    from pg_temp.m324_acl_before b
    join lateral (
      select coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '<implicit>') as acl
        from pg_proc p where p.oid = b.oid) a on true
   where a.acl is distinct from b.acl;
  if v_bad is not null then
    raise exception 'mig 324: ACL schimbat pe funcții preexistente: %', v_bad;
  end if;
  if (select count(*) from pg_temp.m324_acl_before) <> 5 then
    raise exception 'mig 324: instantaneul ACL nu acoperă cele 5 funcții preexistente';
  end if;
  foreach v_sig in array c_helpers || array['public.safe_time_zone(text)'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_sig, 'execute') then
        raise exception 'mig 324: helperul % e executabil de %', v_sig, v_role;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = v_sig::regprocedure and a.grantee = 0) then
      raise exception 'mig 324: helperul % e executabil de PUBLIC', v_sig;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.public_happy_hour_now(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.public_happy_hour_now(uuid)', 'execute')
     or has_function_privilege('anon', 'public.evaluate_happy_hour_for_now(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.evaluate_happy_hour_for_now(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_sms_usage(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_sms_usage(uuid)', 'execute')
     or has_function_privilege('anon', 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or not has_function_privilege('service_role', 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute') then
    raise exception 'mig 324: contractul ACL al învelișurilor s-a schimbat';
  end if;
  -- (g) același proprietar: învelișurile (și create_reservation_public, 298)
  -- rulează ca el și cheamă helperii închiși — un proprietar diferit = 42501,
  -- TĂCUT pe calea triggerelor SMS.
  select count(distinct p.proowner) into v_n
    from pg_proc p
   where p.oid = any (array(select s::regprocedure::oid
                              from unnest(c_helpers || c_wrappers || array[
                                'public.safe_time_zone(text)',
                                'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)']) s));
  if v_n <> 1 then
    raise exception 'mig 324: helperii și învelișurile au % proprietari diferiți', v_n;
  end if;

  raise notice 'mig 324: Happy Hour + plafonul SMS (luna ștampilată) în fusul restaurantului OK';
end $$;

commit;
