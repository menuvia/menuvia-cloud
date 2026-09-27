// tests/stripe-contract/sdk.test.js
// Contractul cu SDK-ul Stripe REAL (pachetul din node_modules de la rădăcină,
// instalat de `npm ci`), fără rețea. tests/functions/ înlocuiește modulul
// 'stripe' cu un fake, deci trece identic pe v14, pe v22 și cu pin-ul șters —
// e ORB la un bump de SDK. Suita asta e poarta bump-ului (stripe 14 → 22, #270).
//
//   SDK1  cele 9 construcții `new Stripe(` folosesc pin-ul; pin-urile sunt egale;
//         clientul REAL trimite pin-ul (v22 are implicit '2026-08-26.dahlia')
//   SDK2  semnătura webhook-ului: dus-întors real + secret greșit + payload alterat
//   SDK3  payload „thin" (v2) → Error simplu, NU eroare de semnătură
//   SDK4  clichet de descoperire: fiecare apel `stripe*.x.y(` din funcții există
//         pe clientul real, iar setul e înghețat
//   SDK5  anularea pe contul conectat: `cancel(id, undefined, {stripeAccount})`
//         pleacă cu antet Stripe-Account; forma veche îl pune în CORP (defectul)
//   SDK6  codarea form a sesiunii de checkout + Idempotency-Key + Stripe-Version
//   SDK7  maparea erorilor pe câmpurile pe care le citim (code, statusCode, payment_intent)

'use strict'

const { describe, it, before, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Stripe = require('stripe')
const t = require('./helpers/transport')

const ROOT = path.join(__dirname, '..', '..')
const FN_DIR = path.join(ROOT, 'netlify', 'functions')
const PIN = '2023-10-16'
const OPTS = { apiVersion: PIN, timeout: 6000, maxNetworkRetries: 0 }

function fnSources() {
  return fs.readdirSync(FN_DIR).filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, src: fs.readFileSync(path.join(FN_DIR, f), 'utf8') }))
}

before(() => {
  // SDK-ul scrie un id de telemetrie sub XDG_CONFIG_HOME — nu în HOME-ul runner-ului.
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-contract-'))
})
beforeEach(() => t.install())
afterEach(() => t.restore())

describe('SDK1: pin-ul de versiune', () => {
  it('fiecare `new Stripe(` primește { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 }', () => {
    let ctors = 0
    const pins = new Set()
    for (const { f, src } of fnSources()) {
      const n = (src.match(/new Stripe\(/g) || []).length
      if (!n) continue
      const decl = [...src.matchAll(/const STRIPE_API_VERSION = '([^']+)'/g)]
      assert.equal(decl.length, 1, `${f}: exact o declarație STRIPE_API_VERSION`)
      pins.add(decl[0][1])
      const good = (src.match(/new Stripe\(STRIPE_SECRET_KEY, \{ apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 \}\)/g) || []).length
      assert.equal(good, n, `${f}: ${n - good} construcții fără pin/timeout/retries`)
      ctors += n
    }
    assert.equal(ctors, 9, 'podea anti-vacuitate: 9 construcții azi — o funcție nouă cu Stripe actualizează numărul')
    assert.deepEqual([...pins], [PIN])
  })

  it('clientul REAL trimite pin-ul, iar fără el ar trimite altceva (implicitul SDK-ului)', async () => {
    t.route('GET', '/v1/customers/cus_1', { body: { id: 'cus_1', object: 'customer' } })
    await new Stripe('sk_test_x', OPTS).customers.retrieve('cus_1')
    await new Stripe('sk_test_x', { timeout: 6000, maxNetworkRetries: 0 }).customers.retrieve('cus_1')
    const [pinned, unpinned] = t.requests()
    assert.equal(pinned.headers['stripe-version'], PIN)
    // Control: fără pin, versiunea e a SDK-ului — altfel testul de mai sus n-ar dovedi nimic.
    assert.notEqual(unpinned.headers['stripe-version'], PIN)
  })
})

describe('SDK2–SDK3: verificarea semnăturii webhook-ului', () => {
  const stripe = new Stripe('sk_test_x', OPTS)
  const secret = 'whsec_contract'
  const payload = JSON.stringify({
    id: 'evt_1', object: 'event', api_version: PIN, type: 'invoice.paid', data: { object: {} },
  })

  it('SDK2: semnat corect → evenimentul, SINCRON', () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const ev = stripe.webhooks.constructEvent(payload, header, secret)
    assert.equal(typeof ev.then, 'undefined', 'constructEvent trebuie să rămână sincron (handler-ele nu-l așteaptă)')
    assert.equal(ev.id, 'evt_1')
    assert.equal(ev.api_version, PIN)
  })

  it('SDK2: secret greșit / payload alterat / timestamp vechi → StripeSignatureVerificationError', () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const cases = [
      () => stripe.webhooks.constructEvent(payload, header, 'whsec_altul'),
      () => stripe.webhooks.constructEvent(payload.replace('evt_1', 'evt_2'), header, secret),
      () => stripe.webhooks.constructEvent(payload,
        stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 600 }),
        secret),
    ]
    for (const c of cases) {
      assert.throws(c, (e) => e instanceof stripe.errors.StripeSignatureVerificationError &&
        e.type === 'StripeSignatureVerificationError')
    }
  })

  it('SDK3: payload „thin" (v2.core.event) → Error simplu, fără `type` de semnătură', () => {
    const thin = JSON.stringify({ id: 'evt_t', object: 'v2.core.event', type: 'x' })
    const header = stripe.webhooks.generateTestHeaderString({ payload: thin, secret })
    assert.throws(() => stripe.webhooks.constructEvent(thin, header, secret),
      (e) => !(e instanceof stripe.errors.StripeSignatureVerificationError))
  })
})

describe('SDK4: clichet de descoperire pe apelurile din netlify/functions', () => {
  const EXPECTED = [
    'accountLinks.create', 'accounts.create', 'accounts.retrieve',
    'billingPortal.sessions.create', 'charges.retrieve', 'checkout.sessions.create',
    'customers.create', 'customers.del', 'paymentIntents.cancel', 'paymentIntents.create',
    'refunds.list', 'subscriptions.list', 'subscriptions.retrieve', 'webhooks.constructEvent',
  ]

  it('clienții se numesc stripe / stripeX (altfel descoperirea de mai jos e oarbă)', () => {
    for (const { f, src } of fnSources()) {
      for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new Stripe\(/g)) {
        assert.match(m[1], /^stripe[A-Z]?$/, `${f}: clientul Stripe se numește ${m[1]}`)
      }
    }
  })

  it('fiecare cale apelată există ca funcție pe clientul REAL, iar setul e înghețat', () => {
    const found = new Set()
    for (const { src } of fnSources()) {
      for (const m of src.matchAll(/\bstripe[A-Z]?((?:\s*\.\s*[a-zA-Z]+)+)\s*\(/g)) {
        found.add(m[1].replace(/\s/g, '').slice(1))
      }
    }
    const client = new Stripe('sk_test_x', OPTS)
    for (const p of found) {
      const fn = p.split('.').reduce((o, k) => (o == null ? o : o[k]), client)
      assert.equal(typeof fn, 'function', `stripe.${p} nu există în SDK-ul instalat`)
    }
    assert.deepEqual([...found].sort(), [...EXPECTED].sort(),
      'apel Stripe nou/dispărut — actualizează EXPECTED și acoperă-l în suita asta')
  })
})

describe('SDK5: anularea pe contul CONECTAT (plata la masă)', () => {
  it('cancel(id, undefined, { stripeAccount }) → antet Stripe-Account, corp gol', async () => {
    t.route('POST', '/v1/payment_intents/pi_x/cancel', { body: { id: 'pi_x', object: 'payment_intent', status: 'canceled' } })
    const stripe = new Stripe('sk_test_x', OPTS)
    const pi = await stripe.paymentIntents.cancel('pi_x', undefined, { stripeAccount: 'acct_1' })
    assert.equal(pi.status, 'canceled')
    const req = t.requests()[0]
    assert.equal(req.headers['stripe-account'], 'acct_1')
    assert.equal(req.headers['stripe-version'], PIN)
    assert.equal(form(req).stripeAccount, undefined)
  })

  it('control: forma VECHE cancel(id, { stripeAccount }) NU mai ajunge pe contul conectat', async () => {
    t.route('POST', '/v1/payment_intents/pi_x/cancel', { body: { id: 'pi_x', object: 'payment_intent', status: 'canceled' } })
    const stripe = new Stripe('sk_test_x', OPTS)
    await stripe.paymentIntents.cancel('pi_x', { stripeAccount: 'acct_1' })
    const req = t.requests()[0]
    // Pe v22 cheia pleacă în CORP, iar cererea merge pe contul platformei.
    // Dacă asta devine fals (SDK-ul revine la amestec), testul cere reverificare.
    assert.equal(req.headers['stripe-account'], undefined)
    assert.equal(form(req).stripeAccount, 'acct_1')
  })

  it('create(params, { stripeAccount, idempotencyKey }) → ambele antete', async () => {
    t.route('POST', '/v1/payment_intents', { body: { id: 'pi_n', object: 'payment_intent', client_secret: 'pi_n_secret' } })
    const stripe = new Stripe('sk_test_x', OPTS)
    await stripe.paymentIntents.create(
      { amount: 5750, currency: 'ron', automatic_payment_methods: { enabled: true }, metadata: { menuvia_payment_id: 'p1' } },
      { stripeAccount: 'acct_1', idempotencyKey: 'tp_p1' },
    )
    const req = t.requests()[0]
    assert.equal(req.headers['stripe-account'], 'acct_1')
    assert.equal(req.headers['idempotency-key'], 'tp_p1')
    const b = form(req)
    assert.equal(b['automatic_payment_methods[enabled]'], 'true')
    assert.equal(b['metadata[menuvia_payment_id]'], 'p1')
  })
})

describe('SDK6: sesiunea de checkout, pe fir', () => {
  it('parametri imbricați codați ca până acum; cheia noastră de idempotență câștigă', async () => {
    t.route('POST', '/v1/checkout/sessions', { body: { id: 'cs_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_1' } })
    const stripe = new Stripe('sk_test_x', OPTS)
    const s = await stripe.checkout.sessions.create({
      customer: 'cus_1', mode: 'subscription',
      payment_method_collection: 'if_required',
      line_items: [{ price: 'price_growth', quantity: 1 }],
      subscription_data: {
        metadata: { plan: 'growth' },
        trial_period_days: 30,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      },
    }, { idempotencyKey: 'checkout_v2_k' })
    assert.equal(s.url, 'https://checkout.stripe.com/c/cs_1')
    const req = t.requests()[0]
    assert.equal(req.headers['idempotency-key'], 'checkout_v2_k')
    assert.equal(req.headers['stripe-version'], PIN)
    const b = form(req)
    assert.equal(b['payment_method_collection'], 'if_required')
    assert.equal(b['line_items[0][price]'], 'price_growth')
    assert.equal(b['line_items[0][quantity]'], '1')
    assert.equal(b['subscription_data[trial_period_days]'], '30')
    assert.equal(b['subscription_data[trial_settings][end_behavior][missing_payment_method]'], 'cancel')
    assert.equal(b['subscription_data[metadata][plan]'], 'growth')
  })

  it('list(...).autoPagingToArray urmează paginile (starting_after = ultimul id)', async () => {
    let n = 0
    t.route('GET', '/v1/subscriptions', () => (++n === 1
      ? { body: { object: 'list', has_more: true, data: [{ id: 'sub_1' }, { id: 'sub_2' }] } }
      : { body: { object: 'list', has_more: false, data: [{ id: 'sub_3' }] } }))
    const stripe = new Stripe('sk_test_x', OPTS)
    const all = await stripe.subscriptions.list({ customer: 'cus_1', status: 'all', limit: 100 })
      .autoPagingToArray({ limit: 10000 })
    assert.deepEqual(all.map((x) => x.id), ['sub_1', 'sub_2', 'sub_3'])
    const [p1, p2] = t.requests()
    assert.match(p2.path, /starting_after=sub_2/)
    assert.equal(p1.headers['idempotency-key'], undefined, 'GET nu poartă cheie de idempotență')
  })
})

describe('SDK7: erorile păstrează câmpurile citite de handler-e', () => {
  it('400 la cancel cu payment_intent în eroare → e.code / e.statusCode / e.payment_intent.status', async () => {
    t.route('POST', '/v1/payment_intents/pi_x/cancel', {
      status: 400,
      body: { error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state',
        message: 'This PaymentIntent has a status of succeeded', payment_intent: { id: 'pi_x', status: 'succeeded' } } },
    })
    const stripe = new Stripe('sk_test_x', OPTS)
    await assert.rejects(stripe.paymentIntents.cancel('pi_x', undefined, { stripeAccount: 'acct_1' }), (e) => {
      assert.equal(e.code, 'payment_intent_unexpected_state')
      assert.equal(e.statusCode, 400)
      assert.equal(e.payment_intent.status, 'succeeded')
      assert.match(e.message, /succeeded/)
      return true
    })
  })

  it('404 la charges.retrieve → e.code resource_missing, e.statusCode 404', async () => {
    t.route('GET', '/v1/charges/ch_gone', {
      status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such charge' } },
    })
    const stripe = new Stripe('sk_test_x', OPTS)
    await assert.rejects(stripe.charges.retrieve('ch_gone'), (e) => e.code === 'resource_missing' && e.statusCode === 404)
  })
})

function form(rec) { return t.form(rec) }
