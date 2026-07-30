// netlify/functions/stripe-connect-webhook.js
// Webhook-ul de CONNECT (evenimentele conturilor conectate) pentru plata
// online la masă (design: docs/ONLINE_PAYMENT.md).
//
// Endpoint SEPARAT de stripe-webhook.js: evenimentele de pe conturile
// conectate au alt signing secret (STRIPE_CONNECT_WEBHOOK_SECRET) și poartă
// câmpul `account`. Semnătura se verifică pe corpul RAW (SEC-001 — base64).
// Idempotență dublă: dedup pe stripe_events (SEC-003, același pattern ca
// stripe-webhook.js) + settle_table_payment idempotent pe intent id.

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// SEC-001: semnătura Stripe se calculează pe bytes-ii cruzi.
function getRawBody(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8')
  }
  return event.body
}

const OUTCOME_BY_EVENT = {
  'payment_intent.succeeded': 'succeeded',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'canceled',
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const {
    STRIPE_SECRET_KEY, STRIPE_CONNECT_WEBHOOK_SECRET,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  } = process.env
  if (!STRIPE_SECRET_KEY || !STRIPE_CONNECT_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[connect-webhook] Missing env vars')
    return jsonResponse(500, { error: 'Server config error' })
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { timeout: 6000, maxNetworkRetries: 0 })
  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      getRawBody(event),
      event.headers['stripe-signature'],
      STRIPE_CONNECT_WEBHOOK_SECRET,
    )
  } catch (err) {
    console.error('[connect-webhook] Signature verification failed:', err.message)
    return jsonResponse(400, { error: 'Invalid signature' })
  }

  // account.application.deauthorized: contul conectat a revocat platforma din
  // propriul Stripe Dashboard (sau a fost șters). Fără curățare, stripe_account_id
  // rămâne stale: action 'status'/'link' pică permanent, iar begin_table_payment
  // folosește un cont mort. Îl golim (mig 204 acceptă null = deconectare) ca
  // localul să poată reconecta din UI (audit săpt. 10). Poartă `account`, nu un
  // payment_intent — deci ramură separată înaintea fluxului de intent.
  if (stripeEvent.type === 'account.application.deauthorized') {
    const acctId = stripeEvent.account
    if (!acctId) return jsonResponse(200, { received: true, ignored: 'no_account' })
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: rest, error: findErr } = await supabase
      .from('restaurants')
      .select('id')
      .eq('stripe_account_id', acctId)
      .maybeSingle()
    if (findErr) {
      console.error('[connect-webhook] deauthorized lookup failed:', findErr.message)
      return jsonResponse(500, { error: 'DB error' }) // Stripe retrimite
    }
    if (rest?.id) {
      const { error: clearErr } = await supabase.rpc('set_restaurant_stripe_account', {
        p_restaurant_id: rest.id,
        p_account_id: null,
      })
      if (clearErr) {
        console.error('[connect-webhook] deauthorized clear failed:', clearErr.message)
        return jsonResponse(500, { error: 'DB error' })
      }
    }
    return jsonResponse(200, { received: true, deauthorized: acctId })
  }

  const outcome = OUTCOME_BY_EVENT[stripeEvent.type]
  if (!outcome) {
    // Evenimente Connect care nu ne privesc (account.updated etc.) — ack.
    return jsonResponse(200, { received: true, ignored: stripeEvent.type })
  }

  const intent = stripeEvent.data?.object
  // Doar intent-urile create de noi (au metadata menuvia_payment_id) — pe
  // contul conectat pot exista și alte plăți ale localului.
  if (!intent?.id || !intent?.metadata?.menuvia_payment_id) {
    return jsonResponse(200, { received: true, ignored: 'not_a_menuvia_intent' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // SEC-003: dedup durabil pe event id — Stripe retrimite la orice non-2xx.
  const { error: dedupErr } = await supabase.from('stripe_events').insert({
    event_id: stripeEvent.id,
    event_type: stripeEvent.type,
    payload: stripeEvent.data || null,
    status: 'processing',
  })
  if (dedupErr) {
    if (dedupErr.code === '23505') {
      // Rând existent: reprocesăm DOAR dacă nu e deja completed (retry legitim
      // după un 500 anterior) — același contract ca în stripe-webhook.js.
      const { data: reopened, error: reopenErr } = await supabase
        .from('stripe_events')
        .update({ status: 'processing', error_info: null })
        .eq('event_id', stripeEvent.id)
        .neq('status', 'completed')
        .select('status')
      if (reopenErr) {
        console.error('[connect-webhook] dedup reopen failed:', reopenErr.message)
        return jsonResponse(500, { error: 'DB error' })
      }
      if (!reopened || reopened.length === 0) {
        return jsonResponse(200, { received: true, duplicate: true })
      }
    } else {
      console.error('[connect-webhook] dedup insert failed:', dedupErr.message)
      return jsonResponse(500, { error: 'DB error' })
    }
  }

  // Settle (idempotent pe intent id în RPC).
  const failReason =
    outcome === 'failed' ? intent.last_payment_error?.message || 'payment_failed' : null
  const { data: settled, error: settleErr } = await supabase.rpc('settle_table_payment', {
    p_intent_id: intent.id,
    p_outcome: outcome,
    p_error_info: failReason,
  })

  if (settleErr) {
    // unknown_intent = plată care nu-i a noastră (sau attach pierdut) — o
    // marcăm completed cu notă ca să nu ciclăm; orice altceva → 500 (retry).
    if (settleErr.hint === 'unknown_intent') {
      await supabase
        .from('stripe_events')
        .update({ status: 'completed', error_info: 'unknown_intent (ignored)' })
        .eq('event_id', stripeEvent.id)
      return jsonResponse(200, { received: true, ignored: 'unknown_intent' })
    }
    console.error('[connect-webhook] settle failed:', settleErr.message)
    await supabase
      .from('stripe_events')
      .update({ status: 'failed', error_info: settleErr.message })
      .eq('event_id', stripeEvent.id)
    return jsonResponse(500, { error: 'Settle failed' })
  }

  const { error: doneErr } = await supabase
    .from('stripe_events')
    .update({ status: 'completed' })
    .eq('event_id', stripeEvent.id)
  if (doneErr) {
    // Settle-ul a REUȘIT; rândul rămâne 'processing' și retry-ul Stripe va
    // primi already_settled din RPC — doar logăm.
    console.error('[connect-webhook] mark completed failed:', doneErr.message)
  }

  return jsonResponse(200, { received: true, result: settled })
}
