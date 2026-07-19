-- tests/sql/email_reclaim_assertions.sql
-- =============================================================================
-- Aserție pentru mig 242 (email_queue: reclaim → failed la plafon):
--   EZ1  Un rând 'sending' vechi cu failed_attempts=2 → la reclaim atinge
--        plafonul (3) și devine 'failed', NU rămâne zombie 'queued'.
--   EZ2  Un rând 'sending' vechi cu failed_attempts=0 → reclaim normal la
--        'queued' (încă are retry-uri).
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- email_queue n-are restaurant_id — rânduri minimale blocate în 'sending'.
insert into public.email_queue
  (id, recipient_email, template_kind, template_data, status, claimed_at, failed_attempts)
values
  ('c3330000-0000-4000-8000-000000000301',
   'z@ez.test','welcome','{}','sending', now() - interval '20 minutes', 2),
  ('c3330000-0000-4000-8000-000000000302',
   'r@ez.test','welcome','{}','sending', now() - interval '20 minutes', 0);

do $$
begin
  perform public.claim_email_batch(30);

  -- EZ1: failed_attempts a ajuns la 3 → 'failed', nu 'queued'
  if (select status from public.email_queue where id = 'c3330000-0000-4000-8000-000000000301') <> 'failed' then
    raise exception 'EZ1 FAIL: rândul la plafon a rămas zombie (status: %)',
      (select status from public.email_queue where id = 'c3330000-0000-4000-8000-000000000301');
  end if;

  -- EZ2: încă are retry-uri → reclaim normal la 'queued' (sau deja 'sending'
  -- dacă a fost re-claim-uit în același apel; oricum NU 'failed')
  if (select status from public.email_queue where id = 'c3330000-0000-4000-8000-000000000302') = 'failed' then
    raise exception 'EZ2 FAIL: rândul cu retry-uri rămase a fost abandonat prematur';
  end if;
  raise notice 'EZ1+EZ2 OK: reclaim → failed la plafon, retry normal sub plafon';
end $$;

select 'EMAIL RECLAIM ASSERTIONS: EZ1–EZ2 PASS' as result;

rollback;
