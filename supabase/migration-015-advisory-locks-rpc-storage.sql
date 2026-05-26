-- =============================================================
-- Menuvia — Migration 015
-- 1. Advisory locks on plan-limit triggers (race condition fix)
-- 2. get_restaurant_by_slug RPC (eliminates public full-scan)
-- 3. Storage bucket + policies for product images
--
-- Run AFTER migration-014.
-- =============================================================


-- =============================================================
-- 1. Advisory locks — prevent concurrent inserts from bypassing
--    count-based limits (off-by-one race condition)
-- =============================================================

create or replace function public.enforce_product_limit()
returns trigger language plpgsql security definer as $$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  -- Serialize concurrent inserts for this restaurant
  perform pg_advisory_xact_lock(hashtext('products:' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;
  select max_products into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 15; end if;

  select count(*) into v_count
  from public.products where restaurant_id = new.restaurant_id;

  if v_count >= v_max then
    raise exception 'Limită produse atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free');
  end if;
  return new;
end;
$$;

create or replace function public.enforce_table_limit()
returns trigger language plpgsql security definer as $$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('tables:' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;
  select max_tables into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 3; end if;

  select count(*) into v_count
  from public.tables where restaurant_id = new.restaurant_id;

  if v_count >= v_max then
    raise exception 'Limită mese atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free');
  end if;
  return new;
end;
$$;

create or replace function public.enforce_restaurant_limit()
returns trigger language plpgsql security definer as $$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('restaurants:' || new.owner_id::text));

  select plan into v_plan from public.profiles where id = new.owner_id;
  select max_restaurants into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 1; end if;

  select count(*) into v_count
  from public.restaurants where owner_id = new.owner_id;

  if v_count >= v_max then
    raise exception 'Limită restaurante atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free');
  end if;
  return new;
end;
$$;


-- =============================================================
-- 2. get_restaurant_by_slug — replaces open SELECT policy
-- =============================================================

-- Drop the permissive public read policy
drop policy if exists "restaurants: public read by slug" on public.restaurants;

create or replace function public.get_restaurant_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select to_jsonb(r.*) into v_result
  from public.restaurants r
  where r.slug = p_slug
    and r.is_active = true;

  return v_result;
end;
$$;

grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;


-- =============================================================
-- 3. Storage bucket for product images
-- =============================================================

-- Create bucket if it doesn't exist (idempotent via DO block)
-- NOTE: Supabase Storage buckets are created via Dashboard or
-- supabase CLI. This SQL creates the policy rows.
-- Run in Dashboard: Storage → New bucket → "product-images" (public)

-- Policies for product-images bucket:
-- Allow authenticated users to upload to their own path
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,  -- 5MB max
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Upload: authenticated users can upload to product-images/{user_id}/*
create policy "product-images: auth upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update: authenticated users can update own files
create policy "product-images: auth update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: authenticated users can delete own files
create policy "product-images: auth delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read: public (bucket is public)
create policy "product-images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');
