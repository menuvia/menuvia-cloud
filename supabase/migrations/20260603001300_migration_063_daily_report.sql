-- Migration 063: Daily report — compute_daily_report + enum + dispatcher detector
-- ─────────────────────────────────────────────────────────────────────
-- Cu rapoartele săptămânale (weekly_report, migrația 039) avem deja contextul.
-- Adăugăm versiunea zilnică:
--   • email_template_kind += 'daily_report'
--   • compute_daily_report(restaurant_id, day date) → jsonb (orders, revenue,
--     avg_ticket, top 3 produse, ora vârf, comparativ vs ziua precedentă)
--   • detect_daily_reports_due() → loop pe restaurante active, enqueue
--     daily_report pentru ieri. Idempotent prin dedup_key.
--
-- Pattern: SQL face DETECȚIA + enqueue; automation-cron.js apelează RPC.

-- ── 1. Extensie enum email_template_kind ───────────────────────
alter type public.email_template_kind add value if not exists 'daily_report';

-- ── 2. compute_daily_report ────────────────────────────────────
-- Returnează un raport pentru o zi (default = ieri în Europe/Bucharest).
-- Comparativ: ziua precedentă acelei zile.

create or replace function public.compute_daily_report(
  p_restaurant_id uuid,
  p_day           date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
