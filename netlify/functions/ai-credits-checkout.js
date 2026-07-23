// netlify/functions/ai-credits-checkout.js
// Creează un Stripe Checkout Session (plată unică) pentru cumpărarea de
// tokens AI suplimentari. La plată, stripe-webhook apelează
// ai_add_credits_for_event (idempotent) ca să adauge creditele.
//
// Auth: JWT Supabase + caller = owner/manager al restaurantului.

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Pachete de credite: tokens + preț (bani, în RON, exprimat în subunități/„bani").
// Sursa de adevăr a maparii tokens↔preț e AICI (server), nu în client.
const PACKS = {
  small:  { tokens: 100000,  amount: 1900,  label: '100.000 tokens AI' },
  medium: { tokens: 500000,  amount: 7900,  label: '500.000 tokens AI' },
  large:  { tokens: 2000000, amount: 24900, label: '2.000.000 tokens AI' },
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, VITE_APP_URL } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return jsonResponse(500, { error: 'Server config error' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const { restaurant_id, pack } = body
  if (!restaurant_id) return jsonResponse(400, { error: 'Missing restaurant_id' })
  const packDef = PACKS[pack]
  if (!packDef) return jsonResponse(400, { error: 'Invalid pack' })

  // Auth
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return jsonResponse(401, { error: 'Missing Authorization header' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return jsonResponse(401, { error: 'Invalid token' })

  // Autorizare: owner/manager al restaurantului
  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return jsonResponse(403, { error: 'Forbidden' })
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { timeout: 6000, maxNetworkRetries: 0 })

  // Reutilizează/creează customer-ul Stripe al userului.
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

    // Anti race la creare concurentă (2 cereri simultane fără stripe_customer_id
    // ar crea 2 customeri Stripe pentru același user). UPDATE atomic condiționat
    // pe .is('stripe_customer_id', null): doar cererea care câștigă cursa scrie.
    // Oglindă cu stripe-checkout.js.
    const { data: updatedRows } = await supabase.from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id')

    if (!updatedRows || updatedRows.length === 0) {
      // Altcineva a fost mai rapid — recitim customer_id-ul real și îl folosim
      // pe acela, ca să nu rămânem cu 2 customeri Stripe pentru același user.
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single()

      if (freshProfile?.stripe_customer_id) {
        const orphanCustomerId = customerId
        customerId = freshProfile.stripe_customer_id
        // Best-effort cleanup al customer-ului orfan creat de noi — nu blocăm
        // fluxul de checkout dacă ștergerea eșuează.
        try {
          await stripe.customers.del(orphanCustomerId)
        } catch (e) {
          console.warn('[ai-credits-checkout] cleanup orphan Stripe customer failed:', e?.message)
        }
      }
    }
  }

  const appUrl = VITE_APP_URL || 'https://menuvia.netlify.app'

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'ron',
          unit_amount: packDef.amount,
          product_data: { name: `Menuvia · ${packDef.label}` },
        },
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/dashboard?ai_credits=success`,
    cancel_url: `${appUrl}/dashboard?ai_credits=cancelled`,
    // Metadata citită de webhook pentru fulfilment-ul idempotent al creditelor.
    metadata: {
      type: 'ai_credits',
      restaurant_id,
      tokens: String(packDef.tokens),
    },
  })

  return jsonResponse(200, { url: session.url })
}
