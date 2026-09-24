-- tests/sql/janitor_liveness_assertions.sql
-- =============================================================================
-- Asserții PERMANENTE pentru mig 275 — clasa „funcție de mentenanță care ARATĂ
-- ca igienă dar nu face nimic" + proba fiscală din `pending_receipts`.
--
-- Clasa are trei sub-forme, iar un clichet care le prinde pe toate trebuie să
-- EXECUTE funcția și să-i ceară EFECT, nu să-i citească textul:
--   S1  predicat care nu se poate potrivi NICIODATĂ → no-op TĂCUT, exit 0
--       (`pending_receipts_cleanup_old`, mig 035: `status='completed'`).
--   S2  referință la o coloană inexistentă → 42703 ZGOMOTOS
--       (`bridge_devices_mark_stale`, mig 035).
--   S3  funcție vie dar NEapelabilă de worker (grant lipsă) — CJ13 din
--       tests/sql/pgcron_janitors_assertions.sql (mig 274 a reparat cele 6).
-- De aceea aici e CONTROL POZITIV: însămânțăm o fixtură pe care predicatul
-- TREBUIE s-o prindă, chemăm funcția și cerem efect > 0 — disciplina `CANARIES`
-- a porții OSV, fiindcă „am evaluat și n-am găsit nimic" și „n-am evaluat
-- nimic" sunt byte-cu-byte identice.
--
--   JL1  setul DESCOPERIT structural (DML cu fereastră de timp + zero argumente
--        de tip referință; funcții ȘI proceduri — pg_cron CHEAMĂ proceduri) ==
--        registrul explicit, în AMBELE direcții. O migrație VIITOARE care adaugă
--        un janitor face CI-ul roșu până primește un control pozitiv. Registrul
--        NU poate declara un janitor REAL ca `expect_pass=false` (ușa din dos):
--        doar canarele din pg_temp au voie să eșueze.
--   JL2  canare prin ACELAȘI harness: cele DOUĂ corpuri șterse de mig 275,
--        verbatim (trebuie să PICE) + unul VIU (trebuie să TREACĂ) + o PROCEDURĂ
--        vie (dovada că widening-ul pe prokind e el însuși controlat).
--   JL3  control pozitiv pentru fiecare janitor din registru.
--   JL4  suprafața de mentenanță nu e executabilă din anon/authenticated.
--   JL5  rolurile client nu au DELETE și nimeni în afară de proprietar nu are
--        TRUNCATE pe `pending_receipts` (TRUNCATE ocolește trigger-ele ROW) —
--        dar SELECT (BridgeTab) și INSERT (enqueue 259 ca authenticated) rămân.
--   JL6  gate-ul e în DATE: (a) formă de catalog — tgtype 11 EXACT, DEFINER +
--        pg_temp; (b) COMPORTAMENT — orice rând refuzat cât timp restaurantul
--        există (inclusiv ca `postgres`, inclusiv prin cascada de la `orders`,
--        inclusiv repararea naivă a janitorului mort); erasure de tenant liber,
--        inclusiv pe calea REALĂ `process_account_deletions`.
--   JL7  CLASĂ, pe TABELĂ: nicio funcție/procedură din `public` nu ȘTERGE din
--        `pending_receipts`. Cu CANAR (asserție de ABSENȚĂ).
--   JL8  premisele deciziei „fără ștergere automată": `bon_number` are exact o
--        copie VIE în schemă (+ arhiva GDPR din mig 284, `retained_receipts`,
--        cu UN singur scriitor) și NICIUN trigger de pe tabelă nu scrie în audit_log
--        (pe COMPORTAMENT — orice funcție de trigger al cărei corp pomenește
--        audit_log — nu pe numele unei singure funcții).
--   JL9  CHECK-ul de status admite exact cele 5 valori.
--
-- NOTĂ (audit_log): `audit_log_cleanup` e chemată aici ca SONDĂ, într-o
-- tranzacție care se ROLLBACK-uiește. NU e și NU implică programarea ștergerii
-- de rânduri din `audit_log` — jurnal FISCAL, decizie de FONDATOR.
--
-- Self-contained, ROLLBACK la final (fiecare caz JL2/JL3 într-o subtranzacție
-- proprie, derulată prin `raise`).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed comun ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('7a000000-0000-4000-8000-000000000001', 'jl-owner@jl.test');
update public.profiles set plan = 'pro' where id = '7a000000-0000-4000-8000-000000000001';
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('7ab00000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 'JL Pro', 'jl-pro', 'Cluj', true),
  ('7ab00000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000001', 'JL Z',   'jl-z',   'Cluj', true);
insert into public.tables (id, restaurant_id, name, slug) values
  ('7ac00000-0000-4000-8000-000000000001', '7ab00000-0000-4000-8000-000000000001', 'JL1', 'jl1');
insert into public.orders (id, restaurant_id, source, status, total) values
  ('7af00000-0000-4000-8000-000000000001', '7ab00000-0000-4000-8000-000000000001', 'waiter', 'served', 50),
  ('7af00000-0000-4000-8000-000000000002', '7ab00000-0000-4000-8000-000000000001', 'waiter', 'served', 50);

-- ══ JL1: setul DESCOPERIT structural == registrul explicit ═══════════════════
create temp table jl_discovered as
select p.oid, p.proname, p.prokind
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f', 'p')
   and p.prosrc ~* '(delete[[:space:]]+from|update[[:space:]]+(public\.)?[a-z_]+[[:space:]]+set)'
   and p.prosrc ~* 'now\(\)[[:space:]]*-'
   and not exists (
     select 1 from unnest(p.proargtypes::oid[]) t(o)
      where t.o not in ('int2'::regtype::oid, 'int4'::regtype::oid, 'int8'::regtype::oid,
                        'numeric'::regtype::oid, 'bool'::regtype::oid, 'interval'::regtype::oid));

create temp table jl_registry (
  ord int, fn text, expect_pass boolean, min_effect bigint, fixture text, probe text);

insert into jl_registry values
 (1, 'pg_temp.jl_canary_dead_predicate', false, 1, $x$
    insert into public.pending_receipts (restaurant_id, order_id, payload, status, total_snapshot, completed_at)
    select '7ab00000-0000-4000-8000-000000000001', '7af00000-0000-4000-8000-000000000001', 'X', s, 50, now() - interval '400 days'
      from unnest(array['error','cancelled']) s;
  $x$, $x$select pg_temp.jl_canary_dead_predicate()::bigint$x$),
 (2, 'pg_temp.jl_canary_missing_column', false, 1, $x$
    update public.bridge_devices set last_seen_at = now() - interval '400 days'
     where restaurant_id = '7ab00000-0000-4000-8000-000000000001';
  $x$, $x$select pg_temp.jl_canary_missing_column()::bigint$x$),
 (3, 'pg_temp.jl_canary_live', true, 1, $x$
    insert into public.function_rate_limits (function_name, scope_key, window_start, request_count)
    values ('jl_canary', 'jl', now() - interval '400 days', 1);
  $x$, $x$select pg_temp.jl_canary_live()::bigint$x$),
 (4, 'pg_temp.jl_canary_live_procedure', true, 1, $x$
    insert into public.function_rate_limits (function_name, scope_key, window_start, request_count)
    values ('jl_canary_proc', 'jl', now() - interval '400 days', 1);
  $x$, $x$select pg_temp.jl_canary_live_procedure_probe()::bigint$x$),
 (10, 'audit_log_cleanup', true, 1, $x$
    insert into public.audit_log (created_at, table_name, operation, row_id)
    values (now() - interval '400 days', 'orders', 'UPDATE', 'jl-probe');
  $x$, $x$select public.audit_log_cleanup(365)::bigint$x$),
 (11, 'cleanup_old_rate_limits', true, 1, $x$
    insert into public.function_rate_limits (function_name, scope_key, window_start, request_count)
    values ('jl_probe', 'jl', now() - interval '400 days', 1);
  $x$, $x$select public.cleanup_old_rate_limits()::bigint$x$),
 (12, 'bridge_mark_stale_as_error', true, 1, $x$
    insert into public.pending_receipts (restaurant_id, order_id, payload, status, total_snapshot, claimed_at)
    values ('7ab00000-0000-4000-8000-000000000001', '7af00000-0000-4000-8000-000000000001', 'X', 'sent', 50, now() - interval '20 minutes');
  $x$, $x$select public.bridge_mark_stale_as_error()::bigint$x$),
 (13, 'expire_inactive_sessions', true, 1, $x$
    insert into public.table_sessions (restaurant_id, table_id, status, last_activity_at)
    values ('7ab00000-0000-4000-8000-000000000001', '7ac00000-0000-4000-8000-000000000001', 'open', now() - interval '10 hours');
  $x$, $x$select public.expire_inactive_sessions(1)::bigint$x$),
 (14, 'kitchen_tickets_mark_stale', true, 1, $x$
    insert into public.kitchen_tickets (restaurant_id, order_id, payload, status, claimed_at)
    values ('7ab00000-0000-4000-8000-000000000001', '7af00000-0000-4000-8000-000000000001', 'X', 'sent', now() - interval '20 minutes');
    insert into public.kitchen_tickets (restaurant_id, order_id, payload, status, completed_at)
    values ('7ab00000-0000-4000-8000-000000000001', '7af00000-0000-4000-8000-000000000001', 'X', 'success', now() - interval '40 days');
  $x$, -- `least(stale, purged)` cere AMBELE ramuri; funcția se cheamă O SINGURĂ dată
      $x$select least((j->>'stale')::bigint, (j->>'purged')::bigint)
             from (select public.kitchen_tickets_mark_stale() as j) t$x$),
 (15, 'oblio_reclaim_stale_generating', true, 1, $x$
    insert into public.invoices (restaurant_id, order_id, customer_name, total_with_vat, status, generating_since)
    values ('7ab00000-0000-4000-8000-000000000001', '7af00000-0000-4000-8000-000000000001', 'JL', 50, 'generating', now() - interval '2 hours');
  $x$, $x$select public.oblio_reclaim_stale_generating(60)::bigint$x$),
 (16, 'claim_email_batch', true, 2, $x$
    insert into public.email_queue (recipient_email, template_kind, status, scheduled_for)
    values ('jl-a@jl.test', 'welcome', 'queued', now() - interval '1 hour');
    insert into public.email_queue (recipient_email, template_kind, status, scheduled_for, claimed_at)
    values ('jl-b@jl.test', 'welcome', 'sending', now() - interval '2 hours', now() - interval '20 minutes');
  $x$, $x$select count(*)::bigint from public.claim_email_batch(30)$x$),
 (17, 'claim_sms_batch', true, 2, $x$
    insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, status, scheduled_for)
    values ('7ab00000-0000-4000-8000-000000000001', '0722000111', 'pickup_ready', 'queued', now() - interval '1 hour');
    insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, status, scheduled_for, claimed_at)
    values ('7ab00000-0000-4000-8000-000000000001', '0722000112', 'pickup_ready', 'sending', now() - interval '2 hours', now() - interval '20 minutes');
  $x$, $x$select count(*)::bigint from public.claim_sms_batch(30)$x$),
 (18, 'process_account_deletions', true, 1, $x$
    insert into auth.users (id, email) values ('7a000000-0000-4000-8000-0000000000de', 'jl-gdpr@jl.test');
    update public.profiles set deletion_requested_at = now() - interval '40 days'
     where id = '7a000000-0000-4000-8000-0000000000de';
  $x$, $x$select count(*)::bigint from public.process_account_deletions()$x$),
 (19, 'cron_prune_run_details', true, 1, $x$
    -- mig 274: pruner-ul e no-op fara pg_cron; controlul pozitiv ii da o
    -- schema `cron` SIMULATA (forma pg_cron 1.6) daca lipseste (sql-verify),
    -- sau foloseste tabela REALA (E2E) — in ambele cazuri subtranzactia se
    -- deruleaza.
    do $d$ begin
      if to_regclass('cron.job_run_details') is null then
        execute 'create schema cron';
        execute 'create table cron.job_run_details (jobid bigint, runid bigserial primary key, status text, start_time timestamptz, end_time timestamptz)';
      end if;
      execute 'insert into cron.job_run_details (jobid, status, start_time, end_time) values (1, ''succeeded'', now() - interval ''30 days'', now() - interval ''30 days'')';
    end $d$;
  $x$, $x$select public.cron_prune_run_details(7)::bigint$x$);

do $$
declare v_extra text[]; v_missing text[];
begin
  select array_agg(proname order by proname) into v_extra
    from jl_discovered d
   where not exists (select 1 from jl_registry r where r.fn = d.proname);
  select array_agg(fn order by fn) into v_missing
    from jl_registry r
   where r.fn not like 'pg_temp.%'
     and not exists (select 1 from jl_discovered d where d.proname = r.fn);
  if v_extra is not null then
    raise exception 'JL1 FAIL: functii/proceduri de mentenanta DESCOPERITE dar NEdeclarate: % — adauga-le in registru cu un control pozitiv (sau sterge functia)', v_extra; end if;
  if v_missing is not null then
    raise exception 'JL1 FAIL: in registru dar NU mai exista: %', v_missing; end if;
  -- Usa din dos: un janitor REAL nu poate fi declarat ca „se asteapta sa pice".
  if exists (select 1 from jl_registry where expect_pass = false and fn not like 'pg_temp.%') then
    raise exception 'JL1 FAIL: un janitor real e inregistrat cu expect_pass=false — da-i un control pozitiv sau sterge functia'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('pending_receipts_cleanup_old','bridge_devices_mark_stale')) then
    raise exception 'JL1 FAIL: un janitor MORT sters de mig 275 a reaparut — citeste antetul migratiei inainte de a-l „repara"'; end if;
  raise notice 'JL1 OK: % functii/proceduri de mentenanta descoperite == registru', (select count(*) from jl_discovered);
end $$;

-- ══ JL2 + JL3: canare + controale pozitive, prin ACELAȘI harness ════════════
-- Canarele stau în `pg_temp`, deci JL1 (ancorat pe nspname='public') NU le vede.
-- Corpurile 1–2 sunt COPII VERBATIM ale funcțiilor șterse de mig 275.
create function pg_temp.jl_canary_dead_predicate() returns int language plpgsql as $f$
declare v int; begin
  delete from public.pending_receipts
   where status = 'completed' and completed_at < now() - interval '90 days';
  get diagnostics v = row_count; return v; end $f$;

create function pg_temp.jl_canary_missing_column() returns int language plpgsql as $f$
declare v int; begin
  update public.bridge_devices set is_active = false
   where is_active = true and (last_heartbeat is null or last_heartbeat < now() - interval '30 days');
  get diagnostics v = row_count; return v; end $f$;

create function pg_temp.jl_canary_live() returns int language plpgsql as $f$
declare v int; begin
  delete from public.function_rate_limits
   where function_name = 'jl_canary' and window_start < now() - interval '90 days';
  get diagnostics v = row_count; return v; end $f$;

-- Canar-PROCEDURĂ: JL1 descoperă și prokind='p' (pg_cron cheamă proceduri);
-- proba trece printr-o funcție-înveliș fiindcă o procedură nu întoarce valoare.
create procedure pg_temp.jl_canary_live_procedure(inout v_out int) language plpgsql as $f$
begin
  delete from public.function_rate_limits
   where function_name = 'jl_canary_proc' and window_start < now() - interval '90 days';
  get diagnostics v_out = row_count; end $f$;
create function pg_temp.jl_canary_live_procedure_probe() returns int language plpgsql as $f$
declare v int := 0; begin call pg_temp.jl_canary_live_procedure(v); return v; end $f$;

do $$
declare r record; v bigint; v_ok boolean; v_why text; v_fail text[] := '{}';
begin
  for r in select * from jl_registry order by ord loop
    v_ok := false; v_why := null;
    -- Sub-tranzacție per caz: `raise` la final o derulează, inclusiv fixtura.
    begin
      execute r.probe;    -- DRENĂ: consumă orice a lăsat replay-ul
      execute r.fixture;
      execute r.probe into v;
      if v is null then v_why := 'efect NULL';
      elsif v < r.min_effect then v_why := format('efect %s < min %s', v, r.min_effect);
      else v_ok := true; end if;
      raise exception 'JL_ROLLBACK';
    exception when others then
      if sqlerrm <> 'JL_ROLLBACK' then v_ok := false; v_why := format('%s: %s', sqlstate, sqlerrm); end if;
    end;
    if v_ok <> r.expect_pass then
      v_fail := v_fail || format('%s: expect_pass=%s, control %s (%s)', r.fn, r.expect_pass,
        case when v_ok then 'a TRECUT' else 'a PICAT' end, coalesce(v_why, '-'));
    end if;
  end loop;
  if array_length(v_fail, 1) > 0 then
    raise exception E'JL2/JL3 FAIL:\n  %', array_to_string(v_fail, E'\n  '); end if;
  raise notice 'JL2/JL3 OK: 4 canare discrimineaza + % janitoare fac munca reala',
    (select count(*) from jl_registry where fn not like 'pg_temp.%');
end $$;

-- ══ JL4: suprafața de mentenanță nu e executabilă din client ════════════════
do $$
declare v_bad text[];
begin
  select array_agg(proname order by proname) into v_bad from jl_discovered
   where has_function_privilege('anon', oid, 'EXECUTE')
      or has_function_privilege('authenticated', oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'JL4 FAIL: janitoare executabile din client: %', v_bad; end if;
  raise notice 'JL4 OK: zero EXECUTE pentru anon/authenticated pe suprafata de mentenanta';
end $$;

-- ══ JL5: rolurile client nu pot ȘTERGE, nimeni nu poate TRUNCHIA ═══════════
do $$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.pending_receipts', 'DELETE') then
      raise exception 'JL5 FAIL: % are DELETE pe pending_receipts (grant-ul mig 030, revocat de 275)', v_role; end if;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.pending_receipts', 'TRUNCATE') then
      raise exception 'JL5 FAIL: % are TRUNCATE pe pending_receipts — TRUNCATE ocoleste trigger-ele ROW, deci gate-ul JL6', v_role; end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.pending_receipts', 'SELECT')
     or not has_table_privilege('authenticated', 'public.pending_receipts', 'INSERT') then
    raise exception 'JL5 FAIL: revoke-ul a taiat mai mult decat DELETE/TRUNCATE (BridgeTab citeste; enqueue-ul 259 insereaza ca authenticated)'; end if;
  raise notice 'JL5 OK: DELETE/TRUNCATE revocate, SELECT/INSERT intacte';
end $$;

-- ══ JL6a: forma de catalog a gate-ului ═════════════════════════════════════
do $$
declare v_tgtype int2; v_src text; v_cfg text[];
begin
  select t.tgtype into v_tgtype from pg_trigger t
   where t.tgrelid = 'public.pending_receipts'::regclass
     and t.tgname = 'trg_pending_receipts_block_delete';
  if v_tgtype is null then raise exception 'JL6 FAIL: trigger-ul lipseste'; end if;
  if v_tgtype <> 11 then
    raise exception 'JL6 FAIL: tgtype=% (asteptat 11 = ROW+BEFORE+DELETE; un AFTER nu ar putea opri stergerea)', v_tgtype; end if;
  select pg_get_functiondef(p.oid), p.proconfig into v_src, v_cfg from pg_proc p
   where p.oid = 'public.fn_pending_receipts_block_delete()'::regprocedure;
  if position('security definer' in lower(v_src)) = 0
     or not exists (select 1 from unnest(v_cfg) c where c like 'search_path=%pg_temp%') then
    raise exception 'JL6 FAIL: functia trebuie DEFINER + pg_temp — daca o migratie viitoare re-acorda DELETE unui rol client, sub INVOKER `select 1 from restaurants` ar trece prin RLS si un apelant fara apartenenta ar vedea parintele „disparut"'; end if;
  raise notice 'JL6a OK: ROW BEFORE DELETE, DEFINER + pg_temp';
end $$;

-- ══ JL6b: COMPORTAMENTUL gate-ului ═════════════════════════════════════════
do $$
declare v_n int; v_bad text[] := '{}'; v_hint text;
begin
  insert into public.pending_receipts (id, restaurant_id, order_id, payload, status, total_snapshot, bon_number, error_info, completed_at) values
   ('7a100000-0000-4000-8000-000000000001','7ab00000-0000-4000-8000-000000000001','7af00000-0000-4000-8000-000000000002','X','success',50,'NRBON-000123',null, now()-interval '400 days'),
   ('7a100000-0000-4000-8000-000000000002','7ab00000-0000-4000-8000-000000000001','7af00000-0000-4000-8000-000000000002','X','error',50,'NRBON-000124',null, now()-interval '400 days'),
   ('7a100000-0000-4000-8000-000000000003','7ab00000-0000-4000-8000-000000000001','7af00000-0000-4000-8000-000000000002','X','cancelled',50,null,'POSIBIL DUPLICAT — verifica banda', now()-interval '400 days'),
   ('7a100000-0000-4000-8000-000000000004','7ab00000-0000-4000-8000-000000000001','7af00000-0000-4000-8000-000000000002','X','sent',50,null,null, now()-interval '400 days'),
   ('7a100000-0000-4000-8000-000000000005','7ab00000-0000-4000-8000-000000000001','7af00000-0000-4000-8000-000000000002','X','pending',50,null,null, now()-interval '400 days'),
   -- terminal, fara bon, fara marker: TOT refuzat (tinta vie a bridge_retry_receipt)
   ('7a100000-0000-4000-8000-000000000006','7ab00000-0000-4000-8000-000000000001','7af00000-0000-4000-8000-000000000002','X','cancelled',50,null,'Force-resolved de admin — NOT printed', now()-interval '400 days');

  -- (a) fiecare rand e REFUZAT chiar si ca `postgres` (superuser: ocoleste RLS
  --     si ACL-ul, dar NU trigger-ele). Verificam pe HINT, nu pe SQLSTATE.
  for v_n in 1..6 loop
    begin
      execute format('delete from public.pending_receipts where id = %L',
        ('7a100000-0000-4000-8000-00000000000' || v_n)::uuid);
      v_bad := v_bad || format('randul %s s-a sters', v_n);
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint is distinct from 'fiscal_evidence_delete' then raise; end if;
    end;
  end loop;
  if array_length(v_bad,1) > 0 then
    raise exception 'JL6 FAIL: rand din pending_receipts sters cu restaurantul viu: %', v_bad; end if;

  -- (b) REPARAREA NAIVA a janitorului mort esueaza ZGOMOTOS, nu tacut
  begin
    delete from public.pending_receipts
     where status = 'success' and completed_at < now() - interval '90 days';
    raise exception 'JL6 FAIL: repararea naiva (status=''success'') a sters proba fiscala';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'fiscal_evidence_delete' then raise; end if;
  end;

  -- (c) USA DIN DOS: cascada de la `orders` e REFUZATA (restaurantul e viu).
  --     Calea pe care un gate pe ROL ar fi ratat-o: in cascada, copilul vede
  --     current_user=postgres.
  begin
    delete from public.orders where id = '7af00000-0000-4000-8000-000000000002';
    raise exception 'JL6 FAIL: stergerea comenzii a distrus proba fiscala prin cascada';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'fiscal_evidence_delete' then raise; end if;
  end;
  if (select count(*) from public.pending_receipts where order_id = '7af00000-0000-4000-8000-000000000002') <> 6 then
    raise exception 'JL6 FAIL: cascada refuzata a lasat totusi randuri lipsa'; end if;

  -- (d) ERASURE de tenant: cascada de la `restaurants` e PERMISA, chiar peste un
  --     rand cu bon fara order_id (report_z) — altfel stergerea contului esueaza
  insert into public.pending_receipts (restaurant_id, order_id, payload, status, total_snapshot, bon_number, command_type)
  values ('7ab00000-0000-4000-8000-000000000002', null, 'X', 'success', 0, 'NRZ-000001', 'report_z');
  begin
    delete from public.restaurants where id = '7ab00000-0000-4000-8000-000000000002';
  exception when others then
    raise exception 'JL6 FAIL: cascada de la restaurants (erasure) a fost blocata de gate: % %', sqlstate, sqlerrm;
  end;
  if exists (select 1 from public.pending_receipts where bon_number = 'NRZ-000001') then
    raise exception 'JL6 FAIL: cascada de la restaurants nu a sters randul'; end if;

  -- (e) erasure GDPR pe calea REALA (process_account_deletions: auth.users →
  --     profiles → restaurants → orders → pending_receipts). Functia are
  --     `exception when others then continue`, deci un gate care ar bloca
  --     erasure-ul s-ar vedea ca „0 useri stersi", NU ca eroare.
  insert into auth.users (id, email) values ('7a000000-0000-4000-8000-0000000000f1', 'jl-erase@jl.test');
  update public.profiles set plan = 'pro' where id = '7a000000-0000-4000-8000-0000000000f1';
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    ('7ab00000-0000-4000-8000-000000000003', '7a000000-0000-4000-8000-0000000000f1', 'JL Erase', 'jl-erase', 'Cluj', true);
  insert into public.orders (id, restaurant_id, source, status, total) values
    ('7af00000-0000-4000-8000-0000000000f1', '7ab00000-0000-4000-8000-000000000003', 'waiter', 'served', 50);
  insert into public.pending_receipts (restaurant_id, order_id, payload, status, total_snapshot, bon_number)
  values ('7ab00000-0000-4000-8000-000000000003', '7af00000-0000-4000-8000-0000000000f1', 'X', 'success', 50, 'NRBON-ERASE');
  update public.profiles set deletion_requested_at = now() - interval '40 days'
   where id = '7a000000-0000-4000-8000-0000000000f1';
  if (select count(*) from public.process_account_deletions()) <> 1 then
    raise exception 'JL6 FAIL: erasure GDPR blocat de gate (userul a fost SARIT tacut)'; end if;
  if exists (select 1 from public.pending_receipts where bon_number = 'NRBON-ERASE') then
    raise exception 'JL6 FAIL: erasure GDPR nu a sters bonul'; end if;

  raise notice 'JL6b OK: orice rand refuzat cat timp restaurantul exista (direct, ca postgres, prin cascada de comanda, prin repararea naiva); erasure de tenant liber';
end $$;

-- ══ JL7: nicio funcție/procedură nu ȘTERGE din pending_receipts (+ CANAR) ══
create or replace function pg_temp.jl_detect_pr_deleters() returns text
language sql stable as $$
  select string_agg(p.proname, ',' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* 'delete[[:space:]]+from[[:space:]]+(public\.)?pending_receipts'
$$;

do $$
declare v text;
begin
  v := pg_temp.jl_detect_pr_deleters();
  if v is not null then
    raise exception 'JL7 FAIL: functii care STERG din pending_receipts: % — registrul fiscal nu se elagheaza din cod (mig 275)', v; end if;
end $$;

-- CANAR: „zero semnalari" e identic cu „detectorul s-a rupt la un refactor".
create function public._jl_canary_pr_deleter() returns int
language plpgsql as $$
begin delete from public.pending_receipts where status = 'completed'; return 0; end $$;

do $$
declare v text;
begin
  v := pg_temp.jl_detect_pr_deleters();
  if v is distinct from '_jl_canary_pr_deleter' then
    raise exception 'JL7 FAIL (control pozitiv): detectorul a intors % (asteptat exact canarul)', coalesce(v,'NULL'); end if;
end $$;
drop function public._jl_canary_pr_deleter();
do $$ begin raise notice 'JL7 OK: nicio functie nu sterge din pending_receipts (detector verificat cu canar)'; end $$;

-- ══ JL8: premisele deciziei „fără ștergere automată" ═══════════════════════
do $$
declare v_tbl text[]; v_trg text[];
begin
  select array_agg(table_name || '.' || column_name order by table_name) into v_tbl
    from information_schema.columns where table_schema = 'public' and column_name = 'bon_number';
  -- mig 284 a adăugat A DOUA coloană, re-examinată: `retained_receipts` e
  -- arhiva jurnalului pentru tenanți DEJA ȘTERȘI (GDPR), deci pentru un
  -- restaurant VIU `pending_receipts` rămâne singura copie și decizia din 275
  -- („nu se șterge") stă în picioare. Premisa ține DOAR cât timp arhiva are un
  -- singur scriitor — altfel ar deveni o copie „vie" care ar justifica ștergeri.
  if v_tbl is distinct from array['pending_receipts.bon_number', 'retained_receipts.bon_number'] then
    raise exception 'JL8 FAIL: bon_number apare in % — re-examineaza drop-ul din mig 275 (exista o a treia copie?)', v_tbl; end if;
  select array_agg(p.proname::text order by p.proname) into v_trg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public\.)?retained_receipts';
  if v_trg is distinct from array['archive_fiscal_receipts_for_user'] then
    raise exception 'JL8 FAIL: retained_receipts are alti scriitori decat arhivarea GDPR (%) — ar deveni o copie vie a lui bon_number', v_trg; end if;
  v_trg := null;
  -- Pe COMPORTAMENT, nu pe numele unei functii: orice trigger de pe tabela a
  -- carui functie pomeneste audit_log (repo-ul are deja doua nume diferite de
  -- functii de audit: audit_trigger_fn si audit_order_items_fn).
  select array_agg(t.tgname order by t.tgname) into v_trg
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.pending_receipts'::regclass and not t.tgisinternal
     and p.prosrc ~* 'audit_log';
  if v_trg is not null then
    raise exception 'JL8 FAIL: pending_receipts are acum trigger(e) care scriu in audit_log (%) — bon_number ar avea o copie acolo, deci retentia audit_log devine cuplata cu proba fiscala', v_trg; end if;
  raise notice 'JL8 OK: bon_number are o copie vie (pending_receipts) + arhiva GDPR cu un singur scriitor, fara trigger de audit pe tabel';
end $$;

-- ══ JL9: taxonomia de status a tabelei e ÎNGHEȚATĂ ═════════════════════════
do $$
declare v_lits text[];
begin
  select array_agg(x order by x) into v_lits
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m(arr), unnest(m.arr) x
   where c.conname = 'pending_receipts_status_check';
  if v_lits is distinct from array['cancelled','error','pending','sent','success'] then
    raise exception 'JL9 FAIL: CHECK-ul admite % — daca ''completed'' a devenit real, motivul drop-ului din 275 trebuie re-examinat', v_lits; end if;
  raise notice 'JL9 OK: {pending,sent,success,error,cancelled} — ''completed'' ramane imposibil';
end $$;

rollback;

select 'janitor_liveness_assertions: JL1-JL9 OK' as result;
