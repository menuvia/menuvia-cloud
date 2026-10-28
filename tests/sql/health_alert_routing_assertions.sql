-- tests/sql/health_alert_routing_assertions.sql
-- =============================================================================
-- Mig 300 — alerta „client în pericol" merge la AGENT, niciodată la patron.
-- Lanț compute_health_scores: 039 → 040 → 182 → 300.
--
--   HA1  agent ACTIV cu atribuire ne-terminală (active ȘI pending) → exact UN
--        rând agent_client_at_risk către emailul AGENTULUI (user_id = profilul
--        lui, cheia health_alert:<rid>:<zi>), template_data = EXACT cheile din
--        contract, fără nicio valoare a patronului; ZERO rânduri către patron
--        (control pozitiv: patronul ARE email), zero health_score_alert noi.
--   HA2  fără atribuire → zero emailuri, dar `health_critical` tot se scrie.
--   HA3  atribuire canceled / refunded / expired, agent suspended / pending,
--        acces revocat explicit de patron → zero emailuri (health_critical da).
--   HA4  dead-man's switch: cu funcția REALĂ de scor, computed_at avansează la
--        now() pentru TOATE restaurantele active; `limit p_batch_size` ținut.
--   HA4b un eșec în rutarea către agent (enqueue care aruncă) NU oprește lotul:
--        restul restaurantelor sunt calculate, celălalt agent își primește
--        alerta, health_critical se scrie și pentru restaurantul cu eșec.
--   HA5  privilegii EFECTIVE: service_role DA, anon/authenticated NU (+ apel
--        REAL sub `authenticated` → 42501 pe ACL-ul FUNCȚIEI); DEFINER cu
--        search_path = public, pg_temp; exact o semnătură; rămâne în
--        denylist-ul pg_cron și NU e în manifest (heartbeat-ul Netlify).
--   HA6  corpul: izolarea per-restaurant `exception when others` în jurul lui
--        _compute_one_health_score; batching; health_critical; fără emailul
--        patronului; fără health_score_alert.
--
-- HA1–HA3 înlocuiesc `_compute_one_health_score` în tranzacție (SAVEPOINT +
-- ROLLBACK TO) cu un stub care cere alertă DOAR pentru restaurantele fixturii —
-- funcția reală alertează abia după un scor anterior și un prag de 24h.
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
-- Patroni O1..O9 (un restaurant fiecare), agenți A, B (activi), S (suspendat),
-- P (pending).
insert into auth.users (id, email) values
  ('eac00000-0000-4000-8000-0000000000a1','ha-owner1@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a2','ha-owner2@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a3','ha-owner3@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a4','ha-owner4@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a5','ha-owner5@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a6','ha-owner6@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a7','ha-owner7@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a8','ha-owner8@ha.test'),
  ('eac00000-0000-4000-8000-0000000000a9','ha-owner9@ha.test'),
  ('eac00000-0000-4000-8000-0000000000b1','ha-agent-a@ha.test'),
  ('eac00000-0000-4000-8000-0000000000b2','ha-agent-b@ha.test'),
  ('eac00000-0000-4000-8000-0000000000b3','ha-agent-s@ha.test'),
  ('eac00000-0000-4000-8000-0000000000b4','ha-agent-p@ha.test');

update public.profiles set full_name = 'Patron HA ' || right(id::text, 1)
 where id::text like 'eac00000-0000-4000-8000-0000000000a%';
update public.profiles set full_name = 'Agent HA ' || right(id::text, 1)
 where id::text like 'eac00000-0000-4000-8000-0000000000b%';

insert into public.restaurants (id, owner_id, name, slug, city, is_active)
select ('eac00000-0000-4000-8000-00000000000' || n)::uuid,
       ('eac00000-0000-4000-8000-0000000000a' || n)::uuid,
       'HA R' || n, 'ha-r' || n, 'Cluj', true
  from generate_series(1, 9) n;

insert into public.affiliates (id, profile_id, referral_code) values
  ('eac00000-0000-4000-8000-0000000000c1','eac00000-0000-4000-8000-0000000000b1','haagenta1'),
  ('eac00000-0000-4000-8000-0000000000c2','eac00000-0000-4000-8000-0000000000b2','haagentb1'),
  ('eac00000-0000-4000-8000-0000000000c3','eac00000-0000-4000-8000-0000000000b3','haagents1'),
  ('eac00000-0000-4000-8000-0000000000c4','eac00000-0000-4000-8000-0000000000b4','haagentp1');
update public.affiliates set status = 'suspended' where id = 'eac00000-0000-4000-8000-0000000000c3';
update public.affiliates set status = 'pending'   where id = 'eac00000-0000-4000-8000-0000000000c4';

-- R1 activ/A · R2 pending/B · R3 fără · R4 canceled/A · R5 refunded/A ·
-- R6 expired/A · R7 activ/S(suspendat) · R8 activ/A dar REVOCAT · R9 activ/P(pending)
insert into public.affiliate_attributions (affiliate_id, referred_profile_id, status, source) values
  ('eac00000-0000-4000-8000-0000000000c1','eac00000-0000-4000-8000-0000000000a1','active','link'),
  ('eac00000-0000-4000-8000-0000000000c2','eac00000-0000-4000-8000-0000000000a2','pending','link'),
  ('eac00000-0000-4000-8000-0000000000c1','eac00000-0000-4000-8000-0000000000a4','canceled','link'),
  ('eac00000-0000-4000-8000-0000000000c1','eac00000-0000-4000-8000-0000000000a5','refunded','link'),
  ('eac00000-0000-4000-8000-0000000000c1','eac00000-0000-4000-8000-0000000000a6','expired','link'),
  ('eac00000-0000-4000-8000-0000000000c3','eac00000-0000-4000-8000-0000000000a7','active','link'),
  ('eac00000-0000-4000-8000-0000000000c1','eac00000-0000-4000-8000-0000000000a8','active','link'),
  ('eac00000-0000-4000-8000-0000000000c4','eac00000-0000-4000-8000-0000000000a9','active','link');
update public.affiliate_attributions set partner_access_revoked_at = now()
 where referred_profile_id = 'eac00000-0000-4000-8000-0000000000a8';

create temp table ha_fx(rid uuid primary key, owner uuid, n int);
insert into ha_fx
select ('eac00000-0000-4000-8000-00000000000' || n)::uuid,
       ('eac00000-0000-4000-8000-0000000000a' || n)::uuid, n
  from generate_series(1, 9) n;

-- Baseline: alertele interne existente înainte (fixtura persistentă a CI-ului).
create temp table ha_base as
select count(*) as internal_alerts from public.email_queue where template_kind = 'health_score_alert';

-- ── HA5 / HA6: catalogul (fără stare) ────────────────────────────────────────
do $$
declare
  v_src text;
  v_n int;
  v_err text;
begin
  select count(*) into v_n from pg_proc
   where proname = 'compute_health_scores' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then raise exception 'HA5: % semnături compute_health_scores (trebuie 1 — PGRST203)', v_n; end if;

  if not has_function_privilege('service_role', 'public.compute_health_scores(integer)', 'execute') then
    raise exception 'HA5: service_role NU poate apela compute_health_scores — /health.checks.cron ar citi un timestamp MORT'; end if;
  if has_function_privilege('anon', 'public.compute_health_scores(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.compute_health_scores(integer)', 'execute') then
    raise exception 'HA5: anon/authenticated pot apela compute_health_scores (scrie în email_queue ca DEFINER)'; end if;

  if not exists (select 1 from pg_proc
                  where oid = 'public.compute_health_scores(integer)'::regprocedure
                    and prosecdef and proconfig @> array['search_path=public, pg_temp']) then
    raise exception 'HA5: compute_health_scores nu e DEFINER cu search_path = public, pg_temp'; end if;

  if not exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'compute_health_scores') then
    raise exception 'HA5: compute_health_scores a ieșit din denylist-ul pg_cron'; end if;
  if exists (select 1 from public.pg_cron_janitor_manifest where signature like 'public.compute_health_scores(%') then
    raise exception 'HA5: compute_health_scores e în manifestul pg_cron — dead-man''s switch-ul Netlify ar fi verde cu Netlify mort'; end if;

  v_src := (select prosrc from pg_proc where oid = 'public.compute_health_scores(integer)'::regprocedure);
  if v_src !~ '_compute_one_health_score\(r\.id\);\s*exception when others' then
    raise exception 'HA6: izolarea per-restaurant (exception when others în jurul _compute_one_health_score) lipsește'; end if;
  if position('limit p_batch_size' in v_src) = 0 then
    raise exception 'HA6: limit p_batch_size lipsește'; end if;
  if position('''health_critical''' in v_src) = 0 then
    raise exception 'HA6: inserarea health_critical lipsește'; end if;
  if position('agent_client_at_risk' in v_src) = 0 then
    raise exception 'HA6: agent_client_at_risk lipsește din corp'; end if;
  if position('health_score_alert' in v_src) > 0 or v_src ~ '\m[rp]\.email\M' then
    raise exception 'HA6: corpul încă trimite alerta internă / citește emailul patronului'; end if;

  -- Apel REAL sub rolul authenticated: pică pe ACL-ul FUNCȚIEI (nu pe schemă).
  perform set_config('request.jwt.claim.sub', 'eac00000-0000-4000-8000-0000000000a1', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.compute_health_scores(1);
    v_err := 'ok';
  exception when insufficient_privilege then
    v_err := sqlerrm;
  end;
  perform set_config('role', 'none', true);
  if v_err not like '%for function%' then
    raise exception 'HA5: authenticated a apelat compute_health_scores (rezultat: %)', v_err; end if;

  raise notice 'HA5/HA6 OK';
end $$;

-- ── HA1–HA3: rutarea, cu scorul forțat critic pe fixtură ─────────────────────
savepoint ha_stub;

create or replace function public._compute_one_health_score(p_restaurant_id uuid)
returns table (score integer, trend text, alert_needed boolean)
language sql
as $$
  select 25, 'critical'::text,
         p_restaurant_id in (select f.rid from pg_temp.ha_fx f)
$$;

create temp table ha_run as select * from public.compute_health_scores();

do $$
declare
  v_today text := to_char(now(), 'YYYY-MM-DD');
  v_n int;
  v_row record;
  v_keys text[];
begin
  -- Control pozitiv: stub-ul a cerut alertă pe toate cele 9 restaurante.
  select count(*) into v_n from ha_run r join ha_fx f on f.rid = r.restaurant_id where r.alert_needed;
  if v_n <> 9 then raise exception 'HA1: control — % alerte pe fixtură (aștept 9)', v_n; end if;
  -- Control pozitiv: patronii AU email (altfel „0 rânduri la patron" e vacuu).
  select count(*) into v_n from ha_fx f join public.profiles p on p.id = f.owner
   where nullif(btrim(p.email), '') is not null;
  if v_n <> 9 then raise exception 'HA1: control — doar % patroni cu email', v_n; end if;

  -- HA1: R1 (atribuire active, agent A).
  select count(*) into v_n from public.email_queue
   where dedup_key = 'health_alert:eac00000-0000-4000-8000-000000000001:' || v_today;
  if v_n <> 1 then raise exception 'HA1: % rânduri pentru R1 (aștept 1)', v_n; end if;
  select * into v_row from public.email_queue
   where dedup_key = 'health_alert:eac00000-0000-4000-8000-000000000001:' || v_today;
  if v_row.template_kind is distinct from 'agent_client_at_risk'::email_template_kind
     or v_row.recipient_email is distinct from 'ha-agent-a@ha.test'
     or v_row.user_id is distinct from 'eac00000-0000-4000-8000-0000000000b1'::uuid
     or v_row.recipient_name is distinct from 'Agent HA 1' then
    raise exception 'HA1: rândul R1 greșit: kind=% to=% user=% name=%',
      v_row.template_kind, v_row.recipient_email, v_row.user_id, v_row.recipient_name; end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_row.template_data) k;
  if v_keys is distinct from array['agent_name','city','restaurant_name','score','trend']::text[] then
    raise exception 'HA1: cheile template_data ≠ contractul: %', v_keys; end if;
  if v_row.template_data->>'restaurant_name' is distinct from 'HA R1'
     or v_row.template_data->>'city' is distinct from 'Cluj'
     or (v_row.template_data->>'score')::int is distinct from 25
     or v_row.template_data->>'trend' is distinct from 'critical' then
    raise exception 'HA1: valori template_data greșite: %', v_row.template_data; end if;
  if exists (select 1 from jsonb_each_text(v_row.template_data) e
              where e.value in ('ha-owner1@ha.test', 'Patron HA 1')) then
    raise exception 'HA1: date ale patronului în template_data: %', v_row.template_data; end if;

  -- HA1: R2 (atribuire PENDING, agent B) — ne-terminală → tot primește.
  select count(*) into v_n from public.email_queue
   where dedup_key = 'health_alert:eac00000-0000-4000-8000-000000000002:' || v_today
     and template_kind = 'agent_client_at_risk' and recipient_email = 'ha-agent-b@ha.test';
  if v_n <> 1 then raise exception 'HA1: atribuirea pending (R2) — % rânduri către agentul B (aștept 1)', v_n; end if;

  -- HA1: NICIUN rând către vreun patron, NICIO alertă internă nouă.
  select count(*) into v_n from public.email_queue q
    join public.profiles p on lower(p.email) = lower(q.recipient_email)
    join ha_fx f on f.owner = p.id;
  if v_n <> 0 then raise exception 'HA1: % emailuri către PATRONI', v_n; end if;
  select count(*) into v_n from public.email_queue q join ha_fx f on f.owner = q.user_id;
  if v_n <> 0 then raise exception 'HA1: % rânduri cu user_id = patron (RLS user reads own)', v_n; end if;
  if (select count(*) from public.email_queue where template_kind = 'health_score_alert')
       is distinct from (select internal_alerts from ha_base) then
    raise exception 'HA1: s-au pus în coadă alerte interne health_score_alert'; end if;
  raise notice 'HA1 OK';

  -- HA2: R3 fără atribuire → 0 emailuri, health_critical scris pe patron.
  select count(*) into v_n from public.email_queue
   where dedup_key like 'health_alert:eac00000-0000-4000-8000-000000000003:%';
  if v_n <> 0 then raise exception 'HA2: % emailuri pentru restaurantul fără agent', v_n; end if;
  select count(*) into v_n from public.lifecycle_events
   where restaurant_id = 'eac00000-0000-4000-8000-000000000003'
     and user_id = 'eac00000-0000-4000-8000-0000000000a3'
     and event_type = 'health_critical' and (event_data->>'score')::int = 25;
  if v_n <> 1 then raise exception 'HA2: health_critical pentru R3 = % (aștept 1)', v_n; end if;
  raise notice 'HA2 OK';

  -- HA3: R4..R9 → 0 emailuri; health_critical tot scris.
  for v_row in select * from ha_fx where n between 4 and 9 order by n loop
    select count(*) into v_n from public.email_queue
     where dedup_key like 'health_alert:' || v_row.rid::text || ':%';
    if v_n <> 0 then
      raise exception 'HA3: R% (% ) a primit % email(uri) — filtrul de atribuire/agent/revocare s-a pierdut',
        v_row.n,
        case v_row.n when 4 then 'canceled' when 5 then 'refunded' when 6 then 'expired'
                     when 7 then 'agent suspendat' when 8 then 'acces revocat' else 'agent pending' end,
        v_n;
    end if;
    if not exists (select 1 from public.lifecycle_events
                    where restaurant_id = v_row.rid and event_type = 'health_critical') then
      raise exception 'HA3: health_critical lipsă pentru R%', v_row.n; end if;
  end loop;
  -- Exact 2 emailuri de rutare pe toată fixtura (R1, R2).
  select count(*) into v_n from public.email_queue q join ha_fx f
      on q.dedup_key = 'health_alert:' || f.rid::text || ':' || v_today;
  if v_n <> 2 then raise exception 'HA3: % emailuri pe fixtură (aștept 2: R1, R2)', v_n; end if;
  raise notice 'HA3 OK';
end $$;

rollback to savepoint ha_stub;

-- ── HA4: dead-man's switch cu funcția REALĂ ──────────────────────────────────
savepoint ha_real;

-- Funcția reală citește auth.users.last_sign_in_at (coloană GoTrue). Mock-ul de
-- auth din sql-verify n-o are; pe stack-ul Supabase real (jobul E2E) și pe prod
-- există. Pe stack-ul real `auth.users` aparține altui rol, iar chiar și un
-- `add column if not exists` cere proprietatea tabelului ÎNAINTE de a verifica
-- existența coloanei (42501 „must be owner of table users") — deci ALTER-ul se
-- execută DOAR când coloana lipsește (mock-ul sql-verify). Adăugată doar în
-- tranzacția testului.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name = 'last_sign_in_at'
  ) then
    execute 'alter table auth.users add column last_sign_in_at timestamptz';
  end if;
end $$;
insert into public.customer_health_scores (restaurant_id, score, computed_at)
select rid, 80, '2020-01-01' from ha_fx;

do $$
declare v_n int; v_total int;
begin
  -- Control: chiar sunt rânduri vechi de avansat.
  select count(*) into v_n from public.customer_health_scores h join ha_fx f on f.rid = h.restaurant_id
   where h.computed_at < now() - interval '1 year';
  if v_n <> 9 then raise exception 'HA4: control — % scoruri vechi pe fixtură', v_n; end if;

  perform public.compute_health_scores();

  select count(*) into v_total from public.restaurants where is_active;
  select count(*) into v_n from public.restaurants r
   where r.is_active
     and not exists (select 1 from public.customer_health_scores h
                      where h.restaurant_id = r.id and h.computed_at = now());
  if v_total < 9 or v_n <> 0 then
    raise exception 'HA4: % din % restaurante active NU au computed_at = now() — /health.checks.cron ar minți', v_n, v_total; end if;

  select count(*) into v_n from public.compute_health_scores(1);
  if v_n <> 1 then raise exception 'HA4: compute_health_scores(1) a întors % rânduri (limit p_batch_size)', v_n; end if;
  raise notice 'HA4 OK (% restaurante active)', v_total;
end $$;

-- Funcția reală poate alerta (scorul anterior 80 → critic): rândurile ei nu
-- au voie să contamineze controlul din HA4b.
rollback to savepoint ha_real;

-- ── HA4b: un eșec în rutarea către agent NU oprește lotul ────────────────────
savepoint ha_fail;

create or replace function public._compute_one_health_score(p_restaurant_id uuid)
returns table (score integer, trend text, alert_needed boolean)
language plpgsql
as $$
begin
  insert into public.customer_health_scores (restaurant_id, score, computed_at)
  values (p_restaurant_id, 25, now())
  on conflict (restaurant_id) do update set computed_at = now(), score = 25;
  return query select 25, 'critical'::text, p_restaurant_id in (select f.rid from pg_temp.ha_fx f);
end $$;

-- enqueue_email care ARUNCĂ pentru agentul A (R1); B (R2) trebuie să treacă.
create or replace function public.enqueue_email(
  p_recipient_email text, p_template_kind email_template_kind, p_template_data jsonb default '{}'::jsonb,
  p_user_id uuid default null, p_recipient_name text default null,
  p_scheduled_for timestamptz default null, p_dedup_key text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_recipient_email = 'ha-agent-a@ha.test' then
    raise exception 'HA4b: enqueue simulat picat';
  end if;
  insert into public.email_queue (recipient_email, recipient_name, user_id, template_kind, template_data, scheduled_for, dedup_key)
  values (p_recipient_email, p_recipient_name, p_user_id, p_template_kind, coalesce(p_template_data, '{}'::jsonb),
          coalesce(p_scheduled_for, now()), p_dedup_key)
  on conflict (dedup_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

do $$
declare v_n int;
begin
  begin
    perform public.compute_health_scores();
  exception when others then
    raise exception 'HA4b: un enqueue picat a OPRIT tot lotul (dead-man''s switch mort): %', sqlerrm;
  end;
  select count(*) into v_n from ha_fx f
   where not exists (select 1 from public.customer_health_scores h
                      where h.restaurant_id = f.rid and h.computed_at = now());
  if v_n <> 0 then raise exception 'HA4b: % restaurante necalculate după eșecul de enqueue', v_n; end if;
  if not exists (select 1 from public.email_queue
                  where recipient_email = 'ha-agent-b@ha.test' and template_kind = 'agent_client_at_risk') then
    raise exception 'HA4b: agentul B nu și-a primit alerta după eșecul de la agentul A'; end if;
  if exists (select 1 from public.email_queue where recipient_email = 'ha-agent-a@ha.test') then
    raise exception 'HA4b: control — enqueue-ul simulat nu a picat'; end if;
  if not exists (select 1 from public.lifecycle_events
                  where restaurant_id = 'eac00000-0000-4000-8000-000000000001' and event_type = 'health_critical') then
    raise exception 'HA4b: health_critical lipsă pentru restaurantul cu enqueue picat'; end if;
  raise notice 'HA4b OK';
end $$;

rollback to savepoint ha_fail;

rollback;
