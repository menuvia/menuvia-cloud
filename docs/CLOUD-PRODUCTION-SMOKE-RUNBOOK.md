# Cloud Production Smoke Runbook

Checklist scurt pentru validarea unui deploy nou pe `menuvia.netlify.app`
(sau orice subdomain Netlify). Rulează-l end-to-end după fiecare merge în
`main` și după fiecare migrație Supabase aplicată în production.

Timp estimat: **5-7 minute**.

---

## 0. Pre-requisite

- Acces la Netlify Dashboard pentru proiectul `menuvia` (rol Developer+).
- Acces la Supabase Dashboard pentru proiectul de producție.
- Cont demo de test pe domeniul de producție (creează unul dacă nu există).
- Tab incognito în browser (evită cache de service worker).

---

## 1. Netlify deploy — verde end-to-end

1. Deschide Netlify Dashboard → proiectul `menuvia` → **Deploys**.
2. Verifică ultimul deploy:
   - Status: **Published** (verde). Nu Failed, nu Building.
   - Branch: `main` (sau branch-ul așteptat).
   - Commit hash: să corespundă cu HEAD-ul de pe GitHub.
3. Click pe deploy → **Deploy log** → verifică:
   - `npm install` fără erori.
   - `vite build` fără erori și fără warnings de tip "Cannot resolve".
   - "Site is live ✓" la sfârșit.
4. Click pe **Functions** → toate funcțiile listate sunt **Healthy** (status 200 la ultimul invoke, dacă există).

**Dacă pică:** vezi §10 (rollback).

---

## 2. Env vars Netlify — obligatorii prezente

Netlify Dashboard → **Site settings** → **Environment variables**. Trebuie să existe (valori reale, nu placeholders):

### Frontend (build-time, prefix `VITE_`)

| Cheie                    | Așteptat                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | `https://*.supabase.co`                                                      |
| `VITE_SUPABASE_ANON_KEY` | JWT format `eyJ...`                                                          |
| `VITE_APP_URL`           | domeniul public (ex. `https://menuvia.netlify.app` sau `https://menuvia.ro`) |
| `VITE_SENTRY_DSN`        | DSN Sentry valid (opțional dar recomandat)                                   |
| `VITE_VAPID_PUBLIC_KEY`  | dacă PWA push-uri sunt active                                                |

### Server-side (Netlify Functions)

| Cheie                                                    | Așteptat                                    |
| -------------------------------------------------------- | ------------------------------------------- |
| `SUPABASE_URL`                                           | identic cu `VITE_SUPABASE_URL`              |
| `SUPABASE_SERVICE_ROLE_KEY`                              | JWT format `eyJ...` (service_role, NU anon) |
| `STRIPE_SECRET_KEY`                                      | `sk_live_*` în prod, `sk_test_*` în staging |
| `STRIPE_WEBHOOK_SECRET`                                  | `whsec_*`                                   |
| `STRIPE_PRO_PRICE_ID`                                    | `price_*`                                   |
| `RESEND_API_KEY`                                         | `re_*` (dacă welcome-email e activ)         |
| `ANTHROPIC_API_KEY`                                      | `sk-ant-*` (dacă ai-import e activ)         |
| `WEBHOOK_SECRET`                                         | secret aleatoriu (vezi `.env.example`)      |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_EMAIL` | dacă push-uri sunt active                   |

**Validare locală a template-ului** (verifică doar că `.env.example` documentează cheile critice frontend, nu citește valori):

```bash
npm run check:env-template
```

Trebuie să returneze `✓` cu exit 0.

**Dacă pică:** completează env-ul lipsă în Netlify Dashboard, apoi **Trigger redeploy** (doar redeploy, nu rebuild — env-ul se aplică imediat).

---

## 3. Supabase GRANT-uri — sanity check SQL

Supabase Dashboard → **SQL Editor** → execută secțiunile din
[`SUPABASE-GRANTS-VERIFICATION.sql`](./SUPABASE-GRANTS-VERIFICATION.sql).

Verificare rapidă inline:

```sql
SELECT grantee, privilege_type
FROM   information_schema.table_privileges
WHERE  table_schema='public'
  AND  table_name='restaurants'
  AND  grantee='authenticated'
ORDER  BY privilege_type;
```

**Așteptat:** exact 4 rânduri: `DELETE, INSERT, SELECT, UPDATE`.

Dacă apar 7 (cu REFERENCES/TRIGGER/TRUNCATE) → migrația `048` nu a fost aplicată. Rulează:

```bash
npx supabase db push
```

Dacă apare doar `SELECT` → migrația `047` nu a fost aplicată. Aceeași comandă.

**Migrațiile prezente:**

```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version IN ('20260525004500','20260525004600')
ORDER BY version;
```

Trebuie să apară 2 rânduri.

---

## 4. Onboarding restaurant — flow complet

Tab incognito → `https://menuvia.netlify.app/`.

1. **Signup** cont nou (email aleatoriu, ex. `smoke-$(date +%s)@example.com`).
2. Confirmă email-ul (dacă confirmation flow e activ; altfel proceed).
3. Pe `/dashboard`, **PAS 1**: configurează restaurantul:
   - Nume: `Smoke Test`.
   - Oraș: `București`.
   - URL: lasă auto-generat.
   - Click **Continuă**.
4. **Așteptat:** trece la PAS 2 fără eroare. Nu trebuie să apară mesaje raw Postgres (ex. `permission denied for table restaurants`).

**Dacă pică cu `permission denied`:** vezi §3 (granturile lipsă) și §10.

5. Completează PAS 2/3/4 cu valori dummy → onboarding done.

---

## 5. Login / Signup — round-trip

1. Logout din contul de la §4.
2. Re-login cu același email/parolă → trebuie să ajungă pe `/dashboard` în <2s.
3. Verifică în DevTools → Network că request-ul către `*/auth/v1/token?grant_type=password` returnează 200 cu un `access_token`.

**Edge case de testat o dată/lună:**

- "Forgot password" → trimite email reset. Verifică în Supabase Dashboard → Authentication → Users că ultimul tip de event apare.

---

## 6. Dashboard — primary actions

În contul logat (cel cu restaurant configurat la §4):

1. Click **Categorii** → adaugă o categorie nouă "Smoke". Trebuie să apară imediat.
2. Click **Produse** → adaugă un produs nou cu preț `12.50`. Trebuie să apară imediat.
3. Click **Mese** → adaugă o masă nouă "T1". Trebuie să apară imediat și să genereze QR code.
4. Verifică în DevTools → Console că nu apar erori roșii (warning-uri sunt acceptabile).

**Dacă pică:** verifică în Network tab — request-urile `POST` către `/rest/v1/*` trebuie să returneze 201/200. Dacă apare 403 cu `permission denied` → §3.

---

## 7. Public menu — anon flow

1. Copiază slug-ul restaurantului creat la §4 (ex. `smoke-test`).
2. Tab incognito **nou** → `https://menuvia.netlify.app/m/smoke-test`.
3. **Așteptat:** se încarcă pagina cu meniul (categoria "Smoke" + produsul de la §6 vizibile). În <3s pe conexiune normală.
4. DevTools → Network → verifică:
   - `/rest/v1/rpc/get_restaurant_by_slug` → 200.
   - `/rest/v1/categories?...` → 200 cu array (NU 401/403).
   - `/rest/v1/products?...` → 200 cu array.
5. Click pe un produs → ProductSheet se deschide.

**Dacă `/rest/v1/categories` returnează 401:** anon nu are SELECT pe `categories`. Vezi §3 (rulează verification §4 pe SQL).

---

## 8. Service worker / cache — refresh post-deploy

Service worker-ul cache-uiește build-uri vechi. După deploy nou:

1. Tab nou (poate fi non-incognito) → `https://menuvia.netlify.app/`.
2. DevTools → **Application** → **Service Workers**:
   - Verifică versiunea SW. Trebuie să fie cea din ultimul deploy.
   - Dacă nu, **Unregister** + **Update** + reload.
3. **Application** → **Storage** → **Clear site data** (doar la suspiciune; nu de rutină).
4. Lighthouse audit (opțional, lunar): PWA score >= 80, Performance >= 70 mobile.

**User-side fallback** dacă cineva raportează că vede UI vechi:

> "Ctrl+Shift+R (Cmd+Shift+R pe Mac) — hard refresh. Dacă persistă, deschide DevTools → Application → Clear site data."

---

## 9. CDN cache — Netlify edge

Dacă apar discrepanțe între users:

1. Netlify Dashboard → **Deploys** → ultimul deploy → **Options** → **Clear cache and retry deploy**.
2. Așteaptă build verde, apoi reia §1.

---

## 10. Rollback — loading infinit sau `permission denied`

### Simptom: loading infinit pe `/dashboard`

Cauze probabile (în ordine):

1. **Service worker vechi cache-uiește** un bundle care nu mai e compatibil cu API-ul actual.
   - Fix: instrucțiune utilizatori — hard refresh (Ctrl+Shift+R) + Clear site data.
2. **Supabase down** sau rate-limit.
   - Verifică status: https://status.supabase.com.
   - Verifică în Netlify Function logs dacă apare `503` sau timeout.
3. **Bundle DashboardPage.tsx prea mare** (4197 linii) — cold load lung pe conexiuni slabe.
   - Nu e bug, e perf. Acceptabil în smoke check.

### Simptom: `permission denied for table X`

1. Verifică imediat §3 (sanity SQL).
2. Dacă lipsesc 047/048 → `npx supabase db push` din mediu local cu credențialele Supabase prod.
3. **Nu** rezolva în production prin SQL ad-hoc din SQL Editor — aplică migrațiile prin CLI ca să rămână track-uite.

### Rollback deploy Netlify

1. Netlify Dashboard → **Deploys** → găsește ultimul deploy verde anterior celui defect.
2. **Publish deploy** (butonul cu trei puncte → "Publish deploy").
3. Validează cu §1 + §4.
4. **Reverti commit-ul defect** local + push → noul deploy va fi tot verde, dar pe codul stabil.

### Rollback migrație Supabase

Migrațiile 047/048 sunt pur aditive la GRANT (047 adaugă, 048 revocă privilegii admin nefolosite). **Nu există** rollback necesar dacă onboarding-ul merge.

Dacă chiar trebuie revert (ex. integrare third-party rupe):

```sql
-- Revert 048 (re-grant TRUNCATE/TRIGGER/REFERENCES):
GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO authenticated;

-- Revert 047: NU se poate face safe — granturile selective sunt pre-condiție
-- pentru toate operațiile autentificate. Lasă-l aplicat.
```

---

## 11. Acceptance criteria

Smoke check trece **doar dacă** toate de mai jos sunt true:

- [ ] §1 deploy verde, log curat
- [ ] §2 env vars frontend + server prezente
- [ ] §3 query returnează 4 rânduri pentru `restaurants` (CRUD strict)
- [ ] §4 onboarding pas 1 trece fără `permission denied`
- [ ] §5 login round-trip <2s
- [ ] §6 add categorie/produs/masă fără 403
- [ ] §7 public menu se randează în <3s în incognito
- [ ] §8 SW actualizat la build-ul curent
- [ ] zero erori roșii în Console pe orice pagină testată

Dacă **oricare** pică → blocking. Raportează în channel + creează issue pe GitHub.

---

## 12. Referințe

- Migrații GRANT: `supabase/migrations/20260525004500_migration_047_*.sql`, `20260525004600_migration_048_*.sql`
- Query-uri verificare: [`SUPABASE-GRANTS-VERIFICATION.sql`](./SUPABASE-GRANTS-VERIFICATION.sql)
- Template env: [`/.env.example`](../.env.example)
- Script template check: `scripts/check-env-template.mjs`
- Auditul critic complet: [`AUDIT.md`](./AUDIT.md)
