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
