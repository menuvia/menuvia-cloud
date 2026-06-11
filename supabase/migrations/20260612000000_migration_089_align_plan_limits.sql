-- Migration 089: Aliniere limite plan cu taxonomia comercială finală
-- ─────────────────────────────────────────────────────────────────────
-- Sursa de adevăr: src/lib/plans.ts (cele 3 planuri vizibile clientului).
-- Această migrație aliniază DB-ul: plan_limits + plan_features.max_*.
--
-- Limite noi (vs. vechi):
--   starter (Meniu Digital):   30→300 produse,  5→120 mese,  1→1   echipă
--   growth  (Meniu + Comenzi): null→1000,       null→300,    5→10  echipă
--   pro     (Fiscalizare):     null→2000,       null→500,    null→1000 echipă
--   free  (demo): rămâne mic (15/3) — e doar pentru on-board, nu plan vândut
--   enterprise: rămâne „aproape nelimitat" (mig 071), 1B pe tot
--
-- De ce: limitele vechi (5/30 mese, 30/50 produse) păreau jucărie pentru
-- restaurante adevărate. Noile valori reflectă realitatea: un fine-dining
-- mediu are 100+ mese active în plin sezon, iar un local mare 300+.
--
-- Compatibilitate: TOATE conturile existente sub limita nouă rămân OK.
-- Pentru max_team_members, growth crește 5→10 — beneficiu, nu regresie.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. plan_limits ──────────────────────────────────────────
-- Schema: plan, max_products, max_restaurants, max_tables, ai_imports_month, features
-- Păstrăm max_restaurants și ai_imports_month — nu fac parte din spec-ul nou,
-- au valori istorice rezonabile.
update public.plan_limits
   set max_products = 300, max_tables = 120
 where plan = 'starter';

update public.plan_limits
   set max_products = 1000, max_tables = 300
 where plan = 'growth';

update public.plan_limits
   set max_products = 2000, max_tables = 500
 where plan = 'pro';

-- free + enterprise rămân pe valorile lor (15/3 trial, 1B unlimited).

-- ── 2. plan_features.max_* (limit_value) ────────────────────
-- get_restaurant_features RPC citește de aici, NU din plan_limits.
-- E sursa de adevăr citită de UI (useFeatures hook).

-- max_products
update public.plan_features set limit_value = 300  where plan = 'starter' and feature = 'max_products';
update public.plan_features set limit_value = 1000 where plan = 'growth'  and feature = 'max_products';
update public.plan_features set limit_value = 2000 where plan = 'pro'     and feature = 'max_products';

-- max_tables
update public.plan_features set limit_value = 120 where plan = 'starter' and feature = 'max_tables';
update public.plan_features set limit_value = 300 where plan = 'growth'  and feature = 'max_tables';
update public.plan_features set limit_value = 500 where plan = 'pro'     and feature = 'max_tables';

-- max_team_members — growth crește 5→10 ca să se potrivească cu „echipă până la 10".
update public.plan_features set limit_value = 1    where plan = 'starter' and feature = 'max_team_members';
update public.plan_features set limit_value = 10   where plan = 'growth'  and feature = 'max_team_members';
update public.plan_features set limit_value = 1000 where plan = 'pro'     and feature = 'max_team_members';

-- ── 3. Verificare manuală (post-deploy) ─────────────────────
-- select plan, max_products, max_tables from plan_limits where plan in ('starter','growth','pro');
-- select plan, feature, limit_value from plan_features
--   where feature in ('max_products','max_tables','max_team_members')
--     and plan in ('starter','growth','pro') order by plan, feature;
