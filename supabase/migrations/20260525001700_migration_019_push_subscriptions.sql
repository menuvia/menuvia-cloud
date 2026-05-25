-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 019 — Push Subscriptions (Web Push Notifications)
-- ═══════════════════════════════════════════════════════════════
-- Rulează în Supabase Dashboard → SQL Editor

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  subscription  jsonb not null,
  created_at    timestamptz default now(),
  -- One subscription per user per restaurant (device)
  unique (user_id, restaurant_id)
);

-- Index for fast lookup by restaurant (used by send-push.js)
create index if not exists idx_push_subs_restaurant
  on public.push_subscriptions (restaurant_id);

-- RLS
alter table public.push_subscriptions enable row level security;

-- Users can manage only their own subscriptions
create policy "push_subs: user manage own"
  on public.push_subscriptions for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Also add item_count to orders view so send-push.js can show it
-- (item_count is calculated from order_items — added as a generated column note)
-- The webhook payload already includes order_items count via the RPC.
-- No schema change needed — send-push reads order.item_count if present.

comment on table public.push_subscriptions is
  'Web Push PushSubscription objects for kitchen/waiter staff notifications.
   One row per user per restaurant. Deleted automatically when subscription expires (410).
   
   Setup after running this migration:
   1. Generate VAPID keys: npx web-push generate-vapid-keys
   2. Add to Netlify env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
   3. Add to Netlify env vars: VITE_VAPID_PUBLIC_KEY (same as VAPID_PUBLIC_KEY)
   4. Supabase → Database → Webhooks → Create:
        Name:    send-push-on-order
        Table:   orders
        Event:   INSERT
        URL:     https://YOUR_SITE.netlify.app/.netlify/functions/send-push
        Headers: x-webhook-secret: <WEBHOOK_SECRET>
                 Content-Type: application/json';
