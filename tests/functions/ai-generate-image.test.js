// tests/functions/ai-generate-image.test.js
// Generarea de imagini nu mai e un drum fără ieșire în starea IMPLICITĂ.
//
// De ce există: AiSettingsTab promite „nu ai nevoie de nicio configurare
// tehnică — cheia e gestionată de Menuvia", iar ai-proxy chiar așa face (fără
// rând salvat = activ, OpenAI, cheia platformei). ai-generate-image cerea însă
// un rând salvat (`.single()` → „AI nu este configurat") ȘI o cheie proprie
// („Lipsește cheia API"), deci pe ORICE cont nou butonul de imagine pica, iar
// AiBulkGenerate umplea lista de erori cu același mesaj pentru fiecare produs.
// Al doilea strat: chiar cu cheie proprie, modelul trimis era cel de CHAT
// (`gpt-4o-mini`, salvat de fluxul simplu) — respins de endpoint-ul de imagini.
//
//   AIG1  fără rând salvat → cheia platformei, modelul `gpt-image-1`, imaginea
//         ajunge în Storage și pe produs. Mutația care pică: `.single()` fără
//         starea implicită (400 provider_key_missing / „nu este configurat").
//   AIG2  rândul fluxului simplu (openai + `gpt-4o-mini`, fără cheie) → cheia
//         platformei ȘI modelul de imagine, nu cel de chat. Mutația care pică:
//         `config.model` trimis ca atare.
//   AIG3  cheia proprie (BYO) are prioritate; un model de imagine configurat
//         explicit (`dall-e-3`) e respectat ȘI cerut în base64 (DALL·E întoarce
//         implicit un URL, iar funcția citește doar `b64_json`); pe Gemini, un
//         model de text cade pe Imagen.
//   AIG4  Claude / personalizat → 400 provider_no_images, FĂRĂ apel la furnizor
//         și fără cotă consumată (control: refuzul rămâne).
//   AIG5  fără cheie proprie și fără cheia platformei → provider_key_missing,
//         fără apel la furnizor.
//   AIG6  AI dezactivat → ai_disabled; eroare la citirea config-ului → 500
//         config_load_failed (nu „nu e configurat" — o pană nu e o setare).
//   AIG7  metering-ul poartă modelul REAL de imagine.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { state, resetMocks, loadFunction, parseBody, rpcCallsFor } = require('./helpers/mocks')

const REL = 'netlify/functions/ai-generate-image.js'
const SECRET = 's'.repeat(40)
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_CONFIG_SECRET', 'PLATFORM_OPENAI_KEY', 'PLATFORM_GEMINI_KEY']

// Oglinda lui encrypt() din ai-config.js (AES-256-GCM, „v1:iv:tag:data").
function encrypt(plaintext) {
  const key = crypto.createHash('sha256').update(SECRET).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

let saved
let savedFetch
let calls
let productUpdates

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://x.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    AI_CONFIG_SECRET: SECRET,
    PLATFORM_OPENAI_KEY: 'sk-platform',
    PLATFORM_GEMINI_KEY: 'gm-platform',
  })
  savedFetch = global.fetch
  calls = []
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
    const gemini = String(url).includes('generativelanguage')
    return {
      ok: true,
      status: 200,
      json: async () =>
        gemini ? { predictions: [{ bytesBase64Encoded: 'aW1n' }] } : { data: [{ b64_json: 'aW1n' }] },
      text: async () => '',
    }
  }
  state.authUser = { id: 'owner-1' }
  state.fromHandlers['restaurant_memberships'] = () => ({ data: { role: 'owner' }, error: null })
  state.rpcHandlers['ai_can_use'] = () => ({ data: true, error: null })
  state.rpcHandlers['ai_record_usage'] = () => ({ data: {}, error: null })
  productUpdates = []
  state.fromHandlers['products'] = (ops) => {
    const u = ops.find((o) => o.m === 'update')
    if (u) {
      productUpdates.push(u.args[0])
      return { data: null, error: null }
    }
    return { data: { ai_generated_fields: ['description'] }, error: null }
  }
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

function withConfig(row, error) {
  state.fromHandlers['ai_provider_configs'] = () => ({ data: row, error: error || null })
}

const req = () => ({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer jwt' },
  body: JSON.stringify({ restaurant_id: 'r1', product_id: 'p1', name: 'Ciorbă de burtă', category: 'Supe' }),
})

async function run() {
  const { handler } = loadFunction(REL)
  const savedErr = console.error
  console.error = () => {}
  try {
    return await handler(req())
  } finally {
    console.error = savedErr
  }
}

describe('ai-generate-image: starea implicită are imagini', () => {
  it('AIG1: fără rând salvat → cheia platformei + gpt-image-1, imaginea ajunge pe produs', async () => {
    withConfig(null)
    const res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations')
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-platform')
    assert.equal(calls[0].body.model, 'gpt-image-1')
    // gpt-image-1 întoarce mereu base64 și nu acceptă `response_format`.
    assert.ok(!('response_format' in calls[0].body), 'response_format trimis la gpt-image-1')
    assert.equal(state.storageCalls.length, 1)
    assert.equal(state.storageCalls[0].bucket, 'product-images')
    assert.match(state.storageCalls[0].path, /^ai\/r1\/p1-\d+\.png$/)
    const url = parseBody(res).image_url
    assert.match(url, /^https:\/\/storage\.test\/product-images\/ai\/r1\/p1-/)
    assert.equal(productUpdates.length, 1)
    assert.equal(productUpdates[0].image_url, url)
    assert.deepEqual(productUpdates[0].ai_generated_fields, ['description', 'image_url'])
  })

  it('AIG2: fluxul simplu (openai + model de chat, fără cheie) → platforma + modelul de IMAGINE', async () => {
    withConfig({ provider: 'openai', model: 'gpt-4o-mini', api_key_encrypted: null, enabled: true })
    const res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-platform')
    assert.equal(calls[0].body.model, 'gpt-image-1', 'modelul de chat a plecat la endpoint-ul de imagini')
  })

  it('AIG3: cheia proprie are prioritate; modelul de imagine explicit e respectat; Gemini cade pe Imagen', async () => {
    withConfig({ provider: 'openai', model: 'dall-e-3', api_key_encrypted: encrypt('sk-byo'), enabled: true })
    let res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-byo')
    assert.equal(calls[0].body.model, 'dall-e-3')
    // DALL·E întoarce implicit un URL; fără b64_json funcția pica mereu pe
    // „răspuns fără b64_json" (mutația care pică: corpul fără response_format).
    assert.equal(calls[0].body.response_format, 'b64_json')

    calls.length = 0
    withConfig({ provider: 'gemini', model: 'gemini-1.5-flash', api_key_encrypted: null, enabled: true })
    res = await run()
    assert.equal(res.statusCode, 200, res.body)
    assert.match(calls[0].url, /\/models\/imagen-3\.0-generate-002:predict\?key=gm-platform$/)
  })

  for (const provider of ['anthropic', 'custom']) {
    it(`AIG4: ${provider} → provider_no_images, fără furnizor și fără cotă`, async () => {
      withConfig({ provider, model: 'x', api_key_encrypted: encrypt('k'), enabled: true })
      const res = await run()
      assert.equal(res.statusCode, 400)
      assert.equal(parseBody(res).code, 'provider_no_images')
      assert.equal(calls.length, 0)
      assert.equal(rpcCallsFor('ai_can_use').length, 0)
    })
  }

  it('AIG5: fără cheie proprie și fără cheia platformei → provider_key_missing', async () => {
    delete process.env.PLATFORM_OPENAI_KEY
    withConfig(null)
    const res = await run()
    assert.equal(res.statusCode, 400)
    assert.equal(parseBody(res).code, 'provider_key_missing')
    assert.equal(calls.length, 0)
    assert.equal(rpcCallsFor('ai_record_usage').length, 0)
  })

  it('AIG6: dezactivat → ai_disabled; pană la citirea config-ului → 500 config_load_failed', async () => {
    withConfig({ provider: 'openai', model: '', api_key_encrypted: null, enabled: false })
    let res = await run()
    assert.equal(res.statusCode, 400)
    assert.equal(parseBody(res).code, 'ai_disabled')
    withConfig(null, { message: 'connection reset', code: '08006' })
    res = await run()
    assert.equal(res.statusCode, 500)
    assert.equal(parseBody(res).code, 'config_load_failed')
    assert.equal(calls.length, 0)
  })

  it('AIG7: metering-ul poartă modelul real de imagine', async () => {
    withConfig({ provider: 'openai', model: 'gpt-4o-mini', api_key_encrypted: null, enabled: true })
    await run()
    const rec = rpcCallsFor('ai_record_usage')
    assert.equal(rec.length, 1)
    assert.equal(rec[0].args.p_model, 'gpt-image-1')
    assert.equal(rec[0].args.p_success, true)
    assert.equal(rec[0].args.p_feature, 'image_gen')
  })

  it('imageModelFor: doar un model de imagine trece, altfel cel implicit', () => {
    const { imageModelFor } = loadFunction(REL)
    assert.equal(imageModelFor('openai', 'gpt-image-1.5'), 'gpt-image-1.5')
    assert.equal(imageModelFor('openai', ' DALL-E-3 '), 'DALL-E-3')
    assert.equal(imageModelFor('openai', 'gpt-4o'), 'gpt-image-1')
    assert.equal(imageModelFor('openai', ''), 'gpt-image-1')
    assert.equal(imageModelFor('openai', null), 'gpt-image-1')
    assert.equal(imageModelFor('gemini', 'imagen-4.0-generate-001'), 'imagen-4.0-generate-001')
    assert.equal(imageModelFor('gemini', 'gemini-1.5-pro'), 'imagen-3.0-generate-002')
  })
})
