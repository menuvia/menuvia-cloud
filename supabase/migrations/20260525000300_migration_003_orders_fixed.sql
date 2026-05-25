-- =============================================================
-- Menuvia — Migration 003 FIXED
-- orders + order_items (canonical schema)
-- Changes from original Batch 1 source:
--   'pending'     → 'new'        (enum value)
--   'accepted'    → 'confirmed'  (enum value)
--   accepted_at   → confirmed_at (column + trigger body)
--   subtotal      → total        (column name, per build memory)
--   waiter_id     → created_by + served_by + paid_by (build memory: three separate attribution columns)
--   cancel_reason column added (build memory)
--   orders_waiter_id_idx → orders_created_by_idx (index renamed to match new column)
-- All other indexes, constraints, and triggers reproduced exactly from source.
-- =============================================================

-- ----------------------------------------------------------
-- Enums
-- ----------------------------------------------------------
do $$ begin
  create type public.order_source as enum ('qr', 'waiter');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum (
    'new',        -- received, not yet confirmed by kitchen
    'confirmed',  -- kitchen acknowledged
    'preparing',  -- actively being made
    'ready',      -- ready to serve, waiter notified
    'served',     -- delivered to table
    'paid',       -- payment collected
    'cancelled'   -- voided
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('cash', 'card_pos', 'other');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------
-- orders
-- ----------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,

  -- table context (nullable for bar/takeout orders)
  table_id        uuid references public.tables(id) on delete set null,
  qr_token_id     uuid references public.qr_tokens(id) on delete set null,

  -- who placed / manages the order (three separate attribution columns per build memory)
  source          public.order_source not null,
  created_by      uuid references auth.users(id) on delete set null,  -- waiter who entered; NULL for QR
  served_by       uuid references auth.users(id) on delete set null,  -- waiter who delivered food
  paid_by         uuid references auth.users(id) on delete set null,  -- staff who collected payment

  -- status flow
  status          public.order_status not null default 'new',

  -- payment
  payment_method  public.payment_method,
  total           numeric(10,2) not null default 0,  -- immutable sum; recalculated by trigger
  paid_amount     numeric(10,2),                     -- actual collected; may differ (tips, rounding)

  -- notes and cancellation
  notes           text,
  cancel_reason   text,

  -- canonical timestamps for the order lifecycle
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,   -- kitchen confirmed  (was: accepted_at)
  preparing_at    timestamptz,   -- kitchen started preparing
  ready_at        timestamptz,   -- ready to serve
  served_at       timestamptz,   -- delivered to table
  paid_at         timestamptz,   -- payment collected
  cancelled_at    timestamptz,

  -- snapshot for analytics (table name at time of order)
  _table_name_snapshot  text,
  _waiter_name_snapshot text
);

-- Indexes reproduced from source, adapted for renamed columns
create index if not exists orders_restaurant_id_idx on public.orders(restaurant_id);
create index if not exists orders_table_id_idx      on public.orders(table_id);
create index if not exists orders_status_idx        on public.orders(status);
create index if not exists orders_created_at_idx    on public.orders(created_at desc);
create index if not exists orders_created_by_idx    on public.orders(created_by);

-- ----------------------------------------------------------
-- order_items
-- Reproduced exactly from source.
-- ----------------------------------------------------------
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,

  -- snapshots so historical orders are not broken by menu edits
  product_name_snapshot   text not null,
  unit_price_snapshot     numeric(10,2) not null,

  quantity        smallint not null default 1 check (quantity > 0),
  item_total      numeric(10,2) not null,  -- (unit_price + modifier deltas) * quantity

  -- selected modifiers stored as JSONB array for flexibility
  -- structure: [{ "group_id": uuid, "group_name": text, "option_id": uuid,
  --               "option_name": text, "price_delta": numeric }]
  selected_modifiers  jsonb not null default '[]'::jsonb,

  notes           text,
  created_at      timestamptz not null default now()
);

-- Indexes reproduced exactly from source
create index if not exists order_items_order_id_idx   on public.order_items(order_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);

-- ----------------------------------------------------------
-- Trigger: auto-update orders.total when items change
-- Function name preserved from source (recalc_order_subtotal).
-- Column updated: subtotal → total.
-- ----------------------------------------------------------
create or replace function public.recalc_order_subtotal()
returns trigger language plpgsql security definer as $$
begin
  update public.orders
  set total = (
    select coalesce(sum(item_total), 0)
    from public.order_items
    where order_id = coalesce(new.order_id, old.order_id)
  )
  where id = coalesce(new.order_id, old.order_id);
  return coalesce(new, old);
end;
$$;

-- Trigger name preserved exactly from source
create trigger order_items_subtotal_sync
  after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_subtotal();

-- ----------------------------------------------------------
-- Trigger: stamp lifecycle timestamps on status transitions
-- Fixed: 'accepted' → 'confirmed', accepted_at → confirmed_at
-- All other branches reproduced exactly from source.
-- ----------------------------------------------------------
create or replace function public.stamp_order_timestamps()
returns trigger language plpgsql as $$
begin
  if new.status = 'confirmed'  and old.status != 'confirmed'  then new.confirmed_at  = now(); end if;
  if new.status = 'preparing'  and old.status != 'preparing'  then new.preparing_at  = now(); end if;
  if new.status = 'ready'      and old.status != 'ready'      then new.ready_at      = now(); end if;
  if new.status = 'served'     and old.status != 'served'     then new.served_at     = now(); end if;
  if new.status = 'paid'       and old.status != 'paid'       then new.paid_at       = now(); end if;
  if new.status = 'cancelled'  and old.status != 'cancelled'  then new.cancelled_at  = now(); end if;
  return new;
end;
$$;

-- Trigger name and target preserved exactly from source
create trigger orders_stamp_timestamps
  before update of status on public.orders
  for each row execute function public.stamp_order_timestamps();
