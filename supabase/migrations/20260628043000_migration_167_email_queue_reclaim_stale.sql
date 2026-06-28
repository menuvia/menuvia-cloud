-- mig 167 — reclaim email-uri blocate în 'sending' (worker mort mid-batch) (follow-up review CodeRabbit)
-- ─────────────────────────────────────────────────────────────────────
-- claim_email_batch (mig 162) marchează rândurile 'sending' atomic, dar dacă workerul moare
-- ÎNAINTE de update-ul final per-email (status -> 'sent'/'failed'/'queued'), rândul rămâne
-- 'sending' la nesfârșit → emailul nu se mai trimite niciodată (nici reluat, nici raportat).
-- Fix: coloană `claimed_at` (momentul claim-ului) + reclaim în RPC al rândurilor 'sending'
-- mai vechi de 10 min → re-puse în 'queued' (cu bump failed_attempts ca să nu se reia infinit;
-- filtrul existent failed_attempts < 3 oprește după 3 încercări). Recreare RPC, semnătură +
-- grants + search_path IDENTICE cu mig 162.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- claimed_at: momentul în care un worker a luat rândul (status -> 'sending'); NULL altfel.
alter table public.email_queue add column if not exists claimed_at timestamptz;

-- Index parțial pe rândurile în curs de trimitere — reclaim-ul scanează doar 'sending'.
create index if not exists idx_email_queue_sending_claimed
  on public.email_queue(claimed_at) where status = 'sending';

create or replace function public.claim_email_batch(p_limit integer default 30)
returns setof public.email_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1) Reclaim: rândurile blocate în 'sending' de un worker care a murit înainte de update-ul
  -- final (claimed acum > 10 min). Le re-punem în 'queued' și bumpăm failed_attempts.
  update public.email_queue
     set status          = 'queued',
         claimed_at      = null,
         failed_attempts = failed_attempts + 1,
         last_error      = 'reclaimed: blocat in sending > 10 min'
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
-- service_role (folosit de Netlify cu service key) execută RPC-ul.
grant execute on function public.claim_email_batch(integer) to service_role;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='email_queue' and column_name='claimed_at'
  ) then
    raise exception 'mig 167: coloana email_queue.claimed_at lipsește';
  end if;

  select pg_get_functiondef('public.claim_email_batch(integer)'::regprocedure) into v_src;
  if position('skip locked' in lower(v_src)) = 0 then
    raise exception 'mig 167: claim_email_batch nu mai folosește FOR UPDATE SKIP LOCKED';
  end if;
  if position('reclaimed' in lower(v_src)) = 0 then
    raise exception 'mig 167: reclaim-ul stale-sending lipsește din claim_email_batch';
  end if;

  -- grants: PUBLIC/anon/authenticated zero EXECUTE, service_role da.
  if has_function_privilege('authenticated', 'public.claim_email_batch(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_email_batch(integer)', 'EXECUTE') then
    raise exception 'mig 167: claim_email_batch nu trebuie executabil de anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.claim_email_batch(integer)', 'EXECUTE') then
    raise exception 'mig 167: service_role trebuie să poată executa claim_email_batch';
  end if;

  raise notice 'mig 167: reclaim stale-sending + claimed_at OK';
end $$;

commit;
