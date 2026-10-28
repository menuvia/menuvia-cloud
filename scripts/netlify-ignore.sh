#!/usr/bin/env bash
# scripts/netlify-ignore.sh — comanda `ignore` din netlify.toml.
# =============================================================================
# CONTRACTUL NETLIFY (inversat față de intuiție): exit 0 = build-ul se ANULEAZĂ,
# exit 1 = build-ul RULEAZĂ. O greșeală aici poate opri deploy-urile de
# producție, deci TOT ce e incert duce la exit 1 (build). Teste NI1–NI9:
# tests/netlify-ignore/netlify-ignore.test.mjs (repo git de test, fără rețea).
#
#   • deploy-preview → SKIP întotdeauna (CI-ul verifică PR-urile; previews
#     consumau minute de build pe credite). Branch deploy-urile (ex. viitorul
#     `stripe-test`) și producția NU sunt afectate de regula asta.
#   • `[skip ignore]` în mesajul commit-ului → BUILD forțat (ocolire).
#   • fără bază (CACHED_COMMIT_REF lipsă / necunoscută în clona Netlify) →
#     BUILD; aceeași bază ca acum (redeploy manual, „Clear cache and deploy”)
#     → BUILD; git diff care pică → BUILD.
#   • altfel: SKIP doar dacă TOATE fișierele schimbate sunt sub căi care nu
#     intră în build: docs/, tests/, e2e/, .github/, supabase/, bridge/,
#     deploy/, scripts/, sau *.md din RĂDĂCINĂ. ATENȚIE: menuvia-pack/ INTRĂ
#     în build (LegalPage îl importă cu ?raw) — NU e pe listă.
# Ocolire completă: șterge linia `ignore` din netlify.toml (fișierul bate UI-ul),
# sau `netlify deploy --build` din CLI (comanda ignore nu se aplică acolo).
# =============================================================================
set -u
build() { echo "netlify-ignore: BUILD — $*"; exit 1; }
skip() { echo "netlify-ignore: SKIP — $*"; exit 0; }

[ "${CONTEXT:-}" = "deploy-preview" ] && skip "deploy previews sunt dezactivate (CI-ul verifică PR-urile)"

HEAD_REF="${COMMIT_REF:-HEAD}"
msg="$(git log -1 --format=%B "$HEAD_REF" 2>/dev/null || true)"
case "$msg" in *"[skip ignore]"*) build "commit cu [skip ignore]";; esac

BASE="${CACHED_COMMIT_REF:-}"
[ -n "$BASE" ] || build "fără CACHED_COMMIT_REF (primul build?)"
git cat-file -e "$BASE^{commit}" 2>/dev/null || build "baza $BASE nu e în clonă"
git cat-file -e "$HEAD_REF^{commit}" 2>/dev/null || build "commit-ul $HEAD_REF nu e în clonă"
[ "$(git rev-parse "$BASE")" = "$(git rev-parse "$HEAD_REF")" ] && build "aceeași bază — redeploy deliberat"

changed="$(git diff --name-only "$BASE" "$HEAD_REF" 2>/dev/null)" || build "git diff a picat"
[ -n "$changed" ] || build "diff gol între commit-uri diferite"

while IFS= read -r f; do
  case "$f" in
    docs/*|tests/*|e2e/*|.github/*|supabase/*|bridge/*|deploy/*|scripts/*) ;;
    */*) build "schimbare relevantă: $f" ;;
    *.md) ;;
    *) build "schimbare relevantă: $f" ;;
  esac
done <<<"$changed"
skip "doar căi care nu intră în build ($(echo "$changed" | wc -l) fișiere)"
