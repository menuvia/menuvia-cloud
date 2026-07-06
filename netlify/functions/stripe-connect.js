// netlify/functions/stripe-connect.js
// Onboarding Stripe Connect (Standard) pentru restaurant — Etapa 1 plata
// online la masă (design: docs/ONLINE_PAYMENT.md).
//
// Auth: JWT Supabase al unui membru owner/manager al restaurantului.
// Acțiuni:
//   { restaurant_id, action: 'link' }   → creează contul (dacă lipsește) +
//                                         întoarce URL-ul de onboarding Stripe
//   { restaurant_id, action: 'status' } → { connected, charges_enabled, ... }
// Scrierea stripe_account_id trece EXCLUSIV prin RPC-ul service_role-only
// set_restaurant_stripe_account (mig 204) — coloana nu are grant authenticated.

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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, VITE_APP_URL } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    console.error('[stripe-connect] Missing env vars')
    return jsonResponse(500, { error: 'Stripe Connect nu este configurat.' })
  }

  let body = {}
  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }
  const restaurantId = String(body.restaurant_id || '')
  const action = String(body.action || 'status')
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId) || !['link', 'status'].includes(action)) {
    return jsonResponse(400, { error: 'restaurant_id și action (link|status) sunt obligatorii.' })
  }

  // Auth: userul din JWT trebuie să fie owner/manager al restaurantului.
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return jsonResponse(401, { error: 'Neautentificat.' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) return jsonResponse(401, { error: 'Sesiune invalidă.' })

  const { data: membership, error: memErr } = await supabase
    .from('restaurant_memberships')
    .select('role')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (memErr) {
    console.error('[stripe-connect] membership check failed:', memErr.message)
    return jsonResponse(500, { error: 'Verificarea accesului a eșuat.' })
  }
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return jsonResponse(403, { error: 'Doar owner/manager poate configura plățile.' })
  }

  const { data: restaurant, error: restErr } = await supabase
    .from('restaurants')
    .select('stripe_account_id, name')
    .eq('id', restaurantId)
    .maybeSingle()
  if (restErr || !restaurant) {
    return jsonResponse(404, { error: 'Restaurant negăsit.' })
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY)

  if (action === 'status') {
    if (!restaurant.stripe_account_id) {
      return jsonResponse(200, { connected: false })
    }
    try {
      const account = await stripe.accounts.retrieve(restaurant.stripe_account_id)
      return jsonResponse(200, {
        connected: true,
        charges_enabled: !!account.charges_enabled,
        details_submitted: !!account.details_submitted,
      })
    } catch (e) {
      console.error('[stripe-connect] account retrieve failed:', e?.message)
      return jsonResponse(502, { error: 'Stripe indisponibil. Reîncearcă.' })
    }
  }

  // action === 'link'
  try {
    let accountId = restaurant.stripe_account_id
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        metadata: { restaurant_id: restaurantId },
      })
      accountId = account.id
      const { error: setErr } = await supabase.rpc('set_restaurant_stripe_account', {
        p_restaurant_id: restaurantId,
        p_account_id: accountId,
      })
      if (setErr) {
        // Contul Stripe a fost creat dar nu l-am putut lega — log EXPLICIT cu
        // id-ul, ca să poată fi legat manual (nu-l pierdem).
        console.error(
          `[stripe-connect] set account failed (acct ${accountId} pentru ${restaurantId}):`,
          setErr.message,
        )
        return jsonResponse(500, { error: 'Contul a fost creat dar legarea a eșuat. Reîncearcă.' })
      }
    }

    const base = (VITE_APP_URL || 'https://menuvia.ro').replace(/\/$/, '')
    const link = await stripe.accountLinks.create({
      account: accountId,
      // Ambele întorc în dashboard — SettingsTab recitește statusul la mount.
      refresh_url: `${base}/dashboard`,
      return_url: `${base}/dashboard`,
      type: 'account_onboarding',
    })
    return jsonResponse(200, { url: link.url })
  } catch (e) {
    console.error('[stripe-connect] link failed:', e?.message)
    return jsonResponse(502, {
      error:
        'Stripe a refuzat operațiunea. Verifică dacă Connect e activat pe contul platformei.',
    })
  }
}
