// tests/functions/stripe-checkout.test.js
// Suprafața de EROARE a funcției de checkout — cel mai scump click din produs.
//
// De ce există: clientul trata DOUĂ dintre cele nouă răspunsuri non-200, deci
// restul lăsau butonul mut. Reparația e pe client (`lib/checkout.ts`), dar ea
// se sprijină pe forma răspunsurilor de aici: dacă un status sau un `code` se
// schimbă în funcție fără să se schimbe și maparea, omul vede iar tăcere.
// Testele astea îngheață CONTRACTUL dintre cele două.
//
//   SC1  metodă greșită → 405, corp TEXT (nu JSON) — clientul trebuie să
//        supraviețuiască unui `res.json()` care aruncă;
//   SC2  fără env (cazul REAL de azi pe producție) → 500 „Stripe not configured";
//   SC3  corp non-JSON → 400, fără crash;
//   SC4  plan fără price ID → 400 cu numele planului în mesaj;
//   SC5  fără antet de autorizare → 401;
//   SC6  token invalid → 401;
//   SC7  limiterul căzut → 503 fail-closed; peste plafon → 429;
//   SC8  interogarea de profil picată → 503 (nu creează un customer duplicat).
//
// RES-11 — trialul FĂRĂ card (ramura 200, netestabilă până când FakeStripe a
// primit namespace-ul `checkout`):
//   SC12 growth fără istoric → `payment_method_collection` pe SESIUNE (nu în
//        subscription_data), `trial_settings.missing_payment_method=cancel` ÎN
//        subscription_data, trial 30, datele de facturare cerute, cheie v5;
//   SC13 trial deja folosit → nicio cheie de trial, dar datele de facturare DA;
//   SC14 STRIPE_TRIAL_DAYS=0 → nicio cheie de trial;
//   SC15 pro/enterprise → nicio cheie de trial (gate server-side, regula de aur);
//   SC16 Stripe respinge crearea sesiunii → 502 `checkout_create_failed`, românește;
//   SC17 STRIPE_TRIAL_DAYS invalid ('30abc', '3000') → 30, nu Stripe-ul respins.
//
// Planul 3 + origine (PR #302 / main):
//   SP1  REGULA DE AUR: un POST direct {plan:'pro'|'enterprise'} → 403
//        `plan_requires_quote`, ZERO apeluri Stripe/Supabase — Planul 3 nu se
//        vinde self-serve (decizia D4); UI-ul ascunde butonul, dar serverul e
//        singura graniță de autorizare;
//   SP2  refuzul nu depinde de majuscule și poartă mesaj românesc + adresa de ofertă;
//   SP3  control pozitiv: starter/growth trec în continuare (altfel SP1 ar
//        trece și cu funcția stricată de tot);
//   SR1  success_url poartă planul CUMPĂRAT (`checkout_plan=`) — clientul
//        anunță „planul e activ" doar când profilul îl are exact pe acela.

'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, parseBody } = require('./helpers/mocks')

const { handler } = loadFunction('netlify/functions/stripe-checkout.js')

const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_STARTER_PRICE_ID',
  'STRIPE_GROWTH_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_ENTERPRISE_PRICE_ID',
  // Fără ele, un env al runner-ului sau un test care le setează contaminează
  // restul suitei (durata trialului, URL-urile de redirect).
  'STRIPE_TRIAL_DAYS',
  'VITE_APP_URL',
]

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

function setEnv() {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'
  process.env.STRIPE_SECRET_KEY = 'sk_test'
  process.env.STRIPE_STARTER_PRICE_ID = 'price_starter'
  process.env.STRIPE_GROWTH_PRICE_ID = 'price_growth'
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro'
  process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_enterprise'
}

function post(body, headers = { authorization: 'Bearer tok' }) {
  return handler({
    httpMethod: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  resetMocks()
  clearEnv()
})

describe('stripe-checkout — suprafața de eroare', () => {
  it('SC-COM: cererea rutată pe menuvia.com → 403 site_checkout_unavailable, fără Stripe', async () => {
    const res = await post({ plan: 'growth' }, { authorization: 'Bearer tok', host: 'menuvia.com' })
    assert.equal(res.statusCode, 403)
    assert.equal(JSON.parse(res.body).code, 'site_checkout_unavailable')
    for (const host of ['www.menuvia.com', 'MENUVIA.COM:443', 'menuvia.com.']) {
      const r = await post({ plan: 'growth' }, { authorization: 'Bearer tok', host })
      assert.equal(r.statusCode, 403, host)
    }
  })

  it('SC-COM2: menuvia.ro / preview / menuvia.com.evil.com NU sunt blocate de garda de piață', async () => {
    for (const host of ['menuvia.ro', 'deploy-preview-1--menuvia.netlify.app', 'menuvia.com.evil.com', 'evilmenuvia.com']) {
      const r = await post({ plan: 'growth' }, { authorization: 'Bearer tok', host })
      assert.notEqual(r.statusCode, 403, host)
    }
  })

  it('SC1: metodă greșită → 405 cu corp TEXT, nu JSON', async () => {
    setEnv()
    const res = await handler({ httpMethod: 'GET', headers: {}, body: null })
    assert.equal(res.statusCode, 405)
    // Contractul pe care se bazează clientul: aici `res.json()` ARUNCĂ.
    assert.throws(() => JSON.parse(res.body))
  })

  it('SC2: fără env → 500 „Stripe not configured" (starea de azi a producției)', async () => {
    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 500)
    assert.equal(parseBody(res).error, 'Stripe not configured')
  })

  it('SC2b: un singur price ID lipsă e tot 500 — fără fallback tăcut', async () => {
    setEnv()
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID
    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 500)
  })

  it('SC3: corp non-JSON → 400, fără excepție neprinsă', async () => {
    setEnv()
    const res = await post('{nu e json')
    assert.equal(res.statusCode, 400)
    assert.equal(parseBody(res).error, 'Invalid JSON body')
  })

  it('SC4: plan fără price ID → 400 și mesajul numește planul', async () => {
    setEnv()
    const res = await post({ plan: 'inexistent' })
    assert.equal(res.statusCode, 400)
    assert.match(parseBody(res).error, /inexistent/)
  })

  it('SC5: fără antet de autorizare → 401', async () => {
    setEnv()
    const res = await post({ plan: 'growth' }, {})
    assert.equal(res.statusCode, 401)
    assert.equal(parseBody(res).error, 'Missing Authorization header')
  })

  it('SC6: token invalid → 401', async () => {
    setEnv()
    state.authUser = null // fail-closed în harness
    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 401)
    assert.equal(parseBody(res).error, 'Invalid token')
  })

  it('SC7: limiterul căzut → 503 fail-closed; peste plafon → 429', async () => {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }

    state.rpcHandlers['check_rate_limit'] = () => ({
      data: null,
      error: { message: 'boom' },
    })
    const down = await post({ plan: 'growth' })
    assert.equal(down.statusCode, 503)
    assert.equal(parseBody(down).error, 'Rate limit service unavailable')

    state.rpcHandlers['check_rate_limit'] = () => ({ data: false, error: null })
    const limited = await post({ plan: 'growth' })
    assert.equal(limited.statusCode, 429)
    assert.match(parseBody(limited).error, /Prea multe încercări/)
  })

  it('SC8: profilul necitibil → 503, nu customer Stripe duplicat', async () => {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({ data: null, error: { message: 'timeout' } })

    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 503)
    assert.match(parseBody(res).error, /temporar indisponibil/i)
    // Niciun apel de creare de customer nu trebuie să fi plecat spre Stripe.
    assert.equal(state.stripeCalls.length, 0)
  })

  it('SC10: abonament deja activ → 409 cu code `subscription_exists`', async () => {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['subscriptions.list'] = async () => [{ status: 'active' }]

    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 409)
    // `code` e cheia pe care clientul ramifică ÎNAINTEA statusului
    // (describeCheckoutFailure) — dacă dispare, banner-ul pierde butonul de
    // Portal de facturare și omul e trimis să plătească a doua oară.
    assert.equal(parseBody(res).code, 'subscription_exists')
  })

  it('SC11: istoricul de abonamente necitibil → 503 `subscription_lookup_failed`, fail-closed', async () => {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['subscriptions.list'] = async () => {
      throw new Error('stripe down')
    }

    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 503)
    assert.equal(parseBody(res).code, 'subscription_lookup_failed')
    // Fail-closed: nicio sesiune de checkout nu pleacă fără verificarea istoricului.
    assert.equal(state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create').length, 0)
  })

  it('SC9: toate răspunsurile de eroare JSON au cheia `error`', async () => {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: false, error: null })
    const res = await post({ plan: 'growth' })
    const body = parseBody(res)
    assert.ok(typeof body.error === 'string' && body.error.length > 0)
  })

  it('SR1: success_url poartă `checkout_plan=<plan cumpărat>`, cancel_url neschimbat', async () => {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['subscriptions.list'] = async () => []
    state.stripeImpls['checkout.sessions.create'] = async () => ({
      url: 'https://checkout.stripe.com/c/pay/cs_test',
    })

    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 200)
    const calls = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')
    assert.equal(calls.length, 1)
    const params = calls[0].args[0]
    const success = new URL(params.success_url)
    assert.equal(success.pathname, '/dashboard')
    assert.equal(success.searchParams.get('checkout'), 'success')
    assert.equal(success.searchParams.get('checkout_plan'), 'growth')
    // `plan=` e intenția de pe /auth — nu are voie să apară în URL-ul de întoarcere.
    assert.equal(success.searchParams.get('plan'), null)
    assert.equal(new URL(params.cancel_url).search, '?checkout=cancelled')
  })
})

describe('stripe-checkout — Planul 3 nu se vinde self-serve (regula de aur, D4)', () => {
  function happyPath() {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['subscriptions.list'] = async () => []
    state.stripeImpls['checkout.sessions.create'] = async () => ({
      url: 'https://checkout.stripe.com/c/pay/cs_test',
    })
  }

  it('SP1: pro și enterprise → 403 plan_requires_quote, fără nicio sesiune Stripe', async () => {
    for (const plan of ['pro', 'enterprise']) {
      resetMocks()
      happyPath()
      const res = await post({ plan })
      assert.equal(res.statusCode, 403, plan)
      const body = parseBody(res)
      assert.equal(body.code, 'plan_requires_quote', plan)
      // Nimic nu pleacă spre Stripe (nici customer, nici sesiune) și nu se
      // atinge baza: nici rate-limit, nici profil, nici atribuire de afiliat.
      assert.equal(state.stripeCalls.length, 0, plan)
      assert.equal(state.rpcCalls.length, 0, plan)
      assert.equal(state.fromCalls.length, 0, plan)
    }
  })

  it('SP2: refuzul ignoră majusculele, e în română și numește adresa de ofertă', async () => {
    for (const plan of ['PRO', 'Pro', 'ENTERPRISE']) {
      resetMocks()
      happyPath()
      const res = await post({ plan, referral_code: 'abc123' })
      assert.equal(res.statusCode, 403, plan)
      const body = parseBody(res)
      assert.equal(body.code, 'plan_requires_quote')
      assert.match(body.error, /ofert/i)
      assert.match(body.error, /contact@menuvia\.ro/)
      assert.equal(state.stripeCalls.length, 0, plan)
    }
  })

  it('SP3 (control pozitiv): starter și growth trec în continuare spre Stripe', async () => {
    for (const plan of ['starter', 'growth']) {
      resetMocks()
      happyPath()
      const res = await post({ plan })
      assert.equal(res.statusCode, 200, plan)
      const created = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')
      assert.equal(created.length, 1, plan)
    }
  })
})

describe('stripe-checkout — trialul fără card (RES-11)', () => {
  // Setup-ul unui checkout care AJUNGE la crearea sesiunii: env complet, user
  // valid, limiter OK, customer existent, istoric de abonamente scriptat.
  function scriptHappyPath(history = []) {
    setEnv()
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['subscriptions.list'] = async () => history
    state.stripeImpls['checkout.sessions.create'] = async () => ({ url: 'https://checkout.stripe.com/c/x' })
  }
  function sessionCall() {
    const calls = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')
    assert.equal(calls.length, 1, 'exact o sesiune de checkout')
    return { params: calls[0].args[0], opts: calls[0].args[1] }
  }
  function assertNoTrialKeys(params) {
    assert.ok(!('payment_method_collection' in params), 'fără payment_method_collection')
    assert.ok(!('trial_period_days' in params.subscription_data), 'fără trial_period_days')
    assert.ok(!('trial_settings' in params.subscription_data), 'fără trial_settings')
  }

  it('SC12: growth fără istoric → trial 30 fără card, cheile în locurile corecte', async () => {
    scriptHappyPath([])
    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 200)
    assert.equal(parseBody(res).url, 'https://checkout.stripe.com/c/x')
    const { params, opts } = sessionCall()
    // Pe SESIUNE — în subscription_data, Stripe respinge cererea.
    assert.equal(params.payment_method_collection, 'if_required')
    assert.ok(!('payment_method_collection' in params.subscription_data))
    assert.equal(params.subscription_data.trial_period_days, 30)
    assert.deepEqual(params.subscription_data.trial_settings, {
      end_behavior: { missing_payment_method: 'cancel' },
    })
    // Datele de facturare pentru factura SRL-ului; customer_update e obligatoriu
    // cu un customer existent.
    assert.deepEqual(params.tax_id_collection, { enabled: true })
    assert.equal(params.billing_address_collection, 'required')
    assert.deepEqual(params.customer_update, { name: 'auto', address: 'auto' })
    assert.equal(params.subscription_data.metadata.plan, 'growth')
    assert.match(opts.idempotencyKey, /^checkout_v5_[0-9a-f]{10}_u1_growth_none_30_\d+$/)
  })

  it('SC13: trial deja folosit → fără chei de trial, dar cu datele de facturare', async () => {
    scriptHappyPath([{ status: 'canceled', trial_start: 1, trial_end: 2 }])
    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 200)
    const { params, opts } = sessionCall()
    assertNoTrialKeys(params)
    assert.deepEqual(params.tax_id_collection, { enabled: true })
    assert.match(opts.idempotencyKey, /^checkout_v5_[0-9a-f]{10}_u1_growth_none_0_\d+$/)
  })

  it('SC14: STRIPE_TRIAL_DAYS=0 → trial dezactivat, fără chei de trial', async () => {
    scriptHappyPath([])
    process.env.STRIPE_TRIAL_DAYS = '0'
    const res = await post({ plan: 'starter' })
    assert.equal(res.statusCode, 200)
    assertNoTrialKeys(sessionCall().params)
  })

  for (const plan of ['pro', 'enterprise']) {
    it(`SC15: ${plan} → fără trial și fără sesiune (Plan 3 fără card ar da bon fiscal gratis)`, async () => {
      // Până la #302 acest caz ajungea la sesiune FĂRĂ chei de trial (200). Acum
      // Planul 3 e refuzat înainte de orice (SP1); aici rămâne invariantul din
      // perspectiva trialului: pe contul eligibil de trial, pro/enterprise NU
      // produc nicio sesiune, deci nici chei de trial.
      scriptHappyPath([])
      const res = await post({ plan })
      assert.equal(res.statusCode, 403)
      assert.equal(parseBody(res).code, 'plan_requires_quote')
      assert.equal(
        state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create').length,
        0,
        'pro/enterprise nu ajung la crearea sesiunii',
      )
    })
  }

  it('SC15b: starter primește trialul (planul e în TRIAL_PLANS)', async () => {
    scriptHappyPath([])
    const res = await post({ plan: 'starter' })
    assert.equal(res.statusCode, 200)
    const { params } = sessionCall()
    assert.equal(params.payment_method_collection, 'if_required')
    assert.equal(params.subscription_data.trial_period_days, 30)
  })

  it('SC16: Stripe respinge sesiunea → 502 `checkout_create_failed`, mesaj românesc', async () => {
    scriptHappyPath([])
    state.stripeImpls['checkout.sessions.create'] = async () => {
      const e = new Error('Received unknown parameter: subscription_data[payment_method_collection]')
      e.type = 'StripeInvalidRequestError'
      e.param = 'subscription_data[payment_method_collection]'
      throw e
    }
    const res = await post({ plan: 'growth' })
    assert.equal(res.statusCode, 502)
    const body = parseBody(res)
    assert.equal(body.code, 'checkout_create_failed')
    assert.match(body.error, /Reîncearcă/)
  })

  for (const raw of ['30abc', '3000', '-5', 'abc']) {
    it(`SC17: STRIPE_TRIAL_DAYS=${JSON.stringify(raw)} → 30 (nu un trial respins de Stripe)`, async () => {
      scriptHappyPath([])
      process.env.STRIPE_TRIAL_DAYS = raw
      const res = await post({ plan: 'growth' })
      assert.equal(res.statusCode, 200)
      assert.equal(sessionCall().params.subscription_data.trial_period_days, 30)
    })
  }

  it('SC17b: STRIPE_TRIAL_DAYS=14 → 14 (valoare validă respectată)', async () => {
    scriptHappyPath([])
    process.env.STRIPE_TRIAL_DAYS = '14'
    await post({ plan: 'growth' })
    assert.equal(sessionCall().params.subscription_data.trial_period_days, 14)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Intersecția #302 (Planul 3 doar prin ofertă) × #273 (trial fără card).
//
//   SX1  mulțimile sunt DISJUNCTE și oglindite în client: TRIAL_PLANS (server)
//        = TRIAL_PLAN_IDS (pricingCopy.ts), QUOTE_ONLY_PLANS (server) =
//        QUOTE_ONLY_PLAN_IDS (planCta.ts), iar intersecția e vidă. Un test
//        COMPORTAMENTAL nu poate păzi asta: refuzul quote-only precede logica de
//        trial, deci un `pro` strecurat în TRIAL_PLANS ar rămâne invizibil
//        (mutația „pro în TRIAL_PLANS" nu schimbă niciun răspuns) până în ziua
//        în care cineva scoate zăvorul quote-only — atunci ar da 30 de zile de
//        Plan 3 fără card;
//   SX2  pe un cont ELIGIBIL de trial (fără istoric, STRIPE_TRIAL_DAYS=30),
//        pro/enterprise → 403 și ZERO apeluri Stripe/DB;
//   SX3  la fel pe ramura cu customer NOU (profil fără stripe_customer_id):
//        refuzul precede și `customers.create` — ramura în care trialul sare
//        peste lookup-ul de abonamente (isFreshCustomer);
//   SX4  control pozitiv: pe același cont growth primește trial fără card și
//        starter la fel (altfel SX2/SX3 ar trece și cu trialul scos de tot).
// ─────────────────────────────────────────────────────────────────────────────
describe('stripe-checkout — intersecția Plan 3 doar prin ofertă × trial fără card', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const ROOT = path.resolve(__dirname, '..', '..')
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  const listFrom = (src, re, label) => {
    const m = re.exec(src)
    assert.ok(m, `${label} lipsește din sursă`)
    return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }

  it('SX1: TRIAL_PLANS ∩ QUOTE_ONLY_PLANS = ∅, ambele oglindite în client', () => {
    const server = read('netlify/functions/stripe-checkout.js')
    const trial = listFrom(server, /const TRIAL_PLANS = \[([^\]]*)\]/, 'TRIAL_PLANS')
    const quote = listFrom(server, /const QUOTE_ONLY_PLANS = \[([^\]]*)\]/, 'QUOTE_ONLY_PLANS')
    // Anti-vacuitate: ambele liste sunt ne-goale și conțin planurile așteptate.
    assert.deepEqual(trial.slice().sort(), ['growth', 'starter'])
    assert.deepEqual(quote.slice().sort(), ['enterprise', 'pro'])
    const both = trial.filter((p) => quote.includes(p))
    assert.deepEqual(both, [], `plan simultan cu trial ȘI doar-prin-ofertă: ${both.join(', ')}`)

    const clientTrial = listFrom(
      read('src/lib/pricingCopy.ts'),
      /export const TRIAL_PLAN_IDS: PlanId\[\] = \[([^\]]*)\]/,
      'TRIAL_PLAN_IDS',
    )
    const clientQuote = listFrom(
      read('src/lib/planCta.ts'),
      /export const QUOTE_ONLY_PLAN_IDS: readonly string\[\] = \[([^\]]*)\]/,
      'QUOTE_ONLY_PLAN_IDS',
    )
    assert.deepEqual(trial, clientTrial, 'TRIAL_PLANS diferă de TRIAL_PLAN_IDS din client')
    assert.deepEqual(quote, clientQuote, 'QUOTE_ONLY_PLANS diferă de QUOTE_ONLY_PLAN_IDS din client')
  })

  function eligibleAccount({ freshCustomer = false } = {}) {
    setEnv()
    process.env.STRIPE_TRIAL_DAYS = '30'
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: freshCustomer ? null : 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['customers.create'] = async () => ({ id: 'cus_new' })
    state.stripeImpls['subscriptions.list'] = async () => []
    state.stripeImpls['checkout.sessions.create'] = async () => ({ url: 'https://checkout.stripe.com/c/x' })
  }
  const untouched = (plan) => {
    assert.equal(state.stripeCalls.length, 0, `${plan}: apel Stripe înainte de refuz`)
    assert.equal(state.rpcCalls.length, 0, `${plan}: apel RPC înainte de refuz`)
    assert.equal(state.fromCalls.length, 0, `${plan}: apel DB înainte de refuz`)
  }

  for (const plan of ['pro', 'enterprise']) {
    it(`SX2: ${plan} pe cont eligibil de trial → 403, nicio sesiune, nicio atingere Stripe/DB`, async () => {
      eligibleAccount()
      const res = await post({ plan, referral_code: 'abc123' })
      assert.equal(res.statusCode, 403)
      assert.equal(parseBody(res).code, 'plan_requires_quote')
      untouched(plan)
    })

    it(`SX3: ${plan} pe ramura customer NOU → refuzul precede și customers.create`, async () => {
      eligibleAccount({ freshCustomer: true })
      const res = await post({ plan })
      assert.equal(res.statusCode, 403)
      assert.equal(parseBody(res).code, 'plan_requires_quote')
      untouched(plan)
      assert.equal(state.stripeCalls.filter((c) => c.name === 'customers.create').length, 0)
    })
  }

  for (const plan of ['starter', 'growth']) {
    it(`SX4 (control pozitiv): ${plan} pe același cont primește trial fără card`, async () => {
      eligibleAccount()
      const res = await post({ plan })
      assert.equal(res.statusCode, 200)
      const calls = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')
      assert.equal(calls.length, 1)
      const params = calls[0].args[0]
      assert.equal(params.payment_method_collection, 'if_required')
      assert.equal(params.subscription_data.trial_period_days, 30)
      assert.deepEqual(params.subscription_data.trial_settings, {
        end_behavior: { missing_payment_method: 'cancel' },
      })
    })
  }
})
