-- Migration 062: unificare taxonomie planuri (P0 comercial)
-- ─────────────────────────────────────────────────────────────────────
-- Înainte: 3 definiții diferite de plan în DB:
--   profiles.plan CHECK  → free/pro/business  (base_schema)
--   plan_limits CHECK    → free/pro/business  (mig 013)
--   plan_features CHECK  → free/starter/growth/pro/enterprise (mig 028) ✓
-- Acest migration aliniază TOTUL la taxonomia canonică din plan_features:
--   free (default, fără Stripe) + starter/growth/pro/enterprise (plătite).
-- Idempotent: drop constraint if exists + on conflict.

-- ─────────────────────────────────────────────────────────────────────
-- 1. profiles.plan — migrează 'business' → 'pro' ÎNAINTE de a schimba CHECK
-- ─────────────────────────────────────────────────────────────────────
update public.profiles set plan = 'pro' where plan = 'business';

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'starter', 'growth', 'pro', 'enterprise'));

-- ─────────────────────────────────────────────────────────────────────
-- 2. plan_limits — migrează rândul 'business', apoi schimbă CHECK
-- ─────────────────────────────────────────────────────────────────────
-- 'pro' există deja în plan_limits (din mig 013), deci 'business' devine
-- redundant → îl ștergem după ce ne asigurăm că pro e prezent.
delete from public.plan_limits where plan = 'business';

alter table public.plan_limits drop constraint if exists plan_limits_plan_check;
alter table public.plan_limits
  add constraint plan_limits_plan_check
  check (plan in ('free', 'starter', 'growth', 'pro', 'enterprise'));

-- ─────────────────────────────────────────────────────────────────────
-- 3. Upsert toate cele 5 planuri (valori aliniate cu feature-list landing)
-- ─────────────────────────────────────────────────────────────────────
-- Starter    = doar meniu QR (fără ordering)
-- Growth     = ordering + kitchen + waiter + analytics + team
-- Pro        = + AI import + floor plan + split bill + 2 locații
-- Enterprise = + multi_location nelimitat
insert into public.plan_limits
  (plan, max_products, max_restaurants, max_tables, ai_imports_month, features)
values
  ('free',       15,    1,  3,   1,
    '["qr_static"]'::jsonb),
  ('starter',    50,    1,  8,   2,
    '["qr_static","qr_dynamic"]'::jsonb),
  ('growth',     500,   1,  50,  20,
    '["qr_dynamic","ordering","analytics","team","kitchen","waiter"]'::jsonb),
  ('pro',        2000,  2,  100, 50,
    '["qr_dynamic","ordering","analytics","ai_import","team","kitchen","waiter","floor_plan","split_bill"]'::jsonb),
  ('enterprise', 99999, 99, 999, 999,
    '["qr_dynamic","ordering","analytics","ai_import","team","kitchen","waiter","floor_plan","split_bill","multi_location"]'::jsonb)
on conflict (plan) do update set
  max_products     = excluded.max_products,
  max_restaurants  = excluded.max_restaurants,
  max_tables       = excluded.max_tables,
  ai_imports_month = excluded.ai_imports_month,
  features         = excluded.features;

-- ─────────────────────────────────────────────────────────────────────
-- Verificare manuală (după aplicare):
-- ─────────────────────────────────────────────────────────────────────
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conname in ('profiles_plan_check', 'plan_limits_plan_check');
-- select plan from plan_limits order by plan;       -- 5 rânduri, fără business
-- select distinct plan from profiles;                -- niciun business rămas
