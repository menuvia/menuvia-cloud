-- ============================================================================
-- Migration 047 — GRANT authenticated CRUD pe tabele core + anon SELECT pe
--                 tabelele necesare meniului public.
-- ============================================================================
-- Fix P0: "permission denied for table restaurants" la onboarding step 1.
--
-- Root cause: migrațiile 000-046 nu emit niciun GRANT pe tabelele core
-- pentru rolul `authenticated`. În proiectele Supabase fără default
-- privileges pe schema public (proiecte noi sau resetate), RLS nu mai e
-- consultat — verificarea de role-level GRANT eșuează prima.
--
-- Schimbarea e pur aditivă la nivel de GRANT. RLS rămâne filtrul autoritar
-- pe vizibilitate/scriere — granturile de aici doar deblochează check-ul
-- de role care precede evaluarea policy-urilor.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Schema usage (necesar înainte de orice grant pe tabelă)
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. authenticated: CRUD complet pe tabelele core de business
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on
  public.restaurants,
  public.restaurant_memberships,
  public.restaurant_settings,
  public.profiles,
  public.onboarding_state,
  public.categories,
  public.products,
  public.modifier_groups,
  public.modifier_options,
  public.product_modifier_groups,
  public.product_extras,
  public.product_pairings,
  public.tables,
  public.qr_tokens,
  public.orders,
  public.order_items,
  public.order_payments,
  public.invite_tokens,
  public.vat_rates,
  public.waiter_calls,
  public.waiter_table_assignments,
  public.happy_hour_rules,
  public.ingredients,
  public.recipes,
  public.stock_movements,
  public.suppliers,
  public.purchase_orders,
  public.purchase_order_items,
  public.cash_shifts,
  public.cash_movements,
  public.push_subscriptions,
  public.qr_scans,
  public.page_views
to authenticated;

-- ----------------------------------------------------------------------------
-- 3. authenticated: read-only pe catalogul de plan/features
-- ----------------------------------------------------------------------------
grant select on public.plan_features, public.plan_limits to authenticated;

-- ----------------------------------------------------------------------------
-- 4. anon: SELECT doar pe tabelele necesare randării meniului public
--    (RLS continuă să filtreze la produsele/categoriile active ale
--    restaurantului vizitat)
-- ----------------------------------------------------------------------------
grant select on
  public.categories,
  public.products,
  public.modifier_groups,
  public.modifier_options,
  public.product_modifier_groups,
  public.product_extras,
  public.product_pairings
to anon;

-- Restaurant lookup pentru anon rămâne prin SECURITY DEFINER RPCs:
--   get_restaurant_by_slug, get_restaurant_by_qr_token, resolve_qr_token.
-- Nu se acordă SELECT direct pe public.restaurants către anon.

-- ----------------------------------------------------------------------------
-- 5. Sequences (pentru orice serial/identity create de migrațiile actuale)
-- ----------------------------------------------------------------------------
grant usage, select on all sequences in schema public to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Default privileges pentru tabele/sequences viitoare
--    (DOAR pentru authenticated — anon trebuie acordat explicit per tabelă
--    pentru a ține blast radius-ul mic)
-- ----------------------------------------------------------------------------
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Re-aplică REVOKE-urile intenționate din migrațiile anterioare
--    (idempotent — aceste tabele rămân write-only via RPC)
-- ----------------------------------------------------------------------------
revoke insert, update, delete on public.audit_log      from authenticated, anon;
revoke insert, update, delete on public.order_feedback from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 8. Tabele explicit NEGRANTATE către authenticated/anon
--    (acces exclusiv via SECURITY DEFINER RPCs sau service_role):
--      - bridge_devices, pending_receipts        (Bridge POS local)
--      - invoices, oblio_configs                 (Oblio invoicing)
--      - stripe_events                           (webhook idempotency)
--      - leads, recrutare_leads                  (form-uri via Netlify Fn)
--      - email_queue, lifecycle_events           (worker-i interni)
--      - customer_health_scores                  (analitică admin)
--      - ai_import_log                           (AI import worker)
--      - function_rate_limits                    (rate limiter intern)
-- ----------------------------------------------------------------------------

commit;

-- ============================================================================
-- Verificare post-deploy (Supabase SQL Editor):
--
--   SELECT grantee, privilege_type
--   FROM   information_schema.table_privileges
--   WHERE  table_schema='public' AND table_name='restaurants'
--   ORDER  BY grantee, privilege_type;
--
-- Trebuie să apară 4 rânduri:
--   authenticated | DELETE
--   authenticated | INSERT
--   authenticated | SELECT
--   authenticated | UPDATE
-- ============================================================================
