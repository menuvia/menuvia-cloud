// netlify/functions/ai-generate-image.js
// Generează o imagine de produs cu AI (DOAR OpenAI gpt-image-1 sau Gemini
// Imagen — Anthropic nu generează imagini), o încarcă în Storage
// (`product-images`) și o setează pe produs, marcând `image_url` ca generat
// de AI (ai_generated_fields). Metering pe cota hibridă.
//
// Auth: JWT Supabase + caller = owner/manager al restaurantului.

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

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

async function generateOpenAI(apiKey, model, prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
  })
  if (!res.ok) throw new Error(`openai image ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('openai image: răspuns fără b64_json')
  return b64
}

async function generateGemini(apiKey, model, prompt) {
  const m = model || 'imagen-3.0-generate-002'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:predict?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_CONFIG_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AI_CONFIG_SECRET) {
    return jsonResponse(500, { error: 'Server config error' })
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return jsonResponse(401, { error: 'Missing Authorization header' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return jsonResponse(401, { error: 'Invalid or expired token' })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }
  const { restaurant_id, product_id, name, description, category } = body
  if (!restaurant_id || !product_id) return jsonResponse(400, { error: 'Missing restaurant_id or product_id' })
  if (typeof name !== 'string' || name.trim().length === 0) return jsonResponse(400, { error: 'Missing product name' })

  // Autorizare owner/manager
  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  // Config + provider care suportă imagini
  const { data: config, error: cfgErr } = await supabase
    .from('ai_provider_configs')
    .select('provider, model, api_key_encrypted, enabled')
    .eq('restaurant_id', restaurant_id)
    .single()
  if (cfgErr || !config) return jsonResponse(400, { error: 'AI nu este configurat pentru acest restaurant.' })
  if (!config.enabled) return jsonResponse(400, { error: 'AI este dezactivat pentru acest restaurant.' })
  if (!['openai', 'gemini'].includes(config.provider)) {
    return jsonResponse(400, {
      error: 'Generarea de imagini necesită OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.',
      code: 'provider_no_images',
    })
  }
  if (!config.api_key_encrypted) return jsonResponse(400, { error: 'Lipsește cheia API.' })

  let apiKey
  try {
    apiKey = decrypt(config.api_key_encrypted, AI_CONFIG_SECRET)
  } catch (e) {
    console.error('[ai-generate-image] decrypt error:', e.message)
    return jsonResponse(500, { error: 'Could not load API key' })
  }

  // Pre-check cotă
  const { data: canUse, error: quotaErr } = await supabase.rpc('ai_can_use', {
    p_restaurant_id: restaurant_id,
    p_est_tokens: IMAGE_TOKEN_COST,
  })
  if (quotaErr) {
    console.error('[ai-generate-image] ai_can_use error:', quotaErr.message)
    return jsonResponse(500, { error: 'Could not verify AI quota' })
  }
  if (canUse === false) {
    return jsonResponse(429, { error: 'Ai atins limita AI. Cumpără credite pentru a continua.', code: 'quota_exceeded' })
  }

  // Prompt appetisant, fundal neutru, fără text suprapus.
  const desc = typeof description === 'string' && description.trim() ? `. ${description.trim()}` : ''
  const cat = typeof category === 'string' && category.trim() ? ` (${category.trim()})` : ''
  const prompt = `Fotografie profesională, apetisantă, de meniu pentru „${name.trim()}"${cat}${desc}. Iluminare naturală de studio, fundal neutru curat, prim-plan al produsului, fără text, fără watermark, fără mâini, calitate înaltă.`

  // Apel provider
  let b64
  try {
    b64 = config.provider === 'gemini'
      ? await generateGemini(apiKey, config.model, prompt)
      : await generateOpenAI(apiKey, config.model, prompt)
  } catch (e) {
    console.error('[ai-generate-image] provider error:', e.message)
    await supabase.rpc('ai_record_usage', {
      p_restaurant_id: restaurant_id, p_feature: 'image_gen', p_provider: config.provider,
      p_model: config.model || '', p_input_tokens: 0, p_output_tokens: 0, p_cost: 0,
      p_success: false, p_error: String(e.message).slice(0, 500),
    })
    return jsonResponse(502, { error: 'Generarea imaginii a eșuat la provider.' })
  }

  // Încarcă în Storage
  const buffer = Buffer.from(b64, 'base64')
  const path = `ai/${restaurant_id}/${product_id}-${Date.now()}.png`
  const { error: upErr } = await supabase.storage
    .from('product-images')
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (upErr) {
    console.error('[ai-generate-image] upload error:', upErr.message)
    return jsonResponse(500, { error: 'Nu am putut salva imaginea generată.' })
  }
  const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path)
  const imageUrl = pub?.publicUrl
  if (!imageUrl) return jsonResponse(500, { error: 'Nu am putut obține URL-ul imaginii.' })

  // Setează imaginea pe produs + marchează image_url ca generat de AI (tenant-safe)
  const { data: prod, error: prodErr } = await supabase
    .from('products')
    .select('ai_generated_fields')
    .eq('id', product_id)
    .eq('restaurant_id', restaurant_id)
    .single()
  if (prodErr || !prod) return jsonResponse(404, { error: 'Produsul nu a fost găsit.' })

  const fields = Array.isArray(prod.ai_generated_fields) ? prod.ai_generated_fields : []
  const newFields = Array.from(new Set([...fields, 'image_url']))
  const { error: updErr } = await supabase
    .from('products')
    .update({ image_url: imageUrl, ai_generated_fields: newFields })
    .eq('id', product_id)
    .eq('restaurant_id', restaurant_id)
  if (updErr) {
    console.error('[ai-generate-image] product update error:', updErr.message)
    return jsonResponse(500, { error: 'Nu am putut actualiza produsul.' })
  }

  // Metering (scade cota)
  await supabase.rpc('ai_record_usage', {
    p_restaurant_id: restaurant_id, p_feature: 'image_gen', p_provider: config.provider,
    p_model: config.model || '', p_input_tokens: 0, p_output_tokens: IMAGE_TOKEN_COST,
    p_cost: IMAGE_COST_USD, p_success: true, p_error: null,
  })

  return jsonResponse(200, { image_url: imageUrl })
}
