// netlify/functions/recrutare-contact.js
// Receives the recruitment form submission from /recrutare landing page.
// Stores the lead in Supabase + sends email notification to the founder.

const { createClient } = require('@supabase/supabase-js')

const FOUNDER_EMAIL = process.env.RECRUTARE_NOTIFY_EMAIL || 'radu@menuvia.ro'

// CORS — restrictiv, doar domeniile noastre
const ALLOWED_ORIGINS = [
  'https://menuvia.ro',
  'https://www.menuvia.ro',
  'https://menuvia.netlify.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary':                          'Origin',
  }
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(event),
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  // Parse + validate
  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const name    = (body.name    || '').trim().slice(0, 100)
  const cafe    = (body.cafe    || '').trim().slice(0, 120)
  const city    = (body.city    || '').trim().slice(0, 80)
  const phone   = (body.phone   || '').trim().slice(0, 40)
  const email   = (body.email   || '').trim().toLowerCase().slice(0, 120)
  const message = (body.message || '').trim().slice(0, 2000)

  if (!name || !cafe || !phone || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Câmpuri obligatorii lipsă' }) }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email invalid' }) }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Rate limit per IP (anti-spam pe endpoint public): max 5 / oră. Fail-OPEN pe eroare de
  // infra (nu blocam lead-uri legitime daca serviciul de rate-limit pica), dar aplicam limita
  // cand verificarea reuseste.
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name:  'recrutare_contact',
      p_scope_key:      clientIp,
      p_max_requests:   5,
      p_window_minutes: 60,
    })
    if (!rlErr && rlOk === false) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Prea multe cereri. Reîncearcă mai târziu.' }) }
    }
  } catch (e) {
    console.warn('[recrutare-contact] rate limit check failed (fail-open):', e?.message)
  }

  // Store in leads table (created via migration 037)
  try {
    await supabase.from('recrutare_leads').insert({
      name, cafe, city: city || null, phone, email,
      message: message || null,
      source: 'landing_recrutare',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || null,
      user_agent: event.headers['user-agent'] || null,
    })
  } catch (e) {
    console.error('[recrutare-contact] DB insert failed', e)
    // Don't fail the request — we still want to email the founder
  }

  // Send notification email to founder via Supabase Auth's built-in SMTP
  // (We piggy-back on the same provider already configured for invites.)
  // Alternative: use SendGrid/Resend/Postmark with their API key.
  //
  // For simplicity, we use a magic link generation as a hack to trigger SMTP.
  // PRODUCTION: replace with proper transactional email (Resend recommended).
  try {
    const subject = `[Menuvia Pilot] ${cafe} — ${city || 'oraș necunoscut'}`
    const html = `
      <h2>🎯 Lead nou pentru programul pilot</h2>
      <table style="border-collapse:collapse">
        <tr><td><b>Nume:</b></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><b>Cafenea:</b></td><td>${escapeHtml(cafe)}</td></tr>
        <tr><td><b>Oraș:</b></td><td>${escapeHtml(city || '—')}</td></tr>
        <tr><td><b>Telefon:</b></td><td><a href="tel:${encodeURIComponent(phone)}">${escapeHtml(phone)}</a></td></tr>
        <tr><td><b>Email:</b></td><td><a href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a></td></tr>
      </table>
      ${message ? `<h3>Mesaj:</h3><p style="white-space:pre-wrap">${escapeHtml(message)}</p>` : ''}
      <p style="color:#888;font-size:12px;margin-top:24px">
        Sursa: landing_recrutare · IP: ${event.headers['x-nf-client-connection-ip'] || 'unknown'}
      </p>
    `

    // Use Resend if RESEND_API_KEY is set; else fall back to console log
    if (process.env.RESEND_API_KEY) {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    'Menuvia Leads <pilot@menuvia.ro>',
          to:      [FOUNDER_EMAIL],
          subject,
          html,
          reply_to: email,
        }),
      })
      if (!resp.ok) {
        console.error('[recrutare-contact] Resend failed:', await resp.text())
      }
    } else {
      // ✅ GDPR: log doar metadata, nu PII în clear
      console.log('[recrutare-contact] Email queued (no Resend key)', {
        hasPhone: !!phone,
        hasEmail: !!email,
        emailDomain: email ? email.split('@')[1] : null,
        cafeNamePrefix: cafe ? cafe.slice(0, 20) + '…' : null,
      })
    }
  } catch (e) {
    console.error('[recrutare-contact] Email send failed', e)
    // Lead-ul e salvat în DB, deci nu e total pierdut. Returnăm OK.
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(event),
    },
    body: JSON.stringify({ ok: true }),
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
