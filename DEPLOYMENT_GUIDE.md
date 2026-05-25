# Menuvia — Ghid complet de deployment

## Arhitectura sistemului

```
Browser (React + Vite)
    ↓ HTTPS
Netlify (hosting + serverless functions)
    ↓ SDK
Supabase (Postgres + Auth + Realtime + Storage)
    ↓ Email
Resend (invite + welcome emails)
    ↓ AI
Anthropic API (import meniu din foto)
```

---

## 1. Supabase — setup

### 1a. Creează proiectul
- supabase.com → New project
- Regiune: **eu-central-1** (Frankfurt — latență mică pentru România)
- Salvează credențialele imediat:
  - `Project URL` → `VITE_SUPABASE_URL`
  - `anon/public key` → `VITE_SUPABASE_ANON_KEY`
  - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ secret, nu în client)

### 1b. Rulează migrațiile SQL
Du-te la **SQL Editor** și rulează în această ordine exactă:

```
1. supabase/schema.sql
2. supabase/migration-001-tables-qr.sql
3. supabase/migration-002-modifiers.sql
4. supabase/migration-003-orders-fixed.sql
5. supabase/migration-004-members-fixed.sql
6. supabase/migration-005-rls-fixed.sql
7. supabase/migration-006-create-order-rpc.sql
8. supabase/migration-007-extensions-views-invites.sql
9. supabase/migration-008-rls-audit-fixes.sql
```

**Nu sări** nicio migrație și **nu schimba ordinea** — există dependențe între ele.

### 1c. Activează Realtime
**Dashboard → Database → Replication → Tables**
Activează replicarea pentru tabelul: `orders`

Fără asta, KitchenPage și WaiterPage nu primesc update-uri live.

### 1d. Configurează Auth (opțional dar recomandat)
**Dashboard → Authentication → Email Templates**
- Personalizează template-ul de confirmare cu brandul Menuvia
- Sau dezactivează "Confirm email" pentru development rapid (Settings → Auth)

---

## 2. Resend — email transacțional

- resend.com → create API key
- Verifică domeniul tău de email (ex: menuvia.ro) pentru deliverability bună
- Salvează: `RESEND_API_KEY`

---

## 3. Anthropic — AI import meniu

- console.anthropic.com → API Keys → Create key
- Salvează: `ANTHROPIC_API_KEY`

---

## 4. Netlify — hosting

### 4a. Conectează repo-ul
- netlify.com → Add new site → Import from Git
- Sau drag & drop folderul `dist/` după `npm run build` local

### 4b. Build settings
```
Build command:   npm run build
Publish dir:     dist
Node version:    18
```

### 4c. Environment variables
**Site settings → Environment variables → Add variable**

```
# Client (prefix VITE_ = expuse în browser)
VITE_SUPABASE_URL           = https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY      = eyJhbGciOi...
VITE_APP_URL                = https://menuvia.netlify.app  ← sau domeniu custom

# Server-only (Netlify Functions — nu sunt expuse în browser)
SUPABASE_URL                = https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY   = eyJhbGciOi...
RESEND_API_KEY              = re_...
ANTHROPIC_API_KEY           = sk-ant-...
```

⚠️ `VITE_APP_URL` trebuie să fie URL-ul final al aplicației (fără `/` la final).
  Toate QR-urile generate vor conține acest URL.

### 4d. Trigger deploy
Orice push pe `main` va re-deploya automat.

---

## 5. Domeniu custom (opțional)

- Netlify → Domain management → Add custom domain
- Adaugă un record `CNAME` la DNS-ul tău
- Netlify provizionează SSL automat (Let's Encrypt)

---

## 6. Smoke test complet după deploy

Rulează acest flow în ordine:

```
[ ] 1. Sign up cu un email nou → primit email de confirmare?
[ ] 2. Confirmare email → redirect la dashboard?
[ ] 3. Onboarding → creează restaurant "Test" → salvat?
[ ] 4. Adaugă 2-3 mese în TablesManager → QR-urile se generează local?
[ ] 5. Scanează QR de pe telefon → se deschide meniul public?
[ ] 6. Plasează comandă din meniu QR → apare în KitchenPage în timp real?
[ ] 7. Avansează comanda Nou → Confirmat → Preparare → Gata în Kitchen
[ ] 8. WaiterPage vede comanda ca "Gata de servit"?
[ ] 9. Marchează comanda ca Servit → Plătit
[ ] 10. Dashboard → Analytics → apar datele comenzii?
[ ] 11. Echipă → trimite invitație ospătar → primit email?
[ ] 12. Click link invitație → setează parolă → redirect la /waiter?
[ ] 13. Download PDF QR → se generează corect fără erori?
```

---

## 7. Invitare staff

1. **Dashboard → Echipă → Adaugă membru**
2. Introdu email + selectează rol (Ospătar / Bucătărie / Manager)
3. Staff primește email cu link de invitație (expiră în 7 zile)
4. Click link → setează parolă → redirect automat:
   - `kitchen` → `/kitchen`
   - `waiter` → `/waiter`
   - `manager` → `/dashboard`

---

## 8. Probleme frecvente

| Simptom | Cauză | Fix |
|---------|-------|-----|
| Build pică cu `Cannot find module 'qrcode'` | `node_modules` nu e instalat | `npm install` |
| KitchenPage nu primește comenzi live | Realtime dezactivat | Activează tabelul `orders` în Supabase Replication |
| Invitație dă eroare după creare cont | Email confirmation activ | Dezactivează în Supabase Auth Settings sau gestionează flow-ul |
| QR-urile nu se scanează | `VITE_APP_URL` greșit | Setează URL-ul exact al aplicației deploy-uite |
| Manager vede onboarding în loc de dashboard | Vechi useRestaurants fără membership join | Asigură-te că ai versiunea v1.1.0+ |
| `npm run lint` pică | `.eslintrc.cjs` lipsă | Prezent în v1.1.0+ |

---

## 9. Development local

```bash
# 1. Instalează dependențele
npm install

# 2. Copiază .env
cp .env.example .env.local
# Editează .env.local cu credențialele tale de dev Supabase

# 3. Pornește dev server
npm run dev
# → http://localhost:5173

# 4. Build și preview
npm run build
npm run preview
```

---

## 10. Structura proiectului

```
src/
├── contexts/
│   ├── AuthContext.tsx          # User auth state
│   └── RestaurantContext.tsx    # Active restaurant pentru Kitchen/Waiter
├── hooks/
│   ├── useData.ts               # Restaurants, categories, products
│   └── useOrders.ts             # Orders cu Realtime
├── pages/
│   ├── AuthPage.tsx             # Login/signup cu email confirm handling
│   ├── DashboardPage.tsx        # Owner/manager dashboard
│   ├── KitchenPage.tsx          # Kanban bucătărie (Realtime)
│   ├── WaiterPage.tsx           # View ospătar (Realtime)
│   ├── OnboardingPage.tsx       # Setup restaurant nou
│   ├── PublicMenuPage.tsx       # Meniu public /m/:slug
│   ├── QrMenuPage.tsx           # Meniu la masă /q/:token
│   └── InviteAcceptPage.tsx     # Accept invitație staff
├── components/
│   ├── AnalyticsTab.tsx         # Charts (Pro/Business only)
│   ├── TablesManager.tsx        # Mese + QR local + PDF export
│   ├── TeamManager.tsx          # Invitații staff
│   └── WaiterEntry.tsx          # Comandă nouă din WaiterPage
└── lib/
    ├── supabase.ts              # Client Supabase
    ├── orders.ts                # Types + helpers comenzi
    └── constants.ts             # Colors, roles, config

netlify/functions/
├── ai-import.js                 # Claude Haiku — parsare meniu din foto
├── send-invite.js               # Resend — email invitație staff
└── welcome-email.js             # Resend — email bun venit

supabase/
├── schema.sql                   # Tabele principale
└── migration-001 → 007          # Migrații incrementale
```
