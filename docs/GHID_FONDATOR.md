# GHID FONDATOR — singurele lucruri pe care trebuie să le faci TU

> Tot restul e automatizat sau îl fac eu. Urmează pașii de sus în jos.
> Timp total estimat: **~20 de minute** (fără telefonul la EconMedia).
> Când termini un bloc, scrie-mi „gata pasul N" și verific eu totul.

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
