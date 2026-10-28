// tests/netlify-ignore/netlify-ignore.test.mjs
// NI1–NI10: comanda `ignore` din netlify.toml (scripts/netlify-ignore.sh), pe un
// repo git de TEST construit aici (fără rețea). Contractul Netlify e inversat:
// exit 0 = build ANULAT, exit 1 = build RULEAZĂ — o greșeală poate opri
// producția, deci fiecare caz incert trebuie să ducă la BUILD.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'netlify-ignore.sh')
let repo
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()
function commit(files, msg = 'c') {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, p)), { recursive: true })
    writeFileSync(join(repo, p), c)
  }
  g('add', '-A')
  g('commit', '-q', '-m', msg)
  return g('rev-parse', 'HEAD')
}
function run(env) {
  const r = spawnSync('bash', [SCRIPT], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
  return { code: r.status, out: r.stdout + r.stderr }
}
const BUILD = 1
const SKIP = 0

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'ni-'))
  g('init', '-q')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  commit({ 'src/a.ts': '1', 'docs/x.md': '1', 'README.md': '1' }, 'base')
})
after(() => rmSync(repo, { recursive: true, force: true }))

test('NI1: deploy-preview → SKIP mereu, chiar cu cod schimbat', () => {
  const base = g('rev-parse', 'HEAD')
  const head = commit({ 'src/a.ts': '2' })
  assert.equal(run({ CONTEXT: 'deploy-preview', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, SKIP)
})
test('NI2: producție cu cod schimbat → BUILD', () => {
  const base = g('rev-parse', 'HEAD~1')
  const head = g('rev-parse', 'HEAD')
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, BUILD)
})
test('NI3: doar docs/tests/.github/supabase/*.md din rădăcină → SKIP pe producție și pe branch deploy', () => {
  const base = g('rev-parse', 'HEAD')
  const head = commit({ 'docs/y.md': '2', 'tests/sql/a.sql': '1', '.github/workflows/w.yml': '1', 'supabase/migrations/1.sql': '1', 'CLAUDE.md': '1', 'bridge/x.js': '1', 'scripts/x.mjs': '1' })
  for (const CONTEXT of ['production', 'branch-deploy']) {
    const r = run({ CONTEXT, CACHED_COMMIT_REF: base, COMMIT_REF: head })
    assert.equal(r.code, SKIP, `${CONTEXT}: ${r.out}`)
  }
})
test('NI4: menuvia-pack/ INTRĂ în build (LegalPage îl importă) → BUILD', () => {
  const base = g('rev-parse', 'HEAD')
  const head = commit({ 'menuvia-pack/02-DRAFT-TERMENI.md': 'x' })
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, BUILD)
})
test('NI5: netlify.toml / funcții / package.json → BUILD', () => {
  for (const f of ['netlify.toml', 'netlify/functions/health.js', 'package.json', 'index.html', 'public/x.png']) {
    const base = g('rev-parse', 'HEAD')
    const head = commit({ [f]: String(Math.random()) })
    assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, BUILD, f)
  }
})
test('NI6: un singur fișier relevant printre multe irelevante → BUILD', () => {
  const base = g('rev-parse', 'HEAD')
  const head = commit({ 'docs/z.md': String(Math.random()), 'src/b.ts': String(Math.random()) })
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, BUILD)
})
test('NI7: fără bază / bază necunoscută / aceeași bază (redeploy manual) → BUILD', () => {
  const head = g('rev-parse', 'HEAD')
  assert.equal(run({ CONTEXT: 'production', COMMIT_REF: head }).code, BUILD)
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: 'f'.repeat(40), COMMIT_REF: head }).code, BUILD)
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: head, COMMIT_REF: head }).code, BUILD)
})
test('NI8: [skip ignore] în mesaj → BUILD chiar dacă s-au schimbat doar docs', () => {
  const base = g('rev-parse', 'HEAD')
  const head = commit({ 'docs/w.md': String(Math.random()) }, 'docs [skip ignore]')
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, BUILD)
})
test('NI9: subdirector cu nume asemănător (docs-site/, testsuite/) NU e ignorat', () => {
  const base = g('rev-parse', 'HEAD')
  const head = commit({ 'docs-site/a.md': String(Math.random()), 'testsuite/a.ts': '1' })
  assert.equal(run({ CONTEXT: 'production', CACHED_COMMIT_REF: base, COMMIT_REF: head }).code, BUILD)
})
test('NI10: netlify.toml folosește scriptul ca `ignore` în [build]', () => {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8')
  const buildBlock = toml.split(/^\[/m).find((b) => b.startsWith('build]'))
  assert.match(buildBlock, /^\s*ignore\s*=\s*"bash scripts\/netlify-ignore\.sh"\s*$/m)
})
