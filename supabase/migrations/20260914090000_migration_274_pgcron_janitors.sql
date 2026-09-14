-- migration_274_pgcron_janitors.sql
-- =============================================================================
-- Audit v3 — RES-04 (critic) + RES-09: janitoarele pure-SQL trec pe pg_cron ÎN
-- Supabase, ca să ruleze în BAZĂ, independent de Netlify și de shim-ul VPS.
--
-- ── De ce ──────────────────────────────────────────────────────────────────
-- Plasele de recuperare fiscală livrate în mig 262 sunt INERTE în producție:
-- `automation-cron` (Netlify) nu mai rulează (issue #250 — deploy-ul publicat
-- din 31 aug are env-urile de server lipsă). Măsurat pe prod la 14 sept 2026:
-- `customer_health_scores` a fost scris de cron ULTIMA dată... niciodată de la
-- mig 182 (vezi mai jos); cele 5 rânduri de azi vin din apeluri MANUALE.
--
-- Dar cauza NU e doar Netlify. ȘASE dintre RPC-urile pe care le cheamă
-- `automation-cron.js` nici măcar nu sunt executabile de `service_role`: mig
-- 039/042/179/182 (și redefinirile ulterioare) au făcut
-- `revoke all on function ... from public` cu comentariul „Service role only" /
-- „Doar service_role poate apela (cron job)" imediat dedesubt — și FĂRĂ niciun
-- `grant ... to service_role`. ACL-ul e doar `{postgres=X/postgres}`, deci apelul
-- din Netlify dă 42501 (verificat pe PRODUCȚIE cu has_function_privilege):
--   compute_health_scores(integer)        — Jobul 2 (heartbeat-ul /health!)
--   process_lifecycle_events(integer)     — Jobul 1 (dunning, onboarding)
--   process_account_deletions()           — Jobul 3c (ștergeri GDPR)
--   cleanup_old_rate_limits()             — Jobul 3
--   compute_daily_report(uuid, date)      — Jobul 7
--   compute_weekly_report(uuid, date)     — Jobul 4
-- Dovada în date: `lifecycle_events` are 8 evenimente NEprocesate și ZERO
-- procesate în TOATĂ istoria proiectului (cel mai vechi din 3 iunie 2026, cu
-- două luni ÎNAINTE de moartea Netlify). Repararea issue #250 NU le-ar învia:
-- ar reveni la 42501. Intenția din comentarii e neechivocă, deci grant-urile de
-- mai jos (secțiunea E) sunt REPARAREA unui bug, nu o decizie nouă de acces.
--
-- pg_cron ocolește clasa asta din lateral: `cron.schedule` stampilează
-- `username = current_user`, migrațiile se aplică drept `postgres`, iar
-- `postgres` e PROPRIETARUL tuturor funcțiilor programate → EXECUTE e garantat
-- de PROPRIETATE. Grant-urile din E sunt pentru calea Netlify (când reînvie),
-- nu pentru joburile pg_cron.
--
-- ── Sursa UNICĂ: public.pg_cron_janitor_manifest ───────────────────────────
-- Un singur obiect citit din TREI locuri: `pg_cron_apply_manifest()` (bucla de
-- programare, apelată din această migrație), clichetul permanent din CI
-- (tests/sql/pgcron_janitors_assertions.sql) și sonda `/health`
-- (`get_cron_janitor_health()`). Fără el, „ce programăm" și „ce verificăm" ar
-- fi două liste care divergează la prima modificare.
--
-- ── Criteriul de includere (dur, dublu) ────────────────────────────────────
--   (a) AGE-GATED. `cron.timezone = GMT` pe acest proiect și `TimeZone = UTC`,
--       iar TOATE ferestrele de ceas de perete (03:15 / 08:00 / 09:00 / 10:00 /
--       vineri 18:00 București) trăiesc în APELANTUL JS (`automation-cron.js`,
--       `Intl.DateTimeFormat('Europe/Bucharest')`), NU în RPC-uri. Sub pg_cron
--       acele garduri DISPAR, deci un job cu fereastră în JS devine un job „la
--       fiecare tick". În plus România e UTC+2 iarna și UTC+3 vara, deci un
--       orar UTC FIX nu poate păstra o oră de perete tot anul. Clichet: CJ6
--       (forma orarului) + CJ7 (niciun corp din manifest nu are aritmetică de
--       ceas de perete).
--   (b) DOUBLE-RUN SAFE. Issue #250 e un fix de fondator care poate veni
--       oricând, și atunci ar rula AMBELE planificatoare (grant-urile din E fac
--       calea Netlify din nou vie). Criteriul e structural, nu „probabil merge":
--       claim cu `for update skip locked` (process_lifecycle_events) sau predicat
--       AUTO-CONSUMAT pe status ('sent'→'error', 'generating'→'failed',
--       'open'→'expired', 'confirmed'→'no_show') plus prag de vârstă; a doua
--       rulare prinde 0 rânduri, deci markerul `POSIBIL DUPLICAT` se scrie
--       EXACT o dată. Clichet: CJ5 — `safety_marker` e fragmentul din corpul
--       funcției care DĂ proprietatea, verificat în `prosrc`.
--
-- ── Unde trăiește fiecare verificare (regula „fără gate-uri moarte") ───────
--   • Blocul de la finalul acestei migrații rulează O SINGURĂ DATĂ, la poziția
--     274 din lanț. E o centură la momentul aplicării, NU acoperire: conține
--     DELIBERAT doar verificarea care e reală EXACT aici (starea joburilor
--     reale din cron.job, imediat după programare).
--   • Clichetul PERMANENT e `tests/sql/pgcron_janitors_assertions.sql`
--     (CJ1–CJ13), legat NECONDIȚIONAT în sql-verify.yml (rulează la FIECARE
--     replay, pe starea FINALĂ a lanțului, FĂRĂ pg_cron) ȘI în jobul E2E din
--     ci.yml, unde stack-ul Supabase local ARE pg_cron preîncărcat: acolo CJ12b
--     compară manifestul cu `cron.job` REAL. Deci „joburile sunt programate" e
--     verificat viu în CI, nu doar simulat.
--   • Că joburile chiar RULEAZĂ și REUȘESC în producție se observă DIN AFARĂ:
--     `/health` → `checks.pgcron` → health-watch.yml (care evaluează sondele
--     ÎNAINTE de a ieși pe non-200, altfel semnalul ar fi îngropat sub 503-ul
--     pe care Netlify-ul mort îl dă oricum). Monitorul nu are voie să trăiască
--     în interiorul lucrului monitorizat — dar cât timp Netlify e mort, NIMIC
--     din `/health` nu răspunde; de aceea aplicarea pe prod se încheie cu o
--     citire DIRECTĂ din `cron.job_run_details` (procedura din PR).
--
-- Teste permanente: tests/sql/pgcron_janitors_assertions.sql (CJ1–CJ13).
-- JS: tests/functions/health.test.js (HL8 actualizat + HL20–HL25).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. MANIFESTUL — sursa UNICĂ a setului programat.
--    `scheduled_at` e stampilat de `pg_cron_apply_manifest()` DOAR la prima
--    programare reală (jobul lipsea din cron.job) și e PODEAUA de vârstă a
--    sondei: un job programat care n-a reușit NICIODATĂ e cea mai importantă
--    categorie (semnătura exactă a scenariului „worker-ul pg_cron nu se
--    conectează"). Fără podea, aplicarea migrației ar pune /health pe 503
--    pentru 24h din cauza joburilor zilnice (clasa QB6 din mig 271); cu podea
--    RE-stampilată la fiecare re-aplicare, fereastra de grație s-ar reseta exact
--    prin pasul de reparare pe care migrația îl recomandă — de aceea se
--    stampilează o singură dată.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pg_cron_janitor_manifest (
  job_name      text primary key,
  schedule      text        not null,
  -- Semnătura ȚINTĂ, pentru `to_regprocedure` (CJ1). Diferă intenționat de
  -- `command`: un apel care se bazează pe DEFAULT-uri nu se rezolvă prin
  -- regprocedure.
  signature     text        not null,
  -- Șirul EXACT dat lui `cron.schedule`. Fără `;` la final: proba de viu
  -- (`explain <command>`) primește o singură instrucțiune.
  command       text        not null,
  -- Pragul de prospețime folosit de /health (secunde). CJ8 cere >= 2 × perioada.
  max_age_s     integer     not null check (max_age_s > 0),
  -- Fragmentul din corpul funcției care o face sigură la DUBLĂ rulare (CJ5).
  safety_marker text        not null,
  note          text        not null,
  created_at    timestamptz not null default now(),
  scheduled_at  timestamptz not null default now()
);

comment on table public.pg_cron_janitor_manifest is
  'mig 274: sursa UNICA a joburilor pg_cron (citita de pg_cron_apply_manifest() + suita CJ1-CJ13 + sonda /health). Prefixul menuvia_janitor_ e obligatoriu: apply descarca strainele DOAR pe acest prefix, deci joburile manuale ale fondatorului sunt in siguranta. schedule e in GMT. scheduled_at e podeaua ferestrei de gratie a sondei, stampilata DOAR la prima programare reala.';

-- Config de platformă: numele și cadența joburilor descriu infrastructura, nu
-- au ce căuta pe suprafața anon/authenticated. RLS deny-all (zero politici) +
-- revoke explicit, ca `security_ownership_remediations` (mig 258).
-- REVOKE-ul e PORTANT, nu ceremonie: pe acest lanț `pg_default_acl` dă
-- `authenticated=arwd/postgres` pe orice tabelă NOUĂ din `public` (verificat pe
-- replay) — fără el, orice cont logat ar citi manifestul prin PostgREST.
alter table public.pg_cron_janitor_manifest enable row level security;
revoke all on table public.pg_cron_janitor_manifest from public;
revoke all on table public.pg_cron_janitor_manifest from anon, authenticated;

-- Cadența e IDENTICĂ cu cea a lui automation-cron (fără nicio schimbare de
-- logică): Jobul 1 rula la fiecare tick al funcției, adică */15. Minutele sunt
-- ETALATE și evită multiplii de 15 (CJ6) — Supabase recomandă maxim 8 joburi
-- CONCURENTE, iar așa concurența reală rămâne 1.
insert into public.pg_cron_janitor_manifest
  (job_name, schedule, signature, command, max_age_s, safety_marker, note)
values
  ('menuvia_janitor_lifecycle_events', '*/15 * * * *',
   'public.process_lifecycle_events(integer)',
   'select public.process_lifecycle_events(50)', 2700,
   'for update skip locked',
   'Job 1. Revendica cu `for update skip locked`: doi runneri nu pot prinde acelasi eveniment. Fiecare enqueue_email are dedup_key UNIC (index unic + on conflict do nothing).'),

  ('menuvia_janitor_fiscal_stale', '7 * * * *',
   'public.bridge_mark_stale_as_error()',
   'select public.bridge_mark_stale_as_error()', 10800,
   'where status = ''sent''',
   'Job 1f. sent->error + markerul POSIBIL DUPLICAT (mig 262). Predicat AUTO-CONSUMAT: a doua rulare prinde 0 randuri, deci markerul se scrie O DATA. Fara el, bonurile agatate in `sent` ramaneau asa PENTRU TOTDEAUNA.'),

  ('menuvia_janitor_oblio_stuck', '11 * * * *',
   'public.oblio_reclaim_stale_generating(integer)',
   'select public.oblio_reclaim_stale_generating(15)', 10800,
   'where status = ''generating''',
   'Job 1e. generating->failed AMBIGUU (mig 239), FARA requeue (mig 218: kill in POST = ambiguu, retrimitere MANUALA). Auto-consumat.'),

  ('menuvia_janitor_kitchen_tickets', '13 * * * *',
   'public.kitchen_tickets_mark_stale()',
   'select public.kitchen_tickets_mark_stale()', 10800,
   'where status = ''sent'' and claimed_at <',
   'Job 1c. sent->error + purge pe terminale >30 zile (mig 227). Coada NEfiscala: retry = hartie dubla, nu bon dublu. Auto-consumat.'),

  ('menuvia_janitor_expire_sessions', '17 * * * *',
   'public.expire_inactive_sessions(integer)',
   'select public.expire_inactive_sessions(3)', 10800,
   'where status = ''open''',
   'Job 1b. open->expired dupa 3h de inactivitate. Auto-consumat.'),

  ('menuvia_janitor_reservation_noshow', '19 * * * *',
   'public.auto_mark_reservation_no_show(integer)',
   'select public.auto_mark_reservation_no_show(120)', 10800,
   'where r.status = ''confirmed''',
   'Job 1d. confirmed->no_show, gratie >=30 min SI fereastra rulanta de 48h (anti-backfill, mig 234). Auto-consumat.'),

  ('menuvia_janitor_rate_limits', '23 3 * * *',
   'public.cleanup_old_rate_limits()',
   'select public.cleanup_old_rate_limits()', 172800,
   'where window_start <',
   'Job 3. DELETE pur pe varsta (>7 zile): idempotent la orice frecventa. 03:23 GMT nu trebuie sa fie o ora romaneasca anume — de asta se poate programa.'),

  ('menuvia_janitor_cron_prune', '41 4 * * *',
   'public.cron_prune_run_details(integer)',
   'select public.cron_prune_run_details(7)', 172800,
   'coalesce(end_time, start_time) <',
   'Retentia pentru cron.job_run_details: pg_cron NU o curata automat si randurile SUPRAVIETUIESC unschedule-ului -> tabela nemarginita NOUA, numarata de alarma de stocare (mig 266). ~200 randuri/zi la cadenta de aici.')
on conflict (job_name) do update set
  schedule      = excluded.schedule,
  signature     = excluded.signature,
  command       = excluded.command,
  max_age_s     = excluded.max_age_s,
  safety_marker = excluded.safety_marker,
  note          = excluded.note;
  -- `created_at` și `scheduled_at` NU se rescriu aici (vezi A).

-- ─────────────────────────────────────────────────────────────────────────────
-- B. LISTA DE EXCLUDERE — ce NU are voie pe pg_cron, cu motivul.
--    E o FUNCȚIE, nu o tabelă: raționamentul stă în cod, versionat, nu în date
--    pe care cineva le poate edita. CJ4 pică dacă una ajunge în manifest SAU
--    dacă lista se scurtează (o intrare ștearsă = o interdicție pierdută).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pg_cron_janitor_denylist()
returns table (fn_name text, reason text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select *
    from (values
      ('compute_health_scores',
       'ESTE dead-man s switch-ul Netlify: /health citeste customer_health_scores.computed_at (checks.cron, CRON_STALE_HOURS=2) si nu exista alt scriitor automat. Mutat pe pg_cron, alarma devine VERDE cu Netlify MORT — exact orbirea construita dupa incidentul din august. Grant-ul lipsa i s-a acordat (sectiunea E), ca heartbeat-ul sa masoare CHIAR Netlify.'),
      ('process_account_deletions',
       'delete from auth.users IREVERSIBIL, iar bucla nu are `order by`, nici `for update`, nici `skip locked`: doua rulari concurente itereaza seturi suprapuse in ordini diferite (risc de deadlock pe cascade) si a doua face `return next` pentru randuri pe care nu le-a sters. Un advisory lock e LOGICA NOUA pe o cale ireversibila = decizie de fondator.'),
      ('run_affiliate_payout_batch',
       'BANI: upsert-ul e idempotent (on conflict (affiliate_id, period_month, currency)), dar notificarea Slack „N draft-uri necesita procesare Wise" si pre-check-ul pe perioada stau in JS. Pe pg_cron s-ar crea TACUT draft-uri pe care nimeni nu le proceseaza.'),
      ('compute_daily_report',
       'Nu e janitor: e per-restaurant, iar orchestrarea (localuri active + email owner, chunking 8, circuit breaker la 10 esecuri consecutive, dedup_key datat, short-circuit „deja trimis") sta in automation-cron.js. Mutarea = SQL NOU. Plus fereastra de 08:00 Bucuresti.'),
      ('compute_weekly_report',
       'Idem compute_daily_report: orchestrare in JS, fereastra vineri 18:00-20:00 Bucuresti.'),
      ('detect_winback_inactive',
       'Marketing: valoarea lui e ORA trimiterii (09:00 Bucuresti), gard care sta in JS si dispare sub pg_cron; cron.timezone=GMT + DST romanesc fac imposibila pastrarea intentiei. Si CONSUMATORUL (worker-ul de email) e tot Netlify: a programa un PRODUCATOR al carui consumator e mort doar umfla coada.'),
      ('detect_nps_due',
       'Idem detect_winback_inactive (fereastra de 10:00 Bucuresti in JS).'),
      ('pending_receipts_cleanup_old',
       'COD MORT (mig 035): filtreaza status=''completed'', valoare pe care CHECK-ul tabelei o INTERZICE. Programarea ar instala un job care ruleaza pe veci, sterge ZERO randuri si face retentia fiscala sa PARA rezolvata. Mig 275 o DROP-uieste; pending_receipts nu are si nu primeste stergere automata.'),
      ('audit_log_cleanup',
       'Jurnal FISCAL: retentia e decizie de fondator, explicit in afara scopului. Masurat la 11 sept 2026: 539 randuri, 0 mai vechi de 365 de zile.')
    ) as t(fn_name, reason);
$$;

revoke all on function public.pg_cron_janitor_denylist() from public;
grant execute on function public.pg_cron_janitor_denylist() to service_role;

comment on function public.pg_cron_janitor_denylist() is
  'mig 274: functiile care NU au voie in manifestul pg_cron, cu motivul fiecareia. CJ4 pica daca una ajunge in manifest sau daca lista se scurteaza.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Retenția pentru cron.job_run_details.
--    Corp cu EXECUTE dinamic sub gardă `to_regclass`: o referință STATICĂ la
--    `cron.job_run_details` ar face funcția neapelabilă pe un Postgres fără
--    pg_cron, deci proba de viu din CI (`explain <command>`) ar pica.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cron_prune_run_details(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_days    integer := greatest(coalesce(p_days, 7), 1);
  v_deleted integer := 0;
begin
  if to_regclass('cron.job_run_details') is null then
    return 0;  -- pg_cron neinstalat: no-op, NU eroare
  end if;
  -- `coalesce(end_time, start_time)`: un rând rămas fără `end_time` (proces ucis
  -- mid-run) nu are voie să scape retenției pe veci.
  execute format(
    'delete from cron.job_run_details where coalesce(end_time, start_time) < now() - make_interval(days => %s)',
    v_days
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $fn$;

revoke all on function public.cron_prune_run_details(integer) from public;
grant execute on function public.cron_prune_run_details(integer) to service_role;

comment on function public.cron_prune_run_details(integer) is
  'mig 274: taie istoricul cron.job_run_details (pg_cron nu il curata si randurile supravietuiesc unschedule-ului). No-op fara pg_cron. E in manifest — CJ10 pica daca iese.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. SONDA — /health compară manifestul cu realitatea din pg_cron.
--    DEFINER OBLIGATORIU: `service_role` nu are USAGE pe schema `cron` (creată
--    de extensie/superuser), deci INVOKER ar întoarce available=false PENTRU
--    TOTDEAUNA — clasa `get_schema_version` din mig 271, o sondă moartă care
--    arată ca „încă nu".
--    Întoarce FAPTE per job, nu severitate: pragurile stau în manifest, decizia
--    în health.js (aceeași disciplină ca `get_queue_backlog`). Două vârste per
--    job: a ULTIMEI rulări (orice status) și a ultimei rulări REUȘITE —
--    severitatea se ia din a doua (un eșec izolat pe un job zilnic nu are voie
--    să țină alarma roșie 24h; un job care nu mai REUȘEȘTE devine `stale` după
--    max_age_s oricum).
--    CAPCANĂ DE CATALOG: `cron.job_run_details` NU are coloana `jobname` în
--    pg_cron 1.6 — are `jobid`. O grupare pe `d.jobname` ar ARUNCA pe producție
--    → sonda ar rămâne `unknown` pe veci. Join pe jobid.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_cron_janitor_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_res jsonb;
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    -- pg_cron neinstalat (CI sql-verify, Postgres simplu, prod înaintea
    -- extensiei): răspuns VALID, fără excepție.
    return jsonb_build_object(
      'available', false, 'jobs', '[]'::jsonb,
      'unexpected', '[]'::jsonb, 'run_details_rows', 0
    );
  end if;

  execute $q$
    with j as (select jobid, jobname, schedule, active, command from cron.job),
    lr as (
      -- ULTIMA rulare per job (max runid).
      select d.jobid, d.status,
             extract(epoch from now() - coalesce(d.end_time, d.start_time))::numeric as age_s
        from (
          select jd.jobid, jd.status, jd.end_time, jd.start_time,
                 row_number() over (partition by jd.jobid order by jd.runid desc) as rn
            from cron.job_run_details jd
        ) d
       where d.rn = 1
    ),
    ls as (
      -- ultima rulare REUȘITĂ per job.
      select jd.jobid,
             extract(epoch from now() - max(coalesce(jd.end_time, jd.start_time)))::numeric as age_s
        from cron.job_run_details jd
       where jd.status = 'succeeded'
       group by jd.jobid
    )
    select jsonb_build_object(
      'available', true,
      'run_details_rows', (select count(*) from cron.job_run_details),
      -- Joburi-stafie: prefixul NOSTRU, absente din manifest. Scopate pe prefix,
      -- ca joburile manuale ale fondatorului să nu fie raportate ca defect.
      'unexpected', coalesce((
        select jsonb_agg(j.jobname order by j.jobname) from j
         where j.jobname like 'menuvia\_janitor\_%'
           and not exists (select 1 from public.pg_cron_janitor_manifest m where m.job_name = j.jobname)
      ), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'job_name',           m.job_name,
                 'scheduled',          (j.jobid is not null),
                 'active',             coalesce(j.active, false),
                 'schedule_ok',        coalesce(j.schedule = m.schedule and j.command = m.command, false),
                 'last_status',        lr.status,
                 'last_run_age_s',     lr.age_s,
                 'last_success_age_s', ls.age_s,
                 -- Podeaua de grație: de când jobul e programat. Un job fără
                 -- nicio reușită e `warming` cât timp asta e sub max_age_s și
                 -- `stale` după — singurul detector automat pentru „worker-ul
                 -- pg_cron nu se conectează" (zero rulări = zero erori).
                 'since_scheduled_s',  extract(epoch from now() - m.scheduled_at)::numeric,
                 'max_age_s',          m.max_age_s
               ) order by m.job_name)
          from public.pg_cron_janitor_manifest m
          left join j  on j.jobname = m.job_name
          left join lr on lr.jobid  = j.jobid
          left join ls on ls.jobid  = j.jobid
      ), '[]'::jsonb)
    )
  $q$ into v_res;

  return v_res;
end $fn$;

revoke all on function public.get_cron_janitor_health() from public;
grant execute on function public.get_cron_janitor_health() to service_role;

comment on function public.get_cron_janitor_health() is
  'mig 274: starea joburilor pg_cron fata de public.pg_cron_janitor_manifest (programat / activ / schedule+command identice / statusul si varsta ULTIMEI rulari / varsta ultimei rulari REUSITE, join pe jobid — job_run_details NU are jobname) + joburile-stafie cu prefixul nostru + numarul de randuri de istoric. available=false fara pg_cron, FARA exceptie. Forma INGHETATA (4 chei top-level, 9 per job — CJ10/CJ12); service_role-only: volumul si numele joburilor sunt infrastructura, iar /health e PUBLIC.';

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Grant-urile LIPSĂ pentru calea Netlify (bug, nu decizie — vezi antet).
--    NU sunt „un al doilea runner": joburile programate mai jos sunt
--    double-run safe prin structură (CJ5), iar cele NEprogramate (rapoarte,
--    ștergeri GDPR, heartbeat) au un singur apelant, automation-cron.
--    CJ13 e clichetul permanent pe această clasă (revoke fără grant).
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.compute_health_scores(integer)      to service_role;
grant execute on function public.process_lifecycle_events(integer)   to service_role;
grant execute on function public.process_account_deletions()         to service_role;
grant execute on function public.cleanup_old_rate_limits()           to service_role;
grant execute on function public.compute_daily_report(uuid, date)    to service_role;
grant execute on function public.compute_weekly_report(uuid, date)   to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Sincronizarea manifest → pg_cron, ca FUNCȚIE (testabilă: CJ12 o rulează pe
--    o schemă `cron` simulată, cu stub-uri pentru schedule/unschedule).
--    TOT ce atinge `cron.*` trece prin EXECUTE dinamic, deci nimic nu se
--    rezolvă la parsare și fișierul se replay-ează pe un Postgres FĂRĂ pg_cron.
--    NU e DEFINER și nu are grant-uri: o cheamă doar `postgres` (migrații).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pg_cron_apply_manifest()
returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_m       record;
  v_stray   text;
  v_present boolean;
  v_n       integer := 0;
begin
  if to_regclass('cron.job') is null
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regprocedure('cron.unschedule(text)') is null then
    raise exception 'pg_cron_apply_manifest: pg_cron nu e instalat (cron.job / cron.schedule lipsesc)';
  end if;

  -- Joburi-stafie cu prefixul NOSTRU, rămase de la un manifest ANTERIOR:
  -- manifestul e AUTORITATEA. Prefixul protejează joburile manuale ale
  -- fondatorului.
  for v_stray in
    execute $q$
      select j.jobname from cron.job j
       where j.jobname like 'menuvia\_janitor\_%'
         and not exists (select 1 from public.pg_cron_janitor_manifest m where m.job_name = j.jobname)
    $q$
  loop
    execute format('select cron.unschedule(%L)', v_stray);
    raise notice 'pg_cron_apply_manifest: job-stafie descarcat: %', v_stray;
  end loop;

  -- `cron.schedule` pe un nume EXISTENT face UPSERT în pg_cron 1.6 → re-rulabil,
  -- fără joburi duplicate. `scheduled_at` se stampilează DOAR când jobul lipsea
  -- (prima programare reală), ca o re-aplicare să nu reseteze grația sondei.
  for v_m in select * from public.pg_cron_janitor_manifest order by job_name loop
    execute format('select exists (select 1 from cron.job where jobname = %L)', v_m.job_name)
       into v_present;
    execute format('select cron.schedule(%L, %L, %L)', v_m.job_name, v_m.schedule, v_m.command);
    if not v_present then
      update public.pg_cron_janitor_manifest
         set scheduled_at = now()
       where job_name = v_m.job_name;
    end if;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $fn$;

revoke all on function public.pg_cron_apply_manifest() from public;

comment on function public.pg_cron_apply_manifest() is
  'mig 274: descarca joburile-stafie cu prefixul menuvia_janitor_ si (re)programeaza fiecare rand din pg_cron_janitor_manifest (upsert pe nume). Stampileaza scheduled_at DOAR la prima programare reala. Apelata din migratii, ca postgres; CJ12 o exerseaza pe o schema cron simulata.';

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Instalarea pg_cron + programarea. Garda e pe CAPABILITATE, nu pe prezența
--    fișierului de control: pg_cron cere să fie în `shared_preload_libraries`,
--    iar un CREATE EXTENSION fără el pică cu un mesaj despre preload — deci
--    un cluster care „are" extensia pe disc dar nu o preîncarcă sare corect.
--    Pe sql-verify (postgres:15 gol) și pe replay-ul local lipsesc ambele →
--    NOTICE + restul migrației. Pe Supabase (prod ȘI `supabase start` din
--    jobul E2E) ambele sunt prezente → instalare + programare.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_preload text := coalesce(current_setting('shared_preload_libraries', true), '');
  v_n       integer;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or v_preload not like '%pg_cron%' then
    raise notice 'mig 274: pg_cron INDISPONIBIL (available=%, preload="%") - programarea sarita, restul migratiei aplicat. Clichetul permanent (tests/sql/pgcron_janitors_assertions.sql) NU depinde de extensie.',
      exists (select 1 from pg_available_extensions where name = 'pg_cron'), v_preload;
    return;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- Incantația documentată de Supabase. Schema e `pg_catalog`, NU `cron`:
      -- pg_cron e relocatable=false și își creează SINGUR schema `cron`.
      -- CINE POATE: `postgres` NU e superuser pe Supabase (rolsuper=false), dar
      -- `pg_cron` e în `supautils.privileged_extensions`, deci supautils rulează
      -- comanda ca `supabase_admin` în locul nostru, iar scriptul de after-create
      -- al platformei acordă lui `postgres` USAGE pe schema `cron` (precedent:
      -- pg_stat_statements are aceleași flag-uri și e deținut de postgres).
      execute 'create extension pg_cron with schema pg_catalog';
    exception when insufficient_privilege then
      -- FAIL-LOUD, cu remediul în mesaj. A prinde eroarea și a degrada la
      -- NOTICE ar sări TOT scopul migrației, TĂCUT — iar migrația e
      -- re-rulabilă, deci reluarea după o comandă manuală e ieftină.
      -- Orice ALTĂ eroare se propagă natural (tot fail-loud).
      raise exception
        'mig 274: CREATE EXTENSION pg_cron a fost REFUZAT pentru %. Ruleaza O SINGURA DATA, din Dashboard → Database → Extensions (pg_cron ON), apoi re-aplica migratia (e re-rulabila).',
        current_user;
    end;
  end if;

  -- Grant-urile documentate de Supabase. TOLERANTE pe MECANISM: dacă extensia a
  -- fost instalată de `supabase_admin` (toggle-ul din Dashboard), `postgres` nu
  -- e proprietarul schemei și nu are DREPTUL să acorde — dar atunci accesul vine
  -- deja de la platformă. Refuzul aici nu e o eroare; lipsa CAPABILITĂȚII este.
  begin
    execute 'grant usage on schema cron to postgres';
    execute 'grant all privileges on all tables in schema cron to postgres';
  exception when insufficient_privilege then
    raise notice 'mig 274: grant-urile pe schema cron nu au putut fi acordate de % (extensia e detinuta de altcineva) - verific direct capabilitatea', current_user;
  end;

  -- FAIL-LOUD pe CAPABILITATE, nu pe mecanism.
  if not has_schema_privilege(current_user, 'cron', 'USAGE') then
    raise exception 'mig 274: % nu are USAGE pe schema cron - joburile nu pot fi programate. Ruleaza o singura data, ca proprietarul extensiei: grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres; apoi re-aplica migratia.', current_user;
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or not has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE') then
    raise exception 'mig 274: % nu poate apela cron.schedule(text,text,text) - pg_cron e instalat dar inutilizabil din migratii.', current_user;
  end if;
  if not has_table_privilege(current_user, 'cron.job', 'SELECT')
     or not has_table_privilege(current_user, 'cron.job_run_details', 'SELECT') then
    raise exception 'mig 274: % nu poate citi cron.job / cron.job_run_details - sonda si sincronizarea ar fi oarbe.', current_user;
  end if;

  v_n := public.pg_cron_apply_manifest();
  raise notice 'mig 274: % joburi pg_cron programate ca % (evaluate in GMT)', v_n, current_user;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificare ONE-SHOT. RULEAZĂ O SINGURĂ DATĂ, la poziția 274 din lanț, și
-- conține DELIBERAT doar ce e real EXACT aici: starea joburilor reale, imediat
-- după programare, pe un cluster cu pg_cron. Clichetul permanent e
-- tests/sql/pgcron_janitors_assertions.sql (CJ1–CJ13; CJ12b e varianta
-- permanentă a acestei verificări, vie în jobul E2E).
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_res jsonb; v_n integer;
begin
  if to_regclass('cron.job') is not null then
    execute $q$ select count(*) from public.pg_cron_janitor_manifest m
                 where not exists (select 1 from cron.job j
                                    where j.jobname = m.job_name and j.active
                                      and j.command = m.command and j.schedule = m.schedule) $q$
      into v_n;
    if v_n <> 0 then
      raise exception 'mig 274: % joburi din manifest NU sunt programate/active cu comanda si orarul din manifest', v_n; end if;
    v_res := public.get_cron_janitor_health();
    if (v_res->>'available') <> 'true' or jsonb_array_length(v_res->'unexpected') <> 0 then
      raise exception 'mig 274: sonda raporteaza available=% cu joburi-stafie %', v_res->>'available', v_res->'unexpected'; end if;
  end if;

  select count(*) into v_n from public.pg_cron_janitor_manifest;
  raise notice 'mig 274: manifest cu % joburi; permanentele: tests/sql/pgcron_janitors_assertions.sql', v_n;
end $$;

commit;
