-- =============================================================
-- Menuvia — Migration 004 FIXED
-- restaurant_memberships (roles) + onboarding_state
-- Changes from original Batch 1 source:
--   restaurant_members → restaurant_memberships (table name + all indexes + trigger names)
--   rm_restaurant_id_idx → rms_restaurant_id_idx (renamed to avoid collision)
--   rm_user_id_idx       → rms_user_id_idx
-- Owner bootstrap trigger added (restaurants.owner_id confirmed in base schema.sql as:
--   owner_id uuid not null references public.profiles(id) on delete cascade
--   profiles.id == auth.users.id per handle_new_user trigger in schema.sql)
-- onboarding_state reproduced exactly from original source.
-- =============================================================

-- ----------------------------------------------------------
-- Role enum — reproduced exactly from source
-- ----------------------------------------------------------
do $$ begin
  create type public.member_role as enum ('owner', 'manager', 'waiter', 'kitchen');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------
-- restaurant_memberships
-- Renamed from restaurant_members. Columns reproduced exactly from source.
-- ----------------------------------------------------------
create table if not exists public.restaurant_memberships (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            public.member_role not null default 'waiter',
  invited_by      uuid references auth.users(id) on delete set null,
  joined_at       timestamptz not null default now(),

  unique (restaurant_id, user_id)
);

-- Index names updated to match renamed table (originals were rm_* prefixed)
create index if not exists rms_restaurant_id_idx on public.restaurant_memberships(restaurant_id);
create index if not exists rms_user_id_idx       on public.restaurant_memberships(user_id);

-- ----------------------------------------------------------
-- Owner bootstrap
-- Source: schema.sql confirms restaurants.owner_id is:
--   owner_id uuid not null references public.profiles(id) on delete cascade
-- schema.sql also confirms profiles.id = auth.users.id via handle_new_user trigger.
-- Therefore restaurants.owner_id is the auth.users uuid for the creating user.
-- ----------------------------------------------------------
create or replace function public.bootstrap_restaurant_owner()
returns trigger language plpgsql security definer as $$
begin
  -- owner_id is NOT NULL per schema constraint, but guard defensively
  if new.owner_id is not null then
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (restaurant_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'restaurants_bootstrap_owner_membership'
  ) then
    execute $t$
      create trigger restaurants_bootstrap_owner_membership
        after insert on public.restaurants
        for each row execute function public.bootstrap_restaurant_owner();
    $t$;
  end if;
end $$;

-- ----------------------------------------------------------
-- Backfill: create owner memberships for existing restaurants
-- that do not yet have a row with role='owner'.
-- Skips rows where owner_id is null (NOT NULL constraint means none expected).
-- ----------------------------------------------------------
insert into public.restaurant_memberships (restaurant_id, user_id, role)
select r.id, r.owner_id, 'owner'
from public.restaurants r
where r.owner_id is not null
  and not exists (
    select 1
    from public.restaurant_memberships rm
    where rm.restaurant_id = r.id
      and rm.role = 'owner'
  )
on conflict (restaurant_id, user_id) do nothing;

-- ----------------------------------------------------------
-- onboarding_state
-- Reproduced exactly from original Batch 1 migration-004 source.
-- ----------------------------------------------------------
create table if not exists public.onboarding_state (
  restaurant_id         uuid primary key references public.restaurants(id) on delete cascade,
  restaurant_created    boolean not null default false,
  menu_created          boolean not null default false,
  table_created         boolean not null default false,
  qr_generated          boolean not null default false,
  first_order_received  boolean not null default false,
  completed_at          timestamptz,
  updated_at            timestamptz not null default now()
);

-- Trigger name preserved exactly from source
create trigger onboarding_state_updated_at
  before update on public.onboarding_state
  for each row execute function public.set_updated_at();

-- Auto-create onboarding_state when a restaurant is created
-- Function body reproduced exactly from source.
create or replace function public.init_onboarding_state()
returns trigger language plpgsql security definer as $$
begin
  insert into public.onboarding_state (restaurant_id, restaurant_created)
  values (new.id, true)
  on conflict (restaurant_id) do nothing;
  return new;
end;
$$;

-- Guard reproduced exactly from source
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'restaurants_init_onboarding'
  ) then
    execute $t$
      create trigger restaurants_init_onboarding
        after insert on public.restaurants
        for each row execute function public.init_onboarding_state();
    $t$;
  end if;
end $$;
