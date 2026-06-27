-- mig 122 — Fix P0 (regula de aur): rapoartele cu VENIT gate-uite pe Plan 3 (F2)
--
-- Găsit la auditul profund (CH9 F2). RPC-urile report_by_waiter/hour/category
-- (mig 033) întorceau coloane de VENIT (total_revenue, avg_ticket, discount_total)
-- cu DOAR `is_member` ca gate — fără gate de plan. ReportsTab ascunde banii pentru
-- Plan 2 DOAR în UI (display:none pe `fiscalReports = tier>=3`), dar un membru
-- growth (Plan 2) poate apela RPC-ul direct (sau citi payload-ul din rețea) și
-- obține venitul. Designul e explicit „Plan 2 = FĂRĂ revenue" (ARCHITECTURE.md,
-- features.ts, comentariul ReportsTab) + regula de aur „bani = Plan 3" — deci e
-- un gate-leak care trebuie închis SERVER-SIDE.
--
-- FIX: helper boolean `restaurant_has_feature` + re-creăm cele 3 RPC-uri (semnături
-- IDENTICE) care ZERO-uiesc coloanele de SUMĂ când restaurantul nu are
-- 'fiscal_receipt' (non-Plan-3). Coloanele operaționale (order_count, item_count,
-- nume, oră, distribuție %) rămân neschimbate. Impact UI = ZERO (Plan 2 oricum
-- ascundea banii; Plan 3 primește sumele reale).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── Helper boolean (oglindă a enforce_feature_for_restaurant, dar returnează bool) ──
create or replace function public.restaurant_has_feature(
  p_restaurant_id uuid,
  p_feature       text
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select pf.enabled
    from public.restaurants r
    join public.profiles pr on pr.id = r.owner_id
    left join public.plan_features pf on pf.plan = pr.plan and pf.feature = p_feature
    where r.id = p_restaurant_id
  ), false);
$$;
revoke all on function public.restaurant_has_feature(uuid, text) from public, anon;
grant execute on function public.restaurant_has_feature(uuid, text) to authenticated;

-- ── 1) report_by_waiter (zero venit/avg/discount pe non-Plan-3) ──────────────
create or replace function public.report_by_waiter(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
) returns table (
  waiter_id uuid, waiter_name text, order_count bigint,
  total_revenue numeric, avg_ticket numeric, discount_total numeric
) language plpgsql security definer set search_path = public
as $$
declare v_money boolean;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;
  v_money := public.restaurant_has_feature(p_restaurant_id, 'fiscal_receipt');

  return query
    with attributed as (
      select coalesce(o.served_by, o.paid_by, o.created_by) as wid,
             o.total, coalesce(o.discount_amount, 0) as disc
      from public.orders o
      where o.restaurant_id = p_restaurant_id and o.status != 'cancelled'
        and o.created_at >= p_from and o.created_at <= p_to
    )
    select
      a.wid as waiter_id,
      coalesce(p.full_name, case when a.wid is null then 'Comenzi QR (fără ospătar)' else 'Necunoscut' end) as waiter_name,
      count(*)::bigint as order_count,
      (case when v_money then coalesce(sum(a.total), 0) else 0 end)::numeric as total_revenue,
      (case when v_money and count(*) > 0 then round(coalesce(sum(a.total), 0) / count(*), 2) else 0 end)::numeric as avg_ticket,
      (case when v_money then coalesce(sum(a.disc), 0) else 0 end)::numeric as discount_total
    from attributed a
    left join public.profiles p on p.id = a.wid
    group by a.wid, p.full_name
    order by sum(a.total) desc nulls last;
end;
$$;
revoke all on function public.report_by_waiter(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_by_waiter(uuid, timestamptz, timestamptz) to authenticated;

-- ── 2) report_by_hour (zero venit pe non-Plan-3) ─────────────────────────────
create or replace function public.report_by_hour(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
) returns table (hour smallint, order_count bigint, total_revenue numeric)
language plpgsql security definer set search_path = public
as $$
declare v_money boolean;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;
  v_money := public.restaurant_has_feature(p_restaurant_id, 'fiscal_receipt');

  return query
    with hours as (select generate_series(0, 23)::smallint as h),
    bucketed as (
      select extract(hour from o.created_at at time zone 'Europe/Bucharest')::smallint as h, o.total
      from public.orders o
      where o.restaurant_id = p_restaurant_id and o.status != 'cancelled'
        and o.created_at >= p_from and o.created_at <= p_to
    )
    select
      hr.h as hour,
      coalesce(count(b.h), 0)::bigint as order_count,
      (case when v_money then coalesce(sum(b.total), 0) else 0 end)::numeric as total_revenue
    from hours hr
    left join bucketed b on b.h = hr.h
    group by hr.h
    order by hr.h;
end;
$$;
revoke all on function public.report_by_hour(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_by_hour(uuid, timestamptz, timestamptz) to authenticated;

-- ── 3) report_by_category (zero venit pe non-Plan-3; distribuția % rămâne) ────
create or replace function public.report_by_category(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
) returns table (
  category_id uuid, category_name text, category_emoji text,
  item_count bigint, total_revenue numeric, percent_total numeric
) language plpgsql security definer set search_path = public
as $$
declare v_total numeric; v_money boolean;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;
  v_money := public.restaurant_has_feature(p_restaurant_id, 'fiscal_receipt');

  with src as (
    select pr.category_id, oi.quantity::numeric as qty, oi.item_total
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.products pr on pr.id = oi.product_id
    where o.restaurant_id = p_restaurant_id and o.status != 'cancelled'
      and o.created_at >= p_from and o.created_at <= p_to
  )
  select coalesce(sum(item_total), 0) into v_total from src;

  return query
    with src as (
      select pr.category_id, oi.quantity::numeric as qty, oi.item_total
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join public.products pr on pr.id = oi.product_id
      where o.restaurant_id = p_restaurant_id and o.status != 'cancelled'
        and o.created_at >= p_from and o.created_at <= p_to
    )
    select
      s.category_id,
      coalesce(c.name, 'Fără categorie') as category_name,
      c.emoji as category_emoji,
      sum(s.qty)::bigint as item_count,
      (case when v_money then sum(s.item_total) else 0 end)::numeric as total_revenue,
      case when v_total > 0 then round(100 * sum(s.item_total) / v_total, 1) else 0::numeric end as percent_total
    from src s
    left join public.categories c on c.id = s.category_id
    group by s.category_id, c.name, c.emoji
    order by sum(s.item_total) desc nulls last;
end;
$$;
revoke all on function public.report_by_category(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_by_category(uuid, timestamptz, timestamptz) to authenticated;

do $$ begin raise notice 'mig 122: rapoarte cu venit gate-uite pe Plan 3 OK'; end $$;

commit;
