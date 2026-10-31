// tests/functions/ai-proxy-agent.test.js
// ai-proxy: agentul de vânzări (nu owner/manager) are voie să folosească AI-ul
// DOAR pentru munca de meniu (pachetul 10, PR-6).
//
//   AI1  agentul + `chat` → 403 și NICIUN apel către provider / cotă / has_partner_access
//        (feature-ul se verifică ÎNAINTEA oricărui apel de rețea); la fel `nutrition`
//   AI2  drumul owner-ului/managerului NEschimbat: `chat` merge, has_partner_access
//        nu se cheamă, cota se consumă pe restaurant
//   AI3  agent FĂRĂ acces (rpc false / eroare / non-boolean / fără cheie anon) → 403,
//        FĂRĂ apel către provider (fail-closed pe TOATE formele de eșec)
//   AI4  agent CU acces + `menu_import` → 200, iar cota e a RESTAURANTULUI
//        (ai_can_use / ai_record_usage pe restaurant_id, nu pe utilizator); `translate` la fel
//   AI5  verificarea merge pe un client cu JWT-ul UTILIZATORULUI + cheia anon — NU pe
//        clientul de serviciu (has_partner_access e revocată pentru service_role și
//        citește auth.uid(): pe service ar întoarce fals/eroare sau, mai rău, ar fi
//        evaluată pentru altcineva)
//   AI6  fără JWT → 401; JWT invalid → 401 (nimic nu se evaluează)
//   AI7  un utilizator cu membership ne-admin (waiter) NU capătă drepturile owner-ului:
//        `chat` → 403 (merge prin aceeași poartă ca agentul)
//
// Rulează în jobul „Bridge tests” (vitest nu vede tests/functions).

'use strict'

const { describe, it, before, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const { state, resetMocks, installModuleMocks, loadFunction, parseBody, rpcCallsFor } = require('./helpers/mocks')

const RID = 'rest-1'
const SERVICE_KEY = 'service-role-key'
const ANON_KEY = 'anon-key-public'
const TOKEN = 'user-jwt-token'

// ── Clienți supabase etichetați ──────────────────────────────────────────────
// Harness-ul comun întoarce ACELAȘI fake pentru orice createClient; testul de
// față are nevoie să știe CARE client a făcut un apel (serviciu vs. JWT-ul
// utilizatorului). Împachetăm createClient local, fără să atingem helpers/mocks.js.
const clients = []
let handler
before(() => {
  installModuleMocks()
  const prevLoad = Module._load
  Module._load = function (request) {
    if (request === '@supabase/supabase-js') {
      const base = prevLoad.apply(this, arguments)
      return {
        createClient: (url, key, options) => {
          const c = base.createClient(url, key, options)
          const headers = (options && options.global && options.global.headers) || {}
          const meta = { url, key, authorization: headers.Authorization || null, rpc: [] }
          clients.push(meta)
          const origRpc = c.rpc
          c.rpc = (name, args) => {
            meta.rpc.push(name)
            return origRpc(name, args)
          }
          return c
        },
      }
    }
    return prevLoad.apply(this, arguments)
  }
  handler = loadFunction('netlify/functions/ai-proxy.js').handler
})

const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
  'AI_CONFIG_SECRET', 'PLATFORM_OPENAI_KEY',
]
let savedEnv
let savedFetch
let fetchCalls

beforeEach(() => {
  resetMocks()
  clients.length = 0
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.SUPABASE_URL = 'https://x.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
  process.env.SUPABASE_ANON_KEY = ANON_KEY
  delete process.env.VITE_SUPABASE_ANON_KEY
  process.env.AI_CONFIG_SECRET = 'x'.repeat(40)
  process.env.PLATFORM_OPENAI_KEY = 'sk-platform'
  // Providerul (OpenAI) e simulat: orice apel e înregistrat.
  fetchCalls = []
  savedFetch = global.fetch
  global.fetch = async (url) => {
    fetchCalls.push(String(url))
    return {
      ok: true,
      status: 200,
      type: 'basic',
      json: async () => ({
        choices: [{ message: { content: '[{"name":"Pizza"}]' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      text: async () => '',
    }
  }
  // Implicit: utilizatorul e autentificat, cota permite, consumul se înregistrează.
  state.authUser = { id: 'user-1' }
  state.rpcHandlers['ai_can_use'] = () => ({ data: true, error: null })
  state.rpcHandlers['ai_record_usage'] = () => ({ data: { remaining: 100 }, error: null })
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  global.fetch = savedFetch
})

function asMember(role) {
  state.fromHandlers['restaurant_memberships'] = () =>
    role ? { data: { role }, error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } }
}
function asPartner(result) {
  state.rpcHandlers['has_partner_access'] = () => result
}
function req(feature, over) {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      restaurant_id: RID,
      feature,
      messages: [{ role: 'user', content: 'extrage produsele' }],
      ...(over || {}),
    }),
  }
}
const partnerCalls = () => rpcCallsFor('has_partner_access')

describe('ai-proxy: agentul de vânzări', () => {
  it('AI1: agentul + feature din afara meniului (chat / nutrition) → 403, fără niciun apel', async () => {
    asMember(null)
    asPartner({ data: true, error: null }) // CHIAR cu acces valid
    for (const feature of ['chat', 'nutrition']) {
      const res = await handler(req(feature))
      assert.equal(res.statusCode, 403, `${feature} trebuie respins pentru agent`)
      assert.equal(parseBody(res).error, 'Forbidden')
    }
    assert.equal(fetchCalls.length, 0, 'providerul nu are voie să fie atins')
    assert.equal(rpcCallsFor('ai_can_use').length, 0, 'cota nu se consultă')
    assert.equal(rpcCallsFor('ai_record_usage').length, 0)
    assert.equal(partnerCalls().length, 0, 'feature-ul se verifică ÎNAINTE de has_partner_access')
  })

  it('AI2: drumul owner-ului / managerului e neschimbat (chat merge, fără has_partner_access)', async () => {
    for (const role of ['owner', 'manager']) {
      resetMocks()
      state.authUser = { id: 'user-1' }
      state.rpcHandlers['ai_can_use'] = () => ({ data: true, error: null })
      state.rpcHandlers['ai_record_usage'] = () => ({ data: { remaining: 100 }, error: null })
      fetchCalls.length = 0
      asMember(role)
      const res = await handler(req('chat'))
      assert.equal(res.statusCode, 200, `${role}: chat trebuie să meargă`)
      assert.equal(parseBody(res).text, '[{"name":"Pizza"}]')
      assert.equal(partnerCalls().length, 0, `${role}: nu trece prin poarta agentului`)
      assert.equal(fetchCalls.length, 1)
      assert.deepEqual(rpcCallsFor('ai_can_use')[0].args.p_restaurant_id, RID)
      assert.equal(rpcCallsFor('ai_record_usage')[0].args.p_restaurant_id, RID)
    }
  })

  it('AI3: agent fără acces → 403 pe toate formele de eșec, fără provider', async () => {
    asMember(null)
    const cazuri = [
      ['fals', { data: false, error: null }],
      ['null', { data: null, error: null }],
      ['eroare rpc', { data: null, error: { message: 'boom', code: '42501' } }],
      ['eroare chiar cu data:true', { data: true, error: { message: 'jwt expired' } }],
      ['non-boolean ("true")', { data: 'true', error: null }],
      ['non-boolean (1)', { data: 1, error: null }],
      ['obiect', { data: { ok: true }, error: null }],
    ]
    for (const [nume, rez] of cazuri) {
      asPartner(rez)
      const res = await handler(req('menu_import'))
      assert.equal(res.statusCode, 403, `${nume}: trebuie 403`)
    }
    // Rpc care ARUNCĂ (rețea) → tot 403, nu 500 și nu „lasă să treacă”.
    state.rpcHandlers['has_partner_access'] = () => {
      throw new Error('ECONNRESET')
    }
    assert.equal((await handler(req('menu_import'))).statusCode, 403)
    // Fără cheie anon în mediu → fail-closed (nu putem verifica ca utilizator).
    asPartner({ data: true, error: null })
    delete process.env.SUPABASE_ANON_KEY
    delete process.env.VITE_SUPABASE_ANON_KEY
    assert.equal((await handler(req('menu_import'))).statusCode, 403)
    assert.equal(fetchCalls.length, 0, 'niciun apel către provider')
    assert.equal(rpcCallsFor('ai_can_use').length, 0)
    assert.equal(rpcCallsFor('ai_record_usage').length, 0)
  })

  it('AI4: agent cu acces + menu_import / translate → 200, cota e a RESTAURANTULUI', async () => {
    asMember(null)
    asPartner({ data: true, error: null })
    for (const feature of ['menu_import', 'translate']) {
      fetchCalls.length = 0
      state.rpcCalls.length = 0
      const res = await handler(req(feature))
      assert.equal(res.statusCode, 200, `${feature}: agentul cu acces trebuie să treacă`)
      assert.equal(fetchCalls.length, 1)
      const can = rpcCallsFor('ai_can_use')
      const rec = rpcCallsFor('ai_record_usage')
      assert.equal(can.length, 1)
      assert.equal(can[0].args.p_restaurant_id, RID, 'pre-check-ul de cotă e pe restaurant')
      assert.equal(rec.length, 1)
      assert.equal(rec[0].args.p_restaurant_id, RID, 'consumul se scade din cota restaurantului')
      assert.equal(rec[0].args.p_feature, feature)
      // Nicio urmă a utilizatorului-agent în argumentele de cotă.
      for (const c of [...can, ...rec]) {
        assert.equal(JSON.stringify(c.args).includes('user-1'), false, 'cota nu are voie să poarte id-ul agentului')
      }
    }
  })

  it('AI5: has_partner_access rulează pe clientul cu JWT-ul utilizatorului, NU pe cel de serviciu', async () => {
    asMember(null)
    asPartner({ data: true, error: null })
    const res = await handler(req('menu_import'))
    assert.equal(res.statusCode, 200)
    const callers = clients.filter((c) => c.rpc.includes('has_partner_access'))
    assert.equal(callers.length, 1, 'exact un client a verificat apartenența')
    assert.equal(callers[0].authorization, `Bearer ${TOKEN}`, 'cu JWT-ul utilizatorului')
    assert.equal(callers[0].key, ANON_KEY, 'cheia anon (publică), nu cea de serviciu')
    assert.notEqual(callers[0].key, SERVICE_KEY)
    // Clientul de serviciu nu o apelează niciodată.
    const service = clients.filter((c) => c.key === SERVICE_KEY)
    assert.ok(service.length >= 1, 'control: clientul de serviciu există (auth + cotă)')
    for (const c of service) {
      assert.equal(c.rpc.includes('has_partner_access'), false, 'service_role nu are voie să cheme has_partner_access')
    }
    // Cheia anon NU ajunge pe clientul de serviciu și invers.
    assert.equal(callers[0].authorization.includes(SERVICE_KEY), false)
    // Fallback-ul pe VITE_SUPABASE_ANON_KEY (mediul de build) merge, fără cheia dedicată.
    clients.length = 0
    delete process.env.SUPABASE_ANON_KEY
    process.env.VITE_SUPABASE_ANON_KEY = 'vite-anon'
    const res2 = await handler(req('menu_import'))
    assert.equal(res2.statusCode, 200)
    assert.equal(clients.find((c) => c.rpc.includes('has_partner_access')).key, 'vite-anon')
  })

  it('AI6: fără JWT / JWT invalid → 401, nimic evaluat', async () => {
    asMember('owner')
    const fara = { ...req('chat'), headers: {} }
    const r1 = await handler(fara)
    assert.equal(r1.statusCode, 401)
    state.authUser = null // token invalid (fail-closed implicit al harness-ului)
    const r2 = await handler(req('chat'))
    assert.equal(r2.statusCode, 401)
    const r3 = await handler(req('menu_import'))
    assert.equal(r3.statusCode, 401)
    assert.equal(partnerCalls().length, 0)
    assert.equal(fetchCalls.length, 0)
  })

  it('AI7: membership ne-admin (waiter) nu capătă drepturile owner-ului', async () => {
    asMember('waiter')
    asPartner({ data: false, error: null })
    const chat = await handler(req('chat'))
    assert.equal(chat.statusCode, 403)
    const imp = await handler(req('menu_import'))
    assert.equal(imp.statusCode, 403, 'waiter fără acces de partener nu importă meniul')
    assert.equal(fetchCalls.length, 0)
  })
})
