-- ═══════════════════════════════════════════════════════════════
-- email_queue reclaim stale-'sending' — mig 167
-- ═══════════════════════════════════════════════════════════════
--   R1 — rând 'sending' vechi (>10 min) → reclaimat + re-claim-uit în același apel (returnat);
--   R2 — rând 'sending' proaspăt (worker încă lucrează) → NU atins, NU returnat;
--   R3 — rând 'queued' normal → claim-uit.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_stale uuid; v_fresh uuid; v_queued uuid;
  v_rows uuid[];
  v_stale_status text; v_fresh_status text;
begin
  -- R1: 'sending' claim-uit acum 11 min → worker mort → trebuie reclaimat
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for, claimed_at)
    values ('stale@x.ro', 'welcome', 'sending', now() - interval '1 hour', now() - interval '11 minutes')
    returning id into v_stale;
  -- R2: 'sending' claim-uit acum (worker probabil încă trimite) → NU se atinge
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for, claimed_at)
    values ('fresh@x.ro', 'welcome', 'sending', now() - interval '1 hour', now())
    returning id into v_fresh;
  -- R3: 'queued' normal → claim-uit
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for)
    values ('queued@x.ro', 'welcome', 'queued', now() - interval '1 minute')
    returning id into v_queued;

  select array_agg(q.id) into v_rows from public.claim_email_batch(30) q;

  -- R1: stale e acum 'sending' (reclaim queued -> re-claim) ȘI returnat de apel
  select status into v_stale_status from public.email_queue where id = v_stale;
  if v_stale_status <> 'sending' then
    raise exception 'R1 FAIL: stale nu e re-claim-uit (status=%)', v_stale_status; end if;
  if not (v_stale = any(v_rows)) then
    raise exception 'R1 FAIL: stale nu a fost returnat de claim_email_batch'; end if;

  -- R2: fresh rămâne 'sending' și NU e returnat
  select status into v_fresh_status from public.email_queue where id = v_fresh;
  if v_fresh_status <> 'sending' then
    raise exception 'R2 FAIL: fresh sending a fost modificat (status=%)', v_fresh_status; end if;
  if v_fresh = any(v_rows) then
    raise exception 'R2 FAIL: fresh sending a fost reclaimat greșit'; end if;

  -- R3: queued normal claim-uit
  if not (v_queued = any(v_rows)) then
    raise exception 'R3 FAIL: queued normal nu a fost claim-uit'; end if;

  raise notice 'mig 167 ALL PASS: reclaim stale-sending corect (stale reluat, fresh intact, queued claim-uit)';
end $$;

rollback;
