-- =============================================================
-- Menuvia — Migration 001
-- tables + qr_tokens
-- Reproduced exactly from Batch 1 source.
-- Run BEFORE migrations 002–006.
-- =============================================================

-- ----------------------------------------------------------
-- 1. tables
-- ----------------------------------------------------------
create table if not exists public.tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  slug          text not null,
  seats         smallint,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (restaurant_id, slug)
);

create index if not exists tables_restaurant_id_idx on public.tables(restaurant_id);

-- ----------------------------------------------------------
-- 2. qr_tokens
-- ----------------------------------------------------------
create table if not exists public.qr_tokens (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid not null references public.tables(id) on delete cascade,
  token         text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  is_active     boolean not null default true,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists qr_tokens_token_idx       on public.qr_tokens(token);
create index if not exists qr_tokens_table_id_idx    on public.qr_tokens(table_id);
create index if not exists qr_tokens_restaurant_idx  on public.qr_tokens(restaurant_id);

-- set_updated_at helper (idempotent — also created by base schema but guarded)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tables_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();
