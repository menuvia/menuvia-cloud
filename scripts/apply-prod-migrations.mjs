#!/usr/bin/env node
// scripts/apply-prod-migrations.mjs
// =============================================================================
// Aplică pe o bază (producția, sau o copie restaurată în `dry_run`) migrațiile
// din `supabase/migrations/` al căror NUME lipsește din ledger-ul
// `supabase_migrations.schema_migrations`. Toată logica de decizie e în
// `scripts/lib/prod-migrations.mjs` (pură, testată offline: PM1–PM8); aici stă
// doar execuția cu `psql`.
//
//   SUPABASE_DB_URL=postgresql://… node scripts/apply-prod-migrations.mjs \
//     [--dry-run] [--allow-gaps-file scripts/prod-migrations-allow-gaps.json] \
//     [--migrations-dir supabase/migrations] \
//     [--verify-schema netlify/functions/schema-manifest.json] \
//     [--summary-file "$GITHUB_STEP_SUMMARY"] [--output-file "$GITHUB_OUTPUT"]
//
// Ordinea, pentru fiecare fișier în așteptare (ordinea prefixelor):
//   `transactional` → psql -X -v ON_ERROR_STOP=1 -f <fișier + INSERT de ledger
//                     înaintea commit-ului final>; FĂRĂ `-1` (fișierul are
//                     propriul begin/commit; `-1` s-ar termina la commit-ul lui)
//   `enum_only`     → fișierul, apoi INSERT-ul de ledger separat (ADD VALUE IF
//                     NOT EXISTS e idempotent, re-rularea e sigură)
// Se oprește la PRIMUL eșec. Înainte de orice aplicare: forma TUTUROR fișierelor,
// golurile, coliziunile de version, dreptul de INSERT pe ledger — un lot refuzat
// nu atinge baza deloc.
//
// Coduri de ieșire: 0 = ok (sau nimic de aplicat) · 1 = o migrație / verificarea
// de schemă a picat · 2 = refuzat înainte de aplicare (gol, formă, coliziune,
// ledger) · 3 = configurare / conexiune.
//
// URL-ul bazei NU se tipărește niciodată: se validează înainte de psql (un șir
// care nu e URI ar fi interpretat ca key=value și libpq l-ar cita în eroare), iar
// tot ce iese din psql trece prin `redact`.
//
// Rulează NECONDIȚIONAT (fără guard `import.meta.url === argv[1]`, ca
// osv-audit-gate.mjs): un astfel de guard pică tăcut cu exit 0.
// =============================================================================
import { readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  listMigrationFiles,
  migrationName,
  migrationVersion,
  pendingMigrations,
  appliedMigrations,
  assertNoUnexpectedGaps,
  findVersionCollisions,
  parseAllowGaps,
  checkMigrationFile,
  wrapWithLedger,
  ledgerInsertSql,
  validateDbUrl,
  redact,
} from './lib/prod-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

class CliError extends Error {
  constructor(code, msg) {
    super(msg)
    this.exitCode = code
  }
}

function parseArgs(argv) {
  const o = {
    dryRun: false,
    allowGapsFile: null,
    migrationsDir: join(ROOT, 'supabase', 'migrations'),
    verifySchema: null,
    summaryFile: null,
    outputFile: null,
  }
  const takes = new Set(['--allow-gaps-file', '--migrations-dir', '--verify-schema', '--summary-file', '--output-file'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') {
      o.dryRun = true
      continue
    }
    if (!takes.has(a)) throw new CliError(3, `argument necunoscut: ${a}`)
    const v = argv[++i]
    if (!v) throw new CliError(3, `${a} cere o valoare`)
    if (a === '--allow-gaps-file') o.allowGapsFile = resolve(v)
    else if (a === '--migrations-dir') o.migrationsDir = resolve(v)
    else if (a === '--verify-schema') o.verifySchema = resolve(v)
    else if (a === '--summary-file') o.summaryFile = v
    else if (a === '--output-file') o.outputFile = v
  }
  return o
}

const URL_ENV = process.env.SUPABASE_DB_URL || ''
const out = (s) => process.stdout.write(redact(s, URL_ENV) + '\n')
const err = (s) => process.stderr.write(redact(s, URL_ENV) + '\n')

function psql(url, args) {
  const r = spawnSync(process.env.PSQL_BIN || 'psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      PGAPPNAME: 'menuvia-apply-prod-migrations',
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '30',
    },
  })
  // NU se citează niciodată argv-ul (conține URL-ul) — doar codul de eroare.
  if (r.error) throw new CliError(3, `psql nu a putut fi pornit (${r.error.code || 'eroare'})`)
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function psqlValue(url, sql) {
  const r = psql(url, ['-At', '-c', sql])
  if (r.status !== 0) {
    err(r.stderr.trim())
    throw new CliError(3, 'interogarea de control a picat (conexiune sau drepturi)')
  }
  return r.stdout.trim()
}

const PREFLIGHT_SQL = `select json_build_object(
  'exists', to_regclass('supabase_migrations.schema_migrations') is not null,
  'has_version', exists (select 1 from pg_attribute where attrelid = to_regclass('supabase_migrations.schema_migrations') and attname = 'version' and not attisdropped),
  'has_name', exists (select 1 from pg_attribute where attrelid = to_regclass('supabase_migrations.schema_migrations') and attname = 'name' and not attisdropped),
  'can_insert', case when to_regclass('supabase_migrations.schema_migrations') is null then false
                     else has_table_privilege(to_regclass('supabase_migrations.schema_migrations')::oid, 'INSERT') end,
  'server_version', current_setting('server_version_num')
)::text`

const LEDGER_SQL = `select coalesce(json_agg(json_build_object('version', version, 'name', name) order by version), '[]'::json)::text
  from supabase_migrations.schema_migrations`

function summary(opts, md) {
  if (opts.summaryFile) appendFileSync(opts.summaryFile, md + '\n')
}
function output(opts, kv) {
  if (!opts.outputFile) return
  appendFileSync(opts.outputFile, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const url = URL_ENV
  const bad = validateDbUrl(url)
  if (bad) throw new CliError(3, bad)

  const allowGaps = opts.allowGapsFile ? parseAllowGaps(readFileSync(opts.allowGapsFile, 'utf8')) : []
  const files = listMigrationFiles(opts.migrationsDir)
  const known = new Set(files.map(migrationName))
  const unknownAllow = allowGaps.filter((n) => !known.has(n))
  if (unknownAllow.length) {
    throw new CliError(3, `lista de goluri permise numește migrații inexistente: ${unknownAllow.join(', ')}`)
  }

  // ── Preflight pe ledger ──
  const pre = JSON.parse(psqlValue(url, PREFLIGHT_SQL))
  if (!pre.exists || !pre.has_version || !pre.has_name) {
    throw new CliError(2, 'ledger-ul supabase_migrations.schema_migrations lipsește sau n-are coloanele (version, name) — refuz')
  }
  if (!pre.can_insert) throw new CliError(2, 'rolul conectat nu are INSERT pe ledger — refuz (fișierele s-ar aplica fără urmă)')
  const rows = JSON.parse(psqlValue(url, LEDGER_SQL))
  const ledgerNames = rows.map((r) => r.name).filter(Boolean)

  const pending = pendingMigrations(ledgerNames, files)
  const applied = appliedMigrations(ledgerNames, files)
  const unknownLedger = [...new Set(ledgerNames.filter((n) => !known.has(n)))]
  out(`Ledger: ${rows.length} rânduri · fișiere: ${files.length} · aplicate (după nume): ${applied.length} · în așteptare: ${pending.length}`)
  if (unknownLedger.length) out(`ℹ nume din ledger fără fișier (ignorate): ${unknownLedger.join(', ')}`)
  const staleAllow = allowGaps.filter((n) => !pending.some((f) => migrationName(f) === n))
  if (staleAllow.length) {
    out(`::notice::Excepții de gol care nu mai sunt în așteptare (pot fi scoase din listă): ${staleAllow.join(', ')}`)
  }

  // ── Refuzurile, toate ÎNAINTE de prima scriere ──
  let gaps
  try {
    gaps = assertNoUnexpectedGaps(pending, applied, allowGaps)
  } catch (e) {
    summary(opts, `### ⛔ Migrații refuzate\n\n${e.message}\n`)
    throw new CliError(2, e.message)
  }
  if (gaps.length) out(`Goluri PERMISE (lista de excepții): ${gaps.map(migrationName).join(', ')}`)
  const coll = findVersionCollisions(pending, rows)
  if (coll.length) {
    throw new CliError(
      2,
      'prefix deja folosit în ledger de altă migrație: ' +
        coll.map((c) => `${c.file} (version ${c.version} = „${c.ledgerName}”)`).join('; '),
    )
  }
  const shapes = new Map()
  const invalid = []
  for (const f of pending) {
    const shape = checkMigrationFile(f, readFileSync(join(opts.migrationsDir, f), 'utf8'))
    shapes.set(f, shape)
    if (shape.kind === 'invalid') invalid.push(`${f}: ${shape.reason}`)
  }
  if (invalid.length) {
    summary(opts, `### ⛔ Migrații refuzate (formă)\n\n${invalid.map((x) => `- ${x}`).join('\n')}\n`)
    throw new CliError(2, `forma fișierelor nu permite aplicarea automată:\n  ${invalid.join('\n  ')}`)
  }

  for (const f of pending) out(`  • ${f} [${shapes.get(f).kind}]`)
  output(opts, { pending_count: pending.length, pending_names: pending.map(migrationName).join(',') })

  if (opts.dryRun) {
    out(`DRY-RUN: ${pending.length} migrații ar fi aplicate; nimic nu s-a scris.`)
    summary(
      opts,
      `### Plan (dry-run): ${pending.length} migrații în așteptare\n\n` +
        (pending.length ? pending.map((f) => `- \`${migrationName(f)}\` (${shapes.get(f).kind})`).join('\n') : '_nimic_') +
        '\n',
    )
    return 0
  }

  // ── Aplicarea ──
  const tmp = mkdtempSync(join(tmpdir(), 'menuvia-mig-'))
  const done = []
  try {
    for (const f of pending) {
      const name = migrationName(f)
      const version = migrationVersion(f)
      const shape = shapes.get(f)
      const text = readFileSync(join(opts.migrationsDir, f), 'utf8')
      const wrapped = wrapWithLedger(text, { version, name })
      const p = join(tmp, f)
      writeFileSync(p, wrapped)
      out(`── aplic ${f} [${shape.kind}]`)
      const t0 = Date.now()
      const r = psql(url, ['-f', p])
      if (r.stdout.trim()) out(r.stdout.trimEnd())
      if (r.stderr.trim()) err(r.stderr.trimEnd())
      if (r.status !== 0) {
        const why =
          shape.kind === 'transactional'
            ? 'Tranzacția fișierului s-a anulat (ROLLBACK): nimic din el și niciun rând de ledger nu au rămas.'
            : 'Fișier fără tranzacție (doar ADD VALUE IF NOT EXISTS, idempotent): re-rularea e sigură.'
        summary(
          opts,
          `### ✗ Aplicarea s-a oprit la \`${name}\`\n\n${why}\n\nAplicate înainte de eșec: ${done.length ? done.map((n) => `\`${n}\``).join(', ') : '_niciuna_'}.\n`,
        )
        throw new CliError(1, `${f} a picat (psql exit ${r.status}). ${why} Fișierele de după NU au fost atinse.`)
      }
      if (shape.kind === 'enum_only') {
        const li = psql(url, ['-c', ledgerInsertSql({ version, name })])
        if (li.status !== 0) {
          err(li.stderr.trimEnd())
          throw new CliError(1, `${f} s-a aplicat, dar INSERT-ul de ledger a picat — re-rularea e sigură (idempotent)`)
        }
      }
      // Urma trebuie să existe: altfel fișierul ar fi re-aplicat la următoarea rulare.
      const has = psqlValue(url, `select count(*) from supabase_migrations.schema_migrations where name = '${name}'`)
      if (has === '0') throw new CliError(1, `${f} s-a aplicat, dar rândul de ledger LIPSEȘTE`)
      done.push(name)
      out(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  output(opts, { applied_count: done.length, applied_names: done.join(',') })
  summary(
    opts,
    `### Migrații aplicate: ${done.length}\n\n` + (done.length ? done.map((n) => `- \`${n}\``).join('\n') : '_nimic de aplicat_') + '\n',
  )

  // ── Verificarea finală: sonda /health (mig 271) nu mai vede nimic lipsă ──
  if (opts.verifySchema) {
    const m = JSON.parse(readFileSync(opts.verifySchema, 'utf8'))
    const names = Array.isArray(m) ? m : m.names
    if (!Array.isArray(names) || !names.length || names.some((n) => !/^[A-Za-z0-9_]+$/.test(n))) {
      throw new CliError(3, 'manifestul de schemă nu are o listă validă de nume')
    }
    const sql = `select public.get_schema_version(array[${names.map((n) => `'${n}'`).join(',')}]::text[])::text`
    const v = JSON.parse(psqlValue(url, sql))
    if (v.available !== true || !Array.isArray(v.missing)) {
      throw new CliError(1, 'get_schema_version nu e disponibilă după aplicare')
    }
    if (v.missing.length) {
      summary(opts, `### ✗ Schema rămâne în urmă\n\nLipsesc: ${v.missing.map((n) => `\`${n}\``).join(', ')}\n`)
      throw new CliError(1, `după aplicare, ledger-ul încă nu are: ${v.missing.join(', ')}`)
    }
    out(`✓ get_schema_version(manifest).missing = [] (${names.length} nume)`)
  }
  return 0
}

try {
  process.exitCode = main()
} catch (e) {
  const code = e instanceof CliError ? e.exitCode : 3
  err(`\nEȘEC (${code}): ${e && e.message ? e.message : e}`)
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::error::${redact(String(e && e.message ? e.message : e), URL_ENV).split('\n')[0]}\n`)
  }
  process.exitCode = code
}
