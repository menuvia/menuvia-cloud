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

  const {
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID,
    STRIPE_PRO_PRICE_ID, STRIPE_ENTERPRISE_PRICE_ID,
  } = process.env

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[stripe-webhook] Missing env vars')
    return jsonResponse(500, { error: 'Server config error' })
  }

  // Mapă price_id → plan canonic, oglindind PRICE_IDS din stripe-checkout.js.
  // Pentru gating-ul comisionului de afiliere folosim price.id (sursa de adevăr
  // a ce s-a FACTURAT efectiv), NU subscription.metadata.plan (care rămâne stale
  // la downgrade). Astfel comisionul se oprește automat la downgrade din Plan 3.
  const PLAN_BY_PRICE = {
    [STRIPE_STARTER_PRICE_ID]: 'starter',
    [STRIPE_GROWTH_PRICE_ID]: 'growth',
    [STRIPE_PRO_PRICE_ID]: 'pro',
    [STRIPE_ENTERPRISE_PRICE_ID]: 'enterprise',
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
  // Persistăm `data` ÎNTREG (object + previous_attributes), nu doar
  // `data.object`. Pentru subscription.updated, `previous_attributes` e
  // singura sursă a tranziției de plan (ex. Plan 3 → Plan 2) — necesară
  // pentru reconstrucția corectă a comisioanelor de afiliere downstream.
  const { error: dedupErr } = await supabase
    .from('stripe_events')
    .insert({
      event_id:   stripeEvent.id,
      event_type: stripeEvent.type,
      payload:    stripeEvent.data || null,
      status:     'processing',
    })

  if (dedupErr) {
    if (dedupErr.code === '23505') {
      // event_id deja există. Distingem un duplicat REAL (deja procesat cu
      // succes) de o reprocesare legitimă cerută de Stripe după un 500
      // (rândul a rămas 'failed'). Vechiul cod ștergea rândul pe eroare ca
      // să permită retry; acum păstrăm rândul ca ancoră durabilă de
      // idempotență și deblocăm reprocesarea doar pentru stările ne-finale.
      const { data: existing } = await supabase
        .from('stripe_events')
        .select('status')
        .eq('event_id', stripeEvent.id)
        .single()

      if (existing?.status === 'completed') {
        console.log(`[stripe-webhook] Duplicate event ${stripeEvent.id} ignored (completed)`)
        return jsonResponse(200, { received: true, duplicate: true })
      }

      // status 'failed' / 'processing' / 'received' → retry Stripe: redeschidem
      // pentru reprocesare. Efectele financiare downstream trebuie să fie
      // idempotente per-efect (ON CONFLICT), nu să se bazeze pe acest rând.
      await supabase
        .from('stripe_events')
        .update({ status: 'processing', error_info: null })
        .eq('event_id', stripeEvent.id)
      console.log(`[stripe-webhook] Reprocessing event ${stripeEvent.id} (prev status: ${existing?.status})`)
    } else {
      console.error('[stripe-webhook] Dedup table error:', dedupErr.message)
      return jsonResponse(500, { error: 'Dedup storage failed' })
    }
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

        // Plan real din price.id-ul FACTURAT (subscription.items), NU din metadata.plan
        // care ramane stale la downgrade (audit P1: gate-leak — un downgrade Plan 3→2/1 nu
        // retrograda gate-ul fiscal). Mapam prin PLAN_BY_PRICE; price nemapat → fail-closed 'free'.
        const subItems = subscription.items?.data || []
        const subPlanItems = subItems.filter((i) => i?.price?.id && PLAN_BY_PRICE[i.price.id])
        const subPlan = subPlanItems.length ? PLAN_BY_PRICE[subPlanItems[0].price.id] : 'free'
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

      case 'invoice.paid': {
        // Sursa canonică de „bani efectiv încasați" — temelia comisioanelor
        // de afiliere (setup la prima factură, recurring la cicluri).
        const invoice = stripeEvent.data.object
        const customerId = invoice.customer
        // billing_reason distinge prima factură (subscription_create) de
        // ciclurile recurente (subscription_cycle) și de prorations.
        const billingReason = invoice.billing_reason || null

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          userId = profile.id
          await safeInsertLifecycleEvent(supabase, profile.id, 'invoice_paid', {
            billing_reason:  billingReason,
            amount_paid:     invoice.amount_paid,
            currency:        invoice.currency,
            invoice_id:      invoice.id,
            subscription_id: invoice.subscription,
          })
        } else {
          console.warn(`[stripe-webhook] invoice.paid: no profile for customer ${customerId}`)
        }

        // ── Afiliere: scrie comisionul (best-effort, idempotent în RPC) ──────
        // Doar facturi cu bani reali (trial → amount_paid=0 → RPC skip-uiește).
        // RPC-ul caută atribuirea după stripe_customer_id; dacă nu există
        // afiliere pe acest customer, întoarce skip curat. NU aruncăm dacă
        // eșuază — comisionul nu trebuie să rupă procesarea facturii.
        if (invoice.amount_paid > 0) {
          try {
            // period_month = prima zi a lunii perioadei facturate (pentru cap-ul
            // de 12 luni). Preferăm perioada liniei de subscription; fallback la
            // period_start al facturii.
            // Selectează linia de subscription EXPLICIT — NU presupune data[0].
            // La facturi cu proration/discount/multi-line, data[0] poate fi o
            // linie de credit cu price.id-ul vechiului plan → plan/perioadă
            // greșite (comision pierdut la upgrade, gate Plan 3 incorect).
            // Preferăm linia cu price.id ∈ PLAN_BY_PRICE și cel mai mare
            // period.end; fallback la liniile type==='subscription'.
            const invoiceLines = invoice.lines?.data || []
            const planLines = invoiceLines.filter((l) => l?.price?.id && PLAN_BY_PRICE[l.price.id])
            const subPool = planLines.length
              ? planLines
              : invoiceLines.filter((l) => l?.type === 'subscription')
            const subLine = subPool.reduce(
              (best, l) => ((l?.period?.end || 0) > (best?.period?.end || 0) ? l : best),
              subPool[0] || null,
            )
            const periodStartUnix = subLine?.period?.start || invoice.period_start || null
            let periodMonth = null
            if (periodStartUnix) {
              const d = new Date(periodStartUnix * 1000)
              periodMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
            }
            // Planul EFECTIV facturat din price.id (downgrade-safe). null →
            // RPC-ul refuză comisionul (fail-closed pe Plan 3).
            const billedPriceId = subLine?.price?.id || null
            const billedPlan = PLAN_BY_PRICE[billedPriceId] || null
            const { error: commErr } = await supabase.rpc('process_affiliate_invoice_paid', {
              p_event_id:               stripeEvent.id,
              p_stripe_customer_id:     customerId,
              p_stripe_subscription_id: invoice.subscription || null,
              p_stripe_invoice_id:      invoice.id,
              p_billing_reason:         billingReason,
              p_amount_paid_cents:      invoice.amount_paid,
              p_currency:               (invoice.currency || 'ron').toUpperCase(),
              p_period_month:           periodMonth,
              p_event_created_at:       new Date(stripeEvent.created * 1000).toISOString(),
              p_plan:                   billedPlan,
            })
            if (commErr) {
              console.warn('[stripe-webhook] affiliate commission failed:', commErr.message)
            }
          } catch (e) {
            console.warn('[stripe-webhook] affiliate commission threw:', e?.message)
          }
        }
        break
      }

      case 'charge.refunded': {
        // Afiliere: clawback proporțional al comisionului pe factura refundată.
        // Per refund.id (idempotent în RPC). Spre deosebire de comision (best-
        // effort), clawback-ul RECUPEREAZĂ bani → un eșec NU trebuie înghițit:
        // setăm processingError → 500 → Stripe retrimite (retry e sigur,
        // idempotent pe refund_id), altfel comisionul pe venit stornat rămâne.
        const charge = stripeEvent.data.object
        try {
          const refunds = charge.refunds?.data || []
          for (const r of refunds) {
            const { error: clawErr } = await supabase.rpc('process_affiliate_refund', {
              p_event_id:            stripeEvent.id,
              p_stripe_invoice_id:   charge.invoice || null,
              p_charge_amount_cents: charge.amount,
              p_refund_id:           r.id,
              p_refund_amount_cents: r.amount,
              p_event_created_at:    new Date(stripeEvent.created * 1000).toISOString(),
            })
            if (clawErr) {
              console.error('[stripe-webhook] affiliate clawback failed:', clawErr.message)
              processingError = `affiliate clawback failed: ${clawErr.message}`
            }
          }
        } catch (e) {
          console.error('[stripe-webhook] affiliate clawback threw:', e?.message)
          processingError = `affiliate clawback threw: ${e?.message || String(e)}`
        }
        break
      }

      case 'charge.dispute.closed': {
        // Dispute PIERDUTĂ = clawback total (ca un refund). Câștigată = no-op
        // (comisionul rămâne; pe durata disputei payout-ul e manual + în hold).
        const dispute = stripeEvent.data.object
        if (dispute.status === 'lost') {
          try {
            // Dispute-ul nu poartă invoice-ul direct → luăm charge-ul.
            const charge = await stripe.charges.retrieve(dispute.charge)
            const { error: clawErr } = await supabase.rpc('process_affiliate_refund', {
              p_event_id:            stripeEvent.id,
              p_stripe_invoice_id:   charge.invoice || null,
              p_charge_amount_cents: charge.amount,
              p_refund_id:           `dispute_${dispute.id}`, // cheie idempotentă stabilă
              p_refund_amount_cents: charge.amount,            // dispute pierdută = total
              p_event_created_at:    new Date(stripeEvent.created * 1000).toISOString(),
            })
            if (clawErr) {
              console.error('[stripe-webhook] dispute clawback failed:', clawErr.message)
              processingError = `dispute clawback failed: ${clawErr.message}`
            }
          } catch (e) {
            // Inclusiv eșecul stripe.charges.retrieve (blip API) → retry, nu pierdem clawback-ul.
            console.error('[stripe-webhook] dispute clawback threw:', e?.message)
            processingError = `dispute clawback threw: ${e?.message || String(e)}`
          }
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
    // NU ștergem rândul (vechiul comportament): ștergerea distrugea singura
    // sursă durabilă de idempotență, iar orice efect parțial deja scris
    // (ex. un viitor ledger de comisioane) s-ar fi redublat la retry.
    // În schimb marcăm 'failed' + error_info și răspundem 500: Stripe
    // retrimite, dar dedup-ul pe event_id rămâne ancora durabilă —
    // procesarea idempotentă se face per-efect (ON CONFLICT), nu prin
    // ștergerea rândului de dedup.
    await supabase
      .from('stripe_events')
      .update({ status: 'failed', error_info: processingError })
      .eq('event_id', stripeEvent.id)
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
// FAIL-CLOSED (audit P1): un plan necunoscut/lipsă → 'free', NU 'pro'. Altfel orice
// valoare nemapată ar fi acordat Plan 3 (fiscalizare) gratuit — gate-leak. Planul
// real se derivă oricum din price.id facturat, nu din string-uri arbitrare.
const VALID_PAID_PLANS = ['starter', 'growth', 'pro', 'enterprise']
function normalizePlan(plan) {
  const p = String(plan || '').toLowerCase()
  return VALID_PAID_PLANS.includes(p) ? p : 'free'
}

// ── Helper: resolve plan from subscription metadata ────────────────
// Citește metadata.plan setat la checkout. Fail-CLOSED la 'free' dacă lipsește/eșuează.
async function resolvePlan(stripe, subscriptionId) {
  if (!subscriptionId) return 'free'
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    return normalizePlan(sub.metadata?.plan)
  } catch (e) {
    console.warn('[stripe-webhook] resolvePlan failed, defaulting free:', e.message)
    return 'free'
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
