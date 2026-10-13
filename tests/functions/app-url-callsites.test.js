// tests/functions/app-url-callsites.test.js
// Fallback-ul de domeniu e PER APELANT (netlify/functions/lib/appUrl.js).
//
// De ce există: prima variantă a sursei unice punea UN fallback global,
// `https://menuvia.ro`. Dar menuvia.ro NU e încă cumpărat, iar Netlify NU dă
// funcțiilor la runtime env-ul din netlify.toml — deci, fără env setat în UI,
// link-urile Stripe (success/cancel/return), token-urile de invitație și
// link-urile din emailuri ar fi plecat spre un domeniu neînregistrat. Fiecare
// funcție își păstrează acum EXACT cheile și fallback-ul de dinainte.
//
//   CS1  stripe-checkout:      VITE_APP_URL → menuvia.netlify.app (APP_URL ignorat)
//   CS2  stripe-portal:        idem
//   CS3  ai-credits-checkout:  idem
//   CS4  send-invite:          idem; `site:'com'` → https://menuvia.com, orice
//                              altceva (origine din body, chei de prototip,
//                              gunoi) → comportamentul vechi
//   CS5  welcome-email:        VITE_APP_URL → menuvia.netlify.app
//   CS6  process-email-queue:  DOAR APP_URL → menuvia.netlify.app (VITE ignorat)
//   CS7  stripe-connect:       VITE_APP_URL → menuvia.ro (avea deja .ro scris)
//   CS8  stripe-connect:       refuză onboarding-ul pentru country <> 'RO'
//                              (fără cont Stripe creat); bază fără coloană
//                              (pre-296) → tratat ca RO
//   CS9  stripe-checkout:      cheia de idempotență poartă originea (v4)

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { state, resetMocks, loadFunction, parseBody } = require('./helpers/mocks')

const LEGACY = 'https://menuvia.netlify.app'
const URL_KEYS = ['APP_URL', 'VITE_APP_URL', 'URL']
const OTHER_KEYS = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY',
  'STRIPE_STARTER_PRICE_ID', 'STRIPE_GROWTH_PRICE_ID', 'STRIPE_PRO_PRICE_ID',
  'STRIPE_ENTERPRISE_PRICE_ID', 'STRIPE_TRIAL_DAYS', 'RESEND_API_KEY', 'WEBHOOK_SECRET',
]
const RID = '11111111-2222-3333-4444-555555555555'

const saved = {}
let savedFetch
let fetchCalls = []

beforeEach(() => {
  resetMocks()
  for (const k of [...URL_KEYS, ...OTHER_KEYS]) saved[k] = process.env[k]
  for (const k of URL_KEYS) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_STARTER_PRICE_ID: 'price_starter',
    STRIPE_GROWTH_PRICE_ID: 'price_growth',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_ENTERPRISE_PRICE_ID: 'price_ent',
    RESEND_API_KEY: 're_test',
    WEBHOOK_SECRET: 'whsec_test',
  })
  delete process.env.STRIPE_TRIAL_DAYS
  savedFetch = global.fetch
  fetchCalls = []
  global.fetch = async (url, init) => {
    fetchCalls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '' }
  }
})

afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

function authed() {
  state.authUser = { id: 'u1', email: 'a@x.test' }
  state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
}

function resendHtml() {
  const call = fetchCalls.find((c) => String(c.url).includes('api.resend.com'))
  assert.ok(call, 'niciun email trimis')
  return JSON.parse(call.init.body).html
}

// ── stripe-checkout ──────────────────────────────────────────────────────────
async function runCheckout() {
  const { handler } = loadFunction('netlify/functions/stripe-checkout.js')
  authed()
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
  return calls[calls.length - 1]
}

describe('CS1: stripe-checkout păstrează VITE_APP_URL → menuvia.netlify.app', () => {
  it('fără env → menuvia.netlify.app (nu menuvia.ro, încă necumpărat)', async () => {
    const call = await runCheckout()
    assert.ok(call.args[0].success_url.startsWith(`${LEGACY}/dashboard?`), call.args[0].success_url)
    assert.equal(call.args[0].cancel_url, `${LEGACY}/pricing?checkout=cancelled`)
  })
  it('APP_URL singur e IGNORAT (cheia de dinainte era doar VITE_APP_URL)', async () => {
    process.env.APP_URL = 'https://app.example'
    const call = await runCheckout()
    assert.ok(call.args[0].success_url.startsWith(`${LEGACY}/`), call.args[0].success_url)
  })
  it('VITE_APP_URL setat → folosit', async () => {
    process.env.VITE_APP_URL = 'https://vite.example/'
    const call = await runCheckout()
    assert.ok(call.args[0].success_url.startsWith('https://vite.example/dashboard?'))
  })
})

describe('CS9: stripe-checkout — cheia de idempotență poartă originea', () => {
  it('aceeași cerere pe două origini → chei diferite; aceeași origine → aceeași cheie', async () => {
    process.env.VITE_APP_URL = 'https://one.example'
    const a = await runCheckout()
    const a2 = await runCheckout()
    process.env.VITE_APP_URL = 'https://two.example'
    const b = await runCheckout()
    const ka = a.args[1].idempotencyKey
    assert.match(ka, /^checkout_v4_[0-9a-f]{10}_u1_growth_/)
    assert.equal(a2.args[1].idempotencyKey, ka, 'dedup-ul pe aceeași cerere s-a pierdut')
    assert.notEqual(b.args[1].idempotencyKey, ka)
    // Originea nu apare în clar în cheie.
    assert.ok(!ka.includes('one.example'))
  })
})

// ── stripe-portal ────────────────────────────────────────────────────────────
describe('CS2: stripe-portal păstrează VITE_APP_URL → menuvia.netlify.app', () => {
  async function run() {
    const { handler } = loadFunction('netlify/functions/stripe-portal.js')
    authed()
    state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: 'cus_1' }, error: null })
    state.stripeImpls['billingPortal.sessions.create'] = async () => ({ url: 'https://billing.stripe.com/x' })
    const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: '{}' })
    assert.equal(res.statusCode, 200, res.body)
    return state.stripeCalls.find((c) => c.name === 'billingPortal.sessions.create').args[0]
  }
  it('fără env → menuvia.netlify.app; APP_URL ignorat', async () => {
    process.env.APP_URL = 'https://app.example'
    assert.equal((await run()).return_url, `${LEGACY}/dashboard`)
  })
  it('VITE_APP_URL → folosit', async () => {
    process.env.VITE_APP_URL = 'https://vite.example'
    assert.equal((await run()).return_url, 'https://vite.example/dashboard')
  })
})

// ── ai-credits-checkout ──────────────────────────────────────────────────────
describe('CS3: ai-credits-checkout păstrează VITE_APP_URL → menuvia.netlify.app', () => {
  async function run() {
    const { handler } = loadFunction('netlify/functions/ai-credits-checkout.js')
    authed()
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
    state.fromHandlers['profiles'] = () => ({
      data: { stripe_customer_id: 'cus_1', email: 'a@x.test' },
      error: null,
    })
    state.stripeImpls['checkout.sessions.create'] = async () => ({ url: 'https://checkout.stripe.com/x' })
    const res = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ restaurant_id: RID, pack: 'small' }),
    })
    assert.equal(res.statusCode, 200, res.body)
    return state.stripeCalls.find((c) => c.name === 'checkout.sessions.create').args[0]
  }
  it('fără env → menuvia.netlify.app; APP_URL ignorat', async () => {
    process.env.APP_URL = 'https://app.example'
    const p = await run()
    assert.equal(p.success_url, `${LEGACY}/dashboard?ai_credits=success`)
    assert.equal(p.cancel_url, `${LEGACY}/dashboard?ai_credits=cancelled`)
  })
  it('VITE_APP_URL → folosit', async () => {
    process.env.VITE_APP_URL = 'https://vite.example'
    assert.equal((await run()).success_url, 'https://vite.example/dashboard?ai_credits=success')
  })
})

// ── send-invite ──────────────────────────────────────────────────────────────
describe('CS4: send-invite — fallback vechi + `site` pe allowlist', () => {
  async function run(extra) {
    const { handler } = loadFunction('netlify/functions/send-invite.js')
    authed()
    state.fromHandlers['restaurant_memberships'] = (ops) =>
      ops.some((o) => o.m === 'select' && o.args[0] === 'role')
        ? { data: { role: 'owner' }, error: null }
        : { data: null, error: null }
    state.fromHandlers['restaurants'] = () => ({ data: { name: 'Bistro' }, error: null })
    state.fromHandlers['profiles'] = (ops) =>
      ops.some((o) => o.m === 'ilike')
        ? { data: null, error: null }
        : { data: { full_name: 'Ana', email: 'ana@x.test' }, error: null }
    state.fromHandlers['invite_tokens'] = (ops) =>
      ops.some((o) => o.m === 'insert')
        ? { data: { token: 'tok123' }, error: null }
        : { data: null, error: null }
    const res = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: JSON.stringify({ email: 'b@x.test', role: 'waiter', restaurant_id: RID, ...extra }),
    })
    assert.equal(res.statusCode, 200, res.body)
    return resendHtml()
  }

  it('fără `site` (clienți vechi) și fără env → menuvia.netlify.app', async () => {
    process.env.APP_URL = 'https://app.example' // ignorat, ca înainte
    const html = await run({})
    assert.ok(html.includes(`href="${LEGACY}/invite/tok123"`), html)
  })
  it("`site:'ro'` → comportamentul de dinainte (VITE_APP_URL)", async () => {
    process.env.VITE_APP_URL = 'https://vite.example'
    const html = await run({ site: 'ro' })
    assert.ok(html.includes('href="https://vite.example/invite/tok123"'))
  })
  it("`site:'com'` → https://menuvia.com (chiar cu VITE_APP_URL setat)", async () => {
    process.env.VITE_APP_URL = 'https://vite.example'
    const html = await run({ site: 'com' })
    assert.ok(html.includes('href="https://menuvia.com/invite/tok123"'), html)
  })
  it('o ORIGINE în body nu ajunge niciodată în link (anti relay de phishing)', async () => {
    for (const site of [
      'https://evil.example',
      'evil.example',
      'COM',
      ' com',
      '__proto__',
      'toString',
      'constructor',
      ['com'],
      { com: 1 },
      42,
    ]) {
      fetchCalls = []
      const html = await run({ site })
      assert.ok(html.includes(`href="${LEGACY}/invite/tok123"`), `site=${JSON.stringify(site)}`)
      assert.ok(!html.includes('evil.example'))
    }
  })
})

// ── welcome-email ────────────────────────────────────────────────────────────
describe('CS5: welcome-email păstrează VITE_APP_URL → menuvia.netlify.app', () => {
  async function run() {
    const { handler } = loadFunction('netlify/functions/welcome-email.js')
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'whsec_test' },
      body: JSON.stringify({ email: 'new@x.test', name: 'Ion' }),
    })
    assert.equal(res.statusCode, 200, res.body)
    return resendHtml()
  }
  it('fără env → menuvia.netlify.app; APP_URL ignorat', async () => {
    process.env.APP_URL = 'https://app.example'
    assert.ok((await run()).includes(`href="${LEGACY}/dashboard"`))
  })
  it('VITE_APP_URL → folosit', async () => {
    process.env.VITE_APP_URL = 'https://vite.example'
    assert.ok((await run()).includes('href="https://vite.example/dashboard"'))
  })
})

// ── process-email-queue (APP_URL e citit la încărcarea modulului) ────────────
describe('CS6: process-email-queue citește DOAR APP_URL → menuvia.netlify.app', () => {
  const rel = 'netlify/functions/process-email-queue.js'
  const abs = path.join(__dirname, '..', '..', rel)
  async function run() {
    delete require.cache[require.resolve(abs)]
    const { handler } = loadFunction(rel)
    state.rpcHandlers['claim_email_batch'] = () => ({
      data: [
        {
          id: 'e1',
          template_kind: 'welcome',
          template_data: { owner_name: 'Ion' },
          recipient_email: 'a@x.test',
          failed_attempts: 0,
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    })
    const res = await handler({})
    assert.equal(res.statusCode, 200, res.body)
    return resendHtml()
  }
  it('fără APP_URL → menuvia.netlify.app, VITE_APP_URL IGNORAT (ca înainte)', async () => {
    process.env.VITE_APP_URL = 'https://vite.example'
    const html = await run()
    assert.ok(html.includes(`href="${LEGACY}/dashboard"`), html)
    assert.ok(!html.includes('vite.example'))
  })
  it('APP_URL → folosit', async () => {
    process.env.APP_URL = 'https://app.example'
    assert.ok((await run()).includes('href="https://app.example/dashboard"'))
  })
})

// ── stripe-connect ───────────────────────────────────────────────────────────
describe('CS7/CS8: stripe-connect — fallback .ro păstrat + gardă pe țară', () => {
  function setup(restaurantRow, { missingColumn = false } = {}) {
    const { handler } = loadFunction('netlify/functions/stripe-connect.js')
    authed()
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
    state.fromHandlers['restaurants'] = (ops) => {
      const cols = String((ops.find((o) => o.m === 'select') || { args: [''] }).args[0])
      if (missingColumn && cols.includes('country')) {
        return { data: null, error: { code: '42703', message: 'column restaurants.country does not exist' } }
      }
      return { data: restaurantRow, error: null }
    }
    state.rpcHandlers['set_restaurant_stripe_account'] = () => ({ data: null, error: null })
    state.stripeImpls['accounts.create'] = async () => ({ id: 'acct_1' })
    state.stripeImpls['accountLinks.create'] = async () => ({ url: 'https://connect.stripe.com/x' })
    return (action) =>
      handler({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer jwt' },
        body: JSON.stringify({ restaurant_id: RID, action }),
      })
  }

  it('CS7: fără env → https://menuvia.ro (fallback-ul de dinainte); APP_URL ignorat', async () => {
    process.env.APP_URL = 'https://app.example'
    const call = setup({ stripe_account_id: null, name: 'R', country: 'RO' })
    const res = await call('link')
    assert.equal(res.statusCode, 200, res.body)
    const link = state.stripeCalls.find((c) => c.name === 'accountLinks.create').args[0]
    assert.equal(link.return_url, 'https://menuvia.ro/dashboard')
    assert.equal(link.refresh_url, 'https://menuvia.ro/dashboard')
  })

  it('CS8: country DE → 403 `country_not_supported`, ZERO apeluri Stripe', async () => {
    const call = setup({ stripe_account_id: null, name: 'R', country: 'DE' })
    const res = await call('link')
    assert.equal(res.statusCode, 403)
    assert.equal(parseBody(res).code, 'country_not_supported')
    assert.equal(state.stripeCalls.length, 0)
    assert.equal(state.rpcCalls.filter((c) => c.name === 'set_restaurant_stripe_account').length, 0)
  })

  it('CS8: `status` rămâne citibil pentru non-RO (cont legat înainte)', async () => {
    const call = setup({ stripe_account_id: null, name: 'R', country: 'DE' })
    const res = await call('status')
    assert.equal(res.statusCode, 200)
    assert.equal(parseBody(res).connected, false)
  })

  it('CS8: bază fără coloana `country` (pre-296) → tratat ca RO, onboarding merge', async () => {
    const call = setup({ stripe_account_id: null, name: 'R' }, { missingColumn: true })
    const res = await call('link')
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(state.stripeCalls.filter((c) => c.name === 'accounts.create').length, 1)
  })
})
