-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MENUVIA â€” SUPABASE SCHEMA
-- RuleazÄƒ Ã®n Supabase Dashboard â†’ SQL Editor
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Extensions
create extension if not exists "uuid-ossp";

-- â”€â”€ PROFILES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Extinde auth.users cu date extra
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  plan          text not null default 'free' check (plan in ('free','pro','business')),
  stripe_customer_id    text unique,
  stripe_subscription_id text unique,
  plan_expires_at       timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- â”€â”€ RESTAURANTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  tagline       text,
  city          text,
  slug          text not null unique,
  description   text,
  address       text,
  phone         text,
  hours         text,
  primary_color text default '#C8963C',
  logo_url      text,
  is_active     boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- â”€â”€ CATEGORIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  emoji         text default 'ðŸ½ï¸',
  position      integer default 0,
  created_at    timestamptz default now()
);

-- â”€â”€ PRODUCTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id   uuid references public.categories(id) on delete set null,
  name          text not null,
  description   text,
  price         numeric(10,2) not null default 0,
  emoji         text default 'ðŸ½ï¸',
  image_url     text,
  is_active     boolean default true,
  position      integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- â”€â”€ QR SCANS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.qr_scans (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  scanned_at    timestamptz default now(),
  user_agent    text,
  country       text
);

-- â”€â”€ PAGE VIEWS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.page_views (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  viewed_at     timestamptz default now(),
  product_id    uuid references public.products(id) on delete set null
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- ROW LEVEL SECURITY
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

alter table public.profiles      enable row level security;
alter table public.restaurants   enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.qr_scans      enable row level security;
alter table public.page_views    enable row level security;

-- Profiles: user sees only own profile
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id);

-- Restaurants: owner full access; public can read active ones by slug
create policy "restaurants_owner" on public.restaurants
  for all using (auth.uid() = owner_id);

create policy "restaurants_public_read" on public.restaurants
  for select using (is_active = true);

-- Categories: owner full access; public read via restaurant
create policy "categories_owner" on public.categories
  for all using (
    auth.uid() = (select owner_id from public.restaurants where id = restaurant_id)
  );

create policy "categories_public_read" on public.categories
  for select using (true);

-- Products: owner full access; public reads active ones
create policy "products_owner" on public.products
  for all using (
    auth.uid() = (select owner_id from public.restaurants where id = restaurant_id)
  );

create policy "products_public_read" on public.products
  for select using (is_active = true);

-- QR Scans & Page Views: anyone can insert, owner can read own
create policy "scans_insert" on public.qr_scans
  for insert with check (true);

create policy "scans_owner_read" on public.qr_scans
  for select using (
    auth.uid() = (select owner_id from public.restaurants where id = restaurant_id)
  );

create policy "views_insert" on public.page_views
  for insert with check (true);

create policy "views_owner_read" on public.page_views
  for select using (
    auth.uid() = (select owner_id from public.restaurants where id = restaurant_id)
  );

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- TRIGGERS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_restaurants_updated_at before update on public.restaurants
  for each row execute procedure public.set_updated_at();

create trigger set_products_updated_at before update on public.products
  for each row execute procedure public.set_updated_at();

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- ANALYTICS VIEWS (helpers pentru dashboard)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

create or replace view public.daily_scans
  with (security_invoker = true)
as
select
  restaurant_id,
  date_trunc('day', scanned_at) as day,
  count(*) as scans
from public.qr_scans
group by restaurant_id, day;

create or replace view public.weekly_scans
  with (security_invoker = true)
as
select
  restaurant_id,
  date_trunc('week', scanned_at) as week,
  count(*) as scans
from public.qr_scans
group by restaurant_id, week;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- SEED: Date demo (opÈ›ional â€” comenteazÄƒ dacÄƒ nu vrei)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Nu se poate seed fÄƒrÄƒ un user_id real, deci se face din app
-- dupÄƒ primul signup.

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- STORAGE â€” bucket pentru imagini produse
-- RuleazÄƒ Ã®n Supabase Dashboard â†’ Storage â†’ New Bucket
-- SAU prin SQL:
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- CreeazÄƒ bucket public pentru imagini
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB max
  array['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
on conflict (id) do nothing;

-- Owner poate upload/delete propriile imagini
create policy "owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'product-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "owner_delete" on storage.objects
  for delete using (
    bucket_id = 'product-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ToatÄƒ lumea poate citi imagini (bucket public)
create policy "public_read" on storage.objects
  for select using (bucket_id = 'product-images');

-- AdaugÄƒ image_url la products (dacÄƒ nu existÄƒ deja)
alter table public.products add column if not exists image_url text;

-- â”€â”€ LEADS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- StocheazÄƒ lead-uri de pe landing page
create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  restaurant    text,
  source        text default 'landing_page',
  status        text default 'new' check (status in ('new','contacted','converted','rejected')),
  notes         text,
  created_at    timestamptz default now()
);

-- RLS: doar service role poate citi/scrie leads
alter table public.leads enable row level security;

-- â”€â”€ WAITER CALLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Tracks call-waiter requests from public menu
create table if not exists public.waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_label   text,
  status        text default 'pending' check (status in ('pending','seen','done')),
  created_at    timestamptz default now()
);

alter table public.waiter_calls enable row level security;

-- Anyone can create a waiter call (public menu)
create policy "waiter_calls_insert" on public.waiter_calls
  for insert with check (true);

-- Owner can read and update their calls
create policy "waiter_calls_owner" on public.waiter_calls
  for all using (
    auth.uid() = (select owner_id from public.restaurants where id = restaurant_id)
  );

-- â”€â”€ PRODUCT EXTENSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Daily special flag and sold-out flag
alter table public.products add column if not exists is_daily_special boolean default false;
alter table public.products add column if not exists is_sold_out boolean default false;

