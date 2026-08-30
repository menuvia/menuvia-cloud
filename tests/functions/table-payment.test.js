// tests/functions/table-payment.test.js
// Testele funcției de BANI table-payment (plata online la masă + split mig 229).
// Invarianții acoperiți sunt cei din review-urile TP1–TP20 (partea de funcție):
//   - fail-closed pe rate limit (503, nu bypass);
//   - supersede: se continuă DOAR cu intent-ul vechi dovedit mort, altfel 409
//     (fereastra `processing` = risc de dublă încasare);
//   - eșec la create/attach → rândul nou se eliberează (cancel best-effort);
//   - idempotencyKey stabil `tp_<payment_id>` (retry de rețea nu dublează intentul);
//   - nota (bill) nu scurge câmpurile interne spre client.

'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  state, resetMocks, loadFunction, rpcCallsFor, stripeCallsFor, parseBody,
} = require('./helpers/mocks')

const { handler } = loadFunction('netlify/functions/table-payment.js')

const SESSION = '11111111-1111-1111-1111-111111111111'
const PAYMENT = '22222222-2222-2222-2222-222222222222'
const ITEM = '33333333-3333-3333-3333-333333333333'
const INTENT_OLD = 'pi_old_123'

function setEnv() {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x'
}

function post(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body), headers: {} }
}

// begin_table_payment reușit, formă minimă (mig 211).
function scriptBegin(overrides = {}) {
  state.rpcHandlers.begin_table_payment = () => ({
    data: {
      payment_id: PAYMENT,
      amount: 57.5,
      application_fee: 1.15,
      currency: 'RON',
      stripe_account_id: 'acct_1',
      superseded_intents: [],
      ...overrides,
    },
    error: null,
  })
}

describe('table-payment: validări de intrare', () => {
  beforeEach(() => { resetMocks(); setEnv() })

  it('non-POST → 405', async () => {
    const res = await handler({ httpMethod: 'GET' })
    assert.equal(res.statusCode, 405)
  })

  it('env lipsă → 500 fără niciun apel spre Supabase/Stripe', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 500)
    assert.equal(state.rpcCalls.length, 0)
  })

  it('JSON invalid → 400', async () => {
    const res = await handler({ httpMethod: 'POST', body: '{nope', headers: {} })
    assert.equal(res.statusCode, 400)
  })

  it('token/session_id lipsă sau acțiune necunoscută → 400', async () => {
    assert.equal((await handler(post({ session_id: SESSION }))).statusCode, 400)
    assert.equal((await handler(post({ token: 't', session_id: 'nu-e-uuid' }))).statusCode, 400)
    assert.equal((await handler(post({ token: 't', session_id: SESSION, action: 'hack' }))).statusCode, 400)
  })

  it('cancel fără payment_id valid → 400', async () => {
    const res = await handler(post({ token: 't', session_id: SESSION, action: 'cancel' }))
    assert.equal(res.statusCode, 400)
  })

  it('split: itemi malformați sau peste 60 → 400 invalid_items, fără RPC', async () => {
    const bad = await handler(post({
      token: 't', session_id: SESSION, items: [{ order_item_id: ITEM, quantity: 0 }],
    }))
    assert.equal(bad.statusCode, 400)
    assert.equal(parseBody(bad).hint, 'invalid_items')

    const many = await handler(post({
      token: 't', session_id: SESSION,
      items: Array.from({ length: 61 }, () => ({ order_item_id: ITEM, quantity: 1 })),
    }))
    assert.equal(many.statusCode, 400)
    assert.equal(state.rpcCalls.length, 0)
  })
})

describe('table-payment: rate limit fail-closed', () => {
  beforeEach(() => { resetMocks(); setEnv() })

  it('peste plafon → 429', async () => {
    state.rpcHandlers.check_rate_limit = () => ({ data: false, error: null })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 429)
  })

  it('eroare RPC de rate limit → 503 (fail-closed, NU bypass)', async () => {
    state.rpcHandlers.check_rate_limit = () => ({ data: null, error: { message: 'boom' } })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 503)
    assert.equal(rpcCallsFor('begin_table_payment').length, 0)
  })

  it('throw în verificare → 503 (fail-closed)', async () => {
    state.rpcHandlers.check_rate_limit = () => { throw new Error('rețea') }
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 503)
  })

  it('split folosește bucket separat (table_payment_split)', async () => {
    state.rpcHandlers.check_rate_limit = () => ({ data: false, error: null })
    await handler(post({
      token: 't', session_id: SESSION, items: [{ order_item_id: ITEM, quantity: 2 }],
    }))
    assert.equal(rpcCallsFor('check_rate_limit')[0].args.p_function_name, 'table_payment_split')
  })
})

describe('table-payment: create (nota întreagă)', () => {
  beforeEach(() => { resetMocks(); setEnv() })

  it('hint de business din begin → status mapat (feature_disabled → 403)', async () => {
    state.rpcHandlers.begin_table_payment = () => ({
      data: null, error: { message: 'Featurea online_payments…', hint: 'feature_disabled' },
    })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 403)
    assert.equal(parseBody(res).hint, 'feature_disabled')
  })

  it('sumă invalidă din RPC → 500 și NICIUN apel Stripe', async () => {
    scriptBegin({ amount: 0 })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 500)
    assert.equal(state.stripeCalls.length, 0)
  })

  it('happy path: 200 cu client_secret; intent în bani, RON lowercase, idempotencyKey tp_<payment_id>', async () => {
    scriptBegin()
    state.rpcHandlers.attach_payment_intent = () => ({ data: null, error: null })
    state.stripeImpls['paymentIntents.create'] = async (params, opts) => {
      assert.equal(params.amount, 5750)
      assert.equal(params.currency, 'ron')
      assert.equal(params.application_fee_amount, 115)
      assert.equal(opts.idempotencyKey, `tp_${PAYMENT}`)
      assert.equal(opts.stripeAccount, 'acct_1')
      return { id: 'pi_new_1', client_secret: 'cs_1' }
    }
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 200)
    const body = parseBody(res)
    assert.equal(body.client_secret, 'cs_1')
    assert.equal(body.payment_id, PAYMENT)
    assert.equal(rpcCallsFor('attach_payment_intent')[0].args.p_intent_id, 'pi_new_1')
  })

  it('fee zero → intent FĂRĂ application_fee_amount', async () => {
    scriptBegin({ application_fee: 0 })
    state.rpcHandlers.attach_payment_intent = () => ({ data: null, error: null })
    state.stripeImpls['paymentIntents.create'] = async (params) => {
      assert.equal('application_fee_amount' in params, false)
      return { id: 'pi_new_2', client_secret: 'cs_2' }
    }
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 200)
  })

  it('Stripe create eșuează → 502 și rândul nou se eliberează (cancel_table_payment)', async () => {
    scriptBegin()
    state.stripeImpls['paymentIntents.create'] = async () => { throw new Error('stripe down') }
    state.rpcHandlers.cancel_table_payment = () => ({ data: { canceled: true }, error: null })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 502)
    assert.equal(rpcCallsFor('cancel_table_payment')[0].args.p_payment_id, PAYMENT)
  })

  it('attach eșuează → 500, intentul se anulează la Stripe și rândul se eliberează', async () => {
    scriptBegin()
    state.stripeImpls['paymentIntents.create'] = async () => ({ id: 'pi_new_3', client_secret: 'cs_3' })
    state.stripeImpls['paymentIntents.cancel'] = async () => ({ id: 'pi_new_3', status: 'canceled' })
    state.rpcHandlers.attach_payment_intent = () => ({ data: null, error: { message: 'blip' } })
    state.rpcHandlers.cancel_table_payment = () => ({ data: { canceled: true }, error: null })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 500)
    assert.equal(stripeCallsFor('paymentIntents.cancel')[0].args[0], 'pi_new_3')
    assert.equal(rpcCallsFor('cancel_table_payment').length, 1)
  })
})

describe('table-payment: supersede (un singur intent live per sesiune, mig 211)', () => {
  beforeEach(() => { resetMocks(); setEnv() })

  it('intent vechi anulat cu succes → settle + continuă cu intent nou', async () => {
    scriptBegin({ superseded_intents: [INTENT_OLD] })
    state.rpcHandlers.settle_table_payment = () => ({ data: null, error: null })
    state.rpcHandlers.attach_payment_intent = () => ({ data: null, error: null })
    state.stripeImpls['paymentIntents.cancel'] = async () => ({ id: INTENT_OLD, status: 'canceled' })
    state.stripeImpls['paymentIntents.create'] = async () => ({ id: 'pi_new_4', client_secret: 'cs_4' })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 200)
    const settle = rpcCallsFor('settle_table_payment')[0]
    assert.equal(settle.args.p_intent_id, INTENT_OLD)
    assert.equal(settle.args.p_outcome, 'canceled')
  })

  it('intent vechi deja anulat la Stripe (eroare cu status canceled) → tot mort, continuă', async () => {
    scriptBegin({ superseded_intents: [INTENT_OLD] })
    state.rpcHandlers.attach_payment_intent = () => ({ data: null, error: null })
    state.stripeImpls['paymentIntents.cancel'] = async () => {
      const e = new Error('already canceled')
      e.payment_intent = { status: 'canceled' }
      throw e
    }
    state.stripeImpls['paymentIntents.create'] = async () => ({ id: 'pi_new_5', client_secret: 'cs_5' })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 200)
  })

  it('intent vechi NE-dovedit mort (processing / eroare rețea) → 409 nothing_to_pay, fără intent nou', async () => {
    scriptBegin({ superseded_intents: [INTENT_OLD] })
    state.stripeImpls['paymentIntents.cancel'] = async () => {
      const e = new Error('cannot cancel')
      e.payment_intent = { status: 'processing' }
      throw e
    }
    state.rpcHandlers.cancel_table_payment = () => ({ data: { canceled: true }, error: null })
    const res = await handler(post({ token: 't', session_id: SESSION }))
    assert.equal(res.statusCode, 409)
    assert.equal(parseBody(res).hint, 'nothing_to_pay')
    // Rândul NOU s-a eliberat, iar intentul nou NU s-a creat (anti dublă încasare).
    assert.equal(rpcCallsFor('cancel_table_payment').length, 1)
    assert.equal(stripeCallsFor('paymentIntents.create').length, 0)
  })
})

describe('table-payment: cancel (opt-out client)', () => {
  beforeEach(() => { resetMocks(); setEnv() })

  const cancelBody = { token: 't', session_id: SESSION, action: 'cancel', payment_id: PAYMENT }

  it('plată deja încasată (cancelable=false, succeeded) → 409', async () => {
    state.rpcHandlers.cancel_table_payment = () => ({
      data: { cancelable: false, status: 'succeeded' }, error: null,
    })
    const res = await handler(post(cancelBody))
    assert.equal(res.statusCode, 409)
    assert.equal(parseBody(res).status, 'succeeded')
  })

  it('Stripe refuză cancel-ul cu dovadă de plată (succeeded) → 409, nu 200', async () => {
    state.rpcHandlers.cancel_table_payment = () => ({
      data: { cancelable: true, stripe_payment_intent_id: 'pi_x', stripe_account_id: 'acct_1' },
      error: null,
    })
    state.stripeImpls['paymentIntents.cancel'] = async () => {
      const e = new Error('unexpected state')
      e.payment_intent = { status: 'succeeded' }
      throw e
    }
    const res = await handler(post(cancelBody))
    assert.equal(res.statusCode, 409)
    assert.equal(parseBody(res).status, 'succeeded')
  })

  it('eroare de rețea la cancel-ul Stripe → 502 (NU raportăm anulat neconfirmat)', async () => {
    state.rpcHandlers.cancel_table_payment = () => ({
      data: { cancelable: true, stripe_payment_intent_id: 'pi_x', stripe_account_id: 'acct_1' },
      error: null,
    })
    state.stripeImpls['paymentIntents.cancel'] = async () => { throw new Error('ECONNRESET') }
    const res = await handler(post(cancelBody))
    assert.equal(res.statusCode, 502)
    assert.equal(rpcCallsFor('settle_table_payment').length, 0)
  })

  it('cancel reușit → settle canceled + 200', async () => {
    state.rpcHandlers.cancel_table_payment = () => ({
      data: { cancelable: true, stripe_payment_intent_id: 'pi_x', stripe_account_id: 'acct_1' },
      error: null,
    })
    state.stripeImpls['paymentIntents.cancel'] = async () => ({ id: 'pi_x', status: 'canceled' })
    state.rpcHandlers.settle_table_payment = () => ({ data: null, error: null })
    const res = await handler(post(cancelBody))
    assert.equal(res.statusCode, 200)
    assert.equal(parseBody(res).status, 'canceled')
    assert.equal(rpcCallsFor('settle_table_payment')[0].args.p_outcome, 'canceled')
  })
})

describe('table-payment: bill (nota mesei, split mig 229)', () => {
  beforeEach(() => { resetMocks(); setEnv() })

  it('câmpurile interne NU pleacă spre client', async () => {
    state.rpcHandlers.get_table_bill = () => ({
      data: {
        orders: [], stale_split_intents: [], stripe_account_id: 'acct_1', total: 10,
      },
      error: null,
    })
    const res = await handler(post({ token: 't', session_id: SESSION, action: 'bill' }))
    assert.equal(res.statusCode, 200)
    const body = parseBody(res)
    assert.equal('stale_split_intents' in body, false)
    assert.equal('stripe_account_id' in body, false)
    assert.equal(body.total, 10)
  })

  it('claims stale eliberate → nota se re-citește (cantitățile s-au schimbat)', async () => {
    let calls = 0
    state.rpcHandlers.get_table_bill = () => {
      calls++
      return {
        data: calls === 1
          ? { total: 10, stale_split_intents: ['pi_stale'], stripe_account_id: 'acct_1' }
          : { total: 10, stale_split_intents: [], stripe_account_id: 'acct_1', refreshed: true },
        error: null,
      }
    }
    state.stripeImpls['paymentIntents.cancel'] = async () => ({ id: 'pi_stale', status: 'canceled' })
    state.rpcHandlers.settle_table_payment = () => ({ data: null, error: null })
    const res = await handler(post({ token: 't', session_id: SESSION, action: 'bill' }))
    assert.equal(res.statusCode, 200)
    assert.equal(calls, 2)
    assert.equal(parseBody(res).refreshed, true)
  })

  it('cancel-ul stale eșuat NU blochează nota (itemul rămâne în plată)', async () => {
    state.rpcHandlers.get_table_bill = () => ({
      data: { total: 10, stale_split_intents: ['pi_stale'], stripe_account_id: 'acct_1' },
      error: null,
    })
    state.stripeImpls['paymentIntents.cancel'] = async () => {
      const e = new Error('processing')
      e.payment_intent = { status: 'processing' }
      throw e
    }
    const res = await handler(post({ token: 't', session_id: SESSION, action: 'bill' }))
    assert.equal(res.statusCode, 200)
    // Fără settle (intentul nu e dovedit mort) și fără re-fetch (freed=0).
    assert.equal(rpcCallsFor('settle_table_payment').length, 0)
    assert.equal(rpcCallsFor('get_table_bill').length, 1)
  })
})
