# Menuvia v1.5.0 — Tooling + GDPR foundation

## ✨ Tooling nou (`6.7/10 → 7.8/10` pe stack)

- **Vitest** cu 86 unit tests pe lib/ + schemas/
- **Zod schemas** centralizate (`src/schemas/`) — single source of truth client+server
- **TanStack Query** (`src/lib/queryClient.ts` + exemplu refactor `useOrdersQuery.ts`)
- **PostHog** GDPR-compliant cu consent gating (`src/lib/analytics.ts`)
- **Prettier + Husky + lint-staged** — format automat pre-commit
- **Renovate** — auto-merge patch-uri securitate
- **GitHub Actions** — lint + typecheck + format + test + build pe PR

## 🔒 GDPR fixes (blocker → legal)

- ✅ Sentry config cu `sendDefaultPii: false` + `beforeSend` filter
- ✅ Sentry + PostHog inițializează DOAR cu consent (`hasConsent('performance')`)
- ✅ Eliminat `console.log` cu PII din `recrutare-contact.js`
- ✅ CORS strict pe `recrutare-contact.js` (ALLOWED_ORIGINS) în loc de `*`
- ✅ Cookie banner GDPR cu 3 categorii (necesare/performance/funcționale)
- ✅ LegalFooter pe toate paginile publice cu link-uri Termeni/Privacy/Cookies/DPA/ANPC/SOL
- ✅ Pagini placeholder pentru documente legale (rute `/termeni`, `/confidentialitate`, `/cookies`, `/dpa`)
- ✅ Migration 042: `export_user_data()` + `request_account_deletion()` + `cancel_deletion_request()` + audit `terms_accepted_at/version`

## 📋 De aplicat manual

1. **Înregistrare SRL** — vezi `menuvia-pack/00-PLAN-SAPTAMANA-1.md`
2. **Pachet legal avocat** (~1.500 lei) — vezi `menuvia-pack/01-BRIEF-AVOCAT.md`
3. **Înlocuire content placeholder** în `LegalPage.tsx` cu documentele finale de la avocat
4. **Rulare migrație** `supabase/migration-042-gdpr-rpcs.sql` pe production
5. **Setup PostHog** — vezi `README-UPGRADE.md`
6. **Setup Husky** — `npx husky init` după `npm install`

## 🧪 Verificare

```bash
npm install
npm run test          # → 86 passed
npm run typecheck     # → zero erori
npm run build         # → production bundle OK
```
