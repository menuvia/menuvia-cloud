#!/usr/bin/env bash
#
# Poarta de securitate pe dependențele de PRODUCȚIE (cele care ajung în bundle).
# Înlocuiește `npm audit --omit=dev --audit-level=high` rulat direct în CI.
#
# DE CE un wrapper:
# Arborele nostru de producție conține un ALIAS — `web-vitals-soft-navs:
# npm:web-vitals@6.2.1`, adus de `posthog-js`. npm nu poate exprima aliasurile
# în endpoint-ul modern `security/advisories/bulk`, deci cade pe endpoint-ul
# legacy `security/audits/quick`, pe care registry-ul îl RETRAGE („This endpoint
# is being retired. Use the bulk advisory endpoint instead.").
# Dovada că e transport, nu lockfile (3 sept 2026): ACELAȘI package-lock.json a
# trecut pe main în 58 s la 22:08 și a picat pe PR la 23:12 cu 400 „Invalid
# package tree" după 5 minute de așteptare. Zero diferență în arbore.
#
# REGULA (lecția CA-01 din auditul v3 — o poartă stinsă tăcut e mai rea decât
# una lipsă): eșecul de TRANSPORT se reîncearcă cu backoff; o vulnerabilitate
# găsită NU se reîncearcă și NU se înghite — ieșim cu 1. Dacă endpoint-ul
# rămâne mort după toate încercările, tot ieșim cu 1, dar cu un mesaj care
# spune explicit că poarta NU a fost evaluată (nu „e curat").

set -uo pipefail

ATTEMPTS="${AUDIT_ATTEMPTS:-4}"
BACKOFF="${AUDIT_BACKOFF:-10}"
# Plafon PER ÎNCERCARE. `npm audit` nu are timeout propriu pe cererea către
# registry: pe endpoint-ul degradat a stat 5 minute înainte de 400, iar
# reîncercările fără plafon ar fi înmulțit blocajul (4 × 5 min). Cu plafon,
# cel mai prost caz devine ~8 minute și o zi bună costă ~1 secundă.
# 120 s e peste cel mai lent răspuns REUȘIT observat (58 s pe main), deci nu
# taie un endpoint lent-dar-viu.
TIMEOUT="${AUDIT_TIMEOUT:-120}"

# Clasifică raportul primit pe stdin: OK / VULN <detalii> / TRANSPORT.
classify() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => {
      let j;
      try { j = JSON.parse(raw); } catch { console.log("TRANSPORT"); return; }
      const v = j && j.metadata && j.metadata.vulnerabilities;
      if (!v) { console.log("TRANSPORT"); return; }
      const bad = (v.high || 0) + (v.critical || 0);
      if (bad === 0) { console.log("OK"); return; }
      const names = Object.keys(j.vulnerabilities || {})
        .filter((k) => ["high", "critical"].includes(j.vulnerabilities[k].severity))
        .join(", ");
      console.log("VULN " + bad + " (" + names + ")");
    });
  '
}

for i in $(seq 1 "$ATTEMPTS"); do
  # Două plafoane, fiindcă unul singur nu ajunge:
  #  - `--fetch-retries=0 --fetch-timeout` opresc bucla INTERNĂ de reîncercări a
  #    lui npm (default 2 reîncercări cu backoff exponențial până la 60 s
  #    fiecare) — fără ele, o singură comandă `npm audit` poate sta minute bune
  #    și plafonul nostru extern devine primul care taie, nu ultimul.
  #  - `timeout -k 10s` e plasa: trimite SIGTERM la depășire și SIGKILL după
  #    încă 10 s, ca un proces care ignoră SIGTERM blocat într-o citire de rețea
  #    să nu țină jobul la nesfârșit (fără `-k`, `timeout` așteaptă la infinit).
  # `timeout` întoarce 124 la depășire; ieșirea parțială e text incomplet, deci
  # cade oricum pe ramura TRANSPORT a clasificatorului.
  report="$(timeout -k 10s "$TIMEOUT" \
    npm audit --omit=dev --json --fetch-retries=0 --fetch-timeout=30000 \
    2>/dev/null || true)"
  verdict="$(printf '%s' "$report" | classify)"

  case "$verdict" in
    OK)
      echo "Audit securitate: 0 vulnerabilități high/critical în deps de producție."
      exit 0
      ;;
    VULN*)
      echo "Audit securitate: ${verdict#VULN }" >&2
      echo "Rulează 'npm audit --omit=dev' local pentru detalii." >&2
      exit 1
      ;;
    *)
      echo "Încercarea $i/$ATTEMPTS: endpoint-ul de audit npm nu a răspuns cu un raport valid (plafon ${TIMEOUT}s)." >&2
      if [ "$i" -lt "$ATTEMPTS" ]; then
        sleep $(( BACKOFF * i ))
      fi
      ;;
  esac
done

echo "EȘEC: endpoint-ul de audit npm nu a răspuns după $ATTEMPTS încercări." >&2
echo "Poarta de securitate NU a fost evaluată — asta NU înseamnă 'curat'." >&2
exit 1
