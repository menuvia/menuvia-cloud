-- tests/sql/security_q4_assertions.sql
-- =============================================================================
-- Aserții pentru mig 240 (hardening securitate Q4):
--   SQ1  orders.table_id NU poate fi mutat cross-tenant prin UPDATE direct
--        (trigger-ul mig 113 acoperă acum și UPDATE, nu doar INSERT).
--   SQ2  orders.table_id în ACELAȘI restaurant e permis la UPDATE.
--   SQ3  bridge_devices: un membru non-admin (waiter) NU mai poate citi
--        device_secret; adminul poate.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed: 2 restaurante ale unor owneri diferiți ─────────────────────────────
insert into auth.users (id, email) values
  ('a1110000-0000-4000-8000-000000000101','sq-own1@sq.test'),
  ('a1110000-0000-4000-8000-000000000102','sq-own2@sq.test'),
  ('a1110000-0000-4000-8000-000000000103','sq-waiter@sq.test');
update public.profiles set plan = 'enterprise'
 where id in ('a1110000-0000-4000-8000-000000000101','a1110000-0000-4000-8000-000000000102');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1110000-0000-4000-8000-000000000101','a1110000-0000-4000-8000-000000000101','R1','sq-r1','Cluj',true),
  ('b1110000-0000-4000-8000-000000000102','a1110000-0000-4000-8000-000000000102','R2','sq-r2','Cluj',true);

-- Waiter în R1.
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b1110000-0000-4000-8000-000000000101','a1110000-0000-4000-8000-000000000103','waiter')
on conflict (restaurant_id, user_id) do nothing;

-- Mese: una în fiecare restaurant.
insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('c1110000-0000-4000-8000-000000000101','b1110000-0000-4000-8000-000000000101','Masa R1','masa-r1',true),
  ('c1110000-0000-4000-8000-000000000102','b1110000-0000-4000-8000-000000000102','Masa R2','masa-r2',true);

-- Comandă în R1, pe masa R1.
insert into public.orders (id, restaurant_id, source, status, total, table_id) values
  ('d1110000-0000-4000-8000-000000000101','b1110000-0000-4000-8000-000000000101','waiter','served',50,
   'c1110000-0000-4000-8000-000000000101');

-- Device bridge cu secret în R1.
insert into public.bridge_devices (id, restaurant_id, name, device_secret) values
  ('e1110000-0000-4000-8000-000000000101','b1110000-0000-4000-8000-000000000101','Casa 1','SUPERSECRET123');

-- ── SQ1: UPDATE cross-tenant al table_id → respins ───────────────────────────
do $$
begin
  begin
    update public.orders
       set table_id = 'c1110000-0000-4000-8000-000000000102'   -- masa R2!
     where id = 'd1110000-0000-4000-8000-000000000101';
    raise exception 'SQ1 FAIL: table_id mutat cross-tenant prin UPDATE';
  exception when others then
    if sqlerrm not ilike '%aparține%' and sqlerrm not ilike '%restaurant%' then raise; end if;
  end;
  raise notice 'SQ1 OK: UPDATE cross-tenant al table_id respins';
end $$;

-- ── SQ2: UPDATE same-tenant permis ───────────────────────────────────────────
insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('c1110000-0000-4000-8000-000000000103','b1110000-0000-4000-8000-000000000101','Masa R1b','masa-r1b',true);
do $$
begin
  update public.orders
     set table_id = 'c1110000-0000-4000-8000-000000000103'   -- tot R1
   where id = 'd1110000-0000-4000-8000-000000000101';
  raise notice 'SQ2 OK: UPDATE same-tenant al table_id permis';
end $$;

-- ── SQ3: waiter NU vede device_secret; admin da ──────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1110000-0000-4000-8000-000000000103';  -- waiter

do $$
declare v_cnt integer;
begin
  select count(*) into v_cnt from public.bridge_devices
   where restaurant_id = 'b1110000-0000-4000-8000-000000000101';
  if v_cnt <> 0 then
    raise exception 'SQ3 FAIL: waiter vede % rânduri bridge_devices (secret expus)', v_cnt;
  end if;
end $$;

set local request.jwt.claim.sub = 'a1110000-0000-4000-8000-000000000101';  -- owner/admin R1
do $$
declare v_secret text;
begin
  select device_secret into v_secret from public.bridge_devices
   where id = 'e1110000-0000-4000-8000-000000000101';
  if v_secret is distinct from 'SUPERSECRET123' then
    raise exception 'SQ3 FAIL: adminul nu mai poate citi device_secret (regresie)';
  end if;
  raise notice 'SQ3 OK: waiter blocat, admin păstrează accesul la device_secret';
end $$;

reset role;

select 'SECURITY Q4 ASSERTIONS: SQ1–SQ3 PASS' as result;

rollback;
