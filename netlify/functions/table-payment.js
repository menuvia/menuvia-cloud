// netlify/functions/table-payment.js
// Plata online la masă — Etapa 1 (design: docs/ONLINE_PAYMENT.md).
// Endpoint ANON (clientul de la masă, fără cont): creează PaymentIntent-ul
// pe contul Stripe CONECTAT al restaurantului (direct charge + application_fee).
//
// Toată validarea de bani stă în RPC-ul begin_table_payment (service_role):
// suma se calculează EXCLUSIV server-side, cu gate-urile de plan/modul/cont.
// Funcția asta doar orchestrează: RPC → Stripe → attach intent → client_secret.
// Acțiunea 'cancel' (mig 208): opt-out-ul clientului („plătesc la ospătar") —
// validare ownership prin RPC → cancel la Stripe → settle('canceled').

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Hint-urile de business din RPC → status HTTP. Orice altceva = 500 generic
// (mesajul RO din RPC e sigur de afișat — vine din codul nostru, nu din date).
const HINT_STATUS = {
  invalid_session: 409,
  invalid_token: 403,
  feature_disabled: 403,
  module_disabled: 403,
  not_connected: 409,
  nothing_to_pay: 409,
  invalid_payment: 409,
  currency_not_supported: 409,
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY,
  } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY) {
    console.error('[table-payment] Missing env vars')
    return jsonResponse(500, { error: 'Plata online nu este configurată.' })
  }

  let body = {}
  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }
  const token = String(body.token || '').slice(0, 128)
  const sessionId = String(body.session_id || '').slice(0, 64)
  const action = String(body.action || 'create')
  const paymentId = String(body.payment_id || '')
  if (!token || !/^[0-9a-f-]{36}$/i.test(sessionId) || !['create', 'cancel'].includes(action)) {
    return jsonResponse(400, { error: 'token și session_id sunt obligatorii.' })
  }
  if (action === 'cancel' && !/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return jsonResponse(400, { error: 'payment_id este obligatoriu la anulare.' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Rate limit per sesiune (fail-closed, ca la stripe-checkout): un client
  // care tot regenerează intent-uri nu poate spama Stripe-ul localului.
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name: 'table_payment',
      p_scope_key: sessionId,
      p_max_requests: 10,
      p_window_minutes: 5,
    })
    if (rlErr) {
      console.error('[table-payment] rate limit RPC failed (fail-closed):', rlErr.message)
      return jsonResponse(503, { error: 'Serviciul e ocupat. Reîncearcă imediat.' })
    }
    if (rlOk === false) {
      return jsonResponse(429, { error: 'Prea multe încercări. Reîncearcă în câteva minute.' })
    }
  } catch (e) {
    console.error('[table-payment] rate limit check threw (fail-closed):', e?.message)
    return jsonResponse(503, { error: 'Serviciul e ocupat. Reîncearcă imediat.' })
  }

  // Opt-out: clientul renunță la plata online („plătesc la ospătar").
  if (action === 'cancel') {
    const { data: c, error: cErr } = await supabase.rpc('cancel_table_payment', {
      p_payment_id: paymentId,
      p_session_id: sessionId,
      p_token: token,
    })
    if (cErr) {
      const status = HINT_STATUS[cErr.hint] || 500
      if (status === 500) console.error('[table-payment] cancel RPC failed:', cErr.message)
      return jsonResponse(status, { error: cErr.message, hint: cErr.hint || null })
    }
    if (c.cancelable === false) {
      // succeeded = banii au fost deja încasați; canceled = nimic de făcut.
      return jsonResponse(c.status === 'succeeded' ? 409 : 200, { status: c.status })
    }
    if (c.canceled === true) {
      return jsonResponse(200, { status: 'canceled' })
    }
    // Are intent atașat: anulăm ÎNTÂI la Stripe (dacă între timp plata a
    // reușit, Stripe refuză și clientul află că a plătit deja), apoi settle.
    const stripeC = new Stripe(STRIPE_SECRET_KEY)
    try {
      await stripeC.paymentIntents.cancel(c.stripe_payment_intent_id, {
        stripeAccount: c.stripe_account_id,
      })
    } catch (e) {
      const already = e && (e.code === 'payment_intent_unexpected_state' || /succeeded/i.test(e.message || ''))
      if (already) {
        return jsonResponse(409, { status: 'succeeded' })
      }
      console.error('[table-payment] Stripe cancel failed:', e && e.message)
      return jsonResponse(502, { error: 'Anularea nu a reușit. Reîncearcă sau cere nota ospătarului.' })
    }
    const { error: settleErr } = await supabase.rpc('settle_table_payment', {
      p_intent_id: c.stripe_payment_intent_id,
      p_outcome: 'canceled',
      p_error_info: 'Anulat de client (plătește la ospătar).',
    })
    if (settleErr) {
      // Intent-ul E anulat la Stripe (sigur); webhook-ul de canceled va marca
      // rândul — doar logăm.
      console.error('[table-payment] settle canceled failed (webhook-ul va prelua):', settleErr.message)
    }
    return jsonResponse(200, { status: 'canceled' })
  }

  // 1) Suma + gate-urile, server-side.
  const { data: begin, error: beginErr } = await supabase.rpc('begin_table_payment', {
    p_session_id: sessionId,
    p_token: token,
  })
  if (beginErr) {
    const status = HINT_STATUS[beginErr.hint] || (beginErr.message?.includes('Featurea') ? 403 : 500)
    if (status === 500) console.error('[table-payment] begin failed:', beginErr.message)
    return jsonResponse(status, { error: beginErr.message, hint: beginErr.hint || null })
  }

  const amountBani = Math.round(Number(begin.amount) * 100)
  const feeBani = Math.round(Number(begin.application_fee) * 100)
  if (!Number.isInteger(amountBani) || amountBani <= 0) {
    console.error('[table-payment] invalid amount from RPC:', begin.amount)
    return jsonResponse(500, { error: 'Sumă invalidă.' })
  }

  // 2) PaymentIntent pe contul conectat. Idempotency-Key = payment_id:
  // un retry de rețea al aceluiași begin NU dublează intent-ul.
  const stripe = new Stripe(STRIPE_SECRET_KEY)
  let intent
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: amountBani,
        currency: 'ron',
        automatic_payment_methods: { enabled: true },
        ...(feeBani > 0 ? { application_fee_amount: feeBani } : {}),
        description: 'Menuvia — nota mesei',
        metadata: {
          menuvia_payment_id: begin.payment_id,
          session_id: sessionId,
        },
      },
      {
        stripeAccount: begin.stripe_account_id,
        idempotencyKey: `tp_${begin.payment_id}`,
      },
    )
  } catch (e) {
    console.error('[table-payment] Stripe create failed:', e?.message)
    return jsonResponse(502, {
      error: 'Plata nu a putut fi inițiată. Cere nota ospătarului.',
    })
  }

  // 3) Leagă intent-ul de rândul de plată (webhook-ul îl caută după intent id).
  const { error: attachErr } = await supabase.rpc('attach_payment_intent', {
    p_payment_id: begin.payment_id,
    p_intent_id: intent.id,
  })
  if (attachErr) {
    // Fără legătură, settle-ul n-ar găsi plata → anulăm intent-ul (best effort)
    // ca clientul să nu poată plăti într-un vid.
    console.error('[table-payment] attach failed:', attachErr.message)
    try {
      await stripe.paymentIntents.cancel(intent.id, { stripeAccount: begin.stripe_account_id })
    } catch (cancelErr) {
      console.error('[table-payment] cancel after attach-fail also failed:', cancelErr?.message)
    }
    return jsonResponse(500, { error: 'Plata nu a putut fi inițiată. Reîncearcă.' })
  }

  return jsonResponse(200, {
    payment_id: begin.payment_id,
    client_secret: intent.client_secret,
    publishable_key: STRIPE_PUBLISHABLE_KEY,
    stripe_account_id: begin.stripe_account_id,
    amount: begin.amount,
    currency: begin.currency,
  })
}
