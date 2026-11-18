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
//   SP1  REGULA DE AUR: un POST direct {plan:'pro'|'enterprise'} → 403
//        `plan_requires_quote`, ZERO apeluri Stripe/Supabase — Planul 3 nu se
//        vinde self-serve (decizia D4); UI-ul ascunde butonul, dar serverul e
//        singura graniță de autorizare;
//   SP2  refuzul nu depinde de majuscule și poartă mesaj românesc + adresa de ofertă;
//   SP3  control pozitiv: starter/growth trec în continuare (altfel SP1 ar
//        trece și cu funcția stricată de tot);
//   SR1  success_url poartă planul CUMPĂRAT (`checkout_plan=`) — clientul
//        anunță „planul e activ" doar când profilul îl are exact pe acela.
//
// Lotul L8d (erorile în limba personalului + limba paginii Stripe). Prefixele
// SCK/SLC: FC1–FC3 sunt ale featuresCountry.test.ts, SL1–SL7b ale
// soldOut.test.ts (verificat cu grep în src/, tests/, bridge/, supabase/tests).
//   SCK1 FIECARE ramură non-2xx JSON → statusul și `code`-ul ei, iar `error`
//        rămâne textul de DINAINTE, exact (un client vechi îl afișează ca
//        atare); corpul are DOAR cheile `error` + `code`. Tabelul are câte un
//        rând pe ramură (16 — registrul FEC2 din fn-error-code-ratchet.test.js);
//        rândul Planului 3 cere textul legacy COMPLET (instalarea pe casă +
//        adresa), nu un fragment. Ramurile NOI ale lotului (`checkout_create_failed`,
//        `checkout_in_progress`) n-au „text de dinainte”: textul lor e cel nou.
//        [PICĂ: un cod scos sau redenumit; un text schimbat]
//   SCK2 Stripe aruncă la crearea SESIUNII → 502 `checkout_create_failed`, cu
//        text românesc care numește adresa de contact (înainte: excepție
//        neprinsă, fără corp de contract; rezerva clientului spunea „scrie-ne
//        pe email”). [PICĂ: try/catch-ul scos — handler-ul aruncă; adresa scoasă]
//   SCK3 Stripe aruncă la crearea CLIENTULUI → același 502, fără nicio sesiune.
//        [PICĂ: try/catch-ul de pe customers.create scos]
//   SCK4 Stripe respinge cheia de idempotență (aceeași cheie, ALT corp — un tab
//        vechi fără `ui_lang` și unul nou, sau limba schimbată în fereastră)
//        → 409 `checkout_in_progress`, text românesc, FĂRĂ mesajul englezesc
//        al Stripe; recunoscută după `type` (clasa SDK-ului) SAU `rawType`
//        (tipul brut) — pe alt status decât 400/404 SDK-ul dă `StripeAPIError`
//        și tipul rămâne DOAR în `rawType`. Control: orice altă eroare Stripe
//        rămâne 502, inclusiv 409 `idempotency_key_in_use` (cerere CONCURENTĂ
//        cu aceeași cheie și același corp = dublu-click, tranzitoriu).
//        [PICĂ: un catch care înghite idempotency_error ca 502; mesajul
//        Stripe trimis clientului; `rawType` scos din `isIdempotencyConflict`;
//        verificarea lărgită după `statusCode === 409` sau după `code`]
//   SLC1 `ui_lang` valid → `locale` în parametrii sesiunii, normalizat
//        (' FR ' → 'fr'). CONTROL POZITIV pentru SLC2/SLC3: fără el, „nu pune
//        locale” ar trece și pe o funcție care nu-l pune niciodată.
//        [PICĂ: spread-ul `locale` scos din sessions.create]
//   SLC2 `ui_lang` absent → cheia `locale` LIPSEȘTE (nu `undefined`, nu 'auto'):
//        Stripe rămâne pe „auto”, exact ca înainte.
//   SLC3 `ui_lang` invalid ('xx', 'en-US', 42, '<b>ro</b>', null, {}) → fără
//        `locale`. [PICĂ: `body.ui_lang` trimis brut lui Stripe]
//   SLC4 cheia de idempotență NU poartă limba (`checkout_v7_`): cu ceasul
//        ÎNGHEȚAT în aceeași fereastră de 30 de minute și `STRIPE_TRIAL_DAYS=30`
//        explicit, ro / en / „auto” (fără `ui_lang`) dau aceeași cheie COMPLETĂ,
//        iar corpurile chiar diferă (`locale`) — deci Stripe vede un conflict
//        (SCK4), nu deschide a doua sesiune completabilă = al doilea abonament.
//        Control pozitiv: alt plan → altă cheie (cheia nu e o constantă).
//        [PICĂ: limba reintrodusă în cheie — două sesiuni pentru același plan]

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

// ── Lotul L8d: un cod stabil pe fiecare ramură + limba paginii Stripe ────────
function scriptedHappyPath(overrides = {}) {
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
  Object.assign(state.stripeImpls, overrides)
}

async function quiet(fn) {
  const saved = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = saved
  }
}

const AUTH = { authorization: 'Bearer tok' }

// Textele ramurilor noi ale lotului L8d (fără „text de dinainte”).
const CREATE_FAILED_RO =
  'Nu am putut porni plata. Reîncearcă în câteva momente, iar dacă se repetă scrie-ne la contact@menuvia.ro.'
const IN_PROGRESS_RO =
  'Ai deja o plată începută în alt tab sau în altă limbă. Finalizeaz-o acolo sau reîncearcă peste 30 de minute.'

// Eroarea pe care SDK-ul REAL o aruncă pentru `error.type === 'idempotency_error'`
// (forma ținută de SDK8b în tests/stripe-contract/handlers.test.js).
const STRIPE_IDEMPOTENCY_MSG =
  "Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'k' if you meant to execute a different request."
function idempotencyError(fields = { type: 'StripeIdempotencyError', rawType: 'idempotency_error' }) {
  return Object.assign(new Error(STRIPE_IDEMPOTENCY_MSG), { statusCode: 400 }, fields)
}

// [nume, pregătire, corp, antete, status, cod, text EXACT (sau regex)]
const BRANCHES = [
  ['env lipsă', () => {}, { plan: 'growth' }, AUTH, 500, 'server_config', 'Stripe not configured'],
  ['corp non-JSON', setEnv, '{nu e json', AUTH, 400, 'bad_json', 'Invalid JSON body'],
  ['plan fără price ID', setEnv, { plan: 'inexistent' }, AUTH, 400, 'plan_unavailable',
    'Plan "inexistent" indisponibil sau neconfigurat în Stripe'],
  ['Planul 3', setEnv, { plan: 'pro' }, AUTH, 403, 'plan_requires_quote',
    'Planul Fiscalizare se activează pe bază de ofertă, împreună cu instalarea pe casa ta de marcat. Scrie-ne la contact@menuvia.ro.'],
  ['host .com', setEnv, { plan: 'growth' }, { ...AUTH, host: 'menuvia.com' }, 403,
    'site_checkout_unavailable', 'Checkout is not available on this site yet.'],
  ['fără antet', setEnv, { plan: 'growth' }, {}, 401, 'auth_missing', 'Missing Authorization header'],
  ['token invalid', () => { setEnv(); state.authUser = null }, { plan: 'growth' }, AUTH, 401,
    'auth_invalid', 'Invalid token'],
  ['limiter: eroare RPC', () => {
    scriptedHappyPath()
    state.rpcHandlers['check_rate_limit'] = () => ({ data: null, error: { message: 'boom' } })
  }, { plan: 'growth' }, AUTH, 503, 'rate_limit_unavailable', 'Rate limit service unavailable'],
  ['limiter: excepție', () => {
    scriptedHappyPath()
    state.rpcHandlers['check_rate_limit'] = () => { throw new Error('conn reset') }
  }, { plan: 'growth' }, AUTH, 503, 'rate_limit_unavailable', 'Rate limit service unavailable'],
  ['peste plafon', () => {
    scriptedHappyPath()
    state.rpcHandlers['check_rate_limit'] = () => ({ data: false, error: null })
  }, { plan: 'growth' }, AUTH, 429, 'rate_limited', 'Prea multe încercări. Reîncearcă în câteva minute.'],
  ['profil necitibil', () => {
    scriptedHappyPath()
    state.fromHandlers['profiles'] = () => ({ data: null, error: { message: 'timeout' } })
  }, { plan: 'growth' }, AUTH, 503, 'service_unavailable', 'Serviciu temporar indisponibil. Reîncearcă.'],
  ['Stripe: client nou eșuat', () => {
    scriptedHappyPath()
    state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: null, email: 'a@x.test' }, error: null })
    state.stripeImpls['customers.create'] = async () => { throw new Error('stripe down') }
  }, { plan: 'growth' }, AUTH, 502, 'checkout_create_failed', CREATE_FAILED_RO],
  ['istoric necitibil', () => {
    scriptedHappyPath({ 'subscriptions.list': async () => { throw new Error('stripe down') } })
  }, { plan: 'growth' }, AUTH, 503, 'subscription_lookup_failed',
    'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.'],
  ['abonament activ', () => {
    scriptedHappyPath({ 'subscriptions.list': async () => [{ status: 'active' }] })
  }, { plan: 'growth' }, AUTH, 409, 'subscription_exists',
    'Ai deja un abonament. Schimbă planul din Portalul de facturare.'],
  ['Stripe: sesiune respinsă', () => {
    scriptedHappyPath({ 'checkout.sessions.create': async () => { throw Object.assign(new Error('No such price'), { type: 'StripeInvalidRequestError' }) } })
  }, { plan: 'growth' }, AUTH, 502, 'checkout_create_failed', CREATE_FAILED_RO],
  ['Stripe: plată deja pornită (cheie cu alt corp)', () => {
    scriptedHappyPath({ 'checkout.sessions.create': async () => { throw idempotencyError() } })
  }, { plan: 'growth' }, AUTH, 409, 'checkout_in_progress', IN_PROGRESS_RO],
]

describe('stripe-checkout — un cod stabil pe fiecare ramură (lotul L8d)', () => {
  it('SCK1: fiecare ramură non-2xx → status + code, cu textul de dinainte', async () => {
    assert.equal(BRANCHES.length, 16, 'un rând pe ramură (registrul FEC2)')
    const codes = new Set()
    for (const [name, prep, body, headers, status, code, text] of BRANCHES) {
      resetMocks()
      clearEnv()
      prep()
      const res = await quiet(() => post(body, headers))
      assert.equal(res.statusCode, status, name)
      const b = parseBody(res)
      assert.equal(b.code, code, name)
      if (text instanceof RegExp) assert.match(b.error, text, name)
      else assert.equal(b.error, text, name)
      assert.deepEqual(Object.keys(b).sort(), ['code', 'error'], `${name}: alte chei în corp`)
      codes.add(`${status}:${code}`)
    }
    // Două ramuri împart deliberat un cod (limiterul: eroare / excepție;
    // Stripe: client / sesiune) — restul sunt distincte.
    assert.equal(codes.size, 14)
  })

  it('SCK2: Stripe respinge sesiunea → 502 checkout_create_failed, nu excepție', async () => {
    scriptedHappyPath({ 'checkout.sessions.create': async () => { throw new Error('No such price') } })
    const res = await quiet(() => post({ plan: 'growth' }))
    assert.equal(res.statusCode, 502)
    assert.equal(parseBody(res).code, 'checkout_create_failed')
    assert.match(parseBody(res).error, /[ăâîșț]/, 'mesajul e românesc')
    // Ruta de suport dacă se repetă: aceeași adresă ca refuzul Planului 3.
    assert.match(parseBody(res).error, /dacă se repetă scrie-ne la contact@menuvia\.ro\.$/)
  })

  it('SCK3: Stripe respinge clientul nou → același 502, fără nicio sesiune', async () => {
    scriptedHappyPath()
    state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: null, email: 'a@x.test' }, error: null })
    state.stripeImpls['customers.create'] = async () => { throw new Error('stripe down') }
    const res = await quiet(() => post({ plan: 'growth' }))
    assert.equal(res.statusCode, 502)
    assert.equal(parseBody(res).code, 'checkout_create_failed')
    assert.equal(state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create').length, 0)
  })
})

describe('stripe-checkout — plata deja pornită (cheia de idempotență, lotul L8d)', () => {
  it('SCK4: idempotency_error → 409 checkout_in_progress, fără mesajul englezesc al Stripe', async () => {
    // Ambele câmpuri, apoi fiecare SINGUR: clasa SDK-ului (`type`) și tipul
    // brut al API-ului (`rawType`) sunt, fiecare, suficiente.
    for (const fields of [
      { type: 'StripeIdempotencyError', rawType: 'idempotency_error' },
      { type: 'StripeIdempotencyError' },
      { rawType: 'idempotency_error' },
      // Forma SDK-ului REAL pe un status ≠ 400/404 (SDK8b): clasa e generică,
      // tipul brut e singurul semnal.
      { type: 'StripeAPIError', rawType: 'idempotency_error', statusCode: 409 },
    ]) {
      resetMocks()
      clearEnv()
      scriptedHappyPath({ 'checkout.sessions.create': async () => { throw idempotencyError(fields) } })
      const res = await quiet(() => post({ plan: 'growth', ui_lang: 'ro' }))
      const where = JSON.stringify(fields)
      assert.equal(res.statusCode, 409, where)
      const b = parseBody(res)
      assert.deepEqual(b, { error: IN_PROGRESS_RO, code: 'checkout_in_progress' }, where)
      assert.ok(!res.body.includes('idempotent'), `${where}: mesajul Stripe a ajuns la client`)
    }
  })

  it('SCK4 (control): orice altă eroare Stripe la sesiune rămâne 502 checkout_create_failed', async () => {
    for (const fields of [
      { type: 'StripeInvalidRequestError', rawType: 'invalid_request_error' },
      { type: 'StripeAPIError', rawType: 'api_error' },
      { type: 'StripeConnectionError' },
      // Cerere CONCURENTĂ cu aceeași cheie și același corp (dublu-click), forma
      // SDK-ului REAL pe 409 (SDK8b): tranzitoriu, nu „peste 30 de minute”.
      { type: 'StripeAPIError', rawType: 'invalid_request_error', code: 'idempotency_key_in_use', statusCode: 409 },
      {},
    ]) {
      resetMocks()
      clearEnv()
      scriptedHappyPath({
        'checkout.sessions.create': async () => { throw Object.assign(new Error('boom'), fields) },
      })
      const res = await quiet(() => post({ plan: 'growth' }))
      const where = JSON.stringify(fields)
      assert.equal(res.statusCode, 502, where)
      assert.deepEqual(parseBody(res), { error: CREATE_FAILED_RO, code: 'checkout_create_failed' }, where)
    }
  })
})

describe('stripe-checkout — limba paginii Stripe (lotul L8d)', () => {
  async function sessionFor(body) {
    resetMocks()
    clearEnv()
    scriptedHappyPath()
    const res = await post({ plan: 'growth', ...body })
    assert.equal(res.statusCode, 200, res.body)
    const calls = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')
    assert.equal(calls.length, 1)
    return { params: calls[0].args[0], key: calls[0].args[1].idempotencyKey }
  }

  it('SLC1 (control pozitiv): ui_lang valid → locale, normalizat', async () => {
    for (const [ui, want] of [['en', 'en'], ['ro', 'ro'], ['de', 'de'], [' FR ', 'fr']]) {
      const { params } = await sessionFor({ ui_lang: ui })
      assert.equal(params.locale, want, JSON.stringify(ui))
    }
  })

  it('SLC2: ui_lang absent → fără cheia locale (Stripe „auto”, ca înainte)', async () => {
    const { params } = await sessionFor({})
    assert.equal(Object.prototype.hasOwnProperty.call(params, 'locale'), false)
  })

  it('SLC3: ui_lang invalid → fără locale', async () => {
    for (const ui of ['xx', 'en-US', 'it', 42, '<b>ro</b>', null, {}, ['en'], '']) {
      const { params } = await sessionFor({ ui_lang: ui })
      assert.equal(Object.prototype.hasOwnProperty.call(params, 'locale'), false, JSON.stringify(ui))
    }
  })

  it('SLC4: cheia de idempotență NU poartă limba (v7) — o singură plată pe fereastră', async () => {
    // Ceasul ÎNGHEȚAT (nu tăiem sufixul ferestrei: comparăm cheile COMPLETE) și
    // trialul EXPLICIT (segmentul `_30_` nu mai depinde de implicitul din cod).
    const FROZEN = Date.UTC(2026, 10, 18, 10, 7, 0)
    const WINDOW = String(Math.floor(FROZEN / (30 * 60 * 1000)))
    const savedNow = Date.now
    const savedTrial = Object.prototype.hasOwnProperty.call(process.env, 'STRIPE_TRIAL_DAYS')
      ? process.env.STRIPE_TRIAL_DAYS
      : undefined
    Date.now = () => FROZEN
    process.env.STRIPE_TRIAL_DAYS = '30'
    try {
      const ro = await sessionFor({ ui_lang: 'ro' })
      const auto = await sessionFor({})
      const en = await sessionFor({ ui_lang: 'en' })
      const en2 = await sessionFor({ ui_lang: 'en' })
      assert.match(ro.key, new RegExp(`^checkout_v7_[0-9a-f]{10}_u1_growth_none_30_${WINDOW}$`))
      assert.equal(auto.key, ro.key, 'ro și „auto” (tab vechi, fără ui_lang) → aceeași cheie')
      assert.equal(en.key, ro.key, 'altă limbă → aceeași cheie (Stripe respinge corpul diferit)')
      assert.equal(en2.key, en.key, 'aceeași cerere → aceeași cheie (dedup)')
      // Corpurile chiar diferă — altfel egalitatea cheilor n-ar dovedi nimic.
      assert.equal(ro.params.locale, 'ro')
      assert.equal(Object.prototype.hasOwnProperty.call(auto.params, 'locale'), false)
      assert.equal(en.params.locale, 'en')
      for (const lang of ['ro', 'en', 'fr', 'de', 'auto']) {
        assert.ok(!ro.key.includes(`_${lang}_`), `segment de limbă „${lang}” în cheie`)
      }
      // Control pozitiv: cheia nu e o constantă — alt plan dă altă cheie.
      resetMocks()
      clearEnv()
      scriptedHappyPath()
      await post({ plan: 'starter', ui_lang: 'ro' })
      const starter = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')[0]
      assert.notEqual(starter.args[1].idempotencyKey, ro.key)
      assert.match(starter.args[1].idempotencyKey, /_u1_starter_none_30_/)
    } finally {
      Date.now = savedNow
      if (savedTrial === undefined) delete process.env.STRIPE_TRIAL_DAYS
      else process.env.STRIPE_TRIAL_DAYS = savedTrial
    }
  })
})
