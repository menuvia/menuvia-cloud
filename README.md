# Menuvia Cloud

SaaS HoReCa pentru cafenele și restaurante RO.

## Stack
- React 18 + TypeScript + Vite
- Supabase (Postgres + Auth + Realtime + Storage)
- Stripe (abonamente prin Checkout/Billing Portal; Connect pentru plata online la masă)
- Netlify Functions + Cron (janitorii pur-SQL rulează pe pg_cron, în Supabase)
- OpenAI (AI import meniu din poze, `PLATFORM_OPENAI_KEY`; chei BYO per restaurant prin `ai-config`)
- Oblio (e-Factura RO)

## Quickstart

```bash
npm install
cp .env.example .env  # configurează VITE_SUPABASE_URL, etc.
npm run dev
```

## Comenzi

```bash
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright E2E
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format        # Prettier (doar src/)
npm run check-all     # typecheck + lint + format:check + test (fără E2E și build)
npm run build         # production build
```

## Migrații Supabase

În `supabase/migrations/`, aplicate în ordinea numelor de fișier (prefixul de
timp). Migrațiile aplicate nu se editează: o schimbare = fișier nou.

```bash
# Replay complet + asserțiile SQL din CI, pe un Postgres efemer local
bash scripts/verify-migrations-local.sh

# Un proiect Supabase nou (sau stack-ul local)
supabase db push
```

Pe producție nu se rulează SQL de mână: după merge pe `main` cu CI verde,
`.github/workflows/apply-prod-migrations.yml` aplică migrațiile (backup +
repetiție pe o copie, apoi porțile read-only). Procedura și pauza:
`docs/RUNBOOK.md` §6.5. Harta sistemului: `ARCHITECTURE.md`.
