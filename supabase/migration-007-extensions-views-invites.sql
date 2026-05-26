-- =============================================================
-- Menuvia — Migration 007
-- Product column extensions + display_order for categories
-- Analytics views (v_daily_orders, v_waiter_performance,
--   v_product_performance, v_hourly_distribution)
-- Invite tokens table for team invite flow
-- restaurant_settings table
-- =============================================================

-- ----------------------------------------------------------
-- 1. Extend products table (columns may already exist from
--    base schema — all guarded with ADD COLUMN IF NOT EXISTS)
-- ----------------------------------------------------------
alter table public.products
  add column if not exists is_draft         boolean not null default false,
  add column if not exists is_daily_special boolean not null default false,
  add column if not exists is_sold_out      boolean not null default false,
  add column if not exists display_order    integer not null default 0;

-- Extend categories with display_order
alter table public.categories
  add column if not exists display_order integer not null default 0;

-- Rename products.position → display_order (backfill if position exists)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='position'
  ) then
    update public.products set display_order = position where display_order = 0;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='categories' and column_name='position'
  ) then
    update public.categories set display_order = position where display_order = 0;
  end if;
end $$;

-- ----------------------------------------------------------
-- 2. restaurant_settings
-- Stores per-restaurant toggles (ordering_enabled, etc.)
-- ----------------------------------------------------------
create table if not exists public.restaurant_settings (
  restaurant_id     uuid primary key references public.restaurants(id) on delete cascade,
  ordering_enabled  boolean not null default true,
  currency          text not null default 'RON',
  timezone          text not null default 'Europe/Bucharest',
  updated_at        timestamptz not null default now()
);

-- Auto-create settings row when restaurant is created
create or replace function public.init_restaurant_settings()
returns trigger language plpgsql security definer as $$
begin
  insert into public.restaurant_settings (restaurant_id)
  values (new.id)
  on conflict (restaurant_id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'restaurants_init_settings'
  ) then
    execute $t$
      create trigger restaurants_init_settings
        after insert on public.restaurants
        for each row execute function public.init_restaurant_settings();
    $t$;
  end if;
end $$;

-- Backfill for existing restaurants
insert into public.restaurant_settings (restaurant_id)
select id from public.restaurants
where id not in (select restaurant_id from public.restaurant_settings)
on conflict do nothing;

-- RLS for restaurant_settings
alter table public.restaurant_settings enable row level security;

create policy "rs: admin read write"
  on public.restaurant_settings for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- anon needs to read ordering_enabled for QR menu
create policy "rs: anon read"
  on public.restaurant_settings for select
  using (true);

-- ----------------------------------------------------------
-- 3. invite_tokens
-- Used for the team invite flow (owner sends email invite)
-- ----------------------------------------------------------
create table if not exists public.invite_tokens (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  email         text not null,
  role          public.member_role not null,
  token         text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by    uuid references auth.users(id) on delete set null,
  accepted_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  created_at    timestamptz not null default now()
);

create index if not exists invite_tokens_token_idx         on public.invite_tokens(token);
create index if not exists invite_tokens_restaurant_idx    on public.invite_tokens(restaurant_id);
create index if not exists invite_tokens_email_idx         on public.invite_tokens(email);

alter table public.invite_tokens enable row level security;

-- Admin can manage invites for their restaurant
create policy "invites: admin all"
  on public.invite_tokens for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- Anyone can read a token by value (needed for accept flow)
create policy "invites: anon read by token"
  on public.invite_tokens for select
  using (true);

-- ----------------------------------------------------------
-- 4. Analytics views
-- All filter to status='paid'. Revenue = COALESCE(paid_amount, total).
-- ----------------------------------------------------------

-- 4a. v_daily_orders — revenue, order count, source split, payment split by day
create or replace view public.v_daily_orders as
select
  restaurant_id,
  date_trunc('day', paid_at at time zone 'Europe/Bucharest') as day,
  count(*)                                                   as total_orders,
  sum(coalesce(paid_amount, total))                         as revenue,
  round(sum(coalesce(paid_amount, total)) / nullif(count(*), 0), 2) as avg_ticket,
  count(*) filter (where source = 'qr')                     as qr_orders,
  count(*) filter (where source = 'waiter')                 as waiter_orders,
  sum(coalesce(paid_amount, total)) filter (where payment_method = 'cash')     as cash_revenue,
  sum(coalesce(paid_amount, total)) filter (where payment_method = 'card_pos') as card_revenue,
  sum(coalesce(paid_amount, total)) filter (where payment_method = 'other')    as other_revenue
from public.orders
where status = 'paid'
  and paid_at is not null
group by restaurant_id, day
order by day desc;

-- 4b. v_waiter_performance — per waiter: entered / served / collected
create or replace view public.v_waiter_performance as
select
  restaurant_id,
  coalesce(created_by, served_by, paid_by)  as user_id,
  count(*) filter (where created_by is not null)  as orders_entered,
  count(*) filter (where served_by is not null)   as orders_served,
  count(*) filter (where paid_by is not null)     as orders_collected,
  sum(coalesce(paid_amount, total)) filter (where paid_by is not null) as revenue_collected
from public.orders
where status = 'paid'
group by restaurant_id, coalesce(created_by, served_by, paid_by);

-- 4c. v_product_performance — top products by revenue and quantity
create or replace view public.v_product_performance as
select
  o.restaurant_id,
  oi.product_id,
  oi.product_name_snapshot                  as product_name,
  sum(oi.quantity)                           as total_quantity,
  count(distinct oi.order_id)               as order_appearances,
  sum(oi.item_total)                         as revenue
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status = 'paid'
group by o.restaurant_id, oi.product_id, oi.product_name_snapshot
order by revenue desc;

-- 4d. v_hourly_distribution — order count + revenue by hour (Bucharest tz)
create or replace view public.v_hourly_distribution as
select
  restaurant_id,
  extract(hour from paid_at at time zone 'Europe/Bucharest')::integer as hour,
  count(*)                                  as order_count,
  sum(coalesce(paid_amount, total))         as revenue
from public.orders
where status = 'paid'
  and paid_at is not null
group by restaurant_id, hour
order by hour;
