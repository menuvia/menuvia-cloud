// netlify/functions/ai-config.js
// Salvează configurația BYO (Bring Your Own) API per restaurant:
// provider + model + base_url + cheia API CRIPTATĂ.
//
// Cheia API NU părăsește niciodată serverul în clar:
//   • clientul o trimite o singură dată (HTTPS) la salvare;
//   • aici o criptăm AES-256-GCM cu secretul `AI_CONFIG_SECRET` (env Netlify);
//   • DB-ul stochează DOAR ciphertext (coloana api_key_encrypted, ne-citibilă
//     de client — revoke column-level în mig 168);
//   • răspunsul către client întoarce DOAR o mască ("sk-…abcd"), niciodată cheia.
//
// Auth: JWT Supabase + caller trebuie să fie owner/manager al restaurantului.
// Scrierile merg prin service_role (clientul nu poate scrie tabelul direct).

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

// ── Anti-SSRF: validează un base_url 'custom' controlat de tenant ──────
// Blochează loopback / link-local / metadata cloud / rețele private, atât pe
// IP-literal cât și pe rezultatul DNS (anti-rebind parțial). Folosit la salvare
// (aici) ȘI la request (ai-proxy) — rândurile vechi nu trec prin validarea de save.
function isPrivateIp(ip) {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2])
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true          // link-local + metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true          // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    if (a >= 224) return true                         // multicast/reserved
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1') return true
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7)) // IPv4-mapped
  return false
}

// Întoarce base_url normalizat (fără slash final) sau aruncă Error cu mesaj clar.
async function assertSafeBaseUrl(raw) {
  let u
  try {
    u = new URL(String(raw))
  } catch {
    throw new Error('URL invalid')
  }
  if (u.protocol !== 'https:') throw new Error('base_url trebuie să fie https')
  if (u.port && u.port !== '443') throw new Error('port nepermis (doar 443)')
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
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

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'custom']

// Derivă o cheie simetrică de 32 bytes din secretul din env (stabil, fără salt
// per-rând: simplitate operațională; secretul rotește prin re-salvarea cheilor).
function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest()
}

// AES-256-GCM → "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
function encrypt(plaintext, secret) {
  const key = deriveKey(secret)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

// Mască pentru afișaj: ultimele 4 caractere, restul mascat.
function maskKey(plaintext) {
  const s = String(plaintext)
  if (s.length <= 4) return '••••'
  return `••••${s.slice(-4)}`
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_CONFIG_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AI_CONFIG_SECRET) {
    console.error('[ai-config] Missing env vars')
    return jsonResponse(500, { error: 'Server config error' })
  }
  // Secretul de criptare trebuie să aibă entropie suficientă (>=32 caractere).
  if (AI_CONFIG_SECRET.length < 32) {
    console.error('[ai-config] AI_CONFIG_SECRET prea scurt (<32)')
    return jsonResponse(500, { error: 'Server config error' })
  }

  // ── Auth: verifică JWT-ul Supabase ─────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse(401, { error: 'Missing Authorization header' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse(401, { error: 'Invalid or expired token' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const { restaurant_id, provider, model, base_url, api_key, enabled } = body

  if (!restaurant_id) {
    return jsonResponse(400, { error: 'Missing restaurant_id' })
  }

  // ── Autorizare: caller = owner/manager al restaurantului ───
  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  // ── Validare input ─────────────────────────────────────────
  if (!PROVIDERS.includes(provider)) {
    return jsonResponse(400, { error: `Invalid provider. Accepted: ${PROVIDERS.join(', ')}` })
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    return jsonResponse(400, { error: 'Missing model' })
  }
  // base_url obligatoriu doar pentru 'custom' (OpenAI-compatible)
  let cleanBaseUrl = null
  if (provider === 'custom') {
    if (typeof base_url !== 'string' || base_url.trim().length === 0) {
      return jsonResponse(400, { error: 'custom provider requires an https base_url' })
    }
    try {
      cleanBaseUrl = await assertSafeBaseUrl(base_url.trim())
    } catch (e) {
      return jsonResponse(400, { error: `base_url respins: ${e instanceof Error ? e.message : 'invalid'}` })
    }
  }
  if (api_key != null && typeof api_key !== 'string') {
    return jsonResponse(400, { error: 'api_key must be a string' })
  }
  if (api_key && api_key.length > 1000) {
    return jsonResponse(400, { error: 'api_key too long' })
  }

  // ── Construiește payload-ul de upsert ──────────────────────
  // Cheia se actualizează DOAR dacă a fost trimisă o cheie nouă ne-goală.
  // Astfel userul poate schimba modelul/enabled fără să retrimită cheia.
  const payload = {
    restaurant_id,
    provider,
    model: model.trim().slice(0, 200),
    base_url: cleanBaseUrl,
    enabled: enabled === true,
    updated_at: new Date().toISOString(),
  }

  let keyMasked = null
  if (api_key && api_key.trim().length > 0) {
    payload.api_key_encrypted = encrypt(api_key.trim(), AI_CONFIG_SECRET)
    keyMasked = maskKey(api_key.trim())
  } else if (provider === 'custom') {
    // Fără cheie nouă: dacă nu există deja una salvată, nu putem activa.
    // Se aplică DOAR pentru 'custom' — acolo nu există fallback de platformă
    // (vezi ai-proxy.js), deci restaurantul chiar are nevoie de cheia proprie.
    // Pentru openai/anthropic/gemini, ai-proxy.js cade automat pe cheia
    // platformei (PLATFORM_<PROVIDER>_KEY) când nu există BYO — fluxul de bază
    // („Activează asistentul AI", fără „Avansat") trebuie permis fără cheie.
    const { data: existing } = await supabase
      .from('ai_provider_configs')
      .select('api_key_encrypted')
      .eq('restaurant_id', restaurant_id)
      .single()
    if (payload.enabled && !existing?.api_key_encrypted) {
      return jsonResponse(400, { error: 'Trebuie să adaugi o cheie API înainte de a activa.' })
    }
  }

  const { error: upsertErr } = await supabase
    .from('ai_provider_configs')
    .upsert(payload, { onConflict: 'restaurant_id' })

  if (upsertErr) {
    console.error('[ai-config] upsert error:', upsertErr.message)
    return jsonResponse(500, { error: 'Could not save AI config' })
  }

  return jsonResponse(200, {
    ok: true,
    config: {
      restaurant_id,
      provider: payload.provider,
      model: payload.model,
      base_url: payload.base_url,
      enabled: payload.enabled,
      key_masked: keyMasked, // null dacă nu s-a schimbat cheia
    },
  })
}
