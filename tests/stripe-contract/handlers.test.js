// tests/stripe-contract/handlers.test.js
// Handler-ele REALE pe SDK-ul REAL, cu supabase fals (harness-ul din
// tests/functions în modul `stripe: 'real'`) și transportul HTTP fals. Dovedește
// cap-coadă ce testele cu fake nu pot: ce pleacă efectiv pe fir din funcțiile
// noastre după bump-ul de SDK.
//
//   SDK8   stripe-checkout: 200 cu url; ambele cereri pe pin; cheia checkout_*
//   SDK9   table-payment: supersede și opt-out — fiecare anulare pleacă cu antet
//          Stripe-Account (defectul v22), create-ul cu cheia tp_. Celelalte două
//          anulări (split-uri stale, attach eșuat) sunt ținute de fake-ul din
//          tests/functions, care aruncă pe forma veche (mutații dovedite).
//   SDK10  stripe-webhook cu semnătură REALĂ: payload dahlia → comision cu plan și
//          abonament; charge fără `invoice` → re-citire; formă necunoscută → 500

'use strict'

const { describe, it, before, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const t = require('./helpers/transport')
const {
  state, resetMocks, loadFunction, rpcCallsFor, parseBody,
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

describe('SDK8: stripe-checkout pe SDK-ul real', () => {
  it('200 cu url; lista de abonamente și sesiunea pleacă pe pin, cu cheia checkout_*', async () => {
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers.check_rate_limit = () => ({ data: true, error: null })
    state.fromHandlers.profiles = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
    t.route('GET', '/v1/subscriptions', { body: { object: 'list', has_more: false, data: [] } })
    t.route('POST', '/v1/checkout/sessions', { body: { id: 'cs_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_1' } })
    const res = await checkout({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ plan: 'growth' }) })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(parseBody(res).url, 'https://checkout.stripe.com/c/cs_1')
    const reqs = t.requests()
    assert.equal(reqs.length, 2)
    for (const r of reqs) assert.equal(r.headers['stripe-version'], PIN)
    const sess = reqs.find((r) => r.path === '/v1/checkout/sessions')
    assert.match(sess.headers['idempotency-key'], /^checkout_/)
    const b = form(sess)
    assert.equal(b.customer, 'cus_1')
    assert.equal(b.mode, 'subscription')
    assert.equal(b['line_items[0][price]'], 'price_growth')
    assert.equal(b['subscription_data[metadata][plan]'], 'growth')
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
  function okDb() {
    state.fromHandlers.stripe_events = () => ({ data: null, error: null })
    state.fromHandlers.lifecycle_events = () => ({ data: null, error: null })
    state.fromHandlers.profiles = () => ({ data: { id: 'u1' }, error: null })
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
    req.headers['stripe-signature'] = req.headers['stripe-signature'].replace(/v1=./, 'v1=0')
    const res = await webhook(req)
    assert.equal(res.statusCode, 400)
    assert.equal(state.fromCalls.length, 0)
  })

  it('invoice.paid pe endpoint dahlia → comisionul primește planul și abonamentul', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const res = await webhook(signed({ id: 'evt_d1', object: 'event', api_version: DAHLIA,
      type: 'invoice.paid', created: 1_700_000_000, data: { object: dahliaInvoice() } }))
    assert.equal(res.statusCode, 200, res.body)
    const call = rpcCallsFor('process_affiliate_invoice_paid')[0]
    assert.equal(call.args.p_plan, 'pro')
    assert.equal(call.args.p_stripe_subscription_id, 'sub_d')
  })

  it('invoice.paid cu linie de formă necunoscută → 500 (Stripe retrimite), fără comision', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const res = await webhook(signed({ id: 'evt_d2', object: 'event', api_version: DAHLIA,
      type: 'invoice.paid', created: 1_700_000_000, data: { object: dahliaInvoice({ pricing: {} }) } }))
    assert.equal(res.statusCode, 500)
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid').length, 0)
  })

  it('charge.refunded fără `invoice` → GET /v1/charges pe pin, clawback cu factura', async () => {
    okDb()
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    t.route('GET', '/v1/charges/ch_9', { body: { id: 'ch_9', object: 'charge', invoice: 'in_9', amount: 9900 } })
    t.route('GET', '/v1/refunds', { body: { object: 'list', has_more: false, data: [{ id: 're_1', object: 'refund', amount: 3000 }] } })
    const res = await webhook(signed({ id: 'evt_d3', object: 'event', api_version: DAHLIA,
      type: 'charge.refunded', created: 1_700_000_000, data: { object: { id: 'ch_9', object: 'charge', amount: 9900 } } }))
    assert.equal(res.statusCode, 200, res.body)
    const get = t.requests().find((r) => r.path.startsWith('/v1/charges/ch_9'))
    assert.equal(get.headers['stripe-version'], PIN)
    assert.equal(rpcCallsFor('process_affiliate_refund')[0].args.p_stripe_invoice_id, 'in_9')
  })
})
