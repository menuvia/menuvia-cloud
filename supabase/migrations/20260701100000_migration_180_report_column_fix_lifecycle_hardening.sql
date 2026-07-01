-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 180 — Fix coloană inexistentă în rapoarte + hardening lifecycle
-- ═══════════════════════════════════════════════════════════════
-- Context (audit intern):
--   `order_items` NU are coloana `unit_price` — are `unit_price_snapshot` și
--   `item_total` (= cantitate × preț + modificatori, vezi mig. 003/012:
--   "item_total numeric(10,2) not null, -- (unit_price + modifier deltas) * quantity").
--
--   Două RPC-uri referențiau `oi.unit_price` (coloană inexistentă) în
--   sub-query-ul de top produse → aruncau eroare la FIECARE apel, de la
--   introducere. Eroarea era înghițită silențios de automation-cron.js
--   (console.warn + continue) → 0 rapoarte trimise vreodată:
--     • compute_daily_report  (mig. 063, linia ~75)
--     • compute_weekly_report (mig. 039, linia ~469)
--
--   Nu edităm migrațiile aplicate 039/063 (regulă nenegociabilă #2) —
--   recreăm funcțiile aici cu `create or replace function`, identice cu
--   originalul, SINGURA schimbare fiind `sum(oi.quantity * oi.unit_price)`
--   → `sum(oi.item_total)` (item_total include deja quantity × preț +
--   modificatori — NU se mai înmulțește cu quantity).
--
--   Plus 3 fix-uri de hardening pe `process_lifecycle_events` (mig. 039):
--     1. Event-ul `subscription_cancelled` (emis de stripe-webhook.js la
--        fiecare downgrade la free / customer.subscription.deleted) nu avea
--        ramură în case statement → cădea în `else -> null`, marcat
--        processed fără email/alertă. Acum are ramură dedicată.
--     2. Ramura `else` (event_type necunoscut) nu scria `process_error` —
--        dispărea tăcut. Acum setează `process_error = 'unknown_event_type: ...'`.
--     3. Blocul `exception when others` incrementa `process_attempts` dar
--        la a 3-a eroare nu seta `processed_at` → rândul rămânea zombie
--        etern (bucla filtrează pe `process_attempts < 3`, deci rândul nu
--        mai era niciodată reluat, dar nici nu apărea ca "terminal" — invizibil
--        în audit). Acum, la a 3-a eroare (process_attempts + 1 >= 3), se
--        setează și `processed_at = now()`, păstrând `process_error = SQLERRM`
--        pentru vizibilitate în audit.
--
--   Notă enum: 'subscription_cancelled' există DEJA în email_template_kind
--   (mig. 039, linia ~69) — nu e nevoie de `alter type ... add value`.
--
-- Pattern: create or replace function, idempotent, grants identice cu
-- originalul (SECURITY DEFINER, search_path = public, pg_temp, revoke all
-- from public — service role only).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. compute_daily_report — fix coloană inexistentă ──────────
-- Identică cu mig. 063, singura schimbare: linia din sub-query-ul de
-- top produse (oi.unit_price → oi.item_total, fără re-înmulțire cu quantity).

create or replace function public.compute_daily_report(
  p_restaurant_id uuid,
  p_day           date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day          date;
  v_start        timestamptz;
  v_end          timestamptz;
  v_prev_start   timestamptz;
  v_prev_end     timestamptz;
  v_revenue      numeric;
  v_revenue_prev numeric;
  v_orders       integer;
  v_orders_prev  integer;
  v_avg_ticket   numeric;
  v_top_products jsonb;
  v_busiest_hour integer;
begin
  if p_day is null then
    v_day := ((now() at time zone 'Europe/Bucharest')::date) - 1;
  else
    v_day := p_day;
  end if;

  v_start      := (v_day::timestamp at time zone 'Europe/Bucharest');
  v_end        := v_start + interval '1 day';
  v_prev_start := v_start - interval '1 day';
  v_prev_end   := v_start;

  -- Revenue & orders (ziua țintă)
  select coalesce(sum(total), 0), count(*) into v_revenue, v_orders
  from public.orders
  where restaurant_id = p_restaurant_id
    and created_at >= v_start and created_at < v_end
    and status = 'paid';

  -- Ziua precedentă
  select coalesce(sum(total), 0), count(*) into v_revenue_prev, v_orders_prev
  from public.orders
  where restaurant_id = p_restaurant_id
    and created_at >= v_prev_start and created_at < v_prev_end
    and status = 'paid';

  v_avg_ticket := case when v_orders > 0 then v_revenue / v_orders else 0 end;

  -- Top 3 produse (mai puțin decât weekly pentru email mai scurt)
  -- FIX: item_total include deja quantity × preț + modificatori — NU se
  -- mai înmulțește cu quantity (oi.unit_price nu există în order_items).
  select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) into v_top_products
  from (
    select p.name,
           sum(oi.quantity)   as units_sold,
           sum(oi.item_total) as revenue
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.products p on p.id = oi.product_id
    where o.restaurant_id = p_restaurant_id
      and o.created_at >= v_start and o.created_at < v_end
      and o.status = 'paid'
    group by p.name
    order by revenue desc
    limit 3
  ) t;

  -- Ora de vârf
  select extract(hour from (created_at at time zone 'Europe/Bucharest'))::integer
    into v_busiest_hour
  from public.orders
  where restaurant_id = p_restaurant_id
    and created_at >= v_start and created_at < v_end
    and status = 'paid'
  group by 1
  order by count(*) desc
  limit 1;

  return jsonb_build_object(
    'restaurant_id',   p_restaurant_id,
    'day',             v_day,
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

revoke all on function public.compute_daily_report(uuid, date) from public;


-- ── 2. compute_weekly_report — fix coloană inexistentă ──────────
-- Identică cu mig. 039, singura schimbare: linia din sub-query-ul de
-- top produse (oi.unit_price → oi.item_total, fără re-înmulțire cu quantity).

create or replace function public.compute_weekly_report(
  p_restaurant_id uuid,
  p_week_start    date default null  -- default = ultima săptămână (Luni-Duminică)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  -- FIX: item_total include deja quantity × preț + modificatori — NU se
  -- mai înmulțește cu quantity (oi.unit_price nu există în order_items).
  select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) into v_top_products
  from (
    select p.name,
           sum(oi.quantity)   as units_sold,
           sum(oi.item_total) as revenue
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


-- ── 3. process_lifecycle_events — hardening ─────────────────────
-- Identică cu mig. 039, cu 3 modificări minime:
--   (a) ramură nouă `subscription_cancelled` → enqueue_email
--   (b) ramura `else` scrie process_error în loc de a marca tăcut "procesat"
--   (c) exception block: la a 3-a eroare, setează și processed_at (terminal
--       vizibil în audit prin process_error, nu mai e zombie etern)

create or replace function public.process_lifecycle_events(p_batch_size int default 50)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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

        when 'subscription_cancelled' then
          -- FIX: emis de stripe-webhook.js la customer.subscription.deleted
          -- (downgrade la free) — nu mai cade tăcut în else.
          perform public.enqueue_email(
            v_email, 'subscription_cancelled'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'lifecycle:subscription_cancelled:' || evt.id::text
          );

        when 'health_critical' then
          -- Special: alert Radu, not user
          -- Handled by compute_health_scores directly
          null;

        else
          -- FIX: event_type necunoscut — nu mai marcăm "procesat" tăcut,
          -- scriem process_error ca să fie vizibil în audit.
          update public.lifecycle_events
             set process_error = 'unknown_event_type: ' || evt.event_type
           where id = evt.id;
      end case;

      update public.lifecycle_events
         set processed_at = now()
       where id = evt.id;

      v_processed := v_processed + 1;
    exception when others then
      -- FIX: la a 3-a eroare (process_attempts + 1 >= 3), setăm și
      -- processed_at = now() ca rândul să nu mai rămână zombie etern —
      -- rămâne vizibil în audit prin process_error = SQLERRM.
      update public.lifecycle_events
         set process_attempts = process_attempts + 1,
             process_error = SQLERRM,
             processed_at = case
               when process_attempts + 1 >= 3 then now()
               else processed_at
             end
       where id = evt.id;
    end;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_lifecycle_events(int) from public;

-- ═══════════════════════════════════════════════════════════════
-- DONE. Nicio schimbare de schemă/enum — doar create or replace pe 3
-- funcții existente. 'subscription_cancelled' era deja în enum
-- email_template_kind (mig. 039), deci nu e nevoie de alter type.
-- ═══════════════════════════════════════════════════════════════
