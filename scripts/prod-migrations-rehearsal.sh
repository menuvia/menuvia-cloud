#!/usr/bin/env bash
# scripts/prod-migrations-rehearsal.sh <dump.-Fc>
# =============================================================================
# REPETIȚIA aplicării pe o copie a producției + exercițiul de restaurare (PR-0).
# Restaurează un backup `pg_dump -Fc` (cel zilnic din db-backup.yml sau cel
# făcut chiar acum, înaintea aplicării) într-un Postgres EFEMER, aplică pe el
# migrațiile în așteptare cu ACELAȘI CLI ca pe producție și rulează poarta
# read-only de privilegii. Un backup care n-a fost restaurat niciodată nu e un
# backup; o migrație care n-a rulat niciodată peste datele reale e o speranță.
#
# Ținta: conexiunea din PGHOST/PGPORT/PGUSER/PGPASSWORD, baza $REHEARSAL_DB
# (implicit `rehearsal`; se RECREEAZĂ). NU atinge producția — dump-ul e singura
# intrare.
#
# Urmează docs/RUNBOOK.md §6.2 (replay al lanțului → date `--data-only` cu
# triggerele dezactivate PE NUME → re-activare → poartă), cu adaptările
# IMPUSE de un Postgres de CI (nu e un proiect Supabase):
#   • replay-ul e DOAR al migrațiilor din ledger-ul DUMP-ULUI (în ordinea
#     fișierelor) — schema producției, nu a lui main; cele în așteptare le pune
#     CLI-ul, exact ca pe prod. Ledger-ul se restaurează din dump (schemă+date).
#   • `auth`/`storage` sunt mock-urile din sql-verify.yml: din `auth.users`,
#     `storage.buckets/objects` intră doar coloanele pe care mock-ul le are
#     (id, email, metadate) — FK-urile `profiles`/`memberships` → `auth.users`
#     sunt satisfăcute, parolele/identitățile/factorii MFA NU se restaurează.
#   • NU se restaurează: sesiuni/token-uri, `vault`, `realtime`, `cron`
#     (pg_cron nu există în CI; mig 274 sare cu NOTICE), fișierele din storage.
#   • rolurile și default-ACL-urile de platformă vin din bootstrap-ul mock, nu
#     din Supabase (RUNBOOK §6.1 punctul 3).
# Deci: date `public` + `archive` + ledger + identitatea utilizatorilor =
# restaurare REALĂ; restul platformei Supabase = simulat. Consemnat și în
# rezumatul jobului.
# =============================================================================
set -euo pipefail

DUMP="${1:?folosire: prod-migrations-rehearsal.sh <dump -Fc>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/sql-verify.yml"
MIG_DIR="$REPO_ROOT/supabase/migrations"
DB="${REHEARSAL_DB:-rehearsal}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
: "${PGHOST:?PGHOST lipsește}"; : "${PGUSER:=postgres}"; : "${PGPORT:=5432}"
export PGHOST PGUSER PGPORT

adm() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
val() { psql -X -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
say() { echo "── $*"; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >>"$GITHUB_STEP_SUMMARY" || true; }

pg_restore --list "$DUMP" >"$WORK/toc.txt" || { echo "✗ arhiva nu e lizibilă (pg_restore --list)"; exit 1; }
grep -q ' TABLE DATA supabase_migrations schema_migrations ' "$WORK/toc.txt" \
  || { echo "✗ dump-ul nu conține ledger-ul supabase_migrations.schema_migrations"; exit 1; }

say "baza efemeră $DB + bootstrap Supabase-compat (extras din sql-verify.yml)"
adm -c "drop database if exists $DB" -c "create database $DB"
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

say "ledger-ul din dump (schemă + date)"
pg_restore -n supabase_migrations --no-owner --no-privileges -f "$WORK/ledger.sql" "$DUMP"
db -c "create schema if not exists supabase_migrations"   # `-n` nu emite CREATE SCHEMA
db -f "$WORK/ledger.sql" >/dev/null
LEDGER_N="$(val 'select count(*) from supabase_migrations.schema_migrations')"
[ "$LEDGER_N" -gt 0 ] || { echo "✗ ledger-ul din dump e gol"; exit 1; }

say "replay DOAR al migrațiilor din ledger ($LEDGER_N rânduri), în ordinea fișierelor"
val "select name from supabase_migrations.schema_migrations where name is not null" | sort -u >"$WORK/applied.txt"
n=0
for f in $(ls "$MIG_DIR" | sort); do
  name="${f:15}"; name="${name%.sql}"
  grep -qxF "$name" "$WORK/applied.txt" || continue
  db -f "$MIG_DIR/$f" >"$WORK/mig.log" 2>&1 || { tail -20 "$WORK/mig.log"; echo "✗ replay: $f"; exit 1; }
  n=$((n + 1))
done
echo "  $n fișiere re-jucate"

say "triggerele ne-interne, dezactivate PE NUME (RUNBOOK §6.2 pasul 4)"
val "select format('alter table %I.%I disable trigger %I;', n.nspname, c.relname, t.tgname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal order by 1" >"$WORK/disable.sql"
sed 's/ disable trigger / enable trigger /' "$WORK/disable.sql" >"$WORK/enable.sql"
db -f "$WORK/disable.sql"
echo "  $(wc -l <"$WORK/disable.sql") triggere"

say "golește rândurile semănate de lanț (RUNBOOK §6.2 pasul 3)"
db <<'SQL'
do $$
declare t text;
begin
  foreach t in array array['public.plan_features','public.plan_limits','public.platform_settings',
                           'public.gdpr_deletion_config','public.pg_cron_janitor_manifest',
                           'public.vat_rate_presets'] loop
    if to_regclass(t) is not null then execute format('truncate %s cascade', t); end if;
  end loop;
  delete from storage.objects;
  delete from storage.buckets;
end $$;
SQL

say "identitățile: auth.users / storage (doar coloanele mock-ului)"
# Fiecare tabelă intră într-o tabelă de staging cu TOATE coloanele dump-ului
# (text), apoi în ținta mock pe INTERSECȚIA coloanelor, cu cast la tipul țintei.
load_subset() { # <schema> <table>
  local s="$1" t="$2" f="$WORK/$1.$2.sql"
  grep -q " TABLE DATA $s $t " "$WORK/toc.txt" || { echo "  ($s.$t lipsește din dump)"; return 0; }
  pg_restore -n "$s" -t "$t" --data-only -f "$f" "$DUMP"
  local cols
  cols="$(grep -m1 -oP "^COPY $s\.$t \(\K[^)]*" "$f")"
  [ -n "$cols" ] || { echo "  ($s.$t fără COPY — 0 rânduri)"; return 0; }
  local ddl
  ddl="$(echo "$cols" | tr ',' '\n' | sed 's/^ *//; s/$/ text/' | paste -sd, -)"
  db -c "set client_min_messages = warning; drop table if exists public._rehearsal_stage; create table public._rehearsal_stage ($ddl)"
  sed "s/^COPY $s\.$t (/COPY public._rehearsal_stage (/" "$f" | db >/dev/null
  db <<SQL
do \$\$
declare v_cols text; v_sel text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(format('%I::%s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' order by a.attnum)
    into v_cols, v_sel
    from pg_attribute a
   where a.attrelid = '$s.$t'::regclass and a.attnum > 0 and not a.attisdropped
     and exists (select 1 from pg_attribute b where b.attrelid = 'public._rehearsal_stage'::regclass
                  and b.attname = a.attname and b.attnum > 0);
  execute format('insert into %I.%I (%s) select %s from public._rehearsal_stage', '$s', '$t', v_cols, v_sel);
end \$\$;
drop table public._rehearsal_stage;
SQL
  echo "  $s.$t: $(val "select count(*) from $s.$t") rânduri (coloane: $(val "select string_agg(attname, ',') from pg_attribute where attrelid = '$s.$t'::regclass and attnum > 0 and not attisdropped"))"
}
load_subset auth users
load_subset storage buckets
load_subset storage objects

say "datele aplicației: public + archive (--data-only, RUNBOOK §6.2 pasul 5–6)"
grep -E ' (TABLE DATA|SEQUENCE SET) (public|archive) ' "$WORK/toc.txt" >"$WORK/restore.list" || true
if [ -s "$WORK/restore.list" ]; then
  pg_restore -L "$WORK/restore.list" --data-only --no-owner -f "$WORK/data_only.sql" "$DUMP"
  # Ordinea din arhivă e alfabetică, nu pe FK-uri. Aici (Postgres de CI) suntem
  # superuser, deci încărcarea rulează cu `session_replication_role = replica`
  # (oprește și triggerele RI ale FK-urilor) — pe Supabase gestionat GUC-ul cere
  # superuser și RUNBOOK §6.2 rămâne pe varianta cu triggerele numite. Datele
  # vin dintr-un dump CONSISTENT, deci FK-urile sunt satisfăcute la final;
  # paritatea de mai jos și poarta o verifică.
  PGOPTIONS='-c session_replication_role=replica' db -f "$WORK/data_only.sql" >/dev/null
fi
echo "  $(grep -c 'TABLE DATA' "$WORK/restore.list" || true) tabele"

say "re-activează triggerele (pasul 7)"
db -f "$WORK/enable.sql"
dis="$(val "select count(*) from pg_trigger where not tgisinternal and tgenabled = 'D'")"
[ "$dis" = 0 ] || { echo "✗ $dis triggere au rămas dezactivate"; exit 1; }

say "paritate minimă de date (pasul 8)"
for t in restaurants orders profiles restaurant_memberships audit_log; do
  echo "  $t: $(val "select count(*) from public.$t")"
done
inv="$(val "select count(*) from public.restaurants r where (select count(*) from public.restaurant_memberships m where m.restaurant_id = r.id and m.role = 'owner' and m.user_id = r.owner_id) <> 1")"
[ "$inv" = 0 ] || { echo "✗ $inv restaurante fără EXACT un owner membership aliniat"; exit 1; }

say "aplic migrațiile în așteptare pe copie, cu ACELAȘI CLI"
if [[ "$PGHOST" == /* ]]; then
  export SUPABASE_DB_URL="postgresql:///$DB?host=$PGHOST&port=$PGPORT&user=$PGUSER"
else
  export SUPABASE_DB_URL="postgresql://$PGUSER:${PGPASSWORD:-}@$PGHOST:$PGPORT/$DB"
fi
node "$REPO_ROOT/scripts/apply-prod-migrations.mjs" \
  --allow-gaps-file "$REPO_ROOT/scripts/prod-migrations-allow-gaps.json" \
  --verify-schema "$REPO_ROOT/netlify/functions/schema-manifest.json" \
  --output-file "$WORK/cli.out"
applied="$(grep '^applied_names=' "$WORK/cli.out" | tail -1 | cut -d= -f2-)"

say "poarta read-only de privilegii pe copie (RUNBOOK §6.3)"
db -f "$REPO_ROOT/tests/sql/privilege_regime_assertions.sql" >"$WORK/gate.log" 2>&1 \
  || { tail -20 "$WORK/gate.log"; echo "✗ poarta de privilegii a picat pe copie"; exit 1; }

summary "### 🧪 Repetiția pe backup restaurat: verde"
summary ""
summary "- ledger din dump: $LEDGER_N rânduri; re-jucate: $n fișiere; aplicate pe copie: ${applied:-niciuna}"
summary "- restaurate REAL: datele \`public\` + \`archive\`, ledger-ul, \`auth.users\` (id/email/metadate); SIMULAT: restul platformei Supabase (roluri, auth/storage complete, pg_cron, vault)"
summary "- poarta de privilegii (RP1–RP13): verde pe copie"
echo "✓ repetiție verde: $n re-jucate, aplicate: ${applied:-niciuna}"
