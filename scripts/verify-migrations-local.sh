#!/usr/bin/env bash
# Replay LOCAL al întregului lanț de migrații + asserțiile SQL din CI, pe un
# Postgres efemer (initdb → socket unix → drop la final). Echivalentul jobului
# „SQL Migrations Verify" când CI nu e disponibil (ex. cota Actions epuizată).
#
#   bash scripts/verify-migrations-local.sh          # rulează tot, curăță la final
#   KEEP=1 bash scripts/verify-migrations-local.sh   # lasă clusterul pornit (debug)
#
# Bootstrap-ul Supabase-compat (roluri anon/authenticated/service_role, schema
# auth/storage mock, extensions) se EXTRAGE din .github/workflows/sql-verify.yml
# — sursă unică; dacă workflow-ul evoluează, scriptul rămâne sincron automat.
#
# Două fișiere de asserții sunt sărite INTENȚIONAT — și CI-ul le sare, prin
# condiții `if: hashFiles(...)` (teste de eră, valabile doar înainte de 096B/096C):
#   - tests/sql/authorization_phase_1a_assertions.sql
#   - tests/sql/authorization_final_state_assertions.sql
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/sql-verify.yml"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PORT:-55432}"

# Ca root, Postgres refuză să pornească — rulăm pașii de server ca `postgres`.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  WORKDIR="/var/lib/postgresql/menuvia-verify-$$"
  as_pg() { su postgres -c "$*"; }
else
  WORKDIR="${TMPDIR:-/tmp}/menuvia-verify-$$"
  as_pg() { bash -c "$*"; }
fi

PSQL=(psql -h "$WORKDIR" -p "$PORT" -U postgres)

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1 → clusterul rămâne pornit: ${PSQL[*]} -d menuvia_test"
    return
  fi
  as_pg "$PG_BIN/pg_ctl -D $WORKDIR/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "── initdb ($PG_BIN) în $WORKDIR"
mkdir -p "$WORKDIR"
[ "$(id -u)" = "0" ] && chown postgres:postgres "$WORKDIR"
as_pg "$PG_BIN/initdb -D $WORKDIR/data -U postgres --auth=trust" >"$WORKDIR/initdb.log" 2>&1
as_pg "$PG_BIN/pg_ctl -D $WORKDIR/data -o '-k $WORKDIR -p $PORT -c listen_addresses=\"\"' -l $WORKDIR/server.log start" >/dev/null
"${PSQL[@]}" -q -c "create database menuvia_test;"

echo "── bootstrap Supabase-compat (extras din sql-verify.yml)"
python3 - "$WORKFLOW" >"$WORKDIR/bootstrap.sql" <<'PYEOF'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r'<<EOF\n(.*?)\n\s+EOF\n', s, re.S)
if not m:
    sys.exit('bootstrap block not found in sql-verify.yml')
lines = [l[10:] if l.startswith(' ' * 10) else l for l in m.group(1).split('\n')]
print('\n'.join(lines).replace('\\$', '$'))
PYEOF
"${PSQL[@]}" -d menuvia_test -v ON_ERROR_STOP=1 -q -f "$WORKDIR/bootstrap.sql"

echo "── aplic migrațiile în ordine"
cd "$REPO_ROOT/supabase/migrations"
COUNT=0
for mig in $(ls *.sql | sort -V); do
  if ! "${PSQL[@]}" -d menuvia_test -v ON_ERROR_STOP=1 -q -f "$mig" >"$WORKDIR/mig.log" 2>&1; then
    echo "✗ MIGRAȚIE PICATĂ: $mig"
    tail -20 "$WORKDIR/mig.log"
    exit 1
  fi
  COUNT=$((COUNT + 1))
done
echo "✓ $COUNT migrații aplicate"

echo "── asserțiile SQL (ordinea din workflow; testele de eră sărite ca în CI)"
cd "$REPO_ROOT"
SKIP="authorization_phase_1a_assertions.sql authorization_final_state_assertions.sql"
PASS=0; FAIL=0
for t in $(grep -oP "tests/sql/[a-z0-9_/]+\.sql" "$WORKFLOW" | awk '!seen[$0]++'); do
  base="$(basename "$t")"
  if [[ " $SKIP " == *" $base "* ]]; then
    echo "  – SKIP (test de eră, sărit și în CI): $base"
    continue
  fi
  if "${PSQL[@]}" -d menuvia_test -v ON_ERROR_STOP=1 -q -f "$t" >"$WORKDIR/test.log" 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ FAIL: $t"
    tail -8 "$WORKDIR/test.log"
  fi
done
echo "── rezultat: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "✓ TOTUL VERDE — lanțul de migrații + asserțiile CI trec local"
