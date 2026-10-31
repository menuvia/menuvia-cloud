// tests/functions/ai-error-contract.test.js
// Contractul de EROARE al funcțiilor AI: orice răspuns non-200 al lui
// ai-proxy, ai-config, ai-generate-image și ai-credits-checkout e
//   { error: <mesaj în română>, code: <cod stabil> }
// cu mesajul luat din tabela unică `netlify/functions/lib/aiErrors.js`.
//
// De ce: funcțiile întorceau „Forbidden", „Invalid or expired token",
// „AI provider request failed", „Could not verify AI quota" — fără cod —, iar
// clientul afișa `error` ca atare în toast. Patronul vedea engleză internă,
// iar AiBulkGenerate nu putea deosebi o eroare de configurare (care se repetă
// la fiecare produs) de eșecul unui singur produs.
//
//   AEC1  clichet STRUCTURAL: în cele patru fișiere nu mai există niciun
//         răspuns de eroare scris de mână (`jsonResponse(<non-200>` sau un
//         `statusCode` literal de eroare) — totul trece prin aiError().
//         Mutația care pică: reintrodus `return jsonResponse(403, { error: 'Forbidden' })`.
//   AEC2  fiecare mesaj din tabelă e în română (diacritice) și fără termeni
//         interni englezești. Mutația care pică: un mesaj „Forbidden".
//   AEC3  codurile folosite în funcții == codurile din tabelă (ambele sensuri:
//         un cod fără mesaj ar arunca la runtime pe o ramură netestată; un
//         mesaj fără apelant e text mort).
//   AEC4  cablajul real, pe ramurile importante ale fiecărei funcții: status,
//         cod și mesaj EXACT din tabelă. Timeout-ul furnizorului e 504
//         `provider_timeout` (remediu concret), nu 502 generic. Un apel Stripe
//         care aruncă în ai-credits-checkout e 502 `checkout_failed`, nu o
//         excepție neprinsă (fără corp de contract).
//   AEC5  control: aiError() aruncă pe un cod necunoscut (altfel AEC3 n-ar
//         avea ce prinde la runtime).
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { state, resetMocks, loadFunction, parseBody } = require('./helpers/mocks')

const ROOT = path.join(__dirname, '..', '..')
const FILES = [
  'netlify/functions/ai-proxy.js',
  'netlify/functions/ai-config.js',
  'netlify/functions/ai-generate-image.js',
  'netlify/functions/ai-credits-checkout.js',
]
const { AI_ERROR_MESSAGES, aiError } = require(path.join(ROOT, 'netlify/functions/lib/aiErrors.js'))

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// Fără comentarii: un exemplu de cod vechi citat într-un comentariu nu e cod.
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('AEC1–AEC3: tabela unică și clichetul structural', () => {
  it('AEC1: niciun răspuns de eroare scris de mână în funcțiile AI', () => {
    for (const rel of FILES) {
      const src = codeOnly(read(rel))
      assert.ok(src.includes("require('./lib/aiErrors')"), `${rel} nu folosește lib/aiErrors`)
      const handRolled = [...src.matchAll(/jsonResponse\(\s*(\d{3})/g)].map((m) => m[1]).filter((st) => st !== '200')
      assert.deepEqual(handRolled, [], `${rel}: răspunsuri de eroare ocolesc contractul: ${handRolled}`)
      const literal = [...src.matchAll(/statusCode:\s*([45]\d\d)/g)].map((m) => m[1])
      assert.deepEqual(literal, [], `${rel}: statusCode de eroare literal (fără cod/mesaj în română): ${literal}`)
      // Anti-vacuitate: fișierul chiar folosește contractul.
      assert.ok(/aiError\(\s*\d{3},\s*'[a-z_]+'/.test(src), `${rel}: niciun apel aiError găsit`)
    }
  })

  it('AEC2: fiecare mesaj e în română și fără termeni interni', () => {
    const codes = Object.keys(AI_ERROR_MESSAGES)
    assert.ok(codes.length >= 25, `tabela e suspect de scurtă (${codes.length})`)
    for (const code of codes) {
      const msg = AI_ERROR_MESSAGES[code]
      assert.match(code, /^[a-z][a-z_]*$/, `cod cu formă neașteptată: ${code}`)
      assert.equal(typeof msg, 'string')
      assert.match(msg, /[ăâîșțĂÂÎȘȚ]/, `${code}: mesajul nu pare în română: „${msg}"`)
      assert.ok(
        !/\b(Forbidden|Unauthorized|Invalid|Missing|Could not|failed|error|provider|payload|token expired)\b/i.test(msg),
        `${code}: termen intern englezesc în mesaj: „${msg}"`,
      )
    }
  })

  it('AEC3: codurile folosite == codurile din tabelă (ambele sensuri)', () => {
    const used = new Set()
    for (const rel of FILES) {
      for (const m of codeOnly(read(rel)).matchAll(/aiError\(\s*\d{3},\s*'([a-z_]+)'/g)) used.add(m[1])
    }
    const table = new Set(Object.keys(AI_ERROR_MESSAGES))
    const unknown = [...used].filter((c) => !table.has(c))
    const dead = [...table].filter((c) => !used.has(c))
    assert.deepEqual(unknown, [], `coduri folosite fără mesaj în tabelă: ${unknown}`)
    assert.deepEqual(dead, [], `mesaje fără niciun apelant (text mort): ${dead}`)
  })

  it('AEC5 (control): aiError aruncă pe un cod necunoscut și formează corpul corect', () => {
    assert.throws(() => aiError(400, 'nu_exista'), /cod necunoscut/)
    const r = aiError(403, 'forbidden')
    assert.equal(r.statusCode, 403)
    assert.deepEqual(JSON.parse(r.body), { error: AI_ERROR_MESSAGES.forbidden, code: 'forbidden' })
    const withDetail = JSON.parse(aiError(400, 'base_url_rejected', 'host intern interzis').body)
    assert.equal(withDetail.error, `${AI_ERROR_MESSAGES.base_url_rejected} (host intern interzis)`)
  })
})

// ── AEC4: cablajul real ──────────────────────────────────────────────────────
const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'AI_CONFIG_SECRET',
  'PLATFORM_OPENAI_KEY', 'PLATFORM_GEMINI_KEY', 'PLATFORM_ANTHROPIC_KEY', 'STRIPE_SECRET_KEY',
]
let savedEnv
let savedFetch
let fetchImpl

beforeEach(() => {
  resetMocks()
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://x.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_ANON_KEY: 'anon',
    AI_CONFIG_SECRET: 'x'.repeat(40),
    PLATFORM_OPENAI_KEY: 'sk-platform',
    STRIPE_SECRET_KEY: 'sk_test_x',
  })
  savedFetch = global.fetch
  fetchImpl = async () => ({
    ok: true,
    status: 200,
    type: 'basic',
    json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    text: async () => '',
  })
  global.fetch = (...a) => fetchImpl(...a)
  state.authUser = { id: 'user-1' }
  state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
  state.rpcHandlers['ai_can_use'] = () => ({ data: true, error: null })
  state.rpcHandlers['ai_record_usage'] = () => ({ data: {}, error: null })
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  global.fetch = savedFetch
})

function post(body, headers) {
  return {
    httpMethod: 'POST',
    headers: headers || { authorization: 'Bearer jwt' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

function expectError(res, status, code) {
  assert.equal(res.statusCode, status, `status: ${res.statusCode} ${res.body}`)
  const b = parseBody(res)
  assert.equal(b.code, code, `cod: ${res.body}`)
  assert.ok(String(b.error).startsWith(AI_ERROR_MESSAGES[code]), `mesaj: ${b.error}`)
}

const chat = { restaurant_id: 'r1', feature: 'chat', messages: [{ role: 'user', content: 'salut' }] }

describe('AEC4: ai-proxy', () => {
  const run = (ev) => loadFunction('netlify/functions/ai-proxy.js').handler(ev)

  it('auth, cerere, drepturi', async () => {
    expectError(await run({ httpMethod: 'GET', headers: {} }), 405, 'method_not_allowed')
    expectError(await run(post(chat, {})), 401, 'auth_missing')
    state.authUser = null
    expectError(await run(post(chat)), 401, 'auth_invalid')
    state.authUser = { id: 'user-1' }
    expectError(await run(post('{nu json')), 400, 'bad_json')
    expectError(await run(post({ ...chat, restaurant_id: undefined })), 400, 'missing_restaurant')
    expectError(await run(post({ ...chat, feature: 'hack' })), 400, 'invalid_feature')
    expectError(await run(post({ ...chat, messages: [] })), 400, 'missing_messages')
    const big = { ...chat, messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024 + 10) }] }
    expectError(await run(post(big)), 413, 'payload_too_large')
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'waiter' }, error: null })
    expectError(await run(post(chat)), 403, 'forbidden')
  })

  it('configurație și cotă', async () => {
    state.fromHandlers['ai_provider_configs'] = () => ({ data: { provider: 'openai', model: '', enabled: false }, error: null })
    expectError(await run(post(chat)), 400, 'ai_disabled')
    state.fromHandlers['ai_provider_configs'] = () => ({ data: null, error: { message: 'boom' } })
    expectError(await run(post(chat)), 500, 'config_load_failed')
    state.fromHandlers['ai_provider_configs'] = () => ({ data: null, error: null })
    delete process.env.PLATFORM_OPENAI_KEY
    expectError(await run(post(chat)), 400, 'provider_key_missing')
    process.env.PLATFORM_OPENAI_KEY = 'sk-platform'
    state.rpcHandlers['ai_can_use'] = () => ({ data: null, error: { message: 'down' } })
    expectError(await run(post(chat)), 500, 'quota_check_failed')
    state.rpcHandlers['ai_can_use'] = () => ({ data: false, error: null })
    expectError(await run(post(chat)), 429, 'quota_exceeded')
  })

  it('furnizorul: eșec → 502 provider_failed; timeout → 504 provider_timeout', async () => {
    const savedErr = console.error
    console.error = () => {}
    try {
      fetchImpl = async () => ({ ok: false, status: 500, type: 'basic', text: async () => 'oops', json: async () => ({}) })
      expectError(await run(post(chat)), 502, 'provider_failed')
      fetchImpl = async () => {
        const e = new Error('The operation was aborted due to timeout')
        e.name = 'TimeoutError'
        throw e
      }
      expectError(await run(post(chat)), 504, 'provider_timeout')
    } finally {
      console.error = savedErr
    }
  })

  it('control: drumul fericit rămâne 200 fără cod de eroare', async () => {
    const res = await run(post(chat))
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(parseBody(res).code, undefined)
  })
})

describe('AEC4: ai-config', () => {
  const run = (ev) => loadFunction('netlify/functions/ai-config.js').handler(ev)
  const save = { restaurant_id: 'r1', provider: 'openai', model: 'gpt-4o-mini', enabled: true }

  it('validări în română, cu motivul exact la adresa respinsă', async () => {
    expectError(await run({ httpMethod: 'GET', headers: {} }), 405, 'method_not_allowed')
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'kitchen' }, error: null })
    expectError(await run(post(save)), 403, 'forbidden')
    state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
    expectError(await run(post({ ...save, provider: 'openrouterx' })), 400, 'invalid_provider')
    expectError(await run(post({ ...save, model: ' ' })), 400, 'model_missing')
    expectError(await run(post({ ...save, provider: 'custom', base_url: '' })), 400, 'base_url_required')
    const rejected = await run(post({ ...save, provider: 'custom', base_url: 'http://exemplu.test/v1' }))
    expectError(rejected, 400, 'base_url_rejected')
    assert.match(parseBody(rejected).error, /\(base_url trebuie să fie https\)$/)
    expectError(await run(post({ ...save, api_key: 42 })), 400, 'api_key_invalid')
    expectError(await run(post({ ...save, api_key: 'k'.repeat(1001) })), 400, 'api_key_too_long')
  })
})

describe('AEC4: ai-generate-image și ai-credits-checkout', () => {
  it('ai-generate-image: produs fără nume / fără id', async () => {
    const { handler } = loadFunction('netlify/functions/ai-generate-image.js')
    expectError(await handler(post({ restaurant_id: 'r1', product_id: 'p1', name: ' ' })), 400, 'missing_product_name')
    expectError(await handler(post({ restaurant_id: 'r1', name: 'Pizza' })), 400, 'missing_product')
    expectError(await handler(post({ product_id: 'p1', name: 'Pizza' })), 400, 'missing_restaurant')
  })

  it('ai-credits-checkout: pachet necunoscut / fără drepturi', async () => {
    const { handler } = loadFunction('netlify/functions/ai-credits-checkout.js')
    expectError(await handler(post({ restaurant_id: 'r1', pack: 'constructor' })), 400, 'invalid_pack')
    state.fromHandlers['restaurant_memberships'] = () => ({ data: null, error: { message: 'no rows' } })
    expectError(await handler(post({ restaurant_id: 'r1', pack: 'small' })), 403, 'forbidden')
  })

  // Un apel Stripe care aruncă ieșea din handler NEPRINS: platforma răspundea
  // 502 fără corp de contract, iar clientul afișa pe butonul de cumpărare
  // „Asistentul AI nu a putut răspunde" (fallback-ul de status). Mutația care
  // pică: oricare dintre cele două try/catch scoase (handler-ul aruncă).
  it('ai-credits-checkout: Stripe căzut → 502 checkout_failed, nu o excepție neprinsă', async () => {
    const savedErr = console.error
    console.error = () => {}
    try {
      const { handler } = loadFunction('netlify/functions/ai-credits-checkout.js')
      state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
      state.stripeImpls['checkout.sessions.create'] = async () => {
        throw new Error('Invalid API Key provided')
      }
      expectError(await handler(post({ restaurant_id: 'r1', pack: 'small' })), 502, 'checkout_failed')

      // Sesiune fără URL: clientul ar naviga la „undefined".
      state.stripeImpls['checkout.sessions.create'] = async () => ({ id: 'cs_1', url: null })
      expectError(await handler(post({ restaurant_id: 'r1', pack: 'small' })), 502, 'checkout_failed')

      // Customer nou: crearea lui aruncă înaintea sesiunii.
      state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: null, email: 'a@x.test' }, error: null })
      state.stripeImpls['customers.create'] = async () => {
        throw new Error('connection reset')
      }
      const before = state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create').length
      expectError(await handler(post({ restaurant_id: 'r1', pack: 'small' })), 502, 'checkout_failed')
      assert.equal(
        state.stripeCalls.filter((c) => c.name === 'checkout.sessions.create').length,
        before,
        'sesiunea de plată pornită fără customer',
      )

      // Control: drumul fericit rămâne 200 cu URL-ul sesiunii.
      state.fromHandlers['profiles'] = () => ({ data: { stripe_customer_id: 'cus_1', email: 'a@x.test' }, error: null })
      state.stripeImpls['checkout.sessions.create'] = async () => ({ id: 'cs_2', url: 'https://checkout.stripe.com/c/x' })
      const ok = await handler(post({ restaurant_id: 'r1', pack: 'small' }))
      assert.equal(ok.statusCode, 200, ok.body)
      assert.equal(parseBody(ok).url, 'https://checkout.stripe.com/c/x')
    } finally {
      console.error = savedErr
    }
  })
})
