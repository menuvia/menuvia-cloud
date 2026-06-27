-- tests/sql/orders_paid_gate_assertions.sql
-- =============================================================================
-- Asertii pentru mig 124: gate universal pe orders.status='paid' (regula de aur).
-- Orice cale de scriere (PostgREST direct, RPC) spre 'paid' pe un restaurant
-- non-Plan-3 trebuie respinsa server-side (trigger BEFORE INSERT OR UPDATE).
-- Ruleaza DUPA migratii. Self-contained, ROLLBACK la final.
--
--   PG1  growth (Plan 2): UPDATE ...->paid direct = RESPINS (feature_disabled)
--   PG2  pro    (Plan 3): UPDATE ...->paid direct = PERMIS
--   PG3  growth: INSERT direct cu status='paid' = RESPINS (acopera si calea INSERT)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('c1c1c1c1-1111-4111-8111-111111111111','g@paidgate.test'),
  ('c2c2c2c2-2222-4222-8222-222222222222','p@paidgate.test');
update public.profiles set plan='growth' where id='c1c1c1c1-1111-4111-8111-111111111111';
update public.profiles set plan='pro'    where id='c2c2c2c2-2222-4222-8222-222222222222';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('d1d1d1d1-1111-4111-8111-111111111111','c1c1c1c1-1111-4111-8111-111111111111','G','g-pg','Cluj',true),
  ('d2d2d2d2-2222-4222-8222-222222222222','c2c2c2c2-2222-4222-8222-222222222222','P','p-pg','Cluj',true);

insert into public.orders (id, restaurant_id, source, status, total, created_by) values
  ('e1e1e1e1-1111-4111-8111-111111111111','d1d1d1d1-1111-4111-8111-111111111111','qr','served',100,'c1c1c1c1-1111-4111-8111-111111111111'),
  ('e2e2e2e2-2222-4222-8222-222222222222','d2d2d2d2-2222-4222-8222-222222222222','qr','served',100,'c2c2c2c2-2222-4222-8222-222222222222');

-- ── PG1: growth → UPDATE spre paid RESPINS ───────────────────────────────────
do $$
begin
  update public.orders set status='paid', paid_amount=100
   where id='e1e1e1e1-1111-4111-8111-111111111111';
  raise exception 'PG1 FAIL: growth a putut marca paid direct (gate-leak NEINCHIS)';
exception when others then
  if sqlerrm like '%fiscal%' or sqlerrm like '%Featurea%' then
    raise notice 'PG1 OK: growth blocat la UPDATE->paid';
  else raise; end if;
end $$;

-- ── PG2: pro → UPDATE spre paid PERMIS ───────────────────────────────────────
update public.orders set status='paid', paid_amount=100
 where id='e2e2e2e2-2222-4222-8222-222222222222';
do $$
begin
  if (select status from public.orders where id='e2e2e2e2-2222-4222-8222-222222222222')::text <> 'paid' then
    raise exception 'PG2 FAIL: pro nu a putut marca paid';
  end if;
  raise notice 'PG2 OK: pro a marcat paid';
end $$;

-- ── PG3: growth → INSERT direct cu paid RESPINS ──────────────────────────────
do $$
begin
  insert into public.orders (restaurant_id, source, status, total, created_by)
  values ('d1d1d1d1-1111-4111-8111-111111111111','qr','paid',50,'c1c1c1c1-1111-4111-8111-111111111111');
  raise exception 'PG3 FAIL: growth a putut INSERT-a o comanda paid (gate-leak pe INSERT)';
exception when others then
  if sqlerrm like '%fiscal%' or sqlerrm like '%Featurea%' then
    raise notice 'PG3 OK: growth blocat la INSERT cu status=paid';
  else raise; end if;
end $$;

do $$ begin raise notice '════ orders paid gate assertions: ALL PASS ════'; end $$;

rollback;
