-- Migration 060: Slack alerting pentru health score critic
-- ─────────────────────────────────────────────────────────────────────
-- compute_health_scores() (mig 039) trimite deja email patron + insert
-- lifecycle_event. Acest sprint adaugă infra Slack pentru ADMIN (Radu să
-- sune patronul rapid pre-churn).
-- Idempotent: dacă SLACK_WEBHOOK_URL lipsește în Netlify env, funcția
-- cron skip silent (no harm). Dacă e setat, marchează slack_alerted_at
-- ca să nu duplice notificările.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Coloana slack_alerted_at — separat de email alerted_at
-- ─────────────────────────────────────────────────────────────────────
alter table public.customer_health_scores
  add column if not exists slack_alerted_at timestamptz;

comment on column public.customer_health_scores.slack_alerted_at is
  'Ultima dată când scor critic a fost trimis la Slack admin. Separat de '
  'alerted_at care e pentru emailul către patron — canale independente.';

-- Index parțial pentru claim rapid (rândurile fără alert sau cu alert > 24h)
create index if not exists idx_health_scores_slack_pending
  on public.customer_health_scores (slack_alerted_at)
  where score < 40;

-- ─────────────────────────────────────────────────────────────────────
-- 2. RPC: claim_pending_slack_alerts — atomic pickup pentru cron
-- ─────────────────────────────────────────────────────────────────────
-- Pattern: update + returning într-un singur statement (anti race-condition
-- pentru cron-uri concurente). Filtru: score < 40 (critical) AND trend =
-- 'critical' AND (slack_alerted_at NULL or > 24h vechi).
-- Returnează tot ce are nevoie funcția JS să compună payload-ul Slack.
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
set search_path = public
as $$
begin
  return query
  with claimed as (
    update public.customer_health_scores h
       set slack_alerted_at = now()
      from public.restaurants r
     where h.restaurant_id = r.id
       and h.score < 40
       and h.trend = 'critical'
       and (h.slack_alerted_at is null
            or h.slack_alerted_at < now() - interval '24 hours')
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
  join public.profiles p    on p.id = r.owner_id
  limit p_batch_size;
end;
$$;

revoke all on function public.claim_pending_slack_alerts(int) from public;
grant execute on function public.claim_pending_slack_alerts(int) to service_role;

comment on function public.claim_pending_slack_alerts(int) is
  'Cron pickup: returnează (and atomic-marchează) rândurile health_score '
  'critice ne-alertate Slack în ultimele 24h. Apelat de '
  'send-health-slack-alerts (Netlify scheduled).';

-- ─────────────────────────────────────────────────────────────────────
-- Verificare manuală (după aplicare):
-- ─────────────────────────────────────────────────────────────────────
-- select restaurant_id, score, trend, alerted_at, slack_alerted_at
-- from customer_health_scores
-- where score < 40
-- order by computed_at desc;
--
-- -- Force test (Drop scor temporar):
-- update customer_health_scores set score = 25, trend = 'critical'
-- where restaurant_id = '<uuid-test>';
-- -- Then trigger cron manually:
-- select * from claim_pending_slack_alerts(20);
-- -- Verifică slack_alerted_at = now()
