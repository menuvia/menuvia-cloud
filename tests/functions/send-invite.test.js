// tests/functions/send-invite.test.js
// O invitație nouă NU mai șterge alte invitații.
//
// De ce există: send-invite ștergea invitațiile în așteptare cu
// `.ilike('email', dbEmail)` — adresa NEESCAPATĂ într-un pattern LIKE, unde `_`
// și `%` sunt wildcard-uri (iar PostgREST tratează și `*` ca `%`). Și le ștergea
// ÎNAINTE de a crea și trimite invitația nouă: un insert sau un email eșuat
// lăsa omul fără niciun link valid.
//
//   INV1  `_` din adresă e escapat în AMBELE filtre ilike (profil + curățare).
//         Mutația care pică: `.ilike('email', dbEmail)` neescapat.
//   INV2  `%`, `*`, `\` în adresă → 400 invalid_email, nicio scriere. `%@%.%`
//         trecea de regex și ștergea toate invitațiile restaurantului.
//   INV3  ordinea: insert → email → abia apoi curățarea celorlalte invitații,
//         cu `neq token` (invitația nouă nu se șterge singură), pe restaurant
//         și doar `accepted_at is null`. Mutația care pică: ștergerea înainte
//         de insert (ordinea veche).
//   INV4  Resend refuză (4xx) → 502 email_send_failed; se șterge DOAR invitația
//         nouă (după token), cele vechi rămân.
//   INV5  Resend nu răspunde (timeout/rețea) → 504 email_send_uncertain, nicio
//         ștergere (emailul poate să fi plecat).
//   INV6  insert eșuat → 500 invite_create_failed, nicio ștergere.
//   INV7  fără RESEND_API_KEY → 503 înaintea oricărei scrieri.
//   INV8  fiecare eroare e `{ error: <română>, code }`.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, parseBody, rpcCallsFor } = require('./helpers/mocks')

const REL = 'netlify/functions/send-invite.js'
const RID = 'rest-1'
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'VITE_APP_URL']

let saved
let savedFetch
let resend
let resendImpl

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    RESEND_API_KEY: 're_test',
  })
  savedFetch = global.fetch
  resend = []
  resendImpl = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ id: 'em_1' }) })
  global.fetch = async (url, init) => {
    resend.push({ url: String(url), body: JSON.parse(init.body) })
    return resendImpl()
  }
  state.authUser = { id: 'owner-1' }
  state.rpcHandlers['check_rate_limit'] = () => ({ data: true, error: null })
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
      ? { data: { token: 'tok-new' }, error: null }
      : { data: null, error: null }
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

async function invite(email, extra) {
  const { handler } = loadFunction(REL)
  const savedErr = console.error
  console.error = () => {}
  try {
    return await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: JSON.stringify({ email, role: 'waiter', restaurant_id: RID, ...extra }),
    })
  } finally {
    console.error = savedErr
  }
}

// Operațiile pe invite_tokens, în ordinea execuției.
const inviteOps = () => state.fromCalls.filter((c) => c.table === 'invite_tokens').map((c) => c.ops)
const isDelete = (ops) => ops.some((o) => o.m === 'delete')
const isInsert = (ops) => ops.some((o) => o.m === 'insert')
const argOf = (ops, m) => {
  const op = ops.find((o) => o.m === m)
  return op ? op.args : undefined
}

function expectError(res, status, code) {
  assert.equal(res.statusCode, status, res.body)
  const b = parseBody(res)
  assert.equal(b.code, code, res.body)
  assert.match(b.error, /[ăâîșțĂÂÎȘȚ]/, `mesaj ne-românesc: ${b.error}`)
}

describe('send-invite: o invitație nouă nu mai șterge alte invitații', () => {
  it('INV1: `_` din adresă e escapat în ambele filtre ilike', async () => {
    const res = await invite('ana_pop@x.ro')
    assert.equal(res.statusCode, 200, res.body)
    const profileLookup = state.fromCalls.find(
      (c) => c.table === 'profiles' && c.ops.some((o) => o.m === 'ilike'),
    )
    assert.deepEqual(argOf(profileLookup.ops, 'ilike'), ['email', 'ana\\_pop@x.ro'])
    const cleanup = inviteOps().find(isDelete)
    assert.deepEqual(argOf(cleanup, 'ilike'), ['email', 'ana\\_pop@x.ro'])
  })

  for (const email of ['%@%.%', 'a*b@x.ro', 'a\\b@x.ro', 'x%y@x.ro']) {
    it(`INV2: ${JSON.stringify(email)} → 400 invalid_email, nicio scriere`, async () => {
      const res = await invite(email)
      expectError(res, 400, 'invalid_email')
      assert.equal(inviteOps().length, 0, 'invitațiile au fost atinse')
      assert.equal(resend.length, 0)
    })
  }

  it('INV3: insert → email → curățarea CELORLALTE invitații, după token', async () => {
    const res = await invite('Ion@X.ro')
    assert.equal(res.statusCode, 200, res.body)
    const ops = inviteOps()
    const firstDelete = ops.findIndex(isDelete)
    const insertAt = ops.findIndex(isInsert)
    assert.ok(insertAt >= 0, 'invitația nouă nu s-a creat')
    assert.ok(firstDelete > insertAt, 'invitațiile vechi s-au șters ÎNAINTE de a crea invitația nouă')
    assert.equal(resend.length, 1)
    const cleanup = ops[firstDelete]
    assert.deepEqual(argOf(cleanup, 'neq'), ['token', 'tok-new'], 'curățarea ar șterge chiar invitația nouă')
    assert.deepEqual(argOf(cleanup, 'eq'), ['restaurant_id', RID])
    assert.deepEqual(argOf(cleanup, 'is'), ['accepted_at', null])
    assert.deepEqual(argOf(cleanup, 'ilike'), ['email', 'Ion@X.ro'])
    assert.equal(ops.filter(isDelete).length, 1)
  })

  it('INV4: Resend refuză → 502, se șterge DOAR invitația nouă', async () => {
    resendImpl = async () => ({ ok: false, status: 422, text: async () => '{"message":"invalid"}' })
    const res = await invite('ion@x.ro')
    expectError(res, 502, 'email_send_failed')
    const deletes = inviteOps().filter(isDelete)
    assert.equal(deletes.length, 1)
    assert.equal(argOf(deletes[0], 'ilike'), undefined, 'ștergere pe adresă = invitațiile vechi pierdute')
    const eqs = deletes[0].filter((o) => o.m === 'eq').map((o) => o.args)
    assert.deepEqual(eqs, [
      ['restaurant_id', RID],
      ['token', 'tok-new'],
    ])
  })

  it('INV5: Resend nu răspunde → 504, nicio ștergere', async () => {
    resendImpl = async () => {
      const e = new Error('The operation was aborted due to timeout')
      e.name = 'TimeoutError'
      throw e
    }
    const res = await invite('ion@x.ro')
    expectError(res, 504, 'email_send_uncertain')
    assert.equal(inviteOps().filter(isDelete).length, 0)
  })

  it('INV6: insert eșuat → 500, invitațiile vechi neatinse', async () => {
    state.fromHandlers['invite_tokens'] = (ops) =>
      isInsert(ops) ? { data: null, error: { message: 'boom' } } : { data: null, error: null }
    const res = await invite('ion@x.ro')
    expectError(res, 500, 'invite_create_failed')
    assert.equal(inviteOps().filter(isDelete).length, 0, 'invitațiile vechi s-au șters fără una nouă')
    assert.equal(resend.length, 0)
  })

  it('INV7: fără RESEND_API_KEY → 503 înaintea oricărei scrieri', async () => {
    delete process.env.RESEND_API_KEY
    const res = await invite('ion@x.ro')
    expectError(res, 503, 'email_not_configured')
    assert.equal(state.fromCalls.length, 0)
    assert.equal(rpcCallsFor('check_rate_limit').length, 0)
  })

  it('INV8: erorile de validare / drepturi sunt în română, cu cod', async () => {
    expectError(await invite('', {}), 400, 'missing_fields')
    expectError(await invite('ion@x.ro', { role: 'owner' }), 400, 'invalid_role')
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'waiter' }, error: null })
    expectError(await invite('ion@x.ro'), 403, 'forbidden')
    state.authUser = null
    expectError(await invite('ion@x.ro'), 401, 'auth_invalid')
    const { handler } = loadFunction(REL)
    expectError(await handler({ httpMethod: 'GET', headers: {} }), 405, 'method_not_allowed')
  })
})
