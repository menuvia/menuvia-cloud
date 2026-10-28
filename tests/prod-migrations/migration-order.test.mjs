// tests/prod-migrations/migration-order.test.mjs
// MO1 — ordinea migrațiilor pe un PR (numele nu e PM: PM1–PM10 există deja în
// tests/sql pentru mig 267). Un PR care adaugă o migrație cu număr ≤ celui mai
// mare de pe main, sau cu prefix de timp care se sortează înaintea ultimului de
// pe main, pică AICI, la deschiderea PR-ului — nu la aplicarea automată pe
// producție, unde ar apărea ca GOL și ar bloca tot lotul.
//
// Baza: MO_BASE_REF (implicit origin/main), citită cu `git ls-tree`; capul:
// directorul de lucru. În CI (test.yml) pasul face `git fetch origin main` înainte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkMigrationOrder } from '../../scripts/lib/prod-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.MO_BASE_REF || 'origin/main'

test('MO1 (logică): număr și prefix, ambele STRICT după main', () => {
  const main = ['20261012090000_migration_296_a.sql', '20261014090000_migration_297_b.sql']
  const ok = (h) => checkMigrationOrder(main, [...main, ...h])
  assert.deepEqual(ok([]), [])
  assert.deepEqual(ok(['20261022090000_migration_298_x.sql', '20261022100000_migration_299_y.sql']), [])
  assert.match(ok(['20261022090000_migration_297_x.sql']).join(), /numărul 297/)
  assert.match(ok(['20261013000000_migration_298_x.sql']).join(), /prefixul 20261013000000/)
  assert.match(ok(['20261022100000_migration_298_x.sql', '20261022110000_migration_298_y.sql']).join(), /nu crește/)
  assert.match(ok(['20261022100000_migration_299_x.sql', '20261022110000_migration_298_y.sql']).join(), /nu crește|numărul 298/)
  assert.match(ok(['20261022100000_hotfix.sql']).join(), /migration_<NNN>/)
})

test('MO1 (viu): migrațiile adăugate față de ' + BASE + ' vin după tot ce e acolo', () => {
  let out
  try {
    out = execFileSync('git', ['ls-tree', '--name-only', `${BASE}:supabase/migrations`], { cwd: ROOT, encoding: 'utf8' })
  } catch {
    assert.fail(`nu pot citi ${BASE} — în CI rulează întâi \`git fetch origin main\` (fail-closed: fără bază, verificarea n-ar verifica nimic)`)
  }
  const base = out.split('\n').filter((f) => f.endsWith('.sql'))
  assert.ok(base.length >= 270, `baza ${BASE} are prea puține migrații (${base.length})`)
  const head = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'))
  const problems = checkMigrationOrder(base, head)
  assert.deepEqual(problems, [], `ordinea migrațiilor față de ${BASE}:\n  ${problems.join('\n  ')}`)
})
