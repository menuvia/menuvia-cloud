-- migration_273_reservation_idempotency.sql
-- =============================================================================
-- Audit v3 — RES-29: rezervarea publică nu are cheie de idempotență.
--
-- `create_reservation_public` (lanț 151→199→201→241) inserează necondiționat.
-- Clientul o cheamă din `ReservationSheet` pe un telefon, pe rețea mobilă: o
-- retrimitere (dublu-tap pe „Rezervă", revenire cu Back, reîncărcare după ce
-- răspunsul s-a pierdut pe drum) creează a DOUA rezervare — aceeași persoană,
-- același interval, două mese blocate, două emailuri către local și, pe
-- `auto_confirm`, două SMS-uri de confirmare către client. Localul vede o
-- „dublă rezervare" pe care nimeni nu a făcut-o intenționat, iar clientul nu are
-- de unde ști că trebuie să anuleze una.
--
-- Exact aceeași clasă a fost deja închisă pe comenzi: QR (`createOrder` +
-- `rotateIdempotencyKey`, mig 090 + QrMenuPage) și PICKUP (`getPickupIdempotencyKey`,
-- audit v3 FC-01). Rezervările rămăseseră singura scriere publică fără cheie.
--
-- SOLUȚIA, în ordinea garanțiilor (de la cea mai slabă la cea mai tare):
--   1. `reservations.idempotency_key uuid` + INDEX UNIC PARȚIAL pe
--      (restaurant_id, idempotency_key) WHERE not null. Indexul e garanția REALĂ:
--      nu depinde de cod, de ordinea instrucțiunilor sau de noroc.
--      Parțial, ca rândurile vechi și cele din dashboard (fără cheie) să nu se
--      ciocnească între ele — NULL nu intră în indexul unic oricum, dar filtrul
--      îl ține și mic.
--   2. LOOKUP devreme în RPC: dacă (restaurant, cheie) există deja, se întoarce
--      rândul EXISTENT și funcția se oprește. Lookup-ul stă ÎNAINTEA validărilor
--      de setări (fereastră de program, `min_advance_hours`, `max_party_size`) —
--      altfel o retrimitere la 30 de secunde distanță ar putea PICA pe
--      „rezervările se fac cu minim N ore înainte", deși rezervarea există deja.
--      Retrimiterea trebuie să întoarcă ce s-a creat, nu o eroare.
--   3. BACKSTOP pe `unique_violation` în jurul INSERT-ului: două cereri identice
--      simultane trec amândouă de lookup (niciuna nu vede încă rândul celeilalte),
--      amândouă alocă masa, dar doar una inserează. A doua primește violarea de
--      unicitate, re-citește rândul câștigător și îl întoarce. Dacă violarea NU e
--      a cheii noastre (ex. `confirmation_code`), se RE-ARUNCĂ — un handler care
--      înghite orice unique_violation ar transforma o coliziune de cod de
--      confirmare într-un răspuns fals „a mers".
--
-- CE NU SE ÎNTÂMPLĂ PE CALEA IDEMPOTENTĂ, și de ce e automat: emailul către local
-- (`trg_email_reservation_created`, AFTER INSERT), SMS-ul de confirmare
-- (`trg_sms_reservation_confirmed`, AFTER INSERT OR UPDATE) și plafonul anti-abuz
-- (`reservations_public_rate_limit`, BEFORE INSERT) sunt TOATE triggere pe INSERT.
-- Fără insert nu se declanșează niciunul: retrimiterea nu retrimite emailul, nu
-- retrimite SMS-ul și nu consumă din plafon. Nu e nimic de scris pentru asta —
-- dar e o proprietate pe care o verifică RI4/RI5, ca o mutare viitoare a vreunui
-- trigger pe UPDATE să nu o strice tăcut.
--
-- SEMNĂTURĂ NOUĂ → DROP-ul semnăturii VECHI e OBLIGATORIU. Doar un
-- `create or replace` cu un parametru în plus lasă AMBELE semnături în catalog,
-- iar PostgREST răspunde
-- PGRST203 („could not choose the best candidate function") la ORICE apel —
-- exact ce a pățit `register_affiliate` în mig 243. Parametrul nou e ULTIMUL și
-- are default, deci apelurile vechi (pozitionale sau cu nume) rămân valide:
-- clientul se poate deploya înainte SAU după migrație. Crearea semnăturii NOI e
-- `or replace`, ca migrația să fie re-rulabilă (un `create` simplu pică cu
-- „already exists" la a doua rulare); unicitatea e asigurată de DROP-ul de
-- deasupra, nu de forma lui create — asserția (a) o verifică oricum.
--
-- Lanț `create_reservation_public`: 151→199→201→241→**273**. Corpul e copie
-- VERBATIM din 241 (10 argumente cu `p_table_id`, plafonul de durată `least(...)`,
-- gate-ul `is_module_enabled('reservations')`, wrap-around peste miezul nopții,
-- ziua de SERVICIU) + cele trei adăugiri de mai sus. Orice recreare viitoare
-- pornește de AICI.
--
-- DE CE ÎNTOARCE ȘI `party_size`: ecranul de confirmare afișa starea
-- FORMULARULUI (data, ora, numărul de persoane tastate acum). Cât timp fiecare
-- apel crea o rezervare nouă, cele două coincideau întotdeauna. Cu idempotență
-- NU mai coincid: dacă răspunsul primei cereri s-a pierdut pe drum și clientul
-- schimbă ora și retrimite, serverul întoarce — corect — rezervarea DEJA
-- existentă, cu intervalul ei. Un ecran care ar arăta ora tastată acum ar minți
-- despre o rezervare reală. Tot ce se afișează vine acum din RÂNDUL serverului,
-- deci proiecția trebuie să poarte și numărul de persoane.
--
-- Teste permanente RI1–RI8: tests/sql/reservation_idempotency_assertions.sql
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Coloana + indexul unic parțial (garanția care nu depinde de cod) ──────
alter table public.reservations
  add column if not exists idempotency_key uuid;

comment on column public.reservations.idempotency_key is
  'mig 273: cheie de idempotență trimisă de client la rezervarea publică. Unică per restaurant (index parțial). NULL pe rezervările din dashboard și pe tot istoricul dinaintea migrației.';

create unique index if not exists reservations_restaurant_idempotency_key_uidx
  on public.reservations (restaurant_id, idempotency_key)
  where idempotency_key is not null;

-- ── 2. RPC-ul, lanț 151→199→201→241→273 ─────────────────────────────────────
drop function if exists public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid
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

  select id into v_restaurant_id
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

  v_local_time := (p_starts_at at time zone 'Europe/Bucharest')::time;
  -- Ziua de SERVICIU (mig 241): pe program peste miezul nopții (close <= open),
  -- un slot din fereastra [00:00, close) aparține serviciului zilei PRECEDENTE
  -- (ex. 01:00 dintr-un 18:00–02:00 = serviciul de sâmbătă, nu duminică).
  if v_settings.close_time <= v_settings.open_time and v_local_time < v_settings.close_time then
    v_dow := extract(isodow from (p_starts_at at time zone 'Europe/Bucharest') - interval '1 day')::smallint;
  else
    v_dow := extract(isodow from p_starts_at at time zone 'Europe/Bucharest')::smallint;
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
          and r.status not in ('cancelled','no_show')
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
          and r.status not in ('cancelled','no_show')
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

revoke all on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid
) from public;
grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid
) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_sig text;
  v_n   int;
  v_idx text;
begin
  -- (a) EXACT o semnătură (un `create or replace` ar fi lăsat două → PGRST203)
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n <> 1 then
    raise exception 'mig 273: create_reservation_public are % semnături (așteptat 1) — PostgREST ar da PGRST203', v_n;
  end if;

  -- (b) coloana + indexul unic PARȚIAL (garanția reală, independentă de cod)
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='reservations'
                    and column_name='idempotency_key') then
    raise exception 'mig 273: reservations.idempotency_key lipsește'; end if;
  select pg_get_indexdef(i.indexrelid) into v_idx
    from pg_index i
   where i.indrelid = 'public.reservations'::regclass
     and i.indexrelid = 'public.reservations_restaurant_idempotency_key_uidx'::regclass;
  if v_idx is null then
    raise exception 'mig 273: indexul de idempotență lipsește'; end if;
  if position('UNIQUE' in upper(v_idx)) = 0 then
    raise exception 'mig 273: indexul de idempotență NU e unic — garanția dispare: %', v_idx; end if;
  if position('restaurant_id' in v_idx) = 0 or position('idempotency_key' in v_idx) = 0 then
    raise exception 'mig 273: indexul nu e pe (restaurant_id, idempotency_key): %', v_idx; end if;
  if position('WHERE' in upper(v_idx)) = 0 then
    raise exception 'mig 273: indexul nu mai e parțial (fără WHERE ... is not null): %', v_idx; end if;

  -- (c) corpul: parametrul, lookup-ul, backstop-ul + TOT lanțul moștenit
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  foreach v_sig in array array[
    'p_idempotency_key',                      -- parametrul nou
    'unique_violation',                       -- backstop-ul de cursă
    'raise;',                                 -- re-aruncarea violării STRĂINE
    '- interval ''1 day''',                   -- ziua de serviciu (241)
    'close_time <= v_settings.open_time',     -- wrap-around (201)
    'p_table_id',                             -- rezervare pe hartă (199)
    'is_module_enabled',                      -- gate-ul de modul (200)
    'least(',                                 -- plafonul de durată (151)
    'pg_advisory_xact_lock'                   -- serializarea per restaurant (199)
  ] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 273: create_reservation_public a pierdut „%"', v_sig; end if;
  end loop;

  -- (d2) DOUĂ lookup-uri: unul înaintea validărilor (retrimitere secvențială) și
  --      unul SUB lacăt (cursa concurentă pe ramura cu masă aleasă)
  if (length(v_src) - length(replace(v_src, 'r.idempotency_key = p_idempotency_key', ''))) 
     / length('r.idempotency_key = p_idempotency_key') < 3 then
    raise exception 'mig 273: lipsește un lookup de idempotență (așteptate 3: pre-validări, sub lacăt, backstop)';
  end if;
  if position('r.idempotency_key = p_idempotency_key' in substring(v_src from position('pg_advisory_xact_lock' in v_src))) = 0 then
    raise exception 'mig 273: nu există lookup de idempotență DUPĂ pg_advisory_xact_lock — cursa concurentă pe ramura cu masă aleasă ar ieși cu table_unavailable';
  end if;

  -- (d) lookup-ul stă ÎNAINTEA validărilor de setări: o retrimitere nu are voie
  --     să pice pe plafonul de avans, care devine adevărat cu trecerea timpului.
  --     Ancora e EXPRESIA din cod, nu numele coloanei: un comentariu care
  --     pomenește coloana ar deplasa prima potrivire și ar face verificarea să
  --     măsoare altceva decât crede (prins exact așa la prima rulare).
  if position('r.idempotency_key = p_idempotency_key' in v_src)
     > position('(v_settings.min_advance_hours ||' in v_src) then
    raise exception 'mig 273: lookup-ul de idempotență e DUPĂ validările de setări — o retrimitere ar pica pe plafonul de avans';
  end if;
  if position('(v_settings.min_advance_hours ||' in v_src) = 0 then
    raise exception 'mig 273: ancora validării de avans nu mai există — verificarea de ordine ar fi vacuă';
  end if;

  -- (e) suprafață: anon + authenticated, PUBLIC zero
  if not has_function_privilege('anon', 'public.create_reservation_public(text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid)', 'EXECUTE') then
    raise exception 'mig 273: anon nu mai poate chema create_reservation_public'; end if;
  if not has_function_privilege('authenticated', 'public.create_reservation_public(text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid)', 'EXECUTE') then
    raise exception 'mig 273: authenticated nu mai poate chema create_reservation_public'; end if;

  raise notice 'mig 273: idempotență la rezervarea publică (coloană + index unic parțial + lookup + backstop) OK';
end $$;

commit;
