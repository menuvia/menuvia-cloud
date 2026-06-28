-- mig 159 — gate fiscal Plan 3 pe view-urile de venit din analytics (P0 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (db-plan-gating). View-urile v_daily_orders / v_product_performance /
-- v_waiter_performance expun cifre de VENIT (revenue, cash_revenue, card_revenue,
-- revenue_collected, sum(item_total)). Mig 116 le-a făcut security_invoker=true (leak
-- cross-tenant închis), DAR nu există gate de plan: un membru pe Plan 1/2 putea citi
-- direct view-ul prin PostgREST și vedea venitul restaurantului propriu. Regula de aur:
-- venit/bani = Plan 3 (coerent cu report_by_* gate-uit mig 122 și vat_report mig 150).
--
-- Fix (oglindă mig 150): re-creăm fiecare view cu predicat `restaurant_has_feature(
-- restaurant_id, 'fiscal_receipt')` în WHERE, păstrând security_invoker=true + grant select
-- to authenticated. Singurul consumator e AnalyticsTab (deja minTier:3 în UI), deci niciun
-- feature Plan 2 nu e afectat.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace view public.v_daily_orders
with (security_invoker = true) as
  SELECT restaurant_id,
     date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date AS day,
     count(*) AS total_orders,
     count(*) FILTER (WHERE source = 'qr'::order_source) AS qr_orders,
     count(*) FILTER (WHERE source = 'waiter'::order_source) AS waiter_orders,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status), 0::numeric) AS revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'cash'::payment_method), 0::numeric) AS cash_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'card_pos'::payment_method), 0::numeric) AS card_revenue
    FROM orders o
   WHERE status <> 'cancelled'::order_status
     AND public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')
   GROUP BY restaurant_id, (date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date);

create or replace view public.v_product_performance
with (security_invoker = true) as
  SELECT o.restaurant_id,
     oi.product_id,
     oi.product_name_snapshot AS product_name,
     sum(oi.quantity) AS total_quantity,
     count(DISTINCT oi.order_id) AS order_appearances,
     sum(oi.item_total) AS revenue
    FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
   WHERE o.status <> 'cancelled'::order_status
     AND public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')
   GROUP BY o.restaurant_id, oi.product_id, oi.product_name_snapshot;

create or replace view public.v_waiter_performance
with (security_invoker = true) as
  SELECT restaurant_id,
     created_by AS user_id,
     count(*) FILTER (WHERE source = 'waiter'::order_source) AS orders_entered,
     count(*) FILTER (WHERE served_by = created_by AND (status = ANY (ARRAY['served'::order_status, 'paid'::order_status]))) AS orders_served,
     COALESCE(sum(paid_amount) FILTER (WHERE paid_by = created_by AND status = 'paid'::order_status), 0::numeric) AS revenue_collected
    FROM orders o
   WHERE created_by IS NOT NULL
     AND public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')
   GROUP BY restaurant_id, created_by;

grant select on public.v_daily_orders        to authenticated;
grant select on public.v_product_performance to authenticated;
grant select on public.v_waiter_performance  to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from (
    select pg_get_viewdef('public.v_daily_orders'::regclass) as d
    union all select pg_get_viewdef('public.v_product_performance'::regclass)
    union all select pg_get_viewdef('public.v_waiter_performance'::regclass)
  ) x where x.d like '%restaurant_has_feature%';
  if v_n <> 3 then
    raise exception 'mig 159: predicatul fiscal_receipt lipsește din % view-uri (așteptat 3)', 3 - v_n;
  end if;

  -- security_invoker păstrat pe toate 3
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname in ('v_daily_orders','v_product_performance','v_waiter_performance')
       and coalesce(c.reloptions::text,'') not like '%security_invoker=true%'
  ) then
    raise exception 'mig 159: un view și-a pierdut security_invoker=true';
  end if;
  raise notice 'mig 159: analytics views gate fiscal_receipt (P0) OK';
end $$;

commit;
