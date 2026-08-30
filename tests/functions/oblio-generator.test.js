// tests/functions/oblio-generator.test.js
// Testele generatorului de FACTURI FISCALE Oblio. Invariantul central (mig 218):
// un eșec AMBIGUU (POST atins + eroare de rețea/abort, sau factură emisă dar
// neînregistrată) e TERMINAL — mark_ambiguous, FĂRĂ requeue — fiindcă un retry
// automat poate produce un DUPLICAT fiscal real. Erorile clare (4xx Oblio) și
// cele PRE-POST rămân retryabile prin mark_failed.
//
// fetch-ul global e înlocuit per-test cu un router pe URL; tokenCache-ul e la
// nivel de MODUL în funcție (persistă între teste) → fiecare test folosește un
// api_email UNIC, mai puțin testele care verifică exact cache-ul.

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, rpcCallsFor } = require('./helpers/mocks')

const { handler } = loadFunction('netlify/functions/oblio-generator.js')

const realFetch = globalThis.fetch
let fetchCalls = []

function setEnv() {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'
}

function jsonRes(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(obj),
    json: async () => obj,
  }
}

// Router implicit: auth OK + emitere OK (seria MNV, numărul 42).
function scriptFetch({ auth, invoice } = {}) {
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts })
    if (String(url).includes('/authorize/token')) {
      if (auth) return auth(url, opts)
      return jsonRes(200, { access_token: 'tok_1', expires_in: 3600 })
    }
    if (String(url).includes('/docs/invoice')) {
      if (invoice) return invoice(url, opts)
      return jsonRes(200, {
        status: 200, statusMessage: 'Success',
        data: { seriesName: 'MNV', number: '42', link: 'https://oblio/x.pdf' },
      })
    }
    throw new Error(`fetch neașteptat: ${url}`)
  }
}

let emailSeq = 0
function makeInvoice(overrides = {}) {
  emailSeq++
  return {
    invoice_id: `inv-${emailSeq}`,
    order_id: `ord-${emailSeq}`,
    api_email: `firma${emailSeq}@test.ro`, // unic → cache-ul de token nu se lovește între teste
    api_secret: 'secret',
    test_mode: false,
    vat_included: true,
    default_series: 'MNV',
    company_cif: 'RO123',
    customer_name: 'Client SRL',
    customer_cif: 'RO999',
    is_b2b: true,
    send_email: false,
    ...overrides,
  }
}

// Comandă simplă: 1 linie, fără discount, TVA 19% configurată.
function scriptOrderData({ items, order, vatRates } = {}) {
  state.fromHandlers.order_items = () => ({
    data: items ?? [{
      quantity: 2, unit_price_snapshot: 10, item_total: 20,
      products: { name: 'Pizza', vat_group: 1 },
    }],
    error: null,
  })
  state.fromHandlers.orders = () => ({
    data: order ?? { restaurant_id: 'r1', total: 20, discount_amount: 0 },
    error: null,
  })
  state.fromHandlers.vat_rates = () => ({
    data: vatRates ?? [{ vat_group: 1, rate_percent: '19' }],
    error: null,
  })
}

function queued(...invoices) {
  state.rpcHandlers.bridge_oblio_get_queued = () => ({ data: invoices, error: null })
}

function postedPayload() {
  const call = fetchCalls.find((c) => c.url.includes('/docs/invoice'))
  return call ? JSON.parse(call.opts.body) : null
}

beforeEach(() => { resetMocks(); setEnv(); fetchCalls = [] })
afterEach(() => { globalThis.fetch = realFetch })

describe('oblio-generator: coada', () => {
  it('claim eșuat → 500', async () => {
    state.rpcHandlers.bridge_oblio_get_queued = () => ({ data: null, error: { message: 'db down' } })
    const res = await handler()
    assert.equal(res.statusCode, 500)
  })

  it('coadă goală → 200 fără apeluri Oblio', async () => {
    queued()
    scriptFetch()
    const res = await handler()
    assert.equal(res.statusCode, 200)
    assert.equal(fetchCalls.length, 0)
  })
})

describe('oblio-generator: emitere reușită', () => {
  it('happy path: mark_issued cu seria+numărul din răspuns; payload cu vatName derivat', async () => {
    queued(makeInvoice())
    scriptOrderData()
    scriptFetch()
    state.rpcHandlers.bridge_oblio_mark_issued = () => ({ data: null, error: null })

    const res = await handler()
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { processed: 1, issued: 1, failed: 0 })
    const mark = rpcCallsFor('bridge_oblio_mark_issued')[0]
    assert.equal(mark.args.p_series, 'MNV')
    assert.equal(mark.args.p_number, '42')

    const payload = postedPayload()
    assert.equal(payload.products.length, 1)
    assert.equal(payload.products[0].vatName, 'Normala') // 19% → cota standard
    assert.equal(payload.products[0].price, 10) // item_total 20 / qty 2, fără discount
    assert.equal(payload.internalNote, `order:${queuedOrderId()}`)
  })

  it('discount de comandă: liniile se scalează cu total/subtotal (factura = ce s-a plătit)', async () => {
    queued(makeInvoice())
    scriptOrderData({
      items: [
        { quantity: 2, unit_price_snapshot: 10, item_total: 20, products: { name: 'Pizza', vat_group: 1 } },
        { quantity: 1, unit_price_snapshot: 10, item_total: 10, products: { name: 'Limonadă', vat_group: 2 } },
      ],
      // subtotal 30, discount 3 → total 27 → factor 0.9
      order: { restaurant_id: 'r1', total: 27, discount_amount: 3 },
      vatRates: [{ vat_group: 1, rate_percent: '19' }, { vat_group: 2, rate_percent: '9' }],
    })
    scriptFetch()
    state.rpcHandlers.bridge_oblio_mark_issued = () => ({ data: null, error: null })

    await handler()
    const payload = postedPayload()
    assert.ok(Math.abs(payload.products[0].price - 9) < 1e-9)  // 10 × 0.9
    assert.ok(Math.abs(payload.products[1].price - 9) < 1e-9)
    assert.equal(payload.products[1].vatName, 'Redusa') // 9% → cota redusă
    // Σ linii = order.total (ce a plătit clientul, post-discount)
    const sum = payload.products.reduce((s, p) => s + p.price * p.quantity, 0)
    assert.ok(Math.abs(sum - 27) < 1e-9)
  })

  it('vat_included=false: prețul trimis e NET (gross/(1+cota)), Oblio adaugă TVA la loc', async () => {
    queued(makeInvoice({ vat_included: false }))
    scriptOrderData({
      items: [{ quantity: 1, unit_price_snapshot: 11.9, item_total: 11.9, products: { name: 'Pizza', vat_group: 1 } }],
      order: { restaurant_id: 'r1', total: 11.9, discount_amount: 0 },
    })
    scriptFetch()
    state.rpcHandlers.bridge_oblio_mark_issued = () => ({ data: null, error: null })

    await handler()
    const payload = postedPayload()
    assert.ok(Math.abs(payload.products[0].price - 10) < 1e-9) // 11.9 / 1.19
    assert.equal(payload.products[0].vatIncluded, false)
  })

  it('cota 0% → vatName SFDD (nu Normala hardcodat)', async () => {
    queued(makeInvoice())
    scriptOrderData({
      items: [{ quantity: 1, unit_price_snapshot: 10, item_total: 10, products: { name: 'Apă', vat_group: 3 } }],
      order: { restaurant_id: 'r1', total: 10, discount_amount: 0 },
      vatRates: [{ vat_group: 3, rate_percent: '0' }],
    })
    scriptFetch()
    state.rpcHandlers.bridge_oblio_mark_issued = () => ({ data: null, error: null })

    await handler()
    assert.equal(postedPayload().products[0].vatName, 'SFDD')
  })
})

describe('oblio-generator: politica de eșec (mig 218 — ambiguu e TERMINAL)', () => {
  it('4xx clar de la Oblio → mark_failed (retry auto sigur), fără marker de duplicat', async () => {
    queued(makeInvoice())
    scriptOrderData()
    scriptFetch({ invoice: () => jsonRes(400, { status: 400, statusMessage: 'CIF invalid' }) })
    state.rpcHandlers.bridge_oblio_mark_failed = () => ({ data: null, error: null })

    const res = await handler()
    assert.equal(res.statusCode, 500) // tot batch-ul (1/1) a eșuat
    const mark = rpcCallsFor('bridge_oblio_mark_failed')[0]
    assert.ok(mark, 'trebuia mark_failed, nu mark_ambiguous')
    assert.equal(rpcCallsFor('bridge_oblio_mark_ambiguous').length, 0)
    assert.ok(!mark.args.p_error.includes('POSIBIL DUPLICAT'))
  })

  it('eroare de rețea DUPĂ POST → mark_ambiguous cu marker POSIBIL DUPLICAT (fără requeue)', async () => {
    queued(makeInvoice())
    scriptOrderData()
    scriptFetch({ invoice: () => { throw new TypeError('fetch failed') } })
    state.rpcHandlers.bridge_oblio_mark_ambiguous = () => ({ data: null, error: null })

    await handler()
    const mark = rpcCallsFor('bridge_oblio_mark_ambiguous')[0]
    assert.ok(mark, 'trebuia mark_ambiguous')
    assert.ok(mark.args.p_error.startsWith('POSIBIL DUPLICAT'))
    assert.equal(rpcCallsFor('bridge_oblio_mark_failed').length, 0)
  })

  it('eroare de rețea ÎNAINTE de POST (auth) → mark_failed (factura sigur NU există la Oblio)', async () => {
    queued(makeInvoice())
    scriptOrderData()
    scriptFetch({ auth: () => { throw new TypeError('fetch failed') } })
    state.rpcHandlers.bridge_oblio_mark_failed = () => ({ data: null, error: null })

    await handler()
    assert.equal(rpcCallsFor('bridge_oblio_mark_failed').length, 1)
    assert.equal(rpcCallsFor('bridge_oblio_mark_ambiguous').length, 0)
  })

  it('factură EMISĂ dar mark_issued eșuează (blip DB) → mark_ambiguous (retry = duplicat)', async () => {
    queued(makeInvoice())
    scriptOrderData()
    scriptFetch()
    state.rpcHandlers.bridge_oblio_mark_issued = () => ({ data: null, error: { message: 'db blip' } })
    state.rpcHandlers.bridge_oblio_mark_ambiguous = () => ({ data: null, error: null })

    await handler()
    const mark = rpcCallsFor('bridge_oblio_mark_ambiguous')[0]
    assert.ok(mark)
    assert.ok(mark.args.p_error.includes('EMISĂ'))
  })

  it('răspuns 200 FĂRĂ număr de factură → eșec (succesul se confirmă POZITIV), retryabil', async () => {
    queued(makeInvoice())
    scriptOrderData()
    scriptFetch({ invoice: () => jsonRes(200, { status: 200, statusMessage: 'Success', data: {} }) })
    state.rpcHandlers.bridge_oblio_mark_failed = () => ({ data: null, error: null })

    await handler()
    assert.equal(rpcCallsFor('bridge_oblio_mark_issued').length, 0)
    assert.equal(rpcCallsFor('bridge_oblio_mark_failed').length, 1)
  })

  it('grupă TVA lipsă din configurație → eșec explicit, NU cotă presupusă', async () => {
    queued(makeInvoice())
    scriptOrderData({ vatRates: [] })
    scriptFetch()
    state.rpcHandlers.bridge_oblio_mark_failed = () => ({ data: null, error: null })

    await handler()
    const mark = rpcCallsFor('bridge_oblio_mark_failed')[0]
    assert.ok(mark.args.p_error.includes('Grupă TVA'))
    // POST-ul spre Oblio nu s-a făcut deloc.
    assert.equal(fetchCalls.filter((c) => c.url.includes('/docs/invoice')).length, 0)
  })
})

describe('oblio-generator: batch + cache de token', () => {
  it('eșec parțial → 200 cu detalii; eșec total → 500', async () => {
    // Două facturi pe același cont: prima emite, a doua ia 4xx.
    const inv1 = makeInvoice()
    const inv2 = makeInvoice({ api_email: inv1.api_email })
    queued(inv1, inv2)
    scriptOrderData()
    let posts = 0
    scriptFetch({
      invoice: () => {
        posts++
        return posts === 1
          ? jsonRes(200, { status: 200, data: { seriesName: 'MNV', number: '43' } })
          : jsonRes(400, { status: 400, statusMessage: 'CIF invalid' })
      },
    })
    state.rpcHandlers.bridge_oblio_mark_issued = () => ({ data: null, error: null })
    state.rpcHandlers.bridge_oblio_mark_failed = () => ({ data: null, error: null })

    const res = await handler()
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { processed: 2, issued: 1, failed: 1 })
    // Token-ul s-a cerut O dată pentru ambele facturi (cache pe email+test_mode).
    assert.equal(fetchCalls.filter((c) => c.url.includes('/authorize/token')).length, 1)
  })

  it('eroare 401 la POST → cache-ul de token se golește (re-auth la următoarea rulare)', async () => {
    const inv = makeInvoice()
    queued(inv)
    scriptOrderData()
    scriptFetch({ invoice: () => jsonRes(401, { status: 401, statusMessage: 'Unauthorized' }) })
    state.rpcHandlers.bridge_oblio_mark_failed = () => ({ data: null, error: null })
    await handler()
    const authCallsFirstRun = fetchCalls.filter((c) => c.url.includes('/authorize/token')).length
    assert.equal(authCallsFirstRun, 1)

    // A doua rulare pe ACELAȘI cont: fără evicție, cache-ul ar sări peste auth.
    fetchCalls = []
    queued(makeInvoice({ api_email: inv.api_email }))
    scriptFetch({ invoice: () => jsonRes(401, { status: 401, statusMessage: 'Unauthorized' }) })
    await handler()
    assert.equal(fetchCalls.filter((c) => c.url.includes('/authorize/token')).length, 1)
  })
})

// order_id-ul ultimei facturi generate de makeInvoice (pentru asserția pe internalNote).
function queuedOrderId() {
  return `ord-${emailSeq}`
}
