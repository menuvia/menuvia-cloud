# VPS RUNBOOK — Menuvia pe server propriu (Faza 1 / PLAN_10)

> Ținta: cost fix (~4 €/lună), fără „credite" care se termină. Arhitectura NU se
> schimbă: frontend static + funcțiile Netlify NESCHIMBATE (rulate de shim-ul
> `deploy/server.js` pe aceleași path-uri `/.netlify/functions/*`) + cron-urile
> din `netlify.toml`. Supabase rămâne cloud.

## 0. Ce cumperi (o dată, ~5 min)

- **Hetzner Cloud** → server **CX22** (2 vCPU, 4GB, ~3,79 €/lună), Ubuntu 24.04,
  locația Falkenstein/Nürnberg. Adaugă cheia ta SSH la creare.
- DNS: A-record `menuvia.ro` și `www` → IP-ul serverului.

## 1. Setup pe server (o dată, copy/paste ca root)

```bash
# 1. Node 20 + Caddy + unelte
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs caddy rsync

# 2. User de rulare + structura
useradd -r -m -d /srv/menuvia -s /bin/bash menuvia
mkdir -p /srv/menuvia/{app,dist}
chown -R menuvia:menuvia /srv/menuvia

# 3. Env-urile funcțiilor (valorile din Netlify → Site config → Env vars)
install -m 600 /dev/null /etc/menuvia/env
cat > /etc/menuvia/env <<'EOF'
SUPABASE_URL=https://swjcptdylfmpvopdepqf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
STRIPE_SECRET_KEY=...
WEBHOOK_SECRET=...
RESEND_API_KEY=...
EMAIL_FROM=...
EMAIL_REPLY_TO=...
RECRUTARE_NOTIFY_EMAIL=...
SLACK_WEBHOOK_URL=...
PLATFORM_OPENAI_KEY=...
PLATFORM_ANTHROPIC_KEY=...
ANTHROPIC_API_KEY=...
APP_URL=https://menuvia.ro
VITE_APP_URL=https://menuvia.ro
VITE_SUPABASE_URL=https://swjcptdylfmpvopdepqf.supabase.co
EOF

# 4. Serviciul de funcții + Caddy (fișierele vin din repo la primul deploy;
#    pentru bootstrap, clonează repo-ul sau copiază-le manual)
cp /srv/menuvia/app/deploy/menuvia-functions.service /etc/systemd/system/
cp /srv/menuvia/app/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now menuvia-functions
systemctl reload caddy

# 5. sudoers: userul de deploy poate DOAR restarta serviciul
echo 'menuvia ALL=(root) NOPASSWD: /usr/bin/systemctl restart menuvia-functions' \
  > /etc/sudoers.d/menuvia-deploy
chmod 440 /etc/sudoers.d/menuvia-deploy

# 6. Firewall minimal
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable
```

## 2. Secrets în GitHub (o dată)

Repo → Settings → Secrets and variables → Actions:

| Secret | Valoare |
|---|---|
| `VPS_HOST` | IP-ul serverului |
| `VPS_SSH_KEY` | cheia PRIVATĂ ed25519 a userului `menuvia` (generezi: `ssh-keygen -t ed25519`; pui `.pub` în `/srv/menuvia/.ssh/authorized_keys`) |
| `VITE_SUPABASE_URL` | URL-ul Supabase prod |
| `VITE_SUPABASE_ANON_KEY` | anon key prod |

Din acel moment, **fiecare merge pe main = deploy automat** (`.github/workflows/deploy-vps.yml`):
build în CI → rsync `dist/` + `netlify/functions` + `deploy/` → `npm ci --omit=dev` →
restart serviciu → smoke test `/health`. Până când secrets-urile există, workflow-ul
e inert (skip curat, nu pică CI-ul).

## 3. Cutover de pe Netlify (când totul e verde pe VPS)

1. Verifică pe IP direct: `curl -H "Host: menuvia.ro" http://IP/health`.
2. Mută DNS-ul pe IP (TTL mic înainte). Caddy ia certificatul automat.
3. **Stripe Dashboard → webhook endpoint**: schimbă URL-ul pe
   `https://menuvia.ro/.netlify/functions/stripe-webhook` (WEBHOOK_SECRET nou dacă
   creezi endpoint nou — actualizează `/etc/menuvia/env`).
4. Netlify vechi rămâne pe loc ca REDIRECT (QR-urile tipărite cu
   `menuvia.netlify.app` continuă să meargă): un `_redirects` cu
   `/* https://menuvia.ro/:splat 301!` — cere un ultim deploy pe Netlify
   (după resetarea creditelor ~27 iulie, sau o plată mică o dată).
5. Oprește cron-urile din Netlify abia DUPĂ ce vezi în jurnalul shim-ului
   (`journalctl -u menuvia-functions -f`) că joburile rulează pe VPS —
   altfel rulează dublu (sunt idempotente prin design, dar nu e igienic).

## 4. Operare zilnică

| Ce | Cum |
|---|---|
| Loguri funcții + cron | `journalctl -u menuvia-functions -f` |
| Restart manual | `sudo systemctl restart menuvia-functions` |
| Sănătate shim | `curl localhost:8788/__shim/health` |
| Sănătate app+DB | `curl https://menuvia.ro/health` |
| Update Caddy config | editezi `/etc/caddy/Caddyfile` → `systemctl reload caddy` |

Monitor extern (healthchecks.io / UptimeRobot, gratuit): pune un check HTTP pe
`https://menuvia.ro/health` la 5 min — e dead-man's-switch-ul pentru TOT
(static + shim + Supabase).

## 5. Limitări cunoscute (asumate)

- Un singur nod: dacă serverul pică, site-ul pică (monitorul te anunță).
  La >50 restaurante active: al doilea nod sau upgrade (MASTER_PLAN §4).
- Shim-ul rulează cron-urile în procesul HTTP; joburile Menuvia sunt scurte
  (secunde) și idempotente — la restart în mijlocul unui job, catch-up-ul
  existent (ferestre largi, `FOR UPDATE SKIP LOCKED`, dedup) recuperează.
- `ai-generate-image` poate depăși 30s pe imagini mari — shim-ul nu are timeout
  propriu (Node default), deci e OK, dar monitorizează memoria la început.
