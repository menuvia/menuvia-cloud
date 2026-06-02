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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_PRO_PRICE_ID, STRIPE_BUSINESS_PRICE_ID, VITE_APP_URL } = process.env

  if (!STRIPE_SECRET_KEY || !STRIPE_PRO_PRICE_ID) {
    return jsonResponse(500, { error: 'Stripe not configured' })
  }

  // Env guard — fără config valid, ieșim cu 500 clar (vezi stripe-webhook.js).
  // Fallback la VITE_SUPABASE_URL ca defensive depth (același URL public).
  const supabaseUrl = SUPABASE_URL || process.env.VITE_SUPABASE_URL
  if (!supabaseUrl || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[stripe-checkout] Missing env vars (SUPABASE_URL/SERVICE_ROLE_KEY)')
    return jsonResponse(500, { error: 'Server config error' })
  }

  // Determine which price to use based on plan param
  const body = event.body ? JSON.parse(event.body) : {}
  const planId = body.plan === 'business' && STRIPE_BUSINESS_PRICE_ID ? 'business' : 'pro'
  const priceId = planId === 'business' ? STRIPE_BUSINESS_PRICE_ID : STRIPE_PRO_PRICE_ID

  // Auth
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse(401, { error: 'Missing Authorization header' })
  }

  const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY)
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

  const appUrl = VITE_APP_URL || 'https://menuvia.netlify.app'

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  })

  return jsonResponse(200, { url: session.url })
}
