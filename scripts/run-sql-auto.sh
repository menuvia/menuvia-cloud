#!/usr/bin/env bash
# scripts/run-sql-auto.sh <conninfo>
# =============================================================================
# Rulează FIECARE fișier din tests/sql/auto/*.sql (ordine lexicografică, colatie
# C) cu `psql -X -v ON_ERROR_STOP=1`, pe baza dată. Legat în AMBELE joburi —
# sql-verify.yml (Postgres gol, după fixture) și jobul E2E din ci.yml (stack-ul
# Supabase real) — și în scripts/verify-migrations-local.sh.
#
# De ce există: fiecare suită nouă cerea până acum un pas nou în DOUĂ fișiere
# YAML partajate — conflict sigur între PR-uri paralele. O suită nouă se pune
# acum doar ca fișier aici. Contractul unui fișier din auto/: autonom (își
# face singur fixture-ul, în tranzacție sau cu nume unice), `\set ON_ERROR_STOP
# on` nu e necesar (îl pune runner-ul), trece pe AMBELE medii.
#
# PICĂ dacă directorul e GOL: o poartă moartă nu are voie să treacă drept
# acoperire (clasa suitelor „de eră” A1–A8/F1–F9, ȘTERSE în RES-07).
# Rulează TOATE fișierele și raportează toate eșecurile, apoi iese ≠ 0.
# =============================================================================
set -uo pipefail
CONN="${1:?folosire: run-sql-auto.sh <conninfo>}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tests/sql/auto"
mapfile -t FILES < <(find "$DIR" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "✗ tests/sql/auto/ e GOL — rularea automată nu verifică nimic. O poartă moartă nu trece drept acoperire."
  exit 1
fi
pass=0; failed=()
for f in "${FILES[@]}"; do
  echo "── tests/sql/auto/$f"
  if psql "$CONN" -X -q -v ON_ERROR_STOP=1 -f "$DIR/$f"; then
    pass=$((pass + 1))
  else
    failed+=("$f")
  fi
done
echo "── tests/sql/auto: $pass PASS / ${#failed[@]} FAIL"
if [ "${#failed[@]}" -gt 0 ]; then
  printf '✗ %s\n' "${failed[@]}"
  exit 1
fi
