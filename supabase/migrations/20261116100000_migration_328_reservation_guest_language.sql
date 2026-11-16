-- Migration 328: limba OASPETELUI se păstrează pe rezervare (lotul L8b)
--
-- Problema: oaspetele face rezervarea într-o limbă (meniul QR / /m/:slug /
-- /rezervare, 7 limbi), dar baza nu o reținea nicăieri — confirmarea SMS,
-- reminderul SMS și reminderul pe email plecau în limba de bază a LOCALULUI
-- (sau în română), adică un turist care a citit formularul în germană primea
-- „Rezervare confirmata”. Worker-ii noi (process-sms-queue.js,
-- process-email-queue.js) aleg limba în ordinea
--   reservations.guest_language → restaurants.language → 'ro'.
--
-- Ce face:
--   §1  `reservations.guest_language text` NULL, FĂRĂ default, CHECK pe cele 7
--       limbi ale meniului (aceeași listă ca CHECK-ul din 298 pe
--       `restaurants.language`, oglinda MENU_LANGS). NULL = necunoscută: toate
--       rezervările de dinainte, cele din panou și aprobările din panou.
--   §2  `create_reservation_public` primește `p_guest_language text default
--       null`, ULTIMUL. Lanț 151→199→201→241→273→(289, mecanic)→298→**328**:
--       corpul e copia VERBATIM a lui 298 (identic cu `pg_get_functiondef`-ul
--       viu de după 327, verificat prin diff pe replay) + normalizarea limbii +
--       coloana în INSERT. Normalizarea: subeticheta primară, lowercase
--       ('en-US' → 'en', 'DE' → 'de'), DOAR una din cele 7; orice altceva →
--       NULL. Suprafața e anonimă: o etichetă de limbă nu are voie să respingă
--       NICIODATĂ o rezervare (fără normalizare, 'en-US' ar fi lovit CHECK-ul).
--       Lookup-urile de idempotență NU rescriu limba: o retrimitere întoarce
--       rândul existent, cu limba primei cereri.
--       Semnătură NOUĂ → DROP pe cea veche + `create or replace` pe cea nouă
--       (tiparul 273): unicitatea (anti-PGRST203) vine din DROP, iar `or
--       replace` face fișierul re-rulabil. Parametrul e ULTIMUL și are default,
--       deci clientul vechi (11 / 10 argumente pe NUME) se potrivește în
--       continuare pe funcția nouă, iar clientul nou pe o bază fără 328 cade pe
--       PGRST202 și reîncearcă pe contractul 273, apoi pe cel vechi
--       (`createReservationPublic`, src/lib/reservations.ts).
--       Invariante păstrate (CLAUDE.md, asertate mai jos): p_table_id +
--       `table_unavailable` + `pg_advisory_xact_lock` (199), plafonul de
--       durată `least(...)` (151), gate-ul `is_module_enabled` (200),
--       wrap-around (201), ziua de SERVICIU (241), cele DOUĂ lookup-uri de
--       idempotență + backstop-ul care RE-ARUNCĂ (273), proiecția de 8 coloane
--       (273), 'expired' (289), `safe_time_zone` (298), DEFINER
--       `public, pg_temp`, EXECUTE pentru anon + authenticated, PUBLIC zero.
--   §3  `trg_sms_on_reservation_confirmed` (228→**328**, nicio redefinire
--       între ele): copie VERBATIM + `'guest_language'` la FINALUL
--       `template_data`. Restaurantul nu se adaugă: worker-ul citește
--       `sms_queue.restaurant_id` (coloana rândului, scrisă de `enqueue_sms`).
--       Neatinse: exception-wrapper-ul (un eșec de SMS NU avortează rezervarea,
--       SQ9), dedup-ul `sms_reservation_confirmed:<id>`, gate-urile din
--       `enqueue_sms` (324). Aceeași semnătură → `create or replace` (trigger-ul
--       nu se recreează, ACL-ul se păstrează; revocările sunt re-afirmate).
--   §4  `claim_reservation_reminders` (057→215→234→**328**): `guest_language`
--       la FINALUL `returns table` → DROP + CREATE (un `create or replace` nu
--       poate schimba tipul de retur). Corp VERBATIM 234: reclaim-ul 215 (doar
--       canalul email), AMBELE canale (email SAU mobil RO + modul + feature),
--       fereastra `reminder_hours_before`, `for update of r2 skip locked`.
--       EXECUTE doar service_role — revocat explicit și de la anon/
--       authenticated (default privileges din Supabase îl dau oricărei
--       funcții NOI).
--
-- Toleranță la ordinea de deploy: cheia nouă din `template_data` și coloana
-- nouă din claim sunt ignorate de un worker vechi; un worker nou pe o bază
-- fără 328 (cheie / coloană lipsă) alege limba localului, apoi româna —
-- exact ce pleca înainte.
--
-- Teste permanente: tests/sql/auto/328_reservation_guest_language.sql (GL1–GL7).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── §1. Coloana ──────────────────────────────────────────────────────────────
alter table public.reservations add column if not exists guest_language text;

alter table public.reservations drop constraint if exists reservations_guest_language_check;
alter table public.reservations add constraint reservations_guest_language_check
  check (guest_language is null
         or guest_language in ('ro', 'en', 'de', 'fr', 'it', 'hu', 'es'));

comment on column public.reservations.guest_language is
  'mig 328: limba în care oaspetele a făcut rezervarea publică (una din cele 7 ale meniului). NULL = necunoscută (panou, istoric) → mesajele către oaspete cad pe restaurants.language, apoi pe ro.';

-- ── §2. create_reservation_public, lanț …→273→(289)→298→328 ─────────────────
drop function if exists public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid
);

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
  p_idempotency_key uuid default null::uuid,
  p_guest_language text default null::text
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
  v_guest_lang      text;
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

  -- mig 328: limba OASPETELUI (cea în care a văzut formularul). Doar
  -- subeticheta primară ('en-US' → 'en'), DOAR una din cele 7 limbi ale
  -- meniului (CHECK-ul coloanei, oglinda MENU_LANGS); orice altceva → NULL.
  -- O etichetă de limbă nu are voie să respingă niciodată o rezervare.
  v_guest_lang := lower(substring(btrim(coalesce(p_guest_language, ''))
                                  from '^([A-Za-z]{2,3})(?:[-_].*)?$'));
  if v_guest_lang is not null
     and not (v_guest_lang = any (array['ro','en','de','fr','it','hu','es'])) then
    v_guest_lang := null;
  end if;

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
      requested_zone, idempotency_key,
      guest_language
    )
    values (
      v_restaurant_id, v_table_id,
      trim(coalesce(p_customer_name, '')), trim(coalesce(p_customer_phone, '')),
      nullif(trim(coalesce(p_customer_email, '')), ''),
      p_party_size,
      nullif(trim(coalesce(p_special_requests, '')), ''),
      p_starts_at, v_ends_at,
      v_status, 'public',
      v_zone, p_idempotency_key,
      v_guest_lang
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

revoke all on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid, text
) from public;
grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid, text
) to anon, authenticated;

-- ── §3. trg_sms_on_reservation_confirmed, lanț 228→328 ──────────────────────
create or replace function public.trg_sms_on_reservation_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text;
  v_phone text;
begin
  if (tg_op = 'INSERT' and new.status = 'confirmed')
     or (tg_op = 'UPDATE' and new.status = 'confirmed' and old.status is distinct from 'confirmed')
  then
    begin
      select name, phone into v_name, v_phone
        from public.restaurants where id = new.restaurant_id;
      perform public.enqueue_sms(
        new.restaurant_id,
        new.customer_phone,
        'reservation_confirmed',
        jsonb_build_object(
          'customer_name',     new.customer_name,
          'restaurant_name',   v_name,
          'restaurant_phone',  v_phone,
          'starts_at',         new.starts_at,
          'party_size',        new.party_size,
          'confirmation_code', new.confirmation_code,
          -- mig 328: limba oaspetelui (NULL = necunoscută → worker-ul cade pe
          -- limba de bază a localului, apoi pe română).
          'guest_language',    new.guest_language
        ),
        'sms_reservation_confirmed:' || new.id::text
      );
    exception when others then
      -- Un eșec de enqueue SMS NU are voie să avorteze rezervarea.
      raise warning 'sms enqueue rezervare % a esuat: %', new.id, sqlerrm;
    end;
  end if;
  return null; -- AFTER trigger
end;
$$;

-- Funcție de trigger: niciun rol client prin /rpc (RP13, mig 279).
revoke all on function public.trg_sms_on_reservation_confirmed()
  from public, anon, authenticated, service_role;

-- ── §4. claim_reservation_reminders, lanț 057→215→234→328 ───────────────────
drop function if exists public.claim_reservation_reminders(integer);

create function public.claim_reservation_reminders(
  p_batch_size integer default 100
)
returns table (
  id              uuid,
  restaurant_id   uuid,
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  starts_at       timestamptz,
  party_size      smallint,
  confirmation_code text,
  restaurant_name text,
  restaurant_phone text,
  guest_language  text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ── Reclaim (mig 215): rândurile revendicate-dar-neprocesate la un kill de
  -- proces. reminder_sent_at setat >15 min în urmă (un lot normal se termină în
  -- secunde), rezervarea încă validă pentru reminder, DAR emailul nu a ajuns în
  -- coadă → l-am pierdut; îl re-eliberăm. Sigur prin idempotența dedup_key.
  update public.reservations r
     set reminder_sent_at = null
   where r.reminder_sent_at is not null
     and r.reminder_sent_at < now() - interval '15 minutes'
     and r.status = 'confirmed'
     and r.customer_email is not null
     and r.starts_at > now()
     and not exists (
       select 1 from public.email_queue eq
        where eq.dedup_key = 'reservation_reminder:' || r.id::text
     );

  return query
  with claimed as (
    update public.reservations r
    set reminder_sent_at = now()
    where r.id in (
      select r2.id
      from public.reservations r2
      join public.reservation_settings s on s.restaurant_id = r2.restaurant_id
      where r2.status = 'confirmed'
        and r2.reminder_sent_at is null
        and (
          r2.customer_email is not null
          or (
            public.fn_sms_normalize_ro_phone(r2.customer_phone) is not null
            and public.is_module_enabled(r2.restaurant_id, 'sms_notifications')
            and public.restaurant_has_feature(r2.restaurant_id, 'sms_notifications')
          )
        )
        and r2.starts_at > now()
        and r2.starts_at <= now() + (s.reminder_hours_before || ' hours')::interval
      order by r2.starts_at asc
      limit p_batch_size
      for update of r2 skip locked
    )
    returning *
  )
  select
    c.id, c.restaurant_id,
    c.customer_name, c.customer_phone, c.customer_email,
    c.starts_at, c.party_size, c.confirmation_code,
    rest.name, rest.phone,
    c.guest_language
  from claimed c
  join public.restaurants rest on rest.id = c.restaurant_id;
end;
$$;

revoke all on function public.claim_reservation_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.claim_reservation_reminders(integer) to service_role;

-- ── §5. Asserții fail-closed ─────────────────────────────────────────────────
do $$
declare
  c_crp  constant text := 'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid,text)';
  v_crp  regprocedure;
  v_trg  regprocedure := 'public.trg_sms_on_reservation_confirmed()'::regprocedure;
  v_cl   regprocedure := 'public.claim_reservation_reminders(integer)'::regprocedure;
  v_def  text;
  v_cfg  text;
  v_tok  text;
  v_n    int;
  v_out  text[];
  v_con  text;
begin
  -- (a) coloana: NULL, fără default, CHECK pe exact cele 7 limbi
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'reservations'
                    and column_name = 'guest_language' and data_type = 'text'
                    and is_nullable = 'YES' and column_default is null) then
    raise exception 'mig 328: reservations.guest_language lipsește sau nu e text NULL fără default';
  end if;
  select pg_get_constraintdef(c.oid) into v_con
    from pg_constraint c
   where c.conrelid = 'public.reservations'::regclass
     and c.conname = 'reservations_guest_language_check';
  if v_con is null then
    raise exception 'mig 328: CHECK-ul pe guest_language lipsește';
  end if;
  foreach v_tok in array array['ro','en','de','fr','it','hu','es'] loop
    if position('''' || v_tok || '''' in v_con) = 0 then
      raise exception 'mig 328: CHECK-ul pe guest_language nu conține %: %', v_tok, v_con;
    end if;
  end loop;

  -- (b) create_reservation_public: EXACT o semnătură, cea nouă
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n <> 1 then
    raise exception 'mig 328: create_reservation_public are % semnături (așteptat 1) — PostgREST ar da PGRST203', v_n;
  end if;
  v_crp := to_regprocedure(c_crp);
  if v_crp is null then
    raise exception 'mig 328: semnătura nouă % lipsește', c_crp;
  end if;
  v_def := pg_get_functiondef(v_crp);
  foreach v_tok in array array[
    'p_guest_language text DEFAULT NULL::text)',   -- ULTIMUL, cu default
    'guest_language',                              -- coloana în INSERT
    'v_guest_lang',                                -- valoarea normalizată
    'p_idempotency_key',                           -- 273
    'unique_violation',                            -- backstop-ul de cursă (273)
    'raise;',                                      -- re-aruncarea violării STRĂINE (273)
    '- interval ''1 day''',                        -- ziua de serviciu (241)
    'close_time <= v_settings.open_time',          -- wrap-around (201)
    'p_table_id',                                  -- rezervare pe hartă (199)
    'table_unavailable',                           -- 199
    'is_module_enabled',                           -- gate-ul de modul (200)
    'least(',                                      -- plafonul de durată (151)
    'pg_advisory_xact_lock',                       -- serializarea per restaurant (199)
    '''expired''',                                 -- 289
    'safe_time_zone(v_tz)'                         -- 298
  ] loop
    if position(v_tok in v_def) = 0 then
      raise exception 'mig 328: create_reservation_public a pierdut „%”', v_tok;
    end if;
  end loop;
  if (length(v_def) - length(replace(v_def, 'r.idempotency_key = p_idempotency_key', '')))
     / length('r.idempotency_key = p_idempotency_key') < 3 then
    raise exception 'mig 328: lipsește un lookup de idempotență (așteptate 3: pre-validări, sub lacăt, backstop)';
  end if;
  if position('r.idempotency_key = p_idempotency_key'
              in substring(v_def from position('pg_advisory_xact_lock' in v_def))) = 0 then
    raise exception 'mig 328: nu mai există lookup de idempotență DUPĂ pg_advisory_xact_lock';
  end if;
  if position('r.idempotency_key = p_idempotency_key' in v_def)
     > position('(v_settings.min_advance_hours ||' in v_def)
     or position('(v_settings.min_advance_hours ||' in v_def) = 0 then
    raise exception 'mig 328: lookup-ul de idempotență nu mai stă ÎNAINTEA validărilor de setări';
  end if;
  if (select pronargs from pg_proc where oid = v_crp) <> 12
     or (select pronargdefaults from pg_proc where oid = v_crp) <> 7 then
    raise exception 'mig 328: semnătura nu are 12 argumente cu ultimele 7 opționale';
  end if;
  select array_agg(a order by o) into v_out
    from pg_proc p,
         unnest(p.proargnames, p.proargmodes) with ordinality as x(a, m, o)
   where p.oid = v_crp and m = 't';
  if v_out is distinct from array['reservation_id','confirmation_code','status','table_name',
                                  'starts_at','ends_at','requested_zone','party_size']::text[] then
    raise exception 'mig 328: proiecția RPC-ului s-a schimbat: %', v_out;
  end if;
  select array_to_string(p.proconfig, ',') into v_cfg from pg_proc p where p.oid = v_crp;
  if not (select prosecdef from pg_proc where oid = v_crp)
     or coalesce(v_cfg, '') not like '%search_path=public, pg_temp%' then
    raise exception 'mig 328: create_reservation_public și-a pierdut DEFINER/search_path (%)', v_cfg;
  end if;
  if not has_function_privilege('anon', v_crp, 'EXECUTE')
     or not has_function_privilege('authenticated', v_crp, 'EXECUTE') then
    raise exception 'mig 328: create_reservation_public și-a pierdut grant-ul anon/authenticated';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = v_crp and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'mig 328: PUBLIC are EXECUTE pe create_reservation_public';
  end if;

  -- (c) trigger-ul SMS: cheia nouă + invariantele 228
  v_def := pg_get_functiondef(v_trg);
  if position('''guest_language'',    new.guest_language' in v_def) = 0 then
    raise exception 'mig 328: trg_sms_on_reservation_confirmed nu pune guest_language în template_data';
  end if;
  if v_def !~* 'exception\s+when\s+others' or v_def !~* 'raise\s+warning' then
    raise exception 'mig 328: trigger-ul SMS nu mai e exception-wrapped (un eșec de SMS ar avorta rezervarea)';
  end if;
  if position('''sms_reservation_confirmed:'' || new.id::text' in v_def) = 0 then
    raise exception 'mig 328: trigger-ul SMS și-a pierdut dedup_key-ul';
  end if;
  select array_to_string(p.proconfig, ',') into v_cfg from pg_proc p where p.oid = v_trg;
  if not (select prosecdef from pg_proc where oid = v_trg)
     or coalesce(v_cfg, '') not like '%search_path=public, pg_temp%' then
    raise exception 'mig 328: trigger-ul SMS și-a pierdut DEFINER/search_path (%)', v_cfg;
  end if;
  if has_function_privilege('anon', v_trg, 'EXECUTE')
     or has_function_privilege('authenticated', v_trg, 'EXECUTE') then
    raise exception 'mig 328: funcția de trigger SMS e apelabilă prin /rpc (RP13)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgname = 'trg_sms_reservation_confirmed'
                    and t.tgrelid = 'public.reservations'::regclass
                    and t.tgfoid = v_trg::oid and not t.tgisinternal) then
    raise exception 'mig 328: trigger-ul trg_sms_reservation_confirmed lipsește sau nu mai cheamă funcția';
  end if;

  -- (d) claim-ul: guest_language la FINAL + invariantele 215/234
  select array_agg(a order by o) into v_out
    from pg_proc p,
         unnest(p.proargnames, p.proargmodes) with ordinality as x(a, m, o)
   where p.oid = v_cl and m = 't';
  if v_out is distinct from array['id','restaurant_id','customer_name','customer_phone','customer_email',
                                  'starts_at','party_size','confirmation_code','restaurant_name',
                                  'restaurant_phone','guest_language']::text[] then
    raise exception 'mig 328: coloanele claim_reservation_reminders = % (guest_language trebuie să fie ULTIMA)', v_out;
  end if;
  v_def := pg_get_functiondef(v_cl);
  foreach v_tok in array array[
    'interval ''15 minutes''',              -- reclaim-ul 215
    'eq.dedup_key = ''reservation_reminder:'' || r.id::text',
    'customer_email is not null',           -- canalul email
    'fn_sms_normalize_ro_phone',            -- canalul SMS (234)
    'sms_notifications',
    'reminder_hours_before',                -- fereastra
    'for update of r2 skip locked'
  ] loop
    if position(v_tok in v_def) = 0 then
      raise exception 'mig 328: claim_reservation_reminders a pierdut „%”', v_tok;
    end if;
  end loop;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_reservation_reminders';
  if v_n <> 1 then
    raise exception 'mig 328: % semnături claim_reservation_reminders', v_n;
  end if;
  select array_to_string(p.proconfig, ',') into v_cfg from pg_proc p where p.oid = v_cl;
  if not (select prosecdef from pg_proc where oid = v_cl)
     or coalesce(v_cfg, '') not like '%search_path=public, pg_temp%' then
    raise exception 'mig 328: claim-ul și-a pierdut DEFINER/search_path (%)', v_cfg;
  end if;
  if has_function_privilege('anon', v_cl, 'EXECUTE')
     or has_function_privilege('authenticated', v_cl, 'EXECUTE')
     or not has_function_privilege('service_role', v_cl, 'EXECUTE') then
    raise exception 'mig 328: claim_reservation_reminders are alt ACL decât service_role-only';
  end if;

  raise notice 'mig 328: guest_language pe rezervare, în confirmarea SMS și în claim-ul de remindere; invariantele păstrate';
end $$;

commit;
