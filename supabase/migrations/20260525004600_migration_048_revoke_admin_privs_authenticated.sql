-- ============================================================================
-- Migration 048 — Privilege hardening: revoke TRUNCATE/TRIGGER/REFERENCES
--                 de la `authenticated` pe toate tabelele din public.
-- ============================================================================
-- Context: după 047 (GRANT CRUD selective), `restaurants` returna încă
-- 7 privilegii pentru `authenticated` în loc de strict CRUD:
--   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- Cele 3 extra (REFERENCES/TRIGGER/TRUNCATE) provin din defaults Supabase
-- (de obicei `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated`
-- aplicat la provisioning sau dintr-un setup mai vechi).
--
-- Aceste privilegii NU sunt necesare pentru API-ul normal Supabase:
--   - TRUNCATE   : niciodată folosit din client; doar DBA/maintenance
--   - TRIGGER    : crearea de trigger-i e administrativă
--   - REFERENCES : creare de FK constraints — `authenticated` nu are
--                  oricum CREATE TABLE, deci e unreachable în practică
--
-- Schimbarea e pur restrictivă. RLS și policy-urile nu se ating; nu se
-- modifică cloud code; nu se emit GRANT-uri noi.
-- ============================================================================

begin;

revoke truncate, trigger, references
  on all tables in schema public
  from authenticated;

commit;

-- ============================================================================
-- Verificare post-deploy (Supabase SQL Editor):
--
--   SELECT grantee, privilege_type
--   FROM   information_schema.table_privileges
--   WHERE  table_schema='public'
--     AND  table_name='restaurants'
--     AND  grantee='authenticated'
--   ORDER  BY privilege_type;
--
-- Trebuie să apară exact 4 rânduri:
--   authenticated | DELETE
--   authenticated | INSERT
--   authenticated | SELECT
--   authenticated | UPDATE
-- ============================================================================
