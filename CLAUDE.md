# CLAUDE.md — reguli de lucru în repo-ul Menuvia

Citește întâi `ARCHITECTURE.md` (harta sistemului în 1 pagină).

## Reguli nenegociabile

1. **Regula de aur:** bani + bon fiscal = Plan 3 (`pro`/`enterprise`), fără excepții.
   Orice feature care atinge plăți/bon/TVA se gate-uiește **în RPC/RLS**, nu doar în UI.
2. **Migrațiile aplicate nu se editează.** Schimbările = fișier nou în
   `supabase/migrations/`. CI-ul („Apply all migrations") le rulează pe Postgres
   efemer cu asserțiuni pe fluxul de comandă — trebuie să treacă înainte de push.
3. **Planul aparține restaurantului, nu user-ului.** Pentru gating în UI folosește
   `useFeatures(restaurantId)` → `planTier()` din `src/lib/features.ts`,
   NU `profile.plan` (greșit pentru staff).
4. **Numele comerciale** (Meniu Digital / Meniu + Comenzi / Fiscalizare) doar în UI;
   intern și în DB rămân `free/starter/growth/pro/enterprise`.

## Convenții cod

- TypeScript strict, **fără `any`**. Stiluri inline cu tokens din `D` (`lib/constants.ts`) — nu există Tailwind.
- Comentarii și UI în română; cod (identificatori) în engleză.
- ESLint `--max-warnings 0` e blocking; prettier `format:check` e advisory.
- Tab-urile mari din dashboard sunt lazy-loaded — păstrează pattern-ul.

## Verificare înainte de push

`npm run typecheck && npm run lint && npm run test` (build-ul cere env vars placeholder — vezi `.github/workflows/test.yml`).
Playwright E2E e cronic roșu în CI (secrets lipsă — vezi „Datorii" în ARCHITECTURE.md); nu-l trata ca regresie a ta fără dovadă.

## Capcane cunoscute

- `advance_order` există în mig 085 ȘI 087 (copie sincronizată + gate) — modifici întâi 085, oglindești în 087.
- `PLAN_LABELS` (constants) și `PLAN_NAMES` (features) sunt ambele nume de planuri — ține-le sincronizate.
- Comanda QR cere sesiune de masă (mig 088): `qr` fără `session_id` = respins server-side.
- **Authorization lockdown (mig 096A/B/C).** Mutațiile pe `public.restaurant_memberships` sunt gate-uite de `trg_enforce_owner_membership_invariant` (CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED). Fires la COMMIT și respinge orice stare finală fără exact 1 owner membership aliniat cu `restaurants.owner_id`. Tranzitul intra-tx e permis; corectitudinea la COMMIT e obligatorie.
- **owner_id e imuabil.** Modificarea `restaurants.owner_id` e blocată de `trg_restaurants_owner_id_immutable` (BEFORE UPDATE pe rând). Singura cale autorizată: `scripts/apply_ownership_remediation.sql` — DISABLE/ENABLE per-trigger sub lock strict, fără `session_replication_role`.
- **slug routing.** Schimbarea `restaurants.slug` trece exclusiv prin RPC-ul `change_restaurant_slug` (UPDATE column-level pe `slug` e revocat). `RESTAURANT_UPDATE_FIELDS` (în `src/lib/sanitize.ts`) NU mai conține `slug` — `useRestaurants.update()` filtrează tăcut payload-uri care încearcă să-l trimită.
- **7 RPC-uri SECURITY DEFINER pe acest lockdown**: `preview_invite`, `accept_invite`, `create_restaurant`, `change_member_role`, `remove_member`, `revoke_invite`, `change_restaurant_slug`. Toate returnează `jsonb`, au `search_path = public, pg_temp`, PUBLIC zero EXECUTE. Orice RPC nou pe această suprafață trebuie să respecte aceeași convenție.
- **Funelul de autorizare `is_admin`/`is_member`/`my_role`** (mig 096a) a fost extins EXACT de două ori: `or is_platform_admin()` (mig 186) și `or has_partner_access()` (mig 187). Orice recreare viitoare a trio-ului trebuie să păstreze AMBELE escape-uri (mig 187 are asserție anti-regresie) — pierderea lor rupe founder dashboard-ul și accesul partenerilor peste tot.
- **`has_partner_access` cere atribuire ne-terminală** (mig 193): `canceled/refunded/expired` NU dau acces. Filtrul e oglindit în `list_partner_restaurants` — dacă modifici unul, modifică-le pe ambele, altfel panoul afiliatului listează restaurante pe care RLS-ul le respinge.
- **`update_order_items` are lanț lung de redefiniri** (079→080→081→082→146→184→192) fără twin de sincronizat; `create_order` are ultima definiție în mig 145 (+ guard grup în 191). Ambele au guard de minim per grup cu hint `missing_required_group`, acoperit permanent de `tests/sql/order_group_min_assertions.sql` în CI.
- **`affiliate_payouts.wise_transfer_id` e BIGINT** (mig 098), iar parametrul RPC-urilor e text — conversia se face validat în corp (mig 193). `coalesce(text_param, bigint_col)` direct în UPDATE nici măcar nu se planează: RPC-ul moare la ORICE apel (bug reparat o dată; nu-l reintroduce).
- **Comisioanele afiliaților se citesc LIVE** din `affiliates.*_bps` la fiecare `invoice.paid` (mig 099) — editarea din FounderPage are efect imediat. Defaults-urile stau în `platform_settings` (mig 188, founder-only); public se expun DOAR setup/recurring/cap prin `get_affiliate_public_defaults` (mig 189) — niciodată `cascade_bps`.
- **Mod founder/partener (frontend)**: cheile `menuvia_founder_view` + `menuvia_founder_view_from` (localStorage) prin `lib/founder.ts`. RestaurantContext injectează membership sintetic 'manager' doar dacă SELECT-ul RLS trece; erorile Supabase vin în `{error}` (supabase-js NU aruncă) — nu trata `data:null` de la un blip de rețea drept „fără drepturi" (curăță cheia doar pe răspuns valid cu zero rânduri).
- **Funcțiile noi primesc `search_path` din start** — mig 194 a reparat retroactiv 14 funcții vechi; advisor-ul `function_search_path_mutable` nu trebuie să mai crească.
