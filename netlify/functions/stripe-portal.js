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

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')

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
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, VITE_APP_URL,
  } = process.env

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'Stripe not configured' })
  }

  // Auth
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse(401, { error: 'Missing Authorization header' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return jsonResponse(401, { error: 'Invalid token' })
  }

  // Rate limit per user (fail-closed pe eroare de infra, ca la stripe-checkout).
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name:  'stripe_portal',
      p_scope_key:      user.id,
      p_max_requests:   10,
      p_window_minutes: 5,
    })
    if (rlErr) {
      console.error('[stripe-portal] rate limit RPC failed (fail-closed):', rlErr.message)
      return jsonResponse(503, { error: 'Rate limit service unavailable' })
    }
    if (rlOk === false) {
      return jsonResponse(429, { error: 'Prea multe încercări. Reîncearcă în câteva minute.' })
    }
  } catch (e) {
    console.error('[stripe-portal] rate limit check threw (fail-closed):', e?.message)
    return jsonResponse(503, { error: 'Rate limit service unavailable' })
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  // Eroare de DB (rețea/RLS tranzitoriu) ≠ „fără abonament": fără verificare,
  // un blip la exact endpoint-ul care rezolvă problema de plată răspundea fals
  // 404 „nu ai abonament" unui admin cu abonament activ (audit săpt. 10).
  if (profileErr) {
    console.error('[stripe-portal] profile lookup failed:', profileErr.message)
    return jsonResponse(503, { error: 'Serviciu temporar indisponibil. Reîncearcă.' })
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

  const appUrl = VITE_APP_URL || 'https://menuvia.netlify.app'
  const stripe = new Stripe(STRIPE_SECRET_KEY)

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard`,
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
