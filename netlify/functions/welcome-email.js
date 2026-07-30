// netlify/functions/welcome-email.js
// Sends a welcome email after signup.
//
// SECURITY: Validates WEBHOOK_SECRET to prevent abuse as an email relay.
// Set WEBHOOK_SECRET in both Netlify env vars AND Supabase webhook config.
// If not set, ALL requests are rejected.

const crypto = require('crypto')

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// Comparare constant-time a secretului (anti timing attack), cu verificare de lungime.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  // Require both RESEND_API_KEY and WEBHOOK_SECRET
  if (!process.env.RESEND_API_KEY || !process.env.WEBHOOK_SECRET) {
    console.error('[welcome-email] Missing RESEND_API_KEY or WEBHOOK_SECRET')
    return { statusCode: 500, body: JSON.stringify({ error: 'Server config error' }) }
  }

  // Validate webhook secret — prevents anonymous abuse
  const secret = (event.headers['x-webhook-secret'] || event.headers['authorization'] || '').replace('Bearer ', '')
  if (!safeEqual(secret, process.env.WEBHOOK_SECRET)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'Invalid JSON' } }

  const email = (body.email || '').toLowerCase().trim()
  const name  = esc((body.name || '').trim())
  if (!email) return { statusCode: 400, body: 'Missing email' }
  // Validare format email (paritate cu send-invite) — evită relay cu adrese malformate.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email' }) }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    // OPT-3: timeout explicit — un TCP agățat nu mai blochează funcția.
    signal: AbortSignal.timeout(8000),
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Menuvia <hello@menuvia.ro>',
      to:      [email],
      subject: 'Bun venit la Menuvia',
      html: `
        <div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0F0F0F;border-radius:16px;padding:40px;color:#F0EAE0;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#C8963C;margin-bottom:24px;">Menuvia</div>
          <h2 style="font-family:Georgia,serif;font-size:20px;color:#F0EAE0;margin-bottom:12px;">Bun venit${name ? `, ${name}` : ''}!</h2>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:16px;">Contul tău Menuvia a fost creat cu succes.</p>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:24px;">Acum poți să-ți digitalizezi meniul, să primești comenzi de pe telefoanele clienților și să urmărești tot ce se întâmplă în restaurant în timp real.</p>
          <a href="${process.env.VITE_APP_URL || 'https://menuvia.netlify.app'}/dashboard" style="display:inline-block;background:#C8963C;color:#000;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px;">Mergi la dashboard</a>
          <p style="color:#4A4844;font-size:12px;">Ai întrebări? Răspunde la acest email.</p>
        </div>
      `,
    }),
  })

  return { statusCode: res.ok ? 200 : 500, body: res.ok ? 'OK' : 'Email failed' }
}
