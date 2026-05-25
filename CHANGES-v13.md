# Menuvia v12.1 → v13 — Production Patch

## P0 Fixes (Blockers)

### 1. PLAN MISMATCH RESOLVED
- **Removed** hardcoded `PLANS` object from `constants.ts` (was `Infinity` for pro)
- **Created** `src/hooks/usePlanLimits.ts` — fetches `plan_limits` table from DB at runtime
- DB is source of truth: `free=15`, `pro=500`, `business=5000`
- `canAddProduct()` now uses DB values with in-memory cache
- All references to old `PLANS`, `canAddProduct`, `hasFeature` replaced

### 2. profile.plan PROPERLY LOADED
- `AuthContext.tsx` now selects `id, email, full_name, plan` from profiles
- `profile.plan` is exposed via `useAuth()` and used by DashboardPage, AnalyticsTab
- Added `refreshProfile()` method for post-Stripe-checkout refresh
- **Before:** all users treated as `free`. **After:** plan reflects DB value

### 3. STRIPE INTEGRATION
- `netlify/functions/stripe-checkout.js` — creates Checkout Session, validates JWT
- `netlify/functions/stripe-webhook.js` — handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- PricingPage "Alege Pro" button → Stripe Checkout → webhook updates `profiles.plan`
- Requires env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`

### 4. IMAGE UPLOAD
- `ProductModal` in DashboardPage now has file input with:
  - Client-side resize to max 1200px via canvas
  - WebP conversion at 0.85 quality
  - Upload to Supabase Storage `product-images` bucket
  - Path: `{userId}/{restaurantId}/{uuid}.webp`
  - Preview + delete in modal
- Migration 015 creates storage bucket + RLS policies
- Images display in PublicMenuPage and QrMenuPage (existing `image_url` field)

## P1 Fixes (Hardening)

### 5. RESTAURANT PUBLIC READ → RPC
- Migration 015: dropped `"restaurants: public read by slug"` SELECT policy
- Created `get_restaurant_by_slug(p_slug)` SECURITY DEFINER RPC
- `PublicMenuPage` and `qr.ts` updated to use RPC
- Prevents full-table scan of all active restaurants

### 6. RACE CONDITION LOCKS
- Migration 015: added `pg_advisory_xact_lock()` to:
  - `enforce_product_limit()` — keyed on restaurant_id
  - `enforce_table_limit()` — keyed on restaurant_id
  - `enforce_restaurant_limit()` — keyed on owner_id
- Prevents concurrent inserts from bypassing count-based limits

### 7. IDEMPOTENCY PERSISTENCE
- QrMenuPage: idempotency key stored in `sessionStorage` keyed on QR token
- Cleared on `handleReset()` (new order flow)
- Survives retry loops on flaky 4G; prevents duplicates across quick resubmits

### 8. DEAD CODE CLEANUP
- Removed duplicate `const D = {...}` from KitchenPage, WaiterPage, WaiterEntry, PageLoader
- All now import `{ D }` from `'../lib/constants'`
- Removed `ALLERGENS`, `DIETARY_TAGS` (26 lines, zero usage)
- Removed duplicate `STATUS_META` from WaiterPage (imports from constants)

### 9. STRICT TYPESCRIPT
- `tsconfig.json`: `strict: true`
- Zero `@ts-ignore`, zero new `any`
- Fixed all strict-mode errors (null checks, unknown→ReactNode casts)
- Build passes clean: `tsc && vite build` = 0 errors

## P2 (Observability)

### 10. SENTRY
- `@sentry/react` added to dependencies
- `main.tsx`: `Sentry.init()` with `VITE_SENTRY_DSN` env var
- `ErrorBoundary` in PageLoader wraps with `Sentry.captureException()`
- Ready to use: create project on sentry.io, set `VITE_SENTRY_DSN` in Netlify

## New Features

### 11. WAITER CALLS
- Migration 016: `waiter_calls` table, `call_waiter()` RPC (anon), `resolve_waiter_call()` RPC
- Rate limited: max 1 pending call per table per 5 minutes
- QrMenuPage: "Cheamă ospătarul" button in footer, with visual feedback
- WaiterPage: "Apeluri ospătar" section with sound notification + "Rezolvat" button
- Realtime subscription for instant updates

### 12. DAILY OPERATIONAL REPORT
- New `DailyReportTab` component, lazy-loaded from Dashboard "Raport zi" tab
- Date selector (default: today)
- Shows: total orders, revenue breakdown (cash/card/other), QR vs waiter split, top 5 products
- PDF export via jsPDF with disclaimer: "Nu înlocuiește raportul Z fiscal"

### 13. SPLIT BILL
- Migration 017: `order_payments` table, `add_partial_payment()` RPC, `get_order_payments()` RPC
- Auto-transitions order to `paid` when `sum(payments) >= total`
- WaiterPage: "Plată parțială" button on served orders → modal with running total + payment list
- Supports mixed methods (cash + card on same order)

---

## Aplicare

### SQL Migrations (run in order in Supabase SQL Editor)
```
supabase/migration-015-advisory-locks-rpc-storage.sql
supabase/migration-016-waiter-calls.sql
supabase/migration-017-split-bill.sql
```

### Storage Bucket
- Migration 015 creates `product-images` bucket automatically
- If it fails (some Supabase versions), create manually:
  Dashboard → Storage → New bucket → `product-images` (public, 5MB limit)

### Environment Variables (Netlify)
```
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
```

### Stripe Setup
1. Create product + price in Stripe Dashboard (recurring, monthly)
2. Copy price ID → `STRIPE_PRO_PRICE_ID`
3. Create webhook endpoint: `https://yourdomain/.netlify/functions/stripe-webhook`
4. Events to listen: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
5. Copy webhook signing secret → `STRIPE_WEBHOOK_SECRET`

### Deploy
```bash
npm install
npm run build   # verify clean build locally
git add -A && git commit -m "v13: production patch"
git push        # Netlify auto-deploys
```

---

## Checklist verificare (10 puncte)

1. [ ] `npm run build` = 0 errors, 0 warnings (strict TS)
2. [ ] Login → Dashboard → tab "Produse" → "Adaugă produs" → upload imagine → salvează → verifică imagine vizibilă pe meniu public
3. [ ] Tab "Raport zi" → selectează data de azi → afișează date (sau "Nicio comandă") → Export PDF funcționează
4. [ ] Scanează QR → apasă "Cheamă ospătarul" → verifică apariția în WaiterPage secțiunea "Apeluri ospătar" → "Rezolvat" sterge apelul
5. [ ] Scanează QR → adaugă produs → trimite → apasă "Trimite" rapid de 3x → doar 1 comandă apare în Kitchen (idempotency)
6. [ ] WaiterPage → pe o comandă servită → "Plată parțială" → adaugă 2 plăți → la a doua comanda se marchează "Plătit" automat
7. [ ] `/pricing` → "Alege Pro" → redirect Stripe Checkout (sau eroare dacă Stripe nu e configurat)
8. [ ] Supabase SQL: `SELECT * FROM plan_limits` → 3 rânduri (free/pro/business)
9. [ ] Dashboard afișează plan real (pro/free) din DB, nu hardcodat
10. [ ] `https://securityheaders.com` → verifică A grade pe domeniul deployed
