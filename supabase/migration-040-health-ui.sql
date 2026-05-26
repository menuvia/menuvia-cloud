-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 040 — Customer Health Score UI helpers
-- ═══════════════════════════════════════════════════════════════
-- Extrage compute logic per-restaurant pentru a fi apelată din UI
-- la cerere (buton "Recalculează acum"), nu doar din cron.
--
-- DESIGN: extragem inner block-ul din compute_health_scores() loop
-- într-un helper `_compute_one_health_score(restaurant_id)` care e folosit
-- atât de `compute_health_scores()` (rescris) cât și de noul
-- `recompute_health_for_restaurant(restaurant_id)` apelabil din UI.

-- ─────────────────────────────────────────────────────────────────
-- Helper privat: calculează scor pentru un singur restaurant
-- ─────────────────────────────────────────────────────────────────
create or replace function public._compute_one_health_score(p_restaurant_id uuid)
returns table (
  score        integer,
  trend        text,
  alert_needed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id       uuid;
  v_owner_email    text;
  v_owner_name     text;
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
  -- Get owner info
  select r.owner_id, p.email, p.full_name
    into v_owner_id, v_owner_email, v_owner_name
    from public.restaurants r
    join public.profiles p on p.id = r.owner_id
   where r.id = p_restaurant_id
     and r.is_active = true;

  if v_owner_id is null then
    return; -- restaurant inactive or doesn't exist
  end if;

  -- SCORE_LOGIN
  select last_sign_in_at into v_last_login
    from auth.users where id = v_owner_id;

  v_score_login := case
    when v_last_login is null then 0
    when v_last_login > now() - interval '1 day'  then 20
    when v_last_login > now() - interval '3 days' then 15
    when v_last_login > now() - interval '7 days' then 8
    when v_last_login > now() - interval '14 days' then 3
    else 0
  end;

  -- SCORE_ORDERS
  select count(*) into v_orders_week
    from public.orders
   where restaurant_id = p_restaurant_id
     and created_at > now() - interval '7 days'
     and status not in ('cancelled');

  select count(*) into v_orders_prev
    from public.orders
   where restaurant_id = p_restaurant_id
     and created_at between now() - interval '14 days' and now() - interval '7 days'
     and status not in ('cancelled');

  v_score_orders := case
    when v_orders_week = 0 then 0
    when v_orders_prev = 0 and v_orders_week > 0 then 30
    when v_orders_week >= v_orders_prev then 25 + least(5, v_orders_week / 20)
    when v_orders_week >= v_orders_prev * 0.7 then 15
    else 5
  end;

  -- SCORE_TEAM
  select count(*) into v_team_size
    from public.restaurant_memberships
   where restaurant_id = p_restaurant_id;

  v_score_team := case
    when v_team_size >= 5 then 15
    when v_team_size >= 3 then 10
    when v_team_size = 2 then 5
    else 0
  end;

  -- SCORE_TICKETS
  select count(*) into v_open_alerts
    from public.pending_receipts
   where restaurant_id = p_restaurant_id
     and status = 'error'
     and created_at > now() - interval '7 days';

  v_score_tickets := case
    when v_open_alerts = 0 then 20
    when v_open_alerts <= 2 then 12
    when v_open_alerts <= 5 then 5
    else 0
  end;

  -- SCORE_ENGAGEMENT
  v_score_engage := 0;
  if exists(select 1 from public.cash_shifts where restaurant_id = p_restaurant_id limit 1) then
    v_score_engage := v_score_engage + 4;
  end if;
  if exists(select 1 from public.happy_hour_rules where restaurant_id = p_restaurant_id limit 1) then
    v_score_engage := v_score_engage + 4;
  end if;
  begin
    if exists(select 1 from public.product_recipes where restaurant_id = p_restaurant_id limit 1) then
      v_score_engage := v_score_engage + 4;
    end if;
  exception when undefined_table then null;
  end;
  if exists(select 1 from public.bridge_devices where restaurant_id = p_restaurant_id and is_active = true limit 1) then
    v_score_engage := v_score_engage + 3;
  end if;

  v_total := v_score_login + v_score_orders + v_score_team + v_score_tickets + v_score_engage;
  v_total := least(100, greatest(0, v_total));

  -- Previous score for trend
  select customer_health_scores.score into v_previous
    from public.customer_health_scores
   where restaurant_id = p_restaurant_id;

  v_trend := case
    when v_previous is null then 'stable'
    when v_total < 40 then 'critical'
    when v_total > v_previous + 5 then 'rising'
    when v_total < v_previous - 5 then 'declining'
    else 'stable'
  end;

  v_alert := v_trend = 'critical' and (
    not exists(
      select 1 from public.customer_health_scores
       where customer_health_scores.restaurant_id = p_restaurant_id
         and alerted_at > now() - interval '24 hours'
    )
  );

  -- Upsert
  insert into public.customer_health_scores (
    restaurant_id, score, previous_score, trend,
    score_login, score_orders, score_team, score_tickets, score_engagement,
    alerted_at, computed_at, details
  ) values (
    p_restaurant_id, v_total, v_previous, v_trend,
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
    alerted_at = case when v_alert then now() else customer_health_scores.alerted_at end,
    computed_at = now(),
    details = excluded.details;

  -- Yield
  score := v_total;
  trend := v_trend;
  alert_needed := v_alert;
  return next;
end;
$$;

revoke all on function public._compute_one_health_score(uuid) from public;


-- ─────────────────────────────────────────────────────────────────
-- Public RPC: admin recalculează scoul propriu (cu cooldown anti-spam)
-- ─────────────────────────────────────────────────────────────────
create or replace function public.recompute_health_for_restaurant(p_restaurant_id uuid)
returns table (
  score        integer,
  trend        text,
  alert_needed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_computed timestamptz;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can recompute health score';
  end if;

  -- Anti-spam: max 1 recalculare la 5 min per restaurant
  select computed_at into v_last_computed
    from public.customer_health_scores
   where customer_health_scores.restaurant_id = p_restaurant_id;

  if v_last_computed is not null and v_last_computed > now() - interval '5 minutes' then
    raise exception 'Scor recalculat recent. Reîncearcă peste % minute.',
      ceil(extract(epoch from (v_last_computed + interval '5 minutes' - now())) / 60)::integer
      using errcode = 'P0001', hint = 'cooldown';
  end if;

  return query select * from public._compute_one_health_score(p_restaurant_id);
end;
$$;

revoke all on function public.recompute_health_for_restaurant(uuid) from public;
grant execute on function public.recompute_health_for_restaurant(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────
-- Public RPC: admin citește propriul scor cu breakdown complet
-- ─────────────────────────────────────────────────────────────────
create or replace function public.get_health_score(p_restaurant_id uuid)
returns table (
  score             integer,
  previous_score    integer,
  trend             text,
  score_login       integer,
  score_orders      integer,
  score_team        integer,
  score_tickets     integer,
  score_engagement  integer,
  computed_at       timestamptz,
  details           jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    h.score, h.previous_score, h.trend,
    h.score_login, h.score_orders, h.score_team, h.score_tickets, h.score_engagement,
    h.computed_at, h.details
  from public.customer_health_scores h
  where h.restaurant_id = p_restaurant_id
    and public.is_admin(p_restaurant_id);
$$;

revoke all on function public.get_health_score(uuid) from public;
grant execute on function public.get_health_score(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────
-- Refactor: compute_health_scores acum folosește helper-ul privat
-- ─────────────────────────────────────────────────────────────────
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
  result record;
begin
  for r in
    select rest.id, rest.owner_id, p.email, p.full_name
      from public.restaurants rest
      join public.profiles p on p.id = rest.owner_id
     where rest.is_active = true
  loop
    select * into result from public._compute_one_health_score(r.id);

    if result.alert_needed then
      -- Queue health alert email
      perform public.enqueue_email(
        r.email,
        'health_score_alert'::email_template_kind,
        jsonb_build_object(
          'owner_name', coalesce(r.full_name, 'Stimate patron'),
          'restaurant_id', r.id,
          'score', result.score,
          'trend', result.trend
        ),
        r.owner_id,
        r.full_name,
        null,
        'health_alert:' || r.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
      );

      insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
      values (r.owner_id, r.id, 'health_critical', jsonb_build_object(
        'score', result.score, 'trend', result.trend
      ));
    end if;

    restaurant_id := r.id;
    score := result.score;
    trend := result.trend;
    alert_needed := result.alert_needed;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.compute_health_scores() from public;
