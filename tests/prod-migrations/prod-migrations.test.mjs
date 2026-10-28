// tests/prod-migrations/prod-migrations.test.mjs
// Logica PURĂ a aplicării automate pe producție (PR-0). Zero deps, fără bază:
//   node --test tests/prod-migrations/
// Integrarea cu un Postgres real (AM1–AM4) stă în am-integration.sh, legat în
// sql-verify.yml.
//
// ATENȚIE la nume: PM1–PM10 de aici sunt teste JS ale PR-0 și NU au legătură cu
// PM1–PM10 din tests/sql/payments_by_method_assertions.sql (mig 267). Prefixul
// fișierului de test le desparte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  migrationName,
  migrationVersion,
  listMigrationFiles,
  pendingMigrations,
  appliedMigrations,
  assertNoUnexpectedGaps,
  findVersionCollisions,
  parseAllowGaps,
  classifyShape,
  checkMigrationFile,
  wrapWithLedger,
  ledgerInsertSql,
  scanSql,
  validateDbUrl,
  redact,
  latestRunVerdict,
  ghGlobToRegExp,
  parsePushPaths,
  pathsMatching,
  decideGate,
} from '../../scripts/lib/prod-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIG = join(ROOT, 'supabase', 'migrations')
const F = (n, slug = 'x', ts) => `${ts || `20261001${String(n).padStart(6, '0')}`}_migration_${n}_${slug}.sql`

// ── PM1: numele = exact derivarea manifestului (SM1) ───────────────────────
test('PM1: migrationName == derivarea din gen-schema-manifest / SM1, pe toate fișierele reale', () => {
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql'))
  const sm1 = files.map((f) => f.replace(/^\d{14}_/, '').replace(/\.sql$/, '')).sort()
  assert.deepEqual(files.map(migrationName).sort(), sm1)
  const manifest = JSON.parse(readFileSync(join(ROOT, 'netlify', 'functions', 'schema-manifest.json'), 'utf8'))
  assert.deepEqual([...manifest.names].sort(), sm1)
  assert.equal(migrationName('20261001120000_migration_289_reservations_expired.sql'), 'migration_289_reservations_expired')
  assert.equal(migrationVersion('20261001120000_migration_289_reservations_expired.sql'), '20261001120000')
  assert.throws(() => migrationName('2026100112000_migration_289_x.sql'), /14 cifre/)
  assert.throws(() => migrationName('migration_289_x.sql'), /14 cifre/)
  // gen-schema-manifest.mjs IMPORTĂ derivarea de aici — o singură definiție.
  assert.match(readFileSync(join(ROOT, 'scripts', 'gen-schema-manifest.mjs'), 'utf8'), /import \{ migrationName \} from '\.\/lib\/prod-migrations\.mjs'/)
  assert.equal(listMigrationFiles(MIG).length, files.length)
})

// ── PM2: pending după NUME, nu după version ─────────────────────────────────
test('PM2: o migrație aplicată prin MCP (version = momentul aplicării) NU e în așteptare', () => {
  const files = [F(288, 'a'), F(289, 'b'), F(290, 'c')]
  const ledger = [
    { version: '20261003075533', name: 'migration_288_a' }, // version ≠ prefix
    { version: '20261001000290', name: 'altceva' }, // prefixul lui 290, alt nume
  ]
  const pending = pendingMigrations(ledger.map((r) => r.name), files)
  assert.deepEqual(pending, [F(289, 'b'), F(290, 'c')])
  assert.deepEqual(appliedMigrations(ledger.map((r) => r.name), files), [F(288, 'a')])
  // același prefix, alt nume → coliziune (INSERT-ul ar lovi cheia primară)
  assert.deepEqual(findVersionCollisions(pending, ledger), [
    { file: F(290, 'c'), version: '20261001000290', ledgerName: 'altceva' },
  ])
})

// ── PM3: golurile ───────────────────────────────────────────────────────────
test('PM3: un gol nepermis e refuzat; unul din listă e acceptat; fără gol nu se cere nimic', () => {
  const files = [F(288), F(289, 'r'), F(290, 'p'), F(291, 'm'), F(292, 'q')]
  const applied = [F(288), F(291, 'm')]
  const pending = [F(289, 'r'), F(290, 'p'), F(292, 'q')]
  assert.throws(() => assertNoUnexpectedGaps(pending, applied, []), (e) => e.code === 'UNEXPECTED_GAP' && /migration_289_r/.test(e.message))
  assert.throws(() => assertNoUnexpectedGaps(pending, applied, ['migration_289_r']), /migration_290_p/)
  assert.deepEqual(assertNoUnexpectedGaps(pending, applied, ['migration_289_r', 'migration_290_p']), [F(289, 'r'), F(290, 'p')])
  // 292 e după ultima aplicată → nu e gol
  assert.deepEqual(assertNoUnexpectedGaps([F(292, 'q')], files.slice(0, 4), []), [])
  assert.deepEqual(assertNoUnexpectedGaps(pending, [], []), [])
  // lista comisă: nume existente, exact golul 289/290
  const allow = parseAllowGaps(readFileSync(join(ROOT, 'scripts', 'prod-migrations-allow-gaps.json'), 'utf8'))
  const names = new Set(readdirSync(MIG).filter((f) => f.endsWith('.sql')).map(migrationName))
  for (const n of allow) assert.ok(names.has(n), `excepția ${n} nu e o migrație existentă`)
  assert.deepEqual(allow, ['migration_289_reservations_expired', 'migration_290_plan_dead_data'])
  assert.throws(() => parseAllowGaps('{"a":1}'), /array/)
  assert.throws(() => parseAllowGaps('["x; drop table y"]'), /invalidă/)
})

// ── PM4: forma ──────────────────────────────────────────────────────────────
test('PM4: două commit-uri, zero commit-uri (ne-enum), rollback, instrucțiuni în afara tranzacției → invalid', () => {
  const bad = {
    'două commit-uri': 'begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;\n',
    'commit dublat': 'begin;\nselect 1;\ncommit;\ncommit;\n',
    'begin dublat': 'begin;\nbegin;\nselect 1;\ncommit;\n',
    'fără commit': 'begin;\nselect 1;\n',
    'fără nimic tranzacțional': 'create table t(x int);\n',
    'înainte de begin': 'select 1;\nbegin;\nselect 2;\ncommit;\n',
    'după commit': 'begin;\nselect 1;\ncommit;\nselect 2;\n',
    rollback: 'begin;\nselect 1;\nrollback;\n',
    'commit and chain': 'begin;\nselect 1;\ncommit and chain;\n',
    gol: '-- doar comentariu\n',
    'șir neînchis': "begin;\nselect 'x;\ncommit;\n",
  }
  for (const [k, sql] of Object.entries(bad)) assert.equal(classifyShape(sql).kind, 'invalid', k)
  assert.equal(classifyShape('begin;\nset local lock_timeout = \'10s\';\nselect 1;\ncommit;\n').kind, 'transactional')
  assert.equal(classifyShape('BEGIN;\nselect 1;\nEND;\n').kind, 'transactional')
  const en = "-- mig 254\nalter type public.email_template_kind add value if not exists 'reservation_created';\n"
  assert.equal(classifyShape(en).kind, 'enum_only')
  assert.equal(classifyShape("alter type public.k add value 'x';\n").kind, 'invalid', 'fără IF NOT EXISTS nu e re-rulabil')
  assert.equal(classifyShape("alter type public.k add value if not exists 'x';\ncomment on type public.k is 'y';\n").kind, 'invalid')
})

// ── PM5: poziția INSERT-ului de ledger ───────────────────────────────────────
test('PM5: INSERT-ul de ledger stă ÎNAINTEA commit-ului final, nu la sfârșit', () => {
  const sql = 'begin;\ncreate table t(x int);\n-- final\ncommit;\n-- coadă\n'
  const w = wrapWithLedger(sql, { version: '20261001120000', name: 'migration_289_x' })
  const ins = "insert into supabase_migrations.schema_migrations (version, name) values ('20261001120000', 'migration_289_x');"
  assert.ok(w.indexOf(ins) > 0)
  assert.ok(w.indexOf(ins) < w.lastIndexOf('commit;'), 'INSERT-ul trebuie să fie înainte de commit')
  assert.ok(w.endsWith('commit;\n-- coadă\n'), 'restul fișierului rămâne neatins')
  // fișierul înfășurat rămâne tranzacțional, cu INSERT-ul ca penultimă instrucțiune
  const st = scanSql(w).statements
  assert.equal(classifyShape(w).kind, 'transactional')
  assert.equal(st[st.length - 2].body + ';', ins)
  assert.ok(!/on conflict/i.test(ins), 'un conflict pe version trebuie să ANULEZE fișierul, nu să-l lase fără urmă')
  // enum_only: textul NESCHIMBAT (INSERT-ul rulează separat)
  const en = "alter type public.k add value if not exists 'x';\n"
  assert.equal(wrapWithLedger(en, { version: '20261022100000', name: 'migration_299_x' }), en)
  assert.throws(() => wrapWithLedger('select 1;', { version: '20261022100000', name: 'migration_299_x' }), /forma/)
  assert.throws(() => ledgerInsertSql({ version: '1', name: 'x' }), /version/)
  assert.throws(() => ledgerInsertSql({ version: '20261022100000', name: "x'); drop table t; --" }), /nume/)
  // pe o migrație REALĂ: 289 (blocuri DO + funcții)
  const f = readdirSync(MIG).find((x) => x.includes('_migration_289_'))
  const real = readFileSync(join(MIG, f), 'utf8')
  const rw = wrapWithLedger(real, { version: migrationVersion(f), name: migrationName(f) })
  const rst = scanSql(rw).statements
  assert.match(rst[rst.length - 2].body, /^insert into supabase_migrations\.schema_migrations/)
  assert.match(rst[rst.length - 1].body, /^commit$/i)
})

// ── PM6: meta-comenzile psql ────────────────────────────────────────────────
test('PM6: meta-comandă psql respinsă în fișierele ≥298, permisă în 120/121', () => {
  const sql = 'begin;\n\\set ON_ERROR_STOP on\nselect 1;\ncommit;\n'
  assert.equal(checkMigrationFile('20261022090000_migration_298_x.sql', sql).kind, 'invalid')
  assert.match(checkMigrationFile('20261022090000_migration_298_x.sql', sql).reason, /meta-comandă/)
  assert.equal(checkMigrationFile('20261022090000_migration_298_x.sql', sql.replace('\\set ON_ERROR_STOP on\n', '')).kind, 'transactional')
  assert.equal(checkMigrationFile('20261199000000_hotfix_fara_numar.sql', sql).kind, 'invalid', 'fără număr, dar după 297')
  for (const n of ['120', '121']) {
    const f = readdirSync(MIG).find((x) => x.includes(`_migration_${n}_`))
    const r = checkMigrationFile(f, readFileSync(join(MIG, f), 'utf8'))
    assert.ok(r.metaCommands.length >= 1, `${n} are \\set`)
    assert.ok(!/meta-comandă/.test(r.reason || ''), `${n} nu e respinsă pentru meta-comenzi`)
  }
  // un backslash într-un șir / corp NU e meta-comandă
  assert.equal(checkMigrationFile('20261022090000_migration_298_x.sql', "begin;\nselect E'a\\nb', $$c\\d$$;\ncommit;\n").kind, 'transactional')
})

// ── PM7: begin/commit în corpuri, comentarii, șiruri ────────────────────────
test('PM7: begin/commit/end din DO, funcții, comentarii și șiruri NU se numără', () => {
  const sql = [
    'begin;',
    'do $$ begin perform 1; end; $$;',
    'do $body$ begin commit; end $body$;',
    'create function f() returns int language plpgsql as $fn$ begin return 1; end; $fn$;',
    '-- commit;',
    '/* begin; /* imbricat */ commit; */',
    "select 'commit;', E'it\\'s; commit;', \"end;\", $q$ begin; $q$;",
    'create rule r as on insert to t do also (insert into a values (1); insert into b values (2));',
    'select foo$bar from t;',
    'commit;',
  ].join('\n')
  const r = classifyShape(sql)
  assert.equal(r.kind, 'transactional', r.reason)
  assert.equal(r.statements, 8, 'cele 2 linii de comentariu nu sunt instrucțiuni')
  // control: aceleași cuvinte la nivel ÎNALT chiar se numără
  assert.equal(classifyShape('begin;\ndo $$ begin perform 1; end $$;\nend;\ncommit;\n').kind, 'invalid')
})

// ── PM8: clichetul viu pe fișierele reale ───────────────────────────────────
test('PM8: orice migrație ≥289 din repo e transactional sau enum_only (fără meta-comenzi de la 298)', () => {
  const files = listMigrationFiles(MIG).filter((f) => {
    const m = /_migration_(\d+)/.exec(f)
    return (m && Number(m[1]) >= 289) || f.slice(0, 14) > '20261001110000'
  })
  assert.ok(files.length >= 9, `prea puține fișiere ≥289 (${files.length})`)
  for (const f of files) {
    const r = checkMigrationFile(f, readFileSync(join(MIG, f), 'utf8'))
    assert.ok(r.kind === 'transactional' || r.kind === 'enum_only', `${f}: ${r.reason} — aplicarea automată pe producție l-ar REFUZA`)
  }
})

// ── PM9: poarta (CI + Tests + SQL verify) ──────────────────────────────────
test('PM9: poarta cere run-uri verzi de push pe main pentru commit, iar SQL verify absent doar dacă e acoperit', () => {
  const sha = 'a'.repeat(40)
  const run = (o) => ({ head_sha: sha, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', run_number: 1, ...o })
  assert.equal(latestRunVerdict([run()], sha), 'success')
  assert.equal(latestRunVerdict([run({ status: 'in_progress', conclusion: null })], sha), 'pending')
  assert.equal(latestRunVerdict([run({ conclusion: 'failure' })], sha), 'failure')
  assert.equal(latestRunVerdict([run({ conclusion: 'cancelled' })], sha), 'failure')
  assert.equal(latestRunVerdict([run({ event: 'pull_request' })], sha), 'absent', 'un PR (inclusiv dintr-un fork cu ramura main) nu contează')
  assert.equal(latestRunVerdict([run({ head_branch: 'feature' })], sha), 'absent')
  assert.equal(latestRunVerdict([run({ run_number: 1 }), run({ run_number: 2, conclusion: 'failure' })], sha), 'failure', 'cel mai recent run decide')
  const ok = { ref: 'refs/heads/main', ci: 'success', tests: 'success', sql: 'success' }
  assert.equal(decideGate(ok).go, true)
  assert.equal(decideGate({ ...ok, ref: 'refs/heads/x' }).go, false)
  assert.equal(decideGate({ ...ok, ci: 'pending' }).go, false)
  assert.equal(decideGate({ ...ok, tests: 'failure' }).go, false)
  assert.equal(decideGate({ ...ok, sql: 'failure' }).go, false)
  assert.equal(decideGate({ ...ok, sql: 'absent' }).go, false)
  assert.equal(decideGate({ ...ok, sql: 'absent', sqlCoverage: { covered: false, reason: 'x' } }).go, false)
  assert.equal(decideGate({ ...ok, sql: 'absent', sqlCoverage: { covered: true } }).go, true)
  // filtrul de căi = sursă unică: sql-verify.yml
  const paths = parsePushPaths(readFileSync(join(ROOT, '.github', 'workflows', 'sql-verify.yml'), 'utf8'))
  assert.ok(paths.includes('supabase/**.sql'))
  for (const p of ['scripts/apply-prod-migrations.mjs', 'scripts/lib/prod-migrations.mjs', 'scripts/prod-migrations-allow-gaps.json', 'scripts/prod-migrations-rehearsal.sh']) {
    assert.ok(paths.includes(p), `${p} trebuie să declanșeze SQL verify (AM1–AM4 îl exercită)`)
  }
  assert.deepEqual(
    pathsMatching(['supabase/migrations/2026_x.sql', 'src/a.ts', 'tests/sql/a.sql', 'tests/sql/auto/b.sql', 'scripts/x.sql', 'docs/a.md'], paths),
    ['supabase/migrations/2026_x.sql', 'tests/sql/a.sql', 'tests/sql/auto/b.sql', 'scripts/x.sql'],
  )
  assert.ok(ghGlobToRegExp('supabase/**.sql').test('supabase/migrations/a.sql'))
  assert.ok(!ghGlobToRegExp('scripts/*.sql').test('scripts/lib/a.sql'))
  assert.throws(() => ghGlobToRegExp('!docs/**'), /nesuportat/)
})

// ── PM10: URL-ul nu se tipărește ────────────────────────────────────────────
test('PM10: URL-ul și parola sunt redactate; un șir non-URI e refuzat înainte de psql', () => {
  const url = 'postgresql://postgres.ref:S3cr%40t-pass@aws-0-eu.pooler.supabase.com:5432/postgres'
  assert.equal(validateDbUrl(url), null)
  assert.equal(validateDbUrl('postgresql:///db?host=/tmp/s&port=5432'), null)
  assert.match(validateDbUrl('host=x password=y'), /URI/)
  assert.match(validateDbUrl(` ${url}`), /spații/)
  assert.match(validateDbUrl(''), /lipsește/)
  const r = redact(`eroare la ${url}; parola S3cr@t-pass sau S3cr%40t-pass`, url)
  assert.ok(!r.includes('S3cr'), r)
  assert.ok(!r.includes('pooler.supabase.com:5432/postgres'), r)
})
