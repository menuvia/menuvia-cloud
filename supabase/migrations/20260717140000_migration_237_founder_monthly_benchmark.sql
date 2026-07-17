-- mig 237 — benchmark v1: raport lunar per client în founder dashboard
-- ─────────────────────────────────────────────────────────────────────
-- Săptămâna 9 din PLAN_10_SAPTAMANI (E5): „localul tău vs. media" — founderul
-- vede, pe o lună dată, fiecare restaurant vs. media/mediana platformei, ca să
-- poată trimite clienților un raport de valoare (v1 = în dashboard; email
-- digest = v2).
--
--   • `admin_monthly_benchmark(p_month date default null)` — founder-only.
--     Interoghează DIRECT `orders` (SECURITY DEFINER), NU v_daily_orders:
--     view-ul are gate-ul fiscal în WHERE (mig 159→232) și ar ascunde complet
--     restaurantele free/starter/growth — benchmark-ul de COMENZI acoperă
--     toate planurile.
--   • Regula de aur rămâne intactă la afișare: câmpurile de BANI (revenue,
--     avg_ticket) sunt NULL pentru restaurantele fără feature-ul
--     `fiscal_receipt` — venitul se compară doar între cei care îl au
--     (mediile de venit se calculează doar pe acele restaurante).
--   • Luna = luna calendaristică în Europe/Bucharest (comenzile după
--     created_at; venitul după paid_at, consecvent cu ReportsTab).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.admin_monthly_benchmark(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_start date;
  v_start_ts    timestamptz;
  v_end_ts      timestamptz;
  v_rows        jsonb;
  v_platform    jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  v_month_start := date_trunc('month',
    coalesce(p_month, (now() at time zone 'Europe/Bucharest')::date))::date;
  v_start_ts := v_month_start::timestamp at time zone 'Europe/Bucharest';
  v_end_ts   := (v_month_start + interval '1 month')::timestamp at time zone 'Europe/Bucharest';

  with per_restaurant as (
    select
      r.id,
      r.name,
      r.slug,
      pr.plan,
      public.restaurant_has_feature(r.id, 'fiscal_receipt') as has_fiscal,
      (select count(*) from public.orders o
        where o.restaurant_id = r.id
          and o.status <> 'cancelled'
          and o.created_at >= v_start_ts and o.created_at < v_end_ts) as orders_cnt,
      (select count(*) from public.orders o
        where o.restaurant_id = r.id
          and o.status <> 'cancelled'
          and o.source = 'qr'
          and o.created_at >= v_start_ts and o.created_at < v_end_ts) as qr_cnt,
      (select coalesce(sum(o.paid_amount), 0) from public.orders o
        where o.restaurant_id = r.id
          and o.status = 'paid'
          and o.paid_at >= v_start_ts and o.paid_at < v_end_ts) as revenue,
      (select count(*) from public.orders o
        where o.restaurant_id = r.id
          and o.status = 'paid'
          and o.paid_at >= v_start_ts and o.paid_at < v_end_ts) as paid_cnt
    from public.restaurants r
    join public.profiles pr on pr.id = r.owner_id
    where r.is_active = true
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'restaurant_id', pr2.id,
      'name',          pr2.name,
      'slug',          pr2.slug,
      'plan',          pr2.plan,
      'orders',        pr2.orders_cnt,
      'qr_share_pct',  case when pr2.orders_cnt > 0
                            then round(pr2.qr_cnt::numeric * 100 / pr2.orders_cnt)
                            else null end,
      -- Banii DOAR pe planurile cu fiscal_receipt (regula de aur).
      'revenue',       case when pr2.has_fiscal then pr2.revenue else null end,
      'avg_ticket',    case when pr2.has_fiscal and pr2.paid_cnt > 0
                            then round(pr2.revenue / pr2.paid_cnt, 2)
                            else null end
    ) order by pr2.orders_cnt desc, pr2.name), '[]'::jsonb),
    jsonb_build_object(
      'restaurants',          count(*),
      'restaurants_with_orders', count(*) filter (where pr2.orders_cnt > 0),
      'avg_orders',           round(coalesce(avg(pr2.orders_cnt), 0), 1),
      'median_orders',        coalesce(percentile_cont(0.5)
                                within group (order by pr2.orders_cnt), 0),
      'avg_qr_share_pct',     round(coalesce(avg(
                                case when pr2.orders_cnt > 0
                                     then pr2.qr_cnt::numeric * 100 / pr2.orders_cnt
                                end), 0)),
      -- Mediile de venit se calculează DOAR pe restaurantele cu fiscal.
      'avg_revenue_fiscal',   round(coalesce(avg(pr2.revenue)
                                filter (where pr2.has_fiscal), 0), 2),
      'median_revenue_fiscal', coalesce(percentile_cont(0.5)
                                within group (order by pr2.revenue)
                                filter (where pr2.has_fiscal), 0)
    )
  into v_rows, v_platform
  from per_restaurant pr2;

  return jsonb_build_object(
    'month',    to_char(v_month_start, 'YYYY-MM'),
    'platform', v_platform,
    'rows',     v_rows
  );
end;
$$;

revoke all on function public.admin_monthly_benchmark(date) from public;
revoke all on function public.admin_monthly_benchmark(date) from anon, service_role;
grant execute on function public.admin_monthly_benchmark(date) to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.admin_monthly_benchmark(date)'::regprocedure);
  if v_def not ilike '%is_platform_admin%' then
    raise exception 'mig 237: admin_monthly_benchmark fără gate founder';
  end if;
  -- Regula de aur: banii sunt condiționați de fiscal_receipt în corp.
  if v_def not ilike '%fiscal_receipt%' or v_def not ilike '%has_fiscal%' then
    raise exception 'mig 237: benchmark-ul nu condiționează banii de fiscal_receipt';
  end if;
  if has_function_privilege('anon', 'public.admin_monthly_benchmark(date)', 'execute') then
    raise exception 'mig 237: admin_monthly_benchmark accesibil anon';
  end if;
  raise notice 'mig 237: benchmark lunar founder OK';
end $$;

commit;
