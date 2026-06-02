-- ═══════════════════════════════════════════════════════════════
-- Migration 057 — Modul Rezervări
-- ═══════════════════════════════════════════════════════════════
-- Adaugă:
--   • reservation_settings (per restaurant — program, durată, etc.)
--   • reservations (rezervările propriu-zise)
--   • RPC check_availability (validare disponibilitate atomic)
--   • RPC create_reservation_public (insert sigur pentru anon)
--   • Trigger auto-creare settings la insert restaurant
--   • Extensie enum email_template_kind cu 'reservation_reminder'
--
-- Auto-confirm = ON default, auto-allocare = cea mai mică masă care încape.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Extensie enum email_template_kind ────────────────────────
-- ALTER TYPE ... ADD VALUE e idempotent (IF NOT EXISTS), safe la re-run.
alter type public.email_template_kind add value if not exists 'reservation_reminder';

-- ── 2. Tabel reservation_settings ──────────────────────────────
create table if not exists public.reservation_settings (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null unique references public.restaurants(id) on delete cascade,
  -- Program: zile săptămânale 1=Luni..7=Duminică (ISO)
  open_days             smallint[] not null default '{1,2,3,4,5,6,7}',
  open_time             time not null default '10:00',
  close_time            time not null default '23:00',
  -- Granularitatea sloturilor + durata default a unei rezervări (minute)
  slot_interval         smallint not null default 30 check (slot_interval > 0),
  reservation_duration  smallint not null default 90 check (reservation_duration > 0),
  -- Restricții
  min_advance_hours     smallint not null default 2 check (min_advance_hours >= 0),
  max_advance_days      smallint not null default 30 check (max_advance_days > 0),
  max_party_size        smallint not null default 20 check (max_party_size > 0),
  -- Flow
  auto_confirm          boolean not null default true,
  reminder_hours_before smallint not null default 24 check (reminder_hours_before >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── 3. Tabel reservations ──────────────────────────────────────
create table if not exists public.reservations (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  -- table_id NULL = rezervare fără alocare (walk-in plan / overflow)
  table_id           uuid references public.tables(id) on delete set null,
  -- Date client
  customer_name      text not null check (length(trim(customer_name)) > 0),
  customer_phone     text not null check (length(trim(customer_phone)) > 0),
  customer_email     text,
  party_size         smallint not null check (party_size > 0),
  special_requests   text,
  -- Slot
  starts_at          timestamptz not null,
  ends_at            timestamptz not null check (ends_at > starts_at),
  -- Status flow
  status             text not null default 'confirmed'
    check (status in ('pending','confirmed','seated','completed','cancelled','no_show')),
  source             text not null default 'public'
    check (source in ('public','phone','google','widget','walk_in','dashboard')),
  -- Reminder
  reminder_sent_at   timestamptz,
  -- Cod public scurt pentru verificare ulterioară de către client
  confirmation_code  text not null default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Index pentru verificarea disponibilității (RPC) + listare în dashboard.
-- `where status not in ('cancelled','no_show')` exclude rezervările moarte.
create index if not exists idx_reservations_availability
  on public.reservations(restaurant_id, table_id, starts_at, ends_at)
  where status not in ('cancelled','no_show');

create index if not exists idx_reservations_restaurant_starts
  on public.reservations(restaurant_id, starts_at);

create index if not exists idx_reservations_reminder
  on public.reservations(starts_at)
  where reminder_sent_at is null and status = 'confirmed';

-- updated_at auto (reutilizează public.set_updated_at, definită în
-- migration 001 — refolosită deja în categories/products/tables/etc).
drop trigger if exists trg_reservations_updated_at on public.reservations;
create trigger trg_reservations_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_reservation_settings_updated_at on public.reservation_settings;
create trigger trg_reservation_settings_updated_at
  before update on public.reservation_settings
  for each row execute function public.set_updated_at();

-- ── 4. Auto-creare settings la insert restaurant ───────────────
create or replace function public.create_default_reservation_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.reservation_settings (restaurant_id)
  values (new.id)
  on conflict (restaurant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_restaurants_default_reservation_settings on public.restaurants;
create trigger trg_restaurants_default_reservation_settings
  after insert on public.restaurants
  for each row execute function public.create_default_reservation_settings();

-- Backfill pentru restaurantele existente (idempotent).
insert into public.reservation_settings (restaurant_id)
select id from public.restaurants
on conflict (restaurant_id) do nothing;

-- ── 5. RLS ─────────────────────────────────────────────────────
alter table public.reservation_settings enable row level security;
alter table public.reservations enable row level security;

-- Admin (owner/manager) — full access.
drop policy if exists reservation_settings_admin on public.reservation_settings;
create policy reservation_settings_admin on public.reservation_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservation_settings.restaurant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservation_settings.restaurant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  );

drop policy if exists reservations_admin on public.reservations;
create policy reservations_admin on public.reservations
  for all to authenticated
  using (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservations.restaurant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservations.restaurant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  );

-- NOTĂ: NU adăugăm policy INSERT pentru anon direct pe tabela `reservations`.
-- Anon creează rezervări EXCLUSIV prin RPC `create_reservation_public`
-- (SECURITY DEFINER) care validează slug-ul + face alocarea atomic.
-- Asta blochează scrieri arbitrare în câmpuri sensibile (status, source).

-- ── 6. RPC check_availability ──────────────────────────────────
-- Întoarce mesele libere cu `seats >= party_size`, sortate asc seats
-- (preferă cea mai mică ce încape — îmbrățișează utilization).
-- Folosită de UI publică pentru a arăta disponibilitate înainte de submit.
create or replace function public.check_availability(
  p_restaurant_id uuid,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_party_size    smallint
)
returns table (
  table_id   uuid,
  table_name text,
  seats      smallint
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
  select t.id, t.name, t.seats
  from public.tables t
  where t.restaurant_id = p_restaurant_id
    and t.is_active = true
    and t.seats is not null
    and t.seats >= p_party_size
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

grant execute on function public.check_availability(uuid, timestamptz, timestamptz, smallint)
  to anon, authenticated;

-- ── 7. RPC create_reservation_public ───────────────────────────
-- Path public pentru rezervări de pe widget. SECURITY DEFINER cu validări:
-- 1. Slug-ul rezolvă la un restaurant activ.
-- 2. Programul + min_advance_hours + max_advance_days sunt respectate.
-- 3. party_size <= max_party_size din settings.
-- 4. Disponibilitate atomic verificată prin advisory lock per restaurant
--    (previne double-booking sub burst concurent pe aceeași oră).
-- 5. Auto-alocare mas cea mai mică (în ordinea returnată de check_availability).
-- 6. Status = 'confirmed' dacă auto_confirm=true, altfel 'pending'.
create or replace function public.create_reservation_public(
  p_slug             text,
  p_customer_name    text,
  p_customer_phone   text,
  p_party_size       smallint,
  p_starts_at        timestamptz,
  p_customer_email   text default null,
  p_special_requests text default null,
  p_duration_minutes smallint default null
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
    -- Trigger-ul ar fi trebuit să-l creeze; defensive fallback.
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

  -- Verifică ziua săptămânii (ISO: 1=Mon..7=Sun) și ora locală
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

  -- 6. Lock per restaurant ca să elimin race de double-booking pe slot
  perform pg_advisory_xact_lock(hashtext('reservation:' || v_restaurant_id::text));

  -- 7. Alocă cea mai mică masă liberă care încape
  select t.id, t.name into v_table_id, v_table_name
  from public.tables t
  where t.restaurant_id = v_restaurant_id
    and t.is_active = true
    and t.seats is not null
    and t.seats >= p_party_size
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
    raise exception 'Nu există masă liberă pentru % persoane în intervalul ales', p_party_size;
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
  text, text, text, smallint, timestamptz, text, text, smallint
) from public;
grant execute on function public.create_reservation_public(
  text, text, text, smallint, timestamptz, text, text, smallint
) to anon, authenticated;

-- ── 8. RPC pentru reminder cron — selectează + marchează atomic ─
-- Cron-ul rulează la 15 min; ne dorim ca două ticks consecutive să nu
-- queue-uiască duplicate. Combinăm SELECT + UPDATE într-o tranzacție
-- prin RPC care întoarce rândurile pe care le-am marcat ca trimise.
create or replace function public.claim_reservation_reminders(
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
  restaurant_phone text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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
        and r2.customer_email is not null
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
    rest.name, rest.phone
  from claimed c
  join public.restaurants rest on rest.id = c.restaurant_id;
end;
$$;

-- Service role only (apelată din cron, nu din UI).
revoke all on function public.claim_reservation_reminders(integer) from public;
grant execute on function public.claim_reservation_reminders(integer) to service_role;

-- ═══════════════════════════════════════════════════════════════
-- DONE — migration 057
-- ═══════════════════════════════════════════════════════════════
