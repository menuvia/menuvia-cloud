-- tests/sql/reservation_overlap_assertions.sql
-- =============================================================================
-- Aserții pentru mig 121: EXCLUDE constraint anti double-booking (RES-1).
-- Constrângerea excl_reservations_no_overlap pe public.reservations interzice,
-- pentru aceeași masă, suprapunerea intervalelor [starts_at, ends_at) între
-- rezervări ACTIVE (status not in cancelled/no_show).
--
-- Testăm DIRECT pe tabela reservations (insert raw), nu prin RPC — vrem să
-- izolăm comportamentul constrângerii de DB, exact calea paralelă pe care RES-1
-- o lasă neacoperită (scrieri care nu trec prin create_reservation_public).
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/reservation_overlap_assertions.sql
--
--   RO0  constrângerea EXCLUDE există (sanity pe structură)
--   RO1  două rezervări suprapuse pe aceeași masă → a doua respinsă
--   RO2  rezervări ne-suprapuse / pe mese diferite → acceptate
--   RO3  o rezervare cancelled NU blochează intervalul → nouă acceptată
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed minimal ─────────────────────────────────────────────────────────────
-- Restaurant activ + owner + două mese. Settings sunt create automat de
-- trigger-ul din mig 057 la insert restaurant.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1','ro-owner@res.test')
  on conflict (id) do nothing;

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0bbb0000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1',
   'Overlap Test R','reservation-overlap-slug','Cluj',true);

-- Două mese distincte pentru a testa și izolarea per masă (RO2).
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('0bbb0000-0000-0000-0000-00000000000a','0bbb0000-0000-0000-0000-0000000000b1',
   'Masa 1','overlap-masa-1',4,true),
  ('0bbb0000-0000-0000-0000-00000000000b','0bbb0000-0000-0000-0000-0000000000b1',
   'Masa 2','overlap-masa-2',4,true);

-- ── RO0: structura (constrângerea EXCLUDE există) ────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname  = 'excl_reservations_no_overlap'
       and conrelid = 'public.reservations'::regclass
       and contype  = 'x'
  ) then
    raise exception 'RO0 FAIL: constrângerea excl_reservations_no_overlap lipsește';
  end if;
  raise notice 'RO0 OK: EXCLUDE constraint prezent';
end $$;

-- ── RO1: două rezervări suprapuse pe aceeași masă → a doua respinsă ──────────
-- Prima: 19:00–20:30. A doua: 19:30–21:00 (se intersectează) pe ACEEAȘI masă.
do $$
declare
  v_blocked boolean := false;
begin
  insert into public.reservations (
    restaurant_id, table_id, customer_name, customer_phone,
    party_size, starts_at, ends_at, status, source
  ) values (
    '0bbb0000-0000-0000-0000-0000000000b1',
    '0bbb0000-0000-0000-0000-00000000000a',
    'Client A', '0700000301',
    2, timestamptz '2099-01-10 19:00+02', timestamptz '2099-01-10 20:30+02',
    'confirmed', 'dashboard'
  );

  begin
    insert into public.reservations (
      restaurant_id, table_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0bbb0000-0000-0000-0000-0000000000b1',
      '0bbb0000-0000-0000-0000-00000000000a',
      'Client B', '0700000302',
      2, timestamptz '2099-01-10 19:30+02', timestamptz '2099-01-10 21:00+02',
      'confirmed', 'dashboard'
    );
  exception
    when exclusion_violation then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'RO1 FAIL: a doua rezervare suprapusă pe aceeași masă NU a fost respinsă';
  end if;
  raise notice 'RO1 OK: overlap pe aceeași masă respins de EXCLUDE constraint';
end $$;

-- ── RO2: ne-suprapuse sau pe mese diferite → acceptate ───────────────────────
-- (a) interval lipit dar ne-suprapus pe Masa 1: 20:30–22:00 (start == ends_at
--     al rezervării din RO1 → '[)' tratează capetele atinse ca libere).
-- (b) interval suprapus dar pe Masa 2 (masă diferită → constrângerea nu se aplică
--     între mese diferite).
do $$
declare v_cnt int;
begin
  -- (a) lipit pe aceeași masă — acceptat
  insert into public.reservations (
    restaurant_id, table_id, customer_name, customer_phone,
    party_size, starts_at, ends_at, status, source
  ) values (
    '0bbb0000-0000-0000-0000-0000000000b1',
    '0bbb0000-0000-0000-0000-00000000000a',
    'Client C', '0700000303',
    2, timestamptz '2099-01-10 20:30+02', timestamptz '2099-01-10 22:00+02',
    'confirmed', 'dashboard'
  );

  -- (b) suprapus temporal cu RO1, dar pe Masa 2 — acceptat
  insert into public.reservations (
    restaurant_id, table_id, customer_name, customer_phone,
    party_size, starts_at, ends_at, status, source
  ) values (
    '0bbb0000-0000-0000-0000-0000000000b1',
    '0bbb0000-0000-0000-0000-00000000000b',
    'Client D', '0700000304',
    2, timestamptz '2099-01-10 19:30+02', timestamptz '2099-01-10 21:00+02',
    'confirmed', 'dashboard'
  );

  select count(*) into v_cnt from public.reservations
   where restaurant_id = '0bbb0000-0000-0000-0000-0000000000b1'
     and customer_phone in ('0700000303','0700000304');
  if v_cnt <> 2 then
    raise exception 'RO2 FAIL: % din 2 rezervări ne-suprapuse/masă diferită acceptate', v_cnt;
  end if;
  raise notice 'RO2 OK: intervale lipite și mese diferite acceptate';
end $$;

-- ── RO3: o rezervare cancelled NU blochează intervalul ───────────────────────
-- Restaurant + masă nouă ca să izolăm. Inserăm o rezervare cancelled pe un slot,
-- apoi o rezervare ACTIVĂ care se suprapune exact peste ea → trebuie acceptată.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b2','ro-owner2@res.test')
  on conflict (id) do nothing;
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0bbb0000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2',
   'Overlap Test R2','reservation-overlap-slug-2','Iași',true);
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('0bbb0000-0000-0000-0000-00000000000c','0bbb0000-0000-0000-0000-0000000000b2',
   'Masa 3','overlap-masa-3',4,true);

do $$
declare v_cnt int;
begin
  -- rezervare cancelled (NU intră în constrângere, status filtrat)
  insert into public.reservations (
    restaurant_id, table_id, customer_name, customer_phone,
    party_size, starts_at, ends_at, status, source
  ) values (
    '0bbb0000-0000-0000-0000-0000000000b2',
    '0bbb0000-0000-0000-0000-00000000000c',
    'Anulat', '0700000401',
    2, timestamptz '2099-02-01 18:00+02', timestamptz '2099-02-01 19:30+02',
    'cancelled', 'dashboard'
  );

  -- rezervare ACTIVĂ suprapusă peste cea anulată → trebuie acceptată
  insert into public.reservations (
    restaurant_id, table_id, customer_name, customer_phone,
    party_size, starts_at, ends_at, status, source
  ) values (
    '0bbb0000-0000-0000-0000-0000000000b2',
    '0bbb0000-0000-0000-0000-00000000000c',
    'Activ', '0700000402',
    2, timestamptz '2099-02-01 18:00+02', timestamptz '2099-02-01 19:30+02',
    'confirmed', 'dashboard'
  );

  select count(*) into v_cnt from public.reservations
   where restaurant_id = '0bbb0000-0000-0000-0000-0000000000b2'
     and status = 'confirmed';
  if v_cnt <> 1 then
    raise exception 'RO3 FAIL: rezervarea activă peste una anulată NU a fost acceptată';
  end if;
  raise notice 'RO3 OK: rezervarea cancelled nu blochează intervalul';
end $$;

do $$ begin raise notice '════ reservation overlap (mig 121) assertions: ALL PASS ════'; end $$;

rollback;
