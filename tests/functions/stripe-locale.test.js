// tests/functions/stripe-locale.test.js
// Limba paginilor Stripe = limba panoului personalului (lotul L8d).
// Checkout-ul abonamentului (SLC1–SLC4 în stripe-checkout.test.js) și Portalul
// de facturare (SPT5 în stripe-portal.test.js) au testele lor; aici stau
// helperul comun și a treia sesiune de Checkout, cea a creditelor AI.
//
//   SLX1  `stripeLocale` acceptă EXACT limbile personalului (`STAFF_LANGS` din
//         lib/emailLang.js — oglinda lui src/i18n/langs.ts, ținută de EL5),
//         normalizate (trim + litere mici); orice altceva → null, fără throw.
//         [PICĂ: o listă proprie care diverge; `en-US` acceptat]
//   SLX2  fiecare limbă a personalului e un `locale` pe care Stripe îl acceptă
//         și la Checkout, și la Portal (listele din documentația Stripe pentru
//         versiunea pinuită 2023-10-16, scrise aici) — o limbă nouă a panoului
//         pe care Stripe n-o știe ar face TOATE plățile ei să pice cu 400.
//         [PICĂ: o limbă adăugată în STAFF_LANGS fără suport Stripe]
//   SLX3  ai-credits-checkout: `ui_lang` valid → `locale` (control pozitiv);
//         absent / invalid → fără cheia `locale` („auto”, ca înainte).
//         [PICĂ: spread-ul scos; valoarea trimisă brut]
//   SLX4  cele trei funcții citesc limba DOAR prin helper (o a doua validare
//         scrisă de mână ar putea diverge de listă).
//         [PICĂ: `locale: body.ui_lang` direct într-o funcție]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { state, resetMocks, loadFunction, parseBody, stripeCallsFor } = require('./helpers/mocks')

const ROOT = path.join(__dirname, '..', '..')
const { stripeLocale } = require(path.join(ROOT, 'netlify/functions/lib/stripeLocale.js'))
const { STAFF_LANGS } = require(path.join(ROOT, 'netlify/functions/lib/emailLang.js'))

// https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-locale
const STRIPE_CHECKOUT_LOCALES = [
  'auto', 'bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA',
  'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru',
  'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW',
]
// https://docs.stripe.com/api/customer_portal/sessions/create#create_portal_session-locale
const STRIPE_PORTAL_LOCALES = [
  'auto', 'bg', 'cs', 'da', 'de', 'el', 'en', 'en-AU', 'en-CA', 'en-GB', 'en-IE', 'en-IN', 'en-NZ', 'en-SG',
  'es', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms',
  'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW',
]

describe('SLX1–SLX2: helperul de limbă', () => {
  it('SLX1: exact limbile personalului, normalizate; restul → null', () => {
    assert.ok(STAFF_LANGS.includes('ro') && STAFF_LANGS.length >= 1, 'lista e goală — anti-vacuitate')
    for (const l of STAFF_LANGS) {
      assert.equal(stripeLocale(l), l)
      assert.equal(stripeLocale(` ${l.toUpperCase()} `), l)
    }
    for (const v of ['en-US', 'en_GB', 'xx', 'it', 'auto', '', '  ', 42, null, undefined, {}, ['ro'], true]) {
      assert.equal(stripeLocale(v), null, JSON.stringify(v))
    }
  })

  it('SLX2: Stripe acceptă fiecare limbă a personalului, la Checkout și la Portal', () => {
    for (const l of STAFF_LANGS) {
      assert.ok(STRIPE_CHECKOUT_LOCALES.includes(l), `Checkout nu acceptă locale „${l}"`)
      assert.ok(STRIPE_PORTAL_LOCALES.includes(l), `Portalul nu acceptă locale „${l}"`)
    }
  })
})

describe('SLX3: ai-credits-checkout în limba panoului', () => {
  const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'VITE_APP_URL']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
    for (const k of ENV) delete process.env[k]
  })
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  async function sessionFor(extra) {
    resetMocks()
    Object.assign(process.env, {
      SUPABASE_URL: 'https://sb.example',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      STRIPE_SECRET_KEY: 'sk_test_x',
    })
    state.authUser = { id: 'u1', email: 'a@x.test' }
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
    state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
    state.stripeImpls['checkout.sessions.create'] = async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_ai' })
    const { handler } = loadFunction('netlify/functions/ai-credits-checkout.js')
    const res = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: JSON.stringify({ restaurant_id: 'r1', pack: 'small', ...extra }),
    })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(parseBody(res).url, 'https://checkout.stripe.com/c/pay/cs_ai')
    const calls = stripeCallsFor('checkout.sessions.create')
    assert.equal(calls.length, 1)
    return calls[0].args[0]
  }

  it('ui_lang valid → locale (control pozitiv); absent / invalid → fără locale', async () => {
    assert.equal((await sessionFor({ ui_lang: 'fr' })).locale, 'fr')
    for (const extra of [{}, { ui_lang: 'en-US' }, { ui_lang: 3 }, { ui_lang: null }]) {
      const params = await sessionFor(extra)
      assert.equal(Object.prototype.hasOwnProperty.call(params, 'locale'), false, JSON.stringify(extra))
      assert.equal(params.mode, 'payment')
    }
  })
})

describe('SLX4: limba trece DOAR prin helper', () => {
  const FILES = ['stripe-checkout.js', 'stripe-portal.js', 'ai-credits-checkout.js']
  // Fără comentarii: un exemplu de cod citat într-un comentariu nu e cod.
  const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('fiecare funcție cheamă stripeLocale și nu citește ui_lang altfel', () => {
    for (const f of FILES) {
      const src = codeOnly(fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8'))
      assert.ok(src.includes("require('./lib/stripeLocale')"), `${f}: nu folosește lib/stripeLocale`)
      assert.equal((src.match(/stripeLocale\(/g) || []).length, 1, `${f}: exact un apel stripeLocale(`)
      assert.ok(/\.\.\.\(locale \? \{ locale \} : \{\}\)/.test(src), `${f}: locale nu ajunge în parametrii Stripe`)
      assert.ok(!/locale:\s*(?:body\.)?ui_lang/.test(src), `${f}: ui_lang trimis brut lui Stripe`)
    }
  })
})
