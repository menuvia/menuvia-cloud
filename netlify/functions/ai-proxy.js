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
const dns = require('dns').promises

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ── Anti-SSRF: re-validează base_url 'custom' la request (oglindă ai-config) ──
// Rândurile salvate înainte de validarea de la save ar putea conține host-uri
// periculoase → re-validăm AICI înainte de fetch, plus redirect:'manual'.
//
// Lista de blocare (isPrivateIp) acoperă TOATE spațiile ne-rutabile / interne:
//   IPv4: 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8 (loopback),
//         169.254/16 (link-local, INCLUSIV 169.254.169.254 metadata cloud),
//         172.16/12, 192.168/16, 224/4+ (multicast + reserved/broadcast).
//   IPv6: ::, ::1 (loopback), fe80::/10 (link-local), fc00::/7 (ULA, fc+fd,
//         inclusiv metadata fd00:ec2::254), plus IPv4-mapped ::ffff:a.b.c.d.
//
// LIMITĂ REZIDUALĂ (DNS rebinding): fetch-ul nativ (undici bundluit în Node) își
// face PROPRIA rezoluție DNS la conectare — nu putem pina IP-ul validat pe
// conexiune fără dependența `undici` (connect.lookup), care NU e în package.json.
// De aceea re-verificarea o mutăm cât mai aproape de fetch (callOpenAI), reducând
// fereastra la ~zero async gap; un server ostil cu TTL sub-fereastră ar putea încă,
// teoretic, să flipeze IP-ul între lookup-ul nostru și cel al undici. Când `undici`
// devine dependență, treci pe Agent cu connect.lookup fix pentru pinning complet.
function isPrivateIp(ip) {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2])
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1') return true
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7))
  return false
}
async function assertSafeBaseUrl(raw) {
  let u
  try {
    u = new URL(String(raw))
  } catch {
    throw new Error('URL invalid')
  }
  if (u.protocol !== 'https:') throw new Error('base_url trebuie să fie https')
  if (u.port && u.port !== '443') throw new Error('port nepermis')
  // Fără userinfo (user:pass@host) — poate fi folosit la confuzia parserului/host-ului.
  if (u.username || u.password) throw new Error('userinfo nepermis în base_url')
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('host intern interzis')
  }
  let addrs
  try {
    addrs = await dns.lookup(host, { all: true })
  } catch {
    throw new Error('host nerezolvabil')
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('host către rețea internă interzis')
  }
  return u.toString().replace(/\/+$/, '')
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
// Imaginile (vision) costă realist ~1500 tokens de input fiecare — le contabilizăm
// direct în tokens, nu în „chars", ca pre-gate-ul ai_can_use să nu subevalueze.
const IMAGE_INPUT_TOKENS = 1500
function estimateTokens(messages, maxTokens) {
  let chars = 0
  let imageTokens = 0
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text') chars += (part.text || '').length
        else if (part.type === 'image') imageTokens += IMAGE_INPUT_TOKENS
      }
    }
  }
  return Math.ceil(chars / 4) + imageTokens + (maxTokens || 1024)
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
    redirect: 'manual',
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
  if (!res.ok) {
    // Logăm corpul DOAR server-side; nu-l propagăm (poate conține ecou de payload).
    console.error('[ai-proxy] anthropic error', res.status, (await res.text().catch(() => '')).slice(0, 500))
    throw new Error(`anthropic_${res.status}`)
  }
  const data = await res.json()
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || ''
  return {
    text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  }
}

async function callOpenAI({ apiKey, model, system, messages, maxTokens, baseUrl, custom }) {
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

  // Anti-SSRF (TOCTOU minimizat): pentru 'custom' re-rezolvăm DNS-ul base_url-ului
  // AICI, imediat înainte de fetch — nu mai devreme în handler — ca fereastra dintre
  // verificarea IP-ului și conexiune să fie cât mai mică (între validare și fetch
  // NU mai există niciun round-trip de rețea, ex. RPC de cotă).
  let base
  if (custom) {
    // Aruncă dacă hostul (re)rezolvă la IP privat/loopback/link-local/metadata.
    base = await assertSafeBaseUrl(baseUrl)
  } else {
    base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    redirect: 'manual', // anti-SSRF: nu urmări redirect-uri către host-uri nevalidate
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens || 1024, messages: oaMessages }),
  })
  // Anti-SSRF: un 3xx către un IP intern e alt vector TOCTOU (hostul de redirect NU
  // e validat). Cu redirect:'manual', fetch întoarce un răspuns 'opaqueredirect'
  // (status 0); îl respingem explicit pentru calea 'custom' în loc să-l tratăm ca eroare
  // generică de provider, ca redirect-ul să nu fie niciodată urmărit.
  if (custom && (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400))) {
    throw new Error('custom_redirect_blocked')
  }
  if (!res.ok) {
    console.error('[ai-proxy] openai error', res.status, (await res.text().catch(() => '')).slice(0, 500))
    throw new Error(`openai_${res.status}`)
  }
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
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { maxOutputTokens: maxTokens || 1024 },
    }),
  })
  if (!res.ok) {
    console.error('[ai-proxy] gemini error', res.status, (await res.text().catch(() => '')).slice(0, 500))
    throw new Error(`gemini_${res.status}`)
  }
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
  if (AI_CONFIG_SECRET.length < 32) {
    console.error('[ai-proxy] AI_CONFIG_SECRET prea scurt (<32)')
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
  if (!['chat', 'menu_import', 'nutrition', 'translate'].includes(feature)) {
    return jsonResponse(400, { error: 'Invalid feature' })
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: 'Missing messages' })
  }
  // Plafon anti-abuz pe dimensiunea payload-ului.
  if ((event.body || '').length > 8 * 1024 * 1024) {
    return jsonResponse(400, { error: 'Payload too large (max 8MB)' })
  }
  // Plafon 8192, nu 4096 (audit aug 2026): importul multi-poză (4 pagini de
  // meniu) are output JSON de ~6-8k tokens — clamp-ul vechi îl TRUNCA
  // mid-array și clientul vedea fals „nu am găsit produse". Estimatorul de
  // cotă include deja maxTokens, deci costul e contabilizat corect.
  const maxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 1024, 1), 8192)

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

  // ── Încarcă config-ul (sau starea implicită) ───────────────
  const { data: configRow, error: cfgErr } = await supabase
    .from('ai_provider_configs')
    .select('provider, model, base_url, api_key_encrypted, enabled')
    .eq('restaurant_id', restaurant_id)
    .maybeSingle()

  if (cfgErr) {
    console.error('[ai-proxy] config load error:', cfgErr.message)
    return jsonResponse(500, { error: 'Could not load AI config' })
  }
  // Fără rând salvat = starea IMPLICITĂ: asistentul e ACTIV pe cheia
  // platformei, furnizorul default — un cont nou are AI „din prima", fără
  // nicio configurare. Rândul apare doar când ownerul salvează ceva
  // (inclusiv opt-out cu enabled=false, respectat imediat mai jos).
  const config = configRow ?? {
    provider: 'openai',
    model: '',
    base_url: null,
    api_key_encrypted: null,
    enabled: true,
  }
  if (!config.enabled) {
    return jsonResponse(400, { error: 'AI este dezactivat pentru acest restaurant.' })
  }

  const provider = config.provider

  // ── Selecția cheii: BYO sau cheia gestionată de platformă ──
  // Dacă restaurantul și-a salvat propria cheie (BYO), o decriptăm și o
  // folosim. Altfel folosim cheia PLATFORMEI din env (PLATFORM_<PROVIDER>_KEY)
  // — restaurantele non-tehnice nu trebuie să configureze nimic; metering-ul
  // per-restaurant rămâne identic indiferent de sursa cheii.
  let apiKey
  if (config.api_key_encrypted) {
    try {
      apiKey = decrypt(config.api_key_encrypted, AI_CONFIG_SECRET)
    } catch (e) {
      console.error('[ai-proxy] decrypt error:', e.message)
      return jsonResponse(500, { error: 'Could not load API key' })
    }
  } else {
    apiKey = process.env[`PLATFORM_${provider.toUpperCase()}_KEY`]
    if (!apiKey) {
      return jsonResponse(400, { error: 'Asistentul AI nu e configurat pentru acest furnizor.' })
    }
  }

  const model = (config.model && config.model.trim()) || DEFAULT_MODEL[provider]
  if (!model) {
    return jsonResponse(400, { error: 'Lipsește modelul în configurație.' })
  }

  // Anti-SSRF: verificare TIMPURIE (fail-fast) a base_url-ului stocat (custom) —
  // dă un mesaj clar și evită să ardem RPC-ul de cotă pe un endpoint invalid.
  // Verificarea AUTORITATIVĂ contra rebinding-ului se face din nou în callOpenAI,
  // imediat înainte de fetch (fereastră TOCTOU minimă).
  let safeBaseUrl = null
  if (provider === 'custom') {
    try {
      safeBaseUrl = await assertSafeBaseUrl(config.base_url)
    } catch (e) {
      console.error('[ai-proxy] base_url respins la request:', e instanceof Error ? e.message : e)
      return jsonResponse(400, { error: 'Endpoint-ul AI configurat nu este permis. Verifică setările.' })
    }
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
    // Pentru 'custom' trimitem base_url-ul brut din config; callOpenAI îl re-validează
    // (assertSafeBaseUrl) chiar înainte de fetch. `safeBaseUrl` (deja normalizat) e
    // echivalent, dar dăm forma brută ca sursa unică de adevăr să fie re-verificarea.
    const argsAI = {
      apiKey,
      model,
      system,
      messages,
      maxTokens,
      baseUrl: provider === 'custom' ? config.base_url : safeBaseUrl,
      custom: provider === 'custom',
    }
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
  // Apelul real la provider a reușit deja (userul a consumat tokens reali) —
  // NU blocăm răspunsul către user dacă metering-ul eșuează. Facem o singură
  // reîncercare imediată (RPC-ul poate eșua tranzitoriu: timeout de rețea,
  // conexiune scurtă la pool etc.); dacă tot eșuează, logăm explicit toate
  // detaliile necesare reconcilierii manuale a cotei. `p_request_id` e generat
  // O SINGURĂ dată per apel real către provider și refolosit IDENTIC la
  // reîncercare — `ai_record_usage` (mig 185) e idempotentă pe acest id, deci
  // o reîncercare după ce primul apel a comis efectiv nu mai dublează cota.
  const requestId = crypto.randomUUID()
  const usageArgs = {
    p_restaurant_id: restaurant_id,
    p_feature: feature,
    p_provider: provider,
    p_model: model,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
    p_cost: 0,
    p_success: true,
    p_error: null,
    p_request_id: requestId,
  }
  let { data: usage, error: usageErr } = await supabase.rpc('ai_record_usage', usageArgs)
  if (usageErr) {
    console.error('[ai-proxy] ai_record_usage a eșuat, reîncerc o dată:', usageErr.message, { restaurant_id, feature, provider, model, input_tokens: result.inputTokens, output_tokens: result.outputTokens })
    ;({ data: usage, error: usageErr } = await supabase.rpc('ai_record_usage', usageArgs))
  }
  if (usageErr) {
    // Discrepanță reală: tokens consumați real dar cota NU s-a scăzut.
    // Log detaliat pentru reconciliere manuală ulterioară.
    console.error('[ai-proxy] ai_record_usage FAILED după retry (cost suportat, cotă NEscăzută):', usageErr.message, {
      restaurant_id,
      feature,
      provider,
      model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      timestamp: new Date().toISOString(),
    })
  }

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
