// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events for subscription lifecycle.
//
// FIX SEC-001: Netlify passes body as base64 when content-type is not text.
//   Stripe signature is computed over raw bytes. Must decode base64 → utf8
//   BEFORE passing to constructEvent.
//
// FIX SEC-003: Idempotency via stripe_events table (event_id PK).
//   Stripe retries failed webhooks. Without dedup, user could be upgraded
//   multiple times, or worse, downgraded → upgraded → downgraded.
//   Also: return 500 on DB errors so Stripe retries (instead of 200 → lost).

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// SEC-001: extract raw body bytes correctly for signature verification
function getRawBody(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8')
  }
  return event.body
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[stripe-webhook] Missing env vars')
    return jsonResponse(500, { error: 'Server config error' })
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY)
  const sig = event.headers['stripe-signature']
  const rawBody = getRawBody(event)

  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message)
    return jsonResponse(400, { error: 'Invalid signature' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── SEC-003: idempotency dedup ─────────────────────────────────
  const { error: dedupErr } = await supabase
    .from('stripe_events')
    .insert({
      event_id:   stripeEvent.id,
      event_type: stripeEvent.type,
      payload:    stripeEvent.data?.object || null,
      status:     'processing',
    })

  if (dedupErr) {
    if (dedupErr.code === '23505') {
      console.log(`[stripe-webhook] Duplicate event ${stripeEvent.id} ignored`)
      return jsonResponse(200, { received: true, duplicate: true })
    }
    console.error('[stripe-webhook] Dedup table error:', dedupErr.message)
    return jsonResponse(500, { error: 'Dedup storage failed' })
  }

  // ── Process event ──────────────────────────────────────────────
  let userId = null
  let processingError = null

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object
        const refUserId = session.client_reference_id
        const customerId = session.customer
        const subscriptionId = session.subscription

        if (!refUserId) throw new Error('No client_reference_id in session')
        userId = refUserId

        // Citește planul REAL din metadata subscription-ului (setat la
        // checkout). Fără asta, toate abonamentele deveneau 'pro' hardcodat.
        const finalPlan = await resolvePlan(stripe, subscriptionId)

        const { error } = await supabase
          .from('profiles')
          .update({
            plan: finalPlan,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq('id', refUserId)

        if (error) throw new Error(`Profile update failed: ${error.message}`)

        await safeInsertLifecycleEvent(supabase, refUserId, 'subscription_started', {
          plan: finalPlan, subscription_id: subscriptionId,
        })

        console.log(`[stripe-webhook] User ${refUserId} upgraded to ${finalPlan}`)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object
        const customerId = subscription.customer
        const status = subscription.status

        const { data: profile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id, plan')
          .eq('stripe_customer_id', customerId)
          .single()

        if (lookupErr || !profile) {
          throw new Error(`No profile for customer ${customerId}: ${lookupErr?.message}`)
        }
        userId = profile.id

        // Plan real din metadata (active/trialing); altfel downgrade la free.
        const subPlan = normalizePlan(subscription.metadata?.plan)
        const activePlan = ['active', 'trialing'].includes(status) ? subPlan : 'free'

        const { error } = await supabase
          .from('profiles')
          .update({
            plan: activePlan,
            stripe_subscription_id: subscription.id,
          })
          .eq('id', profile.id)

        if (error) throw new Error(`Subscription update failed: ${error.message}`)

        if (profile.plan !== activePlan) {
          await safeInsertLifecycleEvent(supabase, profile.id, 'plan_changed', {
            from: profile.plan, to: activePlan, status,
          })
        }

        console.log(`[stripe-webhook] User ${profile.id} plan set to ${activePlan} (status: ${status})`)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object
        const customerId = subscription.customer

        const { data: profile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (lookupErr || !profile) {
          console.warn(`[stripe-webhook] No profile for cancelled customer ${customerId}`)
          break
        }
        userId = profile.id

        const { error } = await supabase
          .from('profiles')
          .update({
            plan: 'free',
            stripe_subscription_id: null,
          })
          .eq('id', profile.id)

        if (error) throw new Error(`Downgrade failed: ${error.message}`)

        await safeInsertLifecycleEvent(supabase, profile.id, 'subscription_cancelled', {})

        console.log(`[stripe-webhook] User ${profile.id} downgraded to free`)
        break
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = stripeEvent.data.object
        const customerId = subscription.customer

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          userId = profile.id
          await safeInsertLifecycleEvent(supabase, profile.id, 'trial_ending_soon', {
            ends_at: subscription.trial_end,
          })
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object
        const customerId = invoice.customer

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          userId = profile.id
          await safeInsertLifecycleEvent(supabase, profile.id, 'payment_failed', {
            amount: invoice.amount_due,
            attempt: invoice.attempt_count,
          })
        }
        break
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${stripeEvent.type}`)
        break
    }
  } catch (err) {
    processingError = err.message || String(err)
    console.error('[stripe-webhook] Handler error:', processingError)
  }

  // ── Finalize stripe_events row ─────────────────────────────────
  if (processingError) {
    // Delete failed row so Stripe retry can re-process cleanly
    await supabase.from('stripe_events').delete().eq('event_id', stripeEvent.id)
    return jsonResponse(500, { error: 'Processing failed', detail: processingError })
  }

  await supabase
    .from('stripe_events')
    .update({
      status:       'completed',
      user_id:      userId,
      completed_at: new Date().toISOString(),
    })
    .eq('event_id', stripeEvent.id)

  return jsonResponse(200, { received: true })
}

// ── Helper: normalize plan string to canonical paid tier ──────────
// Acceptă doar planurile plătite valide; orice altceva → 'pro' (safe default
// pentru un abonament activ — nu lăsăm un plan necunoscut să devină 'free').
const VALID_PAID_PLANS = ['starter', 'growth', 'pro', 'enterprise']
function normalizePlan(plan) {
  const p = String(plan || '').toLowerCase()
  return VALID_PAID_PLANS.includes(p) ? p : 'pro'
}

// ── Helper: resolve plan from subscription metadata ────────────────
// Citește metadata.plan setat la checkout. Fallback 'pro' dacă lipsește.
async function resolvePlan(stripe, subscriptionId) {
  if (!subscriptionId) return 'pro'
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    return normalizePlan(sub.metadata?.plan)
  } catch (e) {
    console.warn('[stripe-webhook] resolvePlan failed, defaulting pro:', e.message)
    return 'pro'
  }
}

// ── Helper: best-effort lifecycle event insert ────────────────────
async function safeInsertLifecycleEvent(supabase, userId, eventType, data) {
  try {
    await supabase.from('lifecycle_events').insert({
      user_id:    userId,
      event_type: eventType,
      event_data: data,
    })
  } catch (e) {
    console.warn(`[stripe-webhook] Lifecycle event insert failed (${eventType}):`, e.message)
  }
}
