#!/usr/bin/env node
// scripts/prod-migrations-gate.mjs
// =============================================================================
// Poarta aplicării automate a migrațiilor pe producție (PR-0). Rulează în jobul
// `gate` din .github/workflows/apply-prod-migrations.yml, FĂRĂ secrete, și
// decide dacă jobul `apply` (environment `production`) are voie să pornească.
//
// Evaluează commit-ul TARGET_SHA (vârful lui main la momentul evenimentului —
// `github.sha` pe workflow_run / workflow_dispatch), NU commit-ul run-ului care
// ne-a trezit: trezirile vin de la trei workflow-uri (CI, Tests & Quality, SQL
// Migrations Verify), iar concurrency-ul GitHub înlocuiește run-urile în
// așteptare — dacă am judeca SHA-ul trezirii, o trezire veche care a înlocuit
// una nouă ar lăsa vârful neaplicat până la următorul push.
//
// Cere, pentru TARGET_SHA, run-uri de `push` pe `main`:
//   • CI (ci.yml) și Tests & Quality (test.yml): cel mai recent = success;
//   • SQL Migrations Verify (sql-verify.yml): success pe commit SAU — fiindcă
//     workflow-ul are filtru de căi și nu rulează pe orice commit — un run verde
//     pe un STRĂMOȘ, iar între ei nicio cale din filtrul lui nu s-a schimbat
//     (filtrul e citit din sql-verify.yml: sursă unică).
//
// Ieșiri (GITHUB_OUTPUT): go=true|false, sha=<TARGET_SHA>. Exit 0 pe orice
// decizie; exit 1 doar pe eroare (API/git) — vizibil, și nu se aplică nimic.
// =============================================================================
import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestRunVerdict, decideGate, parsePushPaths, pathsMatching } from './lib/prod-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'
const { GITHUB_TOKEN, GITHUB_REPOSITORY, TARGET_SHA, TARGET_REF, PAUSED } = process.env

function setOutput(kv) {
  const line = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line)
  process.stdout.write(line)
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
}

async function gh(path) {
  const res = await fetch(`${API}/repos/${GITHUB_REPOSITORY}${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'menuvia-prod-migrations-gate',
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} pe ${path.split('?')[0]}`)
  return res.json()
}

const runsFor = async (wf, sha) =>
  (await gh(`/actions/workflows/${wf}/runs?head_sha=${sha}&event=push&branch=main&per_page=50`)).workflow_runs || []

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })

async function sqlCoverage(sha) {
  const last = (await gh('/actions/workflows/sql-verify.yml/runs?branch=main&event=push&status=success&per_page=1'))
    .workflow_runs?.[0]
  if (!last) return { covered: false, reason: 'niciun run verde de SQL verify pe main' }
  const base = last.head_sha
  try {
    git('merge-base', '--is-ancestor', base, sha)
  } catch {
    return { covered: false, reason: `ultimul SQL verify verde (${base.slice(0, 7)}) nu e strămoș` }
  }
  const patterns = parsePushPaths(readFileSync(join(ROOT, '.github', 'workflows', 'sql-verify.yml'), 'utf8'))
  const changed = git('diff', '--name-only', base, sha).split('\n').filter(Boolean)
  const touched = pathsMatching(changed, patterns)
  if (touched.length) {
    return { covered: false, reason: `de la ${base.slice(0, 7)} s-au schimbat căi SQL: ${touched.slice(0, 5).join(', ')}` }
  }
  return { covered: true, from: base }
}

async function main() {
  if (!/^[0-9a-f]{40}$/.test(TARGET_SHA || '')) throw new Error('TARGET_SHA lipsă sau invalid')
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) throw new Error('GITHUB_TOKEN / GITHUB_REPOSITORY lipsă')
  if (PAUSED === 'true') {
    process.stdout.write('::warning::Aplicarea automată e în PAUZĂ (variabila PROD_MIGRATIONS_PAUSED=true).\n')
    summary('### ⏸ Aplicarea automată a migrațiilor e în pauză\n\nVariabila de repo `PROD_MIGRATIONS_PAUSED=true`. Șterge-o (sau pune `false`) ca să reia.')
    setOutput({ go: 'false', sha: TARGET_SHA })
    return
  }
  const [ci, tests, sqlRuns] = await Promise.all([
    runsFor('ci.yml', TARGET_SHA),
    runsFor('test.yml', TARGET_SHA),
    runsFor('sql-verify.yml', TARGET_SHA),
  ])
  const v = {
    ref: TARGET_REF,
    ci: latestRunVerdict(ci, TARGET_SHA),
    tests: latestRunVerdict(tests, TARGET_SHA),
    sql: latestRunVerdict(sqlRuns, TARGET_SHA),
  }
  if (v.sql === 'absent') v.sqlCoverage = await sqlCoverage(TARGET_SHA)
  const d = decideGate(v)
  const short = TARGET_SHA.slice(0, 7)
  const table =
    `| Verificare | Rezultat |\n|---|---|\n| CI | ${v.ci} |\n| Tests & Quality | ${v.tests} |\n| SQL verify | ${v.sql}` +
    (v.sqlCoverage ? (v.sqlCoverage.covered ? ` (acoperit de ${v.sqlCoverage.from.slice(0, 7)})` : ` — ${v.sqlCoverage.reason}`) : '') +
    ' |\n'
  if (d.go) {
    process.stdout.write(`Poarta DESCHISĂ pentru ${short}\n`)
    summary(`### ✅ Poarta deschisă pentru \`${short}\`\n\n${table}`)
  } else {
    // „pending” e normal: workflow-ul se trezește din nou când run-ul se termină.
    const kind = d.pending ? 'notice' : 'warning'
    process.stdout.write(`::${kind}::Migrațiile NU se aplică pe ${short}: ${d.reasons.join('; ')}\n`)
    summary(`### ⏭ Nu se aplică nimic pe \`${short}\`\n\n${d.reasons.map((r) => `- ${r}`).join('\n')}\n\n${table}`)
  }
  setOutput({ go: String(d.go), sha: TARGET_SHA })
}

main().catch((e) => {
  process.stdout.write(`::error::Poarta migrațiilor NU a putut fi evaluată: ${e && e.message ? e.message : e}\n`)
  try {
    setOutput({ go: 'false', sha: TARGET_SHA || '' })
  } catch {
    /* fără GITHUB_OUTPUT */
  }
  process.exit(1)
})
