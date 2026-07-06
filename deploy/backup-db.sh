#!/usr/bin/env bash
# Backup nightly al DB-ului Supabase (pg_dump custom format) cu rotație 14 zile.
# Rulat de menuvia-backup.timer; env-urile vin din /etc/menuvia/env
# (SUPABASE_DB_URL = connection string-ul direct din Supabase Dashboard).
#
# Restore (testează-l măcar o dată! — criteriu Faza 1 din PLAN_10):
#   pg_restore --clean --if-exists -d "$SUPABASE_DB_URL" /srv/menuvia/backups/<fisier>.dump
set -euo pipefail

BACKUP_DIR=/srv/menuvia/backups
KEEP_DAYS=14

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL nesetat în /etc/menuvia/env — backup sărit." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/menuvia-$STAMP.dump"

# --no-owner/--no-privileges: restore-ul nu depinde de rolurile Supabase interne.
# Doar schema public — auth/storage sunt gestionate de Supabase (și se refac din
# proiect); datele de business (comenzi, meniuri, afiliați) sunt toate în public.
pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=6 \
  --schema=public --no-owner --no-privileges \
  --file="$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "Backup OK: $OUT ($SIZE)"

# Rotație
find "$BACKUP_DIR" -name 'menuvia-*.dump' -mtime "+$KEEP_DAYS" -delete

# Dead-man's-switch opțional: ping healthchecks.io dacă e configurat.
if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" >/dev/null || true
fi
