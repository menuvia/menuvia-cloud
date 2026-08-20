// netlify/functions/codvia-order.js
// Primește comenzile de suporturi QR fizice de pe /codvia (brandul-frate Codvia).
// v1 FĂRĂ plată online: lead-ul se salvează în `recrutare_leads` (source
// 'codvia_order' — coloana nu are CHECK, mig 037) + email către fondator, care
// confirmă telefonic și livrează cu plata ramburs/transfer. Tabelă dedicată +
// Stripe vin în v2, când volumul o justifică (vezi docs/CODVIA.md).
// Pattern identic cu recrutare-contact.js (CORS restrictiv, rate-limit, Resend).

const { createClient } = require('@supabase/supabase-js')

const FOUNDER_EMAIL = process.env.RECRUTARE_NOTIFY_EMAIL || 'radu@menuvia.ro'

// CORS — restrictiv, doar domeniile noastre (codvia.ro se adaugă la cumpărare).
const ALLOWED_ORIGINS = [
  'https://menuvia.ro',
  'https://www.menuvia.ro',
  'https://menuvia.netlify.app',
  'https://codvia.ro',
  'https://www.codvia.ro',
  'http://localhost:5173',
  'http://localhost:4173',
]

// Catalogul e sursa de adevăr AICI (server), ca la ai-credits-checkout: clientul
// trimite doar cheia produsului, prețul afișat în email vine de pe server.
const PRODUCTS = {
  stand_pvc: { label: 'Stand PVC cu sticker QR', price: 29 },
  stand_plexi: { label: 'Stand plexiglas premium', price: 79 },
  placa_lemn: { label: 'Placă lemn gravat', price: 129 },
  nfc_combo: { label: 'NFC + QR combo', price: 179 },
}

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event) }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const jsonHeaders = { ...corsHeaders(event), 'Content-Type': 'application/json' }

  // hasOwnProperty: `PRODUCTS[product]` cu 'constructor' ar întoarce o funcție
  // moștenită → ar trece de verificare (aceeași capcană ca la ai-credits-checkout).
  const productKey = String(body.product || '')
  const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productKey)
    ? PRODUCTS[productKey]
    : null
  if (!product) {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'Produs invalid' }) }
  }

  const qty = Math.min(Math.max(parseInt(body.quantity, 10) || 0, 1), 500)
  const name = (body.name || '').trim().slice(0, 100)
  const business = (body.business || '').trim().slice(0, 120)
  const phone = (body.phone || '').trim().slice(0, 40)
  const email = (body.email || '').trim().toLowerCase().slice(0, 120)
  const address = (body.address || '').trim().slice(0, 300)
  const menuSlug = (body.menu_slug || '').trim().slice(0, 120)
  const message = (body.message || '').trim().slice(0, 2000)

  if (!name || !phone || !email || !address) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Câmpuri obligatorii lipsă' }),
    }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'Email invalid' }) }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Rate limit per IP: max 5 comenzi/oră. Fail-open pe eroare de infra (nu
  // pierdem comenzi legitime dacă RPC-ul e jos), limita se aplică când merge.
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name: 'codvia_order',
      p_scope_key: clientIp,
      p_max_requests: 5,
      p_window_minutes: 60,
    })
    if (!rlErr && rlOk === false) {
      return {
        statusCode: 429,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Prea multe cereri. Reîncearcă mai târziu.' }),
      }
    }
    if (rlErr) console.warn('[codvia-order] rate limit RPC failed (fail-open):', rlErr?.message)
  } catch (e) {
    console.warn('[codvia-order] rate limit check failed (fail-open):', e?.message)
  }

  const orderSummary =
    `COMANDĂ CODVIA\n` +
    `Produs: ${product.label} × ${qty} buc (~${product.price * qty} lei)\n` +
    `Adresă livrare: ${address}\n` +
    (menuSlug ? `Meniu Menuvia pentru QR pre-tipărit: /m/${menuSlug}\n` : 'Fără meniu Menuvia (QR generic sau furnizat de client)\n') +
    (message ? `Mesaj: ${message}` : '')

  // Lead-ul intră în tabela existentă (mig 037) cu source dedicat — founderul
  // le filtrează după source; tabela proprie de comenzi vine în v2.
  // CAPCANĂ supabase-js (audit aug 2026): builderul NU aruncă pe eroare DB —
  // eșecul vine în {error}. Cu doar try/catch, un insert picat era complet
  // invizibil; dacă pica ȘI emailul, comanda (bani reali) se pierdea total cu
  // 200 OK către client. Acum urmărim ambele canale și picăm cererea când
  // AMBELE au eșuat.
  let dbOk = false
  try {
    const { error: dbErr } = await supabase.from('recrutare_leads').insert({
      name,
      cafe: business || '(persoană fizică)',
      city: null,
      phone,
      email,
      message: orderSummary,
      source: 'codvia_order',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || null,
      user_agent: event.headers['user-agent'] || null,
    })
    if (dbErr) console.error('[codvia-order] DB insert failed:', dbErr.message)
    else dbOk = true
  } catch (e) {
    console.error('[codvia-order] DB insert failed', e)
    // Nu picăm cererea încă — emailul către fondator pleacă oricum mai jos.
  }

  let emailOk = false
  try {
    const subject = `[Codvia] ${product.label} × ${qty} — ${business || name}`
    const html = `
      <h2>📦 Comandă nouă Codvia</h2>
      <table style="border-collapse:collapse">
        <tr><td><b>Produs:</b></td><td>${escapeHtml(product.label)} × ${qty} (~${product.price * qty} lei)</td></tr>
        <tr><td><b>Nume:</b></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><b>Local/Firmă:</b></td><td>${escapeHtml(business || '—')}</td></tr>
        <tr><td><b>Telefon:</b></td><td><a href="tel:${encodeURIComponent(phone)}">${escapeHtml(phone)}</a></td></tr>
        <tr><td><b>Email:</b></td><td><a href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a></td></tr>
        <tr><td><b>Adresă:</b></td><td>${escapeHtml(address)}</td></tr>
        <tr><td><b>Meniu QR:</b></td><td>${menuSlug ? `https://menuvia.ro/m/${escapeHtml(menuSlug)}` : '—'}</td></tr>
      </table>
      ${message ? `<h3>Mesaj:</h3><p style="white-space:pre-wrap">${escapeHtml(message)}</p>` : ''}
      <p style="color:#888;font-size:12px;margin-top:24px">
        Confirmă telefonic în 24h. Plata: ramburs la livrare sau transfer. · IP: ${clientIp}
      </p>
    `
    if (process.env.RESEND_API_KEY) {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        // Timeout explicit — un TCP agățat spre Resend ar consuma invocarea.
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Codvia Comenzi <pilot@menuvia.ro>',
          to: [FOUNDER_EMAIL],
          subject,
          html,
          reply_to: email,
        }),
      })
      if (!resp.ok) console.error('[codvia-order] Resend failed:', await resp.text())
      else emailOk = true
    } else {
      // GDPR: log doar metadata, nu PII în clar.
      console.log('[codvia-order] Order stored (no Resend key)', {
        product: productKey,
        qty,
        hasSlug: !!menuSlug,
        emailDomain: email.split('@')[1] || null,
      })
    }
  } catch (e) {
    console.error('[codvia-order] Email send failed', e)
    // Dacă măcar DB-ul a mers, comanda nu e pierdută — returnăm OK mai jos.
  }

  // Ambele canale au eșuat → comanda ar dispărea FĂRĂ URMĂ. 500 ca clientul să
  // vadă eroarea și să reîncerce/sune — nu confirmare falsă. (Lipsa cheii
  // Resend NU e eșec de email dacă DB-ul a salvat lead-ul.)
  if (!dbOk && !emailOk) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Comanda nu a putut fi înregistrată. Reîncearcă sau scrie-ne direct.' }),
    }
  }

  return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ ok: true }) }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
