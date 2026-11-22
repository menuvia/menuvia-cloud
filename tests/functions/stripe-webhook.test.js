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
// Coloanele pe care handler-ul le FILTREAZĂ pe `profiles` (installTable aruncă pe
// orice altă coloană, ca PostgREST pe una necunoscută).
const PROFILE_COLUMNS = ['id', 'plan', 'stripe_customer_id', 'stripe_subscription_id']
function useProfiles(rows, opts = {}) {
  profiles = installTable('profiles', rows, {
    columns: PROFILE_COLUMNS,
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
//          subscription_started, ALERT cu ambele id-uri; ordinea pe fir (oglinda
//          SDK12): citiri, anulare, verificarea celui păstrat, facturile lui
//          deschise, factură, rambursare
//          [PICĂ: UPDATE necondiționat; holder tratat mereu ca încheiat;
//          verificarea de după anulare scoasă / mutată după rambursare;
//          verificarea încasării scoasă]
//   DUP2b  după anulare, updated/deleted ale dublurii → stale skip (fără
//          downgrade, fără email, atribuirea neatinsă); precondiția (finalizare
//          200, dublura `canceled` în Stripe) e VERIFICATĂ, payload-ul e starea
//          din Stripe  [PICĂ: finalizarea nu anulează — versiunea veche, cu
//          payload construit de mână, TRECEA]
//   DUP3   abonamentul din profil e ÎNCHEIAT (deleted pierdut) / necunoscut lui
//          Stripe → înlocuit prin CAS pe valoarea veche, zero anulare, fără ALERT;
//          și un holder încheiat de plan MENUVIA (runda 3)
//          [PICĂ: holder tratat mereu ca viu; condiția „facturabil” scoasă din
//          anularea deținătorului — înainte TOATĂ suita verde]
//   DUP3b  holder Menuvia facturabil dar neviu (unpaid / incomplete) + abonament
//          nou VIU → holder ANULAT cu urma dublurii ÎNAINTEA CAS-ului, zero
//          rambursare; plata lui ulterioară → rambursată, fără comision;
//          updated/deleted lui nu ating profilul; anularea eșuată → ALERT, scris
//          oricum; livrare oprită între anulare și CAS + `deleted` lui între ele →
//          golit fără email/atribuire, reluarea scrie fără a doua anulare.
//          Ambele stări terminale ale DELETE-ului pe un `incomplete` (`w.cancelTo`:
//          `canceled` / `incomplete_expired`); verificarea încasării DUPĂ CAS.
//          REZIDUURI înghețate: holder străin; abonamentul nou doar `incomplete`
//          [PICĂ: fără anulare (codul de dinainte); și pe unul străin; și cu cel
//          nou neviu; anularea eșuată aruncă; anularea după CAS; fără urmă;
//          urma recunoscută doar pe `canceled` (de două ori, independent);
//          verificarea încasării înaintea CAS-ului]
//   DUP4   relivrarea aceluiași abonament → idempotent, zero anulare/rambursare
//   DUP5   CONCURENȚĂ: două finalizări în paralel pe profil gol → exact una
//          scrisă, cealaltă anulată + rambursată
//          [PICĂ: UPDATE necondiționat; citire-apoi-scriere]
//   DUP6   anulare reușită + rambursare eșuată → 500; reluarea rambursează FĂRĂ
//          a doua anulare  [PICĂ: fără urma de anulare la reluare]
//   DUP7   dublură în trial, factură de 0 → anulare, zero rambursare
//          [PICĂ: fără verificarea `amount_paid`]
//   DUP8   reluare după ce rambursarea există deja (cheia de 24 h expirată) →
//          zero rambursare nouă; o livrare NOUĂ cu urma deja pusă nu plătește
//          reverificarea celui păstrat  [PICĂ: fără refunds.list înainte;
//          reverificarea pe orice livrare cu urmă, nu doar pe reprocesare]
//   DUP8b  o rambursare anterioară EȘUATĂ nu contează → rambursare integrală,
//          cu cheia DERIVATĂ `…_retry1`  [PICĂ: rambursările eșuate/anulate
//          numărate ca făcute; reîncercarea pe cheia veche]
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
//   DUP17  cont inexistent → 200, nimic anulat; evenimentul a ajuns la
//          PROCESARE: rând `completed` cu userul, abonamentul citit, revendicarea
//          încercată, profilul inexistent citit  [PICĂ: `break` imediat după
//          userId; `no_profile` fără finalizarea rândului — ambele TRECEAU pe
//          versiunea veche, „200 + niciun efect”]
//   DUP18  profilul se eliberează / primește chiar acest abonament între
//          UPDATE-ul ratat și citire → reîncercare, scris  [PICĂ: `continue`
//          înlocuit cu „stale” — dublura rămânea vie, neurmărită, `completed`]
//   DUP19  profilul se schimbă la fiecare încercare → 500 după CLAIM_ATTEMPTS
//          [PICĂ: epuizarea buclei întoarce „written”]
//   DUP20  decontare întârziată: la finalizare factura e open → pending_payment;
//          banii sosiți după anulare → invoice.paid îi rambursează, fără comision
//          și fără lifecycle  [PICĂ: fără garda din invoice.paid; garda fără
//          `break` (cade în comision); open raportat nothing_paid]
//   DUP21  invoice.paid al dublurii EȘUAT prima dată (citirea din gardă pică,
//          500), apoi anulare + charge.refunded, apoi RELIVRAT cu același id →
//          redeschis, garda de dublură: fără comision, fără a doua rambursare
//          [PICĂ: fără garda din invoice.paid; garda fără `break`; reopen-ul
//          dezactivat — versiunea veche livra evenimentul abia acum și TRECEA]
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
//          pozitiv (abonament străin dublurii → scris, citit de 2 ori: garda +
//          verificarea de după scriere); citire eșuată → 500
//          [PICĂ: fără garda pe profil gol; garda pe payload (fără citire)]
//   DUP26  deleted al dublurii pe profil gol → fără al doilea email, fără
//          atribuire, fără apel Stripe, dar PROCESAT (rând `completed`, profil
//          citit, decizia logată); profilul care o ține TRANZITORIU → golit
//          CONDIȚIONAT, tot fără email și fără atribuire (runda 2); golirea pică →
//          500, relivrarea golește; profilul pe alt abonament → stale
//          [PICĂ: fără garda; garda doar pe profil gol (codul rundei 1: atribuirea
//          `canceled`, terminală); golire necondiționată; eroarea golirii
//          înghițită; skip-ul fără finalizarea rândului — TRECEA pe versiunea veche]
//   DUP27  updated pe profil GOL, dublura anulată ÎNTRE garda dinaintea scrierii
//          și scriere → verificarea de după scriere revine CONDIȚIONAT (doar
//          rândul care ține încă dublura); citire eșuată după scriere → 500, iar
//          REPROCESAREA reface verificarea; calea obișnuită = zero citiri;
//          REVENIREA pică (blip DB) → 500 + rând `failed`, relivrarea revine;
//          `deleted`-ul dublurii procesat între scriere și verificare → revenirea
//          atinge 0 rânduri, nimic rescris
//          [PICĂ: fără verificarea de după scriere; fără `|| reprocessing`;
//          revenire necondiționată; verificare pe orice livrare; eroarea
//          revenirii înghițită (`completed` pe un abonament anulat)]
//   DUP28  profilul se golește / e înlocuit între citirea celui păstrat (viu) și
//          anulare → re-validarea reia revendicarea: scris / dublură față de noul
//          deținător  [PICĂ: fără re-validare; profil schimbat tratat „stale”]
//   DUP29  cel păstrat se încheie în fereastra re-validare → anulare: dublura
//          anulată + rambursată, ALERT MANUAL (user, ambele id-uri, ce ține
//          profilul, starea din Stripe), verificarea ÎNAINTEA rambursării;
//          control pozitiv fără ALERT; verificarea NU aruncă (citirea celui
//          păstrat / re-citirea profilului pică → ALERT cu motivul, 200, o
//          rambursare); jumătatea de PROFIL singură (profil golit, păstrat viu);
//          livrarea oprită ÎNTRE anulare și verificare (răspunsul DELETE pierdut)
//          → reverificare la REPROCESARE, ALERT la reluare, control pozitiv fără
//          alarmă falsă  [PICĂ: fără verificare; verificare doar pe profil;
//          verificare după rambursare; re-citirea profilului neîmpachetată;
//          eroarea Stripe aruncă; fără `held === kept`; fără reverificarea la
//          reluare; `reprocessing` netransmis]
//   DUP30  rambursare născută `pending` ȘI `requires_action` → ALERT pending, nu
//          „refunded”; invoice.paid relivrat cât e în curs → nicio rambursare
//          nouă, ALERT pending; eșec ulterior REÎNCERCABIL → charge.refund.updated
//          reîncearcă cu cheia `…_retry1` (factura recitită, lista consultată);
//          relivrarea eșecului → nimic nou; răspunsul pierdut la creare (rambursarea
//          `pending` există la Stripe) → reluarea dă `refund_pending` + ALERT, nu
//          „already_refunded” tăcut  [PICĂ: reîncercarea pe cheia veche; pending
//          raportat refunded; fără ramura charge.refund.updated; rambursări moarte
//          numărate ca făcute; `requires_action` la creare ne-pending; pending
//          necontat ca rambursat; acoperit-în-curs = already_refunded]
//   DUP31  charge.refund.updated străin / încă viu (succeeded, pending,
//          requires_action) → zero apeluri; plafonul de
//          DUPLICATE_REFUND_MAX_ATTEMPTS rambursări reîncercabile → MANUAL;
//          `charge_disputed` și `charge_expired_for_refund` → MANUAL (fără buclă de
//          500); metadata stricată pe FIECARE jumătate → 500 fără cereri; factura
//          nu mai e rambursabilă (open / fără bani) → verificare MANUALĂ;
//          rambursare moartă din prima la finalizare → 500, reluarea pe cheia
//          următoare  [PICĂ: fără verificarea „a noastră”; fără verificarea
//          stării; fără plafon; fiecare cod permanent scos SEPARAT; moartă =
//          refunded; fără validarea facturii / a abonamentului din metadata; fără
//          ALERT-ul „nu mai e rambursabilă”]
//   DUP32  rambursarea dublurii ANULATĂ de un om (Dashboard) sau eșuată pe un
//          motiv pentru care Stripe cere altă cale (merchant_request,
//          expired_or_canceled_card, lost_or_stolen_card,
//          charge_for_pending_refund_disputed, motiv necunoscut) → zero cereri
//          Stripe, ALERT MANUAL; invoice.paid / finalizarea relivrate nu o refac;
//          control POZITIV: unknown / declined / insufficient_funds / fără motiv →
//          `…_retry1`  [PICĂ: `canceled` reîncercat (codul de dinainte); orice
//          `failed` reîncercat; fără ramura finală în handler; fără oglinda din
//          refundDuplicateInvoice; `canceled` ignorat; lista reîncercabilă goală;
//          fără motiv = final]
//   Runda 2 CodeRabbit pe #386:
//   DUP33  anularea dublurii oprește implicit încasarea pe facturile clientului →
//          o factură `open` a celui PĂSTRAT cu `auto_advance: false` → ALERT
//          COLLECTION (factura, suma), nimic schimbat automat; control POZITIV (a
//          dublurii oprită, a celui păstrat pornită → fără ALERT); citire eșuată /
//          listă trunchiată → ALERT, 200; livrare oprită după anulare → reluarea
//          verifică; `collection=CHECK` pe linia de rezultat  [PICĂ: fără
//          verificare acum / la reluare; auto_advance ignorat; orice factură
//          deschisă = oprită; citirea aruncă; has_more ignorat; `return true` pe
//          citirea eșuată / pe lista trunchiată]
//   DUP34  updated pe abonament VALID, verificarea de după scriere pică → reluarea
//          emite EXACT un plan_changed pentru tranziția ORIGINALĂ (purtată în
//          payload-ul rândului), și peste un al doilea eșec (verificare / citirea
//          profilului); control pozitiv  [PICĂ: `from` = planul profilului; reopen
//          fără `payload`; eșecul nu persistă tranziția]
//   DUP35  profilul se golește CÂT verificarea citește pe cel păstrat din Stripe →
//          ALERT MANUAL  [PICĂ: profilul citit înaintea Stripe]
//   DUP36  eroare SALVATĂ de Stripe pe cheia rambursării (500 reluat) → reluarea:
//          refund=manual + ALERT cu factura, abonamentul, cheia; 200; nicio
//          rambursare, nicio cheie nouă — la reîncercare și la finalizare
//          [PICĂ: fără detecția replay-ului; ALERT fără cheie]
//   Runda 3 pe #386 (recenzia adversarială proprie, după runda 2 CodeRabbit):
//   DUP37  updated vechi (instantaneu viu, plan plătit) relivrat după deleted-ul
//          LEGITIM (fără urmă) → profilul gol rămâne gol, fără scriere, fără
//          plan_changed (ambele stări terminale); încheiat între citire și scriere
//          / la reluare → revenire condiționată; deleted-ul sosit după face el
//          emailul + atribuirea; control pozitiv (viu → revendicat)
//          [PICĂ: fără skip înaintea scrierii; fără revenire după; revenire doar
//          pe profil gol; ambele]
//   Runda 3 CodeRabbit pe #386:
//   DUP37 (b2) updated oprit după citire, deleted legitim pe profilul gol,
//          updated reluat → un singur subscription_cancelled, fără plan_changed
//          [PICĂ: fără revenirea pe abonamentul încheiat — și cu (b) dezactivat]
//   DUP38  deținătorul neplătit își plătește factura între citire și CAS →
//          reconcilierea de după CAS o rambursează (cheia dublurii; invoice.paid
//          ulterior = already_refunded; și după calea obișnuită, cu comision);
//          reconcilierea eșuată → ALERT REFUND CHECK, 200
//          [PICĂ: fără reconciliere; reconcilierea care aruncă]
//   DUP3/DUP3b (extinse) reluarea unui CAS eșuat după anulare → verificarea
//          încasării + reconcilierea rulează pe urma `kept=<nou>;replaced=…`;
//          nimic pe un deținător neanulat de noi / anulat pentru altul (`kept=sub_C`);
//          reconcilierea DUPĂ CAS  [PICĂ: fără reluarea pe urmă; urma fără
//          verificarea `kept`; orice deținător încheiat = anulat de noi; starea din
//          urmă ignorată; reconcilierea înaintea CAS-ului; fără reconciliere]
//          Ordinea REALISTĂ: `deleted`-ul celui vechi golește profilul înaintea
//          reluării (sau între anulare și CAS, în aceeași livrare) → `deleted` face
//          verificările EXACT o dată (factura plătită în fereastră → rambursată),
//          reluarea / iterația următoare nu le repetă; DUP26: nimic pe golirea unei
//          dubluri și nimic pe profil deja gol  [PICĂ: fără verificările în
//          deleted; urma fără `replaced=` acceptată; fără condiția golirii;
//          verificările purtate între iterații]
//   DUP33 (c2) facturi oprite pe prima pagină + has_more → ALERT-ul le numește ȘI
//          spune trunchierea  [PICĂ: trunchierea doar fără facturi oprite]
describe('stripe-webhook: abonament unic la finalizare (DUP)', () => {
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)))
  const MARKER = 'menuvia:duplicate_subscription'
  const LIVE = ['active', 'trialing', 'past_due']

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
  // aruncă O DATĂ eroarea dată pe operația k, ÎNAINTEA efectului; `cancelAfter`
  // / `refundAfter` aruncă DUPĂ ce scrierea s-a aplicat la Stripe (răspunsul
  // pierdut: timeout după ce DELETE-ul / rambursarea au avut loc). Rambursările
  // modelează și Idempotency-Key ca la Stripe: aceeași cheie cu aceiași parametri întoarce
  // RĂSPUNSUL ORIGINAL (chiar dacă rambursarea a eșuat între timp), cu alți
  // parametri aruncă `idempotency_error`. `refundStatus` = starea cu care se
  // naște următoarea rambursare (implicit `succeeded`; o coadă se consumă pe rând).
  // `afterRetrieve[id]` / `beforeCancel[id]` (o singură dată) = o scriere
  // concurentă comisă imediat după citirea / înaintea anulării acelui abonament.
  // Anularea modelează implicitul Stripe (API reference, „Cancel a
  // subscription”): încasarea automată se OPREȘTE pe toate facturile finalizate
  // ale clientului (lumea are un singur client) → `auto_advance: false` pe orice
  // factură `open`. `failNext.refundSaved` = eroarea primei cereri cu o cheie
  // NOUĂ e SALVATĂ pe cheie (ca un 500 la Stripe): aceeași cheie o întoarce din
  // nou, cu antetul `idempotent-replayed: true`, fără să creeze nimic.
  function stripeWorld({ subs = {}, invoices = {}, refunds = {} } = {}) {
    const w = {
      subs: clone(subs), invoices: clone(invoices), refunds: clone(refunds), failNext: {}, gate: null,
      idem: {}, refundStatus: [], afterRetrieve: {}, beforeCancel: {}, cancelTo: () => 'canceled',
    }
    const failOnce = (k) => {
      const e = w.failNext[k]
      if (e) { delete w.failNext[k]; throw e }
    }
    const notFound = (what, id) => stripeErr(`No such ${what}: '${id}'`, { code: 'resource_missing', statusCode: 404 })
    state.stripeImpls['subscriptions.retrieve'] = async (id) => {
      if (w.gate) await w.gate(id)
      failOnce(`retrieve:${id}`)
      if (!w.subs[id]) throw notFound('subscription', id)
      const out = clone({ id, ...w.subs[id] })
      const after = w.afterRetrieve[id]
      delete w.afterRetrieve[id]
      if (after) after()
      return out
    }
    state.stripeImpls['subscriptions.cancel'] = async (id, params) => {
      const before = w.beforeCancel[id]
      delete w.beforeCancel[id]
      if (before) before()
      failOnce('cancel')
      const s = w.subs[id]
      if (!s) throw notFound('subscription', id)
      // Un abonament deja încheiat nu se mai anulează: Stripe refuză DELETE-ul
      // (codul exact nu se asertează), deci fake-ul nu are voie să-i rescrie
      // istoria (urma, starea). Runda 3 pe #386 (recenzia proprie).
      if (s.status === 'canceled' || s.status === 'incomplete_expired') {
        throw stripeErr(`Subscription ${id} is already ${s.status}`, { type: 'StripeInvalidRequestError', statusCode: 400 })
      }
      // Starea rezultată: `canceled` (API reference), dar pentru un `incomplete`
      // ea nu se poate verifica offline — `w.cancelTo` o poate face
      // `incomplete_expired`, ca gărzile să fie exersate pe AMBELE stări terminale.
      s.status = w.cancelTo(s)
      s.cancellation_details = {
        comment: (params && params.cancellation_details && params.cancellation_details.comment) || null,
        feedback: null,
        reason: 'cancellation_requested',
      }
      for (const inv of Object.values(w.invoices)) if (inv.status === 'open') inv.auto_advance = false
      failOnce('cancelAfter')
      return clone({ id, ...s })
    }
    state.stripeImpls['invoices.retrieve'] = async (id) => {
      if (!w.invoices[id]) throw notFound('invoice', id)
      return clone({ id, ...w.invoices[id] })
    }
    state.stripeImpls['invoices.list'] = async (params) => {
      failOnce('invoicesList')
      const data = Object.entries(w.invoices)
        .filter(([, i]) => (!params.subscription || i.subscription === params.subscription) && (!params.status || i.status === params.status))
        .map(([id, i]) => clone({ id, ...i }))
      return { object: 'list', has_more: false, data }
    }
    const paidOn = (key) => {
      const inv = Object.values(w.invoices).find((i) => i.payment_intent === key || i.charge === key ||
        ((i.payments && i.payments.data) || []).some((p) => p.payment && p.payment.payment_intent === key))
      return inv ? inv.amount_paid : 0
    }
    state.stripeImpls['refunds.list'] = async (params) => ({
      object: 'list', has_more: false, data: clone(w.refunds[params.payment_intent || params.charge] || []),
    })
    state.stripeImpls['refunds.create'] = async (params, opts) => {
      failOnce('refund')
      const idemKey = opts && opts.idempotencyKey
      if (idemKey && w.idem[idemKey]) {
        if (JSON.stringify(w.idem[idemKey].params) !== JSON.stringify(params)) {
          throw stripeErr('Keys for idempotent requests can only be used with the same parameters.', { type: 'StripeIdempotencyError', statusCode: 400 })
        }
        const saved = w.idem[idemKey].error
        if (saved) throw stripeErr(saved.message, { ...saved.props, headers: { 'idempotent-replayed': 'true' } })
        return clone(w.idem[idemKey].response)
      }
      const savedErr = w.failNext.refundSaved
      if (savedErr) {
        delete w.failNext.refundSaved
        if (idemKey) w.idem[idemKey] = { params: clone(params), error: savedErr }
        throw stripeErr(savedErr.message, savedErr.props)
      }
      const key = params.payment_intent || params.charge
      const list = (w.refunds[key] = w.refunds[key] || [])
      // Ca pe Stripe: o rambursare eșuată/anulată nu consumă din suma plății.
      const left = paidOn(key) - list
        .filter((r) => r.status !== 'failed' && r.status !== 'canceled')
        .reduce((sum, r) => sum + r.amount, 0)
      if (left <= 0) throw stripeErr('Charge has already been refunded.', { code: 'charge_already_refunded', statusCode: 400 })
      const status = w.refundStatus.length ? w.refundStatus.shift() : 'succeeded'
      const r = {
        id: `re_${key}_${list.length + 1}`, object: 'refund', amount: left, status,
        payment_intent: params.payment_intent || null, metadata: clone(params.metadata || {}),
      }
      list.push(r)
      if (idemKey) w.idem[idemKey] = { params: clone(params), response: clone(r) }
      failOnce('refundAfter')
      return clone(r)
    }
    // Rambursarea `id` își schimbă starea (ex. eșuează după creare) și întoarce
    // obiectul, ca payload de `charge.refund.updated`.
    w.setRefund = (id, patch) => {
      const r = Object.values(w.refunds).flat().find((x) => x.id === id)
      if (!r) throw new Error(`stripeWorld: rambursarea ${id} nu există`)
      Object.assign(r, patch)
      return clone(r)
    }
    return w
  }

  // dedup-ul stripe_events cu stare: aceeași cheie a doua oară → 23505, iar
  // reopen-ul reușește doar dacă rândul NU e 'completed' (exact handler-ul).
  // RETURNING-ul reopen-ului întoarce DOAR coloanele din `.select(...)`, ca
  // PostgREST: un reopen care nu mai cere `payload` pierde tranziția purtată.
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
        const cols = String(opArg(ops, 'select') || '').split(',').map((c) => c.trim()).filter(Boolean)
        const full = { status: row.status, payload: row.payload === undefined ? null : clone(row.payload) }
        for (const c of cols) if (!(c in full)) throw new Error(`stripeEventsTable: coloana '${c}' nu e modelată`)
        return { data: [Object.fromEntries(cols.map((c) => [c, full[c]]))], error: null }
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
  // `lines` = console.error (alarmele), `logs` = console.log (deciziile de
  // decontare), `warns` = console.warn (ex. profilul inexistent).
  function withLogs(fn) {
    const orig = { error: console.error, log: console.log, warn: console.warn }
    const lines = []
    const logs = []
    const warns = []
    console.error = (...a) => { lines.push(a.join(' ')) }
    console.log = (...a) => { logs.push(a.join(' ')) }
    console.warn = (...a) => { warns.push(a.join(' ')) }
    return Promise.resolve().then(fn).finally(() => Object.assign(console, orig)).then((out) => ({ out, lines, logs, warns }))
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
    // Ordinea pe fir (oglinda SDK12 din tests/stripe-contract, care rulează doar
    // în CI): citirea dublurii, a celui păstrat, anularea, verificarea celui
    // păstrat după anulare (K2), facturile lui deschise (încasarea oprită de
    // anulare, runda 2), apoi factura și rambursarea.
    assert.deepEqual(state.stripeCalls.filter((c) => c.name !== 'webhooks.constructEvent')
      .map((c) => `${c.name}${typeof c.args[0] === 'string' ? `:${c.args[0]}` : ''}`), [
      'subscriptions.retrieve:sub_B', 'subscriptions.retrieve:sub_A', 'subscriptions.cancel:sub_B',
      'subscriptions.retrieve:sub_A', 'invoices.list', 'invoices.retrieve:in_B', 'refunds.list', 'refunds.create',
    ])
    assert.deepEqual(stripeCallsFor('invoices.list')[0].args, [{ subscription: 'sub_A', status: 'open', limit: 100 }])
    assert.ok(!lines.some((l) => l.includes('ALERT duplicate cancel MANUAL')), 'cel păstrat e viu și ținut')
  })

  it('DUP2b: după anulare, updated/deleted ale dublurii → stale skip (fără downgrade, fără email, atribuirea neatinsă)', async () => {
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    // Precondiția se VERIFICĂ, nu se presupune (recenzie pe #386, K5): finalizarea
    // a reușit și dublura e anulată în Stripe ÎNAINTE de evenimentele ei; payload-ul
    // lor e chiar starea din Stripe (cu urma), nu un obiect construit de mână.
    const fin = (await withLogs(() => checkout('sub_B'))).out
    assert.equal(fin.statusCode, 200, fin.body)
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.ok(w.subs.sub_B.cancellation_details.comment.startsWith(MARKER))
    const dupEvent = { ...clone(w.subs.sub_B), id: 'sub_B', customer: 'cus_1' }
    for (const type of ['customer.subscription.updated', 'customer.subscription.deleted']) {
      const res = await fire(type, dupEvent, { eventId: `evt_${type}` })
      assert.equal(res.statusCode, 200, `${type}: ${res.body}`)
    }
    assert.deepEqual(profileUpdates(), [])
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'growth'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    assert.equal(lifecycleInserts().length, 0)
  })

  // Un holder înlocuit FĂRĂ anulare (CAS, zero anulare): încheiat de-a binelea
  // (DUP3) sau, în DUP3b, cele două cazuri rămase REZIDUALE (deținător străin;
  // abonamentul nou doar `incomplete`). Un test nu are voie să prezinte un
  // rezidual consemnat drept caz rezolvat.
  async function assertHolderReplaced(holders, { newSub = paidSub('in_B') } = {}) {
    for (const holder of holders) {
      resetMocks(); setEnv()
      useProfiles([{ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_A' }])
      stripeWorld({
        subs: { ...(holder ? { sub_A: holder } : {}), sub_B: newSub },
        invoices: { in_B: paidInvoice('pi_B') },
      })
      const { out: res, lines } = await withLogs(() => checkout('sub_B'))
      const label = holder ? `${holder.status}${holder.items ? ' (Menuvia)' : ''}` : 'resource_missing'
      assert.equal(res.statusCode, 200, `${label}: ${res.body}`)
      assert.ok(!lines.some((l) => l.includes('ALERT replaced subscription')), `${label}: ${lines.join('\n')}`)
      const plan = LIVE.includes(newSub.status) ? 'growth' : 'free'
      assert.deepEqual(profileUpdates(), [{ plan, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_B' }], label)
      // A doua scriere e compare-and-swap pe valoarea VECHE, nu necondiționată.
      const cas = state.fromCalls.filter((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))[1]
      assert.ok(cas.ops.some((o) => o.m === 'eq' && o.args[0] === 'stripe_subscription_id' && o.args[1] === 'sub_A'), label)
      assert.equal(started().length, 1, label)
      assert.equal(cancels().length, 0, label)
      assert.equal(refundsCreated().length, 0, label)
      // Nimic anulat DE NOI pentru sub_B → nicio verificare de după anulare
      // (încasarea celui nou, factura celui vechi), nici pe o reluare.
      assert.equal(stripeCallsFor('invoices.list').length, 0, `${label}: nimic anulat → fără verificarea încasării`)
      assert.equal(stripeCallsFor('invoices.retrieve').length, 0, `${label}: nimic anulat → fără reconcilierea facturii`)
    }
  }

  it('DUP3: abonamentul din profil e ÎNCHEIAT (deleted pierdut) sau necunoscut lui Stripe → înlocuit prin CAS, zero anulare', async () => {
    await assertHolderReplaced([{ status: 'canceled' }, { status: 'incomplete_expired' }, null])
    // Și unul de plan MENUVIA (metadata + price): fără el, garda `isMenuviaPlan…`
    // scurt-circuita înaintea condiției „facturabil”, deci condiția era netestată
    // (runda 3: mutația care o scotea lăsa toată suita verde). Un încheiat nu se
    // anulează (Stripe ar refuza; ALERT de anulare MANUALĂ pe un abonament mort).
    await assertHolderReplaced([paidSub('in_A', { status: 'canceled' }), paidSub('in_A', { status: 'incomplete_expired' })])
    // Anulat de NOI, dar pentru ALT abonament (urma `kept=sub_C`) → nu e reluarea
    // înlocuirii lui sub_B: fără verificările de după anulare (runda 3 CodeRabbit).
    await assertHolderReplaced([paidSub('in_A', {
      status: 'canceled', cancellation_details: { comment: `${MARKER};kept=sub_C;replaced=unpaid` },
    })])
  })

  it('DUP3b: holder Menuvia FACTURABIL dar neviu (unpaid / incomplete) + abonament nou VIU → holder ANULAT cu urma dublurii ÎNAINTEA înlocuirii; plata lui ulterioară se rambursează; anulare eșuată nu blochează; reziduuri: holder străin / nou doar incomplete', async () => {
    // Nu e un caz „încheiat”: `unpaid` are factura deschisă și se poate plăti,
    // `incomplete` își poate confirma prima plată ~23 h (recenzie CodeRabbit pe
    // #386, runda 2: înainte, rămânea neurmărit și putea încasa lângă cel nou).
    // Starea în care DELETE-ul lasă un `incomplete` nu se poate verifica offline
    // (`canceled` după API reference; `incomplete_expired` e cealaltă stare
    // terminală) → ambele: gărzile dublurii trebuie să-și recunoască anularea în
    // oricare (runda 3; cu `status === 'canceled'` strict, varianta
    // `incomplete_expired` rambursa nimic și scria comision).
    for (const [status, endAs] of [['unpaid', 'canceled'], ['incomplete', 'canceled'], ['incomplete', 'incomplete_expired']]) {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      const t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_A' }])
      const w = stripeWorld({
        subs: { sub_A: paidSub('in_A', { status }), sub_B: paidSub('in_B') },
        invoices: {
          in_A: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_A', subscription: 'sub_A' },
          in_B: paidInvoice('pi_B'),
        },
      })
      w.cancelTo = () => endAs
      let heldAtCancel = null
      w.beforeCancel.sub_A = () => { heldAtCancel = t.rows[0].stripe_subscription_id }
      // Verificarea încasării vine DUPĂ CAS (runda 3): cât profilul ține încă
      // abonamentul anulat, garda din invoice.paid nu-l citește, deci niciun apel
      // Stripe nu are voie să lărgească fereastra dintre anulare și CAS.
      let heldAtList = null
      const listImpl = state.stripeImpls['invoices.list']
      state.stripeImpls['invoices.list'] = async (...a) => { heldAtList = t.rows[0].stripe_subscription_id; return listImpl(...a) }
      // La fel reconcilierea facturii celui vechi (runda 3 CodeRabbit pe #386).
      let heldAtReconcile = null
      const retrieveImpl = state.stripeImpls['invoices.retrieve']
      state.stripeImpls['invoices.retrieve'] = async (...a) => { heldAtReconcile = heldAtReconcile || t.rows[0].stripe_subscription_id; return retrieveImpl(...a) }
      const label = `${status}→${endAs}`
      const r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'completed', label)
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'], label)
      assert.equal(started().length, 1, label)
      // Anularea: DOAR cel vechi, cu urma dublurii (kept = cel nou), fără factură
      // finală / prorată, ÎNAINTEA CAS-ului (profilul îl ținea încă).
      assert.deepEqual(cancels().map((c) => c.args), [['sub_A', {
        prorate: false, invoice_now: false,
        cancellation_details: { comment: `${MARKER};kept=sub_B;replaced=${status}` },
      }]], label)
      assert.equal(heldAtCancel, 'sub_A', `${label}: anularea vine înaintea înlocuirii`)
      assert.equal(heldAtList, 'sub_B', `${label}: verificarea încasării vine după CAS`)
      assert.equal(heldAtReconcile, 'sub_B', `${label}: reconcilierea facturii vine după CAS`)
      assert.equal(w.subs.sub_A.status, endAs, label)
      assert.equal(w.subs.sub_B.status, 'active', label)
      assert.equal(refundsCreated().length, 0, `${label}: factura lui e neplătită, nimic de rambursat`)
      assert.ok(r.lines.some((l) => l.includes('ALERT replaced subscription user=u1 canceled=sub_A') && l.includes(status) &&
        l.includes('kept=sub_B')), `${label}: ${r.lines.join('\n')}`)
      assert.deepEqual(stripeCallsFor('invoices.list').map((c) => c.args[0].subscription), ['sub_B'], `${label}: încasarea celui nou verificată`)
      // Factura văzută la decizie, reconciliată după CAS: încă NEPLĂTITĂ → nimic
      // rambursat (runda 3 CodeRabbit pe #386; plata ei, mai jos, o ia invoice.paid).
      assert.deepEqual(stripeCallsFor('invoices.retrieve').map((c) => c.args[0]), ['in_A'], `${label}: factura celui vechi reconciliată`)
      assert.ok(r.logs.some((l) => l.includes('replaced subscription sub_A reconciled: refund=pending_payment invoice=in_A')), `${label}: ${r.logs.join('\n')}`)
      assert.ok(r.logs.some((l) => l.includes('înlocuiește abonamentul') && l.includes('sub_A, anulat')), `${label}: ${r.logs.join('\n')}`)

      // Factura deschisă a celui vechi se plătește DUPĂ anulare → garda dublurii
      // din invoice.paid o rambursează, fără comision.
      Object.assign(w.invoices.in_A, { status: 'paid', amount_paid: 24900, amount_due: 24900 })
      const paid = await withLogs(() => invoicePaid('in_A', 'sub_A'))
      assert.equal(paid.out.statusCode, 200, `${label}: ${paid.out.body}`)
      assert.deepEqual(refundsCreated().map((c) => [c.args[0].payment_intent, c.args[1].idempotencyKey]), [['pi_A', 'dupsub_refund_in_A']], label)
      assert.equal(commissions().length, 0, label)
      // updated/deleted ale celui vechi nu mai ating profilul.
      for (const type of ['customer.subscription.updated', 'customer.subscription.deleted']) {
        const ev = await fire(type, { ...clone(w.subs.sub_A), id: 'sub_A', customer: 'cus_1' }, { eventId: `evt_${type}_${status}_${endAs}` })
        assert.equal(ev.statusCode, 200, `${label} ${type}: ${ev.body}`)
      }
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'], label)
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0, label)
    }

    // Anularea pică → ALERT pentru anulare MANUALĂ, iar abonamentul nou (plătit)
    // se înregistrează oricum: un 500 l-ar ține fără plan zile întregi.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_A' }])
    let w = stripeWorld({ subs: { sub_A: paidSub('in_A', { status: 'unpaid' }), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.failNext.cancel = stripeErr('An error occurred with our connection to Stripe.', { type: 'StripeConnectionError' })
    let r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])
    assert.equal(w.subs.sub_A.status, 'unpaid')
    assert.ok(r.lines.some((l) => l.includes('ALERT replaced subscription NOT canceled user=u1 subscription=sub_A') &&
      l.includes('MANUAL')), r.lines.join('\n'))
    assert.equal(stripeCallsFor('invoices.list').length, 0, 'nimic anulat → nimic de verificat')

    // Livrarea se oprește ÎNTRE anulare și CAS (500); între timp sosește
    // `deleted`-ul celui vechi (cu urma), cât profilul încă îl ține → golit, FĂRĂ
    // email și FĂRĂ atribuirea `canceled` (terminală); reluarea înregistrează
    // abonamentul nou, fără a doua anulare. Și pe `incomplete` → `incomplete_expired`
    // (runda 3): cu garda pe `canceled` strict, `deleted`-ul lui trecea pe calea
    // obișnuită — atribuirea `canceled` (terminală) și emailul de anulare pentru
    // un client care tocmai a plătit abonamentul nou.
    // Ordinea REALISTĂ (runda 3 CodeRabbit pe #386): `deleted`-ul nostru sosește
    // în secunde, reluarea finalizării după backoff, pe profilul gol — deci
    // verificările de după anulare (încasarea celui nou, factura celui vechi)
    // le face `deleted`, EXACT o dată; reluarea nu le mai repetă. Varianta
    // `paid`: factura celui vechi plătită în fereastră și procesată pe calea
    // obișnuită → `deleted` o rambursează (cheia dublurii).
    for (const [status, endAs, inAPaid] of [['unpaid', 'canceled', false], ['incomplete', 'incomplete_expired', false], ['unpaid', 'canceled', true]]) {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      const t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_A' }])
      w = stripeWorld({
        subs: { sub_A: paidSub('in_A', { status }), sub_B: paidSub('in_B') },
        invoices: {
          in_A: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_A', subscription: 'sub_A' },
          in_B: paidInvoice('pi_B'),
        },
      })
      w.cancelTo = () => endAs
      w.beforeCancel.sub_A = () => { t.failNextUpdate = { code: 'XX000', message: 'blip' } }
      const label = `${status}→${endAs}${inAPaid ? ' (in_A plătită)' : ''}`
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 500, `${label}: ${r.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'failed', label)
      assert.deepEqual([row().stripe_subscription_id, w.subs.sub_A.status], ['sub_A', endAs], label)
      assert.equal(stripeCallsFor('invoices.list').length, 0, `${label}: fără CAS reușit, fără verificarea încasării`)
      assert.equal(stripeCallsFor('invoices.retrieve').length, 0, `${label}: fără CAS reușit, fără reconciliere`)
      if (inAPaid) Object.assign(w.invoices.in_A, { status: 'paid', amount_paid: 24900 })
      r = await withLogs(() => fire('customer.subscription.deleted', { ...clone(w.subs.sub_A), id: 'sub_A', customer: 'cus_1' }, { eventId: 'evt_del_A' }))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], label)
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0, label)
      assert.equal(lifecycleInserts().length, 0, label)
      assert.deepEqual(stripeCallsFor('invoices.list').map((c) => c.args[0].subscription), ['sub_B'], `${label}: deleted verifică încasarea celui nou`)
      assert.deepEqual(stripeCallsFor('invoices.retrieve').map((c) => c.args[0]), ['in_A'], `${label}: deleted reconciliază factura celui vechi`)
      assert.ok(r.logs.some((l) => l.includes(`replaced subscription sub_A reconciled: refund=${inAPaid ? 'refunded' : 'pending_payment'} invoice=in_A`)),
        `${label}: ${r.logs.join('\n')}`)
      assert.deepEqual(refundsCreated().map((c) => [c.args[0].payment_intent, c.args[1].idempotencyKey]),
        inAPaid ? [['pi_A', 'dupsub_refund_in_A']] : [], label)
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'], label)
      assert.equal(cancels().length, 1, `${label}: anularea nu se repetă`)
      assert.equal(started().length, 1, label)
      assert.equal(stripeCallsFor('invoices.list').length, 1, `${label}: reluarea nu repetă verificarea încasării`)
      assert.equal(stripeCallsFor('invoices.retrieve').length, 1, `${label}: reluarea nu repetă reconcilierea`)
      assert.equal(refundsCreated().length, inAPaid ? 1 : 0, label)
    }

    // Aceeași ordine ÎN ACEEAȘI livrare: `deleted`-ul e procesat între anulare și
    // CAS → golește profilul și face verificările; CAS-ul atinge 0 rânduri, bucla
    // scrie pe profilul gol fără să le repete (nimic purtat între iterații).
    {
      resetMocks(); setEnv()
      stripeEventsTable()
      useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_A' }])
      w = stripeWorld({
        subs: { sub_A: paidSub('in_A', { status: 'unpaid' }), sub_B: paidSub('in_B') },
        invoices: {
          in_A: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_A', subscription: 'sub_A' },
          in_B: paidInvoice('pi_B'),
        },
      })
      const cancelImpl = state.stripeImpls['subscriptions.cancel']
      state.stripeImpls['subscriptions.cancel'] = async (...a) => {
        const out = await cancelImpl(...a)
        const del = await fire('customer.subscription.deleted', { ...clone(w.subs.sub_A), id: 'sub_A', customer: 'cus_1' }, { eventId: 'evt_del_A' })
        assert.equal(del.statusCode, 200, del.body)
        return out
      }
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, r.out.body)
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])
      assert.equal(cancels().length, 1)
      assert.equal(started().length, 1)
      assert.deepEqual(stripeCallsFor('invoices.list').map((c) => c.args[0].subscription), ['sub_B'], 'o singură verificare a încasării')
      assert.deepEqual(stripeCallsFor('invoices.retrieve').map((c) => c.args[0]), ['in_A'], 'o singură reconciliere')
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    }

    // Aceeași oprire ÎNTRE anulare și CAS, dar FĂRĂ `deleted` între ele (runda 3
    // CodeRabbit pe #386): profilul ține încă deținătorul, anulat de NOI pentru
    // sub_B (urma `kept=sub_B;replaced=…`) → reluarea nu-l mai anulează, dar
    // rulează verificările de după CAS: încasarea celui nou și factura celui vechi.
    for (const status of ['unpaid', 'incomplete']) {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      const t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_A' }])
      w = stripeWorld({
        subs: { sub_A: paidSub('in_A', { status }), sub_B: paidSub('in_B') },
        invoices: {
          in_A: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_A', subscription: 'sub_A' },
          in_B: paidInvoice('pi_B'),
        },
      })
      w.beforeCancel.sub_A = () => { t.failNextUpdate = { code: 'XX000', message: 'blip' } }
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 500, `${status}: ${r.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'failed', status)
      assert.deepEqual([row().stripe_subscription_id, w.subs.sub_A.status], ['sub_A', 'canceled'], status)
      assert.equal(stripeCallsFor('invoices.list').length, 0, `${status}: fără CAS reușit, fără verificări`)
      assert.equal(stripeCallsFor('invoices.retrieve').length, 0, status)
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, `${status}: ${r.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'completed', status)
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'], status)
      assert.equal(cancels().length, 1, `${status}: anularea nu se repetă`)
      assert.deepEqual(stripeCallsFor('invoices.list').map((c) => c.args[0].subscription), ['sub_B'], `${status}: încasarea celui nou verificată la reluare`)
      assert.deepEqual(stripeCallsFor('invoices.retrieve').map((c) => c.args[0]), ['in_A'], `${status}: factura celui vechi reconciliată la reluare`)
      assert.equal(refundsCreated().length, 0, `${status}: încă neplătită`)
      assert.ok(r.logs.some((l) => l.includes('înlocuiește abonamentul') && l.includes(`${status} sub_A, anulat`)), `${status}: ${r.logs.join('\n')}`)
      assert.equal(started().length, 1, status)
    }

    // REZIDUURI, înghețate ca atare: un holder STRĂIN (fără contul în metadata,
    // fără price Menuvia) nu se anulează niciodată; cu abonamentul NOU doar
    // `incomplete` (neviu) nici cel vechi nu se anulează — contul ar putea rămâne
    // fără niciun abonament.
    await assertHolderReplaced([{ status: 'unpaid' }, { status: 'incomplete' }])
    await assertHolderReplaced([paidSub('in_A', { status: 'unpaid' })], { newSub: paidSub('in_B', { status: 'incomplete' }) })
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
    // O livrare NOUĂ (nu o reprocesare) cu urma deja pusă nu plătește
    // reverificarea celui păstrat (R7): doar citirea dublurii.
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_B'])
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
    assert.ok(manual.lines.some((l) => l.includes('plătită în afara Stripe') && l.includes('rambursare MANUALĂ') && l.includes('in_B')),
      manual.lines.join('\n'))

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
    const events = stripeEventsTable()
    useProfiles([])
    stripeWorld({ subs: { sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    const { out: res, warns } = await withLogs(() => checkout('sub_B'))
    assert.equal(res.statusCode, 200, res.body)
    // Evenimentul a ajuns la PROCESARE, nu la un ignore timpuriu (recenzie pe
    // #386, K6): răspunsul simplu (nu `duplicate`/`ignored`), rândul de dedup
    // `completed`, abonamentul citit, revendicarea încercată și profilul
    // inexistent CITIT — „200 + niciun efect” trecea și cu un `break` imediat.
    assert.deepEqual(parseBody(res), { received: true })
    assert.equal(events.get('evt_sub_B').status, 'completed')
    assert.equal(events.get('evt_sub_B').user_id, 'u1')
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_B'])
    const profileOps = state.fromCalls.filter((c) => c.table === 'profiles')
    assert.ok(profileOps.some((c) => hasOp(c.ops, 'update') && opArg(c.ops, 'or')), 'revendicarea condiționată încercată')
    assert.ok(profileOps.some((c) => !hasOp(c.ops, 'update') && hasOp(c.ops, 'single') &&
      c.ops.some((o) => o.m === 'eq' && o.args[0] === 'id' && o.args[1] === 'u1')), 'profilul inexistent citit')
    assert.ok(warns.some((l) => l.includes('profil inexistent pentru user u1') && l.includes('sub_B')), warns.join('\n'))
    assert.equal(cancels().length, 0)
    assert.equal(started().length, 0)
    assert.equal(refundsCreated().length, 0)
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
    // Cheie NOUĂ (K3): cu `dupsub_refund_in_B`, Stripe ar întoarce în 24 h
    // răspunsul ORIGINAL — rambursarea moartă —, nu una nouă.
    assert.equal(refundsCreated()[0].args[1].idempotencyKey, 'dupsub_refund_in_B_retry1')
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

  it('DUP21: invoice.paid al dublurii EȘUAT prima dată (500), apoi anulare + charge.refunded, apoi RELIVRAT cu ACELAȘI id → redeschis, ajunge la garda de dublură: fără comision pe bani returnați, fără a doua rambursare', async () => {
    // Exersează exact redeschiderea unui eveniment `failed` (recenzie pe #386, K7):
    // prima livrare a lui evt_paid_in_B pică (citirea abonamentului în gardă),
    // iar RELIVRAREA aceluiași id trece prin reopen-ul din stripe_events.
    const events = stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })

    // 1) invoice.paid(in_B) sosește ÎNAINTEA finalizării; citirea dublurii pică
    //    → 500, rândul `failed`, fără comision și fără lifecycle.
    w.failNext['retrieve:sub_B'] = stripeErr('timeout', { type: 'StripeConnectionError' })
    const first = await withLogs(() => invoicePaid('in_B', 'sub_B', 'evt_paid_in_B'))
    assert.equal(first.out.statusCode, 500, first.out.body)
    assert.equal(events.get('evt_paid_in_B').status, 'failed')
    assert.equal(commissions().length, 0)
    assert.deepEqual(lifecycleInserts(), [])

    // 2) Finalizarea dublurii: anulare + rambursare.
    const fin = await withLogs(() => checkout('sub_B'))
    assert.equal(fin.out.statusCode, 200, fin.out.body)
    assert.equal(w.subs.sub_B.status, 'canceled')
    assert.equal(w.refunds.pi_B.length, 1)

    // 3) charge.refunded al rambursării noastre: clawback-ul nu găsește nimic de
    //    stornat (comisionul nu există) și nu consemnează nimic.
    const worldList = state.stripeImpls['refunds.list']
    state.stripeImpls['refunds.list'] = async (params) =>
      worldList(params.charge === 'ch_B' ? { payment_intent: 'pi_B' } : params)
    state.rpcHandlers.process_affiliate_refund = () => ({ data: { ok: true, clawed_back: 0 }, error: null })
    const refunded = await fire('charge.refunded', { id: 'ch_B', invoice: 'in_B', amount: 24900 }, { eventId: 'evt_ref_B' })
    assert.equal(refunded.statusCode, 200, refunded.body)
    assert.equal(rpcCallsFor('process_affiliate_refund').length, 1)

    // 4) Stripe RELIVREAZĂ evt_paid_in_B (rândul e `failed` → reopen).
    const retrievesBefore = stripeCallsFor('subscriptions.retrieve').length
    const late = await withLogs(() => invoicePaid('in_B', 'sub_B', 'evt_paid_in_B'))
    assert.equal(late.out.statusCode, 200, late.out.body)
    assert.deepEqual(parseBody(late.out), { received: true }, 'reprocesat, nu ignorat ca duplicat')
    assert.ok(late.logs.some((l) => l.includes('Reprocessing event evt_paid_in_B')), late.logs.join('\n'))
    assert.equal(events.get('evt_paid_in_B').status, 'completed')
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').slice(retrievesBefore).map((c) => c.args[0]), ['sub_B'],
      'garda de dublură a citit abonamentul')
    assert.ok(late.lines.some((l) => l.includes('ALERT invoice.paid pe abonamentul DUBLURĂ sub_B')), late.lines.join('\n'))
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
    // Două citiri: garda dinaintea scrierii + verificarea de după ea (K1, DUP27).
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_C', 'sub_C'])
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

  it('DUP26: customer.subscription.deleted al dublurii pe profil GOL (cel păstrat încheiat între timp) → fără al doilea email, fără atribuire; pe profilul care o ține TRANZITORIU → golit condiționat, tot fără email și fără atribuire; pe profilul cu alt abonament → neatins', async () => {
    const marked = {
      id: 'sub_B', customer: 'cus_1', status: 'canceled',
      cancellation_details: { comment: `${MARKER};kept=sub_A`, feedback: null, reason: 'cancellation_requested' },
    }
    // (a) Dublura, profil gol → sărit, fără nicio citire Stripe (urma e în payload).
    const events = stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    const skipped = await withLogs(() => fire('customer.subscription.deleted', marked, { eventId: 'evt_del_B' }))
    let res = skipped.out
    assert.equal(res.statusCode, 200, res.body)
    // A ajuns la PROCESARE (K6): rândul de dedup `completed` cu userul, profilul
    // citit pe customer, decizia logată — un ignore timpuriu (înaintea dedup-ului
    // sau a citirii profilului) dădea tot „200 + niciun efect”.
    assert.deepEqual(parseBody(res), { received: true })
    assert.equal(events.get('evt_del_B').status, 'completed')
    assert.equal(events.get('evt_del_B').user_id, 'u1')
    assert.ok(state.fromCalls.some((c) => c.table === 'profiles' && hasOp(c.ops, 'single') &&
      c.ops.some((o) => o.m === 'eq' && o.args[0] === 'stripe_customer_id' && o.args[1] === 'cus_1')), 'profilul citit')
    assert.ok(skipped.logs.some((l) => l.includes('Skip deleted pentru dublura anulată sub_B')), skipped.logs.join('\n'))
    assert.equal(lifecycleInserts().length, 0, 'fără subscription_cancelled pentru dublură')
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    assert.equal(profileUpdates().length, 0)
    assert.deepEqual(state.stripeCalls.map((c) => c.name).filter((n) => n !== 'webhooks.constructEvent'), [],
      'fără apel Stripe: urma vine din payload')

    // (a2) Deținătorul ÎNLOCUIT (urma `replaced=`), profil gol → la fel, fără
    //      niciun apel Stripe: verificările de după anulare rulează doar pe
    //      golirea REUȘITĂ (runda 3 CodeRabbit pe #386, DUP3b), deci un `deleted`
    //      pe un profil deja golit nu le repetă.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    res = (await withLogs(() => fire('customer.subscription.deleted', {
      ...marked, latest_invoice: 'in_B',
      cancellation_details: { ...marked.cancellation_details, comment: `${MARKER};kept=sub_A;replaced=unpaid` },
    }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(state.stripeCalls.map((c) => c.name).filter((n) => n !== 'webhooks.constructEvent'), [],
      'profil gol: fără verificările de după anulare')

    // (b) Control POZITIV: un abonament fără urma noastră, profil gol → ca înainte.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    res = (await withLogs(() => fire('customer.subscription.deleted', { id: 'sub_X', customer: 'cus_1', status: 'canceled' }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['subscription_cancelled'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 1)

    // (c) Profilul ține TRANZITORIU chiar dublura marcată (un `updated` întârziat
    //     a scris-o, DUP27; o înlocuire oprită între anulare și CAS, DUP3b) →
    //     golit CONDIȚIONAT (nu lasă un plan plătit pe un anulat), dar FĂRĂ email
    //     și FĂRĂ atribuirea `canceled` — terminală, ar opri comisioanele unui
    //     client care rămâne abonat pe cel păstrat (recenzie CodeRabbit pe #386,
    //     runda 2; înainte, garda era doar pe profilul gol).
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_B' }])
    const held = await withLogs(() => fire('customer.subscription.deleted', marked))
    res = held.out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0, 'atribuirea neatinsă')
    assert.equal(lifecycleInserts().length, 0, 'fără subscription_cancelled pentru dublură')
    const clear = state.fromCalls.find((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))
    assert.ok(clear.ops.some((o) => o.m === 'eq' && o.args[0] === 'stripe_subscription_id' && o.args[1] === 'sub_B'),
      'golirea atinge doar un rând care ține ÎNCĂ dublura')
    assert.ok(held.logs.some((l) => l.includes('Skip deleted pentru dublura anulată sub_B') && l.includes('golit')), held.logs.join('\n'))
    // O DUBLURĂ (urma fără `replaced=`) și-a făcut verificările la decontare
    // (settleDuplicateSubscription) → golirea ei nu cheamă Stripe; doar
    // deținătorul ÎNLOCUIT le are aici (runda 3 CodeRabbit pe #386, DUP3b).
    assert.deepEqual(state.stripeCalls.map((c) => c.name).filter((n) => n !== 'webhooks.constructEvent'), [],
      'dublura golită: fără verificările deținătorului înlocuit')

    // (e) Golirea pică (blip DB) → 500, rândul `failed`, nimic altceva; aceeași
    //     livrare relivrată golește — tot fără email și fără atribuire.
    resetMocks(); setEnv()
    const ev5 = stripeEventsTable()
    const t5 = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_B' }])
    t5.failNextUpdate = { code: 'XX000', message: 'blip' }
    res = (await withLogs(() => fire('customer.subscription.deleted', marked, { eventId: 'evt_del_B5' }))).out
    assert.equal(res.statusCode, 500, res.body)
    assert.equal(ev5.get('evt_del_B5').status, 'failed')
    assert.equal(row().stripe_subscription_id, 'sub_B')
    res = (await withLogs(() => fire('customer.subscription.deleted', marked, { eventId: 'evt_del_B5' }))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
    assert.equal(lifecycleInserts().length, 0)

    // (d) Profilul ține ALT abonament → stale skip, nimic scris (garda nu golește
    //     un profil pe baza unei dubluri care nu e a lui).
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    res = (await withLogs(() => fire('customer.subscription.deleted', marked))).out
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'growth'])
    assert.equal(profileUpdates().length, 0)
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 0)
  })

  it('DUP27: customer.subscription.updated pe profil GOL — dublura anulată ÎNTRE garda dinaintea scrierii și scriere → verificarea de DUPĂ scriere revine condiționat; citire eșuată → 500, iar reluarea reface verificarea', async () => {
    const snapshot = { id: 'sub_B', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_growth' } }] } }
    const cancelB = (w) => Object.assign(w.subs.sub_B, {
      status: 'canceled', cancellation_details: { comment: `${MARKER};kept=sub_A`, feedback: null, reason: 'cancellation_requested' },
    })

    // (a) Garda citește sub_B VIU; finalizarea îl anulează (iar `deleted`-ul lui,
    //     sosit pe profil gol, e sărit — DUP26) înaintea UPDATE-ului.
    stripeEventsTable()
    let t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    let w = stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    t.hooks.beforeUpdate = () => cancelB(w)
    let r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd_B' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(finalizeStatus(), 'completed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], 'fără plan plătit pe un abonament anulat')
    assert.deepEqual(profileUpdates(), [
      { plan: 'growth', stripe_subscription_id: 'sub_B' },
      { plan: 'free', stripe_subscription_id: null },
    ])
    const revert = state.fromCalls.filter((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))[1]
    assert.ok(revert.ops.some((o) => o.m === 'eq' && o.args[0] === 'stripe_subscription_id' && o.args[1] === 'sub_B'),
      'revenirea atinge doar un rând care ține ÎNCĂ dublura')
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_B', 'sub_B'])
    assert.equal(lifecycleInserts().length, 0, 'fără plan_changed')
    assert.ok(r.lines.some((l) => l.includes('ALERT updated pe dublura anulată sub_B') && l.includes('revenită')), r.lines.join('\n'))

    // (b) Între scriere și revenire profilul primește ALT abonament (CAS-ul unei
    //     finalizări noi, care înlocuiește dublura anulată) → revenirea nu-l atinge.
    resetMocks(); setEnv()
    t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    w = stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    t.hooks.beforeUpdate = () => cancelB(w)
    t.hooks.afterUpdate = (rows) => { Object.assign(rows[0], { plan: 'pro', stripe_subscription_id: 'sub_C' }) }
    r = await withLogs(() => fire('customer.subscription.updated', snapshot))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_C', 'pro'])
    assert.ok(r.lines.some((l) => l.includes('ALERT updated pe dublura anulată sub_B') && l.includes('neatinsă')), r.lines.join('\n'))

    // (c) Citirea de după scriere pică → 500 (profilul ține TRANZITORIU dublura).
    //     Stripe retrimite ACELAȘI eveniment: profilul nu mai e gol, dar
    //     reprocesarea reface verificarea și revine.
    resetMocks(); setEnv()
    const events = stripeEventsTable()
    t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    w = stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    t.hooks.beforeUpdate = () => {
      cancelB(w)
      w.failNext['retrieve:sub_B'] = stripeErr('timeout', { type: 'StripeConnectionError' })
    }
    r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd_B' }))
    assert.equal(r.out.statusCode, 500, r.out.body)
    assert.equal(events.get('evt_upd_B').status, 'failed')
    assert.equal(row().stripe_subscription_id, 'sub_B', 'tranzitoriu, până la reluare')
    // Tranziția e PURTATĂ spre reluare (DUP34) — și totuși, fiind o dublură
    // anulată, reluarea nu emite `plan_changed`.
    assert.deepEqual(events.get('evt_upd_B').payload.menuvia_pending_plan_changed, { from: 'free' })
    r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd_B' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(events.get('evt_upd_B').status, 'completed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(lifecycleInserts().length, 0)

    // (d) Control POZITIV + cost: prima livrare pe profilul care ține deja
    //     abonamentul → scris, ZERO citiri Stripe (calea obișnuită nu plătește nimic).
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_B' }])
    stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    r = await withLogs(() => fire('customer.subscription.updated', snapshot))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(stripeCallsFor('subscriptions.retrieve').length, 0)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])

    // (e) REVENIREA pică (blip DB pe UPDATE-ul de revenire, recenzie pe #386,
    //     R8) → 500, rândul `failed` (fără asta: `completed`, iar profilul ar
    //     rămâne pe un abonament anulat cu plan plătit, fără niciun eveniment
    //     care să-l mai corecteze); ACEEAȘI livrare relivrată revine.
    resetMocks(); setEnv()
    const ev5 = stripeEventsTable()
    t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    w = stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    t.hooks.beforeUpdate = () => cancelB(w)
    t.hooks.afterUpdate = () => { t.failNextUpdate = { code: 'XX000', message: 'blip' } }
    r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd_B' }))
    assert.equal(r.out.statusCode, 500, r.out.body)
    assert.equal(ev5.get('evt_upd_B').status, 'failed')
    assert.equal(row().stripe_subscription_id, 'sub_B', 'tranzitoriu, până la reluare')
    r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd_B' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(ev5.get('evt_upd_B').status, 'completed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(lifecycleInserts().length, 0)

    // (f) `deleted`-ul dublurii e procesat ÎNTRE scriere și verificare (profilul
    //     ținea dublura, deci a fost retrogradat normal) → revenirea găsește 0
    //     rânduri: nimic rescris, 200, ALERT-ul spune că dublura nu mai e în profil.
    resetMocks(); setEnv()
    t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    w = stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    t.hooks.beforeUpdate = () => cancelB(w)
    t.hooks.afterUpdate = (rows) => { Object.assign(rows[0], { plan: 'free', stripe_subscription_id: null }) }
    r = await withLogs(() => fire('customer.subscription.updated', snapshot))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(profileUpdates().length, 1, 'doar scrierea; revenirea n-a atins niciun rând')
    assert.equal(lifecycleInserts().length, 0)
    assert.ok(r.lines.some((l) => l.includes('ALERT updated pe dublura anulată sub_B') && l.includes('golit') &&
      l.includes('neatinsă')), r.lines.join('\n'))
  })

  it('DUP28: profilul se GOLEȘTE / e înlocuit între citirea celui păstrat (viu) și anulare → re-validarea reia revendicarea în loc să anuleze', async () => {
    // (a) `deleted` al celui păstrat golește profilul în fereastră → abonamentul
    //     nou se înregistrează, nimic anulat sau rambursat (înaintea re-validării,
    //     ambele evenimente se terminau cu profil gol și FĂRĂ abonament viu).
    let t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    let w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.afterRetrieve.sub_A = () => {
      w.subs.sub_A.status = 'canceled'
      Object.assign(t.rows[0], { plan: 'free', stripe_subscription_id: null })
    }
    let r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])
    assert.deepEqual(started().map((l) => l.event_data.subscription_id), ['sub_B'])
    assert.equal(cancels().length, 0)
    assert.equal(refundsCreated().length, 0)
    assert.equal(w.subs.sub_B.status, 'active')
    assert.ok(!r.lines.some((l) => l.includes('ALERT duplicate subscription')), r.lines.join('\n'))

    // (b) Profilul e ÎNLOCUIT cu alt abonament VIU (sub_C) în fereastră → bucla
    //     re-decide față de sub_C: dublura se anulează cu urma kept=sub_C.
    resetMocks(); setEnv()
    t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    w = stripeWorld({
      subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B'), sub_C: paidSub('in_C') },
      invoices: { in_B: paidInvoice('pi_B') },
    })
    w.afterRetrieve.sub_A = () => {
      w.subs.sub_A.status = 'canceled'
      Object.assign(t.rows[0], { stripe_subscription_id: 'sub_C' })
    }
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(row().stripe_subscription_id, 'sub_C')
    assert.deepEqual(cancels().map((c) => [c.args[0], c.args[1].cancellation_details.comment]), [['sub_B', `${MARKER};kept=sub_C`]])
    assert.equal(refundsCreated().length, 1)
    assert.ok(!r.lines.some((l) => l.includes('ALERT duplicate cancel MANUAL')), r.lines.join('\n'))
  })

  it('DUP29: cel păstrat se încheie în fereastra dintre re-validare și anulare → dublura anulată (ireversibil) și rambursată, ALERT MANUAL precis; verificarea rulează ÎNAINTEA rambursării', async () => {
    // Fereastra nu se poate închide (un abonament anulat nu se reactivează); se
    // DETECTEAZĂ după anulare. Ambele variante: `deleted` deja procesat (profil
    // gol) și încă neprocesat (profilul ține sub_A, dar Stripe îl arată anulat —
    // doar citirea din Stripe o prinde).
    for (const clearProfile of [true, false]) {
      resetMocks(); setEnv()
      const t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      w.beforeCancel.sub_B = () => {
        w.subs.sub_A.status = 'canceled'
        if (clearProfile) Object.assign(t.rows[0], { plan: 'free', stripe_subscription_id: null })
      }
      const label = `clearProfile=${clearProfile}`
      const { out: res, lines, logs } = await withLogs(() => checkout('sub_B'))
      assert.equal(res.statusCode, 200, `${label}: ${res.body}`)
      assert.equal(w.subs.sub_B.status, 'canceled', label)
      assert.equal(refundsCreated().length, 1, `${label}: banii unui abonament anulat se întorc`)
      const alert = lines.find((l) => l.includes('ALERT duplicate cancel MANUAL'))
      assert.ok(alert, `${label}: ${lines.join('\n')}`)
      for (const frag of ['user=u1', 'canceled=sub_B', 'kept=sub_A', 'kept_status=canceled',
        `profile_holds=${clearProfile ? 'null' : 'sub_A'}`]) {
        assert.ok(alert.includes(frag), `${label}: lipsește ${frag} din ${alert}`)
      }
      assert.ok(logs.some((l) => l.includes('settled: cancel=now kept=UNVERIFIED')), `${label}: ${logs.join('\n')}`)
    }

    // Verificarea rulează între anulare și rambursare: dacă rambursarea pică (500),
    // reluarea vede dublura deja anulată și nu mai trece pe aici — ALERT-ul
    // trebuie să fi plecat la PRIMA încercare.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.beforeCancel.sub_B = () => { w.subs.sub_A.status = 'canceled' }
    w.failNext.refund = stripeErr('An error occurred with our connection to Stripe.', { type: 'StripeConnectionError' })
    const first = await withLogs(() => checkout('sub_B'))
    assert.equal(first.out.statusCode, 500, first.out.body)
    assert.ok(first.lines.some((l) => l.includes('ALERT duplicate cancel MANUAL')), first.lines.join('\n'))
    const names = state.stripeCalls.map((c) => `${c.name}:${typeof c.args[0] === 'string' ? c.args[0] : ''}`)
    assert.ok(names.indexOf('subscriptions.retrieve:sub_A', names.indexOf('subscriptions.cancel:sub_B')) <
      names.indexOf('invoices.retrieve:in_B'), names.join(' '))

    // Control POZITIV: cel păstrat rămâne viu și ținut → fără ALERT MANUAL.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    const ok = await withLogs(() => checkout('sub_B'))
    assert.equal(ok.out.statusCode, 200, ok.out.body)
    assert.ok(!ok.lines.some((l) => l.includes('ALERT duplicate cancel MANUAL')), ok.lines.join('\n'))
    assert.ok(ok.logs.some((l) => l.includes('settled: cancel=now refund=refunded')), ok.logs.join('\n'))

    // Verificarea NU aruncă (recenzie pe #386, R4): o eroare la oricare dintre
    // cele două citiri e tot ALERT, rambursarea continuă, 200. Un 500 aici ar fi
    // amânat rambursarea unui abonament deja anulat, iar fără reverificarea de
    // la reluare (mai jos) ALERT-ul nu mai pleca niciodată.
    for (const [label, arm, frag, extra] of [
      ['citirea celui păstrat pică', (w) => {
        w.subs.sub_A.status = 'canceled'
        w.failNext['retrieve:sub_A'] = stripeErr('timeout', { type: 'StripeConnectionError' })
      }, 'abonamentul păstrat nu s-a putut citi', ['profile_holds=sub_A', 'kept_status=?']],
      ['re-citirea profilului pică', (w, t) => {
        t.failNextRead = { code: 'XX000', message: 'blip' }
      }, 'profilul nu s-a putut re-citi', ['profile_holds=null', 'kept_status=active']],
    ]) {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      const t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const wr = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      wr.beforeCancel.sub_B = () => arm(wr, t)
      const r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'completed', label)
      assert.equal(refundsCreated().length, 1, label)
      const alert = r.lines.find((l) => l.includes('ALERT duplicate cancel MANUAL'))
      assert.ok(alert && alert.includes(frag), `${label}: ${r.lines.join('\n')}`)
      for (const f of extra) assert.ok(alert.includes(f), `${label}: lipsește ${f} din ${alert}`)
      assert.ok(r.logs.some((l) => l.includes('settled: cancel=now kept=UNVERIFIED refund=refunded')), `${label}: ${r.logs.join('\n')}`)
    }

    // Jumătatea de PROFIL, singură (R6): profilul nu mai ține abonamentul păstrat,
    // deși acesta e încă VIU în Stripe (ex. ștergere de cont, schimbare manuală
    // în fereastră) → tot ALERT; doar starea din Stripe n-ar vedea nimic.
    resetMocks(); setEnv()
    {
      const t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const wp = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      wp.beforeCancel.sub_B = () => { t.rows[0].stripe_subscription_id = null }
      const r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, r.out.body)
      assert.equal(wp.subs.sub_A.status, 'active')
      const alert = r.lines.find((l) => l.includes('ALERT duplicate cancel MANUAL'))
      assert.ok(alert, r.lines.join('\n'))
      for (const f of ['profile_holds=null', 'kept_status=active', 'kept=sub_A']) assert.ok(alert.includes(f), `lipsește ${f} din ${alert}`)
      assert.ok(r.logs.some((l) => l.includes('settled: cancel=now kept=UNVERIFIED')), r.logs.join('\n'))
    }

    // Livrarea se oprește ÎNTRE anulare și verificare (R7): DELETE-ul s-a aplicat
    // la Stripe, răspunsul s-a pierdut → 500; între timp cel păstrat s-a încheiat.
    // Reluarea vede dublura deja anulată (urma) și nu mai trece prin anulare —
    // verificarea rulează totuși, pe REPROCESARE, și ALERT-ul pleacă.
    for (const keptEnds of [true, false]) {
      const label = `keptEnds=${keptEnds}`
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const wl = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      if (keptEnds) wl.beforeCancel.sub_B = () => { wl.subs.sub_A.status = 'canceled' }
      wl.failNext.cancelAfter = stripeErr('An error occurred with our connection to Stripe.', { type: 'StripeConnectionError' })
      const cut = await withLogs(() => checkout('sub_B'))
      assert.equal(cut.out.statusCode, 500, `${label}: ${cut.out.body}`)
      assert.equal(wl.subs.sub_B.status, 'canceled', `${label}: anularea s-a aplicat`)
      assert.equal(refundsCreated().length, 0, label)
      assert.ok(!cut.lines.some((l) => l.includes('ALERT duplicate cancel MANUAL')), `${label}: verificarea n-a apucat să ruleze`)
      const re = await withLogs(() => checkout('sub_B'))
      assert.equal(re.out.statusCode, 200, `${label}: ${re.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'completed', label)
      assert.equal(cancels().length, 1, `${label}: anularea nu se repetă`)
      assert.equal(refundsCreated().length, 1, label)
      assert.deepEqual(stripeCallsFor('subscriptions.retrieve').filter((c) => c.args[0] === 'sub_A').length, 2,
        `${label}: citirea din revendicare + verificarea de la reluare`)
      const alert = re.lines.find((l) => l.includes('ALERT duplicate cancel MANUAL'))
      if (keptEnds) {
        assert.ok(alert && alert.includes('kept_status=canceled') && alert.includes('reverificare la reluare'), `${label}: ${re.lines.join('\n')}`)
        assert.ok(re.logs.some((l) => l.includes('settled: cancel=already kept=UNVERIFIED')), `${label}: ${re.logs.join('\n')}`)
      } else {
        // Control POZITIV: cel păstrat e viu și ținut → nicio alarmă falsă la reluare.
        assert.equal(alert, undefined, `${label}: ${re.lines.join('\n')}`)
        assert.ok(re.logs.some((l) => l.includes('settled: cancel=already refund=refunded')), `${label}: ${re.logs.join('\n')}`)
      }
    }
  })

  it('DUP30: rambursarea dublurii se naște `pending` / `requires_action` → ALERT pending (nu „refunded”); invoice.paid relivrat cât e în curs → nimic nou, tot ALERT pending; răspuns pierdut la creare → reluarea dă ALERT pending (nu „already_refunded” tăcut); eșec ulterior REÎNCERCABIL → charge.refund.updated reîncearcă cu cheie NOUĂ derivată; relivrarea eșecului nu mai creează nimic', async () => {
    for (const born of ['pending', 'requires_action']) {
      resetMocks(); setEnv()
      const label = `născută ${born}`
      const events = stripeEventsTable()
      useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      w.refundStatus = [born]
      const fin = await withLogs(() => checkout('sub_B'))
      assert.equal(fin.out.statusCode, 200, `${label}: ${fin.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'completed', label)
      assert.ok(fin.logs.some((l) => l.includes('refund=refund_pending') && l.includes(`refund_state=${born}`)), `${label}: ${fin.logs.join('\n')}`)
      assert.ok(!fin.logs.some((l) => l.includes('refund=refunded')), `${label}: o rambursare în curs nu e „rambursat”`)
      assert.ok(fin.lines.some((l) => l.includes('ALERT duplicate subscription sub_B: rambursarea re_pi_B_1') && l.includes(born)),
        `${label}: ${fin.lines.join('\n')}`)

      // invoice.paid al dublurii relivrat cât rambursarea e ÎNCĂ în curs: ea
      // acoperă plata → nicio rambursare nouă (cu cheia de 24 h expirată, o a
      // doua ar fi o plată dublă), fără comision; ALERT-ul pending pleacă din nou (R2).
      const paid = await withLogs(() => invoicePaid('in_B', 'sub_B'))
      assert.equal(paid.out.statusCode, 200, `${label}: ${paid.out.body}`)
      assert.equal(refundsCreated().length, 1, `${label}: o rambursare în curs acoperă plata`)
      assert.equal(commissions().length, 0, label)
      assert.ok(paid.logs.some((l) => l.includes('invoice.paid refund=refund_pending') && l.includes('refund_id=re_pi_B_1') &&
        l.includes(`refund_state=${born}`)), `${label}: ${paid.logs.join('\n')}`)
      assert.ok(paid.lines.some((l) => l.includes('ALERT duplicate subscription sub_B: rambursarea re_pi_B_1')), `${label}: ${paid.lines.join('\n')}`)

      // Rambursarea eșuează ulterior, pe un motiv REÎNCERCABIL: charge.refund.updated.
      const failed = w.setRefund('re_pi_B_1', { status: 'failed', failure_reason: 'declined' })
      const upd = await withLogs(() => fire('charge.refund.updated', failed, { eventId: 'evt_rf_1' }))
      assert.equal(upd.out.statusCode, 200, `${label}: ${upd.out.body}`)
      assert.equal(events.get('evt_rf_1').status, 'completed', label)
      assert.ok(upd.lines.some((l) => l.includes('ALERT duplicate refund failed refund=re_pi_B_1') && l.includes('declined') &&
        l.includes('se reîncearcă')), `${label}: ${upd.lines.join('\n')}`)
      // Încă rambursabilă (factura recitită, lista consultată), apoi cheia NOUĂ.
      assert.equal(stripeCallsFor('invoices.retrieve').length, 3, label)
      assert.deepEqual(refundsCreated().map((c) => c.args[1].idempotencyKey), ['dupsub_refund_in_B', 'dupsub_refund_in_B_retry1'], label)
      assert.deepEqual(refundsCreated()[1].args[0].metadata, refundsCreated()[0].args[0].metadata, `${label}: aceeași urmă pe reîncercare`)
      assert.deepEqual(w.refunds.pi_B.map((x) => [x.status, x.amount]), [['failed', 24900], ['succeeded', 24900]], label)
      assert.ok(upd.logs.some((l) => l.includes('refund retry after re_pi_B_1 failed: refund=refunded')), `${label}: ${upd.logs.join('\n')}`)

      // Același eșec relivrat (alt eveniment) → restul e deja rambursat → nimic nou.
      const again = await withLogs(() => fire('charge.refund.updated', failed, { eventId: 'evt_rf_1b' }))
      assert.equal(again.out.statusCode, 200, `${label}: ${again.out.body}`)
      assert.equal(refundsCreated().length, 2, label)
      assert.ok(again.logs.some((l) => l.includes('refund=already_refunded')), `${label}: ${again.logs.join('\n')}`)
    }

    // Răspunsul pierdut la CREARE (R2): Stripe a creat rambursarea `pending`, iar
    // cererea noastră a căzut în timeout → 500. Reluarea o găsește în listă (ea
    // acoperă plata) → `refund_pending` + ALERT, NU „already_refunded” tăcut —
    // altfel, fără abonamentul la charge.refund.updated, un eșec ulterior n-ar
    // lăsa niciun semnal. Nicio a doua rambursare.
    resetMocks(); setEnv()
    const events = stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.refundStatus = ['pending']
    w.failNext.refundAfter = stripeErr('An error occurred with our connection to Stripe.', { type: 'StripeConnectionError' })
    const lost = await withLogs(() => checkout('sub_B'))
    assert.equal(lost.out.statusCode, 500, lost.out.body)
    assert.deepEqual(w.refunds.pi_B.map((x) => x.status), ['pending'], 'rambursarea există la Stripe')
    const retry = await withLogs(() => checkout('sub_B'))
    assert.equal(retry.out.statusCode, 200, retry.out.body)
    assert.equal(events.get('evt_sub_B').status, 'completed')
    assert.equal(refundsCreated().length, 1, 'reluarea NU creează a doua rambursare')
    assert.ok(retry.logs.some((l) => l.includes('settled: cancel=already refund=refund_pending') &&
      l.includes('refund_id=re_pi_B_1') && l.includes('refund_state=pending')), retry.logs.join('\n'))
    assert.ok(retry.lines.some((l) => l.includes('ALERT duplicate subscription sub_B: rambursarea re_pi_B_1') && l.includes('pending')),
      retry.lines.join('\n'))
  })

  // O rambursare a NOASTRĂ (urma din metadata) și moartă, pentru charge.refund.updated.
  const ourRefund = (extra = {}) => ({
    id: 're_x', object: 'refund', amount: 24900, payment_intent: 'pi_B', status: 'failed', failure_reason: 'unknown',
    metadata: { menuvia_reason: 'duplicate_subscription', menuvia_subscription: 'sub_B', menuvia_invoice: 'in_B' },
    ...extra,
  })
  const sideEffects = () => state.stripeCalls.map((c) => c.name).filter((n) => n !== 'webhooks.constructEvent')

  it('DUP31: charge.refund.updated — străin / încă viu (zero apeluri Stripe), plafonul de reîncercări, refuz permanent (manual), metadata stricată (500), factura nu mai e rambursabilă (verificare MANUALĂ); rambursare moartă din prima → 500, reluarea cu cheia următoare', async () => {
    // (a) Rambursare STRĂINĂ (fără urma noastră), eșuată → ignorată, zero apeluri.
    // (b) A noastră, dar încă vie (succeeded / pending / requires_action) → nimic de făcut.
    for (const [label, refund] of [
      ['străină', ourRefund({ metadata: {} })],
      ['străină, alt motiv', ourRefund({ metadata: { menuvia_reason: 'manual' } })],
      ['a noastră, succeeded', ourRefund({ status: 'succeeded', failure_reason: null })],
      ['a noastră, pending', ourRefund({ status: 'pending', failure_reason: null })],
      ['a noastră, requires_action', ourRefund({ status: 'requires_action', failure_reason: null })],
    ]) {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      stripeWorld({ invoices: { in_B: paidInvoice('pi_B') } })
      const r = await withLogs(() => fire('charge.refund.updated', refund, { eventId: 'evt_rf' }))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.equal(events.get('evt_rf').status, 'completed', label)
      assert.deepEqual(sideEffects(), [], label)
    }

    // (c) Plafonul: DUPLICATE_REFUND_MAX_ATTEMPTS rambursări moarte REÎNCERCABILE
    //     pe plată → fără a patra încercare, ALERT de rambursare MANUALĂ, 200.
    resetMocks(); setEnv()
    stripeWorld({
      invoices: { in_B: paidInvoice('pi_B') },
      refunds: { pi_B: [1, 2, 3].map((i) => ({ id: `re_f${i}`, amount: 24900, status: 'failed', failure_reason: i === 2 ? 'declined' : 'unknown' })) },
    })
    let r = await withLogs(() => fire('charge.refund.updated', ourRefund({ id: 're_f3' }), { eventId: 'evt_cap' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(refundsCreated().length, 0)
    assert.ok(r.lines.some((l) => l.includes('3 rambursări eșuate') && l.includes('rambursare MANUALĂ') && l.includes('in_B')),
      r.lines.join('\n'))
    // ALERT-ul de dinaintea reîncercării nu promite că ea rulează: trimite la linia
    // de rezultat, care aici spune `refund=manual`.
    assert.ok(r.lines.some((l) => l.includes('se reîncearcă') && l.includes('refund=manual')), r.lines.join('\n'))
    assert.ok(r.logs.some((l) => l.includes('refund retry after re_f3 failed: refund=manual')), r.logs.join('\n'))

    // (d) Refuz PERMANENT al plății, pe AMBELE coduri → manual, 200, fără buclă de 500.
    for (const code of ['charge_disputed', 'charge_expired_for_refund']) {
      resetMocks(); setEnv()
      const w = stripeWorld({ invoices: { in_B: paidInvoice('pi_B') }, refunds: { pi_B: [{ id: 're_x', amount: 24900, status: 'failed', failure_reason: 'unknown' }] } })
      w.failNext.refund = stripeErr('The charge cannot be refunded.', { code, statusCode: 400 })
      r = await withLogs(() => fire('charge.refund.updated', ourRefund(), { eventId: 'evt_perm' }))
      assert.equal(r.out.statusCode, 200, `${code}: ${r.out.body}`)
      assert.equal(refundsCreated().length, 1, `${code}: încercarea refuzată, fără o a doua`)
      assert.ok(r.lines.some((l) => l.includes(code) && l.includes('rambursare MANUALĂ')), `${code}: ${r.lines.join('\n')}`)
    }

    // (e) Metadata noastră cu formă stricată — pe FIECARE jumătate → 500 (nu știm
    //     ce să rambursăm), nicio cerere Stripe.
    for (const [label, meta] of [
      ['factură', { menuvia_invoice: 'in_B,x' }],
      ['abonament', { menuvia_subscription: 'sub_B,x' }],
      ['abonament lipsă', { menuvia_subscription: undefined }],
    ]) {
      resetMocks(); setEnv()
      stripeWorld({ invoices: { in_B: paidInvoice('pi_B') } })
      const metadata = { ...ourRefund().metadata, ...meta }
      r = await withLogs(() => fire('charge.refund.updated', ourRefund({ metadata })))
      assert.equal(r.out.statusCode, 500, `${label}: ${r.out.body}`)
      assert.deepEqual(sideEffects(), [], `${label}: nicio cerere Stripe pe metadata stricată`)
    }

    // (f) Factura nu mai e rambursabilă la reîncercare (open cu sumă de plată /
    //     fără bani) → 200, nimic creat, ALERT de verificare MANUALĂ.
    for (const [state0, inv] of [
      ['pending_payment', { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_B' }],
      ['nothing_paid', { status: 'paid', amount_paid: 0, amount_due: 0, payment_intent: 'pi_B' }],
    ]) {
      resetMocks(); setEnv()
      stripeWorld({ invoices: { in_B: inv } })
      r = await withLogs(() => fire('charge.refund.updated', ourRefund()))
      assert.equal(r.out.statusCode, 200, `${state0}: ${r.out.body}`)
      assert.equal(refundsCreated().length, 0, state0)
      assert.ok(r.lines.some((l) => l.includes(`nu mai e rambursabilă (${state0})`) && l.includes('verificare MANUALĂ')),
        `${state0}: ${r.lines.join('\n')}`)
    }

    // (g) La finalizare rambursarea se naște `failed` → 500 (nu „rambursat”);
    //     reluarea vede rambursarea moartă și încearcă cu cheia următoare.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.refundStatus = ['failed']
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 500, r.out.body)
    assert.equal(finalizeStatus(), 'failed')
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual(refundsCreated().map((c) => c.args[1].idempotencyKey), ['dupsub_refund_in_B', 'dupsub_refund_in_B_retry1'])
    assert.deepEqual(w.refunds.pi_B.map((x) => x.status), ['failed', 'succeeded'])
    assert.equal(cancels().length, 1)
  })

  it('DUP32: rambursarea dublurii ANULATĂ de un om (Dashboard) sau eșuată pe un motiv pentru care Stripe cere altă cale → NICIO rambursare nouă, ALERT MANUAL; nici invoice.paid, nici finalizarea relivrate nu o refac; control POZITIV: motivele reîncercabile se reîncearcă', async () => {
    // (a) Cap-coadă (recenzie pe #386, R1): rambursată la finalizare, apoi
    //     fondatorul o ANULEAZĂ din Dashboard (a returnat banii prin transfer /
    //     i-a trecut în credit). Reîncercarea automată ar plăti a doua oară.
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    let r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(refundsCreated().length, 1)
    const canceled = w.setRefund('re_pi_B_1', { status: 'canceled', failure_reason: 'merchant_request' })
    const before = state.stripeCalls.length
    r = await withLogs(() => fire('charge.refund.updated', canceled, { eventId: 'evt_rf_cancel' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(finalizeStatus(), 'completed')
    assert.deepEqual(state.stripeCalls.slice(before).map((c) => c.name).filter((n) => n !== 'webhooks.constructEvent'), [],
      'decizia se ia pe obiectul din eveniment: nicio citire, nicio rambursare')
    assert.ok(r.lines.some((l) => l.includes('ALERT duplicate refund canceled refund=re_pi_B_1') && l.includes('merchant_request') &&
      l.includes('rambursare MANUALĂ') && l.includes('FĂRĂ reîncercare')), r.lines.join('\n'))
    assert.ok(!r.lines.some((l) => l.includes('se reîncearcă')), r.lines.join('\n'))
    //     invoice.paid al dublurii relivrat → refundDuplicateInvoice vede rambursarea
    //     anulată pe plată → manual, NIMIC creat (oglinda deciziei).
    r = await withLogs(() => invoicePaid('in_B', 'sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(refundsCreated().length, 1)
    assert.equal(commissions().length, 0)
    assert.ok(r.lines.some((l) => l.includes('ALERT duplicate subscription sub_B: factura in_B are rambursarea re_pi_B_1 canceled/merchant_request') &&
      l.includes('rambursare MANUALĂ')), r.lines.join('\n'))
    assert.deepEqual(w.refunds.pi_B.map((x) => x.status), ['canceled'])

    // (b) Fiecare stare FINALĂ: charge.refund.updated nu face nicio cerere, iar o
    //     finalizare (livrare cu urma deja pusă, ca DUP8) care găsește rambursarea
    //     pe plată nu creează nimic. „motiv_nou” = un motiv pe care nu-l
    //     cunoaștem: fail-closed.
    for (const dead of [
      { status: 'canceled', failure_reason: 'merchant_request' },
      { status: 'canceled', failure_reason: null },
      { status: 'failed', failure_reason: 'merchant_request' },
      { status: 'failed', failure_reason: 'expired_or_canceled_card' },
      { status: 'failed', failure_reason: 'lost_or_stolen_card' },
      { status: 'failed', failure_reason: 'charge_for_pending_refund_disputed' },
      { status: 'failed', failure_reason: 'motiv_nou' },
    ]) {
      const label = `${dead.status}/${dead.failure_reason}`
      resetMocks(); setEnv()
      stripeWorld({ invoices: { in_B: paidInvoice('pi_B') }, refunds: { pi_B: [{ id: 're_x', amount: 24900, ...dead }] } })
      r = await withLogs(() => fire('charge.refund.updated', ourRefund(dead)))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.deepEqual(sideEffects(), [], label)
      assert.ok(r.lines.some((l) => l.includes('rambursare MANUALĂ') && l.includes('FĂRĂ reîncercare')), `${label}: ${r.lines.join('\n')}`)

      resetMocks(); setEnv()
      useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      stripeWorld({
        subs: {
          sub_A: paidSub('in_A'),
          sub_B: paidSub('in_B', { status: 'canceled', cancellation_details: { comment: `${MARKER};kept=sub_A` } }),
        },
        invoices: { in_B: paidInvoice('pi_B') },
        refunds: { pi_B: [{ id: 're_x', amount: 24900, ...dead }] },
      })
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.equal(refundsCreated().length, 0, `${label}: finalizarea nu reface decizia`)
      assert.ok(r.lines.some((l) => l.includes('are rambursarea re_x') && l.includes('rambursare MANUALĂ')), `${label}: ${r.lines.join('\n')}`)
    }

    // (c) Control POZITIV: un eșec reîncercabil (inclusiv fără motiv = unknown)
    //     se reîncearcă cu cheia `…_retry1`, iar a doua rambursare reușește.
    for (const reason of ['unknown', 'declined', 'insufficient_funds', null]) {
      resetMocks(); setEnv()
      const wp = stripeWorld({
        invoices: { in_B: paidInvoice('pi_B') },
        refunds: { pi_B: [{ id: 're_x', amount: 24900, status: 'failed', failure_reason: reason }] },
      })
      r = await withLogs(() => fire('charge.refund.updated', ourRefund({ failure_reason: reason })))
      assert.equal(r.out.statusCode, 200, `${reason}: ${r.out.body}`)
      assert.deepEqual(refundsCreated().map((c) => c.args[1].idempotencyKey), ['dupsub_refund_in_B_retry1'], String(reason))
      assert.deepEqual(wp.refunds.pi_B.map((x) => x.status), ['failed', 'succeeded'], String(reason))
      assert.ok(r.lines.some((l) => l.includes('se reîncearcă')), `${reason}: ${r.lines.join('\n')}`)
    }
  })

  it('DUP33: anularea dublurii OPREȘTE implicit încasarea pe facturile finalizate ale clientului → o factură deschisă a celui PĂSTRAT cu auto_advance false → ALERT COLLECTION precis, nimic schimbat automat; citire eșuată / listă trunchiată → ALERT; rulează și la reluare; control POZITIV', async () => {
    // (a) Cel păstrat e `past_due` (viu, reîncercări programate) cu factura in_A2
    //     deschisă; anularea dublurii o pune pe auto_advance false (implicitul
    //     Stripe, modelat de lume). Starea lui rămâne `past_due`, deci
    //     verifyKeptAfterCancel nu vede nimic — doar verificarea facturilor.
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    let w = stripeWorld({
      subs: { sub_A: paidSub('in_A2', { status: 'past_due' }), sub_B: paidSub('in_B') },
      invoices: {
        in_A2: { status: 'open', amount_paid: 0, amount_due: 24900, auto_advance: true, payment_intent: 'pi_A2', subscription: 'sub_A' },
        in_B: paidInvoice('pi_B'),
      },
    })
    let r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(finalizeStatus(), 'completed')
    const alert = r.lines.find((l) => l.includes('ALERT duplicate cancel COLLECTION'))
    assert.ok(alert, r.lines.join('\n'))
    for (const f of ['user=u1', 'canceled=sub_B', 'kept=sub_A', 'in_A2(24900)', 'reactivează încasarea automată', 'Dashboard']) {
      assert.ok(alert.includes(f), `lipsește ${f} din ${alert}`)
    }
    assert.ok(!r.lines.some((l) => l.includes('ALERT duplicate cancel MANUAL')), 'cel păstrat e viu și ținut')
    assert.ok(r.logs.some((l) => l.includes('settled: cancel=now collection=CHECK refund=refunded')), r.logs.join('\n'))
    assert.equal(w.invoices.in_A2.auto_advance, false, 'facturarea clientului NU se schimbă automat')
    assert.equal(refundsCreated().length, 1, 'rambursarea dublurii continuă')
    assert.deepEqual(sideEffects(), [
      'subscriptions.retrieve', 'subscriptions.retrieve', 'subscriptions.cancel', 'subscriptions.retrieve',
      'invoices.list', 'invoices.retrieve', 'refunds.list', 'refunds.create',
    ], 'doar citiri după anulare: nicio scriere pe facturile clientului')

    // (b) Control POZITIV: o factură deschisă a DUBLURII (anulată, a ei se
    //     oprește intenționat) și una a celui păstrat cu încasarea ÎNCĂ pornită
    //     după anulare → fără ALERT COLLECTION.
    resetMocks(); setEnv()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    w = stripeWorld({
      subs: { sub_A: paidSub('in_A2', { status: 'past_due' }), sub_B: paidSub('in_B') },
      invoices: {
        in_A2: { status: 'open', amount_paid: 0, amount_due: 24900, auto_advance: true, payment_intent: 'pi_A2', subscription: 'sub_A' },
        in_B2: { status: 'open', amount_paid: 0, amount_due: 24900, auto_advance: true, payment_intent: 'pi_B2', subscription: 'sub_B' },
        in_B: paidInvoice('pi_B'),
      },
    })
    const cancelImpl = state.stripeImpls['subscriptions.cancel']
    state.stripeImpls['subscriptions.cancel'] = async (...a) => {
      const out = await cancelImpl(...a)
      w.invoices.in_A2.auto_advance = true // Stripe n-a oprit-o pe a celui păstrat
      return out
    }
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.ok(!r.lines.some((l) => l.includes('ALERT duplicate cancel COLLECTION')), r.lines.join('\n'))
    assert.ok(r.logs.some((l) => l.includes('settled: cancel=now refund=refunded')), r.logs.join('\n'))
    assert.equal(w.invoices.in_B2.auto_advance, false, 'a dublurii e oprită, dar nu e a celui păstrat')

    // (c) Citirea facturilor pică / lista e trunchiată → ALERT, NU 500 (ar amâna
    //     rambursarea unui abonament deja anulat).
    for (const [label, arm, frag] of [
      ['citire eșuată', (wx) => { wx.failNext.invoicesList = stripeErr('timeout', { type: 'StripeConnectionError' }) }, 'nu s-au putut citi'],
      ['listă trunchiată', () => {
        state.stripeImpls['invoices.list'] = async () => ({ object: 'list', has_more: true, data: [] })
      }, 'lista e trunchiată'],
    ]) {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
      const wx = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
      arm(wx)
      r = await withLogs(() => checkout('sub_B'))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.equal(events.get('evt_sub_B').status, 'completed', label)
      assert.equal(refundsCreated().length, 1, label)
      assert.ok(r.lines.some((l) => l.includes('ALERT duplicate cancel COLLECTION') && l.includes(frag)), `${label}: ${r.lines.join('\n')}`)
      // Și pe linia de rezultat a livrării (singurul semnal al acestui deznodământ
      // acolo): o citire eșuată / trunchiată NU e o încasare verificată.
      assert.ok(r.logs.some((l) => l.includes('settled: cancel=now collection=CHECK refund=refunded')), `${label}: ${r.logs.join('\n')}`)
    }

    // (c2) Prima pagină are DEJA facturi oprite ȘI lista e trunchiată (runda 3
    //      CodeRabbit pe #386) → ALERT-ul le numește pe cele văzute ȘI spune că
    //      mai sunt pagini (înainte, avertismentul de trunchiere dispărea).
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    state.stripeImpls['invoices.list'] = async () => ({
      object: 'list', has_more: true,
      data: [
        { id: 'in_A7', status: 'open', amount_due: 24900, auto_advance: false, subscription: 'sub_A' },
        { id: 'in_A8', status: 'open', amount_due: 9900, auto_advance: true, subscription: 'sub_A' },
      ],
    })
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    const both = r.lines.find((l) => l.includes('ALERT duplicate cancel COLLECTION'))
    assert.ok(both, r.lines.join('\n'))
    for (const f of ['in_A7(24900)', 'reactivează încasarea automată', 'lista e trunchiată', 'după prima pagină']) {
      assert.ok(both.includes(f), `lipsește ${f} din ${both}`)
    }
    assert.ok(!both.includes('in_A8'), 'o factură cu încasarea pornită nu se raportează')

    // (d) Livrarea se oprește ÎNTRE anulare și verificări (răspunsul DELETE
    //     pierdut) → reluarea nu mai trece prin anulare, dar verifică facturile.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    w = stripeWorld({
      subs: { sub_A: paidSub('in_A2', { status: 'past_due' }), sub_B: paidSub('in_B') },
      invoices: {
        in_A2: { status: 'open', amount_paid: 0, amount_due: 24900, auto_advance: true, payment_intent: 'pi_A2', subscription: 'sub_A' },
        in_B: paidInvoice('pi_B'),
      },
    })
    w.failNext.cancelAfter = stripeErr('An error occurred with our connection to Stripe.', { type: 'StripeConnectionError' })
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 500, r.out.body)
    assert.equal(stripeCallsFor('invoices.list').length, 0, 'n-a apucat')
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(cancels().length, 1)
    assert.ok(r.lines.some((l) => l.includes('ALERT duplicate cancel COLLECTION') && l.includes('in_A2(24900)')), r.lines.join('\n'))
    assert.ok(r.logs.some((l) => l.includes('settled: cancel=already collection=CHECK')), r.logs.join('\n'))
  })

  it('DUP34: customer.subscription.updated — verificarea de după scriere pică pe un abonament VALID → reluarea emite EXACT un plan_changed pentru tranziția ORIGINALĂ (purtată în payload-ul rândului), inclusiv peste un al doilea eșec; dublura anulată nu emite niciodată (DUP27c)', async () => {
    const snapshot = { id: 'sub_B', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_growth' } }] } }
    const planChanged = () => lifecycleInserts().filter((l) => l && l.event_type === 'plan_changed')
    for (const second of ['none', 'verify', 'lookup']) {
      resetMocks(); setEnv()
      const label = `al doilea eșec: ${second}`
      const events = stripeEventsTable()
      const t = useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
      const w = stripeWorld({ subs: { sub_B: paidSub('in_B') } })
      // Scrierea reușește, apoi citirea de verificare pică (timeout Stripe).
      t.hooks.beforeUpdate = () => { w.failNext['retrieve:sub_B'] = stripeErr('timeout', { type: 'StripeConnectionError' }) }
      let r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd' }))
      assert.equal(r.out.statusCode, 500, `${label}: ${r.out.body}`)
      assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'], `${label}: planul scris rămâne (abonament valid)`)
      assert.equal(planChanged().length, 0, `${label}: încă neconfirmat`)
      assert.deepEqual(events.get('evt_upd').payload.menuvia_pending_plan_changed, { from: 'free' }, label)
      assert.deepEqual(events.get('evt_upd').payload.object, snapshot, `${label}: payload-ul rămâne data ÎNTREG`)

      if (second !== 'none') {
        // Reluarea pică și ea — după scriere (verificarea) sau înaintea ei
        // (citirea profilului): tranziția se re-persistă, nu se pierde.
        if (second === 'verify') w.failNext['retrieve:sub_B'] = stripeErr('timeout', { type: 'StripeConnectionError' })
        else t.failNextRead = { code: 'XX000', message: 'blip' }
        r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd' }))
        assert.equal(r.out.statusCode, 500, `${label}: ${r.out.body}`)
        assert.equal(planChanged().length, 0, label)
        assert.deepEqual(events.get('evt_upd').payload.menuvia_pending_plan_changed, { from: 'free' }, label)
      }

      r = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd' }))
      assert.equal(r.out.statusCode, 200, `${label}: ${r.out.body}`)
      assert.equal(events.get('evt_upd').status, 'completed', label)
      assert.deepEqual(planChanged().map((l) => l.event_data), [{ from: 'free', to: 'growth', status: 'active' }], label)

      // Relivrarea rândului completat și un ALT eveniment cu același instantaneu
      // → niciun plan_changed în plus.
      await fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd' })
      await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_upd_2' }))
      assert.equal(planChanged().length, 1, label)
    }

    // Control POZITIV: fără eșec, prima livrare emite direct, o singură dată.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    stripeWorld({ subs: { sub_B: paidSub('in_B') } })
    const ok = await withLogs(() => fire('customer.subscription.updated', snapshot, { eventId: 'evt_ok' }))
    assert.equal(ok.out.statusCode, 200, ok.out.body)
    assert.deepEqual(planChanged().map((l) => l.event_data), [{ from: 'free', to: 'growth', status: 'active' }])
  })

  it('DUP35: profilul se GOLEȘTE în timpul citirii din Stripe a celui păstrat (verificarea de după anulare) → profilul se citește DUPĂ Stripe, deci ALERT MANUAL (profile_holds=null)', async () => {
    const t = useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    const w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    // Prima citire a lui sub_A e a revendicării; următoarea (armată la anulare)
    // e a verificării: profilul se golește CÂT ea e în zbor.
    w.beforeCancel.sub_B = () => {
      w.afterRetrieve.sub_A = () => { Object.assign(t.rows[0], { plan: 'free', stripe_subscription_id: null }) }
    }
    const r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(w.subs.sub_A.status, 'active')
    const alert = r.lines.find((l) => l.includes('ALERT duplicate cancel MANUAL'))
    assert.ok(alert, r.lines.join('\n'))
    for (const f of ['profile_holds=null', 'kept_status=active', 'kept=sub_A', 'canceled=sub_B']) {
      assert.ok(alert.includes(f), `lipsește ${f} din ${alert}`)
    }
    assert.ok(r.logs.some((l) => l.includes('settled: cancel=now kept=UNVERIFIED')), r.logs.join('\n'))
  })

  it('DUP37: customer.subscription.updated vechi (instantaneu viu, plan PLĂTIT) relivrat DUPĂ deleted-ul LEGITIM al abonamentului → profilul gol rămâne gol, fără plan_changed; încheiat între citire și scriere / la reluare → revenire; control pozitiv', async () => {
    // Clasa MF-07 (runda 3 pe #386, recenzia proprie): garda DUP25 recunoștea
    // doar urma noastră, deci un abonament anulat LEGITIM (fără urmă) revendica
    // profilul golit cu planul din instantaneu — Planul 3, cu fiscal_receipt, pe
    // un abonament care nu mai emite nimic. Citirea exista deja pe această cale.
    const stale = { id: 'sub_A', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_pro' } }] } }
    const planChanged = () => lifecycleInserts().filter((l) => l && l.event_type === 'plan_changed')
    const proSub = (extra = {}) => paidSub('in_A', { metadata: { plan: 'pro' }, items: { data: [{ price: { id: 'price_pro' } }] }, ...extra })

    // (a) deleted(sub_A) legitim (email + atribuire), apoi updated(sub_A) vechi
    //     cu `active` → sărit ÎNAINTEA scrierii (o singură citire, nicio scriere),
    //     în ambele stări terminale.
    for (const ended of ['canceled', 'incomplete_expired']) {
      resetMocks(); setEnv()
      stripeEventsTable()
      useProfiles([{ id: 'u1', plan: 'pro', stripe_subscription_id: 'sub_A' }])
      stripeWorld({ subs: { sub_A: proSub({ status: ended }) } })
      let res = (await withLogs(() => fire('customer.subscription.deleted', { id: 'sub_A', customer: 'cus_1', status: ended }, { eventId: `evt_del_${ended}` }))).out
      assert.equal(res.statusCode, 200, `${ended}: ${res.body}`)
      assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], ended)
      assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['subscription_cancelled'], ended)
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 1, ended)
      const writes = profileUpdates().length
      const r = await withLogs(() => fire('customer.subscription.updated', stale, { eventId: `evt_upd_${ended}` }))
      assert.equal(r.out.statusCode, 200, `${ended}: ${r.out.body}`)
      assert.equal(finalizeStatus(), 'completed', ended)
      assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], `${ended}: fără Planul 3 pe un abonament încheiat`)
      assert.equal(profileUpdates().length, writes, `${ended}: sărit înaintea scrierii, nu revenit după ea`)
      assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_A'], ended)
      assert.equal(planChanged().length, 0, ended)
      assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 1, `${ended}: atribuirea neatinsă a doua oară`)
      assert.ok(r.logs.some((l) => l.includes('Skip stale updated sub_A') && l.includes(ended)), `${ended}: ${r.logs.join('\n')}`)
    }

    // (b) Abonamentul se încheie ÎNTRE citirea de dinaintea scrierii și scriere
    //     (deleted-ul lui procesat atunci, pe profilul încă gol) → scrierea îl
    //     revendică, verificarea de după ea revine condiționat; fără plan_changed.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    let w = stripeWorld({ subs: { sub_A: proSub() } })
    w.afterRetrieve.sub_A = () => { w.subs.sub_A.status = 'canceled' }
    let r = await withLogs(() => fire('customer.subscription.updated', stale, { eventId: 'evt_upd_race' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(profileUpdates().length, 2, 'scriere + revenire')
    const revert = state.fromCalls.filter((c) => c.table === 'profiles' && hasOp(c.ops, 'update'))[1]
    assert.ok(revert.ops.some((o) => o.m === 'eq' && o.args[0] === 'stripe_subscription_id' && o.args[1] === 'sub_A'),
      'revenirea atinge doar un rând care ține ÎNCĂ abonamentul')
    assert.equal(planChanged().length, 0)

    // (b2) Aceeași fereastră, cu `deleted`-ul PROCESAT în ea (runda 3 CodeRabbit
    //      pe #386, nit): updated se oprește după citirea dinaintea scrierii,
    //      deleted-ul legitim rulează pe profilul gol (golire + atribuire +
    //      email), apoi updated reia: scrierea revendică, verificarea revine.
    //      EXACT un subscription_cancelled (al lui deleted), fără plan_changed.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    w = stripeWorld({ subs: { sub_A: proSub() } })
    {
      const read = state.stripeImpls['subscriptions.retrieve']
      let reached
      let release
      const atRead = new Promise((res) => { reached = res })
      const resume = new Promise((res) => { release = res })
      let paused = false
      state.stripeImpls['subscriptions.retrieve'] = async (id) => {
        const out = await read(id)
        if (!paused) { paused = true; reached(); await resume }
        return out
      }
      r = await withLogs(async () => {
        const upd = fire('customer.subscription.updated', stale, { eventId: 'evt_upd_paused' })
        await atRead
        w.subs.sub_A.status = 'canceled'
        const del = await fire('customer.subscription.deleted', { id: 'sub_A', customer: 'cus_1', status: 'canceled' }, { eventId: 'evt_del_paused' })
        assert.equal(del.statusCode, 200, del.body)
        assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], 'deleted pe profilul gol')
        release()
        return upd
      })
    }
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'], 'fără Planul 3 pe un abonament încheiat')
    assert.equal(profileUpdates().length, 3, 'golirea lui deleted + scrierea lui updated + revenirea')
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['subscription_cancelled'], 'un singur email de anulare')
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 1, 'atribuirea o singură dată')
    assert.equal(planChanged().length, 0)
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_A', 'sub_A'], 'citirea dinainte + cea de după scriere')

    // (c) Verificarea de după scriere pică (500, rândul `failed`, tranziția
    //     purtată); abonamentul se încheie apoi în Stripe, dar deleted-ul lui n-a
    //     sosit încă → reluarea (profilul îl ține: nu e „gol”) revine, fără
    //     plan_changed; deleted-ul sosit DUPĂ găsește profilul gol și face el
    //     emailul + atribuirea, o singură dată.
    resetMocks(); setEnv()
    const events = stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    w = stripeWorld({ subs: { sub_A: proSub() } })
    w.afterRetrieve.sub_A = () => { w.failNext['retrieve:sub_A'] = stripeErr('timeout', { type: 'StripeConnectionError' }) }
    r = await withLogs(() => fire('customer.subscription.updated', stale, { eventId: 'evt_upd_retry' }))
    assert.equal(r.out.statusCode, 500, r.out.body)
    assert.equal(events.get('evt_upd_retry').status, 'failed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'pro'])
    w.subs.sub_A.status = 'canceled'
    r = await withLogs(() => fire('customer.subscription.updated', stale, { eventId: 'evt_upd_retry' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(events.get('evt_upd_retry').status, 'completed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], [null, 'free'])
    assert.equal(planChanged().length, 0, 'tranziția purtată nu se emite pe un abonament încheiat')
    r = await withLogs(() => fire('customer.subscription.deleted', { id: 'sub_A', customer: 'cus_1', status: 'canceled' }, { eventId: 'evt_del_retry' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual(lifecycleInserts().map((l) => l.event_type), ['subscription_cancelled'])
    assert.equal(rpcCallsFor('set_affiliate_attribution_status').length, 1)

    // (d) Control POZITIV: același updated vechi, dar abonamentul e încă VIU în
    //     Stripe → revendicat ca înainte (`plan_changed` free → pro), două citiri.
    resetMocks(); setEnv()
    stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    stripeWorld({ subs: { sub_A: proSub() } })
    r = await withLogs(() => fire('customer.subscription.updated', stale, { eventId: 'evt_upd_live' }))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_A', 'pro'])
    assert.deepEqual(planChanged().map((l) => [l.event_data.from, l.event_data.to]), [['free', 'pro']])
    assert.deepEqual(stripeCallsFor('subscriptions.retrieve').map((c) => c.args[0]), ['sub_A', 'sub_A'])
  })

  it('DUP38: deținătorul neplătit își PLĂTEȘTE factura în fereastra dintre citirea stării și CAS → factura văzută la decizie, reconciliată după CAS, se rambursează (plată dublă), fără a doua rambursare la invoice.paid; reconcilierea eșuată = ALERT, nu 500', async () => {
    // Runda 3 CodeRabbit pe #386. Citirea stării e ultima operație înaintea
    // anulării, dar plata poate sosi în latența ei: Stripe face abonamentul
    // `active`, iar noi anulăm unul abia plătit. Garda din invoice.paid nu-l
    // vede cât profilul îl ține încă („cel urmărit”), deci fără reconciliere
    // banii rămâneau încasați pe un abonament anulat, lângă cel nou.
    const pay = (w) => () => {
      Object.assign(w.invoices.in_A, { status: 'paid', amount_paid: 24900, amount_due: 24900 })
      w.subs.sub_A.status = 'active'
    }
    const setup = () => {
      resetMocks(); setEnv()
      const events = stripeEventsTable()
      useProfiles([{ id: 'u1', plan: 'free', stripe_subscription_id: 'sub_A' }])
      const w = stripeWorld({
        subs: { sub_A: paidSub('in_A', { status: 'unpaid' }), sub_B: paidSub('in_B') },
        invoices: {
          in_A: { status: 'open', amount_paid: 0, amount_due: 24900, payment_intent: 'pi_A', subscription: 'sub_A' },
          in_B: paidInvoice('pi_B'),
        },
      })
      w.afterRetrieve.sub_A = pay(w)
      return { events, w }
    }

    // (a) Plata sosește imediat după citire; invoice.paid-ul ei vine DUPĂ CAS.
    let { events, w } = setup()
    let r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(events.get('evt_sub_B').status, 'completed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])
    assert.equal(w.subs.sub_A.status, 'canceled')
    assert.deepEqual(refundsCreated().map((c) => [c.args[0].payment_intent, c.args[0].metadata.menuvia_subscription, c.args[1].idempotencyKey]),
      [['pi_A', 'sub_A', 'dupsub_refund_in_A']], 'plata dublă, rambursată cu cheia dublurii')
    assert.ok(r.logs.some((l) => l.includes('replaced subscription sub_A reconciled: refund=refunded invoice=in_A')), r.logs.join('\n'))
    r = await withLogs(() => invoicePaid('in_A', 'sub_A'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(refundsCreated().length, 1, 'invoice.paid găsește rambursarea: fără a doua')
    assert.ok(r.logs.some((l) => l.includes('refund=already_refunded')), r.logs.join('\n'))
    assert.equal(commissions().length, 0)

    // (b) invoice.paid-ul plății e procesat ÎN fereastră (între citire și
    //     anulare, profilul îl ține încă) → calea obișnuită: lifecycle + comision.
    //     Reconcilierea de după CAS o rambursează oricum (comisionul se stornează
    //     prin charge.refunded, clawback-ul existent).
    ;({ events, w } = setup())
    const cancelImpl = state.stripeImpls['subscriptions.cancel']
    state.stripeImpls['subscriptions.cancel'] = async (...a) => {
      const paid = await invoicePaid('in_A', 'sub_A')
      assert.equal(paid.statusCode, 200, paid.body)
      return cancelImpl(...a)
    }
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(commissions().length, 1, 'procesat cât profilul ținea sub_A: calea obișnuită')
    assert.deepEqual(refundsCreated().map((c) => [c.args[0].payment_intent, c.args[1].idempotencyKey]), [['pi_A', 'dupsub_refund_in_A']])
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])

    // (c) Reconcilierea nu poate citi factura → ALERT pentru verificare MANUALĂ,
    //     200: o reluare ar găsi profilul pe sub_B și n-ar mai ajunge aici.
    ;({ events, w } = setup())
    state.stripeImpls['invoices.retrieve'] = async () => { throw stripeErr('timeout', { type: 'StripeConnectionError' }) }
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(events.get('evt_sub_B').status, 'completed')
    assert.deepEqual([row().stripe_subscription_id, row().plan], ['sub_B', 'growth'])
    assert.equal(refundsCreated().length, 0)
    const alert = r.lines.find((l) => l.includes('ALERT replaced subscription REFUND CHECK'))
    assert.ok(alert, r.lines.join('\n'))
    for (const f of ['user=u1', 'canceled=sub_A', 'kept=sub_B', 'invoice=in_A', 'MANUAL']) {
      assert.ok(alert.includes(f), `lipsește ${f} din ${alert}`)
    }
  })

  it('DUP36: rambursarea dublurii primește o eroare SALVATĂ de Stripe pe cheia ei (500 reluat, `idempotent-replayed`) → la reluare: refund=manual + ALERT cu factura, abonamentul și cheia, 200 (nu 500 în buclă), NICIO rambursare creată; prima eroare (ne-reluată) rămâne 500', async () => {
    const saved = { message: 'An unknown error occurred', props: { type: 'StripeAPIError', statusCode: 500 } }

    // (a) Reîncercarea din charge.refund.updated (cheia `…_retry1`).
    let events = stripeEventsTable()
    let w = stripeWorld({
      invoices: { in_B: paidInvoice('pi_B') },
      refunds: { pi_B: [{ id: 're_x', amount: 24900, status: 'failed', failure_reason: 'unknown' }] },
    })
    w.failNext.refundSaved = saved
    let r = await withLogs(() => fire('charge.refund.updated', ourRefund(), { eventId: 'evt_rf' }))
    assert.equal(r.out.statusCode, 500, r.out.body)
    assert.equal(events.get('evt_rf').status, 'failed')
    for (const eventId of ['evt_rf', 'evt_rf_again']) {
      r = await withLogs(() => fire('charge.refund.updated', ourRefund(), { eventId }))
      assert.equal(r.out.statusCode, 200, `${eventId}: ${r.out.body}`)
      assert.equal(events.get(eventId).status, 'completed', eventId)
      const alert = r.lines.find((l) => l.includes('ALERT duplicate subscription sub_B: factura in_B') && l.includes('replay idempotent'))
      assert.ok(alert, `${eventId}: ${r.lines.join('\n')}`)
      for (const f of ['500', 'rambursare MANUALĂ', 'idempotency_key=dupsub_refund_in_B_retry1', 'Refunds']) {
        assert.ok(alert.includes(f), `${eventId}: lipsește ${f} din ${alert}`)
      }
      assert.ok(r.logs.some((l) => l.includes('refund retry after re_x failed: refund=manual')), `${eventId}: ${r.logs.join('\n')}`)
    }
    assert.deepEqual(refundsCreated().map((c) => c.args[1].idempotencyKey),
      ['dupsub_refund_in_B_retry1', 'dupsub_refund_in_B_retry1', 'dupsub_refund_in_B_retry1'], 'niciodată o cheie nouă')
    assert.deepEqual(w.refunds.pi_B.map((x) => x.status), ['failed'], 'nicio rambursare creată')

    // (b) Prima rambursare de la finalizare (cheia `dupsub_refund_<factură>`).
    resetMocks(); setEnv()
    events = stripeEventsTable()
    useProfiles([{ id: 'u1', plan: 'growth', stripe_subscription_id: 'sub_A' }])
    w = stripeWorld({ subs: { sub_A: paidSub('in_A'), sub_B: paidSub('in_B') }, invoices: { in_B: paidInvoice('pi_B') } })
    w.failNext.refundSaved = saved
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 500, r.out.body)
    r = await withLogs(() => checkout('sub_B'))
    assert.equal(r.out.statusCode, 200, r.out.body)
    assert.equal(events.get('evt_sub_B').status, 'completed')
    assert.equal(cancels().length, 1)
    assert.deepEqual(refundsCreated().map((c) => c.args[1].idempotencyKey), ['dupsub_refund_in_B', 'dupsub_refund_in_B'])
    assert.equal((w.refunds.pi_B || []).length, 0)
    assert.ok(r.logs.some((l) => l.includes('settled: cancel=already refund=manual')), r.logs.join('\n'))
    assert.ok(r.lines.some((l) => l.includes('idempotency_key=dupsub_refund_in_B') && l.includes('replay idempotent')), r.lines.join('\n'))
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
