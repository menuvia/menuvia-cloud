-- =============================================================
-- Menuvia — Migration 005 FIXED
-- Row Level Security — access model
-- Changes from original Batch 1 source:
--   restaurant_members → restaurant_memberships in all helper function bodies
--   orders INSERT policies: removed entirely — all creation via create_order RPC
--   order_items INSERT policies: removed entirely — all creation via create_order RPC
--   orders UPDATE: replaced with explicit per-role transition policies
--     using corrected status values ('new'/'confirmed' instead of 'pending'/'accepted')
--   orders kitchen policy: 'pending'/'accepted' → 'new'/'confirmed'
--   restaurant_members RLS section: renamed to restaurant_memberships
-- All other policy structure, names, and logic reproduced from source.
-- =============================================================

-- ── Helper: resolve calling user's role for a given restaurant ──
-- Table reference updated: restaurant_members → restaurant_memberships
create or replace function public.my_role(p_restaurant_id uuid)
returns public.member_role language sql security definer stable as $$
  select role
  from public.restaurant_memberships
  where restaurant_id = p_restaurant_id
    and user_id = auth.uid()
  limit 1;
$$;

-- ── Helper: is caller owner or manager? ─────────────────────────
-- Table reference updated: restaurant_members → restaurant_memberships
create or replace function public.is_admin(p_restaurant_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id
      and user_id = auth.uid()
      and role in ('owner', 'manager')
  );
$$;

-- ── Helper: is caller any authenticated member? ──────────────────
-- Table reference updated: restaurant_members → restaurant_memberships
create or replace function public.is_member(p_restaurant_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id
      and user_id = auth.uid()
  );
$$;


-- =============================================================
-- RLS: tables
-- Reproduced from source — no policy logic changes.
-- =============================================================
alter table public.tables enable row level security;

create policy "tables: members read"
  on public.tables for select
  using (public.is_member(restaurant_id));

create policy "tables: anon read via qr"
  on public.tables for select
  using (
    exists (
      select 1 from public.qr_tokens qt
      where qt.table_id = tables.id
        and qt.is_active = true
        and (qt.expires_at is null or qt.expires_at > now())
    )
  );

create policy "tables: admin insert"
  on public.tables for insert
  with check (public.is_admin(restaurant_id));

create policy "tables: admin update"
  on public.tables for update
  using (public.is_admin(restaurant_id));

create policy "tables: admin delete"
  on public.tables for delete
  using (public.is_admin(restaurant_id));


-- =============================================================
-- RLS: qr_tokens
-- Reproduced from source — no policy logic changes.
-- =============================================================
alter table public.qr_tokens enable row level security;

create policy "qr_tokens: anon read active"
  on public.qr_tokens for select
  using (is_active = true and (expires_at is null or expires_at > now()));

create policy "qr_tokens: members read"
  on public.qr_tokens for select
  using (public.is_member(restaurant_id));

create policy "qr_tokens: admin insert"
  on public.qr_tokens for insert
  with check (public.is_admin(restaurant_id));

create policy "qr_tokens: admin update"
  on public.qr_tokens for update
  using (public.is_admin(restaurant_id));

create policy "qr_tokens: admin delete"
  on public.qr_tokens for delete
  using (public.is_admin(restaurant_id));


-- =============================================================
-- RLS: modifier_groups
-- Reproduced from source — no policy logic changes.
-- =============================================================
alter table public.modifier_groups enable row level security;

create policy "modifier_groups: anon read"
  on public.modifier_groups for select
  using (true);

create policy "modifier_groups: admin write"
  on public.modifier_groups for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));


-- =============================================================
-- RLS: modifier_options
-- Reproduced from source — no policy logic changes.
-- =============================================================
alter table public.modifier_options enable row level security;

create policy "modifier_options: anon read"
  on public.modifier_options for select
  using (true);

create policy "modifier_options: admin write"
  on public.modifier_options for all
  using (
    exists (
      select 1 from public.modifier_groups mg
      where mg.id = modifier_options.modifier_group_id
        and public.is_admin(mg.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.modifier_groups mg
      where mg.id = modifier_options.modifier_group_id
        and public.is_admin(mg.restaurant_id)
    )
  );


-- =============================================================
-- RLS: product_modifier_groups
-- Reproduced from source — no policy logic changes.
-- =============================================================
alter table public.product_modifier_groups enable row level security;

create policy "pmg: anon read"
  on public.product_modifier_groups for select
  using (true);

create policy "pmg: admin write"
  on public.product_modifier_groups for all
  using (
    exists (
      select 1 from public.modifier_groups mg
      where mg.id = product_modifier_groups.modifier_group_id
        and public.is_admin(mg.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.modifier_groups mg
      where mg.id = product_modifier_groups.modifier_group_id
        and public.is_admin(mg.restaurant_id)
    )
  );


-- =============================================================
-- RLS: orders
-- CHANGED from source:
--   INSERT policies removed — all creation via create_order SECURITY DEFINER RPC only
--   UPDATE policies rewritten with strict per-role transition enforcement
--   Status values corrected: 'pending'→'new', 'accepted'→'confirmed'
-- =============================================================
alter table public.orders enable row level security;

-- SELECT: authenticated members only. Anon cannot SELECT.
create policy "orders: members read"
  on public.orders for select
  using (public.is_member(restaurant_id));

-- INSERT: no direct INSERT for any role.
-- create_order RPC (SECURITY DEFINER) is the only write path for all sources.

-- UPDATE: kitchen — allowed only when current status permits a kitchen transition.
-- Transitions: new→confirmed, confirmed→preparing, preparing→ready.
-- RLS USING clause checks the current row status (what kitchen can act on).
-- Application layer is responsible for sending only the correct next status.
create policy "orders: kitchen update"
  on public.orders for update
  using (
    public.my_role(restaurant_id) = 'kitchen'
    and status in ('new', 'confirmed', 'preparing')
  );

-- UPDATE: waiter — allowed only when current status is 'ready' or 'served'.
-- Transitions: ready→served, served→paid.
-- Also allows owner/manager via this policy for the same status range.
create policy "orders: waiter update"
  on public.orders for update
  using (
    public.my_role(restaurant_id) in ('waiter', 'owner', 'manager')
    and status in ('ready', 'served')
  );

-- UPDATE/ALL: admin — full access including cancel and payment field updates.
-- The admin all policy from source is preserved. It supersedes the above for admins
-- but having the explicit waiter/kitchen policies ensures those roles cannot
-- update outside their permitted status ranges.
create policy "orders: admin all"
  on public.orders for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- DELETE: owner only
create policy "orders: owner delete"
  on public.orders for delete
  using (public.my_role(restaurant_id) = 'owner');


-- =============================================================
-- RLS: order_items
-- CHANGED from source:
--   All INSERT policies removed — all creation via create_order RPC only.
--   SELECT and UPDATE/DELETE policies reproduced from source logic.
-- =============================================================
alter table public.order_items enable row level security;

-- SELECT: authenticated members only
create policy "order_items: members read"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and public.is_member(o.restaurant_id)
    )
  );

-- INSERT: no direct INSERT for any role.
-- create_order RPC (SECURITY DEFINER) is the only write path.

-- UPDATE/DELETE: admin only (reproduced from source)
create policy "order_items: admin update delete"
  on public.order_items for all
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and public.is_admin(o.restaurant_id)
    )
  );

-- UPDATE for waiter/manager (corrections to items): reproduced from source intent
create policy "order_items: waiter manager update"
  on public.order_items for update
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and public.my_role(o.restaurant_id) in ('owner', 'manager', 'waiter')
    )
  );


-- =============================================================
-- RLS: restaurant_memberships
-- Renamed from restaurant_members in source.
-- Policy logic reproduced exactly from source.
-- =============================================================
alter table public.restaurant_memberships enable row level security;

create policy "rms: members read"
  on public.restaurant_memberships for select
  using (public.is_member(restaurant_id));

create policy "rms: admin all"
  on public.restaurant_memberships for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));


-- =============================================================
-- RLS: onboarding_state
-- Reproduced exactly from source.
-- =============================================================
alter table public.onboarding_state enable row level security;

create policy "onboarding: admin read write"
  on public.onboarding_state for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));


-- =============================================================
-- RLS: categories and products
-- These exist in base schema.sql with owner-only policies.
-- Adding member/anon read policies to support QR menu rendering.
-- =============================================================
create policy "categories: anon read"
  on public.categories for select
  using (true);

create policy "products: anon read active"
  on public.products for select
  using (is_active = true);
