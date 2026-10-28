// tests/functions/app-url.test.js
// Sursa UNICĂ a domeniului pentru funcțiile Netlify (netlify/functions/lib/appUrl.js).
//
//   AU1  fără env și fără `fallback` → https://menuvia.ro; cu `fallback`
//        (per apelant) → fallback-ul apelantului, validat ca origine
//   AU2  APP_URL bate VITE_APP_URL; se întoarce DOAR originea (fără cale/slash)
//   AU3  valorile stricate cad pe următoarea cheie / fallback (http public,
//        javascript:, gol, gunoi, credențiale în URL) — niciodată ca atare
//   AU4  http e acceptat DOAR pe localhost (`netlify dev`)
//   AU5  `keys` permite precedența proprie (sitemap: `URL` primul)
//   AU6  appLink construiește link-uri absolute fără dublu slash
//   AU7  expeditorii de email rămân EXACT valorile de dinainte (comportament
//        neschimbat; Resend are verificat doar domeniul .ro)
//   AU8  integrare: stripe-checkout pune success_url/cancel_url pe
//        VITE_APP_URL (cheia de dinainte; APP_URL ignorat)
//   AU9  siteAppUrl: allowlist-ul de origini e GOL — nicio etichetă (nici 'com')
//        nu duce spre menuvia.com (D3); toate cad pe appUrl(opts);
//        orice altceva → appUrl(opts), adică comportamentul vechi
//   Fallback-ul per funcție (cel ISTORIC, menuvia.netlify.app) e ținut de
//   app-url-callsites.test.js (CS1–CS9).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const lib = require(path.join(__dirname, '..', '..', 'netlify', 'functions', 'lib', 'appUrl.js'))
const { appUrl, appLink, normalizeOrigin } = lib

describe('appUrl — sursa unică a domeniului', () => {
  it('AU1: fără env → fallback-ul apelantului (implicit https://menuvia.ro)', () => {
    assert.equal(appUrl({ env: {} }), 'https://menuvia.ro')
    assert.equal(lib.DEFAULT_APP_URL, 'https://menuvia.ro')
    assert.equal(lib.LEGACY_NETLIFY_URL, 'https://menuvia.netlify.app')
    assert.equal(
      appUrl({ env: {}, fallback: lib.LEGACY_NETLIFY_URL }),
      'https://menuvia.netlify.app',
    )
    // env valid bate fallback-ul
    assert.equal(
      appUrl({ env: { APP_URL: 'https://a.example' }, fallback: lib.LEGACY_NETLIFY_URL }),
      'https://a.example',
    )
    // un fallback stricat nu ajunge niciodată în link
    assert.equal(appUrl({ env: {}, fallback: 'javascript:alert(1)' }), 'https://menuvia.ro')
    assert.equal(appUrl({ env: {}, fallback: 'http://evil.example' }), 'https://menuvia.ro')
  })

  it('AU9: siteAppUrl — nicio etichetă nu duce spre menuvia.com', () => {
    const opts = { env: { VITE_APP_URL: 'https://vite.example' }, keys: ['VITE_APP_URL'] }
    // Fostul caz special: 'com' dădea https://menuvia.com. Acum cade pe appUrl.
    assert.equal(lib.siteAppUrl('com', opts), 'https://vite.example')
    assert.equal('COM_APP_URL' in lib, false)
    assert.equal(
      lib.siteAppUrl('com', { env: {}, keys: ['VITE_APP_URL'], fallback: lib.LEGACY_NETLIFY_URL }),
      'https://menuvia.netlify.app',
    )
    for (const s of [undefined, null, 'ro', 'RO', 'COM', ' com', 'https://evil.example',
      '__proto__', 'toString', 'hasOwnProperty', ['com'], { com: true }, 1]) {
      assert.equal(lib.siteAppUrl(s, opts), 'https://vite.example', `site=${String(s)}`)
    }
    assert.equal(
      lib.siteAppUrl(undefined, { env: {}, keys: ['VITE_APP_URL'], fallback: lib.LEGACY_NETLIFY_URL }),
      'https://menuvia.netlify.app',
    )
  })

  it('AU2: APP_URL are prioritate; se întoarce doar originea', () => {
    assert.equal(
      appUrl({ env: { APP_URL: 'https://a.example/', VITE_APP_URL: 'https://b.example' } }),
      'https://a.example',
    )
    assert.equal(appUrl({ env: { VITE_APP_URL: 'https://b.example/x/y?z=1' } }), 'https://b.example')
    assert.equal(appUrl({ env: { APP_URL: '  https://app.example  ' } }), 'https://app.example')
  })

  it('AU3: valorile stricate nu ajung niciodată în link', () => {
    for (const bad of [
      'http://menuvia.ro',
      'javascript:alert(1)',
      '',
      '   ',
      'menuvia.ro',
      'not a url',
      'https://user:pw@evil.example',
      'ftp://menuvia.ro',
    ]) {
      assert.equal(normalizeOrigin(bad), null, `acceptat greșit: ${JSON.stringify(bad)}`)
      assert.equal(
        appUrl({ env: { APP_URL: bad, VITE_APP_URL: 'https://fallback.example' } }),
        'https://fallback.example',
        `nu a căzut pe cheia următoare: ${JSON.stringify(bad)}`,
      )
    }
    assert.equal(appUrl({ env: { APP_URL: 'javascript:alert(1)' } }), 'https://menuvia.ro')
    assert.equal(normalizeOrigin(undefined), null)
    assert.equal(normalizeOrigin(42), null)
  })

  it('AU4: http doar pe localhost', () => {
    assert.equal(appUrl({ env: { APP_URL: 'http://localhost:8888/' } }), 'http://localhost:8888')
    assert.equal(appUrl({ env: { APP_URL: 'http://127.0.0.1:5173' } }), 'http://127.0.0.1:5173')
    assert.equal(appUrl({ env: { APP_URL: 'http://example.com' } }), 'https://menuvia.ro')
  })

  it('AU5: precedență proprie prin `keys`', () => {
    const env = { URL: 'https://menuvia.netlify.app', APP_URL: 'https://menuvia.ro' }
    assert.equal(appUrl({ env, keys: ['URL', 'APP_URL'] }), 'https://menuvia.netlify.app')
    assert.equal(appUrl({ env }), 'https://menuvia.ro')
  })

  it('AU6: appLink', () => {
    const env = { APP_URL: 'https://menuvia.ro/' }
    assert.equal(appLink('/dashboard?tab=billing', { env }), 'https://menuvia.ro/dashboard?tab=billing')
    assert.equal(appLink('m/abc', { env }), 'https://menuvia.ro/m/abc')
    assert.equal(appLink('', { env }), 'https://menuvia.ro/')
  })

  it('AU7: expeditorii de email — valori EXACT ca înainte', () => {
    assert.equal(lib.FROM_HELLO, 'Menuvia <hello@menuvia.ro>')
    assert.equal(lib.FROM_PILOT_LEADS, 'Menuvia Leads <pilot@menuvia.ro>')
    assert.equal(lib.FROM_PILOT_CODVIA, 'Codvia Comenzi <pilot@menuvia.ro>')
    assert.equal(lib.FOUNDER_EMAIL, 'radu@menuvia.ro')
    assert.equal(lib.NOREPLY_EMAIL, 'noreply@menuvia.ro')
    assert.deepEqual(lib.RO_SITE_ORIGINS, ['https://menuvia.ro', 'https://www.menuvia.ro'])
  })
})

describe('AU8: integrare — stripe-checkout citește domeniul din sursa unică', () => {
  const { state, resetMocks, loadFunction } = require('./helpers/mocks')
  const saved = {}
  const KEYS = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY',
    'STRIPE_STARTER_PRICE_ID', 'STRIPE_GROWTH_PRICE_ID', 'STRIPE_PRO_PRICE_ID',
    'STRIPE_ENTERPRISE_PRICE_ID', 'APP_URL', 'VITE_APP_URL', 'STRIPE_TRIAL_DAYS',
  ]

  beforeEach(() => {
    resetMocks()
    for (const k of KEYS) saved[k] = process.env[k]
    Object.assign(process.env, {
      SUPABASE_URL: 'https://sb.example',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_STARTER_PRICE_ID: 'price_starter',
      STRIPE_GROWTH_PRICE_ID: 'price_growth',
      STRIPE_PRO_PRICE_ID: 'price_pro',
      STRIPE_ENTERPRISE_PRICE_ID: 'price_ent',
    })
    delete process.env.STRIPE_TRIAL_DAYS
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('AU8: success_url/cancel_url pe VITE_APP_URL (APP_URL ignorat — cheia de dinainte)', async () => {
    process.env.APP_URL = 'https://other.example'
    process.env.VITE_APP_URL = 'https://app.example/'
    const { handler } = loadFunction('netlify/functions/stripe-checkout.js')
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
    const res = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ plan: 'growth' }),
    })
    assert.equal(res.statusCode, 200, res.body)
    const calls = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create')
    assert.equal(calls.length, 1)
    const params = calls[0].args[0]
    assert.ok(params.success_url.startsWith('https://app.example/dashboard?'), params.success_url)
    assert.equal(params.cancel_url, 'https://app.example/pricing?checkout=cancelled')
  })
})
