-- mig 242 — email_queue: rândul care epuizează retry-budgetul prin reclaim
-- devine 'failed', nu rămâne 'queued' zombie
-- ─────────────────────────────────────────────────────────────────────
-- Bug de reziliență (re-audit săpt. 10): pasul de reclaim din claim_email_batch
-- (mig 167) bumpează failed_attempts la fiecare re-punere în 'queued', iar
-- claim-ul filtrează `failed_attempts < 3`. Un rând reclamat de 3 ori (worker
-- mort repetat) ajunge la failed_attempts=3 cu status='queued' și NU mai e nici
-- claim-uit (filtru), nici marcat 'failed' (tranziția la 'failed' trăiește doar
-- în worker, care nu-l mai vede) → email zombie: nu apare în nicio numărătoare
-- de eșecuri, iar RLS-ul de transparență îi arată userului un email etern
-- 'în coadă'. Poate fi o factură / notificare de plată.
--
-- Fix: în pasul de reclaim, când `failed_attempts + 1 >= 3`, rândul devine
-- 'failed' (nu 'queued') — apare în eșecuri, founderul îl retrimite cu
-- admin_retry_email. Restul funcției (lanț →242) IDENTIC cu mig 167.
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
  -- 1) Reclaim: rândurile blocate în 'sending' de un worker care a murit înainte
  -- de update-ul final (claimed acum > 10 min). Le re-punem în 'queued' și
  -- bumpăm failed_attempts — DAR dacă asta atinge plafonul (>= 3), rândul
  -- devine 'failed' (mig 242), nu rămâne zombie 'queued' invizibil.
  update public.email_queue
     set status          = case when failed_attempts + 1 >= 3 then 'failed' else 'queued' end,
         claimed_at      = null,
         failed_attempts = failed_attempts + 1,
         last_error      = case when failed_attempts + 1 >= 3
                                then 'reclaimed de 3 ori (worker mort repetat) — abandonat'
                                else 'reclaimed: blocat in sending > 10 min' end
   where status = 'sending'
     and claimed_at is not null
     and claimed_at < now() - interval '10 minutes';

  -- 2) Claim atomic al unui batch nou (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)).
  return query
  update public.email_queue q
     set status     = 'sending',
         claimed_at = now()
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
grant execute on function public.claim_email_batch(integer) to service_role;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.claim_email_batch(integer)'::regprocedure) into v_src;
  -- pasul de reclaim marchează 'failed' la plafon
  if v_src not ilike '%failed_attempts + 1 >= 3 then ''failed''%' then
    raise exception 'mig 242: reclaim-ul nu marchează failed la plafon (zombie posibil)';
  end if;
  -- claim-ul rămâne gate-uit pe failed_attempts < 3
  if v_src not ilike '%failed_attempts < 3%' then
    raise exception 'mig 242: filtrul failed_attempts < 3 s-a pierdut din claim';
  end if;
  raise notice 'mig 242: email reclaim → failed la plafon OK';
end $$;

commit;
