-- mig 116 — Fix securitate P0: cele 4 view-uri de analitică pierd security_invoker
--
-- Găsit la auditul profund (CH9). mig 008 crease v_daily_orders,
-- v_product_performance, v_waiter_performance, v_hourly_distribution CU
-- security_invoker=true (comentariul 008 descrie exact exploit-ul). mig 022
-- (bugfixes) le-a re-creat cu `create view` simplu — FĂRĂ security_invoker — și
-- un comentariu fals „Views moștenesc permisiunile prin RLS". Efect: aceste 4
-- view-uri rulează cu privilegiile owner-ului (BYPASSRLS) → orice user
-- autentificat citește venitul/comenzile/performanța ospătarilor/produselor ALE
-- ORICĂRUI restaurant prin PostgREST (filtrul .eq('restaurant_id') din UI e
-- trivial de ocolit). Leak cross-tenant de venit = P0.
--
-- mig 112 (acest PR) a reparat aceeași clasă pe product_profitability/
-- ingredients_low_stock, dar a RATAT aceste 4. Le închidem aici.
--
-- FIX: re-creează toate 4 cu security_invoker=true, păstrând EXACT definițiile
-- curente din mig 022 (NU cele din mig 008, care aveau coloane diferite).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace view public.v_daily_orders with (security_invoker = true) as
select
  o.restaurant_id,
  date_trunc('day', o.created_at at time zone 'Europe/Bucharest')::date as day,
  count(*)                                                      as total_orders,
  count(*) filter (where o.source = 'qr')                       as qr_orders,
  count(*) filter (where o.source = 'waiter')                   as waiter_orders,
  coalesce(sum(o.paid_amount) filter (where o.status = 'paid'), 0) as revenue,
  coalesce(sum(o.paid_amount) filter (where o.status = 'paid' and o.payment_method = 'cash'),    0) as cash_revenue,
  coalesce(sum(o.paid_amount) filter (where o.status = 'paid' and o.payment_method = 'card_pos'),0) as card_revenue
from public.orders o
where o.status != 'cancelled'
group by o.restaurant_id, date_trunc('day', o.created_at at time zone 'Europe/Bucharest')::date;

create or replace view public.v_product_performance with (security_invoker = true) as
select
  o.restaurant_id,
  oi.product_id,
  oi.product_name_snapshot                             as product_name,
  sum(oi.quantity)                                     as total_quantity,
  count(distinct oi.order_id)                          as order_appearances,
  sum(oi.item_total)                                   as revenue
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status != 'cancelled'
group by o.restaurant_id, oi.product_id, oi.product_name_snapshot;

create or replace view public.v_waiter_performance with (security_invoker = true) as
select
  o.restaurant_id,
  o.created_by                                                  as user_id,
  count(*) filter (where o.source = 'waiter')                   as orders_entered,
  count(*) filter (where o.served_by = o.created_by
                   and o.status in ('served','paid'))           as orders_served,
  coalesce(sum(o.paid_amount) filter (where o.paid_by = o.created_by
                                        and o.status = 'paid'), 0) as revenue_collected
from public.orders o
where o.created_by is not null
group by o.restaurant_id, o.created_by;

create or replace view public.v_hourly_distribution with (security_invoker = true) as
select
  o.restaurant_id,
  extract(hour from o.created_at at time zone 'Europe/Bucharest')::int as hour,
  count(*)                                                              as order_count
from public.orders o
where o.status != 'cancelled'
  and o.created_at > now() - interval '30 days'
group by o.restaurant_id, extract(hour from o.created_at at time zone 'Europe/Bucharest')::int;

-- ── Asserție: toate 4 au security_invoker ────────────────────────────────────
do $$
declare v_name text; v_ok boolean;
begin
  foreach v_name in array array['v_daily_orders','v_product_performance','v_waiter_performance','v_hourly_distribution'] loop
    select 'security_invoker=true' = any(c.reloptions) into v_ok
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname=v_name;
    if not coalesce(v_ok,false) then
      raise exception 'mig 116: % nu are security_invoker', v_name;
    end if;
  end loop;
  raise notice 'mig 116: cele 4 view-uri de analitică au security_invoker OK';
end $$;

commit;
