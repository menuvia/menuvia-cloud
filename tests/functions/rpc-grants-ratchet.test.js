// tests/functions/rpc-grants-ratchet.test.js
// Clichetul clasei „revoke fără grant" (mig 274 / 306): fiecare RPC chemat de
// funcțiile Netlify prin clientul service_role trebuie să fie în lista din
// tests/sql/auto/306_service_role_rpc_grants.sql, unde SR1 verifică pe Postgres
// GOL (regimul producției) că service_role îl poate executa. Fără legătura
// asta, un RPC nou chemat din funcții ar trece toate testele (jobul E2E acordă
// implicit EXECUTE) și ar pica abia în producție cu 42501.
//
//   RG1  numele chemate în `.rpc(...)` din netlify/functions/*.js și lib/*.js == lista SQL
//        (ambele sensuri: un apel nou fără rând, sau un rând care nu mai e chemat)
//   RG2  extractorul vede și apelurile cu nume ales condiționat, și helperii
//        din lib/ (control pozitiv: altfel RG1 ar putea trece pe o listă vidă)
//   RG3  un rând COMENTAT în lista SQL nu mai contează ca listat (SR1 nu-l verifică)
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const FUNCTIONS = path.join(ROOT, 'netlify', 'functions')
const SQL = path.join(ROOT, 'tests', 'sql', 'auto', '306_service_role_rpc_grants.sql')

// Apelate cu clientul cu JWT-ul UTILIZATORULUI (nu service_role), deliberat:
// has_partner_access e revocată pentru service_role (ai-proxy, mig 303).
const USER_JWT_RPCS = new Set(['has_partner_access'])

// Fișierele scanate: funcțiile ȘI helperii din lib/ — un helper partajat
// (ex. lib/founderAlert.js → enqueue_email) cheamă RPC-uri cu același client
// service_role; dacă ar rămâne nescanat, apelul lui ar ieși din clichet în
// ziua în care niciun fișier de top nu mai cheamă același RPC.
function functionSources() {
  const out = []
  for (const dir of [FUNCTIONS, path.join(FUNCTIONS, 'lib')]) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f))
    }
  }
  return out
}

function rpcNamesInFunctions() {
  const names = new Set()
  for (const file of functionSources()) {
    const src = fs.readFileSync(file, 'utf8')
    // Primul argument al lui .rpc( până la prima virgulă sau paranteză:
    // prinde atât `.rpc('x', …)` cât și `.rpc(cond ? 'a' : 'b', …)`.
    const re = /\.rpc\(\s*([^,)]+)[,)]/g
    let m
    while ((m = re.exec(src)) !== null) {
      for (const lit of m[1].matchAll(/['"]([a-z_0-9]+)['"]/g)) names.add(lit[1])
    }
  }
  return names
}

function rpcNamesInSql() {
  const sql = fs.readFileSync(SQL, 'utf8')
  const start = sql.indexOf('-- RPC-LIST-START')
  const end = sql.indexOf('-- RPC-LIST-END')
  assert.ok(start > 0 && end > start, 'markerii RPC-LIST-START/END lipsesc din suita SQL')
  // Doar intrările ACTIVE: comentariile SQL (`-- 'x',`) se scot înainte, altfel un
  // rând comentat ar rămâne „listat" aici, deși SR1 nu-l mai verifică.
  const active = sql
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
  return new Set([...active.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]))
}

describe('rpc-grants-ratchet', () => {
  it('RG1: apelurile .rpc() din netlify/functions == lista verificată de SR1', () => {
    const called = [...rpcNamesInFunctions()].filter((n) => !USER_JWT_RPCS.has(n)).sort()
    const listed = [...rpcNamesInSql()].sort()
    const missing = called.filter((n) => !listed.includes(n))
    const stale = listed.filter((n) => !called.includes(n))
    assert.deepEqual(
      missing,
      [],
      `RPC-uri chemate din funcții dar NEVERIFICATE pentru service_role (adaugă-le în ${path.relative(ROOT, SQL)} și dă grant în migrație): ${missing.join(', ')}`,
    )
    assert.deepEqual(
      stale,
      [],
      `rânduri din lista SQL care nu mai sunt chemate din funcții (scoate-le): ${stale.join(', ')}`,
    )
    assert.ok(listed.length >= 40, `lista e suspect de scurtă (${listed.length})`)
  })

  it('RG3: un rând comentat în lista SQL NU mai contează ca listat', () => {
    // Mutație care trebuie să pice: extragerea fără scoaterea comentariilor.
    const sql = fs.readFileSync(SQL, 'utf8')
    assert.ok(
      sql.includes("    'check_rate_limit',\n"),
      'rândul check_rate_limit lipsește din listă',
    )
    const original = fs.readFileSync
    fs.readFileSync = (p, ...rest) =>
      p === SQL
        ? sql.replace("    'check_rate_limit',\n", "    -- 'check_rate_limit',\n")
        : original(p, ...rest)
    try {
      assert.equal(rpcNamesInSql().has('check_rate_limit'), false)
    } finally {
      fs.readFileSync = original
    }
  })

  it('RG2: extractorul prinde și numele alese condiționat (control pozitiv)', () => {
    const called = rpcNamesInFunctions()
    // oblio-generator.js: .rpc(ambiguous ? 'bridge_oblio_mark_ambiguous' : 'bridge_oblio_mark_failed', …)
    assert.ok(
      called.has('bridge_oblio_mark_ambiguous'),
      'ramura „ambiguous" a apelului condiționat nu e văzută',
    )
    assert.ok(
      called.has('bridge_oblio_mark_failed'),
      'ramura „failed" a apelului condiționat nu e văzută',
    )
    assert.ok(
      called.has('check_rate_limit'),
      'check_rate_limit (send-invite, stripe-checkout) nu e văzut',
    )
    // Helperii din lib/ sunt scanați (control pe sursă, nu pe nume).
    const libFiles = functionSources().filter((f) => f.includes(`${path.sep}lib${path.sep}`))
    assert.ok(
      libFiles.some((f) => /\.rpc\(\s*'enqueue_email'/.test(fs.readFileSync(f, 'utf8'))),
      'lib/ nu e scanat (lib/founderAlert.js cheamă enqueue_email)',
    )
  })
})
