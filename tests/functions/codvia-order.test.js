// tests/functions/codvia-order.test.js
// Gate-ul de PAUZĂ al comenzilor Codvia (docs/ECOSISTEM.md, Pariul 2).
//
// De ce există: /codvia e în build-ul publicat și ia comenzi de bunuri fizice
// fără termeni de vânzare randați, fără confirmare pe suport durabil către
// cumpărător și cu 1 × PVC la −13 lei marjă. Până la lansarea legală, comenzile
// stau ÎNCHISE, iar gate-ul e pe server (sursa unică) — fail-closed.
//
//   CO1  env nesetat → POST 503 `orders_paused`, ZERO efecte (fără rate-limit,
//        fără scriere în DB, fără email)
//   CO2  fail-closed pe valoare: doar `true` EXACT deschide ('1', 'TRUE', 'yes' nu)
//   CO3  gate-ul precede validarea: un produs invalid pe închis tot 503, nu 400
//   CO4  GET expune starea (fără cache), pentru pagină
//   CO5  control pozitiv: cu `true`, o comandă validă chiar ajunge în DB → 200

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, rpcCallsFor, parseBody } = require('./helpers/mocks')

const { handler } = loadFunction('netlify/functions/codvia-order.js')

const VALID = {
  product: 'stand_plexi',
  quantity: 4,
  name: 'Ana Pop',
  business: 'Bistro Test',
  phone: '0722000000',
  email: 'ana@example.com',
  address: 'Str. Test 1, Cluj',
}

function post(body) {
  return handler({
    httpMethod: 'POST',
    headers: { origin: 'https://menuvia.ro', 'x-nf-client-connection-ip': '1.2.3.4' },
    body: JSON.stringify(body),
  })
}

let fetchCalls
const realFetch = global.fetch

beforeEach(() => {
  resetMocks()
  delete process.env.CODVIA_ORDERS_OPEN
  delete process.env.RESEND_API_KEY
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'
  fetchCalls = []
  global.fetch = async (...args) => {
    fetchCalls.push(args)
    return { ok: true, text: async () => '' }
  }
  state.rpcHandlers.check_rate_limit = () => ({ data: true, error: null })
  state.fromHandlers.recrutare_leads = () => ({ data: null, error: null })
})

afterEach(() => {
  global.fetch = realFetch
  delete process.env.CODVIA_ORDERS_OPEN
})

describe('codvia-order — comenzi în pauză (fail-closed)', () => {
  it('CO1: env nesetat → 503 orders_paused, fără niciun efect', async () => {
    process.env.RESEND_API_KEY = 're_test' // chiar și cu email configurat
    const res = await post(VALID)
    assert.equal(res.statusCode, 503)
    const body = parseBody(res)
    assert.equal(body.code, 'orders_paused')
    assert.match(body.error, /pauză/)
    assert.equal(rpcCallsFor('check_rate_limit').length, 0, 'rate-limit-ul nu trebuia atins')
    assert.equal(state.fromCalls.length, 0, 'nicio scriere în DB pe închis')
    assert.equal(fetchCalls.length, 0, 'niciun email pe închis')
  })

  it('CO2: doar `true` EXACT deschide', async () => {
    for (const v of ['1', 'TRUE', 'yes', 'on', ' true', '']) {
      resetMocks()
      process.env.CODVIA_ORDERS_OPEN = v
      const res = await post(VALID)
      assert.equal(res.statusCode, 503, `CODVIA_ORDERS_OPEN=${JSON.stringify(v)} a deschis comenzile`)
      assert.equal(state.fromCalls.length, 0)
    }
  })

  it('CO3: gate-ul precede validarea (produs invalid pe închis → 503, nu 400)', async () => {
    const res = await post({ ...VALID, product: 'constructor' })
    assert.equal(res.statusCode, 503)
  })

  it('CO4: GET expune starea, fără cache', async () => {
    let res = await handler({ httpMethod: 'GET', headers: {} })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(parseBody(res), { open: false })
    assert.equal(res.headers['Cache-Control'], 'no-store')

    process.env.CODVIA_ORDERS_OPEN = 'true'
    res = await handler({ httpMethod: 'GET', headers: {} })
    assert.deepEqual(parseBody(res), { open: true })
  })

  it('CO5 (control pozitiv): cu `true`, comanda validă ajunge în DB → 200', async () => {
    process.env.CODVIA_ORDERS_OPEN = 'true'
    const res = await post(VALID)
    assert.equal(res.statusCode, 200, `corp: ${res.body}`)
    assert.equal(rpcCallsFor('check_rate_limit').length, 1)
    const writes = state.fromCalls.filter((c) => c.table === 'recrutare_leads')
    assert.equal(writes.length, 1, 'comanda trebuia să ajungă în recrutare_leads')
    const insert = writes[0].ops.find((o) => o.m === 'insert')
    assert.equal(insert.args[0].source, 'codvia_order')
  })
})
