#!/usr/bin/env bash
# Backup nightly al DB-ului Supabase (pg_dump custom format) cu rotație 14 zile.
# Rulat de menuvia-backup.timer; env-urile vin din /etc/menuvia/env
# (SUPABASE_DB_URL = connection string-ul direct din Supabase Dashboard).
#
# Restore: docs/RUNBOOK.md §6.2 (replay al lanțului → extragere SELECTIVĂ din arhivă
# → --data-only cu triggerele dezactivate pe nume → poarta §6.3). NU
# `pg_restore --clean --if-exists` peste un proiect nou — vezi audit v3 RES-07.
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

# Privilegiile SE PĂSTREAZĂ, iar dump-ul NU e limitat la `public` (audit v3
# RES-07 — comentariul de dinainte era documentație care minte, pe ambele puncte):
#  (a) `--no-privileges` scotea din arhivă TOT regimul de privilegii: măsurat pe
#      replay, 0 GRANT / 0 REVOKE / 0 ALTER DEFAULT PRIVILEGES → `proacl` NULL →
#      EXECUTE-ul implicit al lui PUBLIC revine și `anon` putea apela
#      `accept_invite` / `change_restaurant_slug` / `build_fiscalnet_payload`.
#  (b) `profiles.id` și `restaurant_memberships.user_id` sunt FK `ON DELETE
#      CASCADE` către `auth.users(id)` — cu `auth.users` GOL, fiecare profil și
#      fiecare membership e respins la restore, iar restaurantele rămân ORFANE
#      (`restaurants.owner_id` n-are FK).
# `--no-owner` rămâne, dar e un NO-OP măsurat pentru arhivele `-Fc`.
# Restore: NU `pg_restore --clean --if-exists` pe un proiect nou — urmează
# docs/RUNBOOK.md §6.2 (replay lanț → truncate seed-uri → --data-only cu
# triggerele dezactivate pe nume → re-enable → poarta §6.3).
pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=6 --no-owner \
  --file="$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "Backup OK: $OUT ($SIZE)"

# Rotație
find "$BACKUP_DIR" -name 'menuvia-*.dump' -mtime "+$KEEP_DAYS" -delete

# Dead-man's-switch opțional: ping healthchecks.io dacă e configurat.
if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" >/dev/null || true
fi
