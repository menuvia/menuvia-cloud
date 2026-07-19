-- mig 241 — create_reservation_public: ziua de SERVICIU pe program peste miezul nopții
-- ─────────────────────────────────────────────────────────────────────
-- Bug (re-audit săpt. 10): mig 201 verifică open_days pe isodow-ul instantului
-- p_starts_at. Pentru un program peste miezul nopții (close_time <= open_time,
-- ex. 18:00–02:00), un slot de 01:00 e afișat de frontend ca instant al zilei
-- URMĂTOARE (duminică 01:00), dar aparține serviciului zilei PRECEDENTE
-- (sâmbătă). isodow=7 nu e în open_days={5,6} → 'nu acceptă rezervări în această
-- zi', deși e serviciul de sâmbătă. TOATE sloturile post-miezul-nopții ale
-- ultimei zile de program sunt fals respinse — exact segmentul (localuri de
-- noapte) pentru care wrap-around-ul din mig 201 a fost construit.
--
-- Fix: calculăm ZIUA DE SERVICIU — dacă programul e wrap-around ȘI ora locală e
-- în fereastra [00:00, close), ziua de serviciu = ziua PRECEDENTĂ. Restul
-- funcției (lanț 151→199→201→241) e IDENTIC: gate modul, plafon durată, branch
-- p_table_id race-safe (mig 199), logica wrap-around pe fereastra de timp.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

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
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='create_reservation_public';
  if v_src is null then raise exception 'mig 241: create_reservation_public lipsește'; end if;
  -- ziua de serviciu (mig 241): scădere de o zi pe wrap-around
  if position('- interval ''1 day''' in v_src) = 0 then
    raise exception 'mig 241: calculul zilei de serviciu (‑1 zi pe wrap-around) lipsește';
  end if;
  -- garanțiile păstrate din lanț
  if position('close_time <= v_settings.open_time' in v_src) = 0 then
    raise exception 'mig 241: logica wrap-around (close <= open) s-a pierdut';
  end if;
  if position('p_table_id' in v_src) = 0 then raise exception 'mig 241: p_table_id lipsește'; end if;
  if position('is_module_enabled' in v_src) = 0 then raise exception 'mig 241: gate-ul de modul lipsește'; end if;
  raise notice 'mig 241: create_reservation_public ziua de serviciu (wrap-around) OK';
end $$;

commit;
