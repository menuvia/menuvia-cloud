// tests/functions/stripe-portal.test.js
// Contractul `no_customer` al portalului de facturare (lotul O7c, nov 2026).
//
// De ce există: funcția n-avea NICIUN test, iar cardul „Abonament & facturare"
// (src/components/_dashboard/SubscriptionCard.tsx) depinde acum de forma exactă
// a răspunsului: 404 + `code: 'no_customer'` → „Vezi planurile" (/pricing). Un
// cod redenumit sau un status schimbat ar readuce TĂCUT fundătura (cardul ar
// arăta mesajul generic de eroare și butonul inutil).
//
//   SPT1  profil cu `stripe_customer_id` NULL → 404, `code: 'no_customer'`,
//         mesaj românesc, ZERO apeluri la billingPortal.sessions.create.
//         Mutația care pică: codul redenumit sau statusul schimbat.
//   SPT2  CONTROL POZITIV pentru SPT1: cu `cus_1` → 200 cu URL-ul sesiunii, iar
//         sesiunea e creată pe `cus_1`. Mutația care pică: o funcție care
//         răspunde mereu `no_customer` (SPT1 singur ar trece).
//   SPT3  eroare la citirea profilului → 503 „temporar indisponibil", NU
//         `no_customer`: un blip de rețea nu are voie să arate ca „n-ai
//         abonament" (și să-l trimită pe un abonat activ la /pricing).
//         Mutația care pică: verificarea `profileErr` scoasă (codul cade pe
//         404 no_customer).
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, parseBody, stripeCallsFor } = require('./helpers/mocks')

const REL = 'netlify/functions/stripe-portal.js'
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'VITE_APP_URL']

let saved

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    STRIPE_SECRET_KEY: 'sk_test_x',
  })
  state.authUser = { id: 'owner-1', email: 'ana@x.test' }
  state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function openPortal() {
  const { handler } = loadFunction(REL)
  const savedErr = console.error
  console.error = () => {}
  try {
    return await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt' }, body: '{}' })
  } finally {
    console.error = savedErr
  }
}

// Lookup-ul de profil s-a făcut pe userul AUTENTIFICAT (nu pe altcineva).
function profileLookupFor(userId) {
  const call = state.fromCalls.find((c) => c.table === 'profiles')
  assert.ok(call, 'profilul nu a fost citit')
  assert.ok(
    call.ops.some((o) => o.m === 'eq' && o.args[0] === 'id' && o.args[1] === userId),
    'profilul citit nu e al apelantului',
  )
}

describe('stripe-portal: contractul no_customer', () => {
  it('SPT1: fără client Stripe → 404 no_customer, fără sesiune de portal', async () => {
    state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: null }, error: null })
    const res = await openPortal()
    assert.equal(res.statusCode, 404, res.body)
    const body = parseBody(res)
    assert.equal(body.code, 'no_customer')
    assert.match(body.error, /Nu ai încă un abonament/)
    profileLookupFor('owner-1')
    assert.equal(stripeCallsFor('billingPortal.sessions.create').length, 0)
  })

  it('SPT2: control — cu client Stripe → 200 cu URL-ul sesiunii, pe acel client', async () => {
    state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: 'cus_1' }, error: null })
    state.stripeImpls['billingPortal.sessions.create'] = async () => ({
      url: 'https://billing.stripe.com/p/session_1',
    })
    const res = await openPortal()
    assert.equal(res.statusCode, 200, res.body)
    const body = parseBody(res)
    assert.equal(body.url, 'https://billing.stripe.com/p/session_1')
    assert.equal(body.code, undefined)
    profileLookupFor('owner-1')
    const calls = stripeCallsFor('billingPortal.sessions.create')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].args[0].customer, 'cus_1')
  })

  it('SPT3: profilul n-a putut fi citit → 503, NU no_customer', async () => {
    state.fromHandlers['profiles'] = () => ({ data: null, error: { message: 'timeout' } })
    const res = await openPortal()
    assert.equal(res.statusCode, 503, res.body)
    const body = parseBody(res)
    assert.notEqual(body.code, 'no_customer')
    assert.match(body.error, /temporar indisponibil/)
    assert.equal(stripeCallsFor('billingPortal.sessions.create').length, 0)
  })
})
