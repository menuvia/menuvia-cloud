-- mig 162 — claim atomic pe email_queue (anti dublu-trimitere) (P2 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (fn-email). process-email-queue făcea SELECT status='queued' apoi, în buclă,
-- UPDATE necondiționat la 'sending' per rând — fără claim atomic. Două rulări suprapuse
-- (cron tick + invocare HTTP, sau două ticks) puteau selecta același rând și trimite emailul
-- de două ori. Oferim un RPC care claim-uiește atomic un batch (UPDATE ... WHERE id IN
-- (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING) → fiecare rând e luat de un singur worker.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.claim_email_batch(p_limit integer default 30)
returns setof public.email_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.email_queue q
     set status = 'sending'
   where q.id in (
     select e.id from public.email_queue e
      where e.status = 'queued'
        and e.scheduled_for <= now()
        and e.failed_attempts < 3
      order by e.scheduled_for asc
      limit greatest(coalesce(p_limit, 30), 1)
      for update skip locked
   )
  returning q.*;
end;
$$;

revoke all on function public.claim_email_batch(integer) from public, anon, authenticated;
-- service_role (folosit de Netlify cu service key) execută RPC-ul.
grant execute on function public.claim_email_batch(integer) to service_role;

do $$
declare v_src text;
begin
  select pg_get_functiondef('public.claim_email_batch(integer)'::regprocedure) into v_src;
  if position('skip locked' in lower(v_src)) = 0 then
    raise exception 'mig 162: claim_email_batch nu foloseste FOR UPDATE SKIP LOCKED';
  end if;
  raise notice 'mig 162: claim_email_batch atomic (anti dublu-trimitere) OK';
end $$;

commit;
