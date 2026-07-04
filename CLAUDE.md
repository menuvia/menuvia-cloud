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
- **Platform admins self-healing** (mig 195): trigger `trg_seed_platform_admin` pe `profiles` setează `is_platform_admin=true` pentru emailurile fondatoare (georgeradu119 + georgeradu004) la INSERT/UPDATE — repară capcana din mig 168 (seed pierdut dacă contul nu exista încă). Lista de emailuri e în `fn_seed_platform_admin`.
- **`create_reservation_public` are lanț de redefiniri** (151→199→201), FĂRĂ twin de sincronizat, dar orice recreare TREBUIE să păstreze TOATE: 10 argumente cu `p_table_id uuid` (mig 199, branch race-safe sub `pg_advisory_xact_lock`, hint `table_unavailable`), plafonul de durată `least(...reservation_duration)` (mig 151), gate-ul `is_module_enabled('reservations')`, și logica wrap-around pentru program peste miezul nopții (mig 201: fereastra validă când `close_time <= open_time` e `[open,24:00) ∪ [00:00,close)`). Mig 201 are asserție fail-closed pe `close_time <= v_settings.open_time`.
- **RPC-urile publice de rezervare-cu-hartă** (`get_public_floor_plan`, `get_tables_availability`, mig 199) sunt gate-uite de modul (mig 200: null / `raise module_disabled` dacă `reservations` e OFF — default OFF). SECURITY DEFINER, `search_path=public,pg_temp`, grant anon+authenticated. Client-side, `fetchTablesAvailability` (qr.ts) ARUNCĂ pe eroare (nu `[]`) — `ReservationSheet` se bazează pe asta ca `.catch`-ul să seteze `mapError`.
- **Meniu multilingv** (mig 197): `products.translations`/`categories.translations` (jsonb) + `restaurants.menu_languages` (jsonb). `restaurants` e column-gated → coloana nouă a cerut `grant update (menu_languages) ... to authenticated` (ca la slug). `RESTAURANT_UPDATE_FIELDS` (sanitize.ts) + testul JS + whitelist-ul SQL F6 din `tests/sql/authorization_final_state_assertions.sql` trebuie sincronizate (4 locuri).
- **i18n meniu = `T(lang, key)` pe `PUBLIC_MENU_STRINGS`** (constants.ts): suportă acum 7 limbi (ro/en/de/fr/it/hu/es) — ORICE cheie nouă TREBUIE să aibă TOATE cele 7 câmpuri (altfel `T` întoarce `undefined` la runtime). Limbă nesuportată → fallback EN. `availableMenuLangs(categories, allowed?)` intersectează cu `restaurant.menu_languages` doar când lista e ne-vidă (fără regresie pe localuri neconfigurate). Chrome-ul urmează limba ALEASĂ (`menuLang`) când e non-RO, nu `restaurant.language`.
- **Idempotența comenzii QR se rotește pe SUCCES** (`QrMenuPage.tsx`, `rotateIdempotencyKey` după `createOrder` reușit), nu doar la reset — altfel un refresh/back pe mobil retrimite o comandă nouă cu cheia veche → dedup server → confirmare veche, venit pierdut tăcut. `createOrder` (orders.ts) aruncă un `Error` real (nu obiectul Supabase brut) ca hint-urile de business (`missing_required_group`) să ajungă la client.
- **`useRestaurants.load()` (useData.ts) nu colapsează la listă goală pe eroare**: dacă interogarea `owned` eșuează → setează eroare, nu `[]` (altfel un owner ajunge fals la Onboarding pe un blip de rețea). Reminderele de rezervare (send-reservation-reminders.js) resetează `reminder_sent_at=NULL` pe eșec de enqueue (altfel se pierd permanent). Emailurile Resend folosesc `Idempotency-Key` din `email.id` (dedup real vs. reclaim mig 167).
- **ai-proxy — base_url `custom` se re-validează la fetch** (assertSafeBaseUrl în `callOpenAI`, imediat înainte de fetch, fără await intermediar) + redirect blocking; reziduu documentat: pinning IP complet cere `undici` (nu e dependență). `oblio-generator` derivă `vatName` din procent (19/21→Normala, 9/5/11→Redusa, 0→SFDD) — NU hardcoda 'Normala'.
- **Panou „Stadiu mese"** (`TableStatusBoard.tsx` + `TableStatusMap.tsx`, comutabil în `WaiterPage`, gate `paymentsEnabled = planTier ≥ 3`): agregă LIVE din comenzile deschise (`useOrders`, realtime) + `waiterCalls`, FĂRĂ migrație/RPC nou. Ocuparea se derivă pe `table_id` (acoperă QR + ospătar uniform), nu pe `table_sessions` (care e populat doar de QR). Modul „Hartă" refolosește `floor_layout` + `resolveTableId`/canvas din `lib/floorPlan` (aceleași coordonate ca editorul), colorat pe 5 stări de staff cu tokenii D (NU paleta publică PUB ca `FloorPlanViewer`). Cardul de masă e `BoardTableCard`, refolosit de grilă ȘI de detaliul de sub hartă. „+ Adaugă la masă" trece prin `WaiterEntry` cu prop `initialTableId` (rundă nouă pe aceeași masă). `WaiterPage` fetch-uiește `restaurants.floor_layout` (`maybeSingle`, cast validat cu `Array.isArray(floors)`).
- **Capcană JSX: un `"` DREPT într-un atribut JSX `attr="..."` sparge build-ul** (`Unterminated string literal`, TS1002/1003) — string-urile RO conțin des `"`/„…". Când un atribut (aria-label/title/placeholder/description) conține `"`, folosește `attr={'...'}` (expresie cu ghilimele simple) sau backtick, NU ghilimele curbe într-un `"..."`. `tsc` prinde, dar preview-ul Netlify pică rapid — semnal de eroare TS reală.
- **`get_order_audit_history` (orders.ts) aruncă un `Error` real** (nu PostgrestError brut) — altfel `OrderAuditSheet`, care testează `e instanceof Error`, cade pe „Eroare la încărcare" generic și ascunde cauza (funcție nedeployată / permisiune). Păstrează `err.code` pentru diagnoză. Același pattern ca `createOrder`.
