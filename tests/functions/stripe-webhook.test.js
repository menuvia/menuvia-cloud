// tests/functions/stripe-webhook.test.js
// Testele webhook-ului Stripe — singura sursă de adevăr pentru profiles.plan
// (gate-ul fiscal Plan 3!) și temelia comisioanelor de afiliere. Invarianții
// din audituri, acum înghețați în teste:
//   - fail-closed pe plan: price nemapat / metadata necunoscută → 'free',
//     NICIODATĂ un plan plătit din stringuri arbitrare;
//   - resolvePlan tranzitoriu eșuat → 500 (Stripe retrimite), NU downgrade;
//   - dedup durabil pe stripe_events: duplicat completed → 200 fără reprocesare;
//   - subscripții stale (alta decât cea curentă a profilului) → skip, nu clobber;
//   - comision/clawback eșuat → 500 + rând 'failed' (retrimitere), nu pierdere tăcută;
//   - abonament UNIC la finalizare: un UPDATE condiționat decide cine ține
//     profilul; o dublură vie e anulată + rambursată, fără a atinge profilul (DUP*).

'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  state, resetMocks, loadFunction, rpcCallsFor, stripeCallsFor, opArg, hasOp, parseBody, installTable,
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
// `livemode: false` = coerent cu cheia de test din setEnv() (sk_test_x) — garda
// livemode (lib/livemode.js) respinge tăcut orice eveniment din alt mod.
// constructEvent PARSEAZĂ corpul (nu întoarce un `ev` capturat): două handler-e
// pornite în paralel (testele de concurență DUP*) primesc fiecare evenimentul lui.
async function fire(type, object, { eventId = 'evt_1', apiVersion, livemode = false } = {}) {
  const ev = { id: eventId, type, created: 1_700_000_000, livemode, data: { object } }
  if (apiVersion) ev.api_version = apiVersion
  state.stripeImpls['webhooks.constructEvent'] = (body) => JSON.parse(body)
  return handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify(ev),
  })
}

// Tabela `profiles` cu STARE (installTable): filtrele `eq`/`is`/`or` se evaluează,
// iar `update(...).select()` întoarce doar rândurile atinse. Un handler scriptat
// care răspunde „succes” la orice UPDATE ar face vacue testele pe scrierile
// condiționate (abonament unic la finalizare, updated/deleted).
let profiles = null
function useProfiles(rows, opts = {}) {
  profiles = installTable('profiles', rows, {
    defaults: { plan: 'free', stripe_customer_id: 'cus_1', stripe_subscription_id: null },
    ...opts,
  })
  return profiles
}
// Un profil (implicit pe customer-ul cus_1) sau niciunul; `lookupErr` = orice
// citire `.single()` întoarce eroarea (blip de infra / PGRST116).
function scriptProfile(profile, lookupErr = null) {
  return useProfiles(profile ? [profile] : [], { readError: lookupErr })
}

// Scrierile EFECTIVE pe profil (cel puțin un rând atins), nu încercările: un
// UPDATE condiționat care găsește 0 rânduri nu e o scriere.
function profileUpdates() {
  return profiles ? profiles.writes.map((w) => w.payload) : []
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

beforeEach(() => { resetMocks(); setEnv(); profiles = null })

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
      return { id: 'evt_b64', type: 'noop.event', created: 1, livemode: false, data: { object: {} } }
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
  // Contul care finalizează: profil fără abonament (testele care au nevoie de
  // altă stare își instalează propriul profil).
  beforeEach(() => { useProfiles([{ id: 'u1', stripe_customer_id: null }]) })

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

  it('replay pentru un abonament VECHI terminal NU suprascrie un abonament curent mai nou (anti-clobber)', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_B_nou' })
    state.stripeImpls['subscriptions.retrieve'] = async () => ({
      status: 'canceled', metadata: { plan: 'pro' }, items: { data: [{ price: { id: 'price_pro' } }] },
    })
    const res = await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_A_vechi',
    })
    assert.equal(res.statusCode, 200)
    assert.equal(profileUpdates().length, 0, 'profilul cu abonamentul nou nu trebuie atins')
    assert.equal(finalizeStatus(), 'completed')
  })

  it('abonamentul CURENT devenit terminal → free se scrie (nu e replay stale)', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_dead' })
    state.stripeImpls['subscriptions.retrieve'] = async () => ({
      status: 'canceled', metadata: { plan: 'pro' }, items: { data: [] },
    })
    await fire('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_dead',
    })
    assert.equal(profileUpdates()[0].plan, 'free')
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

// ── Abonament UNIC la finalizare (lotul #61) ──────────────────────────────────
// Mai multe sesiuni Checkout finalizate pentru același cont (chei de idempotență
// diferite, două taburi, cereri simultane) dau DOUĂ abonamente vii, facturate
// amândouă. Garanția: un UPDATE condiționat decide sub lacătul rândului cine
// ține profilul; primul înregistrat rămâne, al doilea se anulează și, dacă a
// încasat, se rambursează. Fake-ul de profil (installTable) EVALUEAZĂ WHERE-ul,
// iar „lumea Stripe” de mai jos ține starea abonamentelor, facturilor și
// rambursărilor, ca reluările să vadă ce a făcut încercarea anterioară.
//
//   DUP1   profil gol → scris, subscription_started, zero anulare
//          [PICĂ: claim fără `.or(...)` pe forma filtrului]
//   DUP2   profilul ține ALT abonament VIU → profil neatins, dublura anulată
//          (cu urmă, fără cheie pe DELETE) + rambursată (cheie pe factură), zero
//          subscription_started, ALERT cu ambele id-uri
//          [PICĂ: UPDATE necondiționat; holder tratat mereu ca încheiat]
//   DUP2b  după anulare, updated/deleted ale dublurii → stale skip (fără
//          downgrade, fără email, atribuirea neatinsă)
//   DUP3   abonamentul din profil e ÎNCHEIAT (deleted pierdut) / necunoscut lui
//          Stripe → înlocuit prin CAS pe valoarea veche, zero anulare
//          [PICĂ: holder tratat mereu ca viu]
//   DUP3b  REZIDUAL: holder facturabil dar nu viu (unpaid / incomplete) →
//          înlocuit la fel, FĂRĂ anulare — comportament ales, nu caz rezolvat
//   DUP4   relivrarea aceluiași abonament → idempotent, zero anulare/rambursare
//   DUP5   CONCURENȚĂ: două finalizări în paralel pe profil gol → exact una
//          scrisă, cealaltă anulată + rambursată
//          [PICĂ: UPDATE necondiționat; citire-apoi-scriere]
//   DUP6   anulare reușită + rambursare eșuată → 500; reluarea rambursează FĂRĂ
//          a doua anulare  [PICĂ: fără urma de anulare la reluare]
//   DUP7   dublură în trial, factură de 0 → anulare, zero rambursare
//          [PICĂ: fără verificarea `amount_paid`]
//   DUP8   reluare după ce rambursarea există deja (cheia de 24 h expirată) →
//          zero rambursare nouă  [PICĂ: fără refunds.list înainte]
//   DUP8b  o rambursare anterioară EȘUATĂ nu contează → rambursare integrală
//          [PICĂ: rambursările eșuate/anulate numărate ca făcute]
//   DUP8c  list gol + create → charge_already_refunded (altă livrare) → 200
//          [PICĂ: fără catch-ul charge_already_refunded]
//   DUP9   holder ilizibil (eroare Stripe tranzitorie) → 500, nimic scris/anulat
//   DUP10  sesiune fără abonament / cu id care ar sparge filtrul → 500, nimic scris
//          [PICĂ: fără validarea formei]
//   DUP11  două abonamente noi înlocuiesc concurent același holder încheiat →
//          exact unul scris  [PICĂ: CAS fără `eq` pe valoarea veche]
//   DUP12  customer.subscription.updated cu profilul înregistrat între citire și
//          scriere → nu-l suprascrie  [PICĂ: UPDATE necondiționat în updated]
//   DUP13  customer.subscription.deleted cu abonamentul înlocuit între citire și
//          scriere → nu-l șterge  [PICĂ: UPDATE necondiționat în deleted]
//   DUP14  dublură VIE Menuvia (contul în metadata) cu price nemapat (plan
//          rezolvat 'free') → tot anulată  [PICĂ: decizia pe planul rezolvat în
//          loc de stare; „Menuvia” doar după price]
//   DUP14b abonament STRĂIN (fără contul în metadata, fără price Menuvia) lângă
//          unul viu sau încheiat → neatins, ALERT foreign  [PICĂ: fără garda
//          foreign; orice supabase_user_id acceptat; garda doar înaintea
//          anulării (CAS-ul îl înlocuia)]
//   DUP15  plata facturii: forma `payments` (basil+), plătită în afara Stripe →
//          manual, plătită fără plată lizibilă → 500
//   DUP16  anularea pică → 500 FĂRĂ rambursare; reluarea anulează + rambursează
//          [PICĂ: rambursarea înaintea anulării]
//   DUP17  cont inexistent → 200, nimic anulat
//   DUP18  profilul se eliberează / primește chiar acest abonament între
//          UPDATE-ul ratat și citire → reîncercare, scris  [PICĂ: `continue`
//          înlocuit cu „stale” — dublura rămânea vie, neurmărită, `completed`]
//   DUP19  profilul se schimbă la fiecare încercare → 500 după CLAIM_ATTEMPTS
//          [PICĂ: epuizarea buclei întoarce „written”]
//   DUP20  decontare întârziată: la finalizare factura e open → pending_payment;
//          banii sosiți după anulare → invoice.paid îi rambursează, fără comision
//          și fără lifecycle  [PICĂ: fără garda din invoice.paid; garda fără
//          `break` (cade în comision); open raportat nothing_paid]
//   DUP21  invoice.paid al dublurii reluat după rambursare și după
//          charge.refunded → fără comision, fără a doua rambursare
//          [PICĂ: fără garda din invoice.paid; garda fără `break`]
//   DUP22  garda din invoice.paid pe calea obișnuită: abonamentul urmărit nu se
//          citește; alt abonament viu / încheiat fără urmă / necunoscut →
//          comision normal; citire eșuată → 500  [PICĂ: citire mereu; orice
//          `canceled` = dublură; resource_missing aruncă; eroarea înghițită]
//   DUP23  factura evenimentului ≠ latest_invoice → se rambursează cea a
//          evenimentului  [PICĂ: rambursarea lui latest_invoice]
//   DUP24  ORDINEA uzuală: invoice.paid al dublurii ÎNAINTEA finalizării →
//          calea obișnuită (comision + invoice_paid, rezidual), apoi anulare +
//          rambursare, charge.refunded → clawback pe factura dublurii, relivrarea
//          lui invoice.paid = dedup  [caracterizare a reziduului; PICĂ și: orice
//          abonament neurmărit tratat ca dublură]
//   DUP25  updated al dublurii: înaintea finalizării → stale fără citire;
//          RELIVRAT TÂRZIU pe profil gol (instantaneu `active` de dinaintea
//          anulării) → citit din Stripe, sărit, fără plan plătit; control
//          pozitiv (abonament străin dublurii → scris); citire eșuată → 500
//          [PICĂ: fără garda pe profil gol; garda pe payload (fără citire)]
//   DUP26  deleted al dublurii pe profil gol → fără al doilea email, fără
//          atribuire, fără apel Stripe; profilul care chiar o ține →
//          retrogradat  [PICĂ: fără garda; garda fără condiția de profil gol]
describe('stripe-webhook: abonament unic la finalizare (DUP)', () => {
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)))
  const MARKER = 'menuvia:duplicate_subscription'

  function stripeErr(message, props) {
    return Object.assign(new Error(message), props)
  }

  // Bariera: ține primele `n` citiri ale fiecărui id până sosesc TOATE, ca
  // handler-ele paralele să ajungă împreună la pasul următor (altfel primul ar
  // termina înainte ca al doilea să înceapă și testul n-ar exersa cursa).
  function barrier(spec) {
    const left = { ...spec }
    let open
    const all = new Promise((r) => { open = r })
    return async (id) => {
      if (!left[id]) return
      left[id] -= 1
      if (Object.values(left).every((n) => n === 0)) open()
      await all
    }
  }

  // „Lumea Stripe”: abonamente, facturi, rambursări — cu stare. `failNext[k]`
  // aruncă O DATĂ eroarea dată pe operația k.
  function stripeWorld({ subs = {}, invoices = {}, refunds = {} } = {}) {
    const w = { subs: clone(subs), invoices: clone(invoices), refunds: clone(refunds), failNext: {}, gate: null }
    const failOnce = (k) => {
      const e = w.failNext[k]
      if (e) { delete w.failNext[k]; throw e }
    }
    const notFound = (what, id) => stripeErr(`No such ${what}: '${id}'`, { code: 'resource_missing', statusCode: 404 })
    state.stripeImpls['subscriptions.retrieve'] = async (id) => {
      if (w.gate) await w.gate(id)
      failOnce(`retrieve:${id}`)
      if (!w.subs[id]) throw notFound('subscription', id)
      return clone({ id, ...w.subs[id] })
    }
    state.stripeImpls['subscriptions.cancel'] = async (id, params) => {
      failOnce('cancel')
      const s = w.subs[id]
      if (!s) throw notFound('subscription', id)
      s.status = 'canceled'
      s.cancellation_details = {
        comment: (params && params.cancellation_details && params.cancellation_details.comment) || null,
        feedback: null,
        reason: 'cancellation_requested',
      }
      return clone({ id, ...s })
    }
    state.stripeImpls['invoices.retrieve'] = async (id) => {
      if (!w.invoices[id]) throw notFound('invoice', id)
      return clone({ id, ...w.invoices[id] })
    }
    const paidOn = (key) => {
      const inv = Object.values(w.invoices).find((i) => i.payment_intent === key || i.charge === key ||
        ((i.payments && i.payments.data) || []).some((p) => p.payment && p.payment.payment_intent === key))
      return inv ? inv.amount_paid : 0
    }
    state.stripeImpls['refunds.list'] = async (params) => ({
      object: 'list', has_more: false, data: clone(w.refunds[params.payment_intent || params.charge] || []),
    })
    state.stripeImpls['refunds.create'] = async (params) => {
      failOnce('refund')
      const key = params.payment_intent || params.charge
      const list = (w.refunds[key] = w.refunds[key] || [])
      // Ca pe Stripe: o rambursare eșuată/anulată nu consumă din suma plății.
      const left = paidOn(key) - list
        .filter((r) => r.status !== 'failed' && r.status !== 'canceled')
        .reduce((sum, r) => sum + r.amount, 0)
      if (left <= 0) throw stripeErr('Charge has already been refunded.', { code: 'charge_already_refunded', statusCode: 400 })
      const r = { id: `re_${key}_${list.length + 1}`, object: 'refund', amount: left, status: 'succeeded' }
      list.push(r)
      return clone(r)
    }
    return w
  }

  // dedup-ul stripe_events cu stare: aceeași cheie a doua oară → 23505, iar
  // reopen-ul reușește doar dacă rândul NU e 'completed' (exact handler-ul).
  function stripeEventsTable() {
    const rows = new Map()
    state.fromHandlers.stripe_events = (ops) => {
      const ins = opArg(ops, 'insert')
      if (ins) {
        if (rows.has(ins.event_id)) return { data: null, error: { code: '23505', message: 'dup' } }
        rows.set(ins.event_id, { ...ins })
        return { data: null, error: null }
      }
      const idOp = ops.find((o) => o.m === 'eq' && o.args[0] === 'event_id')
      const row = idOp && rows.get(idOp.args[1])
      if (hasOp(ops, 'neq')) {
        if (!row || row.status === 'completed') return { data: [], error: null }
        Object.assign(row, opArg(ops, 'update'))
        return { data: [{ status: row.status }], error: null }
      }
      if (row) Object.assign(row, opArg(ops, 'update'))
      return { data: null, error: null }
    }
    return rows
  }

  const paidSub = (inv, extra = {}) => ({
    status: 'active', metadata: { plan: 'growth' },
    items: { data: [{ price: { id: 'price_growth' } }] }, latest_invoice: inv, ...extra,
  })
  const paidInvoice = (pi, amount = 24900) => ({ status: 'paid', amount_paid: amount, payment_intent: pi })
  const session = (sub, user = 'u1') => ({
    id: `cs_${sub}`, mode: 'subscription', client_reference_id: user, customer: 'cus_1', subscription: sub,
  })
  const checkout = (sub, eventId = `evt_${sub}`) => fire('checkout.session.completed', session(sub), { eventId })
  // invoice.paid pe abonamentul `sub`, cu o linie lizibilă (altfel garda de formă
  // ar da 500 înaintea comisionului) și RPC-ul de comision scriptat „ok”.
  const paidEvent = (inv, sub, amount = 24900) => ({
    id: inv, customer: 'cus_1', amount_paid: amount, amount_due: amount, currency: 'ron',
    billing_reason: 'subscription_create', subscription: sub, attempt_count: 1, period_start: 1_719_792_000,
    lines: { data: [{ price: { id: 'price_growth' }, amount, period: { start: 1_719_792_000, end: 1_722_470_400 } }] },
  })
  function invoicePaid(inv, sub, eventId = `evt_paid_${inv}`) {
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: { ok: true }, error: null })
    return fire('invoice.paid', paidEvent(inv, sub), { eventId })
  }
  const commissions = () => rpcCallsFor('process_affiliate_invoice_paid')
  const row = () => profiles.rows.find((r) => r.id === 'u1')
  const started = () => lifecycleInserts().filter((l) => l && l.event_type === 'subscription_started')
  const cancels = () => stripeCallsFor('subscriptions.cancel')
  const refundsCreated = () => stripeCallsFor('refunds.create')
  // `lines` = console.error (alarmele), `logs` = console.log (deciziile de decontare).
  function withLogs(fn) {
    const orig = { error: console.error, log: console.log, warn: console.warn }
    const lines = []
    const logs = []
    console.error = (...a) => { lines.push(a.join(' ')) }
    console.log = (...a) => { logs.push(a.join(' ')) }
    console.warn = () => {}
    return Promise.resolve().then(fn).finally(() => Object.assign(console, orig)).then((out) => ({ out, lines, logs }))
  }

  it('DUP1: profil gol → abonamentul se scrie cu UPDATE condiționat, subscription_started, zero anulare', async () => {
    useProfiles([{ id: 'u1', stripe_customer_id: null }])
    stripeWorld({ subs: { sub_A: paidSub('in_A') }, invoices: { in_A: paidInvoice('pi_A') } })
    const res = await checkout('sub_A')
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(profileUpdates(), [{ plan: 'growth', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_A' }])
    // Contractul atomic: profilul e liber SAU ține deja acest abonament, în ACELAȘI UPDATE.
    const claim = state.fromCalls.find((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))
    assert.equal(opArg(claim.ops, 'or'), 'stripe_subscription_id.is.null,stripe_subscription_id.eq.sub_A')
    assert.ok(hasOp(claim.ops, 'select'), 'fără .select() rândurile atinse nu se văd')
    assert.equal(started().length, 1)
    assert.equal(cancels().length, 0)
    assert.equal(refundsCreated().length, 0)
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_A'])
    assert.equal(finalizeStatus(), 'completed')
  })

  it('DUP2: profilul ține ALT abonament VIU → profil neatins, dublura anulată + rambursată, ALERT cu ambele id-uri', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B', { metadata: { plan: 'pro' }, items: { data: [{ price: { id: 'price_pro' } }] } }) },
      invoices: { in_A: paidInvoice('pi_A'), in_B: paidInvoice('pi_B', 49900) },
    })
    const { out: res, lines } = await withLogs(() => checkout('sub_B'))
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(finalizeStatus(), 'completed')
    assert.deepEqual(profileUpdates(), [], 'profilul NU se atinge')
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'growth'])
    assert.equal(started().length, 0)
    // Anularea: DOAR dublura, fără prorată/factură finală, cu urmă; fără options
    // (Stripe ignoră Idempotency-Key pe DELETE).
    assert.equal(cancels().length, 1)
    const [cid, cparams, copts] = cancels()[0].args
    assert.equal(cid, 'sub_B')
    assert.deepEqual(cparams, {
      prorate: false, invoice_now: false,
      cancellation_details: { comment: `${MARKER};kept=sub_A` },
    })
    assert.equal(copts, undefined)
    assert.equal(w.subs.sub_A.status, 'active', 'abonamentul păstrat rămâne viu')
    assert.equal(w.subs.sub_B.status, 'canceled')
    // Rambursarea: pe plata facturii dublurii, integral, cu cheie derivată din factură.
    assert.deepEqual(stripeCallsFor('refunds.list')[0].args[0], { payment_intent: 'pi_B', limit: 100 })
    assert.equal(refundsCreated().length, 1)
    const [rparams, ropts] = refundsCreated()[0].args
    assert.deepEqual(rparams, {
      payment_intent: 'pi_B', reason: 'duplicate',
      metadata: { menuvia_reason: 'duplicate_subscription', menuvia_subscription: 'sub_B', menuvia_invoice: 'in_B' },
    })
    assert.deepEqual(ropts, { idempotencyKey: 'dupsub_refund_in_B' })
    assert.equal(w.refunds.pi_B[0].amount, 49900)
    assert.equal(w.refunds.pi_A, undefined, 'abonamentul păstrat nu e rambursat')
    const alert = lines.find((l) => l.includes('ALERT duplicate subscription'))
    assert.ok(alert && alert.includes('kept=sub_A') && alert.includes('duplicate=sub_B') && alert.includes('user=u1'), lines.join('\n'))
  })

  it('DUP2b: după anulare, updated/deleted ale dublurii → stale skip (fără downgrade, fără email, atribuirea neatinsă)', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    await withLogs(() => checkout('sub_B'))
    const dupEvent = { id: 'sub_B', customer: 'cus_1', status: 'canceled', items: { data: [{ price: { id: 'price_growth' } }] } }
    for (const type of ['customer.subscription.updated', 'customer.subscription.deleted']) {
      const res = await fire(type, dupEvent, { eventId: `evt_${type}` })
      assert.equal(res.statusCode, 200, `${type}: ${res.body}`)
    }
    assert.deepEqual(profileUpdates(), [])
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'growth'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    assert.equal(lifecycleInserts().length, 0)
  })

  // Un holder înlocuit trece prin ACEEAȘI cale (CAS, zero anulare) în două
  // situații cu sens diferit: încheiat de-a binelea (DUP3) și facturabil dar nu
  // viu (DUP3b, REZIDUAL). Aceeași aserțiune, nume diferite: un test nu are voie
  // să prezinte un rezidual consemnat drept caz rezolvat.
  async function assertHolderReplaced(holders) {
    for (const holder of holders) {
      resetMocks(); setEnv()
      useProfiles([{ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_A' }])
      stripeWorld({
        subs: { ...(holder ? { sub_A: holder } : {}), sub_B: paidSub('in_B') },
        invoices: { in_B: paidInvoice('pi_B') },
      })
      const res = await withLogs(() => checkout('sub_B')).then((x) => x.out)
      const label = holder ? holder.status : 'resource_missing'
      assert.equal(res.statusCode, 200, `${label}: ${res.body}`)
      assert.deepEqual(profileUpdates(), [{ plan: 'growth', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_B' }], label)
      // A doua scriere e compare-and-swap pe valoarea VECHE, nu necondiționată.
      const cas = state.fromCalls.filter((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))[1]
      assert.ok(cas.ops.some((o) => o.m === 'eq' && o.args[0] === 'stripe_subscription_id' && o.args[1] === 'sub_A'), label)
      assert.equal(started().length, 1, label)
      assert.equal(cancels().length, 0, label)
      assert.equal(refundsCreated().length, 0, label)
    }
  }

  it('DUP3: abonamentul din profil e ÎNCHEIAT (deleted pierdut) sau necunoscut lui Stripe → înlocuit prin CAS, zero anulare', async () => {
    await assertHolderReplaced([{ status: 'canceled' }, { status: 'incomplete_expired' }, null])
  })

  it('DUP3b: REZIDUAL — holder FACTURABIL dar nu viu (unpaid / incomplete) → înlocuit prin CAS FĂRĂ anulare (vezi CLAUDE.md, „Ce NU acoperă”)', async () => {
    // Nu e un caz „încheiat”: `unpaid` are factura deschisă și se poate plăti,
    // `incomplete` își poate confirma prima plată ~23 h. Abonamentul vechi rămâne
    // neurmărit dacă i se plătește ulterior factura. Testul îngheață
    // comportamentul ales, nu îl certifică drept sigur.
    await assertHolderReplaced([{ status: 'unpaid' }, { status: 'incomplete' }])
  })

  it('DUP4: relivrarea aceluiași abonament (profilul îl ține deja) → idempotent, zero anulare/rambursare', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_B' }])
    stripeWorld({ subs: { sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    const res = await checkout('sub_B')
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(row().stripe_subscription_id, 'sub_B')
    assert.equal(cancels().length, 0)
    assert.equal(refundsCreated().length, 0)
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_B'], 'fără citirea unui holder')
  })

  it('DUP5: CONCURENȚĂ — două finalizări în paralel pe profil gol → exact una scrisă, cealaltă anulată + rambursată', async () => {
    useProfiles([{ id: 'u1', stripe_customer_id: null }])
    const w = stripeWorld({
      subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') },
      invoices: { in_A: paidInvoice('pi_A'), in_B: paidInvoice('pi_B') },
    })
    w.gate = barrier({ sub_A: 1, sub_B: 1 })
    const { out } = await withLogs(() => Promise.all([checkout('sub_A'), checkout('sub_B')]))
    for (const res of out) assert.equal(res.statusCode, 200, res.body)
    const kept = row().stripe_subscription_id
    assert.ok(kept === 'sub_A' || kept === 'sub_B', `profilul ține ${kept}`)
    const dup = kept === 'sub_A' ? 'sub_B' : 'sub_A'
    assert.equal(profileUpdates().length, 1, 'un singur UPDATE efectiv')
    assert.deepEqual(started().map((l) => l.event_data.subscription_id), [kept])
    assert.deepEqual(cancels().map((c) => c.args[0]), [dup])
    assert.equal(w.subs[kept].status, 'active')
    assert.equal(w.subs[dup].status, 'canceled')
    assert.deepEqual(refundsCreated().map((c) => c.args[0].payment_intent), [dup === 'sub_A' ? 'pi_A' : 'pi_B'])
    // Ce rămâne VIU și facturat e exact ce urmărește profilul.
    const live = Object.entries(w.subs).filter(([, s]) => s.status === 'active').map(([id]) => id)
    assert.deepEqual(live, [kept])
  })

  it('DUP6: anulare reușită + rambursare eșuată → 500; reluarea rambursează FĂRĂ a doua anulare', async () => {
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.failNext.refund = stripeErr('An error occurred with our connection to Stripe.', { type: 'StripeConnectionError' })
    const first = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(first.statusCode, 500, first.body)
    assert.equal(finalizeStatus(), 'failed')
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.equal(w.refunds.pi_B, undefined, 'rambursarea n-a reușit')

    // Stripe retrimite ACELAȘI eveniment (rândul e 'failed' → reopen).
    const second = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(finalizeStatus(), 'completed')
    assert.equal(cancels().length, 1, 'anularea NU se repetă')
    assert.equal(w.refunds.pi_B.length, 1)
    assert.equal(w.refunds.pi_B[0].amount, 24900)
    assert.equal(row().stripe_subscription_id, 'sub_A')
    assert.equal(started().length, 0)
  })

  it('DUP7: dublură în trial (factura de 0) → anulare, zero rambursare', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: { sub_A: paidSub('in_A'), sub_T: paidSub('in_T', { status: 'trialing' }) },
      invoices: { in_T: { status: 'paid', amount_paid: 0, payment_intent: null } },
    })
    const res = (await withLogs(() => checkout('sub_T'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(cancels().map((c) => c.args[0]), ['sub_T'])
    assert.equal(w.subs.sub_T.status, 'canceled')
    assert.equal(stripeCallsFor('refunds.list').length, 0)
    assert.equal(refundsCreated().length, 0)
    assert.equal(row().stripe_subscription_id, 'sub_A')
  })

  it('DUP8: reluare după ce rambursarea există deja (cheia de idempotență expirată) → nicio rambursare nouă', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({
      subs: {
        sub_A: paidSub('in_A'),
        sub_B: paidSub('in_B', { status: 'canceled', cancellation_details: { comment: `${MARKER};kept=sub_A` } }),
      },
      invoices: { in_B: paidInvoice('pi_B') },
      refunds: { pi_B: [{ id: 're_old', amount: 24900, status: 'succeeded' }] },
    })
    const res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(cancels().length, 0, 'deja anulat DE NOI (urma) → fără a doua anulare')
    assert.equal(stripeCallsFor('refunds.list').length, 1)
    assert.equal(refundsCreated().length, 0)
    assert.equal(profileUpdates().length, 0)
  })

  it('DUP9: abonamentul din profil nu se poate citi (eroare Stripe tranzitorie) → 500, nimic scris, nimic anulat', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.failNext['retrieve:sub_A'] = stripeErr('timeout', { type: 'StripeConnectionError' })
    const res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
    assert.equal(profileUpdates().length, 0)
    assert.equal(cancels().length, 0)
    assert.equal(refundsCreated().length, 0)
  })

  it('DUP10: sesiune fără abonament / cu id care ar sparge filtrul or() → 500, nicio citire Stripe, nimic scris', async () => {
    for (const bad of [null, undefined, '', 'sub_x,stripe_subscription_id.is.null', 'sub_(x)', 'cus_1', 42]) {
      resetMocks(); setEnv()
      useProfiles([{ id: 'u1', stripe_customer_id: null }])
      stripeWorld({ subs: {} })
      const res = (await withLogs(() => fire('checkout.session.completed', {
        id: 'cs_bad', mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: bad,
      }))).out
      assert.equal(res.statusCode, 500, String(bad))
      assert.equal(stripeCallsFor('subscriptions.retrieve').length, 0, String(bad))
      assert.equal(state.fromCalls.filter((c) => c.table === 'profiles').length, 0, String(bad))
    }
  })

  it('DUP11: două abonamente noi înlocuiesc CONCURENT același abonament încheiat → exact unul scris, celălalt anulat', async () => {
    useProfiles([{ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: { sub_A: { status: 'canceled' }, sub_B: paidSub('in_B'), sub_C: paidSub('in_C') },
      invoices: { in_B: paidInvoice('pi_B'), in_C: paidInvoice('pi_C') },
    })
    // Ambele citesc abonamentul NOU împreună, apoi holder-ul încheiat împreună:
    // amândouă ajung la CAS crezând că profilul ține încă sub_A.
    const g1 = barrier({ sub_B: 1, sub_C: 1 })
    const g2 = barrier({ sub_A: 2 })
    w.gate = async (id) => { await g1(id); await g2(id) }
    const { out } = await withLogs(() => Promise.all([checkout('sub_B'), checkout('sub_C')]))
    for (const res of out) assert.equal(res.statusCode, 200, res.body)
    const kept = row().stripe_subscription_id
    assert.ok(kept === 'sub_B' || kept === 'sub_C', `profilul ține ${kept}`)
    const dup = kept === 'sub_B' ? 'sub_C' : 'sub_B'
    assert.equal(profileUpdates().length, 1, 'un singur CAS reușit')
    assert.deepEqual(cancels().map((c) => c.args[0]), [dup])
    const live = Object.entries(w.subs).filter(([, s]) => s.status === 'active').map(([id]) => id)
    assert.deepEqual(live, [kept])
  })

  it('DUP12: subscription.updated cu profilul înregistrat de alt checkout între citire și scriere → nu-l suprascrie', async () => {
    const t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    // Profil gol → updated citește abonamentul (garda DUP25): sub_B e viu, fără urmă.
    stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    // Checkout-ul lui sub_A se COMITE între citirea handler-ului și UPDATE-ul lui.
    t.hooks.beforeUpdate = (rows) => { Object.assign(rows[0], { plan: 'pro', stripe_subscription_id: 'sub_A' }) }
    const res = await withLogs(() => fire('customer.subscription.updated', {
      id: 'sub_B', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_growth' } }] },
    })).then((x) => x.out)
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'pro'])
    assert.equal(profileUpdates().length, 0)
    assert.equal(lifecycleInserts().length, 0, 'fără plan_changed')
  })

  it('DUP13: subscription.deleted cu abonamentul înlocuit între citire și scriere → nu șterge abonamentul nou', async () => {
    const t = useProfiles([{ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_A' }])
    // CAS-ul finalizării lui sub_B (sub_A era încheiat) se comite între citire și UPDATE.
    t.hooks.beforeUpdate = (rows) => { Object.assign(rows[0], { plan: 'growth', stripe_subscription_id: 'sub_B' }) }
    const res = await withLogs(() => fire('customer.subscription.deleted', { id: 'sub_A', customer: 'cus_1' }))
      .then((x) => x.out)
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    assert.equal(lifecycleInserts().length, 0, 'fără subscription_cancelled')
  })

  it('DUP14: dublură VIE Menuvia (metadata contului) cu price nemapat (planul rezolvă free) → tot anulată și rambursată', async () => {
    // Price-ul nu mai e în PLAN_BY_PRICE (rotit), dar abonamentul poartă contul
    // în metadata, ca orice abonament creat de stripe-checkout.js: e al nostru.
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: {
        sub_A: paidSub('in_A'),
        sub_X: paidSub('in_X', { metadata: { supabase_user_id: 'u1' }, items: { data: [{ price: { id: 'price_vechi' } }] } }),
      },
      invoices: { in_X: paidInvoice('pi_X') },
    })
    const res = (await withLogs(() => checkout('sub_X'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(w.subs.sub_X.status, 'canceled')
    assert.equal(refundsCreated().length, 1)
    assert.equal(row().stripe_subscription_id, 'sub_A')
  })

  it('DUP14b: abonament STRĂIN (fără contul în metadata, fără price Menuvia) lângă unul viu sau încheiat → neatins, ALERT, 200', async () => {
    // Un abonament al altui produs pe același cont Stripe (ECOSISTEM §4) sau
    // cu metadata altui cont nu e „dublura” noastră: anularea + rambursarea
    // sunt ireversibile. Nici nu înlocuiește abonamentul din profil.
    for (const [holder, meta] of [
      [paidSub('in_A'), { product: 'webvia' }],
      [paidSub('in_A'), { supabase_user_id: 'u2' }],
      [{ status: 'canceled' }, { product: 'webvia' }],
    ]) {
      resetMocks(); setEnv()
      useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const w = stripeWorld({
        subs: { sub_A: holder, sub_F: paidSub('in_F', { metadata: meta, items: { data: [{ price: { id: 'price_webvia' } }] } }) },
        invoices: { in_F: paidInvoice('pi_F') },
      })
      const label = `${holder.status}/${JSON.stringify(meta)}`
      const { out: res, lines } = await withLogs(() => checkout('sub_F'))
      assert.equal(res.statusCode, 200, `${label}: ${res.body}`)
      assert.equal(finalizeStatus(), 'completed', label)
      assert.equal(w.subs.sub_F.status, 'active', label)
      assert.equal(cancels().length, 0, label)
      assert.equal(stripeCallsFor('invoices.retrieve').length, 0, label)
      assert.equal(refundsCreated().length, 0, label)
      assert.deepEqual(profileUpdates(), [], label)
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'growth'], label)
      assert.equal(started().length, 0, label)
      const alert = lines.find((l) => l.includes('ALERT foreign subscription'))
      assert.ok(alert && alert.includes('user=u1') && alert.includes('current=sub_A') && alert.includes('subscription=sub_F'), lines.join('\n'))
    }
  })

  it('DUP15: plata facturii — forma `payments` (basil+) / plătită în afara Stripe (manual) / fără plată lizibilă (500)', async () => {
    const base = { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }

    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({ subs: base, invoices: { in_B: { status: 'paid', amount_paid: 24900,
      payments: { data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_D' } }] } } } })
    let res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(refundsCreated()[0].args[0].payment_intent, 'pi_D')

    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({ subs: base, invoices: { in_B: { status: 'paid', amount_paid: 24900, paid_out_of_band: true } } })
    const manual = await withLogs(() => checkout('sub_B'))
    assert.equal(manual.out.statusCode, 200, manual.out.body)
    assert.equal(refundsCreated().length, 0)
    assert.ok(manual.lines.some((l) => l.includes('rambursare MANUALĂ') && l.includes('in_B')), manual.lines.join('\n'))

    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({ subs: base, invoices: { in_B: { status: 'paid', amount_paid: 24900 } } })
    res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 500, 'bani încasați fără plată lizibilă = formă necunoscută, nu tăcere')
    assert.equal(refundsCreated().length, 0)
  })

  it('DUP16: anularea pică → 500 FĂRĂ rambursare; reluarea anulează și rambursează', async () => {
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.failNext.cancel = stripeErr('rate limited', { type: 'StripeRateLimitError', statusCode: 429 })
    const first = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(first.statusCode, 500)
    assert.equal(w.subs.sub_B.status, 'active')
    assert.equal(stripeCallsFor('invoices.retrieve').length, 0, 'rambursarea vine DUPĂ anulare')
    assert.equal(refundsCreated().length, 0)
    const second = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.equal(w.refunds.pi_B.length, 1)
  })

  it('DUP17: contul nu (mai) există → 200, nimic anulat (fără profil nu e nimic de comparat)', async () => {
    useProfiles([])
    stripeWorld({ subs: { sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    const res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(cancels().length, 0)
    assert.equal(started().length, 0)
  })

  it('DUP8b: o rambursare anterioară EȘUATĂ nu contează ca făcută → reluarea rambursează integral', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: {
        sub_A: paidSub('in_A'),
        sub_B: paidSub('in_B', { status: 'canceled', cancellation_details: { comment: `${MARKER};kept=sub_A` } }),
      },
      invoices: { in_B: paidInvoice('pi_B') },
      refunds: { pi_B: [{ id: 're_failed', amount: 24900, status: 'failed' }] },
    })
    const res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(refundsCreated().length, 1, 'banii n-au plecat: rambursarea eșuată nu e o rambursare')
    assert.deepEqual(w.refunds.pi_B.map((r) => [r.status, r.amount]), [['failed', 24900], ['succeeded', 24900]])
  })

  it('DUP8c: refunds.list gol, dar refunds.create răspunde charge_already_refunded (altă livrare a rambursat între timp) → 200, deja rambursat', async () => {
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.failNext.refund = stripeErr('Charge has already been refunded.', { code: 'charge_already_refunded', statusCode: 400 })
    const { out: res, logs } = await withLogs(() => checkout('sub_B'))
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(finalizeStatus(), 'completed', 'nu e un eșec: banii sunt deja înapoi')
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.ok(logs.some((l) => l.includes('settled') && l.includes('refund=already_refunded')), logs.join('\n'))
  })

  it('DUP18: profilul se ELIBEREAZĂ / primește chiar acest abonament între UPDATE-ul ratat și citire → încă o încercare, scris', async () => {
    // Intercalarea pe care n-o vede nicio altă suită: deleted(sub_A) comis (sau
    // o livrare concurentă a lui sub_B) DUPĂ UPDATE-ul condiționat ratat și
    // ÎNAINTEA citirii. Pe varianta greșită (renunță în loc să reîncerce),
    // sub_B rămâne viu, facturat și neurmărit, cu evenimentul `completed`.
    for (const committed of [null, 'sub_B']) {
      resetMocks(); setEnv()
      const t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      t.hooks.afterUpdate = (rows) => { rows[0].stripe_subscription_id = committed }
      const res = (await withLogs(() => checkout('sub_B'))).out
      const label = String(committed)
      assert.equal(res.statusCode, 200, `${label}: ${res.body}`)
      assert.equal(row().stripe_subscription_id, 'sub_B', label)
      assert.deepEqual(started().map((l) => l.event_data.subscription_id), ['sub_B'], label)
      assert.equal(cancels().length, 0, label)
      assert.equal(w.subs.sub_B.status, 'active', label)
    }
  })

  it('DUP19: profilul se schimbă concurent la FIECARE încercare → 500 după CLAIM_ATTEMPTS, nimic scris, nimic anulat', async () => {
    stripeEventsTable()
    const t = useProfiles([{ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_A' }])
    // Holder-ii sunt necunoscuți lui Stripe (resource_missing = încheiat), deci
    // fiecare încercare ajunge la CAS — iar înaintea fiecărui UPDATE alt
    // abonament încheiat ia locul celui citit.
    stripeWorld({ subs: { sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    let n = 0
    const rotate = (rows) => { rows[0].stripe_subscription_id = `sub_Z${n++}`; t.hooks.beforeUpdate = rotate }
    t.hooks.beforeUpdate = rotate
    const res = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(res.statusCode, 500, res.body)
    assert.equal(finalizeStatus(), 'failed')
    assert.notEqual(row().stripe_subscription_id, 'sub_B')
    assert.deepEqual(profileUpdates(), [])
    assert.equal(started().length, 0)
    assert.equal(cancels().length, 0)
    assert.equal(stripeCallsFor('subscriptions.retrieve').length, 1 + 3, 'dublura + câte un holder per încercare')
  })

  it('DUP20: plată cu DECONTARE ÎNTÂRZIATĂ — la finalizare factura e open → pending_payment; banii sosiți după anulare → invoice.paid îi rambursează, fără comision', async () => {
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') },
      // SEPA/transfer: abonamentul e `active`, PaymentIntent-ul `processing`, factura `open`.
      invoices: { in_B: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_B' } },
    })
    const fin = await withLogs(() => checkout('sub_B'))
    assert.equal(fin.out.statusCode, 200, fin.out.body)
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.equal(stripeCallsFor('refunds.list').length, 0, 'nimic încasat încă')
    assert.equal(refundsCreated().length, 0)
    assert.ok(fin.logs.some((l) => l.includes('refund=pending_payment') && l.includes('amount_due=24900')), fin.logs.join('\n'))
    assert.ok(!fin.logs.some((l) => l.includes('refund=nothing_paid')), 'o plată în curs nu e „nimic plătit”')

    // Debitul (deja în procesare, deci neanulabil) se decontează după anulare.
    Object.assign(w.invoices.in_B, { status: 'paid', amount_paid: 24900 })
    const paid = await withLogs(() => invoicePaid('in_B', 'sub_B'))
    assert.equal(paid.out.statusCode, 200, paid.out.body)
    assert.equal(finalizeStatus(), 'completed')
    assert.equal(refundsCreated().length, 1)
    const [rparams, ropts] = refundsCreated()[0].args
    assert.equal(rparams.payment_intent, 'pi_B')
    assert.deepEqual(ropts, { idempotencyKey: 'dupsub_refund_in_B' }, 'aceeași cheie ca la decontarea de la finalizare')
    assert.equal(w.refunds.pi_B[0].amount, 24900)
    assert.equal(commissions().length, 0, 'factura dublurii nu intră în comision')
    assert.deepEqual(lifecycleInserts(), [], 'nici invoice_paid, nici payment_recovered')
    assert.ok(paid.lines.some((l) => l.includes('ALERT invoice.paid pe abonamentul DUBLURĂ sub_B')), paid.lines.join('\n'))
  })

  it('DUP21: invoice.paid al dublurii RELUAT după rambursare și după charge.refunded → fără comision pe bani returnați, fără a doua rambursare', async () => {
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    await withLogs(() => checkout('sub_B'))
    assert.equal(w.refunds.pi_B.length, 1)

    // charge.refunded al rambursării noastre e consumat ÎNAINTE: clawback-ul nu
    // găsește nimic de stornat (comisionul nu există încă) și nu consemnează nimic.
    const worldList = state.stripeImpls['refunds.list']
    state.stripeImpls['refunds.list'] = async (params) =>
      worldList(params.charge === 'ch_B' ? { payment_intent: 'pi_B' } : params)
    state.rpcHandlers.process_affiliate_refund = () => ({ data: { ok: true, clawed_back: 0 }, error: null })
    const refunded = await fire('charge.refunded', { id: 'ch_B', invoice: 'in_B', amount: 24900 }, { eventId: 'evt_ref_B' })
    assert.equal(refunded.statusCode, 200, refunded.body)
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 1)

    // invoice.paid(in_B) a picat prima dată (500) și Stripe îl retrimite ACUM.
    const late = await withLogs(() => invoicePaid('in_B', 'sub_B'))
    assert.equal(late.out.statusCode, 200, late.out.body)
    assert.equal(commissions().length, 0, 'comision pe o factură deja rambursată = nestornat niciodată')
    assert.equal(refundsCreated().length, 1, 'refunds.list decide: deja rambursat')
    assert.ok(late.logs.some((l) => l.includes('invoice.paid refund=already_refunded')), late.logs.join('\n'))
    assert.deepEqual(lifecycleInserts(), [])
  })

  it('DUP22: garda din invoice.paid pe calea obișnuită — urmărit (zero citiri), alt abonament viu / încheiat fără urmă / necunoscut (comision), citire eșuată (500)', async () => {
    const tracked = { id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }

    // (a) Factura abonamentului URMĂRIT: nicio citire Stripe, comision normal.
    useProfiles([tracked])
    stripeWorld({ subs: { sub_A: paidSub('in_A') } })
    let res = await invoicePaid('in_A', 'sub_A')
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(stripeCallsFor('subscriptions.retrieve').length, 0, 'abonamentul urmărit nu se citește')
    assert.equal(commissions().length, 1)

    // (b) Control POZITIV pe citire: alt abonament, VIU → citit, comision normal.
    // (c) Încheiat FĂRĂ urma noastră (ex. ultima factură a unui abonament vechi)
    //     → nu e dublura noastră, comision normal.
    // (d) Necunoscut lui Stripe (resource_missing) → la fel.
    for (const [label, sub] of [
      ['viu', paidSub('in_C')],
      ['încheiat fără urmă', paidSub('in_C', { status: 'canceled', cancellation_details: { comment: 'customer request' } })],
      ['necunoscut', null],
    ]) {
      resetMocks(); setEnv()
      useProfiles([tracked])
      stripeWorld({ subs: { sub_A: paidSub('in_A'), ...(sub ? { sub_C: sub } : {}) } })
      res = (await withLogs(() => invoicePaid('in_C', 'sub_C'))).out
      assert.equal(res.statusCode, 200, `${label}: ${res.body}`)
      assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_C'], label)
      assert.equal(commissions().length, 1, label)
      assert.equal(refundsCreated().length, 0, label)
      assert.equal(lifecycleInserts()[0].event_type, 'invoice_paid', label)
    }

    // (e) Abonamentul nu se poate citi (eroare tranzitorie) → 500, fără comision.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([tracked])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_C: paidSub('in_C') } })
    w.failNext['retrieve:sub_C'] = stripeErr('timeout', { type: 'StripeConnectionError' })
    res = (await withLogs(() => invoicePaid('in_C', 'sub_C'))).out
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
    assert.equal(commissions().length, 0)
    assert.deepEqual(lifecycleInserts(), [])
  })

  it('DUP23: invoice.paid pe o factură a dublurii care NU e latest_invoice → se rambursează factura EVENIMENTULUI', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({
      subs: {
        sub_A: paidSub('in_A'),
        sub_B: paidSub('in_B2', { status: 'canceled', cancellation_details: { comment: `${MARKER};kept=sub_A` } }),
      },
      invoices: {
        in_B1: paidInvoice('pi_B1'),
        in_B2: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_B2' },
      },
    })
    const res = (await withLogs(() => invoicePaid('in_B1', 'sub_B'))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(refundsCreated().map((c) => c.args[0].payment_intent), ['pi_B1'])
    assert.equal(w.refunds.pi_B1[0].amount, 24900)
    assert.equal(commissions().length, 0)
  })

  it('DUP24: ORDINEA uzuală — invoice.paid al dublurii ÎNAINTEA finalizării ei → calea obișnuită, apoi anulare + rambursare, iar charge.refunded ajunge la clawback pe factura dublurii', async () => {
    // Caracterizare a reziduului consemnat (CLAUDE.md, „Afiliere — depinde de
    // ORDINEA evenimentelor”): la Stripe ordinea e arbitrară, iar invoice.paid
    // sosește des ÎNAINTEA lui checkout.session.completed. Testul îngheață
    // afirmația că banii se întorc și că clawback-ul primește factura dublurii.
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })

    // 1) invoice.paid(in_B): dublura încă VIE, fără urmă → nu e „a noastră” încă.
    const early = await withLogs(() => invoicePaid('in_B', 'sub_B'))
    assert.equal(early.out.statusCode, 200, early.out.body)
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_B'])
    assert.deepEqual(commissions().map((c) => c.args.p_stripe_invoice_id), ['in_B'], 'comisionul se scrie (rezidual)')
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['invoice_paid'], 'și semnalul already_paying (rezidual)')
    assert.equal(refundsCreated().length, 0)

    // 2) Finalizarea dublurii: profil neatins, anulare + rambursare integrală.
    const fin = await withLogs(() => checkout('sub_B'))
    assert.equal(fin.out.statusCode, 200, fin.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'growth'])
    assert.equal(started().length, 0)
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.deepEqual(refundsCreated().map((c) => c.args[1].idempotencyKey), ['dupsub_refund_in_B'])
    assert.equal(w.refunds.pi_B[0].amount, 24900)

    // 3) charge.refunded al rambursării noastre → clawback pe factura dublurii.
    const worldList = state.stripeImpls['refunds.list']
    state.stripeImpls['refunds.list'] = async (params) =>
      worldList(params.charge === 'ch_B' ? { payment_intent: 'pi_B' } : params)
    state.rpcHandlers.process_affiliate_refund = () => ({ data: { ok: true }, error: null })
    const refunded = await fire('charge.refunded', { id: 'ch_B', invoice: 'in_B', amount: 24900 }, { eventId: 'evt_ref_B' })
    assert.equal(refunded.statusCode, 200, refunded.body)
    const claws = rpcCallsFor('process_affiliate_refund')
    assert.equal(claws.length, 1)
    assert.deepEqual(
      [claws[0].args.p_stripe_invoice_id, claws[0].args.p_refund_amount_cents, claws[0].args.p_refund_id],
      ['in_B', 24900, w.refunds.pi_B[0].id],
    )

    // 4) Relivrarea lui invoice.paid(in_B) → dedup `completed`, nimic nou.
    const again = await withLogs(() => invoicePaid('in_B', 'sub_B'))
    assert.equal(again.out.statusCode, 200, again.out.body)
    assert.equal(commissions().length, 1)
    assert.equal(refundsCreated().length, 1)
    // Ce rămâne viu și facturat e exact ce urmărește profilul.
    assert.deepEqual(Object.entries(w.subs).filter(([, s]) => s.status === 'active').map(([id]) => id), ['sub_A'])
  })

  it('DUP25: customer.subscription.updated al dublurii — înaintea finalizării (stale) și RELIVRAT TÂRZIU pe profil gol (sărit, fără plan plătit)', async () => {
    const dupSnapshot = { id: 'sub_B', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_growth' } }] } }

    // (a) updated(sub_B) sosește ÎNAINTEA finalizării: profilul ține sub_A → stale,
    //     fără citire Stripe; finalizarea anulează apoi dublura ca de obicei.
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    let res = (await withLogs(() => fire('customer.subscription.updated', dupSnapshot, { eventId: 'evt_upd_B' }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(stripeCallsFor('subscriptions.retrieve').length, 0, 'profilul ține alt abonament → fără citire')
    assert.equal(profileUpdates().length, 0)
    await withLogs(() => checkout('sub_B'))
    assert.equal(w.subs.sub_B.status, 'canceled')

    // (b) Cel păstrat se încheie → profil gol. Stripe relivrează ACUM un updated(sub_B)
    //     de DINAINTEA anulării (instantaneu `active`, fără urmă în payload).
    await withLogs(() => fire('customer.subscription.deleted', { id: 'sub_A', customer: 'cus_1' }, { eventId: 'evt_del_A' }))
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    const before = stripeCallsFor('subscriptions.retrieve').length
    const lifeBefore = lifecycleInserts().length
    res = (await withLogs(() => fire('customer.subscription.updated', dupSnapshot, { eventId: 'evt_upd_B_late' }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(finalizeStatus(), 'completed')
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').slice(before).map((c) => c.args[0]), ['sub_B'])
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], 'fără plan plătit pe un abonament anulat')
    assert.equal(lifecycleInserts().length, lifeBefore, 'fără plan_changed')

    // (c) Control POZITIV: pe profil gol, un abonament viu care NU e dublura noastră
    //     se înregistrează ca înainte (citit o dată).
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    stripeWorld({ subs: { sub_C: paidSub('in_C') } })
    res = (await withLogs(() => fire('customer.subscription.updated', { ...dupSnapshot, id: 'sub_C' }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_C'])
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_C', 'growth'])

    // (d) Citirea pică (eroare tranzitorie) → 500, nimic scris; Stripe retrimite.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    const wd = stripeWorld({ subs: { sub_C: paidSub('in_C') } })
    wd.failNext['retrieve:sub_C'] = stripeErr('timeout', { type: 'StripeConnectionError' })
    res = (await withLogs(() => fire('customer.subscription.updated', { ...dupSnapshot, id: 'sub_C' }))).out
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
    assert.equal(profileUpdates().length, 0)
  })

  it('DUP26: customer.subscription.deleted al dublurii pe profil GOL (cel păstrat încheiat între timp) → fără al doilea email, fără atribuire; pe profilul care o ține → retrogradare', async () => {
    const marked = {
      id: 'sub_B', customer: 'cus_1', status: 'canceled',
      cancellation_details: { comment: `${MARKER};kept=sub_A`, feedback: null, reason: 'cancellation_requested' },
    }
    // (a) Dublura, profil gol → sărit, fără nicio citire Stripe (urma e în payload).
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    let res = (await withLogs(() => fire('customer.subscription.deleted', marked))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(lifecycleInserts().length, 0, 'fără subscription_cancelled pentru dublură')
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    assert.equal(profileUpdates().length, 0)
    assert.deepEqual(state.stripeCalls.map((c) => c.name).filter((n) => n !== 'webhooks.constructEvent'), [],
      'fără apel Stripe: urma vine din payload')

    // (b) Control POZITIV: un abonament fără urma noastră, profil gol → ca înainte.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    res = (await withLogs(() => fire('customer.subscription.deleted', { id: 'sub_X', customer: 'cus_1', status: 'canceled' }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['subscription_cancelled'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 1)

    // (c) Profilul ține chiar abonamentul marcat (stare veche) → se retrogradează:
    //     garda e doar pentru profilul gol, nu lasă un plan plătit pe un anulat.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_B' }])
    res = (await withLogs(() => fire('customer.subscription.deleted', marked))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
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
    // …și nici atribuirea de afiliere nu se stinge (abonamentul curent trăiește).
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
  })

  // AW8 (recenzie pe #286): sfârșitul abonamentului e SINGURUL loc care stinge
  // atribuirea (`canceled`), DUPĂ downgrade.
  it('AW8: abonamentul curent șters → atribuirea `canceled`, după downgrade', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_1' })
    const res = await fire('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' })
    assert.equal(res.statusCode, 200)
    const st = rpcCallsFor('set_affiliate_attribution_status')
    assert.equal(st.length, 1)
    assert.deepEqual([st[0].args.p_referred_profile_id, st[0].args.p_status], ['u1', 'canceled'])
    assert.ok(st[0].args.p_reason.includes('sub_1'))
    assert.equal(profileUpdates()[0].plan, 'free')
  })

  it('AW9: status RPC eșuat → 500 + rând failed (Stripe retrimite), emailul de anulare NU e încă în coadă', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_1' })
    state.rpcHandlers.set_affiliate_attribution_status = () => ({ data: null, error: { message: 'rpc down' } })
    const res = await fire('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' })
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
    // Downgrade-ul s-a scris (idempotent la reluare); lifecycle-ul vine abia
    // după atribuire, deci reluarea nu dublează emailul.
    assert.equal(profileUpdates()[0].plan, 'free')
    assert.equal(lifecycleInserts().length, 0)
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

  // AW6 (recenzie pe #286): nici un eșec TERMINAL pe o factură nu stinge
  // atribuirea — terminal e ireversibil, iar clientul poate plăti ulterior.
  // Abonamentul anulat de dunning ajunge în subscription.deleted (AW8).
  it('AW6: eșec de plată (inclusiv terminal) → atribuirea NEATINSĂ, lifecycle normal', async () => {
    for (const extra of [{ next_payment_attempt: null }, { next_payment_attempt: 1_700_100_000 }, {}]) {
      resetMocks(); setEnv()
      scriptProfile({ id: 'u1' })
      const res = await fire('invoice.payment_failed', {
        id: 'in_f', customer: 'cus_1', subscription: 'sub_1', attempt_count: 4, ...extra,
      })
      assert.equal(res.statusCode, 200)
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
      assert.equal(lifecycleInserts()[0].event_type, 'payment_failed')
    }
  })
})

describe('stripe-webhook: invoice.paid (comisioane afiliere)', () => {
  // Profilul URMĂREȘTE abonamentul facturii (factura unui ciclu obișnuit): fără
  // asta, garda de dublură (lotul #61) citește abonamentul din Stripe — vezi DUP22.
  const TRACKED = { id: 'u1', stripe_subscription_id: 'sub_1' }
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
    scriptProfile(TRACKED)
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    await fire('invoice.paid', invoiceEvent({ attempt_count: 3 }))
    const kinds = lifecycleInserts().map((l) => l.event_type)
    assert.deepEqual(kinds, ['invoice_paid', 'payment_recovered'])

    resetMocks(); setEnv()
    scriptProfile(TRACKED)
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    await fire('invoice.paid', invoiceEvent({ attempt_count: 1 }))
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['invoice_paid'])
  })

  it('planul comisionului = linia FACTURATĂ: price mapat + period.end maxim, nu data[0]', async () => {
    scriptProfile(TRACKED)
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
    scriptProfile(TRACKED)
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
    scriptProfile(TRACKED)
    await fire('invoice.paid', invoiceEvent({ amount_paid: 0 }))
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid').length, 0)
  })

  it('comision eșuat → 500 + rând failed (Stripe retrimite; NU pierdere tăcută)', async () => {
    scriptProfile(TRACKED)
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({
      data: null, error: { message: 'rpc down' },
    })
    // O linie cu price lizibil: fără ea, 500-ul ar veni din garda de formă
    // („nicio linie cu price lizibil”), nu din RPC — testul trecea vacuu așa.
    const res = await fire('invoice.paid', invoiceEvent({
      lines: { data: [{ price: { id: 'price_growth' }, amount: 9900, period: { start: 1_719_792_000, end: 1_722_470_400 } }] },
    }))
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
    // 500-ul vine din RPC, nu din altă cale (garda de formă, o citire Stripe nescriptată).
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid').length, 1)
    assert.equal(stripeCallsFor('subscriptions.retrieve').length, 0)
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
    // `invoice` PREZENT (forma 2023-10-16): fără el handler-ul re-citește charge-ul,
    // iar testul ar fi trecut pe 500-ul de la retrieve-ul nescriptat, nu pe RPC.
    const res = await fire('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount: 9900 })
    assert.equal(res.statusCode, 500)
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 1)
    assert.equal(stripeCallsFor('charges.retrieve').length, 0)
  })

  it('dispute pierdută → clawback TOTAL cu cheie idempotentă dispute_<id>', async () => {
    state.stripeImpls['charges.retrieve'] = async () => ({ id: 'ch_1', invoice: 'in_1', amount: 9900 })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    const res = await fire('charge.dispute.closed', { id: 'dp_1', status: 'lost', charge: 'ch_1', amount: 9900 })
    assert.equal(res.statusCode, 200)
    const call = rpcCallsFor('process_affiliate_refund')[0]
    assert.equal(call.args.p_refund_id, 'dispute_dp_1')
    assert.equal(call.args.p_refund_amount_cents, 9900)
  })

  // AW1 (mig 293): baza disputei e SUMA DISPUTATĂ, nu tot charge-ul — după un
  // refund parțial, disputa pe rest nu are voie să storneze iar partea refundată.
  it('AW1: dispută pierdută pe o parte → baza = dispute.amount, nu charge.amount', async () => {
    state.stripeImpls['charges.retrieve'] = async () => ({ id: 'ch_1', invoice: 'in_1', amount: 9900 })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    const res = await fire('charge.dispute.closed', { id: 'dp_2', status: 'lost', charge: 'ch_1', amount: 4000 })
    assert.equal(res.statusCode, 200)
    const call = rpcCallsFor('process_affiliate_refund')[0]
    assert.equal(call.args.p_refund_amount_cents, 4000)
    assert.equal(call.args.p_charge_amount_cents, 9900)
  })

  it('AW2: dispută fără sumă lizibilă → 500 fără clawback (formă necunoscută, nu ghicim)', async () => {
    state.stripeImpls['charges.retrieve'] = async () => ({ id: 'ch_1', invoice: 'in_1', amount: 9900 })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    const res = await fire('charge.dispute.closed', { id: 'dp_3', status: 'lost', charge: 'ch_1' })
    assert.equal(res.statusCode, 500)
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 0)
  })

  // AW3/AW4 (recenzie pe #286): disputa pierdută și refund-ul TOTAL pe o
  // factură recuperează comisionul prin clawback, dar NU fac atribuirea
  // terminală — un refund de bunăvoință pe o lună ar fi oprit pe veci
  // comisioanele unui client care rămâne abonat.
  it('AW3: dispută pierdută pe factură → clawback, atribuirea NEATINSĂ', async () => {
    state.stripeImpls['charges.retrieve'] = async () => ({ id: 'ch_1', invoice: 'in_1', amount: 9900, customer: 'cus_1' })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    scriptProfile({ id: 'u1' })
    const res = await fire('charge.dispute.closed', { id: 'dp_4', status: 'lost', charge: 'ch_1', amount: 9900 })
    assert.equal(res.statusCode, 200)
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 1)
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
  })

  it('AW4: refund TOTAL / parțial / plată unică → clawback, atribuirea NEATINSĂ', async () => {
    for (const [refund, charge] of [
      [9900, { id: 'ch_1', invoice: 'in_1', amount: 9900, amount_refunded: 9900, refunded: true, customer: 'cus_1' }],
      [3000, { id: 'ch_1', invoice: 'in_1', amount: 9900, amount_refunded: 3000, refunded: false, customer: 'cus_1' }],
      [500,  { id: 'ch_2', invoice: null, amount: 500, amount_refunded: 500, refunded: true, customer: 'cus_1' }],
    ]) {
      resetMocks(); setEnv()
      state.stripeImpls['refunds.list'] = async () => ({ data: [{ id: 're_1', amount: refund }] })
      state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
      scriptProfile({ id: 'u1' })
      const res = await fire('charge.refunded', charge)
      assert.equal(res.statusCode, 200)
      assert.equal(rpcCallsFor('process_affiliate_refund').length, 1)
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    }
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

// ── Forma payload-ului: endpoint pe '2023-10-16' vs dahlia (stripe-node 22) ──
// Forma evenimentului o decide versiunea ENDPOINT-ului din Stripe, nu pin-ul.
// Un cont nou pornește pe versiunea curentă; între cele două forme exact patru
// citiri s-au mutat (basil): price-ul liniei, tipul liniei, abonamentul facturii
// și factura charge-ului. Fixturile de mai jos au forma DAHLIA (fără câmpurile
// vechi) — pe codul dinainte, comisionul pleca cu plan/abonament null (skip
// tăcut în RPC) și clawback-ul fără factură.
describe('stripe-webhook: payload dahlia (endpoint pe altă versiune decât pin-ul)', () => {
  const DAHLIA = '2026-08-26.dahlia'
  // Profilul urmărește abonamentul facturii (fără citirea gărzii de dublură).
  const TRACKED_D = { id: 'u1', stripe_subscription_id: 'sub_d' }
  function dahliaInvoice(overrides = {}) {
    return {
      id: 'in_d', customer: 'cus_1', amount_paid: 24900, currency: 'ron',
      billing_reason: 'subscription_cycle', attempt_count: 1, period_start: 1_719_792_000,
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_d' } },
      lines: { data: [{
        amount: 24900,
        period: { start: 1_719_792_000, end: 1_722_470_400 },
        parent: { type: 'subscription_item_details' },
        pricing: { type: 'price_details', price_details: { price: 'price_pro', product: 'prod_1' } },
      }] },
      ...overrides,
    }
  }
  function withConsoleError(fn) {
    const orig = console.error
    const lines = []
    console.error = (...a) => { lines.push(a.join(' ')) }
    return Promise.resolve(fn()).finally(() => { console.error = orig }).then(() => lines)
  }

  it('WV1: invoice.paid dahlia → planul din pricing.price_details, abonamentul din parent', async () => {
    scriptProfile(TRACKED_D)
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const res = await fire('invoice.paid', dahliaInvoice(), { apiVersion: DAHLIA })
    assert.equal(res.statusCode, 200)
    const call = rpcCallsFor('process_affiliate_invoice_paid')[0]
    assert.equal(call.args.p_plan, 'pro')
    assert.equal(call.args.p_stripe_subscription_id, 'sub_d')
    assert.equal(call.args.p_period_month, '2024-07-01')
    assert.equal(lifecycleInserts()[0].event_data.subscription_id, 'sub_d')
  })

  it('WV2: price și abonament EXPANDATE (obiecte, nu id-uri) → se citesc la fel', async () => {
    scriptProfile({ id: 'u1', stripe_subscription_id: 'sub_x' })
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const inv = dahliaInvoice({
      parent: { type: 'subscription_details', subscription_details: { subscription: { id: 'sub_x' } } },
    })
    inv.lines.data[0].pricing.price_details.price = { id: 'price_growth' }
    await fire('invoice.paid', inv, { apiVersion: DAHLIA })
    const call = rpcCallsFor('process_affiliate_invoice_paid')[0]
    assert.equal(call.args.p_plan, 'growth')
    assert.equal(call.args.p_stripe_subscription_id, 'sub_x')
  })

  it('WV3: bani reali pe abonament, dar NICIO linie cu price lizibil → 500 (formă necunoscută), fără RPC', async () => {
    scriptProfile(TRACKED_D)
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const inv = dahliaInvoice()
    inv.lines.data[0].pricing = {}
    const res = await fire('invoice.paid', inv, { apiVersion: DAHLIA })
    assert.equal(res.statusCode, 500)
    assert.equal(finalizeStatus(), 'failed')
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid').length, 0)
    assert.equal(stripeCallsFor('subscriptions.retrieve').length, 0, '500-ul e din forma liniei, nu din altă cale')
  })

  it('WV4: price LIZIBIL dar nemapat → skip ca până acum (p_plan null, 200), nu alarmă', async () => {
    scriptProfile(TRACKED_D)
    state.rpcHandlers.process_affiliate_invoice_paid = () => ({ data: null, error: null })
    const inv = dahliaInvoice()
    inv.lines.data[0].pricing.price_details.price = 'price_vechi_nemapat'
    const res = await fire('invoice.paid', inv, { apiVersion: DAHLIA })
    assert.equal(res.statusCode, 200)
    assert.equal(rpcCallsFor('process_affiliate_invoice_paid')[0].args.p_plan, null)
  })

  it('WV5: charge.refunded fără câmpul `invoice` → re-citire pe pin, clawback-ul primește factura', async () => {
    state.stripeImpls['charges.retrieve'] = async (id) => ({ id, invoice: 'in_9', amount: 9900 })
    state.stripeImpls['refunds.list'] = async () => ({ data: [{ id: 're_1', amount: 3000 }] })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    const res = await fire('charge.refunded', { id: 'ch_9', amount: 9900 }, { apiVersion: DAHLIA })
    assert.equal(res.statusCode, 200)
    assert.equal(stripeCallsFor('charges.retrieve')[0].args[0], 'ch_9')
    assert.equal(rpcCallsFor('process_affiliate_refund')[0].args.p_stripe_invoice_id, 'in_9')
  })

  it('WV5b: `invoice: null` PREZENT (plată unică) → fără re-citire', async () => {
    state.stripeImpls['refunds.list'] = async () => ({ data: [] })
    const res = await fire('charge.refunded', { id: 'ch_1', invoice: null, amount: 500 })
    assert.equal(res.statusCode, 200)
    assert.equal(stripeCallsFor('charges.retrieve').length, 0)
  })

  it('WV6: api_version ≠ pin → ALERT în log, dar evenimentul se procesează (200)', async () => {
    const lines = await withConsoleError(async () => {
      const res = await fire('customer.unknown', {}, { apiVersion: DAHLIA })
      assert.equal(res.statusCode, 200)
    })
    assert.ok(lines.some((l) => l.includes('ALERT api_version mismatch') && l.includes(DAHLIA)), lines.join('\n'))
    // Control negativ: pe pin, nicio alarmă.
    resetMocks(); setEnv()
    const quiet = await withConsoleError(() => fire('customer.unknown', {}, { apiVersion: '2023-10-16' }))
    assert.ok(!quiet.some((l) => l.includes('ALERT api_version mismatch')), quiet.join('\n'))
  })
})

// ── Gardă livemode (lib/livemode.js) ───────────────────────────────────────────
// Cheia TEST nu are voie să ajungă în producție (cardul 4242 ar da Planul 3
// gratuit), iar rândurile de test nu intră în registrul real de comisioane.
// Semnătura NU apără: un endpoint de test își semnează corect evenimentele. Garda
// compară `event.livemode` cu modul din STRIPE_SECRET_KEY, după semnătură și
// ÎNAINTE de orice efect.
describe('stripe-webhook: gardă livemode', () => {
  function withConsoleError(fn) {
    const orig = console.error
    const lines = []
    console.error = (...a) => { lines.push(a.join(' ')) }
    return Promise.resolve(fn()).finally(() => { console.error = orig }).then(() => lines)
  }
  // Eveniment cu EFECTE multiple dacă ar fi procesat (dedup în stripe_events,
  // citire refunds în Stripe, clawback prin RPC).
  async function fireRefund(ev, { omitLivemode = false } = {}) {
    const full = {
      id: 'evt_lm', type: 'charge.refunded', created: 1_700_000_000,
      data: { object: { id: 'ch_1', invoice: 'in_1', amount: 9900 } },
      ...ev,
    }
    if (omitLivemode) delete full.livemode
    state.stripeImpls['webhooks.constructEvent'] = () => full
    state.stripeImpls['refunds.list'] = async () => ({ data: [{ id: 're_1', amount: 3000 }] })
    state.rpcHandlers.process_affiliate_refund = () => ({ data: null, error: null })
    return handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' })
  }
  function assertNoEffects() {
    assert.equal(state.fromCalls.length, 0, 'nicio scriere/citire DB')
    assert.equal(state.rpcCalls.length, 0, 'niciun RPC')
    assert.deepEqual(
      state.stripeCalls.map((c) => c.name),
      ['webhooks.constructEvent'],
      'niciun apel Stripe în afară de verificarea semnăturii',
    )
  }
  function assertProcessed(res) {
    assert.equal(res.statusCode, 200)
    assert.ok(state.fromCalls.some((c) => c.table === 'stripe_events'), 'dedup inserat = procesat')
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 1, 'clawback chemat')
  }

  it('LM1: cheie live + eveniment live → procesat', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_x'
    assertProcessed(await fireRefund({ livemode: true }))
  })

  it('LM2: cheie test + eveniment test → procesat (și cheie restricționată rk_test_)', async () => {
    assertProcessed(await fireRefund({ livemode: false }))
    resetMocks(); setEnv()
    process.env.STRIPE_SECRET_KEY = 'rk_test_x'
    assertProcessed(await fireRefund({ livemode: false }))
    resetMocks(); setEnv()
    process.env.STRIPE_SECRET_KEY = 'rk_live_x'
    assertProcessed(await fireRefund({ livemode: true }))
  })

  it('LM3: cheie TEST + eveniment LIVE → 200 ignorat, zero efecte, ALERT fără secrete', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_SUPERSECRET'
    let res
    const lines = await withConsoleError(async () => { res = await fireRefund({ livemode: true }) })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' })
    assertNoEffects()
    const alert = lines.find((l) => l.includes('ALERT livemode mismatch'))
    assert.ok(alert, lines.join('\n'))
    for (const part of ['evt_lm', 'charge.refunded', 'livemode=true', 'key_mode=test']) {
      assert.ok(alert.includes(part), `${part} lipsește din: ${alert}`)
    }
    assert.ok(!alert.includes('SUPERSECRET') && !alert.includes('ch_1') && !alert.includes('in_1'), alert)
  })

  it('LM4: cheie LIVE + eveniment TEST → 200 ignorat, zero efecte (celălalt sens)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_x'
    let res
    const lines = await withConsoleError(async () => { res = await fireRefund({ livemode: false }) })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' })
    assertNoEffects()
    const alert = lines.find((l) => l.includes('ALERT livemode mismatch'))
    assert.ok(alert && alert.includes('livemode=false') && alert.includes('key_mode=live'), lines.join('\n'))
  })

  it('LM5: eveniment FĂRĂ câmpul livemode → nepotrivire (fail-closed), pe ambele chei', async () => {
    for (const key of ['sk_test_x', 'sk_live_x']) {
      resetMocks(); setEnv()
      process.env.STRIPE_SECRET_KEY = key
      let res
      const lines = await withConsoleError(async () => { res = await fireRefund({}, { omitLivemode: true }) })
      assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' }, key)
      assertNoEffects()
      assert.ok(lines.some((l) => l.includes('ALERT livemode mismatch') && l.includes('livemode=missing')), lines.join('\n'))
    }
  })

  it('LM5b: livemode ne-boolean ("false", 0, null) → nepotrivire, nu coerciție', async () => {
    for (const bad of ['false', 0, null, 'true', 1]) {
      resetMocks(); setEnv() // cheie test: "false"/0/null ar trece la o comparație lejeră
      const lines = await withConsoleError(() => fireRefund({ livemode: bad }))
      assertNoEffects()
      assert.ok(lines.some((l) => l.includes('ALERT livemode mismatch')), String(bad))
    }
  })

  it('LM6: cheie cu mod necunoscut → 500 livemode_unknown, zero efecte, ALERT', async () => {
    for (const key of ['pk_test_x', 'whsec_x', 'garbage', 'sk_prod_x', ' sk_test_x']) {
      resetMocks(); setEnv()
      process.env.STRIPE_SECRET_KEY = key
      let res
      const lines = await withConsoleError(async () => { res = await fireRefund({ livemode: false }) })
      assert.equal(res.statusCode, 500, key)
      assert.deepEqual(parseBody(res), { error: 'livemode_unknown' })
      assertNoEffects()
      const alert = lines.find((l) => l.includes('ALERT livemode mismatch'))
      assert.ok(alert && alert.includes('key_mode=unknown'), lines.join('\n'))
      assert.ok(!alert.includes('whsec_x') && !alert.includes('pk_test_x') && !alert.includes('sk_prod_x'), alert)
    }
  })

  it('LM7: semnătura se verifică ÎNAINTEA gărzii (semnătură greșită → 400, chiar și cu cheie necunoscută)', async () => {
    process.env.STRIPE_SECRET_KEY = 'garbage'
    state.stripeImpls['webhooks.constructEvent'] = () => { throw new Error('bad sig') }
    const res = await handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' })
    assert.equal(res.statusCode, 400)
  })

  it('LM8: ALERT api_version mismatch rămâne pe evenimentele procesate (garda nu-l înlocuiește)', async () => {
    const lines = await withConsoleError(async () => {
      const res = await fire('customer.unknown', {}, { apiVersion: '2026-08-26.dahlia', livemode: false })
      assert.equal(res.statusCode, 200)
    })
    assert.ok(lines.some((l) => l.includes('ALERT api_version mismatch')), lines.join('\n'))
    assert.ok(!lines.some((l) => l.includes('ALERT livemode mismatch')), lines.join('\n'))
  })

  it('LM9: `fire` cu livemode live pe cheia de test (harness) → ignorat, nu procesat', async () => {
    scriptProfile({ id: 'u1' })
    const res = await fire('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }, { livemode: true })
    assert.deepEqual(parseBody(res), { received: true, ignored: 'livemode_mismatch' })
    assert.equal(profileUpdates().length, 0)
    assertNoEffects()
  })
})
