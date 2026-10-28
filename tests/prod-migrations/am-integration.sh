#!/usr/bin/env bash
# tests/prod-migrations/am-integration.sh
# =============================================================================
# AM1–AM4: aplicarea automată a migrațiilor (PR-0) pe o bază care SIMULEAZĂ
# producția: replay până la 288, plus 291 aplicată ÎNAINTEA lui 289/290 (exact
# starea reală din oct 2026), cu ledger-ul în forma Supabase CLI și `version` =
# momentul aplicării (ca pe prod, unde MCP scrie timestamp-ul, nu prefixul).
#
#   AM2  fără lista de excepții, CLI-ul REFUZĂ golul 289/290 (exit 2) și nu
#        scrie NIMIC (ledger neschimbat, obiectele din 289/292 absente)
#   AM1  cu lista: dry-run nu scrie nimic; aplicarea pune 289,290,292..N, câte
#        un rând de ledger cu version = prefixul fișierului, și
#        get_schema_version(manifest).missing = []; a doua rulare = no-op
#   AM3  un fișier enum_only se aplică + rând de ledger separat; un fișier care
#        pică se anulează COMPLET (nici obiecte, nici ledger) și oprește lotul
#   AM4  ledger-ul e ÎN tranzacția fișierului: dacă INSERT-ul de ledger pică,
#        obiectele fișierului NU rămân (pică dacă rândul ar fi pus după commit)
#   AM5  repetiția: backup-ul (pg_dump -Fc) al bazei simulate, restaurat de
#        scripts/prod-migrations-rehearsal.sh într-o bază nouă, primește
#        289,290,292.. cu același CLI și trece poarta de privilegii
#
# Conexiunea vine din PGHOST/PGPORT/PGUSER/PGPASSWORD (TCP în CI, socket local).
# Rulează din sql-verify.yml; local: vezi docs/RUNBOOK.md §6.5.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/sql-verify.yml"
MIG_DIR="$REPO_ROOT/supabase/migrations"
CLI="$REPO_ROOT/scripts/apply-prod-migrations.mjs"
ALLOW="$REPO_ROOT/scripts/prod-migrations-allow-gaps.json"
MANIFEST="$REPO_ROOT/netlify/functions/schema-manifest.json"
DB="${AM_DB:-menuvia_am_prod_sim}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

: "${PGHOST:?PGHOST lipsește}"
: "${PGUSER:=postgres}"
: "${PGPORT:=5432}"
export PGHOST PGUSER PGPORT

if [[ "$PGHOST" == /* ]]; then
  export SUPABASE_DB_URL="postgresql:///$DB?host=$PGHOST&port=$PGPORT&user=$PGUSER"
else
  export SUPABASE_DB_URL="postgresql://$PGUSER:${PGPASSWORD:-}@$PGHOST:$PGPORT/$DB"
fi

adm() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
val() { psql -X -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
fail() { echo "✗ $*" >&2; exit 1; }
cli() { node "$CLI" "$@"; }

echo "── AM: baza simulată $DB"
adm -c "drop database if exists $DB" -c "create database $DB"

# Bootstrap Supabase-compat: EXTRAS din sql-verify.yml (sursă unică, aceeași
# expresie ca scripts/verify-migrations-local.sh).
python3 - "$WORKFLOW" >"$WORK/bootstrap.sql" <<'PYEOF'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r'<<EOF\n(.*?)\n\s+EOF\n', s, re.S)
if not m:
    sys.exit('bootstrap block not found in sql-verify.yml')
lines = [l[10:] if l.startswith(' ' * 10) else l for l in m.group(1).split('\n')]
print('\n'.join(lines).replace('\\$', '$'))
PYEOF
db -f "$WORK/bootstrap.sql" >/dev/null

# Ledger în forma Supabase CLI (coloanele în plus sunt nullable — CLI-ul scrie
# doar version + name).
db <<'SQL'
create schema if not exists supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text,
  created_by text, idempotency_key text unique
);
SQL

CUT="$(ls "$MIG_DIR" | grep '_migration_289_' | cut -c1-14)"
F291="$(ls "$MIG_DIR" | grep '_migration_291_')"
[ -n "$CUT" ] && [ -n "$F291" ] || fail "nu găsesc 289/291 în $MIG_DIR"

echo "── replay < 289 (ca psql simplu, ca sql-verify)"
: >"$WORK/seed.sql"
i=0
for f in $(ls "$MIG_DIR" | sort); do
  [[ "${f:0:14}" < "$CUT" ]] || continue
  db -f "$MIG_DIR/$f" >"$WORK/mig.log" 2>&1 || { tail -20 "$WORK/mig.log"; fail "replay: $f"; }
  i=$((i + 1))
  name="${f:15}"; name="${name%.sql}"
  # version = „momentul aplicării” (2027…), NU prefixul — ca pe prod.
  printf "insert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" \
    "$(printf '2027%010d' "$i")" "$name" >>"$WORK/seed.sql"
done
db -f "$MIG_DIR/$F291" >"$WORK/mig.log" 2>&1 || { tail -20 "$WORK/mig.log"; fail "291 peste 288"; }
name="${F291:15}"; name="${name%.sql}"
printf "insert into supabase_migrations.schema_migrations (version, name) values ('20279999999999', '%s');\n" "$name" >>"$WORK/seed.sql"
db -f "$WORK/seed.sql"
echo "  replay: $i fișiere + 291; ledger: $(val 'select count(*) from supabase_migrations.schema_migrations') rânduri"

# Date reale de tenant (fixture-ul de autorizare: 2 utilizatori, 1 restaurant,
# owner + waiter) — aplicarea 289+ rulează PESTE date, ca pe prod, iar dump-ul
# de mai jos are ce restaura (RP12 cere rânduri).
db -f "$REPO_ROOT/tests/sql/authorization_test_fixture.sql" >/dev/null
# „Backup-ul zilnic” al producției simulate, pentru repetiția din AM5.
pg_dump -d "$DB" -Fc --no-owner -f "$WORK/prod-sim.dump"

LEDGER0="$(val 'select count(*) from supabase_migrations.schema_migrations')"
marker289="select count(*) from pg_proc where proname = 'expire_stale_pending_reservations'"
marker292="select count(*) from pg_proc where proname = 'fn_orders_paid_immutable'"

# ── AM2: golul nepermis e refuzat, nimic scris ──────────────────────────────
set +e
cli --dry-run >"$WORK/am2a.log" 2>&1; rc_dry=$?
cli >"$WORK/am2b.log" 2>&1; rc=$?
set -e
[ "$rc_dry" = 2 ] || { cat "$WORK/am2a.log"; fail "AM2: dry-run fără listă trebuia să iasă 2, a ieșit $rc_dry"; }
[ "$rc" = 2 ] || { cat "$WORK/am2b.log"; fail "AM2: aplicarea fără listă trebuia să iasă 2, a ieșit $rc"; }
grep -q 'migration_289_reservations_expired' "$WORK/am2b.log" || fail "AM2: mesajul nu numește golul 289"
[ "$(val 'select count(*) from supabase_migrations.schema_migrations')" = "$LEDGER0" ] || fail "AM2: ledger-ul s-a schimbat"
[ "$(val "$marker289")" = 0 ] && [ "$(val "$marker292")" = 0 ] || fail "AM2: obiecte din 289/292 au apărut"
echo "✓ AM2: golul 289/290 fără excepție → refuz (exit 2), nimic scris"

# ── AM1: cu lista de excepții ───────────────────────────────────────────────
cli --dry-run --allow-gaps-file "$ALLOW" >"$WORK/am1a.log" 2>&1 || { cat "$WORK/am1a.log"; fail "AM1: dry-run a picat"; }
grep -q 'migration_290_plan_dead_data' "$WORK/am1a.log" || fail "AM1: planul nu listează 290"
grep -q 'migration_291_' "$WORK/am1a.log" && fail "AM1: planul listează 291 (deja aplicată)"
[ "$(val 'select count(*) from supabase_migrations.schema_migrations')" = "$LEDGER0" ] || fail "AM1: dry-run a scris în ledger"
[ "$(val "$marker289")" = 0 ] || fail "AM1: dry-run a aplicat 289"

cli --allow-gaps-file "$ALLOW" --verify-schema "$MANIFEST" >"$WORK/am1b.log" 2>&1 || { tail -40 "$WORK/am1b.log"; fail "AM1: aplicarea a picat"; }
NFILES="$(ls "$MIG_DIR"/*.sql | wc -l)"
[ "$(val 'select count(*) from supabase_migrations.schema_migrations')" = "$NFILES" ] || fail "AM1: ledger != $NFILES fișiere"
[ "$(val "$marker289")" = 1 ] && [ "$(val "$marker292")" = 1 ] || fail "AM1: 289/292 neaplicate"
# Rândurile noi poartă version = prefixul fișierului.
newrows=0
for f in $(ls "$MIG_DIR" | sort); do
  [[ "${f:0:14}" < "$CUT" ]] && continue
  [ "$f" = "$F291" ] && continue
  name="${f:15}"; name="${name%.sql}"
  [ "$(val "select count(*) from supabase_migrations.schema_migrations where name = '$name' and version = '${f:0:14}'")" = 1 ] \
    || fail "AM1: rândul de ledger pentru $name nu are version = prefixul"
  newrows=$((newrows + 1))
done
[ "$newrows" -ge 8 ] || fail "AM1: așteptam ≥8 migrații noi (289,290,292..297), am $newrows"
missing="$(val "select (public.get_schema_version(array(select jsonb_array_elements_text('$(cat "$MANIFEST")'::jsonb -> 'names')))) -> 'missing'")"
[ "$missing" = "[]" ] || fail "AM1: get_schema_version(manifest).missing = $missing"
cli --allow-gaps-file "$ALLOW" >"$WORK/am1c.log" 2>&1 || fail "AM1: a doua rulare a picat"
grep -q 'în așteptare: 0' "$WORK/am1c.log" || fail "AM1: a doua rulare nu e no-op"
[ "$(val 'select count(*) from supabase_migrations.schema_migrations')" = "$NFILES" ] || fail "AM1: a doua rulare a scris"
echo "✓ AM1: $newrows migrații aplicate (289,290,292..), ledger = $NFILES, missing = [], re-rulare no-op"

# ── AM3: enum_only + eșec atomic care oprește lotul ─────────────────────────
SYN="$WORK/mig"
mkdir -p "$SYN"
for f in "$MIG_DIR"/*.sql; do ln -s "$f" "$SYN/"; done
db -c "create type public.am_probe_kind as enum ('a')"
cat >"$SYN/29990101000000_migration_998_am_enum_probe.sql" <<'SQL'
-- probă AM3: doar ADD VALUE, fără tranzacție (tiparul mig 254)
alter type public.am_probe_kind add value if not exists 'b';
SQL
cat >"$SYN/29990101000100_migration_999_am_fail_probe.sql" <<'SQL'
begin;
create table public.am_fail_probe (x int);
select 1 / 0;
commit;
SQL
cat >"$SYN/29990101000200_migration_999_am_after_probe.sql" <<'SQL'
begin;
create table public.am_after_probe (x int);
commit;
SQL
set +e
cli --migrations-dir "$SYN" --allow-gaps-file "$ALLOW" >"$WORK/am3.log" 2>&1; rc=$?
set -e
[ "$rc" = 1 ] || { cat "$WORK/am3.log"; fail "AM3: eșecul trebuia să iasă 1, a ieșit $rc"; }
[ "$(val "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'am_probe_kind' and e.enumlabel = 'b'")" = 1 ] || fail "AM3: valoarea enum neaplicată"
[ "$(val "select count(*) from supabase_migrations.schema_migrations where name = 'migration_998_am_enum_probe' and version = '29990101000000'")" = 1 ] || fail "AM3: enum_only fără rând de ledger"
[ "$(val "select count(*) from pg_class where relname = 'am_fail_probe'")" = 0 ] || fail "AM3: fișierul picat a lăsat obiecte"
[ "$(val "select count(*) from supabase_migrations.schema_migrations where name like 'migration_999_%'")" = 0 ] || fail "AM3: fișierul picat a lăsat ledger"
[ "$(val "select count(*) from pg_class where relname = 'am_after_probe'")" = 0 ] || fail "AM3: lotul a continuat după eșec"
echo "✓ AM3: enum_only aplicat + ledger; eșecul s-a anulat complet și a oprit lotul"

# ── AM4: urma în ledger e în ACEEAȘI tranzacție cu fișierul ─────────────────
rm "$SYN"/29990101000100_* "$SYN"/29990101000200_*
db <<'SQL'
create function public.am_block_ledger() returns trigger language plpgsql as $$
begin
  if new.name = 'migration_999_am_ledger_probe' then
    raise exception 'AM4: INSERT de ledger refuzat deliberat';
  end if;
  return new;
end $$;
create trigger am_block_ledger before insert on supabase_migrations.schema_migrations
  for each row execute function public.am_block_ledger();
SQL
cat >"$SYN/29990101000300_migration_999_am_ledger_probe.sql" <<'SQL'
begin;
create table public.am_ledger_probe (x int);
commit;
SQL
set +e
cli --migrations-dir "$SYN" --allow-gaps-file "$ALLOW" >"$WORK/am4.log" 2>&1; rc=$?
set -e
[ "$rc" = 1 ] || { cat "$WORK/am4.log"; fail "AM4: trebuia să iasă 1, a ieșit $rc"; }
[ "$(val "select count(*) from pg_class where relname = 'am_ledger_probe'")" = 0 ] \
  || fail "AM4: fișierul s-a comis FĂRĂ urma lui în ledger (INSERT-ul nu e în tranzacția fișierului)"
echo "✓ AM4: INSERT-ul de ledger picat a anulat și fișierul (aceeași tranzacție)"

# ── AM5: repetiția pe backup restaurat (dry_run / exercițiul de restaurare) ──
# Dump-ul e luat ÎNAINTE de AM1 (288 + 291 + date), deci copia are exact
# golurile producției. Repetiția trebuie să restaureze, să aplice 289,290,292..
# cu același CLI și să treacă poarta de privilegii.
REHEARSAL_DB="${DB}_rehearsal" bash "$REPO_ROOT/scripts/prod-migrations-rehearsal.sh" "$WORK/prod-sim.dump" \
  >"$WORK/am5.log" 2>&1 || { tail -40 "$WORK/am5.log"; fail "AM5: repetiția a picat"; }
RDB="${DB}_rehearsal"
rval() { psql -X -At -v ON_ERROR_STOP=1 -d "$RDB" -c "$1"; }
[ "$(rval 'select count(*) from supabase_migrations.schema_migrations')" = "$NFILES" ] || fail "AM5: ledger-ul copiei != $NFILES"
[ "$(rval "select count(*) from public.restaurants where slug = 'a6-restaurant'")" = 1 ] || fail "AM5: datele nu s-au restaurat"
[ "$(rval "select count(*) from public.restaurant_memberships where restaurant_id = '00000000-0000-4000-8000-00000000a602'")" = 2 ] || fail "AM5: membership-urile nu s-au restaurat"
[ "$(rval "select plan from public.profiles where id = '00000000-0000-4000-8000-00000000a601'")" = pro ] || fail "AM5: planul s-a pierdut (triggere pornite la încărcare?)"
[ "$(rval "select count(*) from pg_trigger where not tgisinternal and tgenabled = 'D'")" = 0 ] || fail "AM5: triggere rămase stinse"
grep -q 'migration_289_reservations_expired' "$WORK/am5.log" || fail "AM5: 289 n-a fost aplicată pe copie"
adm -c "drop database $RDB"
echo "✓ AM5: backup restaurat (date + ledger + identități), 289,290,292.. aplicate pe copie, poarta verde"

adm -c "drop database $DB"
echo "✓ AM1–AM5 verzi"
