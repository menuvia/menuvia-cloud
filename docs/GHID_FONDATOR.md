# GHID FONDATOR — singurele lucruri pe care trebuie să le faci TU

> Tot restul e automatizat sau îl fac eu. Când termini un bloc, scrie-mi
> „gata pasul N" și verific eu totul.

## ⚡ ORDINEA ACTUALĂ (august 2026) — fă-le EXACT în ordinea asta

> Auditul pe capitole a re-ordonat lista: domeniile înaintea oricărui server,
> iar SRL-ul (absent din orice versiune anterioară a ghidului) pornit DEVREME
> — are cel mai lung lead-time de pe drumul spre primul leu încasat.
> Onestitate: blocurile A–C = ore; D–E = săptămâni de așteptare, minute de muncă.

**A. AZI (~2 ore, ~200 lei) — un singur activ, șase riscuri închise**
1. Cumpără **menuvia.ro + codvia.ro** de la un registrar românesc (~50 lei/an
   fiecare). Adaugă-le ca domenii în Netlify (Domain management).
2. **Resend → Domains → menuvia.ro** → pune înregistrările DKIM/SPF în DNS →
   verifică. Fără asta, TOATE emailurile de producție (rezervări noi, dunning,
   comenzi Codvia, remindere) se pun în coadă dar NU pleacă.
3. Interimar 5 min (până se propagă DNS-ul): în Netlify env,
   `RECRUTARE_NOTIFY_EMAIL=georgeradu119@gmail.com`.

**B. TOT AZI (~20 min) — cheile din dashboard-uri**
4. Netlify env: `PLATFORM_OPENAI_KEY` (fără ea, importul AI din poze —
   argumentul #1 de onboarding — e mort) + `SLACK_WEBHOOK_URL` (alerte).
5. GitHub → Settings → Secrets: `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`
   (armează backup-ul zilnic criptat din db-backup.yml).
6. Supabase: Authentication → Password → **Leaked password protection ON**;
   contul tău → înrolează **TOTP** (MfaCard din Setări → Cont).
7. UptimeRobot gratuit pe `https://menuvia.netlify.app/health` la 5 min.

**C. SĂPTĂMÂNA ASTA (~3 ore de muncă)**
8. **Testul uman pe telefon** (singurul lucru pe care nu-l pot face eu):
   scan QR → comandă cu opțiuni → cere nota cu tips; `/rezervare/<slug>` →
   rezervare reală → emailul de notificare sosește; import AI din 2 poze;
   `/founder` → „Intră pe cont" + refresh.
9. **Telefon EconMedia (0772 179 309)** — un apel închide 4 necunoscute ale
   pilotului fiscal (pricing, idempotență BonLocal, ST^, casă demo).
10. **Supabase Pro** (~$25/lună) ÎNAINTE de pilotul fiscal — PITR e
    asigurarea datelor cu retenție legală de 10 ani.

**D. PORNITE ACUM, GATA ÎN SĂPTĂMÂNI (lead-time, nu efort)**
11. **SRL** (ONRC, ~5 zile lucrătoare, <1.000 lei) → cont bancar → Stripe pe
    firmă → SPV/e-Factura → cont Oblio. Fără firmă nu se poate încasa legal
    niciun abonament. Draft-urile legale te așteaptă în `menuvia-pack/02..06`
    — dă-le unui avocat împreună cu datele firmei.

**E. DUPĂ TOATE DE MAI SUS** — pașii VPS de mai jos (serverul devine necesar
abia când factura de funcții Netlify crește — vezi GO_LIVE Faza 4; NU e
primul pas, oricât de detaliat e descris în continuare).

---

## PASUL 1 — Serverul (o dată, ~10 min, ~4 €/lună)

**1a.** Cont pe https://console.hetzner.com → Cloud → New Project → **Add Server**:
- Location: **Falkenstein** · Image: **Ubuntu 24.04** · Type: **CX22** (2 vCPU / 4 GB)
- SSH key: adaugă cheia ta (sau lasă parolă pe email)
- Create & Buy now → notează **IP-ul**.

**1b.** Intră pe server și rulează O SINGURĂ comandă:

```bash
ssh root@IP_UL_TAU
curl -fsSL https://raw.githubusercontent.com/menuvia/menuvia-cloud/main/deploy/setup-vps.sh | bash
```

Scriptul instalează tot și la final **îți afișează pe ecran cheia SSH pentru GitHub**
(o copiezi la pasul 3) + pașii rămași.

**1c.** Completează secretele (tot pe server):

```bash
nano /etc/menuvia/env
```

Doar astea 5 sunt OBLIGATORII ca site-ul să meargă (restul pot rămâne goale la început):

| Variabilă | De unde iei valoarea |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | https://supabase.com/dashboard/project/swjcptdylfmpvopdepqf/settings/api → „service_role" (Reveal) |
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys → Secret key |
| `WEBHOOK_SECRET` | https://dashboard.stripe.com/webhooks → endpoint-ul tău → Signing secret |
| `RESEND_API_KEY` | https://resend.com/api-keys |
| `PLATFORM_OPENAI_KEY` | https://platform.openai.com/api-keys (asta PORNEȘTE AI-ul pentru toți clienții) |

Apoi:

```bash
systemctl restart menuvia-functions
```

---

## PASUL 2 — DNS (~2 min)

La registrarul domeniului (unde ai menuvia.ro):
- **A record**: `menuvia.ro` → IP-ul serverului
- **A record**: `www` → IP-ul serverului

(Caddy ia certificatul HTTPS singur, în ~1 minut după propagare.)

---

## PASUL 3 — 4 secrete în GitHub (~3 min)

https://github.com/menuvia/menuvia-cloud/settings/secrets/actions → **New repository secret**, de 4 ori:

| Nume (exact așa) | Valoare |
|---|---|
| `VPS_HOST` | IP-ul serverului |
| `VPS_SSH_KEY` | cheia PRIVATĂ afișată de script la pasul 1b (tot blocul, cu BEGIN/END) |
| `VITE_SUPABASE_URL` | `https://swjcptdylfmpvopdepqf.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | https://supabase.com/dashboard/project/swjcptdylfmpvopdepqf/settings/api → „anon public" |

Apoi: https://github.com/menuvia/menuvia-cloud/actions → **Deploy VPS** → **Run workflow**.
**Din acest moment, fiecare merge pe main se publică singur. Pentru totdeauna.**

---

## PASUL 4 — Un click în Supabase (~1 min)

https://supabase.com/dashboard/project/swjcptdylfmpvopdepqf/auth/providers
→ secțiunea **Password** (sau „Attack protection") → activează
**„Leaked password protection"** → Save.

---

## PASUL 5 — Stripe webhook pe noul domeniu (~2 min, DUPĂ ce site-ul e live)

https://dashboard.stripe.com/webhooks → endpoint-ul existent → **Update endpoint** →
URL: `https://menuvia.ro/.netlify/functions/stripe-webhook`
(dacă creezi endpoint NOU, copiază noul Signing secret în `/etc/menuvia/env` → `WEBHOOK_SECRET` → `systemctl restart menuvia-functions`).

---

## PASUL 6 — Telefonul la EconMedia (separat, când vrei pilotul fiscal)

**0772 179 309** — două întrebări: (1) prețul FiscalNet per casă pentru un
integrator SaaS, (2) cum primim o casă/licență demo pentru teste.
Restul pilotului (installer, ghidaj, teste) îl fac eu.

---

## Opțional, mai târziu (nu blochează nimic)

- **Sentry** (erori frontend): cont gratuit pe https://sentry.io → creezi proiect React →
  copiezi DSN-ul → îl adaugi ca secret GitHub `VITE_SENTRY_DSN` → gata (codul există deja).
- **healthchecks.io** (alertă când pică site-ul): cont gratuit → check HTTP pe
  `https://menuvia.ro/health` la 5 min + un ping-URL pe care mi-l dai pentru backup
  (`BACKUP_PING_URL` în `/etc/menuvia/env`).
- **MFA** pe conturile Supabase / GitHub / Stripe / Hetzner (recomandat, ~10 min).

---

## Verificare finală (le fac EU după ce zici „gata")

- `https://menuvia.ro` afișează versiunea nouă · `/health` răspunde `ok` ·
  AI-ul răspunde pe un cont nou · cron-urile rulează (journalctl) ·
  backup-ul nightly scrie fișier · Stripe webhook primește 200.
