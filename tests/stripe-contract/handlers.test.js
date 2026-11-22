// tests/stripe-contract/handlers.test.js
// Handler-ele REALE pe SDK-ul REAL, cu supabase fals (harness-ul din
// tests/functions în modul `stripe: 'real'`) și transportul HTTP fals. Dovedește
// cap-coadă ce testele cu fake nu pot: ce pleacă efectiv pe fir din funcțiile
// noastre după bump-ul de SDK.
//
//   SDK8   stripe-checkout: 200 cu url; toate cele trei cereri (abonamente,
//          sesiuni deschise, creare) pe pin; cheia checkout_*; metadata sesiunii
//   SDK8b  stripe-checkout: Stripe răspunde 400 `idempotency_error` (aceeași
//          cheie, alt corp — limba NU e în cheie, lotul L8d) → 409
//          `checkout_in_progress`, fără mesajul englezesc al Stripe; control:
//          400 `invalid_request_error` → 502 `checkout_create_failed`. Dovedește
//          pe SDK-ul REAL forma erorii pe care o citește `isIdempotencyConflict`
//          (fake-ul din tests/functions o construiește de mână, deci e orb aici):
//          `StripeIdempotencyError` DOAR pe 400/404; pe alt status (409)
//          `StripeAPIError` cu tipul doar în `rawType` → tot 409 la client.
//          Cererea CONCURENTĂ (409 `invalid_request_error` +
//          `idempotency_key_in_use`, dublu-click) rămâne 502: tranzitorie.
//          [PICĂ: `rawType` scos din `isIdempotencyConflict`; verificarea
//          lărgită după `statusCode === 409` sau după `code`]
//   SDK8c  stripe-checkout — o singură sesiune deschisă per client, pe fir:
//          `checkout.sessions.list` pleacă GET cu customer / `created[gte]` /
//          limit=100 în query, FĂRĂ `status` (segmentul de stare al cheii cere și
//          sesiunile expirate/finalizate), și pe pin; `created[gte]` e începutul
//          ferestrei cheii − 25 h, deci aliniat la 30 de minute și între
//          acum − 25,5 h și acum − 25 h (ceasul nu se îngheață aici: SDK-ul
//          real îl citește); aceeași plată deschisă → URL-ul ei, ZERO POST;
//          alt plan → POST `/v1/checkout/sessions/<id>/expire` ÎNAINTEA
//          creării; lista refuzată (500) → 409 `checkout_in_progress`; pagina
//          2 cerută cu `starting_after=<ultima sesiune a paginii 1>` (și
//          restul query-ului neschimbat), închiderea abia după ea; REPLAY al
//          cheii (antetul `idempotent-replayed: true` pe răspunsul creării) →
//          GET `/v1/checkout/sessions/<id>` pe pin: `expired` → 409, `open` →
//          200 — dovedește că antetul chiar se vede pe `lastResponse` la
//          SDK-ul REAL (fake-ul îl construiește de mână). Fake-ul din
//          tests/functions nu vede calea, metoda HTTP sau codarea query-ului.
//          `STRIPE_TRIAL_DAYS=30` explicit în SDK8 și SDK8c (metadata
//          `trial_days: '30'`), restaurat după.
//          [PICĂ: lista sau expire scoase; `status: 'open'` readus în listă;
//          `created` scos sau calculat din „acum”; o singură pagină; cursorul
//          greșit; replay-ul nedetectat sau citit din corpul salvat]
//   SDK9   table-payment: supersede și opt-out — fiecare anulare pleacă cu antet
//          Stripe-Account (defectul v22), create-ul cu cheia tp_. Celelalte două
//          anulări (split-uri stale, attach eșuat) sunt ținute de fake-ul din
//          tests/functions, care aruncă pe forma veche (mutații dovedite).
//   SDK10  stripe-webhook cu semnătură REALĂ: payload dahlia → comision cu plan și
//          abonament; charge fără `invoice` → re-citire; formă necunoscută → 500;
//          eveniment LIVE pe cheia de TEST → ignorat cu semnătură reală (livemode)
//   SDK12  stripe-webhook, abonament unic la finalizare: profilul ține alt
//          abonament VIU → pe fir, în ORDINE: citirea dublurii, citirea celui
//          păstrat, DELETE pe dublură (urma în query, fără cheie), a doua
//          citire a celui păstrat (verificarea de după anulare), facturile lui
//          deschise (GET /v1/invoices?subscription=…&status=open — încasarea
//          oprită de anulare, runda 2 CodeRabbit), factura dublurii, lista de
//          rambursări (pe payment_intent), POST /v1/refunds cu cheia
//          `dupsub_refund_<factură>`; profilul (fake cu WHERE evaluat) neatins.
//          Fake-ul din tests/functions nu vede metoda HTTP, query-ul sau
//          antetele. [DE CONFIRMAT ÎN CI — SDK-ul real nu se poate instala în
//          sesiunea agentului, deci nici testul, nici mutațiile lui (rambursarea
//          înaintea anulării; urma scoasă) n-au rulat încă; ordinea și urma sunt
//          ținute oricum de DUP16 și DUP2 în tests/functions]

'use strict'

const { describe, it, before, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const t = require('./helpers/transport')
const {
  state, resetMocks, loadFunction, rpcCallsFor, parseBody, installTable,
} = require('../functions/helpers/mocks')

const PIN = '2023-10-16'
const checkout = loadFunction('netlify/functions/stripe-checkout.js', { stripe: 'real' }).handler
const tablePay = loadFunction('netlify/functions/table-payment.js', { stripe: 'real' }).handler
const webhook = loadFunction('netlify/functions/stripe-webhook.js', { stripe: 'real' }).handler
const Stripe = require('stripe')

before(() => {
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-contract-'))
})
beforeEach(() => {
  resetMocks()
  t.install()
  Object.assign(process.env, {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_contract',
    STRIPE_STARTER_PRICE_ID: 'price_starter',
    STRIPE_GROWTH_PRICE_ID: 'price_growth',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_ENTERPRISE_PRICE_ID: 'price_ent',
  })
})
afterEach(() => t.restore())

function form(rec) { return t.form(rec) }

// `STRIPE_TRIAL_DAYS` explicit (metadata `trial_days: '30'` nu mai depinde de
// implicitul din cod sau de mediul runner-ului), valoarea anterioară restaurată.
function withTrialDays(value) {
  let saved
  beforeEach(() => {
    saved = Object.prototype.hasOwnProperty.call(process.env, 'STRIPE_TRIAL_DAYS') ? process.env.STRIPE_TRIAL_DAYS : undefined
    process.env.STRIPE_TRIAL_DAYS = value
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_TRIAL_DAYS
    else process.env.STRIPE_TRIAL_DAYS = saved
  })
}

describe('SDK8: stripe-checkout pe SDK-ul real', () => {
  withTrialDays('30')

  it('200 cu url; lista de abonamente și sesiunea pleacă pe pin, cu cheia checkout_*', async () => {
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers.check_rate_limit = () => ({ data: true, error: null })
    state.fromHandlers.profiles = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
    t.route('GET', '/v1/subscriptions', { body: { object: 'list', has_more: false, data: [] } })
    t.route('GET', '/v1/checkout/sessions', { body: { object: 'list', has_more: false, data: [] } })
    t.route('POST', '/v1/checkout/sessions', { body: { id: 'cs_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_1' } })
    const res = await checkout({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ plan: 'growth' }) })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(parseBody(res).url, 'https://checkout.stripe.com/c/cs_1')
    const reqs = t.requests()
    assert.equal(reqs.length, 3)
    for (const r of reqs) assert.equal(r.headers['stripe-version'], PIN)
    const sess = reqs.find((r) => r.method === 'POST' && r.path === '/v1/checkout/sessions')
    assert.match(sess.headers['idempotency-key'], /^checkout_/)
    const b = form(sess)
    assert.equal(b.customer, 'cus_1')
    assert.equal(b.mode, 'subscription')
    assert.equal(b['line_items[0][price]'], 'price_growth')
    assert.equal(b['subscription_data[metadata][plan]'], 'growth')
    // Metadata SESIUNII: ce citește `isReusableSession` la cererea următoare.
    assert.equal(b['metadata[plan]'], 'growth')
    assert.equal(b['metadata[price_id]'], 'price_growth')
    assert.equal(b['metadata[trial_days]'], '30')
  })
})

describe('SDK8b: stripe-checkout — cheia de idempotență refuzată, pe SDK-ul real', () => {
  const IDEM_MSG = "Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'checkout_v7_x' if you meant to execute a different request."
  // Răspunsul Stripe pentru o cerere concurentă cu aceeași cheie (forma din
  // beam-community/stripity_stripe#564: 409, `invalid_request_error`).
  const IN_USE_ERR = {
    type: 'invalid_request_error',
    code: 'idempotency_key_in_use',
    message: 'There is currently another in-progress request using this Idempotent Key (that probably means you submitted twice, and the other request is still going through): checkout_v7_x. Please try again later.',
  }

  async function run(sessionReply) {
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers.check_rate_limit = () => ({ data: true, error: null })
    state.fromHandlers.profiles = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
    t.route('GET', '/v1/subscriptions', { body: { object: 'list', has_more: false, data: [] } })
    t.route('GET', '/v1/checkout/sessions', { body: { object: 'list', has_more: false, data: [] } })
    t.route('POST', '/v1/checkout/sessions', sessionReply)
    const saved = console.error
    console.error = () => {}
    try {
      return await checkout({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ plan: 'growth', ui_lang: 'ro' }),
      })
    } finally {
      console.error = saved
    }
  }

  it('forma erorii SDK-ului: type StripeIdempotencyError, rawType idempotency_error', async () => {
    t.route('POST', '/v1/checkout/sessions', { status: 400, body: { error: { type: 'idempotency_error', message: IDEM_MSG } } })
    const stripe = new Stripe('sk_test_x', { apiVersion: PIN, timeout: 6000, maxNetworkRetries: 0 })
    await assert.rejects(
      stripe.checkout.sessions.create({ customer: 'cus_1', mode: 'subscription' }, { idempotencyKey: 'k' }),
      (e) => {
        assert.equal(e.type, 'StripeIdempotencyError')
        assert.equal(e.rawType, 'idempotency_error')
        assert.ok(e instanceof stripe.errors.StripeIdempotencyError)
        return true
      },
    )
  })

  it('forma erorii pe alt status: 409 idempotency_error → StripeAPIError, tipul doar în rawType', async () => {
    // generateV1Error decide întâi după status: clasa dedicată există doar pe
    // 400/404, deci verificarea pe `rawType` nu e redundantă.
    t.route('POST', '/v1/checkout/sessions', { status: 409, body: { error: { type: 'idempotency_error', message: IDEM_MSG } } })
    const stripe = new Stripe('sk_test_x', { apiVersion: PIN, timeout: 6000, maxNetworkRetries: 0 })
    await assert.rejects(
      stripe.checkout.sessions.create({ customer: 'cus_1', mode: 'subscription' }, { idempotencyKey: 'k' }),
      (e) => {
        assert.equal(e.type, 'StripeAPIError')
        assert.equal(e.rawType, 'idempotency_error')
        assert.ok(!(e instanceof stripe.errors.StripeIdempotencyError))
        return true
      },
    )
  })

  it('forma cererii CONCURENTE: 409 idempotency_key_in_use → StripeAPIError, rawType invalid_request_error', async () => {
    t.route('POST', '/v1/checkout/sessions', { status: 409, body: { error: IN_USE_ERR } })
    const stripe = new Stripe('sk_test_x', { apiVersion: PIN, timeout: 6000, maxNetworkRetries: 0 })
    await assert.rejects(
      stripe.checkout.sessions.create({ customer: 'cus_1', mode: 'subscription' }, { idempotencyKey: 'k' }),
      (e) => {
        assert.equal(e.type, 'StripeAPIError')
        assert.equal(e.rawType, 'invalid_request_error')
        assert.equal(e.code, 'idempotency_key_in_use')
        assert.equal(e.statusCode, 409)
        return true
      },
    )
  })

  it('400 idempotency_error → 409 checkout_in_progress, mesajul Stripe nu ajunge la client', async () => {
    const res = await run({ status: 400, body: { error: { type: 'idempotency_error', message: IDEM_MSG } } })
    assert.equal(res.statusCode, 409, res.body)
    assert.equal(parseBody(res).code, 'checkout_in_progress')
    assert.ok(!res.body.includes('idempotent'), res.body)
    // Cererea chiar a plecat cu cheia v7, fără segment de limbă, și cu `locale` în corp.
    const sess = t.requests().find((r) => r.method === 'POST' && r.path === '/v1/checkout/sessions')
    assert.match(sess.headers['idempotency-key'], /^checkout_v7_[0-9a-f]{10}_u1_growth_none_\d+_s0_\d+$/)
    assert.equal(form(sess).locale, 'ro')
  })

  it('409 idempotency_error (alt status decât 400/404, doar rawType) → tot 409 checkout_in_progress', async () => {
    const res = await run({ status: 409, body: { error: { type: 'idempotency_error', message: IDEM_MSG } } })
    assert.equal(res.statusCode, 409, res.body)
    assert.equal(parseBody(res).code, 'checkout_in_progress')
    assert.ok(!res.body.includes('idempotent'), res.body)
  })

  it('cerere CONCURENTĂ: 409 idempotency_key_in_use → 502 checkout_create_failed, NU checkout_in_progress', async () => {
    // Dublu-click: aceeași cheie, același corp, prima cerere încă în zbor.
    // Tranzitoriu — reîncercarea primește sesiunea din cache; nu „o plată e
    // deja în curs” pentru propria lui plată.
    const res = await run({ status: 409, body: { error: IN_USE_ERR } })
    assert.equal(res.statusCode, 502, res.body)
    assert.equal(parseBody(res).code, 'checkout_create_failed')
    assert.ok(!res.body.includes('Idempotent'), res.body)
  })

  it('control: 400 invalid_request_error → 502 checkout_create_failed', async () => {
    const res = await run({
      status: 400,
      body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such price' } },
    })
    assert.equal(res.statusCode, 502, res.body)
    assert.equal(parseBody(res).code, 'checkout_create_failed')
  })
})

describe('SDK8c: stripe-checkout — o singură sesiune deschisă per client, pe SDK-ul real', () => {
  withTrialDays('30')
  const APP = 'https://app.test'
  let savedApp
  beforeEach(() => {
    savedApp = process.env.VITE_APP_URL
    process.env.VITE_APP_URL = APP
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers.check_rate_limit = () => ({ data: true, error: null })
    state.fromHandlers.profiles = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
    t.route('GET', '/v1/subscriptions', { body: { object: 'list', has_more: false, data: [] } })
  })
  afterEach(() => {
    if (savedApp === undefined) delete process.env.VITE_APP_URL
    else process.env.VITE_APP_URL = savedApp
  })
  // Creată acum un minut, valabilă încă 24 h (o sesiune care expiră în mai
  // puțin de 30 de minute nu se reia).
  function openSession(over = {}) {
    const nowS = Math.floor(Date.now() / 1000)
    return {
      id: 'cs_open', object: 'checkout.session', mode: 'subscription', status: 'open',
      customer: 'cus_1', created: nowS - 60, expires_at: nowS + 24 * 60 * 60,
      url: 'https://checkout.stripe.com/c/cs_open',
      success_url: `${APP}/dashboard?checkout=success&checkout_plan=growth`,
      metadata: { plan: 'growth', price_id: 'price_growth', trial_days: '30' },
      ...over,
    }
  }
  async function run() {
    const saved = console.error
    console.error = () => {}
    try {
      return await checkout({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ plan: 'growth' }) })
    } finally {
      console.error = saved
    }
  }

  it('aceeași plată deschisă → URL-ul ei; lista pleacă GET cu customer/created[gte]/limit, fără status, pe pin; zero POST', async () => {
    t.route('GET', '/v1/checkout/sessions', { body: { object: 'list', has_more: false, data: [openSession()] } })
    const nowS = Math.floor(Date.now() / 1000)
    const res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(parseBody(res), { url: 'https://checkout.stripe.com/c/cs_open' })
    const list = t.requests().find((r) => r.method === 'GET' && r.path.startsWith('/v1/checkout/sessions'))
    assert.ok(list, 'lista de sesiuni n-a plecat')
    assert.equal(list.headers['stripe-version'], PIN)
    const q = new URL(list.path, 'https://api.stripe.com').searchParams
    assert.equal(q.get('customer'), 'cus_1')
    assert.equal(q.get('status'), null, 'lista nu are voie să filtreze pe stare')
    assert.equal(q.get('limit'), '100')
    const gte = q.get('created[gte]')
    assert.match(String(gte), /^\d+$/, `created[gte] lipsă sau nenumeric: ${list.path}`)
    // Începutul ferestrei de 30 min − 25 h (90 000 s = 50 de ferestre): aliniat.
    assert.equal(Number(gte) % 1800, 0, `created[gte] nealiniat la fereastră: ${gte}`)
    assert.ok(Number(gte) <= nowS - 25 * 3600 + 5 && Number(gte) > nowS - 25 * 3600 - 1800 - 5, `created[gte] în afara ferestrei: ${gte}`)
    assert.equal(t.requests().filter((r) => r.method === 'POST').length, 0)
  })

  it('alt plan deschis → POST …/<id>/expire ÎNAINTEA creării', async () => {
    t.route('GET', '/v1/checkout/sessions', {
      body: { object: 'list', has_more: false, data: [openSession({ id: 'cs_starter', metadata: { plan: 'starter', price_id: 'price_starter', trial_days: '30' } })] },
    })
    // Ruta lui expire ÎNAINTEA celei de creare: potrivirea e pe prefix.
    t.route('POST', '/v1/checkout/sessions/cs_starter/expire', { body: { id: 'cs_starter', object: 'checkout.session', status: 'expired' } })
    t.route('POST', '/v1/checkout/sessions', { body: { id: 'cs_2', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_2' } })
    const res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(parseBody(res), { url: 'https://checkout.stripe.com/c/cs_2' })
    const posts = t.requests().filter((r) => r.method === 'POST').map((r) => r.path)
    assert.deepEqual(posts, ['/v1/checkout/sessions/cs_starter/expire', '/v1/checkout/sessions'])
    const expire = t.requests().find((r) => r.path === '/v1/checkout/sessions/cs_starter/expire')
    assert.equal(expire.headers['stripe-version'], PIN)
    assert.equal(expire.body, '', 'expire pleacă fără corp')
  })

  it('lista refuzată de Stripe (500) → 409 checkout_in_progress, fără creare', async () => {
    t.route('GET', '/v1/checkout/sessions', { status: 500, body: { error: { type: 'api_error', message: 'boom' } } })
    const res = await run()
    assert.equal(res.statusCode, 409, res.body)
    assert.equal(parseBody(res).code, 'checkout_in_progress')
    assert.equal(t.requests().filter((r) => r.method === 'POST').length, 0)
  })

  it('has_more → pagina 2 cu starting_after=<ultima sesiune>, închiderea abia după ea', async () => {
    const stale = openSession({ id: 'cs_p1', metadata: { plan: 'starter', price_id: 'price_starter', trial_days: '30' } })
    t.route('GET', '/v1/checkout/sessions', (req) => (req.path.includes('starting_after=')
      ? { body: { object: 'list', has_more: false, data: [openSession()] } }
      : { body: { object: 'list', has_more: true, data: [stale] } }))
    t.route('POST', '/v1/checkout/sessions/cs_p1/expire', { body: { id: 'cs_p1', object: 'checkout.session', status: 'expired' } })
    const res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(parseBody(res), { url: 'https://checkout.stripe.com/c/cs_open' })
    const reqs = t.requests().filter((r) => r.path.startsWith('/v1/checkout/sessions'))
    assert.deepEqual(reqs.map((r) => r.method), ['GET', 'GET', 'POST'], 'expire înaintea paginii 2')
    const [q1, q2] = reqs.slice(0, 2).map((r) => new URL(r.path, 'https://api.stripe.com').searchParams)
    assert.equal(q1.get('starting_after'), null)
    assert.equal(q2.get('starting_after'), 'cs_p1')
    q2.delete('starting_after')
    assert.equal(q2.toString(), q1.toString(), 'pagina 2 cu alt filtru decât pagina 1')
  })

  it('REPLAY al cheii (idempotent-replayed) → GET sesiunea pe pin: expired → 409, open → 200', async () => {
    for (const [status, code] of [['expired', 409], ['open', 200]]) {
      t.install()
      t.route('GET', '/v1/subscriptions', { body: { object: 'list', has_more: false, data: [] } })
      // Ruta recitirii ÎNAINTEA listei: potrivirea e pe prefix.
      t.route('GET', '/v1/checkout/sessions/cs_r', { body: { id: 'cs_r', object: 'checkout.session', status, url: 'https://checkout.stripe.com/c/cs_r' } })
      t.route('GET', '/v1/checkout/sessions', { body: { object: 'list', has_more: false, data: [] } })
      t.route('POST', '/v1/checkout/sessions', {
        // Corpul SALVAT spune `open` (starea de la creare), ca la Stripe.
        headers: { 'idempotent-replayed': 'true' },
        body: { id: 'cs_r', object: 'checkout.session', status: 'open', url: 'https://checkout.stripe.com/c/cs_r' },
      })
      const res = await run()
      assert.equal(res.statusCode, code, `${status}: ${res.body}`)
      if (code === 409) assert.equal(parseBody(res).code, 'checkout_in_progress')
      else assert.deepEqual(parseBody(res), { url: 'https://checkout.stripe.com/c/cs_r' })
      const reread = t.requests().filter((r) => r.method === 'GET' && r.path.startsWith('/v1/checkout/sessions/cs_r'))
      assert.equal(reread.length, 1, `${status}: recitirea n-a plecat`)
      assert.equal(reread[0].headers['stripe-version'], PIN)
      assert.equal(t.requests().filter((r) => r.method === 'POST').length, 1, `${status}: a doua creare`)
    }
  })
})

describe('SDK9: table-payment — anulările ajung pe contul CONECTAT', () => {
  const SESSION = '11111111-1111-1111-1111-111111111111'
  const PAYMENT = '22222222-2222-2222-2222-222222222222'
  const post = (body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
  function begin(overrides = {}) {
    state.rpcHandlers.begin_table_payment = () => ({
      data: { payment_id: PAYMENT, amount: 57.5, application_fee: 1.15, currency: 'RON',
        stripe_account_id: 'acct_1', superseded_intents: [], ...overrides },
      error: null,
    })
  }
  function assertConnectedCancel(req, id) {
    assert.equal(req.path, `/v1/payment_intents/${id}/cancel`)
    assert.equal(req.headers['stripe-account'], 'acct_1', 'anularea trebuie să ajungă pe contul conectat')
    assert.equal(req.headers['stripe-version'], PIN)
    assert.equal(form(req).stripeAccount, undefined)
  }

  it('supersede: intentul vechi se anulează pe acct_1, cel nou se creează cu cheia tp_<payment>', async () => {
    begin({ superseded_intents: ['pi_old'] })
    state.rpcHandlers.settle_table_payment = () => ({ data: null, error: null })
    state.rpcHandlers.attach_payment_intent = () => ({ data: null, error: null })
    t.route('POST', '/v1/payment_intents/pi_old/cancel', { body: { id: 'pi_old', object: 'payment_intent', status: 'canceled' } })
    t.route('POST', '/v1/payment_intents', { body: { id: 'pi_new', object: 'payment_intent', client_secret: 'pi_new_secret_x' } })
    const res = await tablePay(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 200, res.body)
    const [cancel, create] = t.requests()
    assertConnectedCancel(cancel, 'pi_old')
    assert.equal(create.path, '/v1/payment_intents')
    assert.equal(create.headers['stripe-account'], 'acct_1')
    assert.equal(create.headers['idempotency-key'], `tp_${PAYMENT}`)
    assert.equal(form(create).amount, '5750')
  })

  it('opt-out („plătesc la ospătar") → anularea pe acct_1, apoi settle canceled', async () => {
    state.rpcHandlers.cancel_table_payment = () => ({
      data: { canceled: false, stripe_payment_intent_id: 'pi_live', stripe_account_id: 'acct_1' }, error: null,
    })
    state.rpcHandlers.settle_table_payment = () => ({ data: null, error: null })
    t.route('POST', '/v1/payment_intents/pi_live/cancel', { body: { id: 'pi_live', object: 'payment_intent', status: 'canceled' } })
    const res = await tablePay(post({ action: 'cancel', payment_id: PAYMENT, token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 200, res.body)
    assertConnectedCancel(t.requests()[0], 'pi_live')
    assert.equal(rpcCallsFor('settle_table_payment')[0].args.p_outcome, 'canceled')
  })
})

describe('SDK10: stripe-webhook cu semnătură REALĂ', () => {
  const DAHLIA = '2026-08-26.dahlia'
  function signed(ev) {
    const body = JSON.stringify(ev)
    const header = new Stripe('sk_test_x', { apiVersion: PIN }).webhooks
      .generateTestHeaderString({ payload: body, secret: 'whsec_contract' })
    return { httpMethod: 'POST', headers: { 'stripe-signature': header }, body }
  }
  // Profilul urmărește abonamentul facturilor de mai jos (`sub_d`): altfel garda
  // de dublură din invoice.paid (lotul #61) citește abonamentul din Stripe, iar
  // transportul ar răspunde 599 pe o rută nescriptată.
  function okDb() {
    state.fromHandlers.stripe_events = () => ({ data: null, error: null })
    state.fromHandlers.lifecycle_events = () => ({ data: null, error: null })
    state.fromHandlers.profiles = () => ({ data: { id: 'u1', stripe_subscription_id: 'sub_d' }, error: null })
  }
  const dahliaInvoice = (lineOverrides = {}) => ({
    id: 'in_d', object: 'invoice', customer: 'cus_1', amount_paid: 49900, currency: 'ron',
    billing_reason: 'subscription_cycle', attempt_count: 1, period_start: 1_719_792_000,
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_d' } },
    lines: { object: 'list', data: [{
      amount: 49900, period: { start: 1_719_792_000, end: 1_722_470_400 },
      parent: { type: 'subscription_item_details' },
      pricing: { type: 'price_details', price_details: { price: 'price_pro' } },
      ...lineOverrides,
    }] },
  })

  it('semnătură greșită → 400, nimic scris', async () => {
    const req = signed({ id: 'evt_x', object: 'event', type: 'invoice.paid', data: { object: {} } })
    // Caracterul se INVERSEAZĂ, nu se fixează pe „0”: dacă HMAC-ul începea deja cu
    // „0” (1 din 16, după timestamp), înlocuirea era no-op → semnătură VALIDĂ → 200.
    const original = req.headers['stripe-signature']
    req.headers['stripe-signature'] = original.replace(/v1=(.)/, (_, c) => `v1=${c === '0' ? '1' : '0'}`)
    assert.notEqual(req.headers['stripe-signature'], original)
    const res = await webhook(req)
    assert.equal(res.statusCode, 400)
    assert.equal(state.fromCalls.length, 0)
  })

  it('eveniment LIVE semnat corect, dar cheia platformei e de TEST → 200 ignorat, zero efecte', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const res = await webhook(signed({ id: 'evt_lm', object: 'event', livemode: true, api_version: DAHLIA,
      type: 'invoice.paid', created: 1_700_000_000, data: { object: dahliaInvoice() } }))
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' })
    assert.equal(state.fromCalls.length, 0)
    assert.equal(state.rpcCalls.length, 0)
  })

  it('invoice.paid pe endpoint dahlia → comisionul primește planul și abonamentul', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const res = await webhook(signed({ id: 'evt_d1', object: 'event', livemode: false, api_version: DAHLIA,
      type: 'invoice.paid', created: 1_700_000_000, data: { object: dahliaInvoice() } }))
    assert.equal(res.statusCode, 200, res.body)
    const call = rpcCallsFor('process_affiliate_invoice_paid')[0]
    assert.equal(call.args.p_plan, 'pro')
    assert.equal(call.args.p_stripe_subscription_id, 'sub_d')
  })

  it('invoice.paid cu linie de formă necunoscută → 500 (Stripe retrimite), fără comision', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const res = await webhook(signed({ id: 'evt_d2', object: 'event', livemode: false, api_version: DAHLIA,
      type: 'invoice.paid', created: 1_700_000_000, data: { object: dahliaInvoice({ pricing: {} }) } }))
    assert.equal(res.statusCode, 500)
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid').length, 0)
  })

  it('charge.refunded fără `invoice` → GET /v1/charges pe pin, clawback cu factura', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    t.route('GET', '/v1/charges/ch_9', { body: { id: 'ch_9', object: 'charge', invoice: 'in_9', amount: 9900 } })
    t.route('GET', '/v1/refunds', { body: { object: 'list', has_more: false, data: [{ id: 're_1', object: 'refund', amount: 3000 }] } })
    const res = await webhook(signed({ id: 'evt_d3', object: 'event', livemode: false, api_version: DAHLIA,
      type: 'charge.refunded', created: 1_700_000_000, data: { object: { id: 'ch_9', object: 'charge', amount: 9900 } } }))
    assert.equal(res.statusCode, 200, res.body)
    const get = t.requests().find((r) => r.path.startsWith('/v1/charges/ch_9'))
    assert.equal(get.headers['stripe-version'], PIN)
    assert.equal(rpcCallsFor('process_affiliate_refund')[0].args.p_stripe_invoice_id, 'in_9')
  })
})

describe('SDK12: stripe-webhook — dublura la finalizare, pe SDK-ul real', () => {
  const COMMENT = 'menuvia:duplicate_subscription;kept=sub_kept'
  function signedEvent(ev) {
    const body = JSON.stringify(ev)
    const header = new Stripe('sk_test_x', { apiVersion: PIN }).webhooks
      .generateTestHeaderString({ payload: body, secret: 'whsec_contract' })
    return { httpMethod: 'POST', headers: { 'stripe-signature': header }, body }
  }

  it('profilul ține alt abonament viu → anulare + rambursare a dublurii, în ordine, pe pin; profilul neatins', async () => {
    state.fromHandlers.stripe_events = () => ({ data: null, error: null })
    state.fromHandlers.lifecycle_events = () => ({ data: null, error: null })
    const profiles = installTable('profiles', [
      { id: 'u1', plan: 'growth', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_kept' },
    ], { columns: ['id', 'plan', 'stripe_customer_id', 'stripe_subscription_id'] })
    const sub = (id, extra) => ({
      id, object: 'subscription', status: 'active', metadata: { plan: 'growth' },
      items: { object: 'list', data: [{ id: `si_${id}`, object: 'subscription_item', price: { id: 'price_growth', object: 'price' } }] },
      ...extra,
    })
    t.route('GET', '/v1/subscriptions/sub_dup', { body: sub('sub_dup', { latest_invoice: 'in_dup' }) })
    t.route('GET', '/v1/subscriptions/sub_kept', { body: sub('sub_kept', { latest_invoice: 'in_kept' }) })
    t.route('DELETE', '/v1/subscriptions/sub_dup', { body: sub('sub_dup', {
      status: 'canceled', latest_invoice: 'in_dup',
      cancellation_details: { comment: COMMENT, feedback: null, reason: 'cancellation_requested' },
    }) })
    t.route('GET', '/v1/invoices?', { body: { object: 'list', has_more: false, url: '/v1/invoices', data: [] } })
    t.route('GET', '/v1/invoices/in_dup', { body: {
      id: 'in_dup', object: 'invoice', status: 'paid', amount_paid: 24900, payment_intent: 'pi_dup', charge: 'ch_dup',
    } })
    t.route('GET', '/v1/refunds', { body: { object: 'list', has_more: false, data: [] } })
    t.route('POST', '/v1/refunds', { body: { id: 're_dup', object: 'refund', amount: 24900, status: 'succeeded' } })

    const saved = { error: console.error, log: console.log }
    console.error = () => {}
    console.log = () => {}
    let res
    try {
      res = await webhook(signedEvent({
        id: 'evt_dup', object: 'event', livemode: false, api_version: PIN,
        type: 'checkout.session.completed', created: 1_700_000_000,
        data: { object: {
          id: 'cs_dup', object: 'checkout.session', mode: 'subscription',
          client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_dup',
        } },
      }))
    } finally {
      Object.assign(console, saved)
    }
    assert.equal(res.statusCode, 200, res.body)

    const reqs = t.requests()
    const at = (r) => new URL(r.path, 'https://api.stripe.com')
    assert.deepEqual(reqs.map((r) => `${r.method} ${at(r).pathname}`), [
      'GET /v1/subscriptions/sub_dup',
      'GET /v1/subscriptions/sub_kept',
      'DELETE /v1/subscriptions/sub_dup',
      // Verificarea de după anulare (K2): cel păstrat e încă viu.
      'GET /v1/subscriptions/sub_kept',
      // Facturile lui deschise: încasarea oprită implicit de anulare (runda 2).
      'GET /v1/invoices',
      'GET /v1/invoices/in_dup',
      'GET /v1/refunds',
      'POST /v1/refunds',
    ])
    for (const r of reqs) assert.equal(r.headers['stripe-version'], PIN)

    const del = reqs[2]
    assert.equal(at(del).searchParams.get('cancellation_details[comment]'), COMMENT)
    assert.equal(at(del).searchParams.get('prorate'), 'false')
    assert.equal(del.headers['idempotency-key'], undefined)

    assert.equal(at(reqs[4]).searchParams.get('subscription'), 'sub_kept')
    assert.equal(at(reqs[4]).searchParams.get('status'), 'open')
    assert.equal(at(reqs[6]).searchParams.get('payment_intent'), 'pi_dup')
    const post = reqs[7]
    assert.equal(post.headers['idempotency-key'], 'dupsub_refund_in_dup')
    const b = form(post)
    assert.equal(b.payment_intent, 'pi_dup')
    assert.equal(b.reason, 'duplicate')
    assert.equal(b['metadata[menuvia_subscription]'], 'sub_dup')

    assert.deepEqual(profiles.writes, [], 'profilul NU se atinge')
    assert.equal(profiles.rows[0].stripe_subscription_id, 'sub_kept')
  })
})
