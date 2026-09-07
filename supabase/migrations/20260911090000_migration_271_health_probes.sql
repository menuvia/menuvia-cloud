-- migration_271_health_probes.sql
-- =============================================================================
-- Audit v3 — două sonde noi pentru /health, ambele „cod care face vizibilă o
-- defecțiune" (excepția 2 din PLAN_0_TO_HERO), fără niciun efect pe produs.
--
-- ── (A) `get_schema_version(p_expected text[])` — RES-08 / rangul 3 ─────────
-- Deployment skew necontrolat: mig 263 a stat pe main fără să fie pe prod și
-- NIMIC nu detecta decalajul („am reparat, dar nu apără"). Sonda primește
-- lista de nume așteptate (manifestul comis din `supabase/migrations/`,
-- `netlify/functions/schema-manifest.json`) și întoarce ce LIPSEȘTE din
-- ledger-ul `supabase_migrations.schema_migrations`.
--   • Cheia e NUMELE (`m.name`), NU `version`: pe prod `version` e timestamp-ul
--     APLICĂRII prin MCP (ex. 20260905075533 pentru mig 269), diferit de
--     prefixul fișierului — o comparație pe version ar raporta „behind"
--     permanent. Numele = fișierul fără prefixul de 14 cifre și `.sql`
--     (verificat: 269/269 nume din prod coincid cu fișierele locale).
--   • SECURITY DEFINER e OBLIGATORIU: `service_role` NU are USAGE pe schema
--     `supabase_migrations` (verificat pe prod) — INVOKER ar întoarce
--     `available=false` pentru totdeauna, adică o sondă moartă care arată ca
--     „deploy înaintea migrației".
--   • Fail-open pe absența ledger-ului (CI-ul efemer nu are schema): întoarce
--     `available=false` FĂRĂ excepție; clientul tratează asta ca `unknown`.
--   • Forma e ÎNGHEȚATĂ (5 chei) — disciplina BC5.
--
-- ── (B) `get_queue_backlog()` — RES-32 ──────────────────────────────────────
-- /health vedea UN singur job din șase (`customer_health_scores.computed_at`,
-- scris de compute_health_scores). Celelalte cozi (email, SMS, facturi Oblio,
-- remindere, alerte Slack, bonuri/tichete de bridge) puteau muri TĂCUT cu
-- /health verde: bundle rupt doar pentru o funcție, env lipsă doar pentru ea,
-- 200 „skipped" pe cheie lipsă, PGRST202 pe un RPC redenumit. Sonda e de
-- BACKLOG (simptomul: muncă ce așteaptă și nu e ridicată), nu de heartbeat
-- per job (mecanismul: „funcția a rulat") — heartbeat-ul e ORB la clasa
-- „funcția rulează, întoarce 200 și nu face nimic".
--   • Fiecare predicat OGLINDEȘTE claim-ul corespunzător (email/sms 242/228,
--     invoices 269 cu `oblio_configs.is_active`, remindere 234 cu AMBELE
--     canale și fereastra `reminder_hours_before`, slack 175) — altfel sonda
--     ar număra ceva ce claim-ul nu ridică niciodată = alarmă permanentă falsă.
--     Testele QB3/QB4/QB5/QB6 LEAGĂ sonda de claim: după claim, backlog = 0.
--   • Două grupe deliberate: `cron` (platformă → poate da 503) și `bridge`
--     (PC-ul unui restaurant → doar `warn`; alarma per-tenant e mig 265).
--   • DEFINER deliberat (spre deosebire de 266): grant-urile service_role pe
--     cele șapte tabele sunt eterogene, iar funcția nu întoarce rânduri, doar
--     numărători și vârste. Grant EXCLUSIV service_role — volumul cozilor e
--     volum de business, iar /health e public.
--
-- Teste permanente: tests/sql/schema_version_assertions.sql (SV1–SV6),
-- tests/sql/queue_backlog_assertions.sql (QB1–QB8). JS: tests/functions/
-- health.test.js (HL8+), tests/functions/schema-manifest.test.js (SM1–SM2).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. get_schema_version
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_schema_version(p_expected text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing        text[];
  v_latest_name    text;
  v_latest_version text;
  v_count          bigint;
begin
  select count(*) into v_count from supabase_migrations.schema_migrations;
  select m.name, m.version into v_latest_name, v_latest_version
    from supabase_migrations.schema_migrations m
   order by m.version desc
   limit 1;
  -- Cheia e NUMELE migrației (vezi antet) — nu version.
  select coalesce(array_agg(e order by e), '{}'::text[]) into v_missing
    from unnest(coalesce(p_expected, '{}'::text[])) as e
   where not exists (
     select 1 from supabase_migrations.schema_migrations m where m.name = e
   );
  return jsonb_build_object(
    'available',      true,
    'ledger_count',   v_count,
    'latest_name',    v_latest_name,
    'latest_version', v_latest_version,
    'missing',        to_jsonb(v_missing)
  );
exception
  when undefined_table or invalid_schema_name or insufficient_privilege then
    -- Fără ledger (CI efemer / proiect fără istoric) → sonda nu e disponibilă,
    -- NU o eroare: clientul o tratează ca `unknown`.
    return jsonb_build_object(
      'available',      false,
      'ledger_count',   null,
      'latest_name',    null,
      'latest_version', null,
      'missing',        null
    );
end;
$$;

revoke all on function public.get_schema_version(text[]) from public, anon, authenticated;
grant execute on function public.get_schema_version(text[]) to service_role;

comment on function public.get_schema_version(text[]) is
  'mig 271 (audit v3 RES-08): ce nume de migratii din manifestul clientului LIPSESC din supabase_migrations.schema_migrations. DEFINER obligatoriu (service_role nu are USAGE pe schema). Cheia e NAME, nu version.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. get_queue_backlog
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_queue_backlog()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cron', jsonb_build_object(
      -- claim_email_batch (242): queued, scadent, sub plafonul de încercări.
      'email', (
        select jsonb_build_object(
          'waiting', count(*),
          'oldest_age_s', coalesce(floor(extract(epoch from (now() - min(q.scheduled_for)))), 0))
          from public.email_queue q
         where q.status = 'queued'
           and q.scheduled_for <= now()
           and q.failed_attempts < 3
      ),
      -- claim_sms_batch (228): același contract.
      'sms', (
        select jsonb_build_object(
          'waiting', count(*),
          'oldest_age_s', coalesce(floor(extract(epoch from (now() - min(q.scheduled_for)))), 0))
          from public.sms_queue q
         where q.status = 'queued'
           and q.scheduled_for <= now()
           and q.failed_attempts < 3
      ),
      -- bridge_oblio_get_queued (269): queued, sub plafon, fereastra de backoff
      -- trecută, DOAR la restaurante cu config Oblio activ (altfel claim-ul
      -- n-o ridică niciodată → ar fi alarmă permanentă falsă).
      'invoices', (
        select jsonb_build_object(
          'waiting', count(*),
          'oldest_age_s', coalesce(floor(extract(epoch from (now() - min(greatest(i.created_at, coalesce(i.next_attempt_at, i.created_at)))))), 0))
          from public.invoices i
          join public.oblio_configs oc
            on oc.restaurant_id = i.restaurant_id and oc.is_active = true
         where i.status = 'queued'
           and i.failed_attempts < 3
           and (i.next_attempt_at is null or i.next_attempt_at <= now())
      ),
      -- claim_reservation_reminders (234): confirmed, netrimis, cu un canal
      -- LIVRABIL (email SAU mobil RO + modul + feature), în fereastra
      -- `reminder_hours_before`. Vârsta = de cât timp a intrat în fereastră.
      'reminders', (
        select jsonb_build_object(
          'waiting', count(*),
          'oldest_age_s', coalesce(floor(extract(epoch from max(now() - (r.starts_at - (s.reminder_hours_before || ' hours')::interval)))), 0))
          from public.reservations r
          join public.reservation_settings s on s.restaurant_id = r.restaurant_id
         where r.status = 'confirmed'
           and r.reminder_sent_at is null
           and (
             r.customer_email is not null
             or (
               public.fn_sms_normalize_ro_phone(r.customer_phone) is not null
               and public.is_module_enabled(r.restaurant_id, 'sms_notifications')
               and public.restaurant_has_feature(r.restaurant_id, 'sms_notifications')
             )
           )
           and r.starts_at > now()
           and r.starts_at <= now() + (s.reminder_hours_before || ' hours')::interval
      ),
      -- claim_pending_slack_alerts (175): doar raportat — fără webhook nu se
      -- revendică prin design, deci NU e criteriu de 503.
      'slack_alerts', (
        select jsonb_build_object('waiting', count(*))
          from public.customer_health_scores h
         where h.score < 40
           and h.trend = 'critical'
           and (h.slack_alerted_at is null or h.slack_alerted_at < now() - interval '24 hours')
      )
    ),
    'bridge', jsonb_build_object(
      'receipts', (
        select jsonb_build_object(
          'waiting', count(*),
          'oldest_age_s', coalesce(floor(extract(epoch from (now() - min(p.created_at)))), 0))
          from public.pending_receipts p
         where p.status = 'pending'
      ),
      'tickets', (
        select jsonb_build_object(
          'waiting', count(*),
          'oldest_age_s', coalesce(floor(extract(epoch from (now() - min(k.created_at)))), 0))
          from public.kitchen_tickets k
         where k.status = 'pending'
      )
    )
  );
$$;

revoke all on function public.get_queue_backlog() from public, anon, authenticated;
grant execute on function public.get_queue_backlog() to service_role;

comment on function public.get_queue_backlog() is
  'mig 271 (audit v3 RES-32): backlog-ul cozilor (numaratori + varsta celui mai vechi rand), cu predicate care OGLINDESC claim-urile. Grupa cron poate da 503 in /health, grupa bridge doar warn. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_sig text; v_res jsonb; v_keys text[];
begin
  -- A. get_schema_version: DEFINER + pg_temp, service_role-only, compară pe NAME,
  --    nu aruncă fără ledger (în CI schema chiar lipsește).
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_schema_version';
  if v_src is null then raise exception 'mig 271: get_schema_version lipseste'; end if;
  if position('security definer' in lower(v_src)) = 0 then
    raise exception 'mig 271: get_schema_version trebuie sa fie DEFINER — service_role nu are USAGE pe supabase_migrations (sonda ar fi moarta pe prod)'; end if;
  if position('pg_temp' in v_src) = 0 then
    raise exception 'mig 271: get_schema_version fara pg_temp in search_path'; end if;
  if position('supabase_migrations.schema_migrations' in v_src) = 0 or position('m.name = e' in v_src) = 0 then
    raise exception 'mig 271: get_schema_version nu compara pe NAME in ledger (clasa „behind permanent”)'; end if;
  if has_function_privilege('anon', 'public.get_schema_version(text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_schema_version(text[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_schema_version(text[])', 'EXECUTE') then
    raise exception 'mig 271: grant-urile pe get_schema_version sunt gresite (doar service_role)'; end if;
  v_res := public.get_schema_version(array['migration_271_health_probes']);
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_res) k;
  if v_keys is distinct from array['available','latest_name','latest_version','ledger_count','missing'] then
    raise exception 'mig 271: forma lui get_schema_version s-a schimbat: %', v_keys; end if;

  -- B. get_queue_backlog: DEFINER + pg_temp, service_role-only, legat de claim-uri,
  --    forma top-level {cron, bridge}.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_queue_backlog';
  if v_src is null then raise exception 'mig 271: get_queue_backlog lipseste'; end if;
  if position('security definer' in lower(v_src)) = 0 or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 271: get_queue_backlog nu e DEFINER cu pg_temp'; end if;
  foreach v_sig in array array['oblio_configs', 'reminder_hours_before', 'failed_attempts < 3',
                               'fn_sms_normalize_ro_phone', 'slack_alerted_at',
                               'pending_receipts', 'kitchen_tickets'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 271: get_queue_backlog s-a dezlegat de claim-uri („%” lipseste)', v_sig; end if;
  end loop;
  if has_function_privilege('anon', 'public.get_queue_backlog()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_queue_backlog()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_queue_backlog()', 'EXECUTE') then
    raise exception 'mig 271: grant-urile pe get_queue_backlog sunt gresite (doar service_role)'; end if;
  v_res := public.get_queue_backlog();
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_res) k;
  if v_keys is distinct from array['bridge','cron'] then
    raise exception 'mig 271: forma lui get_queue_backlog s-a schimbat: %', v_keys; end if;

  raise notice 'mig 271: sondele get_schema_version + get_queue_backlog OK';
end $$;

commit;
