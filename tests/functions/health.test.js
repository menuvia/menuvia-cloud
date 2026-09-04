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
const { state, resetMocks, installModuleMocks, parseBody } = require('./helpers/mocks')

const HEALTH_PATH = path.join(__dirname, '..', '..', 'netlify', 'functions', 'health.js')

// 490 MB — sub plafonul implicit de 500 MB, dar peste pragul critic de 90%.
const BYTES_98_PCT = Math.round(500 * 1024 * 1024 * 0.98)

function loadHealthFresh() {
  installModuleMocks()
  delete require.cache[require.resolve(HEALTH_PATH)]
  return require(HEALTH_PATH)
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
    assert.equal(body.storage_detail, null, 'suprafața publică nu mai are voie să poarte cifre')
    // Plasă de siguranță pe TOT corpul, nu doar pe câmpurile știute.
    assert.ok(!JSON.stringify(body).includes('audit_log'), 'un nume de tabel a ajuns în răspunsul public')
    assert.ok(!JSON.stringify(body).includes('used_pct'), 'procentul (deci și dimensiunea) a ajuns public')
  })

  it('HL5: cu tokenul corect, diagnosticul complet e livrat', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    const { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)

    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: { diag: 'secret-diag-token' },
    })
    const body = parseBody(res)
    assert.equal(body.storage_detail.bytes, BYTES_98_PCT)
    assert.ok(Array.isArray(body.storage_detail.top_tables))
    assert.equal(body.storage_detail.top_tables[0].name, 'audit_log')

    // Antetul e calea INTENȚIONATĂ (`?diag=` pune secretul în URL, deci în
    // loguri). Netlify și shim-ul VPS trimit cheile minuscule.
    const viaHeader = parseBody(
      await handler({ httpMethod: 'GET', headers: { 'x-health-diag': 'secret-diag-token' } }),
    )
    assert.equal(viaHeader.storage_detail.bytes, BYTES_98_PCT, 'calea prin antet nu funcționează')
  })

  it('HL6: token greșit sau env nesetat → FAIL-CLOSED, niciun detaliu', async () => {
    process.env.HEALTH_DIAG_TOKEN = 'secret-diag-token'
    let { handler } = loadHealthFresh()
    scriptDbOk(BYTES_98_PCT)
    let body = parseBody(await handler({ httpMethod: 'GET', queryStringParameters: { diag: 'gresit' } }))
    assert.equal(body.storage_detail, null, 'token greșit (altă lungime) a primit diagnosticul')

    // Token greșit de ACEEAȘI LUNGIME — altfel comparația de egalitate nu e
    // exercitată NICIODATĂ (verificarea de lungime respinge prima) și ștergerea
    // ei ar lăsa suita verde: gate-ul ar degrada la „orice șir de lungimea bună".
    const sameLen = 'x'.repeat('secret-diag-token'.length)
    body = parseBody(await handler({ httpMethod: 'GET', queryStringParameters: { diag: sameLen } }))
    assert.equal(body.storage_detail, null, 'token greșit de aceeași lungime a primit diagnosticul')

    // Env NEsetat: prezentarea unui token oarecare NU deschide suprafața.
    delete process.env.HEALTH_DIAG_TOKEN
    ;({ handler } = loadHealthFresh())
    resetMocks()
    scriptDbOk(BYTES_98_PCT)
    body = parseBody(await handler({ httpMethod: 'GET', queryStringParameters: { diag: '' } }))
    assert.equal(body.storage_detail, null, 'fără env, suprafața s-a deschis (nu e fail-closed)')
  })
})
