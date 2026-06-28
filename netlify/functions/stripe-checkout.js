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
  // Parsare protejata: un corp non-JSON nu trebuie sa arunce SyntaxError neprins (crash).
  let body = {}
  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }
  const requestedPlan = String(body.plan || '').toLowerCase()
  // Cod de referral din cookie-ul de afiliere (trimis de frontend). Normalizat
  // și mărginit defensiv; gol/invalid → ignorat fără efect.
  const referralCode = String(body.referral_code || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32)
  // visitor_id corelează touch-ul (de la /r/:cod) cu această conversie pentru
  // gate-ul de incrementality fail-closed (vezi capture_affiliate_attribution).
  const visitorId = String(body.visitor_id || '').slice(0, 64)
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

  // Rate limit per user (endpoint autentificat dar abuzabil): max 10 checkout-uri / 5 min.
  // Fail-open pe eroare de infra (nu blocăm plăți legitime dacă serviciul pică).
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name:  'stripe_checkout',
      p_scope_key:      user.id,
      p_max_requests:   10,
      p_window_minutes: 5,
    })
    if (!rlErr && rlOk === false) {
      return jsonResponse(429, { error: 'Prea multe încercări. Reîncearcă în câteva minute.' })
    }
    if (rlErr) {
      // Fail-open, dar logăm — altfel un limiter rupt/lipsă trece neobservat.
      console.warn('[stripe-checkout] rate limit RPC failed (fail-open):', rlErr.message)
    }
  } catch (e) {
    console.warn('[stripe-checkout] rate limit check failed (fail-open):', e?.message)
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
        p_visitor_id: visitorId || null,
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
  // STRIPE_TRIAL_DAYS non-numeric (typo în env) ar da NaN → trial dezactivat silentios.
  // Fallback la 30 dacă valoarea nu e un întreg valid.
  const parsedTrial = parseInt(STRIPE_TRIAL_DAYS ?? '30', 10)
  const trialDays = Number.isFinite(parsedTrial) ? parsedTrial : 30

  // ── Anti dublu-abonament (#5) + trial-once (#15) ───────────────────────────
  // Self-contained în Stripe (fără coloană nouă în DB): citim istoricul de
  // subscripții al clientului.
  //   • dacă există deja una activă/în trial → 409 (schimbarea planului se face
  //     din Portalul de facturare, nu printr-un nou checkout — altfel dublă plată);
  //   • dacă a existat VREODATĂ un trial → nu mai acordăm altul (anti trial-farming).
  let allowTrial = trialDays > 0
  let subsAll
  try {
    // Paginăm TOATE subscripțiile clientului (nu doar prima pagină de 100), altfel o
    // subscripție live/trial mai veche ar putea fi ratată → dublu abonament / trial repetat.
    subsAll = await stripe.subscriptions
      .list({ customer: customerId, status: 'all', limit: 100 })
      .autoPagingToArray({ limit: 10000 })
  } catch (e) {
    // Fail-closed: dacă nu putem verifica istoricul de subscripții, NU pornim un checkout nou
    // (altfel un eroare tranzitorie Stripe ar putea duce la al doilea abonament). 503 → retry.
    console.error('[stripe-checkout] subscription history lookup failed:', e?.message)
    return jsonResponse(503, {
      error: 'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.',
      code: 'subscription_lookup_failed',
    })
  }

  const hasLive = subsAll.some(
    (s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due',
  )
  if (hasLive) {
    return jsonResponse(409, {
      error: 'Ai deja un abonament. Schimbă planul din Portalul de facturare.',
      code: 'subscription_exists',
    })
  }
  // trial-once: dacă a existat VREODATĂ un trial, nu mai acordăm altul (anti trial-farming).
  const hadTrial = subsAll.some((s) => s.trial_start != null || s.trial_end != null)
  if (hadTrial) allowTrial = false

  const session = await stripe.checkout.sessions.create(
    {
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
        ...(allowTrial ? { trial_period_days: trialDays } : {}),
      },
    },
    {
      // Idempotență: cheia trebuie să includă TOATE intrările care schimbă corpul cererii
      // (plan, referral_code, trial), altfel Stripe respinge cheia reutilizată cu params
      // diferiți (idempotency_error). Click-uri repetate cu EXACT aceeași cerere → aceeași
      // sesiune (dedup); orice diferență → cheie nouă.
      idempotencyKey: `checkout_${user.id}_${requestedPlan}_${referralCode || 'none'}_${allowTrial ? trialDays : 0}`,
    },
  )

  return jsonResponse(200, { url: session.url })
}
