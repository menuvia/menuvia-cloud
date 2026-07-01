-- Migration 175: fix claim_pending_slack_alerts + mark_slack_alert_failed
-- ─────────────────────────────────────────────────────────────────────
-- Context: RPC-ul claim_pending_slack_alerts (mig 060) avea 2 bug-uri:
--   (a) LIMIT-ul era în SELECT-ul final, nu în UPDATE-ul din CTE → UPDATE-ul
--       marca slack_alerted_at pe TOATE rândurile eligibile, dar SELECT-ul
--       returna doar p_batch_size. Restul rândurilor rămâneau marcate fără
--       să fie trimise → alerte pierdute 24h.
--   (b) marca slack_alerted_at ÎNAINTE de confirmarea POST-ului Slack → dacă
--       POST-ul eșua, alerta era pierdută 24h (nimic n-o re-încerca).
--
-- Fix:
--   1. Recreăm claim_pending_slack_alerts astfel încât LIMIT-ul să fie în
--      selecția rândurilor de claimuit (CTE to_claim ... limit ... for update
--      skip locked), apoi marcăm DOAR acele rânduri.
--   2. Adăugăm mark_slack_alert_failed(uuid[]) care resetează slack_alerted_at
--      = null pentru rândurile unde POST-ul Slack a eșuat → re-încercare la
--      următorul tick de cron.
--
-- NB: PK-ul customer_health_scores e restaurant_id (nu există coloană id).
-- NU edităm mig 060 (migrațiile aplicate sunt imuabile).

-- ─────────────────────────────────────────────────────────────────────
-- 1. claim_pending_slack_alerts — LIMIT mutat în selecția rândurilor
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.claim_pending_slack_alerts(
  p_batch_size int default 20
)
returns table (
  restaurant_id     uuid,
  restaurant_name   text,
  owner_email       text,
  owner_full_name   text,
  score             integer,
  previous_score    integer,
  trend             text,
  orders_this_week  integer,
  orders_prev_week  integer,
  last_login        timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  -- to_claim: selectăm DOAR p_batch_size rânduri eligibile (LIMIT aici, nu în
  -- SELECT-ul final). FOR UPDATE SKIP LOCKED → anti race-condition pentru
  -- cron-uri concurente. Lockuim pe tabelul de bază (fără join).
  with to_claim as (
    select h.restaurant_id
    from public.customer_health_scores h
    where h.score < 40
      and h.trend = 'critical'
      and (h.slack_alerted_at is null
           or h.slack_alerted_at < now() - interval '24 hours')
    order by h.score asc, h.computed_at desc
    limit p_batch_size
    for update skip locked
  ),
  claimed as (
    -- Marcăm DOAR rândurile alese în to_claim.
    update public.customer_health_scores h
       set slack_alerted_at = now()
     where h.restaurant_id in (select tc.restaurant_id from to_claim tc)
    returning
      h.restaurant_id,
      h.score,
      h.previous_score,
      h.trend,
      nullif(h.details->>'orders_this_week', '')::int as orders_this_week,
      nullif(h.details->>'orders_prev_week', '')::int as orders_prev_week,
      nullif(h.details->>'last_login', '')::timestamptz as last_login
  )
  select
    c.restaurant_id,
    r.name             as restaurant_name,
    p.email            as owner_email,
    p.full_name        as owner_full_name,
    c.score,
    c.previous_score,
    c.trend,
    c.orders_this_week,
    c.orders_prev_week,
    c.last_login
  from claimed c
  join public.restaurants r on r.id = c.restaurant_id
  join public.profiles p    on p.id = r.owner_id;
end;
$$;

revoke all on function public.claim_pending_slack_alerts(int) from public;
grant execute on function public.claim_pending_slack_alerts(int) to service_role;

comment on function public.claim_pending_slack_alerts(int) is
  'Cron pickup: returnează (and atomic-marchează) rândurile health_score '
  'critice ne-alertate Slack în ultimele 24h. LIMIT-ul e în selecția '
  'rândurilor de claimuit → marchează DOAR ce returnează. Apelat de '
  'send-health-slack-alerts (Netlify scheduled).';

-- ─────────────────────────────────────────────────────────────────────
-- 2. mark_slack_alert_failed — reset slack_alerted_at pt. re-încercare
-- ─────────────────────────────────────────────────────────────────────
-- Apelat de funcția JS cu restaurant_id-urile pentru care POST-ul Slack a
-- eșuat (!resp.ok sau throw). Resetează slack_alerted_at = null ca rândul să
-- redevină eligibil la următorul tick de cron.
create or replace function public.mark_slack_alert_failed(
  p_restaurant_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_restaurant_ids is null or array_length(p_restaurant_ids, 1) is null then
    return 0;
  end if;

  update public.customer_health_scores h
     set slack_alerted_at = null
   where h.restaurant_id = any(p_restaurant_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_slack_alert_failed(uuid[]) from public;
grant execute on function public.mark_slack_alert_failed(uuid[]) to service_role;

comment on function public.mark_slack_alert_failed(uuid[]) is
  'Reset slack_alerted_at = null pentru rândurile unde POST-ul Slack a eșuat '
  '→ re-încercare la următorul tick de cron. Apelat de '
  'send-health-slack-alerts (Netlify scheduled).';
