// tests/functions/stripe-connect-webhook.test.js
// Webhook-ul de CONNECT (plata online la masă). Până la garda livemode nu avea
// teste proprii; aici sunt doar contractele noi: garda `livemode` (aceeași sursă
// de cheie ca stripe-webhook — STRIPE_SECRET_KEY) + controlul pozitiv că un
// eveniment cu mod potrivit chiar ajunge la settle (altfel „zero efecte" ar fi
// adevărat și cu handler-ul stricat de tot).

'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, rpcCallsFor, parseBody } = require('./helpers/mocks')
const { stripeKeyMode } = require('../../netlify/functions/lib/livemode')

const { handler } = loadFunction('netlify/functions/stripe-connect-webhook.js')

function setEnv(key = 'sk_test_x') {
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: key,
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_c',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk',
  })
}

function succeeded(over = {}) {
  return {
    id: 'evt_c1', type: 'payment_intent.succeeded', account: 'acct_1', livemode: false,
    data: { object: { id: 'pi_1', metadata: { menuvia_payment_id: 'pay_1' } } },
    ...over,
  }
}
function deauthorized(over = {}) {
  return {
    id: 'evt_c2', type: 'account.application.deauthorized', account: 'acct_1', livemode: false,
    data: { object: {} },
    ...over,
  }
}
async function fire(ev, { omitLivemode = false } = {}) {
  if (omitLivemode) delete ev.livemode
  state.stripeImpls['webhooks.constructEvent'] = () => ev
  state.rpcHandlers.settle_table_payment = () => ({ data: { status: 'settled' }, error: null })
  state.rpcHandlers.set_restaurant_stripe_account = () => ({ data: null, error: null })
  state.fromHandlers.restaurants = () => ({ data: { id: 'r1' }, error: null })
  return handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' })
}
function withConsoleError(fn) {
  const orig = console.error
  const lines = []
  console.error = (...a) => { lines.push(a.join(' ')) }
  return Promise.resolve(fn()).finally(() => { console.error = orig }).then(() => lines)
}
function assertNoEffects() {
  assert.equal(state.fromCalls.length, 0, 'nicio operație DB')
  assert.equal(state.rpcCalls.length, 0, 'niciun RPC')
  assert.deepEqual(state.stripeCalls.map((c) => c.name), ['webhooks.constructEvent'])
}

beforeEach(() => { resetMocks(); setEnv() })

describe('stripe-connect-webhook: bază', () => {
  it('non-POST → 405; semnătură invalidă → 400', async () => {
    assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405)
    state.stripeImpls['webhooks.constructEvent'] = () => { throw new Error('bad sig') }
    const res = await handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' })
    assert.equal(res.statusCode, 400)
    assert.equal(state.fromCalls.length, 0)
  })

  it('control pozitiv: intent succeeded, mod potrivit → settle_table_payment chemat', async () => {
    const res = await fire(succeeded())
    assert.equal(res.statusCode, 200)
    const call = rpcCallsFor('settle_table_payment')[0]
    assert.equal(call.args.p_intent_id, 'pi_1')
    assert.equal(call.args.p_outcome, 'succeeded')
    assert.ok(state.fromCalls.some((c) => c.table === 'stripe_events'))
  })
})

describe('stripe-connect-webhook: gardă livemode', () => {
  it('CLM1: live/live și test/test procesează (intent + deauthorized)', async () => {
    assert.equal((await fire(succeeded({ livemode: false }))).statusCode, 200)
    assert.equal(rpcCallsFor('settle_table_payment').length, 1)

    resetMocks(); setEnv('sk_live_x')
    assert.equal((await fire(succeeded({ livemode: true }))).statusCode, 200)
    assert.equal(rpcCallsFor('settle_table_payment').length, 1)

    resetMocks(); setEnv('rk_live_x')
    const res = await fire(deauthorized({ livemode: true }))
    assert.deepEqual(parseBody(res), { received: true, deauthorized: 'acct_1' })
    assert.equal(rpcCallsFor('set_restaurant_stripe_account').length, 1)
  })

  it('CLM2: cheie TEST + eveniment LIVE → 200 ignorat, zero efecte, ALERT fără secrete', async () => {
    setEnv('sk_test_SUPERSECRET')
    let res
    const lines = await withConsoleError(async () => { res = await fire(succeeded({ livemode: true })) })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' })
    assertNoEffects()
    const alert = lines.find((l) => l.includes('ALERT livemode mismatch'))
    assert.ok(alert, lines.join('\n'))
    for (const part of ['[connect-webhook]', 'evt_c1', 'payment_intent.succeeded', 'livemode=true', 'key_mode=test']) {
      assert.ok(alert.includes(part), `${part} lipsește din: ${alert}`)
    }
    assert.ok(!alert.includes('SUPERSECRET') && !alert.includes('pi_1') && !alert.includes('acct_1'), alert)
  })

  it('CLM3: cheie LIVE + eveniment TEST → 200 ignorat, zero efecte (și pe ramura deauthorized)', async () => {
    setEnv('sk_live_x')
    for (const ev of [succeeded({ livemode: false }), deauthorized({ livemode: false })]) {
      resetMocks(); setEnv('sk_live_x')
      const res = await fire(ev)
      assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' }, ev.type)
      assertNoEffects()
    }
  })

  it('CLM4: eveniment fără livemode sau cu livemode ne-boolean → nepotrivire (fail-closed)', async () => {
    const lines = await withConsoleError(async () => {
      const res = await fire(succeeded(), { omitLivemode: true })
      assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' })
      assertNoEffects()
    })
    assert.ok(lines.some((l) => l.includes('livemode=missing')), lines.join('\n'))
    for (const bad of ['false', 0, null]) {
      resetMocks(); setEnv()
      const res = await fire(succeeded({ livemode: bad }))
      assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' }, String(bad))
      assertNoEffects()
    }
  })

  it('CLM5: cheie cu mod necunoscut → 500 livemode_unknown, zero efecte, ALERT', async () => {
    for (const key of ['pk_test_x', 'garbage', 'sk_prod_x']) {
      resetMocks(); setEnv(key)
      let res
      const lines = await withConsoleError(async () => { res = await fire(succeeded()) })
      assert.equal(res.statusCode, 500, key)
      assert.deepEqual(parseBody(res), { error: 'livemode_unknown' })
      assertNoEffects()
      const alert = lines.find((l) => l.includes('ALERT livemode mismatch'))
      assert.ok(alert && alert.includes('key_mode=unknown'), lines.join('\n'))
    }
  })

  it('CLM6: semnătura se verifică ÎNAINTEA gărzii (semnătură greșită + cheie necunoscută → 400)', async () => {
    setEnv('garbage')
    state.stripeImpls['webhooks.constructEvent'] = () => { throw new Error('bad sig') }
    const res = await handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' })
    assert.equal(res.statusCode, 400)
  })

  it('CLM7: ALERT api_version mismatch rămâne pe evenimentele procesate', async () => {
    const lines = await withConsoleError(async () => {
      const res = await fire(succeeded({ api_version: '2026-08-26.dahlia' }))
      assert.equal(res.statusCode, 200)
    })
    assert.ok(lines.some((l) => l.includes('ALERT api_version mismatch')), lines.join('\n'))
  })
})

describe('lib/livemode: stripeKeyMode', () => {
  it('LK1: prefixele cunoscute; orice altceva/lipsă → unknown', () => {
    assert.equal(stripeKeyMode('sk_live_abc'), 'live')
    assert.equal(stripeKeyMode('rk_live_abc'), 'live')
    assert.equal(stripeKeyMode('sk_test_abc'), 'test')
    assert.equal(stripeKeyMode('rk_test_abc'), 'test')
    for (const k of [undefined, null, '', 'pk_live_x', 'pk_test_x', 'whsec_x', 'sk_live', 'SK_LIVE_x', ' sk_live_x', 42, {}]) {
      assert.equal(stripeKeyMode(k), 'unknown', String(k))
    }
  })
})
