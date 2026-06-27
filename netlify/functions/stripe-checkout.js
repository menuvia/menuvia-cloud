// netlify/functions/stripe-checkout.js
// Creates a Stripe Checkout Session for Pro plan subscription.
// Auth: validates Supabase JWT.

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
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
    STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID,
    STRIPE_PRO_PRICE_ID, STRIPE_ENTERPRISE_PRICE_ID,
    STRIPE_TRIAL_DAYS, VITE_APP_URL,
  } = process.env

  // Price map per plan canonic. Lipsa unui price ID = planul respectiv
  // indisponibil (defensiv — vezi mai jos), NU silent fallback la pro.
  const PRICE_IDS = {
    starter:    STRIPE_STARTER_PRICE_ID,
    growth:     STRIPE_GROWTH_PRICE_ID,
    pro:        STRIPE_PRO_PRICE_ID,
    enterprise: STRIPE_ENTERPRISE_PRICE_ID,
  }

  if (!STRIPE_SECRET_KEY || !Object.values(PRICE_IDS).some(Boolean)) {
    return jsonResponse(500, { error: 'Stripe not configured' })
  }

  // Determine price strictly by requested plan — NO silent fallback to pro.
  const body = event.body ? JSON.parse(event.body) : {}
  const requestedPlan = String(body.plan || '').toLowerCase()
  // Cod de referral din cookie-ul de afiliere (trimis de frontend). Normalizat
  // și mărginit defensiv; gol/invalid → ignorat fără efect.
  const referralCode = String(body.referral_code || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32)
  const priceId = PRICE_IDS[requestedPlan]
  if (!priceId) {
    return jsonResponse(400, {
      error: `Plan "${requestedPlan}" indisponibil sau neconfigurat în Stripe`,
    })
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

  // Get or create Stripe customer
  const stripe = new Stripe(STRIPE_SECRET_KEY)

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email || user.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await supabase.from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
  }

  // ── Afiliere: creează atribuirea (best-effort, nu blochează checkout-ul) ────
  // Gate-urile (self-referral, incrementality, first-wins) sunt în RPC. Dacă
  // ceva eșuază, lăsăm checkout-ul să continue — afilierea nu trebuie să rupă
  // fluxul de plată.
  if (referralCode) {
    try {
      const { error: attrErr } = await supabase.rpc('capture_affiliate_attribution', {
        p_referral_code: referralCode,
        p_referred_profile_id: user.id,
        p_stripe_customer_id: customerId,
      })
      if (attrErr) {
        console.warn('[stripe-checkout] affiliate capture failed:', attrErr.message)
      }
    } catch (e) {
      console.warn('[stripe-checkout] affiliate capture threw:', e?.message)
    }
  }

  const appUrl = VITE_APP_URL || 'https://menuvia.netlify.app'

  // Trial configurabil — default 30 zile (onorează promisiunea din landing).
  // Set STRIPE_TRIAL_DAYS=0 în Netlify Env pentru a dezactiva fără cod.
  const trialDays = parseInt(STRIPE_TRIAL_DAYS ?? '30', 10)

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    subscription_data: {
      // plan în metadata → webhook citește planul REAL cumpărat, nu hardcodat.
      // referral_code persistă pe subscription → disponibil în invoice.paid
      // (sursă secundară; atribuirea primară e legată de stripe_customer_id).
      metadata: {
        supabase_user_id: user.id,
        plan: requestedPlan,
        ...(referralCode ? { referral_code: referralCode } : {}),
      },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
  })

  return jsonResponse(200, { url: session.url })
}
