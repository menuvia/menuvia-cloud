// netlify/functions/ai-generate-image.js
// Generează o imagine de produs cu AI (DOAR OpenAI gpt-image-1 sau Gemini
// Imagen — Anthropic nu generează imagini), o încarcă în Storage
// (`product-images`) și o setează pe produs, marcând `image_url` ca generat
// de AI (ai_generated_fields). Metering pe cota hibridă.
//
// Configurația se citește EXACT ca în ai-proxy.js (oglindă): fără rând salvat =
// starea implicită (activ, OpenAI, cheia PLATFORMEI), iar fără cheie proprie
// (BYO) se folosește PLATFORM_<PROVIDER>_KEY. Până acum funcția cerea un rând
// salvat ȘI o cheie proprie, deci în starea implicită a ORICĂRUI cont nou —
// cea pe care AiSettingsTab o promite „fără nicio configurare tehnică" —
// generarea de imagini era un drum fără ieșire („AI nu este configurat",
// apoi „Lipsește cheia API"), în timp ce chatul și importul mergeau.
//
// Auth: JWT Supabase + caller = owner/manager al restaurantului.

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
// Contractul de eroare: orice non-200 = { error: <română>, code } (lib/aiErrors.js).
const { aiError, isTimeoutError } = require('./lib/aiErrors')

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest()
}
function decrypt(payload, secret) {
  const parts = String(payload).split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad ciphertext format')
  const [, ivB64, tagB64, dataB64] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

// Cost echivalent în tokens pentru o imagine (cota e token-based). O imagine ~
// scade cât ~2000 tokens; cost estimativ ~0.04 USD.
const IMAGE_TOKEN_COST = 2000
const IMAGE_COST_USD = 0.04

// Plafon pe apelurile către provideri (audit aug 2026, paritate cu ai-proxy):
// generarea de imagini e cel mai lent apel din platformă — 60s e generos dar
// finit; pe VPS (fără kill de platformă) un provider agățat ar atârna altfel
// nelimitat.
const PROVIDER_TIMEOUT_MS = 60_000

// Modelul de IMAGINE e altul decât cel de TEXT. `ai_provider_configs.model` e
// modelul de chat (fluxul simplu din AiSettingsTab salvează `gpt-4o-mini` /
// `gemini-1.5-flash`), iar trimis la endpoint-ul de imagini e respins de
// furnizor — chiar și cu cheie proprie, generarea pica mereu. Folosim modelul
// configurat DOAR dacă e chiar un model de imagine; altfel cel implicit.
const IMAGE_MODEL = { openai: 'gpt-image-1', gemini: 'imagen-3.0-generate-002' }
const IMAGE_MODEL_PATTERN = { openai: /^(gpt-image|dall-e)/i, gemini: /^imagen/i }

function imageModelFor(provider, configuredModel) {
  const m = typeof configuredModel === 'string' ? configuredModel.trim() : ''
  if (m && IMAGE_MODEL_PATTERN[provider] && IMAGE_MODEL_PATTERN[provider].test(m)) return m
  return IMAGE_MODEL[provider]
}

async function generateOpenAI(apiKey, model, prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: '1024x1024', n: 1 }),
  })
  if (!res.ok) throw new Error(`openai image ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('openai image: răspuns fără b64_json')
  return b64
}

async function generateGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
  })
  if (!res.ok) throw new Error(`gemini image ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('gemini image: răspuns fără bytesBase64Encoded')
  return b64
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return aiError(405, 'method_not_allowed')

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_CONFIG_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AI_CONFIG_SECRET) {
    return aiError(500, 'server_config')
  }
  if (AI_CONFIG_SECRET.length < 32) {
    console.error('[ai-generate-image] AI_CONFIG_SECRET prea scurt (<32)')
    return aiError(500, 'server_config')
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return aiError(401, 'auth_missing')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return aiError(401, 'auth_invalid')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return aiError(400, 'bad_json')
  }
  const { restaurant_id, product_id, name, description, category } = body
  if (!restaurant_id) return aiError(400, 'missing_restaurant')
  if (!product_id) return aiError(400, 'missing_product')
  if (typeof name !== 'string' || name.trim().length === 0) return aiError(400, 'missing_product_name')

  // Autorizare owner/manager
  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return aiError(403, 'forbidden')
  }

  // Config + provider care suportă imagini. `maybeSingle`, nu `single`: lipsa
  // rândului e starea IMPLICITĂ, nu o eroare (oglindă ai-proxy.js).
  const { data: configRow, error: cfgErr } = await supabase
    .from('ai_provider_configs')
    .select('provider, model, api_key_encrypted, enabled')
    .eq('restaurant_id', restaurant_id)
    .maybeSingle()
  if (cfgErr) {
    console.error('[ai-generate-image] config load error:', cfgErr.message)
    return aiError(500, 'config_load_failed')
  }
  const config = configRow ?? {
    provider: 'openai',
    model: '',
    api_key_encrypted: null,
    enabled: true,
  }
  if (!config.enabled) return aiError(400, 'ai_disabled')
  if (!['openai', 'gemini'].includes(config.provider)) {
    return aiError(400, 'provider_no_images')
  }

  // Cheia: proprie (BYO) dacă e salvată, altfel a PLATFORMEI — exact ca
  // ai-proxy. Metering-ul pe cota restaurantului e identic în ambele cazuri.
  let apiKey
  if (config.api_key_encrypted) {
    try {
      apiKey = decrypt(config.api_key_encrypted, AI_CONFIG_SECRET)
    } catch (e) {
      console.error('[ai-generate-image] decrypt error:', e.message)
      return aiError(500, 'key_load_failed')
    }
  } else {
    apiKey = process.env[`PLATFORM_${config.provider.toUpperCase()}_KEY`]
    if (!apiKey) return aiError(400, 'provider_key_missing')
  }
  const imageModel = imageModelFor(config.provider, config.model)

  // Pre-check cotă
  const { data: canUse, error: quotaErr } = await supabase.rpc('ai_can_use', {
    p_restaurant_id: restaurant_id,
    p_est_tokens: IMAGE_TOKEN_COST,
  })
  if (quotaErr) {
    console.error('[ai-generate-image] ai_can_use error:', quotaErr.message)
    return aiError(500, 'quota_check_failed')
  }
  if (canUse === false) {
    return aiError(429, 'quota_exceeded')
  }

  // Prompt appetisant, fundal neutru, fără text suprapus.
  const desc = typeof description === 'string' && description.trim() ? `. ${description.trim()}` : ''
  const cat = typeof category === 'string' && category.trim() ? ` (${category.trim()})` : ''
  const prompt = `Fotografie profesională, apetisantă, de meniu pentru „${name.trim()}"${cat}${desc}. Iluminare naturală de studio, fundal neutru curat, prim-plan al produsului, fără text, fără watermark, fără mâini, calitate înaltă.`

  // Apel provider
  let b64
  try {
    b64 = config.provider === 'gemini'
      ? await generateGemini(apiKey, imageModel, prompt)
      : await generateOpenAI(apiKey, imageModel, prompt)
  } catch (e) {
    console.error('[ai-generate-image] provider error:', e.message)
    await supabase.rpc('ai_record_usage', {
      p_restaurant_id: restaurant_id, p_feature: 'image_gen', p_provider: config.provider,
      p_model: imageModel, p_input_tokens: 0, p_output_tokens: 0, p_cost: 0,
      p_success: false, p_error: String(e.message).slice(0, 500),
    })
    return isTimeoutError(e) ? aiError(504, 'provider_timeout') : aiError(502, 'image_failed')
  }

  // Provider a REUȘIT → costul e deja incurat pe cheia restaurantului. Înregistrăm
  // metering-ul ACUM, înainte de upload/DB: altfel un eșec persistent post-generare
  // (ex. policy Storage stricată) lăsa userul să reîncerce la nesfârșit, fiecare
  // retry costând bani reali fără să scadă cota (429-ul nu se declanșa niciodată).
  {
    const { error: usageErr } = await supabase.rpc('ai_record_usage', {
      p_restaurant_id: restaurant_id, p_feature: 'image_gen', p_provider: config.provider,
      p_model: imageModel, p_input_tokens: 0, p_output_tokens: IMAGE_TOKEN_COST,
      p_cost: IMAGE_COST_USD, p_success: true, p_error: null,
    })
    if (usageErr) {
      console.error('[ai-generate-image] ai_record_usage FAILED (imagine generată, cotă NEscăzută):', usageErr.message, { restaurant_id })
    }
  }

  // Încarcă în Storage
  const buffer = Buffer.from(b64, 'base64')
  const path = `ai/${restaurant_id}/${product_id}-${Date.now()}.png`
  const { error: upErr } = await supabase.storage
    .from('product-images')
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (upErr) {
    console.error('[ai-generate-image] upload error:', upErr.message)
    return aiError(500, 'image_save_failed')
  }
  const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path)
  const imageUrl = pub?.publicUrl
  if (!imageUrl) return aiError(500, 'image_save_failed')

  // Setează imaginea pe produs + marchează image_url ca generat de AI (tenant-safe)
  const { data: prod, error: prodErr } = await supabase
    .from('products')
    .select('ai_generated_fields')
    .eq('id', product_id)
    .eq('restaurant_id', restaurant_id)
    .single()
  if (prodErr || !prod) return aiError(404, 'product_not_found')

  const fields = Array.isArray(prod.ai_generated_fields) ? prod.ai_generated_fields : []
  const newFields = Array.from(new Set([...fields, 'image_url']))
  const { error: updErr } = await supabase
    .from('products')
    .update({ image_url: imageUrl, ai_generated_fields: newFields })
    .eq('id', product_id)
    .eq('restaurant_id', restaurant_id)
  if (updErr) {
    console.error('[ai-generate-image] product update error:', updErr.message)
    return aiError(500, 'product_update_failed')
  }

  return jsonResponse(200, { image_url: imageUrl })
}

// Pentru tests/functions/ai-generate-image.test.js.
exports.imageModelFor = imageModelFor
