// tests/osv-gate/osv-audit.test.mjs
// Teste OFFLINE pe logica pură a porții OSV. api.osv.dev NU e accesibil din
// containerul de dezvoltare, deci partea de rețea se exercită doar în CI —
// motiv în plus ca parsarea, severitatea și strictețea răspunsului să fie
// acoperite aici, unde chiar putem rula.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  realPackageName, nameFromResolved, productionPackages,
  bucketFromLabel, bucketFromScore, cvss3BaseScore, severityOf,
  isBlocking, isWithdrawn, idsFromBatch,
} from '../../scripts/lib/osv-audit.mjs'

// ── numele real al pachetului ───────────────────────────────────────────────
test('aliasul se citește din entry.name, nu din cale', () => {
  assert.equal(
    realPackageName('node_modules/web-vitals-soft-navs', { name: 'web-vitals' }),
    'web-vitals',
  )
})
test('imbricarea folosește ULTIMUL node_modules', () => {
  assert.equal(realPackageName('node_modules/posthog-js/node_modules/fflate', {}), 'fflate')
})
test('scope-urile rămân intacte', () => {
  assert.equal(realPackageName('node_modules/@adobe/css-tools', {}), '@adobe/css-tools')
  assert.equal(realPackageName('node_modules/a/node_modules/@s/b', {}), '@s/b')
})
test('cheia fără node_modules NU inventează un nume', () => {
  assert.equal(realPackageName('packages/ui', {}), null)
})
test('numele din tarball, inclusiv scoped', () => {
  assert.equal(nameFromResolved('https://registry.npmjs.org/web-vitals/-/web-vitals-6.2.1.tgz'), 'web-vitals')
  assert.equal(nameFromResolved('https://registry.npmjs.org/@adobe/css-tools/-/css-tools-4.5.0.tgz'), '@adobe/css-tools')
  assert.equal(nameFromResolved(undefined), null)
})

// ── extragerea pe lockfile-ul REAL ──────────────────────────────────────────
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
const { packages } = productionPackages(lock)
const names = new Set(packages.map((p) => p.name))

test('extrage arborele de producție de dimensiune plauzibilă', () => {
  assert.ok(packages.length > 150, `doar ${packages.length} pachete`)
})
test('aliasul apare sub numele REAL, niciodată sub cel din cale', () => {
  assert.ok(names.has('web-vitals'), 'web-vitals lipsește')
  assert.ok(!names.has('web-vitals-soft-navs'), 'numele-alias a scăpat în interogare')
})
test('devOptional RĂMÂNE (paritate cu npm audit --omit=dev)', () => {
  assert.ok(names.has('@types/react'), '@types/react (devOptional) a fost exclus')
})
test('dependențele de dev sunt excluse', () => {
  assert.ok(!names.has('vitest'), 'vitest (dev) a intrat în scanare')
  assert.ok(!names.has('eslint'), 'eslint (dev) a intrat în scanare')
})
test('acelasi pachet la două versiuni NU se colapsează', () => {
  const fflate = packages.filter((p) => p.name === 'fflate')
  assert.equal(fflate.length, 2, `fflate apare de ${fflate.length} ori`)
})
test('toate numele respectă gramatica npm', () => {
  const bad = packages.filter((p) => !/^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i.test(p.name))
  assert.deepEqual(bad, [])
})
test('lockfile fără `packages` aruncă, nu întoarce lista goală', () => {
  assert.throws(() => productionPackages({ dependencies: {} }))
})

// ── CVSS v3.1 ───────────────────────────────────────────────────────────────
const VECTORS = [
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
  ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 8.8],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', 7.5],
  ['CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H', 7.2],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
  ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N', 5.5],
]
for (const [v, expected] of VECTORS) {
  test(`CVSS ${v} => ${expected}`, () => {
    assert.equal(cvss3BaseScore(v), expected)
  })
}
test('vectorii invalizi/absenți dau null, nu NaN', () => {
  assert.equal(cvss3BaseScore('CVSS:4.0/AV:N/AC:L'), null)
  assert.equal(cvss3BaseScore(9.8), null)
  assert.equal(cvss3BaseScore('gunoi'), null)
})

// ── bucket-uri ──────────────────────────────────────────────────────────────
test('GHSA scrie MODERATE; MEDIUM se normalizează', () => {
  assert.equal(bucketFromLabel('moderate'), 'MODERATE')
  assert.equal(bucketFromLabel('MEDIUM'), 'MODERATE')
  assert.equal(bucketFromLabel('CRITICAL'), 'CRITICAL')
  assert.equal(bucketFromLabel('inventat'), null)
})
test('pragurile de scor', () => {
  assert.equal(bucketFromScore(9.0), 'CRITICAL')
  assert.equal(bucketFromScore(8.9), 'HIGH')
  assert.equal(bucketFromScore(7.0), 'HIGH')
  assert.equal(bucketFromScore(6.9), 'MODERATE')
  assert.equal(bucketFromScore(NaN), null)
})
test('high INCLUDE critical (paritate --audit-level=high)', () => {
  assert.ok(isBlocking('HIGH'))
  assert.ok(isBlocking('CRITICAL'))
  assert.ok(!isBlocking('MODERATE'))
})

// ── severitatea: regula MAXIMULUI ───────────────────────────────────────────
test('eticheta GHSA joasă NU învinge un vector CVSS mare', () => {
  const v = {
    database_specific: { severity: 'LOW' },
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
  }
  assert.equal(severityOf(v), 'CRITICAL')
})
test('MODERATE + vector 7.5 => HIGH', () => {
  const v = {
    database_specific: { severity: 'MODERATE' },
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' }],
  }
  assert.equal(severityOf(v), 'HIGH')
})
test('doar etichetă, fără vector', () => {
  assert.equal(severityOf({ database_specific: { severity: 'HIGH' } }), 'HIGH')
})
test('doar CVSS v4 => null (NEEVALUABIL, nu „curat")', () => {
  const v = { severity: [{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H' }] }
  assert.equal(severityOf(v), null)
})
test('severitatea poate veni și din affected[].database_specific', () => {
  assert.equal(severityOf({ affected: [{ database_specific: { severity: 'CRITICAL' } }] }), 'CRITICAL')
})
test('avizele retrase se recunosc', () => {
  assert.ok(isWithdrawn({ withdrawn: '2024-01-01T00:00:00Z' }))
  assert.ok(!isWithdrawn({}))
})

// ── strictețea răspunsului querybatch ───────────────────────────────────────
test('`{}` per pachet = curat (forma documentată OSV)', () => {
  assert.deepEqual(idsFromBatch({ results: [{}, {}] }, 2), [[], []])
})
test('extrage id-urile', () => {
  assert.deepEqual(idsFromBatch({ results: [{ vulns: [{ id: 'GHSA-a' }] }, {}] }, 2), [['GHSA-a'], []])
})
test('element null => TRANSPORT, NU curat', () => {
  assert.throws(() => idsFromBatch({ results: [null, {}] }, 2))
})
test('`vulns` ne-array => TRANSPORT, NU curat', () => {
  assert.throws(() => idsFromBatch({ results: [{ vulns: { 0: { id: 'x' } } }] }, 1))
})
test('vulnerabilitate fără id => TRANSPORT, NU curat', () => {
  assert.throws(() => idsFromBatch({ results: [{ vulns: [{ modified: 'x' }] }] }, 1))
})
test('lungime nepotrivită => TRANSPORT (aliniere pozițională ruptă)', () => {
  assert.throws(() => idsFromBatch({ results: [{}] }, 2))
})
test('corp fără `results` => TRANSPORT, NU curat', () => {
  assert.throws(() => idsFromBatch({}, 1))
  assert.throws(() => idsFromBatch({ results: 'nu-e-array' }, 1))
})
test('paginare => refuzăm scanarea parțială', () => {
  assert.throws(() => idsFromBatch({ results: [{}], next_page_token: 'x' }, 1))
})
