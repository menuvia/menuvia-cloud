-- migration_279_trigger_fn_execute_lockdown.sql
-- =============================================================================
-- Funcțiile de TRIGGER din `public` nu sunt executabile de rolurile client
-- (advisor Supabase `anon_security_definer_function_executable` /
-- `authenticated_security_definer_function_executable`, măturarea din 16 sept
-- 2026: 41 din 75 de funcții `returns trigger` aveau EXECUTE pentru `anon` și
-- `authenticated`, 30 dintre ele SECURITY DEFINER — `_apply_happy_hour_auto`,
-- `audit_trigger_fn`, `enqueue_fiscal_receipt`, `handle_new_user`,
-- `deduct_stock_on_order_paid`…).
--
-- De ce e inofensiv pentru triggere: Postgres verifică EXECUTE pe funcția de
-- trigger DOAR la `create trigger`, nu la declanșare (trigger.c →
-- ExecCallTriggerFunc nu face aclcheck), deci un INSERT al lui `anon` pe
-- `orders` continuă să tragă trigger-ele exact ca înainte. Jobul E2E din
-- ci.yml (comanda QR reală ca `anon`, pe stack-ul Supabase) e dovada vie.
--
-- De ce merită totuși: PostgREST expune orice funcție cu EXECUTE prin
-- `/rest/v1/rpc/<nume>`. Un apel direct pică azi cu 0A000 („trigger functions
-- can only be called as triggers"), dar suprafața rămâne enumerabilă, iar
-- default privileges din Supabase re-acordă EXECUTE lui anon/authenticated
-- pentru ORICE funcție nouă — deci fără clichet lista crește la fiecare trigger
-- viitor. Clichetul e RP13 în tests/sql/privilege_regime_assertions.sql
-- (poartă READ-ONLY, rulează și în sql-verify, și în E2E).
--
-- Ce NU se atinge: `service_role`/`postgres` (nu sunt roluri client), funcțiile
-- din alte scheme (auth/storage/extensions sunt ale platformei).
-- =============================================================================

begin;

do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    v_n := v_n + 1;
  end loop;
  raise notice 'mig 279: EXECUTE revocat pe % funcții de trigger', v_n;
end$$;

-- Asserție fail-closed: zero funcții de trigger executabile de roluri client.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prorettype = 'trigger'::regtype
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'mig 279: funcții de trigger încă executabile de anon/authenticated: %', v_bad;
  end if;
end$$;

-- Control pozitiv (anti-vacuitate): trigger-ele chiar există și mai trag.
-- Pe replay-ul complet al lanțului sunt >70 de funcții de trigger în public;
-- pragul e deliberat mai jos (număr ca PRAG, nu egalitate — disciplina RP3).
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype;
  if v_cnt < 40 then
    raise exception 'mig 279 (anti-vacuitate): doar % funcții de trigger în public — lanțul nu e cel așteptat', v_cnt;
  end if;
end$$;

commit;
