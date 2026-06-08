-- Migration 075: rezervări high-quality — preferință zonă persistată, index pe slug,
-- semantica fără-masă consistentă
-- ─────────────────────────────────────────────────────────────────────
-- 3 îmbunătățiri ridicate de code review pe efort înalt:
--
-- 1) `requested_zone` pe reservations — păstrează zona cerută de client
--    chiar dacă alocarea automată a eșuat. Ospătarul vede preferința
--    când alocă manual la sosire (înainte se pierdea silent).
--
-- 2) Index funcțional pe `lower(slug)` — mig 074 face
--    `where lower(slug)=lower(p_slug)` care anula indexul UNIQUE pe slug
--    (seq scan). Adăugăm INDEX expresional ca să fie O(log n) cu zeci de
--    mii de restaurante.
--
-- 3) Rescrie create_reservation_public:
--    - persistă p_zone în requested_zone (chiar și când alocă masă),
--    - returnează requested_zone în payload (UI public + waiter dashboard).

-- ── 1. Coloană requested_zone ─────────────────────────────────
alter table public.reservations
  add column if not exists requested_zone text;

comment on column public.reservations.requested_zone is
  $$Zona preferată de client la momentul rezervării. Persistă chiar
  dacă alocarea automată nu a găsit masă în zonă — ospătarul vede
  intenția când alocă manual.$$;

-- ── 2. Index pe lower(slug) ───────────────────────────────────
-- Slug e deja UNIQUE (case-sensitive); indexul de mai jos servește
-- lookup-ul case-insensitive din create_reservation_public.
create index if not exists restaurants_lower_slug_idx
  on public.restaurants (lower(slug));

-- ── 3. Rescrie create_reservation_public ─────────────────────
-- DROP necesar fiindcă RETURNS TABLE primește o coloană nouă
-- (requested_zone) → Postgres refuză CREATE OR REPLACE când shape-ul
-- de return se schimbă: ERROR 42P13. Drop + create curat.
drop function if exists public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text
);

create function public.create_reservation_public(
  p_slug             text,
  p_customer_name    text,
  p_customer_phone   text,
  p_party_size       smallint,
  p_starts_at        timestamptz,
  p_customer_email   text default null,
  p_special_requests text default null,
  p_duration_minutes smallint default null,
  p_zone             text default null
)
returns table (
  reservation_id    uuid,
  confirmation_code text,
  status            text,
  table_name        text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  requested_zone    text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Slug case-insensitive (folosește restaurants_lower_slug_idx)
  select id into v_restaurant_id
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    raise exception 'Restaurantul nu a fost găsit';
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

  v_duration := coalesce(p_duration_minutes, v_settings.reservation_duration);
  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  perform pg_advisory_xact_lock(hashtext('reservation:' || v_restaurant_id::text));

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

  if v_table_id is null then
    v_status := 'pending';
    v_table_name := null;
  else
    v_status := case when v_settings.auto_confirm then 'confirmed' else 'pending' end;
  end if;

  -- INSERT — persistă requested_zone independent de alocarea reușită
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
$$;

-- Re-aplicăm grant-urile (DROP-ul anterior le-a șters; defaulturile noi
-- create de o funcție includ EXECUTE pentru public, deci revoke-ul e
-- esențial pentru securitate).
revoke all on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text
) from public;
grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text
) to anon, authenticated;
