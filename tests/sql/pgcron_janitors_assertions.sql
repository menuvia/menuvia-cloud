-- tests/sql/pgcron_janitors_assertions.sql
-- =============================================================================
-- CJ1–CJ13 — clichetul PERMANENT al mig 274 (janitoarele pe pg_cron).
--
-- DE CE AICI ȘI NU DOAR ÎN MIGRAȚIE: verificarea din corpul mig 274 se
-- evaluează O SINGURĂ DATĂ, la poziția 274 din lanț (clasa DP6 / F1–F9 / VS8).
-- Fișierul ăsta e legat NECONDIȚIONAT în sql-verify.yml (Postgres gol, FĂRĂ
-- pg_cron) ȘI în jobul E2E din ci.yml (stack Supabase local, CU pg_cron), deci
-- re-rulează la FIECARE replay, pe starea FINALĂ a lanțului.
--
-- Două regimuri, DELIBERAT amândouă:
--   • fără pg_cron (sql-verify, replay local): CJ1–CJ11 + CJ13 pe catalog +
--     manifest, iar CJ12 exersează RAMURA VIE a sondei și a lui
--     pg_cron_apply_manifest() pe o schemă `cron` SIMULATĂ (forma reală
--     pg_cron 1.6 — `job_run_details` are `jobid`, nu `jobname`);
--   • cu pg_cron REAL (E2E): CJ12 sare simularea, iar CJ12b compară manifestul
--     cu `cron.job` REAL — deci „joburile sunt programate" NU e vacuu în CI.
-- Că joburile chiar RULEAZĂ în producție se observă din AFARĂ (/health →
-- checks.pgcron → health-watch.yml) și, la aplicare, direct din
-- cron.job_run_details.
--
-- Rulează într-o SINGURĂ tranzacție cu ROLLBACK la final (ca celelalte suite):
-- CJ3 inserează o sentinelă, CJ12 creează schema simulată și modifică
-- manifestul — nimic nu supraviețuiește.
-- =============================================================================
\set ON_ERROR_STOP on
\timing off

begin;

-- ── CJ1: manifest ne-vid (CONTROL POZITIV), nume prefixate, semnături reale ──
-- Fără controlul pozitiv, un manifest GOLIT ar face CJ2–CJ8 să treacă VACUU.
do $$
declare v_m record; v_n int; v_req text;
begin
  select count(*) into v_n from public.pg_cron_janitor_manifest;
  if v_n < 8 then
    raise exception 'CJ1: manifestul are % rand(uri), se asteptau >= 8 (control pozitiv)', v_n; end if;
  foreach v_req in array array['menuvia_janitor_fiscal_stale','menuvia_janitor_oblio_stuck',
                               'menuvia_janitor_kitchen_tickets','menuvia_janitor_lifecycle_events'] loop
    if not exists (select 1 from public.pg_cron_janitor_manifest where job_name = v_req) then
      raise exception 'CJ1: jobul % a disparut din manifest (motivul pentru care mig 274 exista)', v_req; end if;
  end loop;
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    if v_m.job_name not like 'menuvia\_janitor\_%' then
      raise exception 'CJ1: jobul % nu are prefixul menuvia_janitor_ (apply descarca strainele pe prefix, iar sonda raporteaza stafiile pe acelasi prefix)', v_m.job_name; end if;
    if to_regprocedure(v_m.signature) is null then
      raise exception 'CJ1: semnatura % (job %) NU exista - jobul pg_cron ar apela in gol la fiecare tick', v_m.signature, v_m.job_name; end if;
    if position(split_part(v_m.signature, '(', 1) in v_m.command) = 0 then
      raise exception 'CJ1: comanda jobului % (%) nu cheama %', v_m.job_name, v_m.command, v_m.signature; end if;
    if v_m.command like '%;%' then
      raise exception 'CJ1: comanda jobului % contine `;` (proba de viu `explain <command>` cere O SINGURA instructiune)', v_m.job_name; end if;
  end loop;
  raise notice 'CJ1 OK (% joburi)', v_n;
end $$;

-- ── CJ2: DEFINER, pg_temp, proprietar postgres ──────────────────────────────
-- Jobul rulează ca `postgres` (cron.schedule stampilează username=current_user),
-- deci PROPRIETATEA e cea care garantează EXECUTE. `has_function_privilege(
-- 'postgres', ...)` ar fi VACUU aici (în CI postgres e SUPERUSER), de aceea nu
-- se pretinde.
do $$
declare v_m record; v_owner name; v_def boolean; v_cfg text[];
begin
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    select pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
      into v_owner, v_def, v_cfg
      from pg_proc p where p.oid = to_regprocedure(v_m.signature);
    if not v_def then
      raise exception 'CJ2: % nu e SECURITY DEFINER', v_m.signature; end if;
    if v_owner <> 'postgres' then
      raise exception 'CJ2: % e detinuta de %, nu de postgres (jobul ruleaza ca postgres)', v_m.signature, v_owner; end if;
    if not exists (select 1 from unnest(coalesce(v_cfg, '{}'::text[])) c
                    where c like 'search_path=%' and c like '%pg_temp%') then
      raise exception 'CJ2: % nu are pg_temp in search_path (igiena mig 262)', v_m.signature; end if;
  end loop;
  raise notice 'CJ2 OK';
end $$;

-- ── CJ3: fiecare comandă SE PLANEAZĂ, și NU se execută ──────────────────────
-- `explain` (fără analyze) rezolvă apelul fără să ruleze funcția volatilă:
-- proba de viu pentru ȘIRUL EXACT primit de pg_cron. Sentinela dovedește
-- inocuitatea — altfel clichetul ar ȘTERGE date la fiecare rulare de CI.
do $$
declare v_m record; v_before bigint; v_after bigint;
begin
  insert into public.function_rate_limits(function_name, scope_key, window_start, request_count)
  values ('cj3_sentinel', 'cj3', now() - interval '90 days', 1);
  select count(*) into v_before from public.function_rate_limits where function_name = 'cj3_sentinel';
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    begin
      execute 'explain ' || v_m.command;
    exception when others then
      raise exception 'CJ3: comanda jobului % nu se planeaza (%): %', v_m.job_name, v_m.command, sqlerrm;
    end;
  end loop;
  select count(*) into v_after from public.function_rate_limits where function_name = 'cj3_sentinel';
  if v_after <> v_before or v_after = 0 then
    raise exception 'CJ3: `explain` a EXECUTAT janitoarele (sentinela: % -> %) - proba de viu nu mai e inofensiva', v_before, v_after; end if;
  delete from public.function_rate_limits where function_name = 'cj3_sentinel';
  raise notice 'CJ3 OK (fara efecte secundare)';
end $$;

-- ── CJ4: lista de excludere e INTACTĂ și DISJUNCTĂ de manifest ──────────────
-- mig 282: verificarea pe NUME, ca set EXACT, nu pe numar.
-- Podeaua veche (`count >= 9`) era mai SLABA in doua feluri: (a) nu prindea un
-- SWAP — scoti o interdictie reala si adaugi una nelegata, numarul ramane; (b)
-- la o scoatere LEGITIMA (process_account_deletions, mig 282, dupa ce a primit
-- lacatul + order by + skip locked) singura reparatie era coborarea pragului,
-- adica exact gestul „ajustez testul ca sa treaca". Setul exact nu are ambele
-- probleme: o scoatere legitima se vede in diff, ca o linie stearsa din lista.
-- `collate "C"` pe AMBELE parti — o egalitate pe array_agg ordonat e dependenta
-- de LOCALE (capcana care a facut CI-ul rosu pe #256: sub en_US punctuatia e
-- ignorata la primul nivel, sub C nu).
do $$
declare
  v_bad text;
  v_n int;
  v_have text[];
  v_want text[] := array[
    'audit_log_cleanup',
    'compute_daily_report',
    'compute_health_scores',
    'compute_weekly_report',
    'detect_nps_due',
    'detect_winback_inactive',
    'pending_receipts_cleanup_old',
    'run_affiliate_payout_batch'
  ];
begin
  select array_agg(d.fn_name order by d.fn_name collate "C")
    into v_have
    from public.pg_cron_janitor_denylist() d;
  if v_have is distinct from (
       select array_agg(w order by w collate "C") from unnest(v_want) as w
     ) then
    raise exception 'CJ4: lista de excludere s-a SCHIMBAT. Are: % / Se astepta: % - o intrare stearsa e o interdictie pierduta, iar una adaugata in locul alteia e un SWAP tacut',
      v_have, v_want; end if;
  v_n := array_length(v_have, 1);
  select string_agg(d.fn_name || ' :: ' || left(d.reason, 90), ' | ')
    into v_bad
    from public.pg_cron_janitor_denylist() d
    join public.pg_cron_janitor_manifest m
      on m.signature like 'public.' || d.fn_name || '(%';
  if v_bad is not null then
    raise exception 'CJ4: manifestul contine functii EXCLUSE deliberat de mig 274: %', v_bad; end if;
  raise notice 'CJ4 OK (% interdictii)', v_n;
end $$;

-- ── CJ5: SIGURANȚA LA DUBLĂ RULARE, verificată pe CORP ──────────────────────
-- Netlify poate fi reînviat oricând (issue #250; grant-urile din mig 274 fac
-- calea din nou vie) și atunci AMBELE planificatoare rulează aceleași joburi.
-- `safety_marker` e fragmentul care DĂ proprietatea; dacă dispare din corp,
-- proprietatea a dispărut — chiar dacă funcția „merge".
do $$
declare v_m record; v_src text;
begin
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(v_m.signature);
    if position(v_m.safety_marker in v_src) = 0 then
      raise exception 'CJ5: % nu mai contine "%" - proprietatea de siguranta la DUBLA rulare a disparut',
        v_m.signature, v_m.safety_marker; end if;
  end loop;
  raise notice 'CJ5 OK';
end $$;

-- ── CJ6: forma orarelor + etalarea minutelor ────────────────────────────────
-- `cron.timezone = GMT`, deci se programează DOAR joburi gate-uite pe VÂRSTĂ.
-- Formele permise sunt TREI; minutele fixe sunt distincte și nu cad pe
-- multiplii jobului sub-orar.
do $$
declare v_m record; v_min int; v_mins int[] := '{}'; v_subperiods int[] := '{}'; v_p int;
begin
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    if v_m.schedule ~ '^\*/([0-9]+) \* \* \* \*$' then
      v_subperiods := v_subperiods || (regexp_replace(v_m.schedule, '^\*/([0-9]+).*$', '\1'))::int;
    elsif v_m.schedule ~ '^[0-9]+ \* \* \* \*$' or v_m.schedule ~ '^[0-9]+ [0-9]+ \* \* \*$' then
      v_min := split_part(v_m.schedule, ' ', 1)::int;
      if v_min = any(v_mins) then
        raise exception 'CJ6: minutul % e folosit de doua joburi din manifest', v_min; end if;
      v_mins := v_mins || v_min;
    else
      raise exception 'CJ6: orarul "%" al jobului % nu e una din cele trei forme permise (*/N * * * * | M * * * * | M H * * *)', v_m.schedule, v_m.job_name;
    end if;
  end loop;
  foreach v_p in array v_subperiods loop
    foreach v_min in array v_mins loop
      if v_min % v_p = 0 then
        raise exception 'CJ6: jobul de la minutul % se suprapune cu jobul */% (concurenta inutila)', v_min, v_p; end if;
    end loop;
  end loop;
  raise notice 'CJ6 OK';
end $$;

-- ── CJ7: niciun corp din manifest nu are aritmetică de CEAS DE PERETE ───────
-- Asserțiune de CLASĂ: ferestrele orare trăiesc în JS (Intl.DateTimeFormat pe
-- Europe/Bucharest) și DISPAR sub pg_cron.
do $$
declare v_bad text;
begin
  select string_agg(m.job_name || ' -> ' || m.signature, ', ') into v_bad
    from public.pg_cron_janitor_manifest m
    join pg_proc p on p.oid = to_regprocedure(m.signature)
   where p.prosrc ~* 'Europe/Bucharest|extract\s*\(\s*hour|current_date|date_trunc|to_char\s*\(\s*now';
  if v_bad is not null then
    raise exception 'CJ7: joburi programate cu aritmetica de ceas de perete in corp (pg_cron e evaluat in GMT): %', v_bad; end if;
  raise notice 'CJ7 OK';
end $$;

-- ── CJ8: max_age_s coerent cu perioada ─────────────────────────────────────
do $$
declare v_m record; v_period int;
begin
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    if v_m.schedule ~ '^\*/([0-9]+) \* \* \* \*$' then
      v_period := (regexp_replace(v_m.schedule, '^\*/([0-9]+).*$', '\1'))::int * 60;
    elsif v_m.schedule ~ '^[0-9]+ \* \* \* \*$' then v_period := 3600;
    else v_period := 86400;
    end if;
    if v_m.max_age_s < 2 * v_period or v_m.max_age_s > 172800 then
      raise exception 'CJ8: max_age_s=% al jobului % nu e in [2 x perioada (%), 172800]', v_m.max_age_s, v_m.job_name, 2 * v_period; end if;
  end loop;
  raise notice 'CJ8 OK';
end $$;

-- ── CJ9: manifestul și funcțiile interne sunt ÎNCHISE rolurilor client ──────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.pg_cron_janitor_manifest'::regclass) then
    raise exception 'CJ9: RLS nu e activat pe pg_cron_janitor_manifest'; end if;
  if exists (select 1 from pg_policy where polrelid = 'public.pg_cron_janitor_manifest'::regclass) then
    raise exception 'CJ9: pg_cron_janitor_manifest are politici (se asteptau ZERO - deny-all)'; end if;
  if has_table_privilege('anon', 'public.pg_cron_janitor_manifest', 'SELECT')
     or has_table_privilege('authenticated', 'public.pg_cron_janitor_manifest', 'SELECT') then
    raise exception 'CJ9: pg_cron_janitor_manifest e citibil de anon/authenticated'; end if;
  if has_function_privilege('anon', 'public.pg_cron_janitor_denylist()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pg_cron_janitor_denylist()', 'EXECUTE') then
    raise exception 'CJ9: denylist-ul e apelabil de un rol client'; end if;
  if has_function_privilege('anon', 'public.pg_cron_apply_manifest()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pg_cron_apply_manifest()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.pg_cron_apply_manifest()', 'EXECUTE') then
    raise exception 'CJ9: pg_cron_apply_manifest e apelabila de un rol client sau de service_role (doar postgres, din migratii)'; end if;
  if (select prosecdef from pg_proc where oid = 'public.pg_cron_apply_manifest()'::regprocedure) then
    raise exception 'CJ9: pg_cron_apply_manifest nu are voie sa fie DEFINER (ruleaza doar ca postgres)'; end if;
  raise notice 'CJ9 OK';
end $$;

-- ── CJ10: contractul sondei + retenția ──────────────────────────────────────
do $$
declare v_src text; v_res jsonb; v_keys text[]; v_pruned int;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where oid = to_regprocedure('public.get_cron_janitor_health()');
  if v_src is null then raise exception 'CJ10: get_cron_janitor_health lipseste'; end if;
  if position('security definer' in lower(v_src)) = 0 then
    raise exception 'CJ10: sonda trebuie sa fie DEFINER - service_role nu are USAGE pe schema cron, deci INVOKER ar raporta available=false PE VECI (clasa get_schema_version, mig 271)'; end if;
  if position('pg_temp' in v_src) = 0 then
    raise exception 'CJ10: sonda nu are pg_temp in search_path'; end if;
  if position('pg_cron_janitor_manifest' in v_src) = 0 then
    raise exception 'CJ10: sonda nu mai citeste public.pg_cron_janitor_manifest - s-a rupt sursa unica'; end if;
  if has_function_privilege('anon', 'public.get_cron_janitor_health()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_cron_janitor_health()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_cron_janitor_health()', 'EXECUTE') then
    raise exception 'CJ10: grant-urile pe sonda sunt gresite (doar service_role)'; end if;
  begin
    v_res := public.get_cron_janitor_health();
  exception when others then
    raise exception 'CJ10: sonda ARUNCA (%) - /health ar raporta unknown din EROARE', sqlerrm;
  end;
  -- `collate "C"`: ordinea textului depinde de LOCALE — sub en_US „scheduled" vine
  -- înaintea lui „schedule_ok" (punctuația e ignorată la primul nivel), sub C e
  -- invers ('_' < 'd'). CI (postgres:15) și replay-ul local au colatii diferite,
  -- deci o egalitate pe array ordonat implicit a picat în CI și trecea local.
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_res) k;
  if v_keys is distinct from array['available','jobs','run_details_rows','unexpected'] then
    raise exception 'CJ10: forma top-level a sondei s-a schimbat: %', v_keys; end if;
  if to_regclass('cron.job') is null and (v_res->>'available') <> 'false' then
    raise exception 'CJ10: fara pg_cron sonda trebuie sa raporteze available=false, nu %', v_res->>'available'; end if;
  if jsonb_typeof(v_res->'jobs') <> 'array' or jsonb_typeof(v_res->'unexpected') <> 'array' then
    raise exception 'CJ10: jobs/unexpected trebuie sa fie array-uri'; end if;

  begin
    v_pruned := public.cron_prune_run_details(7);
  exception when others then
    raise exception 'CJ10: cron_prune_run_details arunca (%): %', sqlstate, sqlerrm;
  end;
  if to_regclass('cron.job_run_details') is null and v_pruned <> 0 then
    raise exception 'CJ10: cron_prune_run_details ar trebui 0 fara pg_cron, a dat %', v_pruned; end if;
  if has_function_privilege('anon', 'public.cron_prune_run_details(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cron_prune_run_details(integer)', 'EXECUTE') then
    raise exception 'CJ10: cron_prune_run_details e apelabila de un rol client'; end if;
  if not exists (select 1 from public.pg_cron_janitor_manifest
                  where signature like 'public.cron_prune_run_details(%') then
    raise exception 'CJ10: pruner-ul a iesit din manifest - cron.job_run_details creste NELIMITAT'; end if;
  raise notice 'CJ10 OK';
end $$;

-- ── CJ11: PERECHEA heartbeat-ului Netlify ──────────────────────────────────
do $$
begin
  if not has_function_privilege('service_role', 'public.compute_health_scores(integer)', 'EXECUTE') then
    raise exception 'CJ11: service_role nu poate apela compute_health_scores - /health.checks.cron citeste un timestamp MORT'; end if;
  if exists (select 1 from public.pg_cron_janitor_manifest
              where signature like 'public.compute_health_scores(%') then
    raise exception 'CJ11: compute_health_scores a ajuns pe pg_cron - dead-man s switch-ul Netlify devine VERDE cu Netlify MORT'; end if;
  raise notice 'CJ11 OK';
end $$;

-- ── CJ12: RAMURA VIE a sondei + apply_manifest, pe o schemă `cron` SIMULATĂ ──
-- Sărită dacă pg_cron e REAL prezent (atunci rulează CJ12b pe date reale).
-- Forma tabelelor e cea reală din pg_cron 1.6; stub-urile schedule/unschedule
-- reproduc upsert-ul pe nume.
do $$
declare v jsonb; v_n int;
begin
  -- Discriminatorul e EXTENSIA, nu existenta tabelei: simularea de mai jos
  -- creeaza chiar `cron.job`, deci un guard pe to_regclass ar face CJ12b sa
  -- „treaca" pe schema simulata (verificat: asa s-a intamplat la prima rulare).
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'CJ12: pg_cron REAL prezent - simularea sarita (vezi CJ12b)'; return;
  end if;
  if to_regclass('cron.job') is not null then
    raise exception 'CJ12: exista o schema cron FARA extensia pg_cron - stare necunoscuta, nu simulez peste ea'; end if;
  execute 'create schema cron';
  execute 'create table cron.job (jobid bigserial primary key, schedule text, command text,
             nodename text, nodeport int, database text, username text,
             active boolean not null default true, jobname text)';
  execute 'create table cron.job_run_details (jobid bigint, runid bigserial primary key,
             job_pid int, database text, username text, command text, status text,
             return_message text, start_time timestamptz, end_time timestamptz)';
  execute $s$ create function cron.schedule(job_name text, schedule text, command text) returns bigint
              language plpgsql as $f$
              declare v_id bigint;
              begin
                update cron.job j set schedule = $2, command = $3, active = true where j.jobname = $1 returning jobid into v_id;
                if v_id is null then
                  insert into cron.job (schedule, command, jobname, username, database)
                  values ($2, $3, $1, current_user, current_database()) returning jobid into v_id;
                end if;
                return v_id;
              end $f$ $s$;
  execute $s$ create function cron.unschedule(job_name text) returns boolean
              language sql as $f$ delete from cron.job where jobname = $1 returning true $f$ $s$;

  -- A) apply_manifest pe cron.job GOL: programeaza tot, stampileaza scheduled_at.
  update public.pg_cron_janitor_manifest set scheduled_at = now() - interval '9 days';
  v_n := public.pg_cron_apply_manifest();
  if v_n <> (select count(*) from public.pg_cron_janitor_manifest) then
    raise exception 'CJ12/A: apply a raportat % joburi', v_n; end if;
  execute 'select count(*) from cron.job' into v_n;
  if v_n <> (select count(*) from public.pg_cron_janitor_manifest) then
    raise exception 'CJ12/A: cron.job are % randuri dupa apply', v_n; end if;
  if exists (select 1 from public.pg_cron_janitor_manifest where scheduled_at < now() - interval '1 minute') then
    raise exception 'CJ12/A: scheduled_at nu a fost stampilat la PRIMA programare'; end if;

  -- B) RE-aplicare: fara duplicate, scheduled_at NEatins (altfel re-aplicarea
  --    ar reseta gratia sondei — exact pasul de reparare pe care migratia il
  --    recomanda).
  update public.pg_cron_janitor_manifest set scheduled_at = now() - interval '3 days';
  v_n := public.pg_cron_apply_manifest();
  execute 'select count(*) from cron.job' into v_n;
  if v_n <> (select count(*) from public.pg_cron_janitor_manifest) then
    raise exception 'CJ12/B: re-aplicarea a produs duplicate (% randuri)', v_n; end if;
  if exists (select 1 from public.pg_cron_janitor_manifest where scheduled_at > now() - interval '2 days') then
    raise exception 'CJ12/B: re-aplicarea a RE-stampilat scheduled_at'; end if;

  -- C) STAFIE cu prefixul nostru e descarcata; jobul MANUAL al fondatorului
  --    (alt prefix) e NEatins; un orar driftat e readus la manifest.
  execute $s$ insert into cron.job (schedule, command, jobname, username, database) values
              ('*/5 * * * *', 'select 1', 'menuvia_janitor_rogue', 'postgres', 'postgres'),
              ('0 * * * *',   'select 2', 'founder_manual_job',    'postgres', 'postgres') $s$;
  execute 'update cron.job set schedule = ''0 0 * * *'' where jobname = ''menuvia_janitor_kitchen_tickets''';
  v_n := public.pg_cron_apply_manifest();
  execute 'select count(*) from cron.job where jobname = ''menuvia_janitor_rogue''' into v_n;
  if v_n <> 0 then raise exception 'CJ12/C: stafia nu a fost descarcata'; end if;
  execute 'select count(*) from cron.job where jobname = ''founder_manual_job''' into v_n;
  if v_n <> 1 then raise exception 'CJ12/C: jobul manual al fondatorului a fost atins (% randuri)', v_n; end if;
  execute 'select count(*) from cron.job j join public.pg_cron_janitor_manifest m on m.job_name = j.jobname where j.schedule <> m.schedule or j.command <> m.command' into v_n;
  if v_n <> 0 then raise exception 'CJ12/C: % joburi au ramas driftate dupa apply', v_n; end if;
  execute 'delete from cron.job where jobname = ''founder_manual_job''';

  -- S1: totul programat + o reusita recenta -> sanatos; forma per job INGHETATA
  --     (9 chei): health.js le cere pe toate.
  execute 'insert into cron.job_run_details (jobid, command, status, start_time, end_time)
           select jobid, command, ''succeeded'', now() - interval ''2 min'', now() - interval ''2 min'' from cron.job';
  v := public.get_cron_janitor_health();
  if (v->>'available')::boolean is not true
     or jsonb_array_length(v->'jobs') <> (select count(*) from public.pg_cron_janitor_manifest)
     or jsonb_array_length(v->'unexpected') <> 0
     or exists (select 1 from jsonb_array_elements(v->'jobs') e
                 where (e->>'scheduled')::boolean is not true
                    or (e->>'active')::boolean is not true
                    or (e->>'schedule_ok')::boolean is not true
                    or e->>'last_status' <> 'succeeded'
                    or (e->>'last_success_age_s')::numeric > (e->>'max_age_s')::numeric) then
    raise exception 'CJ12/S1: starea sanatoasa nu e raportata ca atare: %', v; end if;
  -- ordinea C explicit (vezi CJ10): '_' < litere, deci schedule_ok < scheduled.
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(v->'jobs'->0) k)
     is distinct from array['active','job_name','last_run_age_s','last_status','last_success_age_s','max_age_s','schedule_ok','scheduled','since_scheduled_s'] then
    raise exception 'CJ12/S1: forma per job s-a schimbat: %', (select array_agg(k order by k collate "C") from jsonb_object_keys(v->'jobs'->0) k); end if;

  -- S2: job DISPARUT din cron.job -> scheduled=false.
  execute 'delete from cron.job where jobname = ''menuvia_janitor_fiscal_stale''';
  v := public.get_cron_janitor_health();
  if not exists (select 1 from jsonb_array_elements(v->'jobs') e
                  where e->>'job_name' = 'menuvia_janitor_fiscal_stale' and (e->>'scheduled')::boolean is false) then
    raise exception 'CJ12/S2: jobul lipsa nu e raportat: %', v; end if;
  perform public.pg_cron_apply_manifest();

  -- S3: job DEZACTIVAT -> active=false.
  execute 'update cron.job set active = false where jobname = ''menuvia_janitor_fiscal_stale''';
  v := public.get_cron_janitor_health();
  if not exists (select 1 from jsonb_array_elements(v->'jobs') e
                  where e->>'job_name' = 'menuvia_janitor_fiscal_stale' and (e->>'active')::boolean is false) then
    raise exception 'CJ12/S3: jobul inactiv nu e raportat: %', v; end if;
  execute 'update cron.job set active = true where jobname = ''menuvia_janitor_fiscal_stale''';

  -- S4: DRIFT de orar sau de comanda -> schedule_ok=false.
  execute 'update cron.job set schedule = ''0 0 * * *'' where jobname = ''menuvia_janitor_kitchen_tickets''';
  v := public.get_cron_janitor_health();
  if not exists (select 1 from jsonb_array_elements(v->'jobs') e
                  where e->>'job_name' = 'menuvia_janitor_kitchen_tickets' and (e->>'schedule_ok')::boolean is false) then
    raise exception 'CJ12/S4: driftul de orar nu e raportat: %', v; end if;
  execute 'update cron.job set command = ''select 1'' where jobname = ''menuvia_janitor_oblio_stuck''';
  v := public.get_cron_janitor_health();
  if not exists (select 1 from jsonb_array_elements(v->'jobs') e
                  where e->>'job_name' = 'menuvia_janitor_oblio_stuck' and (e->>'schedule_ok')::boolean is false) then
    raise exception 'CJ12/S4: driftul de COMANDA nu e raportat: %', v; end if;
  perform public.pg_cron_apply_manifest();

  -- S5: job-STAFIE cu prefixul nostru -> unexpected; jobul MANUAL NU e raportat.
  execute 'insert into cron.job (schedule, command, jobname, active, username, database)
           values (''*/5 * * * *'', ''select 1'', ''menuvia_janitor_rogue'', true, ''postgres'', ''postgres''),
                  (''0 * * * *'', ''select 2'', ''founder_manual_job'', true, ''postgres'', ''postgres'')';
  v := public.get_cron_janitor_health();
  if v->'unexpected' <> '["menuvia_janitor_rogue"]'::jsonb then
    raise exception 'CJ12/S5: stafiile nu sunt raportate corect: %', v->'unexpected'; end if;
  execute 'delete from cron.job where jobname in (''menuvia_janitor_rogue'', ''founder_manual_job'')';

  -- S6: ULTIMA rulare a esuat -> last_status=failed, dar last_success_age_s
  --     ramane a reusitei anterioare (health.js: `failing`, 200 + warning).
  execute 'insert into cron.job_run_details (jobid, command, status, start_time, end_time)
           select jobid, command, ''failed'', now(), now() from cron.job where jobname = ''menuvia_janitor_oblio_stuck''';
  v := public.get_cron_janitor_health();
  if not exists (select 1 from jsonb_array_elements(v->'jobs') e
                  where e->>'job_name' = 'menuvia_janitor_oblio_stuck' and e->>'last_status' = 'failed'
                    and (e->>'last_success_age_s')::numeric between 60 and 600) then
    raise exception 'CJ12/S6: ultima rulare esuata / varsta ultimei reusite nu sunt raportate corect: %', v; end if;

  -- S7: o reusita ulterioara vindeca starea.
  execute 'insert into cron.job_run_details (jobid, command, status, start_time, end_time)
           select jobid, command, ''succeeded'', now(), now() from cron.job where jobname = ''menuvia_janitor_oblio_stuck''';
  v := public.get_cron_janitor_health();
  if exists (select 1 from jsonb_array_elements(v->'jobs') e
              where e->>'job_name' = 'menuvia_janitor_oblio_stuck' and e->>'last_status' = 'failed') then
    raise exception 'CJ12/S7: statusul nu se vindeca dupa o rulare reusita: %', v; end if;

  -- S8: fara nicio rulare + PROGRAMAT DE PUTIN -> `warming` (last_success null,
  --     since_scheduled_s sub max_age_s).
  execute 'delete from cron.job_run_details';
  update public.pg_cron_janitor_manifest set scheduled_at = now() - interval '1 minute';
  v := public.get_cron_janitor_health();
  if exists (select 1 from jsonb_array_elements(v->'jobs') e
              where e->>'last_success_age_s' is not null
                 or (e->>'since_scheduled_s')::numeric > (e->>'max_age_s')::numeric) then
    raise exception 'CJ12/S8: un job proaspat programat, fara rulare, nu e „warming": %', v; end if;

  -- S9: fara nicio rulare, dar programat de MULT -> `stale` (singurul detector
  --     pentru „worker-ul pg_cron nu se conecteaza").
  update public.pg_cron_janitor_manifest set scheduled_at = now() - interval '5 days';
  v := public.get_cron_janitor_health();
  if not (select bool_and((e->>'since_scheduled_s')::numeric > (e->>'max_age_s')::numeric)
            from jsonb_array_elements(v->'jobs') e) then
    raise exception 'CJ12/S9: un job programat de 5 zile fara nicio rulare nu depaseste max_age_s: %', v; end if;

  -- S10: retentia chiar sterge istoricul vechi si il pastreaza pe cel recent.
  execute 'insert into cron.job_run_details (jobid, command, status, start_time, end_time)
           select jobid, command, ''succeeded'', now() - interval ''30 days'', now() - interval ''30 days'' from cron.job';
  execute 'insert into cron.job_run_details (jobid, command, status, start_time, end_time)
           select jobid, command, ''succeeded'', now(), now() from cron.job';
  v_n := public.cron_prune_run_details(7);
  if v_n <> (select count(*) from public.pg_cron_janitor_manifest) then
    raise exception 'CJ12/S10: pruner-ul a sters % randuri (asteptat exact cele vechi)', v_n; end if;
  execute 'select count(*) from cron.job_run_details' into v_n;
  if v_n <> (select count(*) from public.pg_cron_janitor_manifest) then
    raise exception 'CJ12/S10: pruner-ul a sters si istoricul recent (% ramase)', v_n; end if;

  -- Igiena: schema simulata dispare inainte de CJ12b (care e oricum gardat pe
  -- extensie) si de rollback-ul final.
  execute 'drop schema cron cascade';
  raise notice 'CJ12 OK: apply_manifest (A-C) + ramura vie a sondei (S1-S10) exersate pe schema simulata';
end $$;

-- ── CJ12b: pg_cron REAL (jobul E2E) — manifestul e CHIAR programat ──────────
-- Aici „joburile sunt programate" NU e vacuu: ruleaza pe stack-ul Supabase
-- local, unde mig 274 a instalat extensia si a programat. Pe sql-verify (fara
-- pg_cron) sare cu NOTICE — regimul e explicit, nu un `if:` de workflow.
do $$
declare v_n int; v_res jsonb;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'CJ12b: fara pg_cron real - sarita (CJ12 a acoperit simularea)'; return;
  end if;
  execute $q$ select count(*) from public.pg_cron_janitor_manifest m
               where not exists (select 1 from cron.job j
                                  where j.jobname = m.job_name and j.active
                                    and j.command = m.command and j.schedule = m.schedule) $q$
    into v_n;
  if v_n <> 0 then
    raise exception 'CJ12b: % joburi din manifest NU sunt programate/active in cron.job REAL', v_n; end if;
  v_res := public.get_cron_janitor_health();
  if (v_res->>'available') <> 'true' or jsonb_array_length(v_res->'unexpected') <> 0 then
    raise exception 'CJ12b: sonda pe pg_cron real raporteaza available=% / stafii %', v_res->>'available', v_res->'unexpected'; end if;
  raise notice 'CJ12b OK: pg_cron REAL - manifestul e programat identic in cron.job';
end $$;

-- ── CJ13: CLASA „revoke fara grant" pe RPC-urile lui automation-cron ────────
-- Lista e cea a apelurilor `rpc('...')` din netlify/functions/automation-cron.js.
-- O functie redenumita/stearsa pica ZGOMOTOS (to_regprocedure null), nu tacut.
do $$
declare v_sig text; v_bad text[] := '{}';
begin
  foreach v_sig in array array[
    'public.process_lifecycle_events(integer)',
    'public.expire_inactive_sessions(integer)',
    'public.kitchen_tickets_mark_stale()',
    'public.oblio_reclaim_stale_generating(integer)',
    'public.bridge_mark_stale_as_error()',
    'public.auto_mark_reservation_no_show(integer)',
    'public.compute_health_scores(integer)',
    'public.cleanup_old_rate_limits()',
    'public.process_account_deletions()',
    'public.run_affiliate_payout_batch(date, bigint)',
    'public.detect_winback_inactive()',
    'public.detect_nps_due()',
    'public.compute_weekly_report(uuid, date)',
    'public.compute_daily_report(uuid, date)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'CJ13: % nu mai exista cu aceasta semnatura - actualizeaza lista SI automation-cron.js', v_sig; end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      v_bad := v_bad || v_sig; end if;
  end loop;
  if array_length(v_bad, 1) > 0 then
    raise exception 'CJ13: automation-cron cheama RPC-uri pe care service_role NU le poate executa (42501, clasa mig 039/042/179/182): %', v_bad; end if;
  raise notice 'CJ13 OK: toate cele 14 RPC-uri ale lui automation-cron sunt executabile de service_role';
end $$;

rollback;

select 'pgcron_janitors_assertions: CJ1-CJ13 OK' as result;
