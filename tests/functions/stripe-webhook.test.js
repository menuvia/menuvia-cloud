// tests/functions/stripe-webhook.test.js
// Testele webhook-ului Stripe — singura sursă de adevăr pentru profiles.plan
// (gate-ul fiscal Plan 3!) și temelia comisioanelor de afiliere. Invarianții
// din audituri, acum înghețați în teste:
//   - fail-closed pe plan: price nemapat / metadata necunoscută → 'free',
//     NICIODATĂ un plan plătit din stringuri arbitrare;
//   - resolvePlan tranzitoriu eșuat → 500 (Stripe retrimite), NU downgrade;
//   - dedup durabil pe stripe_events: duplicat completed → 200 fără reprocesare;
//   - subscripții stale (alta decât cea curentă a profilului) → skip, nu clobber;
//   - comision/clawback eșuat → 500 + rând 'failed' (retrimitere), nu pierdere tăcută.

'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  state, resetMocks, loadFunction, rpcCallsFor, stripeCallsFor, opArg, hasOp, parseBody,
} = require('./helpers/mocks')

const { handler } = loadFunction('netlify/functions/stripe-webhook.js')

function setEnv() {
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk',
    STRIPE_STARTER_PRICE_ID: 'price_starter',
    STRIPE_GROWTH_PRICE_ID: 'price_growth',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_ENTERPRISE_PRICE_ID: 'price_ent',
  })
}

// Trimite un eveniment prin handler cu semnătura „validă" (constructEvent
// scriptat să întoarcă evenimentul — nu testăm criptografia stripe-node).
async function fire(type, object, { eventId = 'evt_1' } = {}) {
  const ev = { id: eventId, type, created: 1_700_000_000, data: { object } }
  state.stripeImpls['webhooks.constructEvent'] = () => ev
  return handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify(ev),
  })
}

// Scriptează profilul întors de lookup-ul pe stripe_customer_id.
function scriptProfile(profile, lookupErr = null) {
  state.fromHandlers.profiles = (ops) => {
    if (hasOp(ops, 'single')) return { data: profile, error: lookupErr }
    return { data: null, error: null } // update-urile reușesc implicit
  }
}

function profileUpdates() {
  return state.fromCalls
    .filter((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))
    .map((c) => opArg(c.ops, 'update'))
}
function lifecycleInserts() {
  return state.fromCalls
    .filter((c) => c.table === 'lifecycle_events')
    .map((c) => opArg(c.ops, 'insert'))
}
function finalizeStatus() {
  const updates = state.fromCalls.filter(
    (c) => c.table === 'stripe_events' && hasOp(c.ops, 'update'),
  )
  const last = updates[updates.length - 1]
  return last ? opArg(last.ops, 'update').status : null
}

beforeEach(() => { resetMocks(); setEnv() })

describe('stripe-webhook: intrare + semnătură', () => {
  it('non-POST → 405', async () => {
    assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405)
  })

  it('un price ID lipsă → 500 (fără el, PLAN_BY_PRICE ar downgrada tăcut)', async () => {
    delete process.env.STRIPE_GROWTH_PRICE_ID
    const res = await handler({ httpMethod: 'POST', headers: {}, body: '{}' })
    assert.equal(res.statusCode, 500)
  })

  it('semnătură invalidă → 400, nimic scris', async () => {
    state.stripeImpls['webhooks.constructEvent'] = () => { throw new Error('bad sig') }
    const res = await handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' })
    assert.equal(res.statusCode, 400)
    assert.equal(state.fromCalls.length, 0)
  })

  it('body base64 (SEC-001) → constructEvent primește bytes-ii DECODAȚI', async () => {
    const raw = '{"id":"evt_b64"}'
    let received
    state.stripeImpls['webhooks.constructEvent'] = (body) => {
      received = body
      return { id: 'evt_b64', type: 'noop.event', created: 1, data: { object: {} } }
    }
    await handler({
      httpMethod: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: Buffer.from(raw, 'utf8').toString('base64'),
      isBase64Encoded: true,
    })
    assert.equal(received, raw)
  })
})

describe('stripe-webhook: dedup durabil (SEC-003)', () => {
  it('duplicat pe rând completed → 200 duplicate, fără reprocesare', async () => {
    state.fromHandlers.stripe_events = (ops) => {
      if (hasOp(ops, 'insert')) return { data: null, error: { code: '23505', message: 'dup' } }
      if (hasOp(ops, 'neq')) return { data: [], error: null } // reopen n-a prins nimic
      return { data: null, error: null }
    }
    const res = await fire('customer.subscription.deleted', { customer: 'cus_1' })
    assert.equal(res.statusCode, 200)
    assert.equal(parseBody(res).duplicate, true)
    assert.equal(profileUpdates().length, 0)
  })

  it('rând failed → reprocesare permisă (reopen câștigat)', async () => {
    state.fromHandlers.stripe_events = (ops) => {
      if (hasOp(ops, 'insert')) return { data: null, error: { code: '23505', message: 'dup' } }
      if (hasOp(ops, 'neq')) return { data: [{ status: 'processing' }], error: null }
      return { data: null, error: null }
    }
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_1' })
    const res = await fire('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' })
    assert.equal(res.statusCode, 200)
    assert.equal(profileUpdates()[0].plan, 'free')
  })

  it('eroare NE-23505 la insert → 500 (Stripe retrimite, evenimentul nu se pierde)', async () => {
    state.fromHandlers.stripe_events = (ops) => {
      if (hasOp(ops, 'insert')) return { data: null, error: { code: '08000', message: 'conn' } }
      return { data: null, error: null }
    }
    const res = await fire('invoice.paid', { customer: 'cus_1', amount_paid: 0 })
    assert.equal(res.statusCode, 500)
  })
})

describe('stripe-webhook: checkout.session.completed', () => {
  it('abonament: planul vine din metadata subscription-ului, profilul se leagă de customer', async () => {
    state.stripeImpls['subscriptions.retrieve'] = async (id) => {
      assert.equal(id, 'sub_new')
      return { status: 'active', metadata: { plan: 'pro' } }
    }
    const res = await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_new',
    })
    assert.equal(res.statusCode, 200)
    const upd = profileUpdates()[0]
    assert.equal(upd.plan, 'pro')
    assert.equal(upd.stripe_customer_id, 'cus_1')
    assert.equal(upd.stripe_subscription_id, 'sub_new')
    assert.equal(lifecycleInserts()[0].event_type, 'subscription_started')
    assert.equal(finalizeStatus(), 'completed')
  })

  it('metadata.plan necunoscut → fail-closed pe free, NU un plan plătit', async () => {
    state.stripeImpls['subscriptions.retrieve'] = async () => ({ status: 'active', metadata: { plan: 'platinum-hack' } })
    await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_new',
    })
    assert.equal(profileUpdates()[0].plan, 'free')
  })

  it('abonament deja ANULAT la livrare (replay după webhook mort) → free, nu Plan 3 (audit v3 MF-07)', async () => {
    state.stripeImpls['subscriptions.retrieve'] = async () => ({
      status: 'canceled',
      metadata: { plan: 'pro' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    })
    const res = await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_dead',
    })
    assert.equal(res.statusCode, 200)
    assert.equal(profileUpdates()[0].plan, 'free')
    assert.equal(finalizeStatus(), 'completed')
  })

  it('past_due la livrare păstrează planul (grace de dunning, aceeași listă ca subscription.updated)', async () => {
    state.stripeImpls['subscriptions.retrieve'] = async () => ({
      status: 'past_due', metadata: { plan: 'growth' }, items: { data: [] },
    })
    await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_pd',
    })
    assert.equal(profileUpdates()[0].plan, 'growth')
  })

  it('planul vine din price.id-ul FACTURAT când există (metadata stale nu câștigă)', async () => {
    state.stripeImpls['subscriptions.retrieve'] = async () => ({
      status: 'active',
      metadata: { plan: 'enterprise' },
      items: { data: [{ price: { id: 'price_starter' } }] },
    })
    await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_new',
    })
    assert.equal(profileUpdates()[0].plan, 'starter')
  })

  it('resolvePlan tranzitoriu eșuat → 500 + rând failed, FĂRĂ nicio scriere de plan', async () => {
    state.stripeImpls['subscriptions.retrieve'] = async () => { throw new Error('stripe timeout') }
    const res = await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_new',
    })
    assert.equal(res.statusCode, 500)
    assert.equal(profileUpdates().length, 0)
    assert.equal(finalizeStatus(), 'failed')
  })

  it('ai_credits plătit → RPC de credite idempotent, FĂRĂ a atinge planul', async () => {
    const res = await fire('checkout.session.completed', {
      id: 'cs_ai', mode: 'payment', payment_status: 'paid',
      metadata: { type: 'ai_credits', restaurant_id: 'r1', tokens: '50000' },
    })
    assert.equal(res.statusCode, 200)
    const call = rpcCallsFor('ai_add_credits_for_event')[0]
    assert.equal(call.args.p_ref, 'cs_ai')
    assert.equal(call.args.p_tokens, 50000)
    assert.equal(profileUpdates().length, 0)
  })

  it('ai_credits NEplătit → skip complet (fără credite)', async () => {
    await fire('checkout.session.completed', {
      id: 'cs_ai', mode: 'payment', payment_status: 'unpaid',
      metadata: { type: 'ai_credits', restaurant_id: 'r1', tokens: '50000' },
    })
    assert.equal(rpcCallsFor('ai_add_credits_for_event').length, 0)
  })

  it('mode=payment ne-recunoscut → ignorat (garda pozitivă anti-downgrade)', async () => {
    const res = await fire('checkout.session.completed', {
      id: 'cs_x', mode: 'payment', payment_status: 'paid', client_reference_id: 'u1',
    })
    assert.equal(res.statusCode, 200)
    assert.equal(profileUpdates().length, 0)
    assert.equal(finalizeStatus(), 'completed')
  })
})

describe('stripe-webhook: customer.subscription.updated', () => {
  function subEvent(overrides = {}) {
    return {
      id: 'sub_1', customer: 'cus_1', status: 'active',
      items: { data: [{ price: { id: 'price_growth' } }] },
      ...overrides,
    }
  }

  it('planul se citește din price.id-ul FACTURAT (nu din metadata)', async () => {
    scriptProfile({ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_1' })
    const res = await fire('customer.subscription.updated', subEvent())
    assert.equal(res.statusCode, 200)
    assert.equal(profileUpdates()[0].plan, 'growth')
    assert.equal(lifecycleInserts()[0].event_type, 'plan_changed')
  })

  it('past_due păstrează planul plătit (grace de dunning, nu downgrade)', async () => {
    scriptProfile({ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_1' })
    await fire('customer.subscription.updated', subEvent({ status: 'past_due' }))
    assert.equal(profileUpdates()[0].plan, 'growth')
    // Plan neschimbat → fără lifecycle plan_changed.
    assert.equal(lifecycleInserts().length, 0)
  })

  it('status terminal (canceled) → free', async () => {
    scriptProfile({ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_1' })
    await fire('customer.subscription.updated', subEvent({ status: 'canceled' }))
    assert.equal(profileUpdates()[0].plan, 'free')
  })

  it('price nemapat → fail-closed free (gate-ul fiscal nu rămâne deschis)', async () => {
    scriptProfile({ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_1' })
    await fire('customer.subscription.updated',
      subEvent({ items: { data: [{ price: { id: 'price_necunoscut' } }] } }))
    assert.equal(profileUpdates()[0].plan, 'free')
  })

  it('subscripție STALE (alta decât cea curentă) → skip, fără clobber', async () => {
    scriptProfile({ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_current' })
    const res = await fire('customer.subscription.updated', subEvent({ id: 'sub_old' }))
    assert.equal(res.statusCode, 200)
    assert.equal(profileUpdates().length, 0)
  })
})

describe('stripe-webhook: customer.subscription.deleted', () => {
  it('subscripția curentă ștearsă → free + subscription null', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_1' })
    await fire('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' })
    const upd = profileUpdates()[0]
    assert.equal(upd.plan, 'free')
    assert.equal(upd.stripe_subscription_id, null)
    assert.equal(lifecycleInserts()[0].event_type, 'subscription_cancelled')
  })

  it('subscripție VECHE ștearsă → skip (nu retrograda un plătitor activ)', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_current' })
    await fire('customer.subscription.deleted', { id: 'sub_old', customer: 'cus_1' })
    assert.equal(profileUpdates().length, 0)
  })
})

describe('stripe-webhook: invoice.payment_failed (dunning)', () => {
  it('profil găsit → lifecycle payment_failed cu suma și încercarea', async () => {
    scriptProfile({ id: 'u1' })
    const res = await fire('invoice.payment_failed', {
      customer: 'cus_1', amount_due: 9900, attempt_count: 2,
    })
    assert.equal(res.statusCode, 200)
    const lc = lifecycleInserts()[0]
    assert.equal(lc.event_type, 'payment_failed')
    assert.equal(lc.event_data.attempt, 2)
  })

  it('blip de infra la lookup → 500 (Stripe retrimite; 200 ar pierde emailul de dunning)', async () => {
    scriptProfile(null, { code: '08000', message: 'conn reset' })
    const res = await fire('invoice.payment_failed', { customer: 'cus_1' })
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
  })

  it('profil inexistent (PGRST116) → ACK 200 (nu e retriabil)', async () => {
    scriptProfile(null, { code: 'PGRST116', message: 'no rows' })
    const res = await fire('invoice.payment_failed', { customer: 'cus_1' })
    assert.equal(res.statusCode, 200)
  })
})

describe('stripe-webhook: invoice.paid (comisioane afiliere)', () => {
  function invoiceEvent(overrides = {}) {
    return {
      id: 'in_1', customer: 'cus_1', amount_paid: 9900, currency: 'ron',
      billing_reason: 'subscription_cycle', subscription: 'sub_1',
      attempt_count: 1, period_start: 1_719_792_000, // 2024-07-01
      lines: { data: [] },
      ...overrides,
    }
  }

  it('recuperare din dunning: payment_recovered DOAR la attempt_count > 1', async () => {
    scriptProfile({ id: 'u1' })
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    await fire('invoice.paid', invoiceEvent({ attempt_count: 3 }))
    const kinds = lifecycleInserts().map((l) => l.event_type)
    assert.deepEqual(kinds, ['invoice_paid', 'payment_recovered'])

    resetMocks(); setEnv()
    scriptProfile({ id: 'u1' })
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    await fire('invoice.paid', invoiceEvent({ attempt_count: 1 }))
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['invoice_paid'])
  })

  it('planul comisionului = linia FACTURATĂ: price mapat + period.end maxim, nu data[0]', async () => {
    scriptProfile({ id: 'u1' })
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    await fire('invoice.paid', invoiceEvent({
      lines: { data: [
        // Linie de credit (proration) cu planul VECHI — capcana data[0].
        { price: { id: 'price_growth' }, amount: -500, period: { start: 1_717_200_000, end: 1_719_791_000 } },
        // Charge-ul real pe planul NOU, perioadă mai târzie.
        { price: { id: 'price_pro' }, amount: 9900, period: { start: 1_719_792_000, end: 1_722_470_400 } },
      ] },
    }))
    const call = rpcCallsFor('process_affiliate_invoice_paid')[0]
    assert.equal(call.args.p_plan, 'pro')
    assert.equal(call.args.p_period_month, '2024-07-01')
    assert.equal(call.args.p_currency, 'RON')
  })

  it('egalitate de period.end → preferă linia cu amount pozitiv (charge, nu credit)', async () => {
    scriptProfile({ id: 'u1' })
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    await fire('invoice.paid', invoiceEvent({
      lines: { data: [
        { price: { id: 'price_growth' }, amount: -500, period: { start: 1_719_792_000, end: 1_722_470_400 } },
        { price: { id: 'price_pro' }, amount: 9900, period: { start: 1_719_792_000, end: 1_722_470_400 } },
      ] },
    }))
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid')[0].args.p_plan, 'pro')
  })

  it('trial (amount_paid=0) → fără RPC de comision', async () => {
    scriptProfile({ id: 'u1' })
    await fire('invoice.paid', invoiceEvent({ amount_paid: 0 }))
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid').length, 0)
  })

  it('comision eșuat → 500 + rând failed (Stripe retrimite; NU pierdere tăcută)', async () => {
    scriptProfile({ id: 'u1' })
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({
      data: null, error: { message: 'rpc down' },
    })
    const res = await fire('invoice.paid', invoiceEvent())
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
  })
})

describe('stripe-webhook: clawback (refund + dispute)', () => {
  it('charge.refunded: refund-urile se iau din API (nu din payload) și se procesează toate', async () => {
    state.stripeImpls['refunds.list'] = async (params) => {
      assert.equal(params.charge, 'ch_1')
      return { data: [{ id: 're_1', amount: 3000 }, { id: 're_2', amount: 2000 }] }
    }
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    const res = await fire('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount: 9900 })
    assert.equal(res.statusCode, 200)
    const calls = rpcCallsFor('process_affiliate_refund')
    assert.equal(calls.length, 2)
    assert.deepEqual(calls.map((c) => c.args.p_refund_id), ['re_1', 're_2'])
  })

  it('clawback eșuat → 500 (banii stornați nu rămân comisionați tăcut)', async () => {
    state.stripeImpls['refunds.list'] = async () => ({ data: [{ id: 're_1', amount: 3000 }] })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: { message: 'rpc down' } })
    const res = await fire('charge.refunded', { id: 'ch_1', amount: 9900 })
    assert.equal(res.statusCode, 500)
  })

  it('dispute pierdută → clawback TOTAL cu cheie idempotentă dispute_<id>', async () => {
    state.stripeImpls['charges.retrieve'] = async () => ({ id: 'ch_1', invoice: 'in_1', amount: 9900 })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    const res = await fire('charge.dispute.closed', { id: 'dp_1', status: 'lost', charge: 'ch_1' })
    assert.equal(res.statusCode, 200)
    const call = rpcCallsFor('process_affiliate_refund')[0]
    assert.equal(call.args.p_refund_id, 'dispute_dp_1')
    assert.equal(call.args.p_refund_amount_cents, 9900)
  })

  it('dispute câștigată → no-op (comisionul rămâne)', async () => {
    const res = await fire('charge.dispute.closed', { id: 'dp_1', status: 'won', charge: 'ch_1' })
    assert.equal(res.statusCode, 200)
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 0)
    assert.equal(stripeCallsFor('charges.retrieve').length, 0)
  })

  it('charge inexistent la dispute (404) → 500 cu eroare vizibilă (intervenție manuală)', async () => {
    state.stripeImpls['charges.retrieve'] = async () => {
      const e = new Error('no such charge')
      e.code = 'resource_missing'
      throw e
    }
    const res = await fire('charge.dispute.closed', { id: 'dp_1', status: 'lost', charge: 'ch_gone' })
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
  })
})

describe('stripe-webhook: evenimente necunoscute', () => {
  it('tip nemapat → 200 completed (ACK, fără efecte)', async () => {
    const res = await fire('price.created', { id: 'price_x' })
    assert.equal(res.statusCode, 200)
    assert.equal(finalizeStatus(), 'completed')
    assert.equal(profileUpdates().length, 0)
  })
})
