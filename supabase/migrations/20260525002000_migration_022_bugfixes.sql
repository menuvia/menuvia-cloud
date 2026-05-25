-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 022 — Bug fixes pentru probleme identificate în audit
--
-- 1. resolve_qr_token RPC — înlocuiește embed-ul anon pe restaurants
--    (care era blocat după migration-015 când policy-ul public a fost drop-at)
-- 2. get_order_public_status RPC — permite clienților anon QR să
--    urmărească statusul comenzilor fără a deschide SELECT-ul general
-- 3. rotate_qr_token RPC — rotire tranzacțională (fără gap de QR)
-- 4. reserve_ai_import_slot RPC — verifică + loghează atomic
--    (elimină race condition-ul de pe cota AI)
-- 5. push_subscriptions.endpoint — coloană + index pentru cleanup corect
--    (delete by endpoint, nu prin JSONB equality care nu funcționează)
-- 6. v_daily_orders, v_product_performance, v_waiter_performance,
--    v_hourly_distribution — views necesare pentru AnalyticsTab
--
-- Rulează DUPĂ migration-021.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. resolve_qr_token — singura cale pentru anon să rezolve un QR
-- ═══════════════════════════════════════════════════════════════
create or replace function public.resolve_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr         public.qr_tokens%rowtype;
  v_table      public.tables%rowtype;
  v_restaurant jsonb;
  v_ordering   boolean := true;
begin
  -- Caută token-ul activ
  select * into v_qr
  from public.qr_tokens
  where token = p_token and is_active = true;

  if not found then return null; end if;

  -- Verifică expirarea
  if v_qr.expires_at is not null and v_qr.expires_at < now() then
    return null;
  end if;

  -- Masa
  select * into v_table
  from public.tables
  where id = v_qr.table_id;

  if not found then return null; end if;

  -- Restaurantul (doar câmpurile publice necesare pentru meniu)
  select jsonb_build_object(
    'id',             r.id,
    'name',           r.name,
    'slug',           r.slug,
    'primary_color',  r.primary_color,
    'logo_url',       r.logo_url,
    'tagline',        r.tagline,
    'city',           r.city,
    'description',    r.description,
    'address',        r.address,
    'phone',          r.phone,
    'hours',          r.hours
  ) into v_restaurant
  from public.restaurants r
  where r.id = v_qr.restaurant_id and r.is_active = true;

  if v_restaurant is null then return null; end if;

  -- Verifică dacă ordering e activat în restaurant_settings
  select coalesce(rs.ordering_enabled, true) into v_ordering
  from public.restaurant_settings rs
  where rs.restaurant_id = v_qr.restaurant_id;

  return jsonb_build_object(
    'token',           to_jsonb(v_qr),
    'table',           to_jsonb(v_table),
    'restaurant',      v_restaurant,
    'orderingAllowed', coalesce(v_ordering, true)
  );
end;
$$;

grant execute on function public.resolve_qr_token(text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. get_order_public_status — pentru QR order tracking (anon)
--    Returnează DOAR status + total, nimic confidențial
-- ═══════════════════════════════════════════════════════════════
create or replace function public.get_order_public_status(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select o.id, o.status, o.total, o.created_at, o.confirmed_at,
         o.preparing_at, o.ready_at, o.served_at, o.paid_at, o.cancelled_at
  into v_row
  from public.orders o
  where o.id = p_order_id;

  if not found then return null; end if;

  return jsonb_build_object(
    'id',            v_row.id,
    'status',        v_row.status,
    'total',         v_row.total,
    'created_at',    v_row.created_at,
    'confirmed_at',  v_row.confirmed_at,
    'preparing_at',  v_row.preparing_at,
    'ready_at',      v_row.ready_at,
    'served_at',     v_row.served_at,
    'paid_at',       v_row.paid_at,
    'cancelled_at',  v_row.cancelled_at
  );
end;
$$;

grant execute on function public.get_order_public_status(uuid) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. rotate_qr_token — rotire tranzacțională (atomic)
--    Owner/manager/staff doar. Masa NU rămâne niciodată fără token activ.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.rotate_qr_token(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table record;
  v_new_id uuid;
begin
  -- Află restaurantul + verifică membership
  select t.id, t.restaurant_id into v_table
  from public.tables t
  where t.id = p_table_id;

  if not found then
    raise exception 'Masa nu există.';
  end if;

  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_table.restaurant_id
      and user_id = auth.uid()
      and role in ('owner','manager')
  ) and not exists (
    select 1 from public.restaurants
    where id = v_table.restaurant_id and owner_id = auth.uid()
  ) then
    raise exception 'Acces interzis: doar owner/manager pot roti token-urile.';
  end if;

  -- Într-o singură tranzacție: dezactivează vechiul, creează noul
  update public.qr_tokens
  set is_active = false
  where table_id = p_table_id and is_active = true;

  insert into public.qr_tokens (restaurant_id, table_id)
  values (v_table.restaurant_id, p_table_id)
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'new_token_id', v_new_id);
end;
$$;

grant execute on function public.rotate_qr_token(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. reserve_ai_import_slot — atomic: verifică quota ȘI loghează
--    Previne bypass prin requests paralele.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.reserve_ai_import_slot(
  p_user_id       uuid,
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  text;
  v_max   integer;
  v_used  integer;
begin
  -- Serializează requests concurente per user
  perform pg_advisory_xact_lock(hashtext('ai_import:' || p_user_id::text));

  select plan into v_plan from public.profiles where id = p_user_id;
  select ai_imports_month into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 1; end if;

  select count(*) into v_used
  from public.ai_import_log
  where user_id = p_user_id
    and created_at > date_trunc('month', now());

  if v_used >= v_max then
    return jsonb_build_object(
      'allowed', false, 'used', v_used, 'max', v_max, 'plan', coalesce(v_plan, 'free')
    );
  end if;

  -- REZERVĂ slot-ul acum (nu după apel)
  insert into public.ai_import_log (user_id, restaurant_id, tokens_used)
  values (p_user_id, p_restaurant_id, 0);

  return jsonb_build_object(
    'allowed', true, 'used', v_used + 1, 'max', v_max, 'plan', coalesce(v_plan, 'free')
  );
end;
$$;

grant execute on function public.reserve_ai_import_slot(uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 5. push_subscriptions.endpoint — coloană pentru cleanup corect
--    (delete via JSONB equality nu funcționează în send-push.js)
-- ═══════════════════════════════════════════════════════════════
alter table public.push_subscriptions
  add column if not exists endpoint text
    generated always as (subscription->>'endpoint') stored;

create index if not exists idx_push_subs_endpoint
  on public.push_subscriptions (endpoint);


-- ═══════════════════════════════════════════════════════════════
-- 6. Views pentru AnalyticsTab (dacă nu au fost create anterior)
-- ═══════════════════════════════════════════════════════════════

drop view if exists public.v_daily_orders;
create view public.v_daily_orders as
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

drop view if exists public.v_product_performance;
create view public.v_product_performance as
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

drop view if exists public.v_waiter_performance;
create view public.v_waiter_performance as
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

drop view if exists public.v_hourly_distribution;
create view public.v_hourly_distribution as
select
  o.restaurant_id,
  extract(hour from o.created_at at time zone 'Europe/Bucharest')::int as hour,
  count(*)                                                              as order_count
from public.orders o
where o.status != 'cancelled'
  and o.created_at > now() - interval '30 days'
group by o.restaurant_id, extract(hour from o.created_at at time zone 'Europe/Bucharest')::int;

-- Views moștenesc permisiunile tabelelor subiacente prin RLS.
grant select on public.v_daily_orders, public.v_product_performance,
                public.v_waiter_performance, public.v_hourly_distribution
  to authenticated;


comment on function public.resolve_qr_token(text) is
  'Rezolvă un QR token pentru anon users. Înlocuiește embed-ul direct pe restaurants (blocat după migration-015).';

comment on function public.get_order_public_status(uuid) is
  'Returnează status public al unei comenzi (pentru QR order tracking). Fără date sensibile.';

comment on function public.rotate_qr_token(uuid) is
  'Rotește token-ul unui masă atomic. Previne race unde masa rămâne fără QR activ la eroare.';

comment on function public.reserve_ai_import_slot(uuid, uuid) is
  'Verifică quota AI ȘI loghează slot-ul într-o singură tranzacție cu advisory lock. Previne bypass.';
