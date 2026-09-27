# GHID FONDATOR — singurele lucruri pe care trebuie să le faci TU

> Tot restul e automatizat sau îl fac eu. Când termini un bloc, scrie-mi
> „gata pasul N" și verific eu totul.

## ⚡ ORDINEA (25 sept 2026, v3) — sursa unică e `docs/ECOSISTEM.md` §3

> Lista de mai jos (august) e păstrată pentru DETALIILE fiecărui pas, dar
> ORDINEA e cea din ECOSISTEM §3, în trei valuri:
> **0a (o oră, azi)** ÎNTÂI cumpără `menuvia.ro` (pct. 1): e DEJA fixat în build
> (`netlify.toml:154`, `VITE_APP_URL`), deci QR-urile, confirmarea de cont și
> resetarea parolei de pe prod duc acolo; apoi `SUPABASE_SERVICE_ROLE_KEY` în
> Netlify + republicarea `main` — fără ea NIMIC de pe server nu merge (issue
> #250). `SUPABASE_URL` (public), anularea celor 4 emailuri vechi din coadă și
> verificarea `VITE_WHATSAPP_NUMBER` le fac eu la „da”-ul tău. Poartă: `/health`
> cu `checks.db: "ok"` (503 pe `queues` e normal până la 0b);
> **0b (zile, patru bucăți mici)** backup; email (Resend Verified ÎNAINTE de
> `RESEND_API_KEY` + SMTP-ul Supabase Auth + căsuță de primire); monitorizare
> (`HEALTH_DIAG_TOKEN`, UptimeRobot, MFA, leaked-password); chei (AI cu plafon de
> cost, Stripe DOAR de TEST);
> **0c (săptămâni, pornit azi)** SRL → bancă → contabil + regim TVA → Stripe pe
> firmă → SPV + cont Oblio pentru facturile PROPRII ale Menuviei → drafturile
> legale cu CUI-ul real → comutarea Stripe pe LIVE (ultimul pas).
> Unde lista de mai jos contrazice ECOSISTEM §3, câștigă ECOSISTEM.

### Lista din august (detalii pe pași)

> Auditul pe capitole a re-ordonat lista: domeniile înaintea oricărui server,
> iar SRL-ul (absent din orice versiune anterioară a ghidului) pornit DEVREME
> — are cel mai lung lead-time de pe drumul spre primul leu încasat.
> Onestitate: blocurile A–C = ore; D–E = săptămâni de așteptare, minute de muncă.

**A. AZI (~2 ore, ~200 lei) — un singur activ, șase riscuri închise**
1. Cumpără **menuvia.ro + codvia.ro** de la un registrar românesc (~50 lei/an
   fiecare). Adaugă-le ca domenii în Netlify (Domain management).
2. **Resend → Domains → menuvia.ro** → pune înregistrările DKIM/SPF în DNS →
   verifică. Fără asta, TOATE emailurile de producție (rezervări noi, dunning,
   comenzi Codvia, remindere) NU pleacă — iar cu `RESEND_API_KEY` pusă ÎNAINTEA
   verificării, Resend le respinge (4xx) și ajung `failed` definitiv, fără retry
   (`process-email-queue.js`, ramura `err.permanent`). Cheia se pune DOAR după Verified.
3. Interimar 5 min (până se propagă DNS-ul): în Netlify env,
   `RECRUTARE_NOTIFY_EMAIL=georgeradu119@gmail.com`.

**B. TOT AZI (~20 min) — cheile din dashboard-uri**
4. Netlify env: `PLATFORM_OPENAI_KEY` (fără ea, importul AI din poze —
   argumentul #1 de onboarding — e mort) + `SLACK_WEBHOOK_URL` (alerte).
5. GitHub → Settings → Secrets: `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`
   (armează backup-ul zilnic criptat din db-backup.yml).
6. Supabase: Authentication → Password → **Leaked password protection ON**;
   contul tău → înrolează **TOTP** (MfaCard din Setări → Cont).
7. UptimeRobot gratuit pe `https://menuvia.netlify.app/health` la 5 min (după cumpărarea domeniului: `https://menuvia.ro/health` — același host pe care îl bate `health-watch.yml`).

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
abia când factura de funcții Netlify crește — vezi `docs/PLAN_0_TO_HERO.md` BLOC 0 (GO_LIVE e istoric, superseded); NU e
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

Lista COMPLETĂ cu efectul fiecărei variabile e în `docs/VPS_RUNBOOK.md` (blocul
`/etc/menuvia/env`) — e aceeași listă pentru Netlify. Fără cele de mai jos, funcțiile
fac **fail-fast** (500) sau degradează tăcut:

| Variabilă | De unde iei valoarea | Fără ea |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | https://supabase.com/dashboard/project/swjcptdylfmpvopdepqf/settings/api → „service_role" (Reveal) | NICIO funcție nu atinge baza (`/health` → `db: down`) |
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys → Secret key | checkout/webhook 500 |
| **`STRIPE_WEBHOOK_SECRET`** | https://dashboard.stripe.com/webhooks → endpoint-ul tău → Signing secret. **ATENȚIE: NU `WEBHOOK_SECRET`** — acela e secretul INTERN pentru send-push/welcome-email, altă variabilă | planul nu se activează după plată, dunning mort |
| `STRIPE_STARTER_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` | Stripe → Products → fiecare plan → Price ID | `stripe-checkout` ȘI `stripe-webhook` fac fail-fast pe TOATE patru (`stripe-webhook.js:38-47`) |
| `RESEND_API_KEY` | https://resend.com/api-keys | niciun email nu pleacă |
| `PLATFORM_OPENAI_KEY` | https://platform.openai.com/api-keys (asta PORNEȘTE AI-ul pentru toți clienții) | importul AI din poze nu funcționează — exact pasul la care au murit toți cei 4 utilizatori reali |
| `AI_CONFIG_SECRET` (≥32 caractere, `openssl rand -hex 32`) | îl generezi tu | `ai-config`/`ai-proxy` 500 |
| `HEALTH_DIAG_TOKEN` (`openssl rand -hex 32`) | îl generezi tu | diagnosticul din `/health` inaccesibil (fail-closed) |
| `SLACK_WEBHOOK_URL` | Slack → Incoming webhooks | 7 alerte degradează TĂCUT |

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

## PASUL 5 — Endpoint-urile de webhook Stripe (~5 min, DUPĂ ce site-ul e live)

**De ce prin API, nu din Dashboard:** forma evenimentelor o decide VERSIUNEA
endpoint-ului, iar codul e fixat pe `2023-10-16`. Un cont Stripe nou pornește
pe versiunea curentă (dahlia sau mai nouă), iar versiunea NU se mai poate
schimba pe un endpoint existent — doar ștergi, recreezi și înlocuiești secretul.
Codul citește acum ambele forme cunoscute, dar o nepotrivire apare în loguri ca
`ALERT api_version mismatch` și înseamnă „recreează endpoint-ul".

Rulezi o dată în **test mode** (cu cheia `sk_test_…`), apoi o dată în **live**
(cu `sk_live_…`). Înlocuiește domeniul dacă nu e încă `menuvia.ro`:

```bash
curl https://api.stripe.com/v1/webhook_endpoints -u "$STRIPE_SECRET_KEY:" \
  -d url=https://menuvia.ro/.netlify/functions/stripe-webhook \
  -d api_version=2023-10-16 \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=customer.subscription.trial_will_end" \
  -d "enabled_events[]=invoice.paid" -d "enabled_events[]=invoice.payment_failed" \
  -d "enabled_events[]=charge.refunded" -d "enabled_events[]=charge.dispute.closed"

curl https://api.stripe.com/v1/webhook_endpoints -u "$STRIPE_SECRET_KEY:" \
  -d url=https://menuvia.ro/.netlify/functions/stripe-connect-webhook \
  -d connect=true -d api_version=2023-10-16 \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed" \
  -d "enabled_events[]=payment_intent.canceled" \
  -d "enabled_events[]=account.application.deauthorized"
```

Din fiecare răspuns: câmpul `secret` → `STRIPE_WEBHOOK_SECRET` (primul, **NU**
`WEBHOOK_SECRET`) și `STRIPE_CONNECT_WEBHOOK_SECRET` (al doilea), în env-ul de
producție (`/etc/menuvia/env` → `systemctl restart menuvia-functions`, sau
Netlify → Environment variables → redeploy). Verifică în răspuns
`"api_version": "2023-10-16"` și notează-l în `docs/RUNBOOK.md` §4.1.
Payload-ul trebuie să fie „snapshot" (implicitul prin API), nu „thin".

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
