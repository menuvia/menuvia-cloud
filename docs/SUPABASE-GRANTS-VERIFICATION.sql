-- ============================================================================
-- docs/SUPABASE-GRANTS-VERIFICATION.sql
--
-- Read-only sanity queries pentru verificarea stării GRANT-urilor și RLS
-- pe proiectul Supabase production, după aplicarea migrațiilor 047 + 048.
--
-- Cum se folosește:
--   Supabase Dashboard → SQL Editor → paste sectiunile dorite → Run.
--   Nu execută DDL/DML — toate query-urile sunt SELECT pe information_schema
--   și pg_catalog. Sigur de rulat oricând, inclusiv în production.
--
-- Așteptat (după 047+048 aplicate):
--   §1 → 4 rânduri exact
--   §2 → 0 rânduri (anon nu are TRUNCATE/TRIGGER/REFERENCES)
--   §3 → 0 rânduri (anon nu are acces la tabele protejate)
--   §4 → 7 rânduri (tabele public-menu cu SELECT)
--   §5 → 0 rânduri (toate tabelele core au RLS enabled)
--   §6 → 2 rânduri (047 și 048 prezente)
-- ============================================================================

-- ============================================================================
-- §1. authenticated trebuie să aibă STRICT CRUD pe restaurants
-- ============================================================================
-- Așteptat: 4 rânduri: DELETE, INSERT, SELECT, UPDATE.
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name   = 'restaurants'
  AND grantee      = 'authenticated'
ORDER BY privilege_type;

-- ============================================================================
-- §2. authenticated NU trebuie să mai aibă TRUNCATE/TRIGGER/REFERENCES
-- ============================================================================
-- Așteptat: 0 rânduri. Dacă apare ceva, migrația 048 nu a fost aplicată.
SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema   = 'public'
  AND grantee        = 'authenticated'
  AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
ORDER BY table_name, privilege_type;

-- ============================================================================
-- §3. anon NU trebuie să aibă acces la restaurants/orders/tables/profiles
-- ============================================================================
-- Așteptat: 0 rânduri. Tabelele sensibile sunt protejate la nivel de GRANT
-- (anon le accesează doar via SECURITY DEFINER RPCs: get_restaurant_by_slug,
-- resolve_qr_token, create_order, etc.).
SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee      = 'anon'
  AND table_name IN (
    'restaurants',
    'orders',
    'order_items',
    'order_payments',
    'tables',
    'qr_tokens',
    'profiles',
    'onboarding_state',
    'restaurant_memberships',
    'restaurant_settings',
    'invite_tokens',
    'cash_shifts',
    'cash_movements',
    'audit_log'
  )
ORDER BY table_name, privilege_type;

-- ============================================================================
-- §4. anon trebuie să aibă SELECT doar pe tabelele public-menu
-- ============================================================================
-- Așteptat: exact 7 rânduri (cele de mai jos, toate cu SELECT).
SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee      = 'anon'
ORDER BY table_name, privilege_type;
-- Tabelele așteptate:
--   categories               | SELECT
--   modifier_groups          | SELECT
--   modifier_options         | SELECT
--   product_extras           | SELECT
--   product_modifier_groups  | SELECT
--   product_pairings         | SELECT
--   products                 | SELECT

-- ============================================================================
-- §5. RLS trebuie să fie ENABLED pe tabelele core
-- ============================================================================
-- Așteptat: 0 rânduri (toate tabelele de mai jos au RLS activ).
-- Orice apariție = RLS dezactivat → leak de date.
SELECT n.nspname AS schema, c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'restaurants',
    'restaurant_memberships',
    'restaurant_settings',
    'profiles',
    'onboarding_state',
    'categories',
    'products',
    'modifier_groups',
    'modifier_options',
    'product_modifier_groups',
    'tables',
    'qr_tokens',
    'orders',
    'order_items',
    'order_payments',
    'invite_tokens',
    'waiter_calls',
    'cash_shifts',
    'cash_movements',
    'audit_log'
  )
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- ============================================================================
-- §6. Migrațiile 047 și 048 trebuie să fie aplicate
-- ============================================================================
-- Așteptat: 2 rânduri (versiunile 20260525004500 și 20260525004600).
-- Tabela `supabase_migrations.schema_migrations` e ținută automat de
-- Supabase CLI / db push.
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260525004500', '20260525004600')
ORDER BY version;

-- ============================================================================
-- §7. (Opțional) Inventory complet — toate granturile pe tabele public
-- ============================================================================
-- Util pentru audit periodic. Așteptat: doar postgres + authenticated + anon,
-- fără alte roluri (cu excepția service_role acolo unde apare).
SELECT grantee,
       count(DISTINCT table_name)                          AS tables_touched,
       string_agg(DISTINCT privilege_type, ',' ORDER BY 1) AS distinct_privs
FROM information_schema.table_privileges
WHERE table_schema = 'public'
GROUP BY grantee
ORDER BY grantee;
