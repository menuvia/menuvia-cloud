# Design: `restaurant_subscriptions` — planul per RESTAURANT, nu per owner

> Status: DESIGN aprobabil, neimplementat. Închide datoria #5 din
> ARCHITECTURE.md și „Faza 5" din docs/AFFILIATE_PROGRAM.md.
> Toate faptele de mai jos au fost verificate în cod la 2026-07-03
> (main = f642395, 196 migrații).

## 1. Problema (fapte, nu ipoteze)

Planul stă pe `profiles.plan` al OWNER-ului. Consecințe concrete:

- **Un owner cu N restaurante plătește 1 abonament și deblochează N.**
  Checkout-ul are guard 409 anti-dublu-abonament pe customer
  (`stripe-checkout.js:216-224`) — un user nici NU POATE plăti separat
  pentru al doilea local.
- **`admin_set_restaurant_plan` (mig 186:499-532) e per-owner** — fondatorul
  „schimbă planul restaurantului X" și de fapt le schimbă pe toate ale
  aceluiași owner.
- **Riscul de afiliere documentat** (AFFILIATE_PROGRAM.md:87-89): comision
  pe 1 restaurant, entitlement pe N. Atribuirea e pe `referred_profile_id`
  (owner) pentru că `restaurant_id` nu există la checkout (Decizia #3, :250).
- Stripe nu știe de restaurante: legătura e exclusiv
  `profiles.stripe_customer_id` (per user); metadata abonamentului conține
  doar `supabase_user_id`, `plan`, `referral_code` (`stripe-checkout.js:241-245`).

## 2. De ce migrarea e IEFTINĂ arhitectural

Toate citirile server-side trec deja prin **exact 3 pâlnii** care rezolvă
restaurant→owner→`profiles.plan`:

| Pâlnie | Ultima definiție | Consumatori |
|---|---|---|
| `owner_plan(p_restaurant_id)` | mig 013:192-196 | ~8 triggere/RPC de limită (produse, mese, echipă, AI) |
| `get_restaurant_features` | mig 068:13-44 | TOT frontend-ul (`features.ts:43` → `useFeatures`) |
| `enforce_feature_for_restaurant` | mig 087:22-52 | gate-urile fiscale/lifecycle (regula de aur) |

(+ `enforce_ordering_enabled` mig 083 și `reserve_ai_import_slot` mig 141:44,
care fac join-ul direct — se aliniază la pâlnie în Faza 0.)

**Frontend-ul e DEJA per-restaurant** (`useFeatures(restaurantId)`, CLAUDE.md
regula 3) — zero schimbări UI la citire. Singurele scrieri de plan sunt
webhook-ul Stripe (3 locuri: `stripe-webhook.js:201`, `:256`, `:300`) și
`admin_set_restaurant_plan`.

## 3. Modelul țintă

```sql
create table public.restaurant_subscriptions (
  restaurant_id          uuid primary key references public.restaurants(id) on delete cascade,
  plan                   text not null check (plan in ('free','starter','growth','pro','enterprise')),
  stripe_customer_id     text,          -- customer-ul rămâne per USER (nu-l migrăm)
  stripe_subscription_id text unique,   -- 1 abonament Stripe = 1 restaurant
  status                 text not null default 'active',  -- active/trialing/past_due/canceled
  updated_at             timestamptz not null default now()
);
-- RLS: SELECT prin is_member(restaurant_id); scrieri DOAR service_role/RPC
-- (același regim ca profiles.plan azi — vezi authorization_phase_1a_assertions.sql:61-65).
```

Rezolvarea planului devine o singură funcție nouă, cu fallback:

```sql
create function public.restaurant_plan(p_restaurant_id uuid) returns text ...
  -- 1) rând în restaurant_subscriptions cu status in ('active','trialing','past_due') → plan
  -- 2) altfel fallback pe owner: profiles.plan (comportamentul de azi, NEschimbat)
  -- 3) altfel 'free'
```

Fallback-ul e cheia migrării fără big-bang: **cât timp tabela e goală,
comportamentul e byte-identic cu azi.**

## 4. Fazele (3 PR-uri, fiecare shippable independent)

### Faza 0 — fundația, zero schimbare de comportament
- mig nouă: tabela + `restaurant_plan()` + rescrierea celor 3 pâlnii
  (+ `enforce_ordering_enabled`, `reserve_ai_import_slot`) să cheme
  `restaurant_plan()` în loc de join-ul direct. Asserții: pe DB fără rânduri
  în tabelă, rezultatele sunt identice cu owner-plan (test A/B în migrație).
- `stripe-checkout.js`: primește `restaurant_id` din body (UI-ul de checkout
  îl are deja în context — restaurantul activ), îl pune în
  `subscription_data.metadata.restaurant_id` + `session.metadata`.
  Guard-ul 409 anti-dublu-abonament devine **per restaurant** (un user poate
  avea M abonamente, câte unul per local), verificând subscription-urile
  live ale customerului după `metadata.restaurant_id`.
- `stripe-webhook.js`: când `subscription.metadata.restaurant_id` există,
  scrie **și** în `restaurant_subscriptions` (upsert pe restaurant_id) **și**
  în `profiles.plan` (compat, cât există fallback-ul). Fără metadata →
  comportamentul de azi, neatins. Anti-stale guard-ul de la `:291-294`
  se mută pe `stripe_subscription_id` al rândului per-restaurant.

### Faza 1 — backfill + cutover founder
- Backfill idempotent: pentru fiecare profil cu `plan != 'free'` și
  `stripe_subscription_id` setat și **exact 1 restaurant** → rând în
  `restaurant_subscriptions` (marea majoritate a conturilor). Ownerii
  multi-restaurant NU se ghicesc — se listează în output-ul migrației și se
  așază manual din FounderPage.
- `admin_set_restaurant_plan` devine cu adevărat per-restaurant (upsert în
  tabelă); founder RPC-urile care citesc `op.plan`/`p.plan`
  (mig 186:168/171/216/480, 188:350, 187:150, 193:78) trec pe
  `restaurant_plan(r.id)`.

### Faza 2 — afiliere per-restaurant + curățare
- `capture_affiliate_attribution` + `process_affiliate_invoice_paid`
  (mig 099:117-122) primesc `restaurant_id` din metadata invoice-ului →
  atribuirea devine per-restaurant → **riscul „plătești 1, deblochezi N"
  moare de la rădăcină**, iar `has_partner_access` poate deveni și el
  per-restaurant-referit (azi e per-profil-referit).
- `profiles.plan` rămâne read-only legacy (fallback-ul se păstrează minim
  un ciclu de facturare, apoi se poate îngheța).

## 5. Riscuri și cum le tăiem

| Risc | Mitigare |
|---|---|
| Webhook scrie planul greșit la race (2 abonamente pe același customer) | cheia devine `metadata.restaurant_id` + `stripe_subscription_id unique` pe rând; anti-stale per rând, nu per profil |
| Downgrade la `canceled` | `status` per rând; `restaurant_plan()` întoarce fallback/free doar pentru restaurantul respectiv |
| Abonamente EXISTENTE fără metadata.restaurant_id | fallback-ul owner-level le acoperă nelimitat; backfill-ul le mută doar pe single-restaurant |
| Afiliere: `on conflict (referred_profile_id)` limitează 1 atribuire/profil | rămâne așa în Faza 0-1 (nu stricăm ledger-ul); în Faza 2 unique-ul devine `(referred_profile_id, restaurant_id)` cu migrare atentă |
| `AuthContext.tsx:49` citește `row.plan` direct | e doar profilul propriu, folosit ca hint — se lasă, dar se marchează deprecated |

## 6. Ce NU se schimbă

`plan_features`/`plan_limits` (rămân per-plan), regula de aur (gate-urile
fiscale cheamă aceeași pâlnie), `PLAN_BY_PRICE`/env price IDs, frontend-ul
de gating (`useFeatures` deja per-restaurant), customer-ul Stripe per user.

## 7. Când se execută

Triggerul documentat (AFFILIATE_PROGRAM.md:74-76): primul owner
multi-restaurant PLĂTITOR sau primul caz de fraudă prin afiliere
multi-restaurant. Faza 0 e sigură oricând (zero comportament); Fazele 1-2
cer o fereastră de atenție pe webhook-uri (~o zi de monitorizare).

Estimare: Faza 0 ≈ 1 mig + 2 fișiere Netlify + UI checkout minim; Faza 1 ≈
1 mig + FounderPage; Faza 2 ≈ 1 mig + webhook. Fiecare cu asserții
fail-closed și validare pe Postgres efemer, ca de obicei.
