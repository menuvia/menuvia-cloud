// netlify/functions/ai-credits-checkout.js
// Creează un Stripe Checkout Session (plată unică) pentru cumpărarea de
// tokens AI suplimentari. La plată, stripe-webhook apelează
// ai_add_credits_for_event (idempotent) ca să adauge creditele.
//
// Auth: JWT Supabase + caller = owner/manager al restaurantului.

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')
const { appUrl: resolveAppUrl, LEGACY_NETLIFY_URL } = require('./lib/appUrl')
// Contractul de eroare: orice non-200 = { error: <română>, code } (lib/aiErrors.js).
const { aiError } = require('./lib/aiErrors')
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

// Pachete de credite: tokens + preț (bani, în RON, exprimat în subunități/„bani").
// Sursa de adevăr a maparii tokens↔preț e AICI (server), nu în client.
const PACKS = {
  small:  { tokens: 100000,  amount: 1900,  label: '100.000 tokens AI' },
  medium: { tokens: 500000,  amount: 7900,  label: '500.000 tokens AI' },
  large:  { tokens: 2000000, amount: 24900, label: '2.000.000 tokens AI' },
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return aiError(405, 'method_not_allowed')
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return aiError(500, 'server_config')
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return aiError(400, 'bad_json')
  }

  const { restaurant_id, pack } = body
  if (!restaurant_id) return aiError(400, 'missing_restaurant')
  // hasOwnProperty: `PACKS[pack]` cu pack='constructor'/'toString' întorcea o
  // funcție moștenită din Object.prototype → trecea de `!packDef` și crăpa mai
  // jos cu 500 în loc de un 400 curat.
  const packDef = Object.prototype.hasOwnProperty.call(PACKS, pack) ? PACKS[pack] : null
  if (!packDef) return aiError(400, 'invalid_pack')

  // Auth
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return aiError(401, 'auth_missing')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return aiError(401, 'auth_invalid')

  // Autorizare: owner/manager al restaurantului
  const { data: membership } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurant_id)
    .eq('user_id', user.id)
    .single()
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return aiError(403, 'forbidden')
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 })

  // Reutilizează/creează customer-ul Stripe al userului.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .single()

  // Fără guard, un blip tranzient pe acest SELECT lăsa `profile` null → intram în
  // ramura de creare și făceam un customer Stripe DUPLICAT pentru un user care
  // avea deja unul. Ieșim 503 înainte de creare (oglindă cu stripe-checkout.js).
  if (profileErr) {
    console.error('[ai-credits-checkout] profiles SELECT error:', profileErr.message)
    return aiError(503, 'service_unavailable')
  }

  let customerId = profile?.stripe_customer_id
  if (!customerId) {
    // Un apel Stripe care aruncă (cheie rotită, Stripe indisponibil, timeout)
    // ar ieși din funcție ca 502 FĂRĂ corp de contract, iar clientul ar afișa
    // pe butonul de cumpărare „Asistentul AI nu a putut răspunde" — fals.
    let customer
    try {
      customer = await stripe.customers.create({
        email: profile?.email || user.email,
        metadata: { supabase_user_id: user.id },
      })
    } catch (e) {
      console.error('[ai-credits-checkout] customers.create error:', e?.message)
      return aiError(502, 'checkout_failed')
    }
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

  // Cheile + fallback-ul de dinainte, EXACT (VITE_APP_URL → menuvia.netlify.app).
  const appUrl = resolveAppUrl({ keys: ['VITE_APP_URL'], fallback: LEGACY_NETLIFY_URL })

  let session
  try {
    session = await stripe.checkout.sessions.create({
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
  } catch (e) {
    console.error('[ai-credits-checkout] checkout.sessions.create error:', e?.message)
    return aiError(502, 'checkout_failed')
  }
  // Fără URL clientul ar naviga la „undefined" (window.location.href = url).
  if (!session || typeof session.url !== 'string' || !session.url) {
    return aiError(502, 'checkout_failed')
  }

  return jsonResponse(200, { url: session.url })
}
