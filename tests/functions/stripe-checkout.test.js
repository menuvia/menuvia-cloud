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
//        rând pe ramură (17 — registrul FEC2 din fn-error-code-ratchet.test.js);
//        rândul Planului 3 cere textul legacy COMPLET (instalarea pe casă +
//        adresa), nu un fragment. Ramurile NOI ale lotului (`checkout_create_failed`,
//        `checkout_in_progress`, cele două căi ale lui) n-au „text de dinainte”:
//        textul lor e cel nou.
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
//   SCK5 textul pe care îl scrie HANDLER-UL REAL (FakeStripe) la 502
//        `checkout_create_failed` și la 409 `checkout_in_progress` e EXACT
//        rezerva clientului: `ck_createFailed` / `ck_checkoutInProgress` citite
//        din src/i18n/ns/home/ro.ts, cu `{email}` randat din `CONTACT_EMAIL`
//        citit din src/lib/domain.ts (`contact@${SITE_HOSTS.ro}` rezolvat din
//        sursă). Mutat din CH16 (vitest nu poate încărca handler-ul CJS): acolo
//        domeniul se substituia din `CONTACT_EMAIL`, deci o schimbare a lui
//        `MAIL_DOMAIN` pe server trecea. CH10 leagă apoi ro.ts de
//        `CHECKOUT_MESSAGES_RO`. Control: extractorul găsește fiecare cheie o
//        singură dată și refuză un șablon cu altă interpolare.
//        [PICĂ: `MAIL_DOMAIN` schimbat în appUrl.js; textul serverului schimbat
//        fără ro.ts; `CONTACT_EMAIL` mutat pe alt domeniu]
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
//
// O singură sesiune de abonament deschisă per client, la CREARE (recenzia
// CodeRabbit pe #384, runda 2). Prefixul SOS e liber (grep în src/, tests/,
// bridge/, supabase/tests).
//   SOS1 o sesiune deschisă pentru EXACT aceeași plată (plan, preț, trial din
//        `metadata` sesiunii + originea din `success_url`) → 200 cu URL-ul EI,
//        aceeași formă ca la creare, ZERO `sessions.create`, ZERO `expire`;
//        lista cerută cu `{ customer, created: { gte: <început fereastră − 25 h> },
//        limit: 100 }` — FĂRĂ filtru de stare (segmentul cheii cere și sesiunile
//        expirate/finalizate, SOS10–SOS12), cu ceasul înghețat.
//        [PICĂ: lista scoasă — se creează a doua sesiune; `status: 'open'`
//        readus; intervalul calculat din „acum”, nu din fereastră]
//   SOS2 o sesiune deschisă pentru ALT plan → `expire(id)` ÎNAINTEA creării,
//        apoi sesiunea nouă (ultimul click câștigă).
//        [PICĂ: reluarea fără verificarea planului (întoarce URL-ul planului
//        vechi); `expire` scos; `expire` după `create`]
//   SOS3 altă origine / alt preț / alt trial / fără metadate (sesiune creată de
//        codul de dinainte) / URL ne-https / expiră în 10 min / fără
//        `expires_at` → închisă și recreată; fiecare fixtură diferă de cea
//        reutilizabilă printr-UN SINGUR câmp (fixtura de bază expiră peste 24 h:
//        controlul pozitiv e SOS1).
//        [PICĂ: oricare dintre verificări scoasă din `isReusableSession`,
//        inclusiv cea pe `expires_at` — omul ar ajunge pe „sesiune expirată” în
//        timp ce plătește]
//   SOS3b pragul lui `expires_at` (`REUSE_MIN_LEFT_S` = 30 min): la exact 30 min
//        rămase → recreată; la 31 → reluată (control: verificarea nu respinge
//        orice sesiune care expiră cândva). [PICĂ: `>` slăbit la `>=`; pragul
//        coborât sub 30 min]
//   SOS4 lista aruncă / întoarce o formă fără `data` → 409
//        `checkout_in_progress` (fail-closed), ZERO create.
//   SOS5 `expire` aruncă → 409, ZERO create — și NICI URL-ul unei sesiuni
//        reutilizabile nu pleacă (ar rămâne două completabile).
//        [PICĂ: eșecul lui `expire` ignorat]
//   SOS6 client NOU (abia creat de cererea asta) → lista nu se cere.
//        Control: un client ADOPTAT după cursă (nu l-am creat noi) → se cere.
//   SOS7 o sesiune `mode: 'payment'` (credite AI, același client) sau a ALTUI
//        client nu se închide și nu se reia.
//   SOS8 două sesiuni reutilizabile (cursă / cod vechi + nou) → cea mai NOUĂ se
//        reia, cealaltă se închide.
//   SOS9 `has_more: true` → cele văzute se închid, dar nu se creează nimic (409):
//        o sesiune nevăzută ar rămâne completabilă.
//   SOS10 segmentul de stare al cheii = rezumatul MULȚIMII sesiunilor de
//        abonament ale clientului create în interval, din ORICE stare: niciuna →
//        `s0`; una → `s<hash>`; aceeași sesiune deschisă / expirată / finalizată
//        → ACEEAȘI cheie (starea nu intră — o închidere făcută de o cerere
//        concurentă nu-i schimbă cheia celeilalte); altă sesiune → altă cheie;
//        ordinea din listă nu contează; sesiunile `mode: 'payment'`, ale altui
//        client sau create înaintea intervalului (`created` = gte − 1) nu intră,
//        cea de la limită (`created` = gte) intră; id-ul nu apare în clar.
//        [PICĂ: segmentul scos din cheie; calculat doar din sesiunile închise de
//        cererea curentă (prima variantă) sau doar din cele deschise; filtrul pe
//        `mode` / client / `created` scos]
//   SOS11 CURSA (recenzia adversarială pe #384): o sesiune veche (starter)
//        deschisă, două cereri growth IDENTICE; a doua listează DUPĂ `expire`-ul
//        primei, cât crearea primei e încă în zbor → aceeași cheie pentru
//        amândouă (Stripe îi răspunde celei de-a doua 409
//        `idempotency_key_in_use` → 502 tranzitoriu, iar reîncercarea o REIA pe
//        a primei) și o SINGURĂ sesiune growth deschisă la final. Fake cu STARE
//        și cu idempotența Stripe (cheie în zbor → 409; aceeași cheie + același
//        corp → răspunsul salvat; alt corp → `idempotency_error`), lista
//        onorează `customer` / `status` / `created.gte`. Sesiunea veche e creată
//        o dată în fereastră și o dată înaintea ei.
//        [PICĂ: segmentul din sesiunile închise ACUM (prima variantă: `s<hash>`
//        vs `s0`, două sesiuni growth completabile)]
//   SOS12 o cheie NU se refolosește după sesiunea creată cu ea: growth → starter
//        (`expire` reușit, crearea pică → 502) → growth întoarce o sesiune
//        DESCHISĂ, cu altă cheie decât prima (nu URL-ul celei expirate), și la
//        fel din alt tab cu altă limbă (200, nu 409 `checkout_in_progress` până
//        la fereastra următoare); o sesiune FINALIZATĂ al cărei abonament s-a
//        anulat → growth din nou primește o sesiune nouă, deschisă.
//        [PICĂ: prima variantă — `s0` dă exact cheia sesiunii moarte, Stripe
//        reia răspunsul salvat; lista readusă la `status: 'open'`]

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
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
const IN_PROGRESS_RO = 'O plată pentru acest cont e deja în curs. Reîncearcă în câteva momente.'

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
  ['Stripe: sesiunile deschise necitibile', () => {
    scriptedHappyPath({ 'checkout.sessions.list': async () => { throw new Error('stripe down') } })
  }, { plan: 'growth' }, AUTH, 409, 'checkout_in_progress', IN_PROGRESS_RO],
]

describe('stripe-checkout — un cod stabil pe fiecare ramură (lotul L8d)', () => {
  it('SCK1: fiecare ramură non-2xx → status + code, cu textul de dinainte', async () => {
    assert.equal(BRANCHES.length, 17, 'un rând pe ramură (registrul FEC2)')
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
    // Trei perechi de ramuri împart deliberat un cod (limiterul: eroare /
    // excepție; Stripe: client / sesiune; plata în curs: cheia / lista) —
    // restul sunt distincte.
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
      // SDK-ului REAL pe 409 (SDK8b): tranzitoriu, propria lui plată.
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
      assert.match(ro.key, new RegExp(`^checkout_v7_[0-9a-f]{10}_u1_growth_none_30_s0_${WINDOW}$`))
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

// ── SCK5: textul serverului == rezerva clientului, din SURSELE clientului ────
const ROOT = path.join(__dirname, '..', '..')
const readRepo = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** Valoarea literalului de șir `cheie: '…'` dintr-un dicționar TS (exact o apariție). */
function dictString(src, key) {
  const re = new RegExp(String.raw`(^|[\s{,])${key}\s*:\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`, 'g')
  const hits = [...src.matchAll(re)]
  if (hits.length !== 1) throw new Error(`${key}: ${hits.length} apariții, nu 1`)
  // Literalul (doar el, potrivit de regex) evaluat ca JS: escape-urile ies corect.
  return vm.runInNewContext(hits[0][2])
}

/** `CONTACT_EMAIL` din src/lib/domain.ts: șir simplu sau șablon cu `${SITE_HOSTS.<site>}`. */
function contactEmailFromSource(src) {
  const m = /export const CONTACT_EMAIL\s*=\s*(`[^`]*`|'[^'\n]*')/.exec(src)
  if (!m) throw new Error('CONTACT_EMAIL negăsit')
  let value = m[1].slice(1, -1)
  if (m[1][0] === '`') {
    const hosts = /export const SITE_HOSTS\b[^=]*=\s*\{([^}]*)\}/.exec(src)
    value = value.replace(/\$\{SITE_HOSTS\.(\w+)\}/g, (_, site) => {
      const h = hosts && new RegExp(String.raw`(^|[\s,{])${site}\s*:\s*'([^'\n]+)'`).exec(hosts[1])
      if (!h) throw new Error(`SITE_HOSTS.${site} negăsit`)
      return h[2]
    })
    if (value.includes('${')) throw new Error(`CONTACT_EMAIL: interpolare necunoscută în ${m[1]}`)
  }
  if (!/^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) throw new Error(`CONTACT_EMAIL ciudat: ${value}`)
  return value
}

describe('stripe-checkout — textul serverului e rezerva clientului (lotul L8d)', () => {
  it('SCK5 (control): extractoarele citesc sursa, nu ghicesc', () => {
    assert.equal(dictString("  ck_x:\n    'L\\'a {email}',", 'ck_x'), "L'a {email}")
    assert.throws(() => dictString("ck_x: 'a',\nck_x: 'b',", 'ck_x'), /2 apariții/)
    assert.throws(() => dictString("ck_y: 'a',", 'ck_x'), /0 apariții/)
    const domain = "export const SITE_HOSTS = {\n  ro: 'exemplu.ro',\n  com: 'exemplu.com',\n}\n"
    assert.equal(contactEmailFromSource(`${domain}export const CONTACT_EMAIL = \`contact@\${SITE_HOSTS.ro}\``), 'contact@exemplu.ro')
    assert.equal(contactEmailFromSource("export const CONTACT_EMAIL = 'help@altul.ro'"), 'help@altul.ro')
    assert.throws(() => contactEmailFromSource(`${domain}export const CONTACT_EMAIL = \`contact@\${DOMENIU}\``), /interpolare/)
    assert.throws(() => contactEmailFromSource(`${domain}export const CONTACT_EMAIL = \`contact@\${SITE_HOSTS.de}\``), /SITE_HOSTS\.de/)
  })

  it('SCK5: 502 checkout_create_failed și 409 checkout_in_progress == ck_* din ns/home/ro.ts, {email} = CONTACT_EMAIL', async () => {
    const roDict = readRepo('src/i18n/ns/home/ro.ts')
    const email = contactEmailFromSource(readRepo('src/lib/domain.ts'))
    const createTpl = dictString(roDict, 'ck_createFailed')
    const inProgress = dictString(roDict, 'ck_checkoutInProgress')
    // Anti-vacuitate: rezerva are exact un loc pentru adresă (clientul îl
    // randează cu `.replace('{email}', CONTACT_EMAIL)` / `t(key, { email })`).
    assert.equal(createTpl.split('{email}').length, 2, createTpl)
    assert.ok(!inProgress.includes('{'), inProgress)

    resetMocks()
    clearEnv()
    scriptedHappyPath({ 'checkout.sessions.create': async () => { throw new Error('boom') } })
    const failed = await quiet(() => post({ plan: 'growth' }))
    assert.equal(failed.statusCode, 502)
    assert.equal(parseBody(failed).code, 'checkout_create_failed')
    assert.equal(parseBody(failed).error, createTpl.replace('{email}', email))

    // Ambele căi ale lui 409: cheia refuzată de Stripe și lista necitibilă.
    for (const over of [
      { 'checkout.sessions.create': async () => { throw idempotencyError() } },
      { 'checkout.sessions.list': async () => { throw new Error('stripe down') } },
    ]) {
      resetMocks()
      clearEnv()
      scriptedHappyPath(over)
      const res = await quiet(() => post({ plan: 'growth' }))
      assert.equal(res.statusCode, 409, Object.keys(over)[0])
      assert.deepEqual(parseBody(res), { error: inProgress, code: 'checkout_in_progress' }, Object.keys(over)[0])
    }
  })
})

// ── SOS: o singură sesiune de abonament deschisă per client ──────────────────
describe('stripe-checkout — o singură sesiune deschisă per client (lotul L8d)', () => {
  const APP = 'https://app.test'
  const saved = {}
  beforeEach(() => {
    for (const k of ['VITE_APP_URL', 'STRIPE_TRIAL_DAYS']) saved[k] = process.env[k]
    process.env.VITE_APP_URL = APP
    process.env.STRIPE_TRIAL_DAYS = '30'
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  const NEW_URL = 'https://checkout.stripe.com/c/pay/cs_test'
  const KEY_WINDOW_MS = 30 * 60 * 1000
  const LOOKBACK_S = 25 * 60 * 60
  // Ceasul înghețat al testelor care compară chei / intervale: 10:07, deci
  // fereastra cheii începe la 10:00.
  const FROZEN = Date.UTC(2026, 10, 18, 10, 7, 0)
  const nowS = () => Math.floor(Date.now() / 1000)
  // Începutul intervalului listei pentru „acum”: fix pe fereastra cheii.
  const sinceFor = (ms) => Math.floor((Math.floor(ms / KEY_WINDOW_MS) * KEY_WINDOW_MS) / 1000) - LOOKBACK_S
  async function frozen(fn, at = FROZEN) {
    const savedNow = Date.now
    Date.now = () => at
    try {
      return await fn()
    } finally {
      Date.now = savedNow
    }
  }
  // Sesiunea pe care ar crea-o EXACT cererea `{ plan: 'growth' }` a lui `u1`,
  // creată acum un minut (în interval) și valabilă încă 24 h.
  function openSession(over = {}) {
    return {
      id: 'cs_open',
      object: 'checkout.session',
      mode: 'subscription',
      status: 'open',
      customer: 'cus_1',
      created: nowS() - 60,
      expires_at: nowS() + 24 * 60 * 60,
      url: 'https://checkout.stripe.com/c/pay/cs_open',
      success_url: `${APP}/dashboard?checkout=success&checkout_plan=growth`,
      metadata: { plan: 'growth', price_id: 'price_growth', trial_days: '30' },
      ...over,
    }
  }
  const STARTER = {
    url: 'https://checkout.stripe.com/c/pay/cs_starter',
    success_url: `${APP}/dashboard?checkout=success&checkout_plan=starter`,
    metadata: { plan: 'starter', price_id: 'price_starter', trial_days: '30' },
  }
  function withOpen(sessions, { hasMore = false, expire } = {}) {
    scriptedHappyPath({
      'checkout.sessions.list': async () => ({ object: 'list', data: sessions, has_more: hasMore }),
      'checkout.sessions.expire': expire || (async (id) => ({ id, status: 'expired' })),
    })
  }
  const calls = (name) => state.stripeCalls.filter((c) => c.name === name)
  const indexOf = (name) => state.stripeCalls.findIndex((c) => c.name === name)

  it('SOS1: aceeași plată deja deschisă → URL-ul ei, fără sesiune nouă', async () => {
    await frozen(async () => {
      withOpen([openSession()])
      const res = await post({ plan: 'growth', ui_lang: 'en' })
      assert.equal(res.statusCode, 200, res.body)
      assert.deepEqual(parseBody(res), { url: 'https://checkout.stripe.com/c/pay/cs_open' })
      assert.equal(calls('checkout.sessions.create').length, 0)
      assert.equal(calls('checkout.sessions.expire').length, 0)
      const list = calls('checkout.sessions.list')
      assert.equal(list.length, 1)
      // 10:00 (începutul ferestrei) − 25 h, nu 10:07 − 25 h: pragul e fix pe fereastră.
      const since = Date.UTC(2026, 10, 17, 9, 0, 0) / 1000
      assert.equal(sinceFor(FROZEN), since)
      assert.deepEqual(list[0].args, [{ customer: 'cus_1', created: { gte: since }, limit: 100 }])
    })
  })

  it('SOS1 (control): fără sesiuni deschise → se creează una, cu metadata plății', async () => {
    withOpen([])
    const res = await post({ plan: 'growth' })
    assert.deepEqual(parseBody(res), { url: NEW_URL })
    const created = calls('checkout.sessions.create')
    assert.equal(created.length, 1)
    // Exact câmpurile pe care le citește `isReusableSession` la cererea următoare.
    assert.deepEqual(created[0].args[0].metadata, { plan: 'growth', price_id: 'price_growth', trial_days: '30' })
    assert.equal(Object.prototype.hasOwnProperty.call(created[0].args[0].metadata, 'type'), false)
  })

  it('SOS2: altă plată deschisă (alt plan) → expire ÎNAINTEA creării, apoi sesiunea nouă', async () => {
    withOpen([openSession({
      id: 'cs_starter',
      url: 'https://checkout.stripe.com/c/pay/cs_starter',
      success_url: `${APP}/dashboard?checkout=success&checkout_plan=starter`,
      metadata: { plan: 'starter', price_id: 'price_starter', trial_days: '30' },
    })])
    const res = await post({ plan: 'growth' })
    assert.deepEqual(parseBody(res), { url: NEW_URL })
    const expired = calls('checkout.sessions.expire')
    assert.equal(expired.length, 1)
    assert.deepEqual(expired[0].args, ['cs_starter'])
    assert.equal(calls('checkout.sessions.create').length, 1)
    assert.ok(indexOf('checkout.sessions.expire') < indexOf('checkout.sessions.create'), 'expire după create')
  })

  it('SOS3: fiecare câmp diferit (o singură diferență) → închisă și recreată', async () => {
    const variants = [
      ['alt plan', { metadata: { plan: 'starter', price_id: 'price_growth', trial_days: '30' } }],
      ['alt preț', { metadata: { plan: 'growth', price_id: 'price_vechi', trial_days: '30' } }],
      ['alt trial', { metadata: { plan: 'growth', price_id: 'price_growth', trial_days: '0' } }],
      ['fără metadate (cod de dinainte)', { metadata: {} }],
      ['metadata null', { metadata: null }],
      ['altă origine', { success_url: 'https://alt.test/dashboard?checkout=success&checkout_plan=growth' }],
      ['origine-prefix', { success_url: `${APP}.evil.test/dashboard?checkout=success&checkout_plan=growth` }],
      ['fără success_url', { success_url: null }],
      ['URL ne-https', { url: 'http://checkout.stripe.com/c/pay/cs_open' }],
      ['fără URL', { url: null }],
      ['expiră în 10 min', { expires_at: nowS() + 10 * 60 }],
      ['fără expires_at', { expires_at: undefined }],
      ['expires_at nenumeric', { expires_at: 'mâine' }],
    ]
    for (const [name, over] of variants) {
      resetMocks()
      clearEnv()
      withOpen([openSession({ id: 'cs_diff', ...over })])
      const res = await post({ plan: 'growth' })
      assert.equal(res.statusCode, 200, `${name}: ${res.body}`)
      assert.deepEqual(parseBody(res), { url: NEW_URL }, name)
      assert.deepEqual(calls('checkout.sessions.expire').map((c) => c.args[0]), ['cs_diff'], name)
      assert.equal(calls('checkout.sessions.create').length, 1, name)
    }
  })

  it('SOS3b: pragul lui expires_at — 30 min rămase → recreată, 31 → reluată', async () => {
    await frozen(async () => {
      for (const [name, left, reused] of [['exact 30 min', 30 * 60, false], ['31 min', 31 * 60, true]]) {
        resetMocks()
        clearEnv()
        withOpen([openSession({ expires_at: nowS() + left })])
        const res = await post({ plan: 'growth' })
        assert.equal(res.statusCode, 200, `${name}: ${res.body}`)
        assert.deepEqual(parseBody(res), { url: reused ? 'https://checkout.stripe.com/c/pay/cs_open' : NEW_URL }, name)
        assert.equal(calls('checkout.sessions.expire').length, reused ? 0 : 1, name)
        assert.equal(calls('checkout.sessions.create').length, reused ? 0 : 1, name)
      }
    })
  })

  it('SOS4: lista nu poate fi citită → 409 checkout_in_progress, fără sesiune nouă', async () => {
    for (const [name, impl] of [
      ['aruncă', async () => { throw Object.assign(new Error('stripe down'), { type: 'StripeConnectionError' }) }],
      ['fără data', async () => ({ object: 'list' })],
      ['null', async () => null],
    ]) {
      resetMocks()
      clearEnv()
      scriptedHappyPath({ 'checkout.sessions.list': impl })
      const res = await quiet(() => post({ plan: 'growth' }))
      assert.equal(res.statusCode, 409, name)
      assert.deepEqual(parseBody(res), { error: IN_PROGRESS_RO, code: 'checkout_in_progress' }, name)
      assert.equal(calls('checkout.sessions.create').length, 0, name)
      assert.equal(calls('checkout.sessions.expire').length, 0, name)
    }
  })

  it('SOS5: expire eșuează → 409, fără sesiune nouă și fără URL-ul celei reutilizabile', async () => {
    const stale = openSession({ id: 'cs_starter', metadata: { plan: 'starter', price_id: 'price_starter', trial_days: '30' } })
    const failing = async () => { throw Object.assign(new Error('not open'), { type: 'StripeInvalidRequestError' }) }
    for (const [name, sessions] of [['doar cea veche', [stale]], ['cu una reutilizabilă', [openSession(), stale]]]) {
      resetMocks()
      clearEnv()
      withOpen(sessions, { expire: failing })
      const res = await quiet(() => post({ plan: 'growth' }))
      assert.equal(res.statusCode, 409, name)
      assert.deepEqual(parseBody(res), { error: IN_PROGRESS_RO, code: 'checkout_in_progress' }, name)
      assert.equal(calls('checkout.sessions.create').length, 0, name)
      assert.ok(!res.body.includes('cs_open'), `${name}: a plecat URL-ul reutilizabil`)
    }
  })

  it('SOS6: client creat ACUM → lista nu se cere; client adoptat după cursă → se cere', async () => {
    // Cererea asta creează clientul și câștigă UPDATE-ul atomic.
    withOpen([openSession()])
    state.fromHandlers['profiles'] = (ops) => ops.some((o) => o.m === 'update')
      ? { data: [{ stripe_customer_id: 'cus_new' }], error: null }
      : { data: { stripe_customer_id: null, email: 'a@x.test' }, error: null }
    state.stripeImpls['customers.create'] = async () => ({ id: 'cus_new' })
    const fresh = await post({ plan: 'growth' })
    assert.deepEqual(parseBody(fresh), { url: NEW_URL })
    assert.equal(calls('checkout.sessions.list').length, 0)
    assert.equal(calls('checkout.sessions.create')[0].args[0].customer, 'cus_new')

    // Control: altă cerere a câștigat cursa → clientul ei (existent) e verificat.
    resetMocks()
    clearEnv()
    withOpen([openSession({ customer: 'cus_win' })])
    let selects = 0
    state.fromHandlers['profiles'] = (ops) => {
      if (ops.some((o) => o.m === 'update')) return { data: [], error: null }
      selects += 1
      return selects === 1
        ? { data: { stripe_customer_id: null, email: 'a@x.test' }, error: null }
        : { data: { stripe_customer_id: 'cus_win' }, error: null }
    }
    state.stripeImpls['customers.create'] = async () => ({ id: 'cus_orphan' })
    state.stripeImpls['customers.del'] = async (id) => ({ id, deleted: true })
    const adopted = await post({ plan: 'growth' })
    assert.deepEqual(calls('checkout.sessions.list').map((c) => c.args[0].customer), ['cus_win'])
    assert.deepEqual(parseBody(adopted), { url: 'https://checkout.stripe.com/c/pay/cs_open' })
  })

  it('SOS7: credite AI (mode payment), alt client, sesiune deja închisă → neatinse', async () => {
    withOpen([
      openSession({ id: 'cs_ai', mode: 'payment', metadata: { type: 'ai_credits', restaurant_id: 'r1', tokens: '100000' } }),
      openSession({ id: 'cs_foreign', customer: 'cus_altul' }),
      openSession({ id: 'cs_done', status: 'complete', metadata: { plan: 'starter' } }),
    ])
    const res = await post({ plan: 'growth' })
    assert.deepEqual(parseBody(res), { url: NEW_URL }, 'sesiunea altui client a fost reluată')
    assert.equal(calls('checkout.sessions.expire').length, 0)
    assert.equal(calls('checkout.sessions.create').length, 1)
  })

  it('SOS8: două reutilizabile → cea mai NOUĂ se reia, cealaltă se închide', async () => {
    // Ordinea din listă e deliberat inversă (cea veche întâi).
    withOpen([
      openSession({ id: 'cs_old', created: 100, url: 'https://checkout.stripe.com/c/pay/cs_old' }),
      openSession({ id: 'cs_new', created: 200, url: 'https://checkout.stripe.com/c/pay/cs_new' }),
    ])
    const res = await post({ plan: 'growth' })
    assert.deepEqual(parseBody(res), { url: 'https://checkout.stripe.com/c/pay/cs_new' })
    assert.deepEqual(calls('checkout.sessions.expire').map((c) => c.args[0]), ['cs_old'])
    assert.equal(calls('checkout.sessions.create').length, 0)
  })

  it('SOS9: has_more → cele văzute se închid, dar nu se creează și nu se reia nimic', async () => {
    const stale = openSession({ id: 'cs_starter', metadata: { plan: 'starter', price_id: 'price_starter', trial_days: '30' } })
    for (const [name, sessions] of [['doar vechi', [stale]], ['cu reutilizabilă', [openSession(), stale]]]) {
      resetMocks()
      clearEnv()
      withOpen(sessions, { hasMore: true })
      const res = await quiet(() => post({ plan: 'growth' }))
      assert.equal(res.statusCode, 409, name)
      assert.equal(parseBody(res).code, 'checkout_in_progress', name)
      assert.deepEqual(calls('checkout.sessions.expire').map((c) => c.args[0]), ['cs_starter'], name)
      assert.equal(calls('checkout.sessions.create').length, 0, name)
    }
  })

  it('SOS10: segmentul de stare = mulțimea sesiunilor de abonament din interval, din orice stare', async () => {
    await frozen(async () => {
      const since = sinceFor(FROZEN)
      // O sesiune de START (nereutilizabilă pentru growth): deschisă se
      // închide, expirată/finalizată rămâne neatinsă — cheia trebuie să fie
      // aceeași în toate trei cazurile.
      const starter = (id, over = {}) => openSession({ id, ...STARTER, url: `https://checkout.stripe.com/c/pay/${id}`, ...over })
      async function keyFor(sessions) {
        resetMocks()
        clearEnv()
        withOpen(sessions)
        const res = await post({ plan: 'growth' })
        assert.equal(res.statusCode, 200, res.body)
        return calls('checkout.sessions.create')[0].args[1].idempotencyKey
      }
      const none = await keyFor([])
      const x = await keyFor([starter('cs_x')])
      const x2 = await keyFor([starter('cs_x')])
      const xExpired = await keyFor([starter('cs_x', { status: 'expired' })])
      const xComplete = await keyFor([starter('cs_x', { status: 'complete' })])
      const xNullStatus = await keyFor([starter('cs_x', { status: null })])
      const y = await keyFor([starter('cs_y')])
      const xy = await keyFor([starter('cs_x'), starter('cs_y')])
      const yx = await keyFor([starter('cs_y', { status: 'expired' }), starter('cs_x')])
      const atEdge = await keyFor([starter('cs_x', { created: since, status: 'expired' })])
      assert.match(none, /_30_s0_\d+$/)
      assert.match(x, /_30_s[0-9a-f]{10}_\d+$/)
      assert.notEqual(x, none, 'o sesiune născută în interval schimbă cheia (altfel Stripe reia răspunsul salvat)')
      assert.equal(x.replace(/_s[0-9a-f]{10}_/, '_s0_'), none, 'doar segmentul de stare diferă')
      assert.equal(x2, x, 'aceeași mulțime → aceeași cheie (dedup pentru cereri simultane)')
      assert.equal(xExpired, x, 'starea nu intră: o închidere făcută de altă cerere nu schimbă cheia')
      assert.equal(xComplete, x, 'starea nu intră: nici finalizarea')
      assert.equal(xNullStatus, x, 'starea nu intră: nici `status: null`')
      assert.notEqual(y, x)
      assert.notEqual(xy, x)
      assert.equal(xy, yx, 'ordinea din listă (și starea) nu contează')
      assert.equal(atEdge, x, 'created = gte (limita inclusivă) intră')
      assert.ok(!x.includes('cs_x'), 'id-ul sesiunii nu apare în clar')
      // Nu intră: credite AI, alt client, sesiuni create înaintea intervalului.
      for (const [name, s] of [
        ['mode payment', starter('cs_x', { mode: 'payment', metadata: { type: 'ai_credits' } })],
        ['alt client', starter('cs_x', { customer: 'cus_altul' })],
        ['înaintea intervalului', starter('cs_x', { created: since - 1, status: 'expired' })],
      ]) {
        assert.equal(await keyFor([s]), none, name)
      }
    })
  })

  // Fake Stripe cu STARE și cu idempotența Stripe, pentru SOS11/SOS12: cheie în
  // zbor → 409 `idempotency_key_in_use`; aceeași cheie + același corp →
  // răspunsul SALVAT (Stripe nu re-citește starea sesiunii); aceeași cheie +
  // alt corp → `idempotency_error`. Lista onorează `customer`, `status` și
  // `created.gte` — deci și varianta veche a funcției (cu `status: 'open'`) e
  // simulată fidel, ca mutația să pice din motivul real.
  function statefulStripe(initial = []) {
    const store = new Map(initial.map((s) => [s.id, { ...s }]))
    const saved = new Map()
    const inFlight = new Set()
    const hooks = { beforeCreate: null, afterExpire: null, failCreate: 0 }
    let n = 0
    const copy = (s) => ({ ...s, metadata: s.metadata ? { ...s.metadata } : s.metadata })
    scriptedHappyPath({
      'checkout.sessions.list': async (params = {}) => ({
        object: 'list',
        has_more: false,
        data: [...store.values()]
          .filter((s) => s.customer === params.customer)
          .filter((s) => !params.status || s.status === params.status)
          .filter((s) => !params.created || s.created >= params.created.gte)
          .sort((a, b) => b.created - a.created)
          .map(copy),
      }),
      'checkout.sessions.expire': async (id) => {
        const s = store.get(id)
        if (!s || s.status !== 'open') {
          throw Object.assign(new Error('only open sessions can be expired'), { type: 'StripeInvalidRequestError' })
        }
        s.status = 'expired'
        if (hooks.afterExpire) hooks.afterExpire(id)
        return copy(s)
      },
      'checkout.sessions.create': async (params, opts) => {
        const key = opts.idempotencyKey
        const body = JSON.stringify(params)
        if (inFlight.has(key)) {
          throw Object.assign(new Error('another in-progress request'), {
            type: 'StripeAPIError', rawType: 'invalid_request_error', code: 'idempotency_key_in_use', statusCode: 409,
          })
        }
        if (saved.has(key)) {
          const hit = saved.get(key)
          if (hit.body !== body) throw idempotencyError()
          return { ...hit.response }
        }
        inFlight.add(key)
        try {
          if (hooks.beforeCreate) await hooks.beforeCreate(key)
          if (hooks.failCreate > 0) {
            hooks.failCreate -= 1
            // Nesalvată (ca un timeout înainte ca Stripe să execute cererea).
            throw Object.assign(new Error('api down'), { type: 'StripeAPIError', rawType: 'api_error', statusCode: 500 })
          }
          const at = nowS()
          const id = `cs_new${++n}`
          const s = {
            id, object: 'checkout.session', mode: 'subscription', status: 'open', customer: params.customer,
            created: at, expires_at: at + 24 * 60 * 60, url: `https://checkout.stripe.com/c/pay/${id}`,
            success_url: params.success_url, metadata: { ...params.metadata },
          }
          store.set(id, s)
          saved.set(key, { body, response: copy(s) })
          return copy(s)
        } finally {
          inFlight.delete(key)
        }
      },
    })
    const urlStatus = (res) => {
      const url = parseBody(res).url
      const s = [...store.values()].find((x) => x.url === url)
      return s ? s.status : null
    }
    const openOf = (plan) => [...store.values()].filter((s) => s.status === 'open' && s.metadata?.plan === plan).map((s) => s.id)
    return { store, hooks, urlStatus, openOf }
  }
  const createKeys = () => calls('checkout.sessions.create').map((c) => c.args[1].idempotencyKey)

  it('SOS11: două cereri identice simultane, cu o sesiune veche deschisă → o cheie, o sesiune', async () => {
    await frozen(async () => {
      // Sesiunea veche, o dată creată în fereastra cheii (10:06) și o dată
      // înaintea ei (08:07, tot în interval).
      for (const [name, ago] of [['veche din fereastră', 60], ['veche dinaintea ferestrei', 2 * 60 * 60]]) {
        resetMocks()
        clearEnv()
        const fake = statefulStripe([openSession({ id: 'cs_starter', ...STARTER, created: nowS() - ago })])
        let releaseA
        const aHeld = new Promise((r) => { releaseA = r })
        let aInCreate
        const aCreating = new Promise((r) => { aInCreate = r })
        let first = true
        fake.hooks.beforeCreate = async () => {
          if (!first) return
          first = false
          aInCreate()
          await aHeld
        }
        const pA = quiet(() => post({ plan: 'growth' }))
        // A a închis sesiunea veche și își creează sesiunea; B listează ACUM.
        await aCreating
        assert.equal(fake.store.get('cs_starter').status, 'expired', `${name}: A n-a închis sesiunea veche`)
        const resB = await quiet(() => post({ plan: 'growth' }))
        releaseA()
        const resA = await pA
        assert.equal(resA.statusCode, 200, `${name}: A ${resA.body}`)
        const keys = createKeys()
        assert.equal(keys.length, 2, `${name}: ${keys}`)
        assert.equal(keys[1], keys[0], `${name}: cereri identice simultane → aceeași cheie`)
        // B: aceeași cheie cât A e în zbor → 409 in_use → 502 tranzitoriu.
        assert.equal(resB.statusCode, 502, `${name}: B ${resB.body}`)
        assert.equal(parseBody(resB).code, 'checkout_create_failed', name)
        // Reîncercarea lui B o REIA pe a lui A.
        const retryB = await quiet(() => post({ plan: 'growth' }))
        assert.equal(retryB.statusCode, 200, `${name}: B reîncercat ${retryB.body}`)
        assert.equal(parseBody(retryB).url, parseBody(resA).url, name)
        assert.deepEqual(fake.openOf('growth'), ['cs_new1'], `${name}: sesiuni growth deschise`)
        assert.equal(createKeys().length, 2, `${name}: reîncercarea a creat o sesiune`)
      }
    })
  })

  it('SOS12: o cheie nu se refolosește după sesiunea creată cu ea (expirată sau finalizată)', async () => {
    await frozen(async () => {
      // growth → starter (expire reușit, crearea pică) → growth, aceeași limbă / altă limbă.
      for (const lang3 of ['ro', 'en']) {
        resetMocks()
        clearEnv()
        const fake = statefulStripe()
        const r1 = await post({ plan: 'growth', ui_lang: 'ro' })
        assert.equal(r1.statusCode, 200, r1.body)
        assert.equal(fake.urlStatus(r1), 'open')
        fake.hooks.failCreate = 1
        const r2 = await quiet(() => post({ plan: 'starter', ui_lang: 'ro' }))
        assert.equal(r2.statusCode, 502, r2.body)
        assert.equal(fake.store.get('cs_new1').status, 'expired', 'starter n-a închis sesiunea growth')
        const r3 = await quiet(() => post({ plan: 'growth', ui_lang: lang3 }))
        assert.equal(r3.statusCode, 200, `${lang3}: ${r3.body}`)
        assert.equal(fake.urlStatus(r3), 'open', `${lang3}: URL-ul unei sesiuni moarte`)
        const keys = createKeys()
        assert.notEqual(keys[keys.length - 1], keys[0], `${lang3}: cheia primei sesiuni (moarte) refolosită`)
        // Stabil: aceeași cerere din nou reia sesiunea deschisă, nu creează alta.
        const r4 = await quiet(() => post({ plan: 'growth', ui_lang: lang3 }))
        assert.equal(parseBody(r4).url, parseBody(r3).url, lang3)
        assert.equal(fake.openOf('growth').length, 1, lang3)
      }

      // Sesiune FINALIZATĂ, abonamentul anulat → growth din nou (fără trial, ca
      // trialul să nu deosebească singur cheile).
      resetMocks()
      clearEnv()
      process.env.STRIPE_TRIAL_DAYS = '0'
      const fake = statefulStripe()
      const r1 = await post({ plan: 'growth' })
      assert.equal(r1.statusCode, 200, r1.body)
      fake.store.get('cs_new1').status = 'complete'
      state.stripeImpls['subscriptions.list'] = async () => [{ status: 'canceled', trial_start: null, trial_end: null }]
      const r2 = await post({ plan: 'growth' })
      assert.equal(r2.statusCode, 200, r2.body)
      assert.equal(fake.urlStatus(r2), 'open', 'URL-ul sesiunii finalizate')
      const keys = createKeys()
      assert.equal(keys.length, 2)
      assert.notEqual(keys[1], keys[0])
    })
  })
})
