-- Migration 086: Poarta D — Generic optional module toggle + Reservations gating
-- ─────────────────────────────────────────────────────────────────────
-- Spec §3 Regula 3: "Gating la nivel de RPC/RLS, NU în UI."
-- Spec §6 Poarta D: "Module opționale OFF default, blocate server-side."
--
-- Scopul: framework generic pentru a activa/dezactiva module opționale
-- per restaurant (Reservations e primul). Default: OFF. Toggle e admin-only.
-- Server-side gating: dacă modulul e OFF, RPC-urile relevante raise exception
-- → UI-ul nu poate "ocoli" controlul ascunzând doar butonul.
--
-- Stratificare (de jos în sus):
--   1. plan_features  → ce permite planul (hard gate, decis de Menuvia).
--   2. restaurant_modules → ce activează owner-ul pentru restaurantul lui.
--   3. restaurant_settings → reglaje fine (ex: ordering_enabled toggle).
--
-- Pentru reservations:
--   - Toate planurile permit modulul (nu e în plan_features ca hard gate).
--   - Plan 1 (free/starter) = capacity-only (fără linkare la orders/venit).
--   - Plan 2+ (growth+) = full (revenue tracking, integrare cu sesiuni mese).
--   - Toggle per-restaurant decide doar dacă featurea există în UI și RPC.
--
-- Module candidate viitoare (nu activate aici): online_payments, loyalty,
-- delivery, gift_cards. Adăugarea unui nou modul = un singur INSERT în
-- restaurant_modules + check-uri în RPC-urile sale.

-- ── 1. Tabel restaurant_modules ──────────────────────────────────
create table if not exists public.restaurant_modules (
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  module_key     text not null
    check (module_key in ('reservations','online_payments','loyalty','delivery','gift_cards')),
  enabled        boolean not null default false,
  configured_by  uuid references public.profiles(id) on delete set null,
  configured_at  timestamptz not null default now(),
  primary key (restaurant_id, module_key)
);

comment on table public.restaurant_modules is
  $$Toggle per-restaurant pentru module opționale. Lipsa rândului = disabled.
  Modificarea e admin-only (owner/manager). Lectura e publică pentru a permite
  UI-ului public (CTA-uri condiționate) să citească starea fără auth.$$;

comment on column public.restaurant_modules.module_key is
  $$Cheia modulului. Enum validat prin CHECK constraint pentru a preveni
  typo-uri. Adăugare modul nou = ALTER TYPE / drop+recreate CHECK în migrație
  ulterioară.$$;

create index if not exists idx_restaurant_modules_key
  on public.restaurant_modules(module_key, enabled)
  where enabled = true;

-- ── 2. RLS ───────────────────────────────────────────────────────
alter table public.restaurant_modules enable row level security;

-- SELECT: public read. Justificare: meniul public (anon) trebuie să știe
-- dacă să afișeze CTA "Rezervă o masă". Datele nu sunt sensibile (doar
-- toggle on/off per modul); ascunderea n-ar adăuga securitate, doar
-- complexitate (un nou RPC public). Toate modulele relevante au gate-uri
-- în RPC-urile lor → atacatorul oricum nu poate face nimic dacă citește.
drop policy if exists modules_public_read on public.restaurant_modules;
create policy modules_public_read on public.restaurant_modules
  for select to anon, authenticated using (true);

-- INSERT/UPDATE/DELETE: doar owner sau manager pe restaurantul respectiv.
drop policy if exists modules_admin_write on public.restaurant_modules;
create policy modules_admin_write on public.restaurant_modules
  for all to authenticated
  using (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = restaurant_modules.restaurant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = restaurant_modules.restaurant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  );

-- ── 3. Helper is_module_enabled ──────────────────────────────────
-- Folosit:
--   - În RPC-urile altor module (gate hard).
--   - În UI pentru renderare condiționată (fallback peste citire directă).
-- STABLE: rezultatul nu se schimbă în interiorul unei tranzacții → caching
-- agresiv. SECURITY DEFINER + search_path fixat: evită atac search_path.
create or replace function public.is_module_enabled(
  p_restaurant_id uuid,
  p_module_key    text
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(
    (select enabled from public.restaurant_modules
      where restaurant_id = p_restaurant_id and module_key = p_module_key),
    false
  );
$$;

revoke all on function public.is_module_enabled(uuid, text) from public;
grant execute on function public.is_module_enabled(uuid, text) to anon, authenticated;

-- ── 4. RPC set_restaurant_module ─────────────────────────────────
-- Admin-only toggle. Upsert: prima activare creează rândul, sau update.
-- SECURITY DEFINER pentru a putea scrie pe tabelă fără ca RLS să trebuiască
-- în plus să fie traversat (verifică explicit membership-ul jos).
create or replace function public.set_restaurant_module(
  p_restaurant_id uuid,
  p_module_key    text,
  p_enabled       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Trebuie să fii autentificat'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verifică membership admin
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id
      and user_id = v_uid
      and role in ('owner','manager')
  ) then
    raise exception 'Doar owner sau manager poate activa module'
      using errcode = 'insufficient_privilege';
  end if;

  -- Validare module_key (redundant cu CHECK, dar mesaj mai clar pentru UI)
  if p_module_key not in ('reservations','online_payments','loyalty','delivery','gift_cards') then
    raise exception 'Modul necunoscut: %', p_module_key
      using errcode = 'check_violation';
  end if;

  insert into public.restaurant_modules
    (restaurant_id, module_key, enabled, configured_by, configured_at)
  values (p_restaurant_id, p_module_key, p_enabled, v_uid, now())
  on conflict (restaurant_id, module_key) do update
    set enabled = excluded.enabled,
        configured_by = excluded.configured_by,
        configured_at = excluded.configured_at;

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'module_key',    p_module_key,
    'enabled',       p_enabled,
    'configured_at', now()
  );
end;
$$;

revoke all on function public.set_restaurant_module(uuid, text, boolean) from public;
grant execute on function public.set_restaurant_module(uuid, text, boolean) to authenticated;

-- ── 5. Gate create_reservation_public on module 'reservations' ───
-- Repetăm semnătura (DROP + CREATE) doar dacă schimbăm shape return-ului.
-- Aici NU schimbăm shape, deci CREATE OR REPLACE e suficient.
create or replace function public.create_reservation_public(
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

-- ── 6. Gate check_availability on module 'reservations' ──────────
-- Acelasi pattern — verificare module la început.
create or replace function public.check_availability(
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

  if not public.is_module_enabled(p_restaurant_id, 'reservations') then
    raise exception 'Rezervările nu sunt activate pentru acest restaurant'
      using errcode = 'check_violation', hint = 'module_disabled';
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

-- ── 7. plan_features: reservations_revenue ───────────────────────
-- Diferențiere Plan 1 (capacity-only) vs Plan 2+ (revenue tracking).
-- Featurea NU controlează accesul la modul, doar scope-ul în UI/RPC-uri
-- viitoare (ex: linkare reservation → order, tip tracking).
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'reservations_revenue', false, null),
  ('starter',    'reservations_revenue', false, null),
  ('growth',     'reservations_revenue', true,  null),
  ('pro',        'reservations_revenue', true,  null),
  ('enterprise', 'reservations_revenue', true,  null)
on conflict (plan, feature) do update set enabled = excluded.enabled;

-- ── 8. Comentarii migrație ───────────────────────────────────────
comment on function public.is_module_enabled(uuid, text) is
  $$STABLE helper folosit ca gate în RPC-uri și pentru renderare condiționată
  în UI. Returnează false dacă rândul nu există (default OFF).$$;

comment on function public.set_restaurant_module(uuid, text, boolean) is
  $$Admin-only toggle (owner/manager). Upsert atomic. Folosit din SettingsTab
  sau ModulesTab dedicate.$$;
