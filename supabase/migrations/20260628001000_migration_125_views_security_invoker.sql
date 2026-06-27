-- mig 125 — Fix P0/P1 (leak cross-tenant): security_invoker pe 3 view-uri ratate (VIEW-SI-1)
--
-- Auditul rundei 2 (rls_rpc_gating). Pattern-ul cunoscut (mig 008/112/116): un view
-- fara security_invoker ruleaza cu drepturile OWNER-ului (definer), deci ocoleste RLS
-- al tabelelor sursa => orice utilizator autentificat care interogheaza view-ul vede
-- randuri din TOATE restaurantele. Trei view-uri au fost ratate la rundele anterioare:
--
--   1. vat_report_daily  (mig 029) — venit + TVA pe zi/grupa. P0: leak venit/TVA
--      cross-tenant + expune date fiscale (Plan 3) catre orice cont.
--   2. v_audit_recent    (mig 044) — istoricul de modificari (audit_log). P0: bypass
--      RLS pe audit_log, leak cross-tenant al cine/ce a modificat (PII actor + diff).
--   3. v_restaurant_feedback_summary (mig 043) — agregate feedback. P1: leak
--      cross-tenant al ratingurilor/volumelor altui restaurant.
--
-- Fix: ALTER VIEW ... SET (security_invoker = true) — schimba DOAR modul de evaluare,
-- nu si definitia view-ului, deci RLS-ul tabelelor sursa (orders/order_items/
-- audit_log/order_feedback) se aplica corect pe apelant. Zero risc de drift de SQL.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

alter view public.vat_report_daily              set (security_invoker = true);
alter view public.v_audit_recent                set (security_invoker = true);
alter view public.v_restaurant_feedback_summary set (security_invoker = true);

-- ── Asertiune inline (fail-closed in CI) ─────────────────────────────────────
do $$
declare
  v_name text;
  v_opts text;
begin
  foreach v_name in array array['vat_report_daily','v_audit_recent','v_restaurant_feedback_summary']
  loop
    select coalesce(array_to_string(reloptions, ','), '') into v_opts
    from pg_class where relname = v_name and relnamespace = 'public'::regnamespace and relkind = 'v';
    if position('security_invoker=true' in coalesce(v_opts, '')) = 0 then
      raise exception 'mig 125: view % nu are security_invoker=true (reloptions=%)', v_name, v_opts;
    end if;
  end loop;
  raise notice 'mig 125: security_invoker=true pe vat_report_daily + v_audit_recent + v_restaurant_feedback_summary OK';
end $$;

commit;
