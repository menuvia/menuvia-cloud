-- =============================================================================
-- MIGRATION 306 — EXECUTE pentru service_role pe RPC-urile chemate de funcțiile
-- Netlify care n-au primit NICIODATĂ grant (clasa „revoke fără grant", rest din 274)
-- =============================================================================
-- Mig 038/039/041/181/218 au făcut `revoke all ... from public` cu comentariul
-- „doar service_role" și FĂRĂ niciun `grant ... to service_role`. Pe producție
-- (verificat read-only cu has_function_privilege, 29 oct 2026) ACL-ul celor cinci
-- e `{postgres=X/postgres}`: service_role NU le poate executa. Mig 274 a reparat
-- exact clasa asta pentru șase funcții din aceleași fișiere, dar le-a ratat pe
-- acestea — iar clichetul CJ13 era orb aici, fiindcă lista lui nu conținea
-- enqueue_email. Consecința apare abia la republicarea serverului (azi e mort):
--   • check_rate_limit  → send-invite dă 503 la ORICE invitație; stripe-checkout,
--     stripe-portal, table-payment pică fail-closed (primul trial nu pornește);
--   • enqueue_email     → rapoartele și alertele nu pleacă; send-reservation-
--     reminders resetează reminder_sent_at pe eroare → aceeași rezervare re-
--     revendicată la fiecare 30 de minute;
--   • bridge_oblio_mark_issued/failed/ambiguous → fiecare factură Oblio EMISĂ ar
--     cădea pe ramura ambiguă terminală (mig 218) fiindcă nu se poate marca.
-- Jobul E2E nu prinde clasa (CLI-ul Supabase nou acordă implicit EXECUTE lui
-- service_role); sql-verify (Postgres gol, regimul de producție) o prinde acum
-- prin tests/sql/auto/306_service_role_rpc_grants.sql, iar
-- tests/functions/rpc-grants-ratchet.test.js leagă lista de apelurile `.rpc()`.
--
-- Revoke-urile sunt EXPLICITE per rol: `revoke from public` nu atinge un grant
-- direct (capcana default-privileges din 274). Semnăturile NU se schimbă.
-- =============================================================================
begin;

revoke all on function public.check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;

revoke all on function public.enqueue_email(text, email_template_kind, jsonb, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.enqueue_email(text, email_template_kind, jsonb, uuid, text, timestamptz, text) to service_role;

revoke all on function public.bridge_oblio_mark_issued(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bridge_oblio_mark_issued(uuid, text, text, text, text, text) to service_role;

revoke all on function public.bridge_oblio_mark_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.bridge_oblio_mark_failed(uuid, text) to service_role;

revoke all on function public.bridge_oblio_mark_ambiguous(uuid, text) from public, anon, authenticated;
grant execute on function public.bridge_oblio_mark_ambiguous(uuid, text) to service_role;

-- Fail-closed: grant-ul există, rolurile client NU au EXECUTE.
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
    if to_regprocedure(v_sig) is null then
      raise exception 'mig 306: % nu exista', v_sig; end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'mig 306: service_role nu poate executa %', v_sig; end if;
    if has_function_privilege('anon', v_sig, 'EXECUTE') or has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'mig 306: % e executabila de un rol client', v_sig; end if;
  end loop;
end $$;

commit;
