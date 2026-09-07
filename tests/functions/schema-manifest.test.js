// tests/functions/schema-manifest.test.js
// Clichetul manifestului de migrații (mig 271 / audit v3 RES-08): /health
// trimite `schema-manifest.json` lui `get_schema_version`; dacă cineva adaugă
// o migrație fără să regenereze manifestul, sonda NU o vede și decalajul
// rămâne invizibil — exact clasa pe care sonda există s-o închidă.
//
//   SM1  manifestul == fișierele din supabase/migrations (nume, sortate)
//   SM2  fiecare fișier are prefix de EXACT 14 cifre (altfel strip-ul e ambiguu)
//
// Regenerare: node scripts/gen-schema-manifest.mjs
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MANIFEST = path.join(ROOT, 'netlify', 'functions', 'schema-manifest.json')

describe('schema-manifest.json', () => {
  it('SM1: manifestul e identic cu fișierele din supabase/migrations', () => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
    const expected = files.map((f) => f.replace(/^\d{14}_/, '').replace(/\.sql$/, '')).sort()
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    assert.ok(Array.isArray(manifest.names), 'manifestul nu are `names`')
    assert.deepEqual(
      [...manifest.names].sort(),
      expected,
      'manifestul e DESINCRONIZAT — rulează: node scripts/gen-schema-manifest.mjs',
    )
    assert.ok(expected.length >= 270, `prea puține migrații (${expected.length})`)
  })

  it('SM2: fiecare migrație are prefix de exact 14 cifre', () => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
    for (const f of files) {
      assert.match(f, /^\d{14}_[^/]+\.sql$/, `fișier fără prefix de 14 cifre: ${f}`)
    }
  })
})
