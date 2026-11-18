// netlify/functions/stripe-portal.js
// Creează o sesiune Stripe Billing Portal pentru userul autentificat, ca să-și
// poată actualiza cardul / gestiona abonamentul (upgrade/downgrade/anulare).
// Aceasta e destinația reală a CTA-urilor din emailurile de facturare
// („Actualizează metoda de plată →", payment_failed / payment_recovered /
// trial_ending / invoice_ready) care trimit la /dashboard?tab=billing.
// Auth: validează JWT-ul Supabase. Aceleași convenții ca stripe-checkout.js.
//
// ⚠️ Setup founder (o singură dată): Portalul de facturare trebuie activat în
// Stripe Dashboard → Settings → Billing → Customer portal (altfel API-ul
// întoarce o eroare de configurare, surfaceată aici ca 500 cu mesaj clar).
//
// Lotul L8d: orice răspuns non-2xx JSON e `{ error, code }` (`error` = textul
// de dinainte, EXACT; `code` = cheia pe care SubscriptionCard o traduce), iar
// portalul se deschide în limba panoului (`ui_lang` din corp, validat pe
// ro/en/fr/de). Corpul era ignorat înainte, deci se citește TOLERANT: lipsă,
// ne-JSON sau fără `ui_lang` → fără `locale` = „auto”, ca înainte.

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')
const { appUrl: resolveAppUrl, LEGACY_NETLIFY_URL } = require('./lib/appUrl')
const { stripeLocale } = require('./lib/stripeLocale')
const { parseObjectBody } = require('./lib/jsonBody')
// Versiunea de API PINUITĂ (audit v3 OPS-8) pentru CERERILE noastre către Stripe:
// fără pin, un bump de SDK schimbă tăcut forma răspunsurilor pe care le citim
// (subscriptions.list, checkout sessions…). NU acoperă evenimentele de WEBHOOK:
// versiunea lor e setată per endpoint în Stripe Dashboard (act de fondator, A9)
// și trebuie ținută egală cu aceasta. Se schimbă DELIBERAT, cu
// tests/stripe-contract/ verzi (SDK-ul REAL; tests/functions/ îl înlocuiește cu
// totul). Implicitul SDK-ului se mută la fiecare versiune majoră (v22:
// '2026-08-26.dahlia', v23: '2026-09-30.endive'): fără pin, cererile ar trece
// TĂCUT pe implicitul SDK-ului instalat.
const STRIPE_API_VERSION = '2023-10-16'

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

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
  } = process.env

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'Stripe not configured', code: 'server_config' })
  }

  // Limba portalului (lotul L8d). NU respinge nimic: un corp stricat nu avea
  // niciun efect înainte și nu capătă unul acum.
  let uiLang = null
  try {
    // Ne-JSON sau ne-obiect (`null`, un tablou…) → parseObjectBody aruncă →
    // fără limbă, fără refuz (lib/jsonBody.js).
    uiLang = parseObjectBody(event.body).ui_lang
  } catch {
    uiLang = null
  }
  const locale = stripeLocale(uiLang)

  // Auth
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse(401, { error: 'Missing Authorization header', code: 'auth_missing' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return jsonResponse(401, { error: 'Invalid token', code: 'auth_invalid' })
  }

  // OPT-R2: rate-limit-ul și lookup-ul de profil depind ambele DOAR de user.id
  // (nu unul de altul) — le lansăm în PARALEL, păstrând EXACT aceeași ordine
  // de evaluare fail-closed (rate-limit întâi, apoi profil). −1 RTT serial.
  let rlOk, rlErr, profile, profileErr
  try {
    const [rlRes, profRes] = await Promise.all([
      supabase.rpc('check_rate_limit', {
        p_function_name:  'stripe_portal',
        p_scope_key:      user.id,
        p_max_requests:   10,
        p_window_minutes: 5,
      }),
      supabase.from('profiles').select('stripe_customer_id').eq('id', user.id).single(),
    ])
    rlOk = rlRes.data; rlErr = rlRes.error
    profile = profRes.data; profileErr = profRes.error
  } catch (e) {
    console.error('[stripe-portal] rate limit / profile fetch threw (fail-closed):', e?.message)
    return jsonResponse(503, { error: 'Rate limit service unavailable', code: 'rate_limit_unavailable' })
  }

  // Rate limit per user (fail-closed pe eroare de infra, ca la stripe-checkout).
  if (rlErr) {
    console.error('[stripe-portal] rate limit RPC failed (fail-closed):', rlErr.message)
    return jsonResponse(503, { error: 'Rate limit service unavailable', code: 'rate_limit_unavailable' })
  }
  if (rlOk === false) {
    return jsonResponse(429, {
      error: 'Prea multe încercări. Reîncearcă în câteva minute.',
      code: 'rate_limited',
    })
  }

  // Eroare de DB (rețea/RLS tranzitoriu) ≠ „fără abonament": fără verificare,
  // un blip la exact endpoint-ul care rezolvă problema de plată răspundea fals
  // 404 „nu ai abonament" unui admin cu abonament activ (audit săpt. 10).
  if (profileErr) {
    console.error('[stripe-portal] profile lookup failed:', profileErr.message)
    return jsonResponse(503, {
      error: 'Serviciu temporar indisponibil. Reîncearcă.',
      code: 'service_unavailable',
    })
  }

  const customerId = profile?.stripe_customer_id
  // Fără customer Stripe = niciodată n-a pornit un abonament → nimic de gestionat.
  // 404 cu mesaj clar (frontend-ul direcționează spre /pricing).
  if (!customerId) {
    return jsonResponse(404, {
      error: 'Nu ai încă un abonament de gestionat.',
      code: 'no_customer',
    })
  }

  // Cheile + fallback-ul de dinainte, EXACT (VITE_APP_URL → menuvia.netlify.app).
  const appUrl = resolveAppUrl({ keys: ['VITE_APP_URL'], fallback: LEGACY_NETLIFY_URL })
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 })

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard`,
      // Lotul L8d: portalul în limba panoului; fără cheie = „auto”.
      ...(locale ? { locale } : {}),
    })
    return jsonResponse(200, { url: session.url })
  } catch (e) {
    // Cea mai comună cauză: portalul nu e configurat în Stripe Dashboard.
    // Surfaceăm clar (nu 200 gol) ca founder-ul să știe ce să activeze.
    console.error('[stripe-portal] billing portal session create failed:', e?.message)
    return jsonResponse(500, {
      error: 'Portalul de facturare nu e disponibil momentan.',
      code: 'portal_unavailable',
    })
  }
}
