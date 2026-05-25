-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 039 — Automation Infrastructure (SaaS automation max)
-- ═══════════════════════════════════════════════════════════════
-- Construiește backbone-ul pentru toate automation flows:
--   1. lifecycle_events     — eveniment-uri pe care le emite produsul
--   2. email_queue          — coadă outbound pt. emails (procesată de cron)
--   3. customer_health_scores — scor 0-100 per restaurant + alerting
--   4. weekly_reports       — rapoarte săptămânale auto-generate
--   5. Triggers automate     — populează lifecycle_events la milestones

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 1. LIFECYCLE EVENTS                                          ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Eveniment-uri logice: signup, first_product, first_order, no_login_7d,
-- payment_failed, churned, etc. Folosite pentru:
--   - Email automation (trigger pe insert)
--   - Customer Health Score (input)
--   - Analytics produs
--   - Slack alerts

create table if not exists public.lifecycle_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete cascade,
  restaurant_id   uuid references public.restaurants(id) on delete cascade,
  event_type      text not null,
  event_data      jsonb default '{}'::jsonb,
  -- Procesare automatizări
  processed_at    timestamptz,
  process_attempts integer not null default 0,
  process_error   text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_lifecycle_events_user        on public.lifecycle_events(user_id);
create index if not exists idx_lifecycle_events_restaurant  on public.lifecycle_events(restaurant_id);
create index if not exists idx_lifecycle_events_type        on public.lifecycle_events(event_type);
create index if not exists idx_lifecycle_events_unprocessed on public.lifecycle_events(processed_at) where processed_at is null;
create index if not exists idx_lifecycle_events_created     on public.lifecycle_events(created_at desc);

alter table public.lifecycle_events enable row level security;
-- Service role only — funcțiile populează, cron procesează
create policy "lifecycle_events: admin can read own"
  on public.lifecycle_events for select
  using (
    user_id = auth.uid()
    or (restaurant_id is not null and public.is_admin(restaurant_id))
  );

comment on table public.lifecycle_events is
  'Eveniment-uri produs pentru automation: signup, first_order, no_login, plan_changed, payment_failed, etc.';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 2. EMAIL QUEUE                                                ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Coadă outbound: orice email automat scrie aici, un cron procesează.
-- Avantaj vs trimitere directă: retry, throttling, audit, dedup.

create type email_template_kind as enum (
  'welcome',
  'onboarding_no_products',
  'onboarding_no_orders',
  'win_back_7d',
  'win_back_30d',
  'trial_ending_3d',
  'trial_ending_1d',
  'payment_failed',
  'payment_recovered',
  'subscription_cancelled',
  'weekly_report',
  'monthly_recap',
  'health_score_alert',
  'nps_survey',
  'milestone_100_orders',
  'milestone_1000_orders',
  'milestone_first_month',
  'invoice_ready',
  'custom'
);

create table if not exists public.email_queue (
  id               uuid primary key default gen_random_uuid(),
  recipient_email  text not null,
  recipient_name   text,
  user_id          uuid references public.profiles(id) on delete set null,
  template_kind    email_template_kind not null,
  template_data    jsonb default '{}'::jsonb,  -- vars pt. template (nume, valoare, etc.)
  subject_override text,                          -- opțional override
  -- Procesare
  status           text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for    timestamptz not null default now(),  -- pt. delayed sends
  sent_at          timestamptz,
  failed_attempts  integer not null default 0,
  last_error       text,
  -- Dedup: previne dublu-trimitere a aceluiași tip pentru același user
  dedup_key        text unique,
  created_at       timestamptz not null default now()
);

create index if not exists idx_email_queue_status       on public.email_queue(status);
create index if not exists idx_email_queue_scheduled    on public.email_queue(scheduled_for) where status = 'queued';
create index if not exists idx_email_queue_user         on public.email_queue(user_id);
create index if not exists idx_email_queue_created      on public.email_queue(created_at desc);

alter table public.email_queue enable row level security;
-- User can see their own emails (transparency)
create policy "email_queue: user reads own"
  on public.email_queue for select
  using (user_id = auth.uid());

comment on table public.email_queue is
  'Outbound email queue. Procesată de Netlify cron process-email-queue.js.';

-- Helper RPC: enqueue email cu dedup automată
create or replace function public.enqueue_email(
  p_recipient_email  text,
  p_template_kind    email_template_kind,
  p_template_data    jsonb default '{}'::jsonb,
  p_user_id          uuid default null,
  p_recipient_name   text default null,
  p_scheduled_for    timestamptz default null,
  p_dedup_key        text default null  -- if set, prevents duplicate sends
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.email_queue (
    recipient_email, recipient_name, user_id,
    template_kind, template_data, scheduled_for, dedup_key
  ) values (
    p_recipient_email, p_recipient_name, p_user_id,
    p_template_kind, coalesce(p_template_data, '{}'::jsonb),
    coalesce(p_scheduled_for, now()), p_dedup_key
  )
  on conflict (dedup_key) do nothing
  returning id into v_id;

  return v_id;  -- null dacă deduplicat
end;
$$;

revoke all on function public.enqueue_email(text, email_template_kind, jsonb, uuid, text, timestamptz, text) from public;
-- Service role doar.


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 3. CUSTOMER HEALTH SCORES                                    ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Scor 0-100 per restaurant. Calculat de cron compute-health-scores.
-- Drop sub 50 → alert Slack/email Radu să sune patronul.
-- Reducere churn estimată: 40-60% conform document strategic.

create table if not exists public.customer_health_scores (
  restaurant_id   uuid primary key references public.restaurants(id) on delete cascade,
  score           integer not null check (score between 0 and 100),
  -- Breakdown pentru transparență:
  score_login     integer not null default 0,  -- max 20  (login în ultimele 3 zile)
  score_orders    integer not null default 0,  -- max 30  (creștere comenzi WoW)
  score_team      integer not null default 0,  -- max 15  (echipă >= 3 membri)
  score_tickets   integer not null default 0,  -- max 20  (0 tickets open)
  score_engagement integer not null default 0, -- max 15  (folosește 3+ features)
  -- Tracking
  previous_score  integer,
  trend           text check (trend in ('rising', 'stable', 'declining', 'critical')),
  -- Alerting
  alerted_at      timestamptz,                 -- ultima dată când am alertat
  -- Audit
  computed_at     timestamptz not null default now(),
  details         jsonb default '{}'::jsonb    -- date debug
);

create index if not exists idx_health_scores_score on public.customer_health_scores(score);
create index if not exists idx_health_scores_trend on public.customer_health_scores(trend);

alter table public.customer_health_scores enable row level security;
create policy "health_scores: admin reads own"
  on public.customer_health_scores for select
  using (public.is_admin(restaurant_id));

comment on table public.customer_health_scores is
  'Customer Health Score 0-100 per restaurant. Computed by cron, drives proactive support.';

-- ─────────────────────────────────────────────────────────────────
-- RPC: compute_health_scores — calculează scoruri pt. toate restaurantele
-- ─────────────────────────────────────────────────────────────────
-- Apelată de cron (Netlify scheduled function) la fiecare 6 ore.
-- Returnează numărul de scoruri actualizate.
create or replace function public.compute_health_scores()
returns table (
  restaurant_id  uuid,
  score          integer,
  trend          text,
  alert_needed   boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_score_login    int;
  v_score_orders   int;
  v_score_team     int;
  v_score_tickets  int;
  v_score_engage   int;
  v_total          int;
  v_previous       int;
  v_trend          text;
  v_alert          boolean;
  v_last_login     timestamptz;
  v_orders_week    int;
  v_orders_prev    int;
  v_team_size      int;
  v_open_alerts    int;
begin
  for r in
    select rest.id, rest.owner_id, p.email, p.full_name
    from public.restaurants rest
    join public.profiles p on p.id = rest.owner_id
    where rest.is_active = true
  loop
    -- SCORE_LOGIN (max 20): based on owner's last sign_in_at
    select last_sign_in_at into v_last_login
    from auth.users where id = r.owner_id;

    v_score_login := case
      when v_last_login is null then 0
      when v_last_login > now() - interval '1 day'  then 20
      when v_last_login > now() - interval '3 days' then 15
      when v_last_login > now() - interval '7 days' then 8
      when v_last_login > now() - interval '14 days' then 3
      else 0
    end;

    -- SCORE_ORDERS (max 30): WoW growth + total volume
    select count(*) into v_orders_week
    from public.orders
    where restaurant_id = r.id
      and created_at > now() - interval '7 days'
      and status not in ('cancelled');

    select count(*) into v_orders_prev
    from public.orders
    where restaurant_id = r.id
      and created_at between now() - interval '14 days' and now() - interval '7 days'
      and status not in ('cancelled');

    v_score_orders := case
      when v_orders_week = 0 then 0
      when v_orders_prev = 0 and v_orders_week > 0 then 30  -- just started
      when v_orders_week >= v_orders_prev then 25 + least(5, v_orders_week / 20)  -- growth
      when v_orders_week >= v_orders_prev * 0.7 then 15  -- mild decline
      else 5  -- significant decline
    end;

    -- SCORE_TEAM (max 15): team size
    select count(*) into v_team_size
    from public.restaurant_memberships
    where restaurant_id = r.id;

    v_score_team := case
      when v_team_size >= 5 then 15
      when v_team_size >= 3 then 10
      when v_team_size = 2 then 5
      else 0
    end;

    -- SCORE_TICKETS (max 20): if any pending bridge errors / no errors
    select count(*) into v_open_alerts
    from public.pending_receipts
    where restaurant_id = r.id
      and status = 'error'
      and created_at > now() - interval '7 days';

    v_score_tickets := case
      when v_open_alerts = 0 then 20
      when v_open_alerts <= 2 then 12
      when v_open_alerts <= 5 then 5
      else 0
    end;

    -- SCORE_ENGAGEMENT (max 15): uses multiple features
    -- Check: cash shifts, happy hour rules, recipes, vat config
    v_score_engage := 0;
    if exists(select 1 from public.cash_shifts where restaurant_id = r.id limit 1) then
      v_score_engage := v_score_engage + 4;
    end if;
    if exists(select 1 from public.happy_hour_rules where restaurant_id = r.id limit 1) then
      v_score_engage := v_score_engage + 4;
    end if;
    -- Recipes table may not exist on all installs; tolerate
    begin
      if exists(select 1 from public.product_recipes where restaurant_id = r.id limit 1) then
        v_score_engage := v_score_engage + 4;
      end if;
    exception when undefined_table then
      null;
    end;
    if exists(select 1 from public.bridge_devices where restaurant_id = r.id and is_active = true limit 1) then
      v_score_engage := v_score_engage + 3;
    end if;

    v_total := v_score_login + v_score_orders + v_score_team + v_score_tickets + v_score_engage;
    v_total := least(100, greatest(0, v_total));

    -- Get previous score for trend
    select score into v_previous from public.customer_health_scores where restaurant_id = r.id;

    v_trend := case
      when v_previous is null then 'stable'
      when v_total < 40 then 'critical'
      when v_total > v_previous + 5 then 'rising'
      when v_total < v_previous - 5 then 'declining'
      else 'stable'
    end;

    -- Alert: score critical AND we haven't alerted in last 24h
    v_alert := v_trend = 'critical' and (
      not exists(
        select 1 from public.customer_health_scores
        where restaurant_id = r.id
          and alerted_at > now() - interval '24 hours'
      )
    );

    -- Upsert score
    insert into public.customer_health_scores (
      restaurant_id, score, previous_score, trend,
      score_login, score_orders, score_team, score_tickets, score_engagement,
      alerted_at, computed_at, details
    ) values (
      r.id, v_total, v_previous, v_trend,
      v_score_login, v_score_orders, v_score_team, v_score_tickets, v_score_engage,
      case when v_alert then now() else null end,
      now(),
      jsonb_build_object(
        'last_login', v_last_login,
        'orders_this_week', v_orders_week,
        'orders_prev_week', v_orders_prev,
        'team_size', v_team_size,
        'open_alerts', v_open_alerts
      )
    )
    on conflict (restaurant_id) do update set
      previous_score = customer_health_scores.score,
      score = excluded.score,
      trend = excluded.trend,
      score_login = excluded.score_login,
      score_orders = excluded.score_orders,
      score_team = excluded.score_team,
      score_tickets = excluded.score_tickets,
      score_engagement = excluded.score_engagement,
      alerted_at = case
        when v_alert then now()
        else customer_health_scores.alerted_at
      end,
      computed_at = now(),
      details = excluded.details;

    -- Queue health alert email if needed
    if v_alert then
      perform public.enqueue_email(
        r.email,
        'health_score_alert'::email_template_kind,
        jsonb_build_object(
          'owner_name', coalesce(r.full_name, 'Stimate patron'),
          'restaurant_id', r.id,
          'score', v_total,
          'trend', v_trend,
          'last_login', v_last_login,
          'orders_this_week', v_orders_week
        ),
        r.owner_id,
        r.full_name,
        null,
        'health_alert:' || r.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
      );

      -- Insert lifecycle event
      insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
      values (r.owner_id, r.id, 'health_critical', jsonb_build_object(
        'score', v_total, 'trend', v_trend
      ));
    end if;

    -- Yield result
    restaurant_id := r.id;
    score := v_total;
    trend := v_trend;
    alert_needed := v_alert;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.compute_health_scores() from public;
-- Service role only.


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 4. WEEKLY REPORTS                                            ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Rapoarte săptămânale auto-generate vineri 18:00. Trimite mail patronului
-- cu KPI-uri: revenue, comenzi, top produse, vs săptămâna precedentă.

create or replace function public.compute_weekly_report(
  p_restaurant_id uuid,
  p_week_start    date default null  -- default = ultima săptămână (Luni-Duminică)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start  timestamptz;
  v_end    timestamptz;
  v_prev_start timestamptz;
  v_prev_end   timestamptz;
  v_revenue    numeric;
  v_revenue_prev numeric;
  v_orders     integer;
  v_orders_prev integer;
  v_avg_ticket numeric;
  v_top_products jsonb;
  v_busiest_hour integer;
  v_top_waiter   text;
begin
  -- Compute time bounds (Europe/Bucharest)
  if p_week_start is null then
    -- ultima săptămână Luni-Duminică
    v_start := (date_trunc('week', (now() at time zone 'Europe/Bucharest') - interval '7 days') at time zone 'Europe/Bucharest');
  else
    v_start := (p_week_start::timestamp at time zone 'Europe/Bucharest');
  end if;
  v_end       := v_start + interval '7 days';
  v_prev_start := v_start - interval '7 days';
  v_prev_end   := v_start;

  -- Revenue & orders (current week)
  select coalesce(sum(total), 0), count(*) into v_revenue, v_orders
  from public.orders
  where restaurant_id = p_restaurant_id
    and created_at >= v_start and created_at < v_end
    and status = 'paid';

  -- Previous week
  select coalesce(sum(total), 0), count(*) into v_revenue_prev, v_orders_prev
  from public.orders
  where restaurant_id = p_restaurant_id
    and created_at >= v_prev_start and created_at < v_prev_end
    and status = 'paid';

  v_avg_ticket := case when v_orders > 0 then v_revenue / v_orders else 0 end;

  -- Top 5 products by revenue
  select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) into v_top_products
  from (
    select p.name,
           sum(oi.quantity)               as units_sold,
           sum(oi.quantity * oi.unit_price) as revenue
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.products p on p.id = oi.product_id
    where o.restaurant_id = p_restaurant_id
      and o.created_at >= v_start and o.created_at < v_end
      and o.status = 'paid'
    group by p.name
    order by revenue desc
    limit 5
  ) t;

  -- Busiest hour
  select extract(hour from (created_at at time zone 'Europe/Bucharest'))::integer into v_busiest_hour
  from public.orders
  where restaurant_id = p_restaurant_id
    and created_at >= v_start and created_at < v_end
    and status = 'paid'
  group by 1
  order by count(*) desc
  limit 1;

  return jsonb_build_object(
    'restaurant_id',   p_restaurant_id,
    'period_start',    v_start,
    'period_end',      v_end,
    'revenue',         v_revenue,
    'revenue_prev',    v_revenue_prev,
    'revenue_change_pct', case
      when v_revenue_prev > 0 then round(((v_revenue - v_revenue_prev) / v_revenue_prev * 100)::numeric, 1)
      else null
    end,
    'orders',          v_orders,
    'orders_prev',     v_orders_prev,
    'avg_ticket',      round(v_avg_ticket, 2),
    'top_products',    v_top_products,
    'busiest_hour',    v_busiest_hour
  );
end;
$$;

revoke all on function public.compute_weekly_report(uuid, date) from public;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 5. LIFECYCLE TRIGGERS — automate emit pe milestones          ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Trigger: first product created → emit lifecycle event
create or replace function public.trg_lifecycle_first_product()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_owner uuid;
begin
  select count(*) into v_count
  from public.products where restaurant_id = new.restaurant_id;

  if v_count = 1 then
    select owner_id into v_owner from public.restaurants where id = new.restaurant_id;
    insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
    values (v_owner, new.restaurant_id, 'first_product_added', jsonb_build_object(
      'product_name', new.name
    ));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lifecycle_first_product on public.products;
create trigger trg_lifecycle_first_product
  after insert on public.products
  for each row execute function public.trg_lifecycle_first_product();

-- Trigger: first paid order → emit lifecycle event + milestone
create or replace function public.trg_lifecycle_first_paid_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_owner uuid;
begin
  if new.status != 'paid' or old.status = 'paid' then return new; end if;

  select count(*) into v_count
  from public.orders where restaurant_id = new.restaurant_id and status = 'paid';

  select owner_id into v_owner from public.restaurants where id = new.restaurant_id;

  if v_count = 1 then
    insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
    values (v_owner, new.restaurant_id, 'first_paid_order', jsonb_build_object('total', new.total));
  elsif v_count = 100 then
    insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
    values (v_owner, new.restaurant_id, 'milestone_100_orders', jsonb_build_object('total_orders', v_count));
  elsif v_count = 1000 then
    insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
    values (v_owner, new.restaurant_id, 'milestone_1000_orders', jsonb_build_object('total_orders', v_count));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lifecycle_first_paid_order on public.orders;
create trigger trg_lifecycle_first_paid_order
  after update of status on public.orders
  for each row execute function public.trg_lifecycle_first_paid_order();


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 6. EVENT → EMAIL DISPATCHER                                  ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Funcție apelată de Netlify cron care procesează lifecycle_events neprocesate
-- și enqueueză email-urile corespunzătoare.
create or replace function public.process_lifecycle_events(p_batch_size int default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  evt record;
  v_email text;
  v_name  text;
  v_processed int := 0;
begin
  for evt in
    select e.*
    from public.lifecycle_events e
    where e.processed_at is null
      and e.process_attempts < 3
    order by e.created_at asc
    limit p_batch_size
    for update skip locked
  loop
    begin
      -- Resolve recipient
      select email, full_name into v_email, v_name
      from public.profiles where id = evt.user_id;

      if v_email is null then
        update public.lifecycle_events
           set processed_at = now(),
               process_error = 'no_email_for_user',
               process_attempts = process_attempts + 1
         where id = evt.id;
        continue;
      end if;

      -- Dispatch by event_type → email template
      case evt.event_type
        when 'first_product_added' then
          -- skip — milestone too early for email
          null;

        when 'first_paid_order' then
          perform public.enqueue_email(
            v_email,
            'milestone_first_month'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'first_order:' || evt.restaurant_id::text
          );

        when 'milestone_100_orders' then
          perform public.enqueue_email(
            v_email, 'milestone_100_orders'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'm100:' || evt.restaurant_id::text
          );

        when 'milestone_1000_orders' then
          perform public.enqueue_email(
            v_email, 'milestone_1000_orders'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'm1000:' || evt.restaurant_id::text
          );

        when 'trial_ending_soon' then
          perform public.enqueue_email(
            v_email, 'trial_ending_3d'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'trial_end:' || evt.user_id::text
          );

        when 'payment_failed' then
          perform public.enqueue_email(
            v_email, 'payment_failed'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'pmt_fail:' || evt.user_id::text || ':' || (evt.event_data->>'attempt')
          );

        when 'subscription_started' then
          perform public.enqueue_email(
            v_email, 'welcome'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'welcome:' || evt.user_id::text
          );

        when 'health_critical' then
          -- Special: alert Radu, not user
          -- Handled by compute_health_scores directly
          null;

        else
          -- Unknown event type — mark processed
          null;
      end case;

      update public.lifecycle_events
         set processed_at = now()
       where id = evt.id;

      v_processed := v_processed + 1;
    exception when others then
      update public.lifecycle_events
         set process_attempts = process_attempts + 1,
             process_error = SQLERRM
       where id = evt.id;
    end;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_lifecycle_events(int) from public;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ DONE.                                                         ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Cron jobs to schedule (pg_cron or Netlify scheduled functions):
--   * compute-health-scores   → every 6 hours
--   * process-email-queue     → every 5 minutes
--   * process-lifecycle-events → every 2 minutes (or use Realtime trigger)
--   * weekly-report           → Friday 18:00 Bucharest
--   * cleanup-old-rate-limits → daily 03:00
-- ═══════════════════════════════════════════════════════════════
