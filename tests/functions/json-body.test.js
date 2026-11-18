// tests/functions/json-body.test.js
// Corpul JSON care NU e obiect (lotul L8d, recenzia adversarială).
//
// De ce există: `JSON.parse('null')` reușește, deci ramura `bad_json` nu se
// lua, iar prima citire de proprietate arunca un TypeError neprins — un 5xx de
// platformă fără `code`, adică exact clasa pe care contractul de eroare al
// personalului o închide. Reprodus pe șapte din cele opt funcții ale
// contractului (stripe-checkout, stripe-connect, send-invite, ai-proxy,
// ai-config, ai-generate-image, ai-credits-checkout); doar stripe-portal se
// apăra singur. Toate citesc acum corpul prin `parseObjectBody`
// (netlify/functions/lib/jsonBody.js); clichetul structural e FEC3 din
// fn-error-code-ratchet.test.js.
//
//   JB1  CONTROL POZITIV: un obiect trece neschimbat (și imbricat); corp lipsă
//        / gol → `{}`, ca înainte. Fără el, „aruncă” ar trece și pe un helper
//        care aruncă mereu.
//   JB2  ne-JSON → SyntaxError; JSON care nu e obiect (`null`, tablou, număr,
//        șir, boolean) → TypeError. [PICĂ: verificarea `Array.isArray` scoasă]
//   JB3  cablajul, pe cele opt funcții: fiecare corp ne-obiect primește EXACT
//        răspunsul pe care funcția îl dă unui corp ne-JSON (aceeași ramură
//        `bad_json`, status + corp byte cu byte — niciun răspuns nou, deci
//        registrul FEC2 nu se schimbă); stripe-portal NU refuză (își citește
//        corpul tolerant, ajunge la `no_customer` ca pe `{}`). Control pozitiv
//        pe fiecare funcție: corpul `{}` NU e `bad_json` (altfel JB3 ar trece și
//        pe o funcție care respinge orice corp).
//        [PICĂ: oricare funcție readusă la `JSON.parse(event.body || '{}')` —
//        handler-ul aruncă pe `null`]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { state, resetMocks, loadFunction, parseBody } = require('./helpers/mocks')

const { parseObjectBody } = require(path.join(__dirname, '..', '..', 'netlify/functions/lib/jsonBody.js'))

const NON_OBJECTS = ['null', '[]', '[{"plan":"growth"}]', '5', '"growth"', 'true', 'false']

describe('JB1/JB2: parseObjectBody', () => {
  it('JB1 (control pozitiv): obiectul trece, corpul lipsă e {}', () => {
    assert.deepEqual(parseObjectBody('{"plan":"growth","x":{"y":[1]}}'), { plan: 'growth', x: { y: [1] } })
    assert.deepEqual(parseObjectBody('{}'), {})
    for (const raw of [undefined, null, '']) assert.deepEqual(parseObjectBody(raw), {}, String(raw))
  })

  it('JB2: ne-JSON → SyntaxError; JSON ne-obiect → TypeError', () => {
    assert.throws(() => parseObjectBody('{nu e json'), SyntaxError)
    for (const raw of NON_OBJECTS) assert.throws(() => parseObjectBody(raw), TypeError, raw)
  })
})

// ── JB3: cablajul în cele opt funcții ────────────────────────────────────────
const ENV = {
  SUPABASE_URL: 'https://sb.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_STARTER_PRICE_ID: 'price_starter',
  STRIPE_GROWTH_PRICE_ID: 'price_growth',
  STRIPE_PRO_PRICE_ID: 'price_pro',
  STRIPE_ENTERPRISE_PRICE_ID: 'price_enterprise',
  RESEND_API_KEY: 're_test',
  AI_CONFIG_SECRET: 'x'.repeat(40),
}
const READERS = [
  'stripe-checkout',
  'stripe-connect',
  'send-invite',
  'ai-proxy',
  'ai-config',
  'ai-generate-image',
  'ai-credits-checkout',
]

let saved

beforeEach(() => {
  saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]))
  Object.assign(process.env, ENV)
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function post(name, body, prep = () => {}) {
  resetMocks()
  state.authUser = { id: 'u1', email: 'a@x.test' }
  prep()
  const { handler } = loadFunction(`netlify/functions/${name}.js`)
  const savedErr = console.error
  console.error = () => {}
  try {
    return await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt' }, body })
  } finally {
    console.error = savedErr
  }
}

describe('JB3: corpul ne-obiect în funcțiile contractului', () => {
  it('cele șapte funcții care citesc corpul îl trimit pe ramura bad_json existentă', async () => {
    for (const name of READERS) {
      const notJson = await post(name, '{nu e json')
      assert.equal(notJson.statusCode, 400, `${name}: ${notJson.body}`)
      assert.equal(parseBody(notJson).code, 'bad_json', name)
      // Control pozitiv: un corp-obiect trece de citire (altă ramură, nu bad_json).
      const empty = await post(name, '{}')
      assert.notEqual(parseBody(empty).code, 'bad_json', `${name}: {} → ${empty.body}`)
      for (const raw of NON_OBJECTS) {
        const res = await post(name, raw)
        assert.equal(res.statusCode, notJson.statusCode, `${name} ${raw}: ${res.body}`)
        assert.equal(res.body, notJson.body, `${name} ${raw}`)
      }
    }
  })

  it('stripe-portal citește corpul tolerant: un corp ne-obiect nu e refuzat', async () => {
    const noCustomer = () => {
      state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
      state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: null }, error: null })
    }
    const asEmpty = await post('stripe-portal', '{}', noCustomer)
    assert.equal(parseBody(asEmpty).code, 'no_customer', asEmpty.body)
    for (const raw of [...NON_OBJECTS, '{nu e json']) {
      const res = await post('stripe-portal', raw, noCustomer)
      assert.equal(res.statusCode, asEmpty.statusCode, `${raw}: ${res.body}`)
      assert.equal(res.body, asEmpty.body, raw)
    }
  })
})
