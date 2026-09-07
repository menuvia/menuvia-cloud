// tests/functions/health.test.js
// Testele endpoint-ului de ALARMĂ. Nu e o funcție de bani, dar e singurul lucru
// care spune că platforma e pe cale să se oprească — iar o alarmă stinsă tăcut e
// mai rea decât una lipsă (clasa CA-01 din CLAUDE.md).
//
// Două invariante, ambele finding-uri CodeRabbit pe #240:
//   HL1–HL3  plafonul de stocare NU poate fi anulat dintr-o variabilă de mediu
//            greșită: `Number('Infinity')` și valorile negative sunt truthy,
//            deci treceau de `|| fallback` și făceau pragul de 90% inaccesibil.
//   HL4–HL6  `/health` e PUBLIC (îl lovește UptimeRobot din afară), deci nu are
//            voie să întoarcă nume de tabele, dimensiuni sau plafonul — doar
//            procentul. Detaliul complet cere token, FAIL-CLOSED.
//
// `DB_SIZE_LIMIT_BYTES` se citește la nivel de MODUL, deci fiecare scenariu
// reîncarcă health.js cu cache-ul golit.

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { state, resetMocks, installModuleMocks, parseBody, rpcCallsFor } = require('./helpers/mocks')

const HEALTH_PATH = path.join(__dirname, '..', '..', 'netlify', 'functions', 'health.js')

// 490 MB — sub plafonul implicit de 500 MB, dar peste pragul critic de 90%.
const BYTES_98_PCT = Math.round(500 * 1024 * 1024 * 0.98)

function loadHealthFresh() {
  installModuleMocks()
  delete require.cache[require.resolve(HEALTH_PATH)]
  return require(HEALTH_PATH)
}

// Forma PUBLICĂ nu mai poartă câmpurile de diagnostic deloc (audit v3 RES-38):
// nu `null`, ci ABSENTE. Verificarea e pe prezența cheii, nu pe valoare.
function assertNoDiag(body, msg) {
  for (const k of ['storage_detail', 'config', 'cron_last_run', 'schema_detail', 'queue_detail']) {
    assert.equal(k in body, false, `${msg}: cheia „${k}” a ajuns pe suprafața publică`)
  }
}

const MANIFEST = require(path.join(__dirname, '..', '..', 'netlify', 'functions', 'schema-manifest.json'))

function scriptSchema(result) {
  state.rpcHandlers['get_schema_version'] = () => result
}
function scriptQueues(result) {
  state.rpcHandlers['get_queue_backlog'] = () => result
}
function backlog(overrides) {
  const z = { waiting: 0, oldest_age_s: 0 }
  const base = {
    cron: { email: { ...z }, sms: { ...z }, invoices: { ...z }, reminders: { ...z }, slack_alerts: { waiting: 0 } },
    bridge: { receipts: { ...z }, tickets: { ...z } },
  }
  for (const [path, val] of Object.entries(overrides || {})) {
    const [g, k] = path.split('.')
    base[g][k] = { ...base[g][k], ...val }
  }
  return base
}

function scriptDbOk(bytes) {
  state.fromHandlers['restaurants'] = () => ({ data: [{ id: 'r1' }], error: null })
  state.fromHandlers['customer_health_scores'] = () => ({
    data: [{ computed_at: new Date().toISOString() }],
    error: null,
  })
  state.rpcHandlers['get_database_size'] = () => ({
    data: {
      bytes,
      pretty: '490 MB',
      top_tables: [{ name: 'audit_log', bytes: 1433600, pretty: '1400 kB' }],
    },
    error: null,
  })
}

let savedEnv
beforeEach(() => {
  resetMocks()
  savedEnv = { ...process.env }
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'
  delete process.env.DB_SIZE_LIMIT_BYTES
  delete process.env.HEALTH_DIAG_TOKEN
})
afterEach(() => {
  process.env = savedEnv
})

describe('health — plafonul de stocare nu poate fi anulat din env', () => {
  it('HL1: DB_SIZE_LIMIT_BYTES="Infinity" NU stinge alarma', async () => {
    process.env.DB_SIZE_LIMIT_BYTES = 'Infinity'
    const { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)

    const res = await handler({ httpMethod: 'GET' })
    const body = parseBody(res)
    // Înainte de fix: limit = Infinity → pct = 0 → 'ok' → HTTP 200, alarmă moartă.
    assert.equal(body.checks.storage, 'critical', 'Infinity a stins pragul critic')
    assert.equal(res.statusCode, 503)
  })

  it('HL2: DB_SIZE_LIMIT_BYTES="-1" NU stinge alarma', async () => {
    process.env.DB_SIZE_LIMIT_BYTES = '-1'
    const { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)

    const res = await handler({ httpMethod: 'GET' })
    const body = parseBody(res)
    // Înainte de fix: limit = -1 → pct negativ → niciodată critic.
    assert.equal(body.checks.storage, 'critical', 'valoarea negativă a stins pragul critic')
    assert.equal(res.statusCode, 503)
  })

  it('HL3: un plafon VALID e respectat (planul se poate schimba fără redeploy)', async () => {
    // 8 GB: aceiași octeți devin ~6% → 'ok'.
    process.env.DB_SIZE_LIMIT_BYTES = String(8 * 1024 * 1024 * 1024)
    const { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)

    const res = await handler({ httpMethod: 'GET' })
    const body = parseBody(res)
    assert.equal(body.checks.storage, 'ok')
    assert.equal(res.statusCode, 200)
  })
})

describe('health — pragurile', () => {
  const LIMIT = 500 * 1024 * 1024
  it('HL7: exact 90% e critic (503), exact 80% e avertisment (200)', async () => {
    let { handler } = loadHealthFresh()
    scriptDbOk(LIMIT * 0.9)
    let res = await handler({ httpMethod: 'GET' })
    assert.equal(parseBody(res).checks.storage, 'critical', 'pragul critic e exclusiv la 90%')
    assert.equal(res.statusCode, 503)

    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(LIMIT * 0.8)
    res = await handler({ httpMethod: 'GET' })
    // 80% NU alertează (200) dar TREBUIE să se vadă: e singurul preaviz —
    // „săptămâni de reacție" din raționamentul mig 266.
    assert.equal(parseBody(res).checks.storage, 'warn', 'pragul de avertizare a dispărut')
    assert.equal(res.statusCode, 200)

    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(LIMIT * 0.5)
    assert.equal(parseBody(await handler({ httpMethod: 'GET' })).checks.storage, 'ok')
  })
})

describe('health — diagnosticul privilegiat nu ajunge pe suprafața publică', () => {
  it('HL4: răspunsul PUBLIC dă doar procentul, fără tabele/octeți/plafon', async () => {
    const { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)

    const res = await handler({ httpMethod: 'GET' })
    const body = parseBody(res)
    assert.equal(body.checks.storage, 'critical', 'severitatea rămâne publică — monitorul are nevoie de ea')
    // Forma se ÎNGHEAȚĂ, nu se verifică pe câmpuri știute (disciplina BC5/mig 265):
    // o verificare per-câmp lasă să treacă ORICE cheie NOUĂ — `pretty`, un
    // `tables` redenumit, un `oldest_row` viitor. Public = zero cifre.
    assertNoDiag(body, 'HL4')
    // Plasă de siguranță pe TOT corpul, nu doar pe câmpurile știute.
    assert.ok(!JSON.stringify(body).includes('audit_log'), 'un nume de tabel a ajuns în răspunsul public')
    assert.ok(!JSON.stringify(body).includes('used_pct'), 'procentul (deci și dimensiunea) a ajuns public')
  })

  it('HL5: cu tokenul corect, diagnosticul complet e livrat', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    const { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)

    // Antetul e SINGURA cale. Netlify și shim-ul VPS trimit cheile minuscule.
    const body = parseBody(
      await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'secret-diag-token' } }),
    )
    assert.equal(body.storage_detail.bytes, BYTES_98_PCT, 'calea prin antet nu funcționează')
    assert.ok(Array.isArray(body.storage_detail.top_tables))
    assert.equal(body.storage_detail.top_tables[0].name, 'audit_log')

    // Tokenul în QUERY STRING trebuie RESPINS chiar dacă e corect: un secret în
    // URL ajunge în logurile de request Netlify, în configul monitorului și în
    // istoricul de shell (CWE-598). Prima variantă a codului îl accepta, cu un
    // comentariu care descria exact riscul — de aceea asta e o aserție, nu o notă.
    const viaQuery = parseBody(
      await handler({ httpMethod: 'GET', queryStringParameters: { diag: 'secret-diag-token' } }),
    )
    assertNoDiag(viaQuery, 'HL5 (query string)')
  })

  it('HL6: token greșit sau env nesetat → FAIL-CLOSED, niciun detaliu', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    let { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)
    let body = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'gresit' } }))
    assertNoDiag(body, 'HL6 token greșit (altă lungime)')

    // Token greșit de ACEEAȘI LUNGIME — altfel comparația de egalitate nu e
    // exercitată NICIODATĂ (verificarea de lungime respinge prima) și ștergerea
    // ei ar lăsa suita verde: gate-ul ar degrada la „orice șir de lungimea bună".
    const sameLen = 'x'.repeat('secret-diag-token'.length)
    body = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': sameLen } }))
    assertNoDiag(body, 'HL6 token greșit (aceeași lungime)')

    // Env NEsetat: prezentarea unui token oarecare NU deschide suprafața.
    delete process.env.HEALTH_DIAG_TOKEN
    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(BYTES_98_PCT)
    body = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'orice' } }))
    assertNoDiag(body, 'HL6 env nesetat')
  })
})

describe('health — forma publică e ÎNGHEȚATĂ; diagnosticul complet cere token (audit v3 RES-38)', () => {
  it('HL8: public = exact {checks, status, ts}; nicio integrare, nicio cifră, niciun nume de migrație', async () => {
    const { handler } = loadHealthFresh()
    scriptDbOk(1024)
    scriptSchema({ data: { available: true, ledger_count: 271, latest_name: 'x', latest_version: '1', missing: ['migration_999_x'] }, error: null })
    scriptQueues({ data: backlog({ 'cron.email': { waiting: 3, oldest_age_s: 120 } }), error: null })
    const body = parseBody(await handler({ httpMethod: 'GET' }))
    assert.deepEqual(Object.keys(body).sort(), ['checks', 'status', 'ts'])
    assert.deepEqual(Object.keys(body.checks).sort(), ['cron', 'db', 'queues', 'schema', 'storage'])
    const raw = JSON.stringify(body)
    for (const leak of ['config', 'cron_last_run', 'resend', 'slack', 'stripe', 'ai_platform', 'used_pct', 'oldest_age', 'migration_999', 'waiting']) {
      assert.ok(!raw.includes(leak), `„${leak}” a ajuns pe suprafața publică`)
    }
  })

  it('HL9: ramura 503 „env lipsă” nu poartă config fără token', async () => {
    delete process.env.SUPABASE_URL
    const { handler } = loadHealthFresh()
    const res = await handler({ httpMethod: 'GET' })
    const body = parseBody(res)
    assert.equal(res.statusCode, 503)
    assert.equal(body.checks.db, 'down')
    assertNoDiag(body, 'HL9')
  })

  it('HL10: cu token, config (exact 4 booleeni), cron_last_run și detaliile sunt livrate', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    process.env.RESEND_API_KEY = 're_x'
    delete process.env.STRIPE_SECRET_KEY
    const { handler } = loadHealthFresh()
    const computedAt = '2026-09-07T03:00:00.000Z'
    state.fromHandlers['restaurants'] = () => ({ data: [{ id: 'r1' }], error: null })
    state.fromHandlers['customer_health_scores'] = () => ({ data: [{ computed_at: computedAt }], error: null })
    state.rpcHandlers['get_database_size'] = () => ({ data: { bytes: 1024, pretty: '1 kB', top_tables: [] }, error: null })
    scriptSchema({ data: { available: true, ledger_count: 271, latest_name: 'migration_271_health_probes', latest_version: '1', missing: [] }, error: null })
    scriptQueues({ data: backlog(), error: null })
    const body = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'secret-diag-token' } }))
    assert.deepEqual(Object.keys(body.config).sort(), ['ai_platform', 'resend', 'slack', 'stripe'])
    assert.equal(body.config.resend, true)
    assert.equal(body.config.stripe, false)
    assert.equal(body.cron_last_run, computedAt)
    assert.equal(body.storage_detail.bytes, 1024)
    assert.equal(body.schema_detail.ledger_count, 271)
    assert.ok(body.queue_detail && body.queue_detail.cron)
  })

  it('HL11: token greșit de aceeași lungime → nici config, nici cron_last_run', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    const { handler } = loadHealthFresh()
    scriptDbOk(1024)
    const body = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'x'.repeat('secret-diag-token'.length) } }))
    assertNoDiag(body, 'HL11')
  })
})

describe('health — sonda de schemă (mig 271, RES-08)', () => {
  it('HL12: migrații lipsă din ledger → schema=behind cu 200; numele doar cu token', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    const { handler } = loadHealthFresh()
    scriptDbOk(1024)
    scriptSchema({ data: { available: true, ledger_count: 270, latest_name: 'migration_270_money_gates_in_data', latest_version: '20260907', missing: ['migration_271_health_probes'] }, error: null })
    const pub = await handler({ httpMethod: 'GET' })
    const body = parseBody(pub)
    assert.equal(pub.statusCode, 200, 'behind NU e 503 — deploy-ul înaintea migrației e un tranzit legitim')
    assert.equal(body.checks.schema, 'behind')
    assert.ok(!JSON.stringify(body).includes('migration_271'), 'numele migrației lipsă a ajuns public')
    const diag = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'secret-diag-token' } }))
    assert.deepEqual(diag.schema_detail.missing, ['migration_271_health_probes'])
    assert.equal(diag.schema_detail.expected_latest, MANIFEST.names[MANIFEST.names.length - 1])
    assert.equal(diag.schema_detail.db_latest, 'migration_270_money_gates_in_data')
  })

  it('HL13: eroare RPC sau available=false → unknown (nu ok, nu behind); missing=[] → ok', async () => {
    let { handler } = loadHealthFresh()
    scriptDbOk(1024)
    scriptSchema({ data: null, error: { message: 'PGRST202' } })
    assert.equal(parseBody(await handler({ httpMethod: 'GET' })).checks.schema, 'unknown')
    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(1024)
    scriptSchema({ data: { available: false, ledger_count: null, latest_name: null, latest_version: null, missing: null }, error: null })
    assert.equal(parseBody(await handler({ httpMethod: 'GET' })).checks.schema, 'unknown')
    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(1024)
    scriptSchema({ data: { available: true, ledger_count: 271, latest_name: 'x', latest_version: '1', missing: [] }, error: null })
    assert.equal(parseBody(await handler({ httpMethod: 'GET' })).checks.schema, 'ok')
    // `missing` absent sau ne-array pe ramura available=true → unknown, NU ok:
    // un RPC re-format ar face altfel „behind" imposibil de raportat (recenzie #246).
    for (const data of [{ available: true }, { available: true, missing: null }, { available: true, missing: 'x' }]) {
      ;({ handler } = loadHealthFresh())
      resetMocks()
      scriptDbOk(1024)
      scriptSchema({ data, error: null })
      assert.equal(parseBody(await handler({ httpMethod: 'GET' })).checks.schema, 'unknown', JSON.stringify(data))
    }
  })

  it('HL14: sonda primește ÎNTREG manifestul, nu doar ultimul nume', async () => {
    const { handler } = loadHealthFresh()
    scriptDbOk(1024)
    scriptSchema({ data: { available: true, ledger_count: 1, latest_name: 'x', latest_version: '1', missing: [] }, error: null })
    await handler({ httpMethod: 'GET' })
    const calls = rpcCallsFor('get_schema_version')
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args.p_expected, MANIFEST.names)
    assert.ok(MANIFEST.names.length >= 270)
  })
})

describe('health — backlog-ul cozilor (mig 271, RES-32)', () => {
  function withQueues(data) {
    const { handler } = loadHealthFresh()
    scriptDbOk(1024)
    scriptSchema({ data: { available: true, ledger_count: 1, latest_name: 'x', latest_version: '1', missing: [] }, error: null })
    scriptQueues({ data, error: null })
    return handler
  }

  it('HL15: email vechi de o oră → queues=stale și 503', async () => {
    const res = await withQueues(backlog({ 'cron.email': { waiting: 4, oldest_age_s: 3600 } }))({ httpMethod: 'GET' })
    assert.equal(parseBody(res).checks.queues, 'stale')
    assert.equal(res.statusCode, 503)
  })

  it('HL16: praguri la limită pe TOATE cozile cron — T e ok, T+1 e stale (email 1800, sms 3600, invoices 3600, reminders 7200)', async () => {
    // Pragurile sunt hard-codate AICI, nu importate: ștergerea unei cozi din
    // QUEUE_STALE_S sau un prag mutat la Infinity trebuie să PICE testul.
    const THRESHOLDS = { email: 1800, sms: 3600, invoices: 3600, reminders: 7200 }
    for (const [k, t] of Object.entries(THRESHOLDS)) {
      assert.equal(parseBody(await withQueues(backlog({ [`cron.${k}`]: { waiting: 1, oldest_age_s: t } }))({ httpMethod: 'GET' })).checks.queues, 'ok', `${k} @ ${t}`)
      assert.equal(parseBody(await withQueues(backlog({ [`cron.${k}`]: { waiting: 1, oldest_age_s: t + 1 } }))({ httpMethod: 'GET' })).checks.queues, 'stale', `${k} @ ${t + 1}`)
    }
  })

  it('HL17: bonuri/tichete pending >15 min la un restaurant → warn cu 200, NICIODATĂ 503; alertele Slack singure → ok', async () => {
    const res = await withQueues(backlog({ 'bridge.receipts': { waiting: 2, oldest_age_s: 1200 } }))({ httpMethod: 'GET' })
    assert.equal(parseBody(res).checks.queues, 'warn')
    assert.equal(res.statusCode, 200)
    assert.equal(parseBody(await withQueues(backlog({ 'bridge.tickets': { waiting: 1, oldest_age_s: 900 } }))({ httpMethod: 'GET' })).checks.queues, 'ok')
    const tickets = await withQueues(backlog({ 'bridge.tickets': { waiting: 1, oldest_age_s: 901 } }))({ httpMethod: 'GET' })
    assert.equal(parseBody(tickets).checks.queues, 'warn')
    assert.equal(tickets.statusCode, 200)
    const slackOnly = await withQueues(backlog({ 'cron.slack_alerts': { waiting: 5 } }))({ httpMethod: 'GET' })
    assert.equal(parseBody(slackOnly).checks.queues, 'ok')
  })

  it('HL18: RPC lipsă / date fără formă → unknown cu 200 (absența datelor NU e sănătate, dar nici alarmă)', async () => {
    let { handler } = loadHealthFresh()
    scriptDbOk(1024)
    scriptQueues({ data: null, error: { message: 'PGRST202' } })
    let res = await handler({ httpMethod: 'GET' })
    assert.equal(parseBody(res).checks.queues, 'unknown')
    assert.equal(res.statusCode, 200)
    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(1024)
    scriptQueues({ data: { cron: {} }, error: null })
    res = await handler({ httpMethod: 'GET' })
    assert.equal(parseBody(res).checks.queues, 'unknown')
    // Gunoi CU forma de top-level (recenzie #246): grupe goale, array-uri în
    // loc de obiecte, o cheie de vârstă redenumită de un RPC viitor, o coadă
    // lipsă — toate → unknown, NICIODATĂ ok. Controlul pozitiv: forma completă → ok.
    const renamed = backlog()
    renamed.cron.email = { waiting: 9, oldest_age_seconds: 3600 }
    const missingQueue = backlog()
    delete missingQueue.bridge.tickets
    // `slack_alerts` e doar raportat, dar e în contract: lipsă sau ne-numeric → unknown.
    const missingSlack = backlog()
    delete missingSlack.cron.slack_alerts
    const badSlack = backlog()
    badSlack.cron.slack_alerts = { waiting: 'multe' }
    for (const data of [{ cron: {}, bridge: {} }, { cron: [], bridge: [] }, renamed, missingQueue, missingSlack, badSlack]) {
      ;({ handler } = loadHealthFresh())
      resetMocks()
      scriptDbOk(1024)
      scriptQueues({ data, error: null })
      res = await handler({ httpMethod: 'GET' })
      assert.equal(parseBody(res).checks.queues, 'unknown', JSON.stringify(data))
      assert.equal(res.statusCode, 200)
    }
    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(1024)
    scriptQueues({ data: backlog(), error: null })
    assert.equal(parseBody(await handler({ httpMethod: 'GET' })).checks.queues, 'ok', 'controlul pozitiv')
  })

  it('HL19: numărătorile ajung DOAR cu token', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    const handler = withQueues(backlog({ 'cron.email': { waiting: 7, oldest_age_s: 60 } }))
    const pub = parseBody(await handler({ httpMethod: 'GET' }))
    assert.ok(!JSON.stringify(pub).includes('oldest_age'), 'vârsta cozii a ajuns public')
    assert.equal('queue_detail' in pub, false)
    const diag = parseBody(await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'secret-diag-token' } }))
    assert.equal(diag.queue_detail.cron.email.waiting, 7)
  })
})
