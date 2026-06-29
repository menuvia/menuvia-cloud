// netlify/functions/ai-proxy.js
// Proxy AI multi-provider pentru chatbot + import meniu, cu cheia BYO a
// restaurantului. Fluxul:
//   1. Verifică JWT-ul Supabase + caller = owner/manager al restaurantului.
//   2. Încarcă config-ul (ai_provider_configs) prin service_role și DECRIPTEAZĂ
//      cheia AES (secret `AI_CONFIG_SECRET`) — cheia rămâne strict pe server.
//   3. Verifică cota hibridă (ai_can_use): tokens incluși rămași + credite.
//   4. Trimite cererea către provider (openai / anthropic / gemini / custom
//      OpenAI-compatible), inclusiv vision pentru import meniu.
//   5. Înregistrează consumul (ai_record_usage) — scade cota la succes.
//
// Forma cererii (provider-neutră) din client:
//   { restaurant_id, feature: 'chat'|'menu_import',
//     system?: string, max_tokens?: number,
//     messages: [{ role:'user'|'assistant',
//                  content: string | Array<
//                    {type:'text', text} |
//                    {type:'image', media_type, data /* base64 */}> }] }

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ── Decriptare cheie (oglindă față de encrypt() din ai-config.js) ──────
function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest()
}
function decrypt(payload, secret) {
  const parts = String(payload).split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad ciphertext format')
  const [, ivB64, tagB64, dataB64] = parts
  const key = deriveKey(secret)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

// Default-uri de model per provider când userul lasă câmpul gol. Evităm
// orice referință hard-codată la modelul intern al platformei.
const DEFAULT_MODEL = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-1.5-flash',
  custom: '',
}

// Estimare grosieră de tokens pentru pre-check-ul de cotă (~4 char/token).
function estimateTokens(messages, maxTokens) {
  let chars = 0
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text') chars += (part.text || '').length
        else if (part.type === 'image') chars += 1200 // cost fix aproximativ / imagine
      }
    }
  }
  return Math.ceil(chars / 4) + (maxTokens || 1024)
}

// ── Adaptoare per provider ────────────────────────────────────────────
// Fiecare întoarce { text, inputTokens, outputTokens }.

async function callAnthropic({ apiKey, model, system, messages, maxTokens }) {
  const toContent = (content) => {
    if (typeof content === 'string') return content
    return content.map((p) =>
      p.type === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: p.media_type, data: p.data } }
        : { type: 'text', text: p.text || '' },
    )
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 1024,
      ...(system ? { system } : {}),
      messages: messages.map((m) => ({ role: m.role, content: toContent(m.content) })),
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || ''
  return {
    text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  }
}

async function callOpenAI({ apiKey, model, system, messages, maxTokens, baseUrl }) {
  const toContent = (content) => {
    if (typeof content === 'string') return content
    return content.map((p) =>
      p.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:${p.media_type};base64,${p.data}` } }
        : { type: 'text', text: p.text || '' },
    )
  }
  const oaMessages = []
  if (system) oaMessages.push({ role: 'system', content: system })
  for (const m of messages) oaMessages.push({ role: m.role, content: toContent(m.content) })

  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens || 1024, messages: oaMessages }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content || ''
  return {
    text: typeof text === 'string' ? text : '',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  }
}

async function callGemini({ apiKey, model, system, messages, maxTokens }) {
  const toParts = (content) => {
    if (typeof content === 'string') return [{ text: content }]
    return content.map((p) =>
      p.type === 'image'
        ? { inline_data: { mime_type: p.media_type, data: p.data } }
        : { text: p.text || '' },
    )
  }
  // Gemini folosește 'model' pentru rolul asistentului.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toParts(m.content),
  }))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { maxOutputTokens: maxTokens || 1024 },
    }),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') || ''
  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_CONFIG_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AI_CONFIG_SECRET) {
    console.error('[ai-proxy] Missing env vars')
    return jsonResponse(500, { error: 'Server config error' })
  }

  // ── Auth ───────────────────────────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return jsonResponse(401, { error: 'Missing Authorization header' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return jsonResponse(401, { error: 'Invalid or expired token' })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const { restaurant_id, feature, system, messages, max_tokens } = body

  if (!restaurant_id) return jsonResponse(400, { error: 'Missing restaurant_id' })
  if (!['chat', 'menu_import'].includes(feature)) {
    return jsonResponse(400, { error: 'Invalid feature' })
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: 'Missing messages' })
  }
  // Plafon anti-abuz pe dimensiunea payload-ului.
  if ((event.body || '').length > 8 * 1024 * 1024) {
    return jsonResponse(400, { error: 'Payload too large (max 8MB)' })
  }
  const maxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 1024, 1), 4096)

  // ── Autorizare: owner/manager al restaurantului ────────────
  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  // ── Încarcă + decriptează config-ul BYO ────────────────────
  const { data: config, error: cfgErr } = await supabase
    .from('ai_provider_configs')
    .select('provider, model, base_url, api_key_encrypted, enabled')
    .eq('restaurant_id', restaurant_id)
    .single()

  if (cfgErr || !config) {
    return jsonResponse(400, { error: 'AI nu este configurat pentru acest restaurant.' })
  }
  if (!config.enabled) {
    return jsonResponse(400, { error: 'AI este dezactivat pentru acest restaurant.' })
  }
  if (!config.api_key_encrypted) {
    return jsonResponse(400, { error: 'Lipsește cheia API. Adaug-o în setări.' })
  }

  let apiKey
  try {
    apiKey = decrypt(config.api_key_encrypted, AI_CONFIG_SECRET)
  } catch (e) {
    console.error('[ai-proxy] decrypt error:', e.message)
    return jsonResponse(500, { error: 'Could not load API key' })
  }

  const provider = config.provider
  const model = (config.model && config.model.trim()) || DEFAULT_MODEL[provider]
  if (!model) {
    return jsonResponse(400, { error: 'Lipsește modelul în configurație.' })
  }

  // ── Pre-check cotă hibridă (anti check-then-act atenuat: re-verificăm
  //     consumul real după apel prin ai_record_usage) ─────────
  const estTokens = estimateTokens(messages, maxTokens)
  const { data: canUse, error: quotaErr } = await supabase.rpc('ai_can_use', {
    p_restaurant_id: restaurant_id,
    p_est_tokens: estTokens,
  })
  if (quotaErr) {
    console.error('[ai-proxy] ai_can_use error:', quotaErr.message)
    return jsonResponse(500, { error: 'Could not verify AI quota' })
  }
  if (canUse === false) {
    return jsonResponse(429, {
      error: 'Ai atins limita de tokens AI inclusă. Cumpără credite suplimentare pentru a continua.',
      code: 'quota_exceeded',
    })
  }

  // ── Apel provider ──────────────────────────────────────────
  let result
  try {
    const argsAI = { apiKey, model, system, messages, maxTokens, baseUrl: config.base_url }
    if (provider === 'anthropic') result = await callAnthropic(argsAI)
    else if (provider === 'gemini') result = await callGemini(argsAI)
    else result = await callOpenAI(argsAI) // openai + custom (OpenAI-compatible)
  } catch (e) {
    console.error('[ai-proxy] provider error:', e.message)
    // Înregistrează eșecul (NU scade cota — success=false), best-effort.
    await supabase.rpc('ai_record_usage', {
      p_restaurant_id: restaurant_id,
      p_feature: feature,
      p_provider: provider,
      p_model: model,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_cost: 0,
      p_success: false,
      p_error: String(e.message).slice(0, 500),
    })
    return jsonResponse(502, { error: 'AI provider request failed' })
  }

  // ── Înregistrează consumul (scade cota la succes) ──────────
  const { data: usage } = await supabase.rpc('ai_record_usage', {
    p_restaurant_id: restaurant_id,
    p_feature: feature,
    p_provider: provider,
    p_model: model,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
    p_cost: 0,
    p_success: true,
    p_error: null,
  })

  return jsonResponse(200, {
    text: result.text,
    provider,
    model,
    usage: {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      ...(usage || {}),
    },
  })
}
