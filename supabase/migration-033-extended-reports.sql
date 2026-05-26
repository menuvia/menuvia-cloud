-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 033 — Rapoarte extinse: ospătar, oră, categorie
-- ═══════════════════════════════════════════════════════════════
-- Adaugă 3 RPC-uri server-side pentru rapoarte care erau lipsă în UI:
--   1. report_by_waiter(restaurant, from, to) — vânzări per ospătar
--   2. report_by_hour(restaurant, from, to)   — heatmap pe oră (0-23)
--   3. report_by_category(restaurant, from, to) — vânzări per categorie
--
-- Toate folosesc orders.total (post-discount, conform migration 031).
-- Filtrare: status != 'cancelled'. Range timestamp inclus la ambele capete.

-- ═══════════════════════════════════════════════════════════════
-- 1) report_by_waiter
-- ═══════════════════════════════════════════════════════════════
-- Cine vinde cât. Folosim COALESCE(served_by, paid_by, created_by) ca să
-- atribuim comanda angajatului care a "atins-o" ultima. Pentru comenzi QR
-- (fără ospătar), waiter_id va fi NULL → grupate ca "Comenzi QR".
create or replace function public.report_by_waiter(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  waiter_id      uuid,
  waiter_name    text,
  order_count    bigint,
  total_revenue  numeric,
  avg_ticket     numeric,
  discount_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;

  return query
    with attributed as (
      select
        coalesce(o.served_by, o.paid_by, o.created_by) as wid,
        o.total,
        coalesce(o.discount_amount, 0) as disc
      from public.orders o
      where o.restaurant_id = p_restaurant_id
        and o.status != 'cancelled'
        and o.created_at >= p_from
        and o.created_at <= p_to
    )
    select
      a.wid as waiter_id,
      coalesce(p.full_name, case when a.wid is null then 'Comenzi QR (fără ospătar)' else 'Necunoscut' end) as waiter_name,
      count(*)::bigint as order_count,
      coalesce(sum(a.total), 0)::numeric as total_revenue,
      case when count(*) > 0 then round(coalesce(sum(a.total), 0) / count(*), 2) else 0::numeric end as avg_ticket,
      coalesce(sum(a.disc), 0)::numeric as discount_total
    from attributed a
    left join public.profiles p on p.id = a.wid
    group by a.wid, p.full_name
    order by sum(a.total) desc nulls last;
end;
$$;

revoke all on function public.report_by_waiter(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_by_waiter(uuid, timestamptz, timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2) report_by_hour
-- ═══════════════════════════════════════════════════════════════
-- Heatmap când vinde localul. Returnează 0-23 chiar dacă unele ore nu
-- au comenzi (UI-ul vrea bar chart cu toate orele).
create or replace function public.report_by_hour(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  hour          smallint,
  order_count   bigint,
  total_revenue numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;

  return query
    with hours as (
      select generate_series(0, 23)::smallint as h
    ),
    bucketed as (
      select
        extract(hour from o.created_at at time zone 'Europe/Bucharest')::smallint as h,
        o.total
      from public.orders o
      where o.restaurant_id = p_restaurant_id
        and o.status != 'cancelled'
        and o.created_at >= p_from
        and o.created_at <= p_to
    )
    select
      hr.h as hour,
      coalesce(count(b.h), 0)::bigint as order_count,
      coalesce(sum(b.total), 0)::numeric as total_revenue
    from hours hr
    left join bucketed b on b.h = hr.h
    group by hr.h
    order by hr.h;
end;
$$;

revoke all on function public.report_by_hour(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_by_hour(uuid, timestamptz, timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3) report_by_category
-- ═══════════════════════════════════════════════════════════════
-- Vânzări per categorie de produse. Folosim item_total din order_items
-- (deci include modifier deltas). NU scade discount proporțional pe
-- categorie — vezi limitarea documentată în migration 031.
create or replace function public.report_by_category(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  category_id    uuid,
  category_name  text,
  category_emoji text,
  item_count     bigint,
  total_revenue  numeric,
  percent_total  numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;

  with src as (
    select
      pr.category_id,
      oi.quantity::numeric as qty,
      oi.item_total
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.products pr on pr.id = oi.product_id
    where o.restaurant_id = p_restaurant_id
      and o.status != 'cancelled'
      and o.created_at >= p_from
      and o.created_at <= p_to
  )
  select coalesce(sum(item_total), 0) into v_total from src;

  return query
    with src as (
      select
        pr.category_id,
        oi.quantity::numeric as qty,
        oi.item_total
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join public.products pr on pr.id = oi.product_id
      where o.restaurant_id = p_restaurant_id
        and o.status != 'cancelled'
        and o.created_at >= p_from
        and o.created_at <= p_to
    )
    select
      s.category_id,
      coalesce(c.name, 'Fără categorie') as category_name,
      c.emoji as category_emoji,
      sum(s.qty)::bigint as item_count,
      sum(s.item_total)::numeric as total_revenue,
      case when v_total > 0 then round(100 * sum(s.item_total) / v_total, 1) else 0::numeric end as percent_total
    from src s
    left join public.categories c on c.id = s.category_id
    group by s.category_id, c.name, c.emoji
    order by sum(s.item_total) desc nulls last;
end;
$$;

revoke all on function public.report_by_category(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_by_category(uuid, timestamptz, timestamptz) to authenticated;
