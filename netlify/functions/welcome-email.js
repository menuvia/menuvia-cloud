// netlify/functions/welcome-email.js
// Sends a welcome email after signup.
//
// SECURITY: Validates WEBHOOK_SECRET to prevent abuse as an email relay.
// Set WEBHOOK_SECRET in both Netlify env vars AND Supabase webhook config.
// If not set, ALL requests are rejected.

// Limba (lotul L8a): `lang` din body e OPȚIONAL — limba funnel-ului în care
// s-a făcut înscrierea; se acceptă doar pe FUNNEL_LANGS (ro/en/fr/de), orice
// altceva → română, deci un apelant vechi primește exact emailul de dinainte.
// Apelantul (webhook-ul Supabase) nu e în repo — vezi docs/AUTH_EMAIL_TEMPLATES.md.

const crypto = require('crypto')
const { appLink, FROM_HELLO, LEGACY_NETLIFY_URL } = require('./lib/appUrl')
const { funnelEmailLang } = require('./lib/emailLang')
const { kindStrings, fill } = require('./lib/emailStrings')

// Link-ul „Mergi la dashboard": cheia + fallback-ul de dinainte, EXACT
// (VITE_APP_URL → menuvia.netlify.app). NU urmează site-ul (.ro/.com): funcția
// e chemată de webhook-ul Supabase la signup (secret WEBHOOK_SECRET), fără
// niciun context de site — iar a accepta o origine din body ar face din ea un
// relay. Un utilizator .com primește linkul domeniului implicit (rezidual
// consemnat; se rezolvă când profilul va purta site-ul de înregistrare).
const DASHBOARD_LINK_OPTS = { keys: ['VITE_APP_URL'], fallback: LEGACY_NETLIFY_URL }

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

/**
 * Subiectul + HTML-ul emailului de bun venit în limba `lang`. `name` vine BRUT
 * (trim-uit) și se escapează aici; în română ieșirea e byte-identică (WE1).
 */
function renderWelcomeEmail(lang, { name, dashboardUrl }) {
  const s = kindStrings('signup_welcome', lang)
  const safeName = esc(name)
  return {
    subject: s.subject,
    html: `
        <div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0F0F0F;border-radius:16px;padding:40px;color:#F0EAE0;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#C8963C;margin-bottom:24px;">Menuvia</div>
          <h2 style="font-family:Georgia,serif;font-size:20px;color:#F0EAE0;margin-bottom:12px;">${safeName ? fill(s.hello, { name: safeName }) : s.hello_anon}</h2>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:16px;">${s.created}</p>
          <p style="color:#9A9590;line-height:1.6;margin-bottom:24px;">${s.pitch}</p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#C8963C;color:#000;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px;">${s.cta}</a>
          <p style="color:#4A4844;font-size:12px;">${s.questions}</p>
        </div>
      `,
  }
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
  const name  = (body.name || '').trim()
  const lang  = funnelEmailLang(body.lang)
  if (!email) return { statusCode: 400, body: 'Missing email' }
  // Validare format email (paritate cu send-invite) — evită relay cu adrese malformate.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email' }) }
  }

  const rendered = renderWelcomeEmail(lang, { name, dashboardUrl: appLink('/dashboard', DASHBOARD_LINK_OPTS) })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    // OPT-3: timeout explicit — un TCP agățat nu mai blochează funcția.
    signal: AbortSignal.timeout(8000),
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    FROM_HELLO,
      to:      [email],
      subject: rendered.subject,
      html:    rendered.html,
    }),
  })

  return { statusCode: res.ok ? 200 : 500, body: res.ok ? 'OK' : 'Email failed' }
}

// Pentru testele din tests/functions (WE1–WE3, EL1/EL2).
exports.renderWelcomeEmail = renderWelcomeEmail
