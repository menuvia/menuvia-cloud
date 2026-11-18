// tests/functions/stripe-connect.test.js
// Contractul de eroare al onboarding-ului Stripe Connect (lotul L8d).
//
// De ce există: funcția întorcea 12 răspunsuri de eroare, dintre care UNUL
// singur cu `code` (`country_not_supported`); restul erau text românesc sau
// englezesc (`Invalid JSON body`) — niciun client nu le putea traduce în limba
// personalului. OnlinePaymentsCard (card DOAR-ROMÂNIA, în română prin decizia L6b)
// afișează încă `error`, deci textul rămâne EXACT cel de dinainte; `code` e
// contractul pentru clientul care îl va traduce.
//
//   SCN1  FIECARE ramură non-2xx JSON → statusul și `code`-ul ei, cu textul de
//         dinainte, iar corpul are DOAR `error` + `code`. 12 rânduri =
//         registrul FEC2 din fn-error-code-ratchet.test.js.
//         Mutația care pică: `code: 'forbidden'` scos din 403.
//   SCN2  CONTROL POZITIV: `status` fără cont → 200 `{ connected: false }`,
//         `link` → 200 cu URL — altfel SCN1 ar trece și pe o funcție care
//         răspunde mereu cu eroare.
//   SCN3  gărzile rămân ÎNAINTEA Stripe: refuzul de rol și cel de țară nu
//         ating nicio metodă Stripe (nici cont, nici link).
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, parseBody } = require('./helpers/mocks')

const REL = 'netlify/functions/stripe-connect.js'
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'VITE_APP_URL']
const RID = '11111111-2222-3333-4444-555555555555'

let saved

function baseline() {
  resetMocks()
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    STRIPE_SECRET_KEY: 'sk_test_x',
  })
  state.authUser = { id: 'owner-1', email: 'ana@x.test' }
  state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
  state.fromHandlers['restaurants'] = () => ({
    data: { stripe_account_id: null, name: 'Bistro', country: 'RO' },
    error: null,
  })
  state.rpcHandlers['set_restaurant_stripe_account'] = () => ({ data: null, error: null })
  state.stripeImpls['accounts.create'] = async () => ({ id: 'acct_1' })
  state.stripeImpls['accountLinks.create'] = async () => ({ url: 'https://connect.stripe.com/setup/s/1' })
}

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  baseline()
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function call(body, headers = { authorization: 'Bearer jwt' }) {
  const { handler } = loadFunction(REL)
  const savedErr = console.error
  console.error = () => {}
  try {
    return await handler({
      httpMethod: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  } finally {
    console.error = savedErr
  }
}

const LINK = { restaurant_id: RID, action: 'link' }
const STATUS = { restaurant_id: RID, action: 'status' }

// [nume, pregătire, corp, antete, status, cod, text EXACT]
const BRANCHES = [
  ['env lipsă', () => { delete process.env.STRIPE_SECRET_KEY }, LINK, undefined, 500, 'server_config',
    'Stripe Connect nu este configurat.'],
  ['corp non-JSON', () => {}, '{nu e json', undefined, 400, 'bad_json', 'Invalid JSON body'],
  ['acțiune necunoscută', () => {}, { restaurant_id: RID, action: 'delete' }, undefined, 400, 'invalid_request',
    'restaurant_id și action (link|status) sunt obligatorii.'],
  ['fără antet', () => {}, LINK, {}, 401, 'auth_missing', 'Neautentificat.'],
  ['token invalid', () => { state.authUser = null }, LINK, undefined, 401, 'auth_invalid', 'Sesiune invalidă.'],
  ['apartenența necitibilă', () => {
    state.fromHandlers['restaurant_memberships'] = () => ({ data: null, error: { message: 'timeout' } })
  }, LINK, undefined, 500, 'membership_check_failed', 'Verificarea accesului a eșuat.'],
  ['ospătar', () => {
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'waiter' }, error: null })
  }, LINK, undefined, 403, 'forbidden', 'Doar owner/manager poate configura plățile.'],
  ['restaurant inexistent', () => {
    state.fromHandlers['restaurants'] = () => ({ data: null, error: null })
  }, LINK, undefined, 404, 'restaurant_not_found', 'Restaurant negăsit.'],
  ['status: Stripe căzut', () => {
    state.fromHandlers['restaurants'] = () => ({ data: { stripe_account_id: 'acct_1', name: 'B', country: 'RO' }, error: null })
    state.stripeImpls['accounts.retrieve'] = async () => { throw new Error('stripe down') }
  }, STATUS, undefined, 502, 'stripe_unavailable', 'Stripe indisponibil. Reîncearcă.'],
  ['țară ≠ RO', () => {
    state.fromHandlers['restaurants'] = () => ({ data: { stripe_account_id: null, name: 'B', country: 'FR' }, error: null })
  }, LINK, undefined, 403, 'country_not_supported',
    'Plata online este disponibilă doar pentru restaurantele din România.'],
  ['contul nu s-a legat', () => {
    state.rpcHandlers['set_restaurant_stripe_account'] = () => ({ data: null, error: { message: 'denied' } })
  }, LINK, undefined, 500, 'account_link_failed', 'Contul a fost creat dar legarea a eșuat. Reîncearcă.'],
  ['Stripe refuză linkul', () => {
    state.stripeImpls['accountLinks.create'] = async () => { throw new Error('Connect not enabled') }
  }, LINK, undefined, 502, 'stripe_rejected',
    'Stripe a refuzat operațiunea. Verifică dacă Connect e activat pe contul platformei.'],
]

describe('stripe-connect: un cod stabil pe fiecare ramură (lotul L8d)', () => {
  it('SCN1: fiecare ramură non-2xx → status + code, cu textul de dinainte', async () => {
    assert.equal(BRANCHES.length, 12, 'un rând pe ramură (registrul FEC2)')
    const codes = new Set()
    for (const [name, prep, body, headers, status, code, text] of BRANCHES) {
      baseline()
      prep()
      const res = await call(body, headers ?? { authorization: 'Bearer jwt' })
      assert.equal(res.statusCode, status, name)
      const b = parseBody(res)
      assert.equal(b.code, code, name)
      assert.equal(b.error, text, name)
      assert.deepEqual(Object.keys(b).sort(), ['code', 'error'], `${name}: alte chei în corp`)
      codes.add(code)
    }
    assert.equal(codes.size, 12, 'fiecare ramură are codul ei')
  })

  it('SCN2: control — status fără cont și link reușit → 200', async () => {
    const st = await call(STATUS)
    assert.equal(st.statusCode, 200, st.body)
    assert.deepEqual(parseBody(st), { connected: false })
    baseline()
    const link = await call(LINK)
    assert.equal(link.statusCode, 200, link.body)
    assert.equal(parseBody(link).url, 'https://connect.stripe.com/setup/s/1')
  })

  it('SCN3: refuzul de rol și cel de țară nu ating Stripe', async () => {
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'kitchen' }, error: null })
    assert.equal((await call(LINK)).statusCode, 403)
    assert.equal(state.stripeCalls.length, 0)
    baseline()
    state.fromHandlers['restaurants'] = () => ({ data: { stripe_account_id: null, name: 'B', country: 'DE' }, error: null })
    assert.equal(parseBody(await call(LINK)).code, 'country_not_supported')
    assert.equal(state.stripeCalls.length, 0)
  })
})
