# Mutarea frontendului pe Cloudflare Pages (runbook)

**Scop:** servim SPA-ul static de pe Cloudflare Pages (CDN edge gratuit, rapid la
scanarea QR de la masă) și oprim factura de bandwidth Netlify — **fără** să
atingem cele 22 de funcții Node + cron-urile, care rămân pe Netlify.

**Ce e deja pregătit în repo (nu mai ai de făcut cod):**

1. **Apeluri de funcții portabile.** Toate cele 8 locuri din frontend care chemau
   `/.netlify/functions/*` trec acum prin `fnUrl()` (`src/lib/fn.ts`). Default =
   `/.netlify/functions/<name>` → **comportament identic pe Netlify azi**.
   Overridabil prin env-ul `VITE_FUNCTIONS_BASE`.
2. **Proxy Cloudflare.** `functions/_fn/[[name]].js` proxează transparent
   `/_fn/<name>` → funcțiile Netlify. Netlify îl ignoră complet (Vite/Netlify nu
   ating folderul `functions/` de la rădăcină); doar Cloudflare Pages îl folosește.

Arhitectura după mutare:

```
Client ──► Cloudflare Pages (SPA static + CDN edge)
             │  /_fn/*  ──proxy──►  Netlify (.netlify/functions/*  +  cron-uri)
             └► Supabase Cloud (DB/Auth/Storage/Realtime)  ◄── funcțiile Netlify
```

Frontend-ul rămâne same-origin (cheamă `/_fn/...` pe Cloudflare) → **fără CORS**.

---

## Pași manuali (au nevoie de contul tău Cloudflare + DNS) — ~15 min

### 1. Creează proiectul Cloudflare Pages
- Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
- Alege repo-ul `menuvia/menuvia-cloud`, branch `main`.
- **Build settings:**
  - Framework preset: **None** (sau Vite)
  - Build command: `npm run build`
  - Build output directory: `dist`
  - Node version: `20` (variabilă `NODE_VERSION=20`)

### 2. Variabile de mediu în Cloudflare Pages
`Settings → Environment variables` (Production **și** Preview):

| Variabilă | Valoare |
|---|---|
| `VITE_FUNCTIONS_BASE` | `/_fn` |
| `NETLIFY_FN_ORIGIN` | `https://menuvia.netlify.app` (sau domeniul Netlify curent) |
| `VITE_SUPABASE_URL` | (aceleași ca pe Netlify) |
| `VITE_SUPABASE_ANON_KEY` | (aceleași ca pe Netlify) |
| `VITE_APP_URL` | `https://<domeniul-tău-final>` |
| *(orice alt `VITE_*` din Netlify)* | copiază-le |

> ⚠️ Copiază TOATE variabilele `VITE_*` din Netlify → Cloudflare, altfel build-ul
> iese fără config. Cele fără prefix `VITE_` (secrete de funcții: `STRIPE_*`,
> `SUPABASE_SERVICE_ROLE_KEY`, `OBLIO_*`, `SMSO_*`, `PLATFORM_OPENAI_KEY` etc.)
> **rămân doar pe Netlify** — funcțiile trăiesc acolo.

### 3. SPA fallback + headere (fișiere în `dist/`)
Cloudflare Pages are nevoie de un `_redirects` pentru rutarea SPA. Adaugă în
`public/_redirects` (Vite îl copiază în `dist/`):

```
/*    /index.html   200
```

Pentru headere de securitate (echivalent cu netlify.toml, grad A+), adaugă
`public/_headers`:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Cross-Origin-Opener-Policy: same-origin-allow-popups
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

> Aceste 2 fișiere sunt inofensive și pentru Netlify (valori echivalente cu
> netlify.toml), dar le adaugi DOAR când faci cutover-ul, ca să nu dublezi acum
> config-ul pe Netlify. (Copiază blocul CSP din `netlify.toml` dacă vrei paritate
> completă.)

### 4. Domeniul
- În Cloudflare Pages → **Custom domains** → adaugă domeniul tău.
- Dacă domeniul e deja pe Cloudflare (DNS): un click, se configurează singur.
- Dacă nu: adaugă un `CNAME` de la domeniu → `<proiect>.pages.dev`.
- Netlify **rămâne** pe subdomeniul lui (`menuvia.netlify.app`) — e ținta proxy-ului
  pentru funcții. NU-l șterge.

### 5. Verificare (obligatoriu înainte de a muta DNS-ul pe producție)
Pe URL-ul de preview `*.pages.dev` (înainte de cutover-ul domeniului):
- [ ] Meniul public `/m/:slug` și `/q/:token` se încarcă (static + Supabase).
- [ ] Login funcționează (`/auth`) → dashboard.
- [ ] **Un apel de funcție prin proxy**: ex. deschide „Facturare" (cheamă
      `/_fn/stripe-portal`) sau trimite o invitație de echipă (`/_fn/send-invite`).
      Verifică în Network tab că `/_fn/...` întoarce 200 (nu 404) — asta confirmă
      că proxy-ul Cloudflare → Netlify merge.
- [ ] O comandă de test la masă cu plată online (`/_fn/table-payment`).

Abia după ce toate trec pe `*.pages.dev`, muți domeniul de producție.

### 6. Rollback (instant)
Dacă ceva nu merge: muți DNS-ul înapoi pe Netlify. Netlify n-a fost atins —
frontend-ul cu `VITE_FUNCTIONS_BASE` gol (default) cheamă din nou
`/.netlify/functions/*` same-origin. Zero pierdere.

---

## De ce așa (rezumat pentru viitor)
- **DB rămâne pe Supabase Cloud** (backup PITR, zero ops) — nu se atinge.
- **Funcțiile + cron-urile rămân pe Netlify** (free tier) — zero portare de cod.
- **Doar staticul se mută pe Cloudflare** (gratuit, edge) — de-aici vine economia.
- Când funcțiile Netlify încep să coste (zeci de restaurante, cron-uri dese),
  muți `NETLIFY_FN_ORIGIN` spre VPS-ul Hetzner (shim-ul din `deploy/` rulează
  funcțiile nemodificate) — iar tot ce schimbi e o variabilă de env. Vezi
  `docs/VPS_RUNBOOK.md`.
