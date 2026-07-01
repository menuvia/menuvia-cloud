-- Migration 176: Auto-vindecare + aserțiune fail-closed pentru limitele de plan
-- ─────────────────────────────────────────────────────────────────────
-- Problemă: mig 089 (`20260612000000_migration_089_align_plan_limits.sql`)
-- aliniază limitele de plan prin UPDATE-uri simple pe `plan_features` și
-- `plan_limits`. Un UPDATE care nu prinde niciun rând (seed row lipsă) e un
-- SILENT NO-OP: 0 rânduri afectate, ZERO eroare. Rezultat: drift necontrolat
-- — planul rulează cu limita greșită (sau default NULL = nelimitat), fără
-- ca CI-ul „Apply all migrations" să semnaleze ceva.
--
-- `plan_features` e sursa de adevăr citită de `get_restaurant_features` RPC și
-- de `useFeatures` (vezi mig 089 L40). Deci un rând `max_*` lipsă acolo =
-- gating rupt în producție.
--
-- Soluție (idempotentă + self-healing):
--   1. RE-APLICĂM valorile intenționate din mig 089 pe `plan_features` cu
--      `insert ... on conflict (plan, feature) do update` — un rând lipsă e
--      CREAT, unul cu valoare greșită e CORECTAT. Nu mai există no-op tăcut.
--   2. Oglindim intenția și pe `plan_limits` prin UPDATE-uri idempotente
--      (aceleași ca mig 089; nu inserăm rânduri noi acolo ca să nu ghicim
--      coloanele NOT NULL istorice max_restaurants/ai_imports_month/features).
--   3. Bloc de ASERȚIUNE fail-closed (pattern „Config lipsă" din mig 131):
--      dacă vreun (plan, feature) așteptat lipsește SAU are `limit_value`
--      greșit, migrația RIDICĂ EXCEPȚIE și oprește deploy-ul.
--
-- Valori intenționate (identice cu mig 089), pe `plan_features.limit_value`:
--   max_products:     starter=300,  growth=1000, pro=2000
--   max_tables:       starter=120,  growth=300,  pro=500
--   max_team_members: starter=1,    growth=10,   pro=1000
-- (free/enterprise nu sunt în spec-ul mig 089 → le lăsăm neatinse.)
--
-- NU editează mig 089. Rularea repetată e sigură (idempotentă).
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. plan_features — self-healing upsert (sursa de adevăr) ──────────
-- Cheia unică e PRIMARY KEY (plan, feature) — vezi mig 028.
-- `enabled = true` e valoarea istorică a rândurilor max_* (mig 028); o
-- păstrăm explicit ca un rând nou creat aici să fie coerent.
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('starter', 'max_products',     true, 300),
  ('growth',  'max_products',     true, 1000),
  ('pro',     'max_products',     true, 2000),
  ('starter', 'max_tables',       true, 120),
  ('growth',  'max_tables',       true, 300),
  ('pro',     'max_tables',       true, 500),
  ('starter', 'max_team_members', true, 1),
  ('growth',  'max_team_members', true, 10),
  ('pro',     'max_team_members', true, 1000)
on conflict (plan, feature) do update set
  limit_value = excluded.limit_value;
-- NB: NU atingem `enabled` la conflict — rândul poate avea override-uri
-- intenționate; corectăm strict `limit_value` (subiectul driftului).

-- ── 2. plan_limits — UPDATE-uri idempotente (oglindesc mig 089) ───────
-- Aceleași valori ca mig 089; dacă rândul planului lipsește, UPDATE-ul e
-- tot no-op, DAR aserțiunea de mai jos îl prinde și oprește deploy-ul.
update public.plan_limits set max_products = 300,  max_tables = 120 where plan = 'starter';
update public.plan_limits set max_products = 1000, max_tables = 300 where plan = 'growth';
update public.plan_limits set max_products = 2000, max_tables = 500 where plan = 'pro';

-- ── 3. Aserțiune fail-closed ──────────────────────────────────────────
-- Detectează orice (plan, feature) așteptat care lipsește sau are
-- limit_value diferit de cel intenționat. Fail-closed: dacă starea nu e
-- exact cea de mai sus, EȘUEAZĂ migrația (nu lăsa driftul să treacă).
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s/%s', e.plan, e.feature), ', ')
    into v_bad
  from (values
    ('starter', 'max_products',     300),
    ('growth',  'max_products',     1000),
    ('pro',     'max_products',     2000),
    ('starter', 'max_tables',       120),
    ('growth',  'max_tables',       300),
    ('pro',     'max_tables',       500),
    ('starter', 'max_team_members', 1),
    ('growth',  'max_team_members', 10),
    ('pro',     'max_team_members', 1000)
  ) as e(plan, feature, expected)
  left join public.plan_features f
    on f.plan = e.plan and f.feature = e.feature
  where f.plan is null                     -- rând lipsă
     or f.limit_value is distinct from e.expected;  -- valoare greșită

  if v_bad is not null then
    raise exception 'plan limits drift: plan_features gresit/lipsa pentru: %', v_bad
      using errcode = 'P0001', hint = 'plan_features_drift';
  end if;

  -- Oglindă pe plan_limits: rândurile din spec trebuie să existe cu valorile corecte.
  select string_agg(format('%s(prod=%s,tables=%s)', e.plan, e.max_products, e.max_tables), ', ')
    into v_bad
  from (values
    ('starter', 300,  120),
    ('growth',  1000, 300),
    ('pro',     2000, 500)
  ) as e(plan, max_products, max_tables)
  left join public.plan_limits l on l.plan = e.plan
  where l.plan is null
     or l.max_products is distinct from e.max_products
     or l.max_tables   is distinct from e.max_tables;

  if v_bad is not null then
    raise exception 'plan limits drift: plan_limits gresit/lipsa pentru: %', v_bad
      using errcode = 'P0001', hint = 'plan_limits_drift';
  end if;

  raise notice 'mig 176: plan_features + plan_limits aliniate, fara drift OK';
end $$;
