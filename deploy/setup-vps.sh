#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# Menuvia — bootstrap VPS „o singură comandă" (Ubuntu 24.04, rulat ca root).
#
#   curl -fsSL https://raw.githubusercontent.com/menuvia/menuvia-cloud/main/deploy/setup-vps.sh | bash
#
# Idempotent: sigur de rulat de mai multe ori. La final îți cere să completezi
# /etc/menuvia/env și îți afișează cheia publică SSH pentru secrets-ul GitHub.
# După asta, FIECARE merge pe main se deployează singur (deploy-vps.yml).
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_TARBALL="https://github.com/menuvia/menuvia-cloud/archive/refs/heads/main.tar.gz"
APP_DIR=/srv/menuvia/app
DIST_DIR=/srv/menuvia/dist

log() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Rulează ca root."; exit 1; }

log "1/8 Node 20 + Caddy + unelte"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
fi
apt-get update -qq
apt-get install -y -qq nodejs caddy rsync curl ca-certificates gnupg

log "2/8 Client Postgres 17 (pg_dump compatibil cu Supabase PG17, pentru backup)"
if ! command -v pg_dump >/dev/null || ! pg_dump --version | grep -q " 17"; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq && apt-get install -y -qq postgresql-client-17
fi

log "3/8 User + structură"
id menuvia >/dev/null 2>&1 || useradd -r -m -d /srv/menuvia -s /bin/bash menuvia
mkdir -p "$APP_DIR" "$DIST_DIR" /srv/menuvia/backups
chown -R menuvia:menuvia /srv/menuvia

log "4/8 Codul (tarball main → $APP_DIR; deploy-urile viitoare vin prin GitHub Actions)"
TMP=$(mktemp -d)
curl -fsSL "$REPO_TARBALL" | tar -xz -C "$TMP" --strip-components=1
rsync -a --delete "$TMP/netlify/" "$APP_DIR/netlify/"
rsync -a --delete "$TMP/deploy/"  "$APP_DIR/deploy/"
cp "$TMP/package.json" "$TMP/package-lock.json" "$TMP/netlify.toml" "$APP_DIR/"
rm -rf "$TMP"
chown -R menuvia:menuvia "$APP_DIR"
sudo -u menuvia bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"

log "5/8 Env-urile funcțiilor (/etc/menuvia/env)"
mkdir -p /etc/menuvia
if [ ! -f /etc/menuvia/env ]; then
  install -m 600 /dev/null /etc/menuvia/env
  cat > /etc/menuvia/env <<'EOF'
# Completează valorile (din Netlify → Site config → Environment variables).
# Serviciul NU pornește sănătos fără SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
SUPABASE_URL=https://swjcptdylfmpvopdepqf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
WEBHOOK_SECRET=
# Plata online la masă (docs/ONLINE_PAYMENT.md) — opționale până activezi Connect:
STRIPE_PUBLISHABLE_KEY=
STRIPE_CONNECT_WEBHOOK_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
EMAIL_REPLY_TO=
RECRUTARE_NOTIFY_EMAIL=
SLACK_WEBHOOK_URL=
PLATFORM_OPENAI_KEY=
PLATFORM_ANTHROPIC_KEY=
ANTHROPIC_API_KEY=
APP_URL=https://menuvia.ro
VITE_APP_URL=https://menuvia.ro
VITE_SUPABASE_URL=https://swjcptdylfmpvopdepqf.supabase.co
# Pentru backup nightly (Supabase → Project settings → Database → Connection string, URI):
SUPABASE_DB_URL=
EOF
  echo ">>> /etc/menuvia/env creat — COMPLETEAZĂ valorile după script."
fi

log "6/8 systemd (shim funcții + backup nightly)"
cp "$APP_DIR/deploy/menuvia-functions.service" /etc/systemd/system/
cp "$APP_DIR/deploy/menuvia-backup.service"    /etc/systemd/system/
cp "$APP_DIR/deploy/menuvia-backup.timer"      /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now menuvia-functions
systemctl enable --now menuvia-backup.timer

log "7/8 Caddy + sudoers + firewall"
cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
echo 'menuvia ALL=(root) NOPASSWD: /usr/bin/systemctl restart menuvia-functions' \
  > /etc/sudoers.d/menuvia-deploy
chmod 440 /etc/sudoers.d/menuvia-deploy
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; ufw --force enable >/dev/null
fi

log "8/8 Cheie SSH de deploy pentru GitHub Actions"
if [ ! -f /srv/menuvia/.ssh/id_ed25519 ]; then
  sudo -u menuvia bash -c "mkdir -p /srv/menuvia/.ssh && ssh-keygen -t ed25519 -N '' -f /srv/menuvia/.ssh/id_ed25519 -C menuvia-deploy"
  sudo -u menuvia bash -c "cat /srv/menuvia/.ssh/id_ed25519.pub >> /srv/menuvia/.ssh/authorized_keys && chmod 600 /srv/menuvia/.ssh/authorized_keys"
fi

echo
echo "═══════════════════════════════════════════════════════════════════"
echo "GATA. Pașii finali (2 minute):"
echo "  1. nano /etc/menuvia/env   → completează secretele, apoi:"
echo "     systemctl restart menuvia-functions"
echo "  2. În GitHub → Settings → Secrets → Actions, adaugă:"
echo "     VPS_HOST = IP-ul acestui server"
echo "     VPS_SSH_KEY = conținutul de mai jos (cheia PRIVATĂ):"
echo "     ────────────────────────────────────────────────"
cat /srv/menuvia/.ssh/id_ed25519
echo "     ────────────────────────────────────────────────"
echo "     + VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY (prod)"
echo "  3. DNS: A-record menuvia.ro (+www) → IP-ul serverului."
echo "  4. Rulează manual primul deploy: GitHub → Actions → Deploy VPS → Run workflow."
echo "Verificări: curl localhost:8788/__shim/health · journalctl -u menuvia-functions -f"
echo "═══════════════════════════════════════════════════════════════════"
