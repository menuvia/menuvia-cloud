-- Migration 069: fix _compute_one_health_score — bridge_devices.is_active nu există
-- ─────────────────────────────────────────────────────────────────────
-- Bug: butonul "Calculează acum" din tab Sănătate aruncă
--   column "is_active" does not exist
-- Cauza: mig 040 linia 130 face
--   select from bridge_devices where is_active = true
-- DAR bridge_devices (mig 030) are doar coloana 'status' cu enum
-- ('online','offline','error'). Coloana is_active nu a existat niciodată.
--
-- Fix: înlocuiește is_active = true cu status = 'online'.
-- Rescriu toată funcția (păstrez restul logicii identic cu mig 040).

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
  select r.owner_id, p.email, p.full_name
    into v_owner_id, v_owner_email, v_owner_name
    from public.restaurants r
    join public.profiles p on p.id = r.owner_id
   where r.id = p_restaurant_id
     and r.is_active = true;

  if v_owner_id is null then
    return;
  end if;

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

  select count(*) into v_team_size
    from public.restaurant_memberships
   where restaurant_id = p_restaurant_id;

  v_score_team := case
    when v_team_size >= 5 then 15
    when v_team_size >= 3 then 10
    when v_team_size = 2 then 5
    else 0
  end;

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
  -- FIX: era is_active=true (coloană inexistentă), e status='online'
  if exists(select 1 from public.bridge_devices where restaurant_id = p_restaurant_id and status = 'online' limit 1) then
    v_score_engage := v_score_engage + 3;
  end if;

  v_total := v_score_login + v_score_orders + v_score_team + v_score_tickets + v_score_engage;
  v_total := least(100, greatest(0, v_total));

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

  score := v_total;
  trend := v_trend;
  alert_needed := v_alert;
  return next;
end;
$$;

revoke all on function public._compute_one_health_score(uuid) from public;
