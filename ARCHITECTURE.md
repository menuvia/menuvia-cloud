# Menuvia — Harta sistemului (1 pagină)

> Scopul acestui document: să-ți recuperezi modelul mental în 5 minute,
> nu să documenteze fiecare detaliu. Detaliile stau în cod și în `docs/`.

## Ce este

SaaS pentru restaurante din România: meniu digital QR → comenzi de la masă →
(în pilot) fiscalizare. React + TypeScript + Supabase (Postgres/RLS/RPC) + Netlify.

## Regula de aur (decizia comercială centrală)

**Bani + bon fiscal = Plan 3, fără excepții.**

| Tier | Nume comercial | Intern (DB/Stripe) | Ce primește clientul |
|---|---|---|---|
| 1 | 📖 Meniu Digital | `free` (demo), `starter` | meniu QR citibil, design, analytics simple |
| 2 | 🛎 Meniu + Comenzi | `growth` | comenzi de la masă, KDS, ospătari, rapoarte **operaționale**; plata pe casa existentă a localului — comanda se „închide" (`closed`), nu se „plătește" |
| 3 | 🧾 Fiscalizare | `pro`, `enterprise` | plăți în aplicație, bon fiscal (bridge FiscalNet: Datecs/Activa/Tremol), TVA, casă & tură, facturi Oblio |

Sursa de adevăr în cod: `src/lib/features.ts` (`planTier()`), server-side `plan_features` + RPC `get_restaurant_features`.
**Planul aparține restaurantului (owner-ului), nu user-ului** — staff-ul își ia tier-ul prin `useFeatures(restaurantId)`.

## Gating: Porțile A–D (enforcement SERVER-side; UI doar ascunde)

- **Gate A** (mig 083): `create_order` refuză ordering pe planuri fără `order_qr`.
- **Gate B** (mig 084 + fix 088): comanda QR cere sesiune de masă validă (`table_sessions`, token, expirare).
- **Gate C** (mig 085/087): lifecycle `served → closed` (închidere NON-fiscală, Plan 2) gated pe feature `table_lifecycle`; `paid` rămâne exclusiv Plan 3.
- **Gate D** (mig 086): module opționale per restaurant (`restaurant_modules`, ex. rezervări) — tab-urile dispar când modulul e OFF.

## Fluxul central: comanda QR

```
Client scanează QR (masă) → QrMenuPage → start_table_session (token)
  → create_order RPC (validări: sesiune, plan, stoc, limite)
  → KDS (KitchenPage): new → confirmed → preparing → ready
  → WaiterPage: served → [Plan 2] closed | [Plan 3] paid (PayModal, split, tips)
Toate tranzițiile prin RPC advance_order (roluri + stare + plan verificate în DB).
```

## Unde stă ce (src/)

| Strat | Locație | Notă |
|---|---|---|
| Rute + landing + pricing | `App.tsx` | numele comerciale ale planurilor trăiesc aici + `features.ts` |
| Pagini | `pages/` | Dashboard (19 tab-uri, filtrate pe tier), Waiter, Kitchen, QrMenu (client), PublicMenu, Auth, Onboarding, Recrutare |
| Tab-uri dashboard | `components/*Tab.tsx` | lazy-loaded (jsPDF/recharts doar la click) |
| Logica de date | `lib/` | `orders.ts` (RPC wrappers), `features.ts` (plan gating), `offlineSync.ts` (ospătari offline) |
| State | `contexts/` (Auth, Restaurant) + `hooks/` | `useOrders` = realtime + polling fallback + optimistic advance |

## Migrațiile (88) — grupate pe „de ce", nu pe număr

| Grup | Migrații | Povestea |
|---|---|---|
| Fundație | base, 001–008 | tabele, RLS inițial, create_order v1 |
| Hardening securitate | 011–015, 035, 046–048, 056 | audituri repetate: REVOKE-uri, advisory locks, rewrite create_order |
| Feature-uri operare | 016–024 (waiter calls, split bill, floor plan, push, alergeni), 057–058 (rezervări), 036+077 (happy hour) | creșterea produsului |
| Fiscal & bani | 027–033 (TVA, bridge, discounts, cash shifts, rapoarte), 041 (Oblio), 050–053 (4 runde fix fiscal payload), 045 | cel mai patch-uit domeniu — normal, e cel mai sensibil |
| Growth/ops intern | 037 (leads), 039–040, 060–061 (alerting, winback), 044 (audit log), 042 (GDPR) | nu ating produsul de la masă |
| Taxonomie planuri | 062, 068, 071, 028 | nașterea plan_features |
| Quality pass comenzi | 059, 063–066, 069, 072–076, 078–082 | bug-uri reale găsite în folosință: race-uri, RLS pe rezervări, optimistic lock |
| **Porțile A–D (monetizare)** | **083–088** | gating server-side pe plan; 088 repară 5 bug-uri din 084 care blocau comanda QR |

Lecția lanțurilor „fix-for-fix" (050→053, 084→088): domeniile fiscal și ordering
se schimbă DOAR cu testul de migrații din CI (job „Apply all migrations", Gate B+ assertions).

## Datorii cunoscute (de atacat separat, nu „rescriere")

1. **E2E roșu cronic în CI** — lipsesc secrets (`VITE_SUPABASE_URL/ANON_KEY`, `E2E_EMAIL/PASSWORD`) + seed `tinctura` într-un Supabase de staging. Până la fix, Playwright e zgomot ignorat.
2. **Plan legacy `business`** — mai există în `PLAN_LABELS`; de migrat conturile vechi și șters.
3. **`docs/` nesincronizat** — AUDIT.md și ITER10-CHANGELOG reflectă stadii vechi.
4. **Numerotare migrații cu găuri** (009-010, 067, 070 lipsă) — istoric, inofensiv, nu „repara".
5. **Stripe checkout** — `onCheckout` există; de verificat alinierea prețurilor cu noua taxonomie la activare.

## Cum rulezi / verifici

- Dev: `npm run dev` · Teste: `npm run test` · E2E local: `npm run test:e2e`
- Migrații noi: fișier nou în `supabase/migrations/` (NU edita migrații aplicate) → CI le aplică pe Postgres efemer → apoi manual în Supabase SQL Editor, în ordine.
- Orice feature cu bani: întreabă întâi „e tier 3?" — dacă da, gate în RPC, nu doar în UI.
