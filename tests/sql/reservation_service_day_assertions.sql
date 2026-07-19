-- tests/sql/reservation_service_day_assertions.sql
-- =============================================================================
-- Aserții pentru mig 241 (ziua de serviciu pe program peste miezul nopții):
--   RS1  Program 18:00–02:00, open_days={6} (sâmbătă). Slot duminică 01:00
--        (instant duminică, SERVICIU sâmbătă) → ACCEPTAT.
--   RS2  Același program. Slot sâmbătă 01:00 (instant sâmbătă, serviciu
--        vineri — închis) → RESPINS 'nu acceptă rezervări în această zi'.
--   RS3  Regresie: program normal 10:00–22:00 (fără wrap), slotul se
--        verifică pe ziua instantului (fără scădere).
--
-- Datele fixe: 2027-01-02 = sâmbătă, 2027-01-03 = duminică (2027 începe vineri).
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a2220000-0000-4000-8000-000000000201','rs-owner@rs.test');
update public.profiles set plan = 'enterprise'
 where id = 'a2220000-0000-4000-8000-000000000201';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b2220000-0000-4000-8000-000000000201','a2220000-0000-4000-8000-000000000201',
   'RS Night','rs-night-slug','Cluj',true);

-- Modul rezervări ON.
insert into public.restaurant_modules (restaurant_id, module_key, enabled)
values ('b2220000-0000-4000-8000-000000000201','reservations',true)
on conflict (restaurant_id, module_key) do update set enabled = true;

-- Program de noapte 18:00–02:00, doar sâmbăta; fereastră mare de avans ca
-- datele fixe din 2027 să treacă de min/max advance.
insert into public.reservation_settings
  (restaurant_id, open_days, open_time, close_time, min_advance_hours, max_advance_days, auto_confirm)
values ('b2220000-0000-4000-8000-000000000201', '{6}', '18:00', '02:00', 0, 3650, true)
on conflict (restaurant_id) do update
  set open_days = '{6}', open_time = '18:00', close_time = '02:00',
      min_advance_hours = 0, max_advance_days = 3650, auto_confirm = true;

-- ── RS1: duminică 01:00 = serviciul de sâmbătă → acceptat ────────────────────
do $$
declare v_status text;
begin
  select status into v_status from public.create_reservation_public(
    'rs-night-slug', 'Client Noapte', '0722000111', 2::smallint,
    (timestamp '2027-01-03 01:00') at time zone 'Europe/Bucharest'
  );
  -- Nu trebuie să arunce 'nu acceptă rezervări în această zi'.
  if v_status is null then
    raise exception 'RS1 FAIL: rezervarea de duminică 01:00 (serviciu sâmbătă) nu a fost creată';
  end if;
  raise notice 'RS1 OK: slot post-miezul-nopții acceptat pe ziua de serviciu (%)', v_status;
end $$;

-- ── RS2: sâmbătă 01:00 = serviciul de vineri (închis) → respins ──────────────
do $$
begin
  begin
    perform public.create_reservation_public(
      'rs-night-slug', 'Client Gresit', '0722000222', 2::smallint,
      (timestamp '2027-01-02 01:00') at time zone 'Europe/Bucharest'
    );
    raise exception 'RS2 FAIL: slotul de sâmbătă 01:00 (serviciu vineri închis) a fost acceptat';
  exception when others then
    if sqlerrm not ilike '%nu acceptă rezervări%' then raise; end if;
  end;
  raise notice 'RS2 OK: slot de serviciu-vineri (închis) respins';
end $$;

-- ── RS3: regresie program normal (fără wrap) ─────────────────────────────────
update public.reservation_settings
   set open_days = '{7}', open_time = '10:00', close_time = '22:00'
 where restaurant_id = 'b2220000-0000-4000-8000-000000000201';

do $$
declare v_status text;
begin
  -- Duminică 12:00, program normal → verificat pe ziua instantului (duminică=7).
  select status into v_status from public.create_reservation_public(
    'rs-night-slug', 'Client Zi', '0722000333', 2::smallint,
    (timestamp '2027-01-03 12:00') at time zone 'Europe/Bucharest'
  );
  if v_status is null then
    raise exception 'RS3 FAIL: program normal a respins un slot valid de duminică';
  end if;
  -- Iar duminică 01:00 pe program NORMAL (fără wrap) → în afara programului.
  begin
    perform public.create_reservation_public(
      'rs-night-slug', 'Client Noapte2', '0722000444', 2::smallint,
      (timestamp '2027-01-03 01:00') at time zone 'Europe/Bucharest'
    );
    raise exception 'RS3 FAIL: program normal a acceptat 01:00 (în afara orelor)';
  exception when others then
    if sqlerrm not ilike '%în afara programului%' then raise; end if;
  end;
  raise notice 'RS3 OK: program normal verifică ziua instantului (fără scădere)';
end $$;

select 'RESERVATION SERVICE-DAY ASSERTIONS: RS1–RS3 PASS' as result;

rollback;
