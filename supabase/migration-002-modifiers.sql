-- =============================================================
-- Menuvia — Migration 002
-- modifier_groups + modifier_options + product_modifier_groups
-- Reproduced exactly from Batch 1 source.
-- Run AFTER migration 001, BEFORE migrations 003–006.
-- =============================================================

-- ----------------------------------------------------------
-- 1. modifier_groups
-- ----------------------------------------------------------
create table if not exists public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  selection_type text not null default 'single'
    check (selection_type in ('single', 'multiple')),
  is_required   boolean not null default false,
  min_select    smallint not null default 0,
  max_select    smallint,
  display_order smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists modifier_groups_restaurant_idx on public.modifier_groups(restaurant_id);

create trigger modifier_groups_updated_at
  before update on public.modifier_groups
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------
-- 2. modifier_options
-- ----------------------------------------------------------
create table if not exists public.modifier_options (
  id                  uuid primary key default gen_random_uuid(),
  modifier_group_id   uuid not null references public.modifier_groups(id) on delete cascade,
  name                text not null,
  price_delta         numeric(10,2) not null default 0,
  is_available        boolean not null default true,
  display_order       smallint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists modifier_options_group_idx on public.modifier_options(modifier_group_id);

create trigger modifier_options_updated_at
  before update on public.modifier_options
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------
-- 3. product_modifier_groups (M2M join)
-- ----------------------------------------------------------
create table if not exists public.product_modifier_groups (
  product_id          uuid not null references public.products(id) on delete cascade,
  modifier_group_id   uuid not null references public.modifier_groups(id) on delete cascade,
  display_order       smallint not null default 0,

  primary key (product_id, modifier_group_id)
);

create index if not exists pmg_product_idx        on public.product_modifier_groups(product_id);
create index if not exists pmg_modifier_group_idx on public.product_modifier_groups(modifier_group_id);
