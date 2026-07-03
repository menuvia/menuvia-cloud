-- mig 199 — Rezervare cu alegerea mesei pe HARTĂ (Val B #6, „ca la cinema")
-- ─────────────────────────────────────────────────────────────────────
-- Backend pentru selecția vizuală a mesei la rezervare. Trei RPC-uri publice:
--   1. get_public_floor_plan(slug)            — planul sălii + mesele (read-only)
--   2. get_tables_availability(slug, slot)    — TOATE mesele active + is_available
--   3. create_reservation_public(+ p_table_id)— rezervă masa ALEASĂ (race-safe)
--
-- Convenția lockdown: SECURITY DEFINER, search_path = public, pg_temp, revoke
-- PUBLIC, grant anon+authenticated. `create_reservation_public` e recreat
-- VERBATIM din mig 151 (plafon durată + no-table-fallback mig 074 + gate modul
-- + overlap), cu O SINGURĂ deltă: un p_table_id opțional care, dat, validează
-- și rezervă masa aleasă sub advisory lock (altfel comportamentul existent de
-- auto-alocare rămâne intact — backward compatible).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. get_public_floor_plan(p_slug) ────────────────────────────────
-- Întoarce planul sălii (jsonb `floor_layout`) + lista de mese (id/name/seats/
-- zone/is_active) ca clientul să randeze harta și să rezolve maparea
-- element-hartă → tables.id (prin tableId sau nume). Null floor_plan dacă
-- restaurantul n-a desenat un plan. Doar SELECT — zero mutații.
create or replace function public.get_public_floor_plan(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_restaurant_id uuid;
  v_layout        jsonb;
  v_tables        jsonb;
begin
  select id, floor_layout into v_restaurant_id, v_layout
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', t.id, 'name', t.name, 'seats', t.seats, 'zone', t.zone
           ) order by t.name
         ), '[]'::jsonb)
    into v_tables
  from public.tables t
  where t.restaurant_id = v_restaurant_id and t.is_active = true;

  return jsonb_build_object(
    'floor_layout', v_layout,          -- poate fi null dacă nu s-a desenat plan
    'tables',       v_tables
  );
end;
$$;

revoke all on function public.get_public_floor_plan(text) from public;
grant execute on function public.get_public_floor_plan(text) to anon, authenticated;

-- ── 2. get_tables_availability(p_slug, p_starts_at, p_ends_at, p_party_size) ──
-- Ca check_availability, dar întoarce TOATE mesele active (nu doar libere) +
-- flag `is_available` la slot — necesar pentru harta „ca la cinema" (verzi =
-- libere, gri = ocupate). Reutilizează exact logica de overlap.
create or replace function public.get_tables_availability(
  p_slug       text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_party_size smallint default 1
)
returns table (
  table_id     uuid,
  table_name   text,
  seats        smallint,
  zone         text,
  is_available boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_restaurant_id uuid;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'ends_at trebuie să fie după starts_at';
  end if;

  select id into v_restaurant_id
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    raise exception 'Restaurantul nu a fost găsit';
  end if;

  return query
  select
    t.id, t.name, t.seats, t.zone,
    -- liberă = încape party-ul ȘI nu se suprapune nicio rezervare vie pe slot
    (t.seats is not null
     and t.seats >= greatest(p_party_size, 1)
     and not exists (
       select 1 from public.reservations r
       where r.restaurant_id = v_restaurant_id
         and r.table_id = t.id
         and r.status not in ('cancelled','no_show')
         and (r.starts_at, r.ends_at) overlaps (p_starts_at, p_ends_at)
     )) as is_available
  from public.tables t
  where t.restaurant_id = v_restaurant_id
    and t.is_active = true
  order by t.name;
end;
$$;

revoke all on function public.get_tables_availability(text, timestamptz, timestamptz, smallint) from public;
grant execute on function public.get_tables_availability(text, timestamptz, timestamptz, smallint)
  to anon, authenticated;

-- ── 3. create_reservation_public + p_table_id ───────────────────────
-- Recreat VERBATIM din mig 151, cu adăugarea p_table_id (default null). DROP +
-- CREATE fiindcă semnătura se schimbă (9 → 10 arg). Cu p_table_id null →
-- comportament identic (auto-alocare). Cu p_table_id → validează + rezervă masa
-- aleasă sub advisory lock (race-safe: două cereri simultane pe aceeași masă →
-- a doua primește eroarea „masa tocmai a fost rezervată").
drop function if exists public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text
);

create function public.create_reservation_public(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_party_size smallint,
  p_starts_at timestamp with time zone,
  p_customer_email text default null::text,
  p_special_requests text default null::text,
  p_duration_minutes smallint default null::smallint,
  p_zone text default null::text,
  p_table_id uuid default null::uuid
)
returns table(
  reservation_id uuid,
  confirmation_code text,
  status text,
  table_name text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  requested_zone text
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

  -- ★ Gate D: modulul Reservations trebuie să fie activat ★
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

  v_dow := extract(isodow from p_starts_at at time zone 'Europe/Bucharest')::smallint;
  if not (v_dow = any (v_settings.open_days)) then
    raise exception 'Restaurantul nu acceptă rezervări în această zi';
  end if;
  v_local_time := (p_starts_at at time zone 'Europe/Bucharest')::time;
  if v_local_time < v_settings.open_time or v_local_time >= v_settings.close_time then
    raise exception 'Ora aleasă este în afara programului (% - %)',
      to_char(v_settings.open_time, 'HH24:MI'),
      to_char(v_settings.close_time, 'HH24:MI');
  end if;

  -- #12 (mig 151): plafon durată efectivă în [1, reservation_duration].
  v_duration := least(
                  greatest(coalesce(p_duration_minutes, v_settings.reservation_duration), 1),
                  v_settings.reservation_duration
                );
  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  perform pg_advisory_xact_lock(hashtext('reservation:' || v_restaurant_id::text));

  if p_table_id is not null then
    -- ★ Clientul a ales o masă anume de pe hartă. Validăm sub lock (race-safe):
    -- masa e a restaurantului, activă, încape party-ul și e liberă pe slot.
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
    -- Auto-alocare (comportamentul existent): cea mai mică masă liberă care încape.
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

  insert into public.reservations as r (
    restaurant_id, table_id,
    customer_name, customer_phone, customer_email,
    party_size, special_requests,
    starts_at, ends_at,
    status, source,
    requested_zone
  )
  values (
    v_restaurant_id, v_table_id,
    trim(coalesce(p_customer_name, '')), trim(coalesce(p_customer_phone, '')),
    nullif(trim(coalesce(p_customer_email, '')), ''),
    p_party_size,
    nullif(trim(coalesce(p_special_requests, '')), ''),
    p_starts_at, v_ends_at,
    v_status, 'public',
    v_zone
  )
  returning r.id, r.confirmation_code into v_new_id, v_new_code;

  return query select
    v_new_id, v_new_code, v_status,
    v_table_name, p_starts_at, v_ends_at,
    v_zone;
end;
$function$;

grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text, uuid
) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_src text;
begin
  -- Cele 3 RPC-uri există + sunt granted lui anon.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='get_public_floor_plan') then
    raise exception 'mig 199: get_public_floor_plan lipsește';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='get_tables_availability') then
    raise exception 'mig 199: get_tables_availability lipsește';
  end if;

  -- create_reservation_public: noua semnătură (10 arg, cu p_table_id) + guard-ul
  -- de durată (mig 151) + branch-ul de masă aleasă NU s-au pierdut.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='create_reservation_public';
  if v_src is null then
    raise exception 'mig 199: create_reservation_public lipsește';
  end if;
  if position('p_table_id' in v_src) = 0 then
    raise exception 'mig 199: p_table_id lipsește din create_reservation_public';
  end if;
  if position('least(' in v_src) = 0 or position('reservation_duration' in v_src) = 0 then
    raise exception 'mig 199: plafonul de durată (mig 151) s-a pierdut';
  end if;
  if position('is_module_enabled' in v_src) = 0 then
    raise exception 'mig 199: gate-ul de modul s-a pierdut';
  end if;
  if position('table_unavailable' in v_src) = 0 then
    raise exception 'mig 199: validarea race-safe a mesei alese lipsește';
  end if;

  -- anon are EXECUTE pe noile RPC-uri publice.
  if not has_function_privilege('anon',
       'public.get_tables_availability(text, timestamptz, timestamptz, smallint)', 'EXECUTE') then
    raise exception 'mig 199: anon nu are EXECUTE pe get_tables_availability';
  end if;

  raise notice 'mig 199: rezervare cu hartă OK (floor plan + disponibilitate + p_table_id race-safe)';
end $$;

commit;
