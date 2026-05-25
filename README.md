# Menuvia Cloud

SaaS HoReCa pentru cafenele și restaurante RO.

## Stack
- React 18 + TypeScript + Vite
- Supabase (Postgres + Auth + Realtime + Storage)
- Stripe Connect + Tax
- Netlify Functions + Cron
- Anthropic Claude (AI import meniu)
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
npm run format        # Prettier
npm run check-all     # toate de mai sus
npm run build         # production build
```

## Migrații Supabase

În `supabase/migrations/`. Aplică în ordine numerică:

```bash
# Local cu Supabase CLI
supabase db push

# Production: prin SQL Editor în Dashboard
```
