-- tests/sql/auto/306_service_role_rpc_grants.sql
-- =============================================================================
-- Mig 306: fiecare RPC chemat de funcțiile Netlify prin clientul service_role
-- trebuie să fie EXECUTABIL de service_role. Clasa „revoke fără grant"
-- (mig 038/039/041/181/218 → reparate în 274 și 306) e invizibilă în jobul E2E
-- (CLI-ul Supabase nou acordă implicit EXECUTE), dar sql-verify rulează pe
-- Postgres GOL, adică exact regimul producției — aici clasa pică zgomotos.
--
-- Lista de mai jos e SURSA pe care tests/functions/rpc-grants-ratchet.test.js
-- o compară cu apelurile `.rpc('…')` din netlify/functions/*.js: un RPC nou în
-- funcții fără rând aici (sau un rând care nu mai e chemat) face CI roșu.
-- Verificarea e pe NUME, peste TOATE overload-urile: semnăturile se schimbă pe
-- lanț (DROP+CREATE), iar un nume dispărut pică explicit, nu tăcut.
--
--   SR1  fiecare nume din listă există și TOATE overload-urile lui sunt
--        executabile de service_role
--   SR2  cele cinci reparate de 306 NU sunt executabile de anon/authenticated
--   SR3  apel REAL sub rolul service_role (nu doar catalog): check_rate_limit
--        și enqueue_email răspund, nu 42501
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_name text; v_n int; v_bad text[] := '{}'; v_missing text[] := '{}'; r record;
begin
  foreach v_name in array array[
    -- RPC-LIST-START (un nume pe rând, ordonat; folosit de rpc-grants-ratchet.test.js)
    'ai_add_credits_for_event',
    'ai_can_use',
    'ai_record_usage',
    'attach_payment_intent',
    'auto_mark_reservation_no_show',
    'begin_split_payment',
    'begin_table_payment',
    'bridge_mark_stale_as_error',
    'bridge_oblio_get_queued',
    'bridge_oblio_mark_ambiguous',
    'bridge_oblio_mark_failed',
    'bridge_oblio_mark_issued',
    'cancel_table_payment',
    'capture_affiliate_attribution',
    'check_rate_limit',
    'claim_email_batch',
    'claim_pending_slack_alerts',
    'claim_reservation_reminders',
    'claim_sms_batch',
    'cleanup_old_rate_limits',
    'compute_daily_report',
    'compute_health_scores',
    'compute_weekly_report',
    'detect_nps_due',
    'detect_winback_inactive',
    'enqueue_email',
    'enqueue_sms',
    'expire_inactive_sessions',
    'get_cron_janitor_health',
    'get_database_size',
    'get_queue_backlog',
    'get_schema_version',
    'get_table_bill',
    'kitchen_tickets_mark_stale',
    'mark_slack_alert_failed',
    'oblio_reclaim_stale_generating',
    'process_account_deletions',
    'process_affiliate_invoice_paid',
    'process_affiliate_refund',
    'process_lifecycle_events',
    'run_affiliate_payout_batch',
    'set_affiliate_attribution_status',
    'set_restaurant_stripe_account',
    'settle_table_payment'
    -- RPC-LIST-END
  ] loop
    v_n := 0;
    for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_name loop
      v_n := v_n + 1;
      if not has_function_privilege('service_role', r.oid, 'EXECUTE') then
        v_bad := v_bad || (r.oid::regprocedure)::text; end if;
    end loop;
    if v_n = 0 then v_missing := v_missing || v_name; end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'SR1 FAIL: functiile Netlify cheama RPC-uri care NU exista: % (actualizeaza lista SI netlify/functions)', v_missing; end if;
  if array_length(v_bad, 1) > 0 then
    raise exception 'SR1 FAIL: service_role NU poate executa (42501 la runtime, clasa revoke-fara-grant): %', v_bad; end if;
  raise notice 'SR1 OK: toate RPC-urile chemate de netlify/functions sunt executabile de service_role';
end $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.check_rate_limit(text, text, integer, integer)',
    'public.enqueue_email(text, email_template_kind, jsonb, uuid, text, timestamptz, text)',
    'public.bridge_oblio_mark_issued(uuid, text, text, text, text, text)',
    'public.bridge_oblio_mark_failed(uuid, text)',
    'public.bridge_oblio_mark_ambiguous(uuid, text)'
  ] loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') or has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'SR2 FAIL: % e executabila de un rol client', v_sig; end if;
  end loop;
  raise notice 'SR2 OK: cele cinci reparate de 306 raman inchise pentru anon/authenticated';
end $$;

-- SR3: apel real ca service_role. set_config(... , true) e local tranzacției;
-- se revine la postgres înainte de verificări (service_role n-are grant-uri pe
-- tabele în sql-verify). Ambele funcții sunt DEFINER, deci apelul atinge
-- tabelele cu drepturile proprietarului.
do $$
declare v_ok boolean; v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  v_ok := public.check_rate_limit('sr306_probe', 'sr306', 5, 15);
  v_id := public.enqueue_email('sr306-probe@in306.test', 'welcome'::email_template_kind, '{}'::jsonb,
                               null, null, null, 'sr306:probe');
  perform set_config('role', 'none', true);
  if v_ok is distinct from true then
    raise exception 'SR3 FAIL: check_rate_limit ca service_role a intors % (asteptat true pe primul apel)', v_ok; end if;
  raise notice 'SR3 OK: check_rate_limit si enqueue_email raspund sub rolul REAL service_role';
exception when insufficient_privilege then
  perform set_config('role', 'none', true);
  raise exception 'SR3 FAIL: 42501 ca service_role: %', sqlerrm;
end $$;

rollback;
select '306 service_role RPC grants: SR1-SR3 OK' as result;
