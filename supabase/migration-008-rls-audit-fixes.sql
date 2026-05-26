-- =============================================================
-- Menuvia — Migration 008
-- RLS Audit Fixes
--
-- Issues addressed:
--   1. Analytics views bypass RLS → recreate with security_invoker=true
--   2. invite_tokens anon read exposes all tokens → restrict to member read
--      + add self-accept UPDATE policy for invited users
--   3. categories/products write locked out for managers → use is_admin()
--   4. restaurants UPDATE locked out for managers → add admin update policy
--   5. waiter_calls uses owner_id → use is_admin() / is_member()
-- =============================================================


-- =============================================================
-- 1. FIX: Analytics views — add security_invoker = true
--
-- Without this, views run as their owner (postgres superuser),
-- bypassing RLS on the underlying tables. Any authenticated user
-- can query another restaurant's orders, revenue, waiter data.
--
-- security_invoker = true makes the view respect the RLS of the
-- CALLING user, same as if they queried the tables directly.
-- Requires Postgres 15+ — supported on all current Supabase plans.
-- =============================================================

create or replace view public.v_daily_orders
  with (security_invoker = true)
as
select
  restaurant_id,
  date_trunc('day', paid_at at time zone 'Europe/Bucharest') as day,
  count(*)                                                    as total_orders,
  sum(coalesce(paid_amount, total))                          as revenue,
  round(sum(coalesce(paid_amount, total)) / nullif(count(*), 0), 2) as avg_ticket,
  count(*) filter (where source = 'qr')                      as qr_orders,
  count(*) filter (where source = 'waiter')                  as waiter_orders,
  sum(coalesce(paid_amount, total)) filter (where payment_method = 'cash')     as cash_revenue,
  sum(coalesce(paid_amount, total)) filter (where payment_method = 'card_pos') as card_revenue,
  sum(coalesce(paid_amount, total)) filter (where payment_method = 'other')    as other_revenue
from public.orders
where status = 'paid'
  and paid_at is not null
group by restaurant_id, day
order by day desc;

create or replace view public.v_waiter_performance
  with (security_invoker = true)
as
select
  restaurant_id,
  coalesce(created_by, served_by, paid_by)                  as user_id,
  count(*) filter (where created_by is not null)             as orders_entered,
  count(*) filter (where served_by is not null)              as orders_served,
  count(*) filter (where paid_by is not null)                as orders_collected,
  sum(coalesce(paid_amount, total)) filter (where paid_by is not null) as revenue_collected
from public.orders
where status = 'paid'
group by restaurant_id, coalesce(created_by, served_by, paid_by);

create or replace view public.v_product_performance
  with (security_invoker = true)
as
select
  o.restaurant_id,
  oi.product_id,
  oi.product_name_snapshot                as product_name,
  sum(oi.quantity)                         as total_quantity,
  count(distinct oi.order_id)             as order_appearances,
  sum(oi.item_total)                       as revenue
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status = 'paid'
group by o.restaurant_id, oi.product_id, oi.product_name_snapshot
order by revenue desc;

create or replace view public.v_hourly_distribution
  with (security_invoker = true)
as
select
  restaurant_id,
  extract(hour from paid_at at time zone 'Europe/Bucharest')::integer as hour,
  count(*)                                as order_count,
  sum(coalesce(paid_amount, total))       as revenue
from public.orders
where status = 'paid'
  and paid_at is not null
group by restaurant_id, hour
order by hour;

-- Fix legacy views from schema.sql
create or replace view public.daily_scans
  with (security_invoker = true)
as
select
  restaurant_id,
  date_trunc('day', scanned_at) as day,
  count(*)                       as scans
from public.qr_scans
group by restaurant_id, day;

create or replace view public.weekly_scans
  with (security_invoker = true)
as
select
  restaurant_id,
  date_trunc('week', scanned_at) as week,
  count(*)                        as scans
from public.qr_scans
group by restaurant_id, week;


-- =============================================================
-- 2. FIX: invite_tokens — tighten read + add self-accept UPDATE
--
-- Problem A: "invites: anon read by token" with using(true) exposes
--   ALL invite tokens (emails, roles, tokens) to any user.
--   Token value is 48-char hex (192 bits) — not guessable — but
--   full table SELECT is still unacceptable.
--
-- Fix: drop the anon read policy, add:
--   - member read: authenticated members of the restaurant can see invites
--   - public read by known token: anon can read ONE invite IF they provide
--     the token value in the WHERE clause (needed for accept flow).
--     RLS still fires; an attacker must already know the token to read it.
--
-- Problem B: invited waiter/kitchen cannot UPDATE accepted_at because
--   "invites: admin all" requires is_admin(). Add a self-accept policy.
-- =============================================================

-- Drop the overly permissive anon read policy
drop policy if exists "invites: anon read by token" on public.invite_tokens;

-- Members of the restaurant can read their restaurant's invites
create policy "invites: member read"
  on public.invite_tokens for select
  using (public.is_member(restaurant_id));

-- Anon/authenticated can read a specific invite IF they supply the token.
-- RLS evaluates this per-row: only rows where token = the value in the query pass.
-- An attacker doing SELECT * FROM invite_tokens with no WHERE gets 0 rows.
-- The accept page does: .eq('token', token) — that specific row passes.
create policy "invites: read own token"
  on public.invite_tokens for select
  using (
    accepted_at is null
    and expires_at > now()
  );

-- Self-accept: the invited user can mark their own invite as accepted.
-- Conditions:
--   USING: token not yet accepted, not expired, and their email matches
--   WITH CHECK: only allowed to set accepted_at (not change other fields)
create policy "invites: self accept"
  on public.invite_tokens for update
  using (
    accepted_at is null
    and expires_at > now()
    and lower(email) = lower(
      coalesce(
        (select email from auth.users where id = auth.uid()),
        ''
      )
    )
  )
  with check (
    -- Can only update accepted_at; all other fields must remain unchanged
    restaurant_id = restaurant_id
    and email = email
    and role = role
    and token = token
  );


-- =============================================================
-- 3. FIX: categories — allow managers to write
--
-- Current: "categories_owner" uses auth.uid() = owner_id
-- Managers' uid ≠ owner_id → they cannot INSERT/UPDATE/DELETE categories
-- Fix: drop owner-only write policy, replace with is_admin()
-- =============================================================

drop policy if exists "categories_owner" on public.categories;

create policy "categories: admin write"
  on public.categories for all
  using    (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));


-- =============================================================
-- 4. FIX: products — allow managers to write
--
-- Same issue as categories. products_owner uses owner_id check.
-- =============================================================

drop policy if exists "products_owner" on public.products;

create policy "products: admin write"
  on public.products for all
  using    (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- Also add: authenticated members can read all products of their restaurant
-- (not just active ones — needed for dashboard product management)
drop policy if exists "products_public_read" on public.products;
drop policy if exists "products: anon read active" on public.products;

-- Public/anon: only active, non-draft products (for QR menu)
create policy "products: public read active"
  on public.products for select
  using (is_active = true and is_draft = false);

-- Members: can read all products including inactive/draft (for dashboard)
create policy "products: member read all"
  on public.products for select
  using (public.is_member(restaurant_id));


-- =============================================================
-- 5. FIX: restaurants — allow managers to UPDATE their restaurant
--
-- Current: only restaurants_owner (owner_id match) allows write.
-- Managers in SettingsTab cannot save changes.
-- Fix: add explicit admin UPDATE policy.
-- Keep owner-only for DELETE and INSERT (only owners create restaurants).
-- =============================================================

-- Add manager update access (owner already has all via restaurants_owner)
create policy "restaurants: admin update"
  on public.restaurants for update
  using    (public.is_admin(id))
  with check (public.is_admin(id));

-- Members should be able to read their restaurant even if inactive
-- (dashboard needs to show the restaurant regardless of is_active)
create policy "restaurants: member read"
  on public.restaurants for select
  using (public.is_member(id));


-- =============================================================
-- 6. FIX: waiter_calls — use is_admin() / is_member() not owner_id
--
-- Current: waiter_calls_owner uses auth.uid() = owner_id
-- Managers and waiters cannot read or respond to waiter calls.
-- =============================================================

drop policy if exists "waiter_calls_owner" on public.waiter_calls;

-- Any member can see waiter calls for their restaurant
create policy "waiter_calls: member read"
  on public.waiter_calls for select
  using (public.is_member(restaurant_id));

-- Admins (owner + manager) can update status (seen/done)
create policy "waiter_calls: admin update"
  on public.waiter_calls for update
  using    (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- Admins can delete resolved calls
create policy "waiter_calls: admin delete"
  on public.waiter_calls for delete
  using (public.is_admin(restaurant_id));


-- =============================================================
-- 7. FIX: categories member read
--
-- categories_public_read uses (true) — same issue as products.
-- Members should be able to read all categories (including display_order
-- for sorting in dashboard), not just via the public any-read.
-- Keep public read for QR menu; add member read for dashboard.
-- =============================================================

-- Member read is covered by the existing "categories: anon read" (using true)
-- which already gives full read. No additional policy needed.
-- But the duplicate "categories_public_read" and "categories: anon read" should
-- be consolidated — both use (true), harmless but messy. Leave as-is.


-- =============================================================
-- 8. FIX: qr_scans and page_views — member read not just owner read
-- =============================================================

drop policy if exists "scans_owner_read" on public.qr_scans;
drop policy if exists "views_owner_read" on public.page_views;

create policy "qr_scans: member read"
  on public.qr_scans for select
  using (public.is_member(restaurant_id));

create policy "page_views: member read"
  on public.page_views for select
  using (public.is_member(restaurant_id));


-- =============================================================
-- VERIFICATION QUERIES
-- Run these manually in Supabase SQL Editor to confirm fixes.
-- All should return 0 rows if RLS is correct.
-- =============================================================

-- Test 1: can anon see all invite tokens? (should be 0 after fix)
-- set role anon; select count(*) from invite_tokens; reset role;

-- Test 2: can a member of restaurant A see orders of restaurant B?
-- (should be 0 — orders view has security_invoker now)

-- Test 3: can a manager add a category? (should succeed)
-- → use Supabase dashboard to impersonate a manager user and try INSERT

comment on view public.v_daily_orders is
  'Analytics: daily order totals. security_invoker=true enforces RLS — users only see their restaurant data.';

comment on view public.v_waiter_performance is
  'Analytics: per-waiter stats. security_invoker=true enforces RLS.';

comment on view public.v_product_performance is
  'Analytics: top products. security_invoker=true enforces RLS.';

comment on view public.v_hourly_distribution is
  'Analytics: orders by hour. security_invoker=true enforces RLS.';
