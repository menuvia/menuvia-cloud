// netlify/functions/ai-import.js
// Parses a menu photo or text using Claude Haiku and returns structured product data.
//
// Auth: validates the Supabase JWT from the Authorization header.
// The JWT is signed with SUPABASE_JWT_SECRET (set in Netlify env vars).
// Any authenticated Supabase user can call this — unauthenticated requests are rejected.

const { createClient } = require('@supabase/supabase-js')

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  // ── Auth: verify Supabase JWT ──────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return jsonResponse(401, { error: 'Missing Authorization header' })
  }

  // Env guard — fără config valid, ieșim cu 500 clar (vezi stripe-webhook.js).
  // Fallback la VITE_SUPABASE_URL ca defensive depth (același URL public).
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[ai-import] Missing env vars (SUPABASE_URL/SERVICE_ROLE_KEY)')
    return jsonResponse(500, { error: 'Server config error' })
  }

  // Use Supabase admin client to verify the JWT — getUser() validates signature + expiry
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return jsonResponse(401, { error: 'Invalid or expired token' })
  }
  // ── End auth ───────────────────────────────────────────────

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const { imageBase64, imageType, textContent, restaurant_id } = body

  // ── Plan + quota check ─────────────────────────────────────
  // Uses check_ai_import_quota RPC (SECURITY DEFINER, runs as DB owner)
  const { data: quota, error: quotaErr } = await supabase.rpc('check_ai_import_quota', {
    p_user_id: user.id,
  })

  if (quotaErr) {
    console.error('Quota check error:', quotaErr)
    return jsonResponse(500, { error: 'Could not verify import quota' })
  }

  if (quota && !quota.allowed) {
    return jsonResponse(429, {
      error: `Limită AI imports atinsă: ${quota.used}/${quota.max} pentru planul ${quota.plan}. Upgrade pentru mai multe.`,
    })
  }

  // ── Input size limits ──────────────────────────────────────
  if (imageBase64 && imageBase64.length > 5 * 1024 * 1024) {
    return jsonResponse(400, { error: 'Image too large (max 5MB)' })
  }
  if (textContent && textContent.length > 50000) {
    return jsonResponse(400, { error: 'Text too long (max 50000 chars)' })
  }

  const messages = []
  if (imageBase64) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const mime = imageType || 'image/jpeg'
    if (!validTypes.includes(mime)) {
      return jsonResponse(400, { error: 'Invalid image type. Accepted: jpeg, png, webp, gif' })
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: imageBase64 } },
        { type: 'text', text: 'Extrage toate produsele din acest meniu. Returnează DOAR un JSON array fără markdown, cu obiectele: {"name": string, "description": string|null, "price": number, "emoji": string}. Prețurile în RON (număr fără simbol). Emoji relevant pentru fiecare produs.' },
      ],
    })
  } else if (textContent) {
    messages.push({
      role: 'user',
      content: `Extrage toate produsele din acest meniu text. Returnează DOAR un JSON array fără markdown:\n[{"name": string, "description": string|null, "price": number, "emoji": string}]\n\nMeniu:\n${textContent}`,
    })
  } else {
    return jsonResponse(400, { error: 'Missing imageBase64 or textContent' })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Anthropic error:', err)
    return jsonResponse(500, { error: 'AI request failed' })
  }

  const data = await res.json()
  const text = data.content?.[0]?.text || '[]'

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const products = JSON.parse(clean)

    // ── Log successful import ────────────────────────────────
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    await supabase.rpc('log_ai_import', {
      p_user_id: user.id,
      p_restaurant_id: restaurant_id || null,
      p_tokens_used: tokensUsed,
    })

    return jsonResponse(200, { products })
  } catch {
    return jsonResponse(500, { error: 'Could not parse AI response', raw: text })
  }
}
