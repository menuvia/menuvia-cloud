-- ═══════════════════════════════════════════════════════════════
-- Migration 058 — Zone pe mese + filtru pe RPC-urile publice
-- ═══════════════════════════════════════════════════════════════
-- Adaugă:
--   • Coloana `zone` pe `tables` (free-text, opțional)
--   • Extinde `check_availability` cu p_zone
--   • Extinde `create_reservation_public` cu p_zone
--
-- Filtru frecvent în restaurante: "Terasa" vs "Interior". Pentru a evita
-- enum-uri rigide, zone e text liber — dashboard-ul va sugera valorile
-- existente per restaurant. NU stocăm zone pe `reservations` (relația
-- via table_id → tables.zone e suficientă; agregările sunt rare).
--
-- Compatibilitate: semnătura RPC se schimbă (DROP + CREATE pentru
-- create_reservation_public). Pentru că niciun client nu consumă încă
-- aceste RPC-uri (introduse în 057, UI livrat în acest sprint), e safe.
-- ═══════════════════════════════════════════════════════════════

-- ── 0. RLS public read pe reservation_settings ─────────────────
-- Sheet-ul public are nevoie de open_time, close_time, slot_interval, etc.
-- ca să afișeze corect slot-urile. Câmpurile sunt non-sensibile (program +
-- limite operaționale, deja vizibile pe meniul restaurantului). NU expune
-- `auto_confirm` sau `reminder_hours_before` ca decizie — dar select-ul
-- e doar pentru afișare; logica autoritativă rămâne în RPC server-side.
drop policy if exists reservation_settings_public_read on public.reservation_settings;
create policy reservation_settings_public_read on public.reservation_settings
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = reservation_settings.restaurant_id
        and r.is_active = true
    )
  );

-- ── 1. Coloana `zone` pe `tables` ──────────────────────────────
alter table public.tables
  add column if not exists zone text;
comment on column public.tables.zone is
  'Etichetă opțională pentru gruparea meselor (ex: Terasa, Interior, Bar). Free-text per restaurant.';

-- Trim white-space la insert/update pentru a evita duplicate accidentale
-- ('Terasa' vs 'Terasa ').
create or replace function public.tables_normalize_zone()
returns trigger
language plpgsql
as $$
begin
  if new.zone is not null then
    new.zone := nullif(trim(new.zone), '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tables_normalize_zone on public.tables;
create trigger trg_tables_normalize_zone
  before insert or update of zone on public.tables
  for each row execute function public.tables_normalize_zone();

-- ── 2. Extinde check_availability cu p_zone ────────────────────
-- RETURN TABLE adaugă coloana `zone`, deci CREATE OR REPLACE nu e suficient.
drop function if exists public.check_availability(uuid, timestamptz, timestamptz, smallint);
create function public.check_availability(
  p_restaurant_id uuid,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_party_size    smallint,
  p_zone          text default null
)
returns table (
  table_id   uuid,
  table_name text,
  seats      smallint,
  zone       text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if p_ends_at <= p_starts_at then
    raise exception 'ends_at trebuie să fie după starts_at';
  end if;
  if p_party_size <= 0 then
    raise exception 'party_size trebuie > 0';
  end if;

  return query
  select t.id, t.name, t.seats, t.zone
  from public.tables t
  where t.restaurant_id = p_restaurant_id
    and t.is_active = true
    and t.seats is not null
    and t.seats >= p_party_size
    and (p_zone is null or t.zone = p_zone)
    and not exists (
      select 1
      from public.reservations r
      where r.restaurant_id = p_restaurant_id
        and r.table_id = t.id
        and r.status not in ('cancelled','no_show')
        and (r.starts_at, r.ends_at) overlaps (p_starts_at, p_ends_at)
    )
  order by t.seats asc, t.name asc;
end;
$$;

revoke all on function public.check_availability(uuid, timestamptz, timestamptz, smallint, text) from public;
grant execute on function public.check_availability(uuid, timestamptz, timestamptz, smallint, text)
  to anon, authenticated;

-- ── 3. Extinde create_reservation_public cu p_zone ─────────────
drop function if exists public.create_reservation_public(text, text, text, smallint, timestamptz, text, text, smallint);
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
  ends_at           timestamptz
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
  -- 1. Validare input minim
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

  -- 2. Rezolvă slug → restaurant_id
  select id into v_restaurant_id
  from public.restaurants
  where slug = p_slug and is_active = true;
  if v_restaurant_id is null then
    raise exception 'Restaurantul nu a fost găsit';
  end if;

  -- 3. Citește settings
  select * into v_settings
  from public.reservation_settings
  where restaurant_id = v_restaurant_id;
  if v_settings is null then
    insert into public.reservation_settings (restaurant_id)
    values (v_restaurant_id)
    returning * into v_settings;
  end if;

  -- 4. Validări settings
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

  -- 5. Calculează ends_at
  v_duration := coalesce(p_duration_minutes, v_settings.reservation_duration);
  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  -- 6. Lock per restaurant — previne double-booking concurent pe slot
  perform pg_advisory_xact_lock(hashtext('reservation:' || v_restaurant_id::text));

  -- 7. Alocă cea mai mică masă liberă din zona cerută (sau oriunde dacă NULL)
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
    if v_zone is not null then
      raise exception 'Nu există masă liberă în zona "%" pentru % persoane în intervalul ales', v_zone, p_party_size;
    else
      raise exception 'Nu există masă liberă pentru % persoane în intervalul ales', p_party_size;
    end if;
  end if;

  -- 8. Status
  v_status := case when v_settings.auto_confirm then 'confirmed' else 'pending' end;

  -- 9. Insert
  insert into public.reservations (
    restaurant_id, table_id,
    customer_name, customer_phone, customer_email,
    party_size, special_requests,
    starts_at, ends_at,
    status, source
  )
  values (
    v_restaurant_id, v_table_id,
    trim(p_customer_name), trim(p_customer_phone),
    nullif(trim(coalesce(p_customer_email, '')), ''),
    p_party_size,
    nullif(trim(coalesce(p_special_requests, '')), ''),
    p_starts_at, v_ends_at,
    v_status, 'public'
  )
  returning id, confirmation_code into v_new_id, v_new_code;

  -- 10. Return
  return query select
    v_new_id, v_new_code, v_status,
    v_table_name, p_starts_at, v_ends_at;
end;
$$;

revoke all on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text
) from public;
grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint, text
) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE — migration 058
-- ═══════════════════════════════════════════════════════════════
