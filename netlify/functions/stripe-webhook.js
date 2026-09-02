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

  if (
    !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY ||
    // Fara price-id-urile reale, PLAN_BY_PRICE ar mapa totul la 'free' si un update Stripe
    // ar downgrada tacut abonamentele platite → cerem si pe acestea (fail-fast).
    !STRIPE_STARTER_PRICE_ID || !STRIPE_GROWTH_PRICE_ID || !STRIPE_PRO_PRICE_ID || !STRIPE_ENTERPRISE_PRICE_ID
  ) {
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

  const stripe = new Stripe(STRIPE_SECRET_KEY, { timeout: 6000, maxNetworkRetries: 0 })
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
      //
      // ATOMIC (audit medium): SELECT-apoi-UPDATE avea o fereastră de race
      // între citirea statusului și marcarea 'processing' — două cereri
      // concurente puteau ambele citi 'failed' și ambele trece de gardă.
      // Un singur UPDATE condiționat (WHERE status <> 'completed') e atomic:
      // Postgres serializează rândul, deci doar UNA dintre cereri poate
      // tranziționa efectiv statusul; RETURNING ne spune dacă am câștigat cursa.
      const { data: reopened, error: reopenErr } = await supabase
        .from('stripe_events')
        .update({ status: 'processing', error_info: null })
        .eq('event_id', stripeEvent.id)
        .neq('status', 'completed')
        .select('status')

      if (reopenErr) {
        console.error('[stripe-webhook] Dedup reopen error:', reopenErr.message)
        return jsonResponse(500, { error: 'Dedup storage failed' })
      }

      if (!reopened || reopened.length === 0) {
        // Niciun rând actualizat → fie era deja 'completed', fie altă cerere
        // concurentă a câștigat cursa (oricum tratăm ca duplicat, sigur idempotent).
        console.log(`[stripe-webhook] Duplicate event ${stripeEvent.id} ignored (completed or already reprocessed)`)
        return jsonResponse(200, { received: true, duplicate: true })
      }

      console.log(`[stripe-webhook] Reprocessing event ${stripeEvent.id}`)
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

        // ── Top-up credite AI (plată unică, mode='payment') ───────────
        // Fulfilment idempotent per session.id (RPC mig 169) → un retry
        // Stripe nu poate dubla creditele. NU intră în logica de abonament.
        if (session.mode === 'payment' && session.metadata?.type === 'ai_credits') {
          const aiRestaurantId = session.metadata.restaurant_id
          const aiTokens = parseInt(session.metadata.tokens, 10)
          // Onorăm doar sesiunile plătite.
          if (session.payment_status !== 'paid') {
            console.warn(`[stripe-webhook] ai_credits session ${session.id} not paid (${session.payment_status})`)
            break
          }
          if (!aiRestaurantId || !Number.isFinite(aiTokens) || aiTokens <= 0) {
            throw new Error(`ai_credits: metadata invalidă (restaurant_id/tokens) pe ${session.id}`)
          }
          const { error: creditErr } = await supabase.rpc('ai_add_credits_for_event', {
            p_ref:           session.id,
            p_restaurant_id: aiRestaurantId,
            p_tokens:        aiTokens,
          })
          if (creditErr) {
            // Bani încasați dar credit neacordat → 500 ca Stripe să reia (idempotent pe ref).
            throw new Error(`ai_credits fulfilment failed: ${creditErr.message}`)
          }
          console.log(`[stripe-webhook] AI credits +${aiTokens} pentru restaurant ${aiRestaurantId} (${session.id})`)
          break
        }

        // Gardă POZITIVĂ: doar sesiunile de ABONAMENT ating profiles.plan.
        // Fără ea, orice sesiune mode='payment' ne-recunoscută ca ai_credits
        // (metadata.type absent/redenumit) ar cădea în logica de abonament cu
        // subscription=null → resolvePlan('free') → DOWNGRADE tăcut al unui
        // plătitor care tocmai a cumpărat credite AI (același client_reference_id).
        if (session.mode !== 'subscription') {
          console.warn(`[stripe-webhook] checkout.session.completed mode='${session.mode}' neabonament, ignorat (${session.id})`)
          break
        }

        const refUserId = session.client_reference_id
        const customerId = session.customer
        const subscriptionId = session.subscription

        if (!refUserId) throw new Error('No client_reference_id in session')
        userId = refUserId

        // Citește planul REAL din metadata subscription-ului (setat la
        // checkout). Fără asta, toate abonamentele deveneau 'pro' hardcodat.
        // resolvePlan aruncă la eroare Stripe (nu mai întoarce 'free' silențios,
        // audit HIGH) — prindem aici explicit ca să NU aplicăm niciun downgrade
        // pe un client care tocmai a plătit: lăsăm planul curent neschimbat și
        // logăm clar (best-effort alert dacă există un mecanism; altfel console.error).
        let finalPlan
        try {
          finalPlan = await resolvePlan(stripe, subscriptionId, PLAN_BY_PRICE)
        } catch (e) {
          // resolvePlan aruncă DOAR pe eroare Stripe tranzitorie (o subscripție
          // anulată real nu aruncă — retrieve întoarce status='canceled' →
          // resolvePlan fail-close 'free', audit v3 MF-07). Deci un throw = tranzitoriu:
          // marcăm processingError → 500 → Stripe RETRIMITE (backoff ~3 zile,
          // finit; update-ul de profil e idempotent). Înainte făceam `break`
          // (200, event 'completed') → clientul care tocmai a plătit rămânea pe
          // 'free' fără retry garantat (recovery depindea de un
          // customer.subscription.updated care poate să nu se declanșeze).
          // NU scriem niciun 'free' aici — planul curent rămâne neatins.
          processingError =
            `resolvePlan tranzitoriu eșuat pentru subscription ${subscriptionId} ` +
            `(user ${refUserId}): ${e?.message || String(e)}`
          console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
          break
        }

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
          .select('id, plan, stripe_subscription_id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (lookupErr || !profile) {
          throw new Error(`No profile for customer ${customerId}: ${lookupErr?.message}`)
        }
        userId = profile.id

        // Ignoră evenimentele unei subscriptii care NU e cea curentă a profilului (audit P2):
        // checkout creează mereu o subscriptie NOUĂ, iar una veche poate rămâne activă pe
        // același customer → un eveniment stale ar suprascrie planul (clobber). Dacă profilul
        // are deja o subscriptie setată și diferită, sărim (200, idempotent).
        if (profile.stripe_subscription_id && profile.stripe_subscription_id !== subscription.id) {
          console.log(`[stripe-webhook] Skip stale subscription ${subscription.id} (current: ${profile.stripe_subscription_id})`)
          break
        }

        // Plan real din price.id-ul FACTURAT (subscription.items), NU din metadata.plan
        // care ramane stale la downgrade (audit P1: gate-leak — un downgrade Plan 3→2/1 nu
        // retrograda gate-ul fiscal). Mapam prin PLAN_BY_PRICE; price nemapat → fail-closed 'free'.
        const subItems = subscription.items?.data || []
        const subPlanItems = subItems.filter((i) => i?.price?.id && PLAN_BY_PRICE[i.price.id])
        const subPlan = subPlanItems.length ? PLAN_BY_PRICE[subPlanItems[0].price.id] : 'free'
        // Grace în dunning: past_due ține abonamentul VIU la Stripe (reîncearcă plata) — nu
        // retrogradăm la 'free' (l-ar bloca + checkout-ul nou e respins 409 → utilizator captiv).
        // Downgrade real doar la status terminal (canceled/unpaid/incomplete_expired).
        const activePlan = ['active', 'trialing', 'past_due'].includes(status) ? subPlan : 'free'

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
          .select('id, stripe_subscription_id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (lookupErr || !profile) {
          console.warn(`[stripe-webhook] No profile for cancelled customer ${customerId}`)
          break
        }
        userId = profile.id

        // Nu retrograda la 'free' daca Stripe sterge o subscriptie VECHE (nu cea curenta):
        // checkout creeaza mereu una noua, iar una veche poate fi stearsa ulterior. (audit P2)
        if (profile.stripe_subscription_id && profile.stripe_subscription_id !== subscription.id) {
          console.log(`[stripe-webhook] Skip stale deleted subscription ${subscription.id} (current: ${profile.stripe_subscription_id})`)
          break
        }

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

        const { data: profile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (lookupErr) {
          // Distingem un eșec de infra (conexiune DB, timeout) de „profil
          // inexistent" (PGRST116 la .single() fără rezultat) — audit medium:
          // fără log aici, un eșec de DB pentru trial_will_end trecea neobservat
          // (notificarea de trial nu se trimite, dar nimeni nu află de ce).
          console.error(`[stripe-webhook] trial_will_end: lookup eșuat pentru customer ${customerId}:`, lookupErr.message)
        }

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

        const { data: profile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()
        // Fără log, un lookup eșuat (blip DB) făcea evenimentul să dispară TĂCUT:
        // fără email de dunning / fără lifecycle event, dar cu 200 spre Stripe
        // (deci fără retry). Acum eșecul e vizibil în loguri, ca la surorile lui.
        // PGRST116 = zero rânduri (profilul chiar nu există) → normal, ACK 200.
        // ORICE altă eroare = blip de infra: a răspunde 200 pierde evenimentul
        // DEFINITIV (Stripe nu-l mai retrimite) → fără email de dunning → churn
        // involuntar, exact ce previne bucla mig 180/216. Setăm processingError
        // → 500 → Stripe retrimite. Retry-ul e SIGUR: enqueue_email are dedup_key
        // stabil (on conflict do nothing), iar rândul stripe_events se redeschide.
        if (lookupErr && lookupErr.code !== 'PGRST116') {
          processingError = `${stripeEvent.type}: lookup profil eșuat (tranzitoriu) pentru customer ${customerId}: ${lookupErr.message}`
          console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
          break
        }
        if (lookupErr) {
          console.warn(
            `[stripe-webhook] ${stripeEvent.type}: profil inexistent pentru customer ${customerId}`
          )
        }

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

        const { data: profile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()
        // Fără log, un lookup eșuat (blip DB) făcea evenimentul să dispară TĂCUT:
        // fără email de dunning / fără lifecycle event, dar cu 200 spre Stripe
        // (deci fără retry). Acum eșecul e vizibil în loguri, ca la surorile lui.
        // PGRST116 = zero rânduri (profilul chiar nu există) → normal, ACK 200.
        // ORICE altă eroare = blip de infra: a răspunde 200 pierde evenimentul
        // DEFINITIV (Stripe nu-l mai retrimite) → fără email de dunning → churn
        // involuntar, exact ce previne bucla mig 180/216. Setăm processingError
        // → 500 → Stripe retrimite. Retry-ul e SIGUR: enqueue_email are dedup_key
        // stabil (on conflict do nothing), iar rândul stripe_events se redeschide.
        if (lookupErr && lookupErr.code !== 'PGRST116') {
          processingError = `${stripeEvent.type}: lookup profil eșuat (tranzitoriu) pentru customer ${customerId}: ${lookupErr.message}`
          console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
          break
        }
        if (lookupErr) {
          console.warn(
            `[stripe-webhook] ${stripeEvent.type}: profil inexistent pentru customer ${customerId}`
          )
        }

        if (profile) {
          userId = profile.id
          await safeInsertLifecycleEvent(supabase, profile.id, 'invoice_paid', {
            billing_reason:  billingReason,
            amount_paid:     invoice.amount_paid,
            currency:        invoice.currency,
            invoice_id:      invoice.id,
            subscription_id: invoice.subscription,
          })
          // Dunning — recuperare: attempt_count>1 ⇒ factura a eșuat cel puțin o
          // dată înainte să reușească (clientul a primit deja emailul alarmant
          // `payment_failed`). Închidem bucla cu emailul de reasigurare
          // `payment_recovered` (mig 216). Pe reușită din prima (attempt_count≤1)
          // NU emitem — altfel un email de „succes" la FIECARE ciclu recurent.
          if (invoice.attempt_count > 1) {
            await safeInsertLifecycleEvent(supabase, profile.id, 'payment_recovered', {
              amount:     invoice.amount_paid,
              currency:   invoice.currency,
              invoice_id: invoice.id,
              attempt:    invoice.attempt_count,
            })
          }
        } else {
          console.warn(`[stripe-webhook] invoice.paid: no profile for customer ${customerId}`)
        }

        // ── Afiliere: scrie comisionul (idempotent în RPC) ───────────────────
        // Doar facturi cu bani reali (trial → amount_paid=0 → RPC skip-uiește).
        // RPC-ul caută atribuirea după stripe_customer_id; dacă nu există
        // afiliere pe acest customer, întoarce skip curat. Un eșec al RPC-ului
        // NU mai e înghițit (audit aff-097b): înainte, rândul stripe_events
        // rămânea 'completed' → Stripe nu retrimitea → comision pierdut
        // silențios definitiv. Acum setăm processingError (exact pattern-ul de
        // la charge.refunded/charge.dispute.closed) → rândul devine 'failed' +
        // răspundem 500 → Stripe retrimite. Retry-ul e sigur: RPC-ul e
        // idempotent per (stripe_event_id, leg) (mig 097B), iar restul
        // case-ului (lifecycle event) e best-effort.
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
            // La EGALITATE de period.end (audit medium) preferăm explicit linia
            // cu amount pozitiv (charge-ul efectiv) față de o linie credit/reversal
            // cu același period.end — altfel reduce() păstra prima întâlnită
            // (posibil linia de credit), riscând un billedPlan/periodMonth greșit.
            const invoiceLines = invoice.lines?.data || []
            const planLines = invoiceLines.filter((l) => l?.price?.id && PLAN_BY_PRICE[l.price.id])
            const subPool = planLines.length
              ? planLines
              : invoiceLines.filter((l) => l?.type === 'subscription')
            const subLine = subPool.reduce((best, l) => {
              if (!best) return l
              const lEnd = l?.period?.end || 0
              const bestEnd = best?.period?.end || 0
              if (lEnd > bestEnd) return l
              if (lEnd === bestEnd && (l?.amount || 0) > (best?.amount || 0)) return l
              return best
            }, subPool[0] || null)
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
              // Un eșec de comision e o pierdere financiară reală pentru afiliat,
              // nu un „skip" normal → console.error + processingError (audit
              // aff-097b), ca la charge.refunded/charge.dispute.closed mai jos:
              // rândul stripe_events NU rămâne 'completed', Stripe retrimite.
              console.error(
                `[stripe-webhook] EROARE COMISION AFILIERE: process_affiliate_invoice_paid a eșuat ` +
                `pentru invoice ${invoice.id} (customer ${customerId}):`, commErr.message,
              )
              processingError = `affiliate commission failed: ${commErr.message}`
            }
          } catch (e) {
            console.error(
              `[stripe-webhook] EROARE COMISION AFILIERE: process_affiliate_invoice_paid a aruncat ` +
              `pentru invoice ${invoice.id} (customer ${customerId}):`, e?.message || e,
            )
            processingError = `affiliate commission threw: ${e?.message || String(e)}`
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
          // NU ne bazăm pe `charge.refunds.data` inline din payload: pe versiunile
          // API Stripe ≥ 2022-11-15 lista de refund-uri NU mai e expandată pe obiectul
          // Charge din webhook → ar fi `undefined` → bucla nu rula → clawback ratat
          // TĂCUT (scurgere de comision pe venit stornat). Luăm refund-urile explicit
          // via API (ca ramura de dispute care re-ia charge-ul). Idempotent pe
          // refund_id în RPC, deci reprocesarea la refund-uri parțiale succesive e no-op.
          const refundList = await stripe.refunds.list({ charge: charge.id, limit: 100 })
          const refunds = refundList?.data || []
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
          // Dispute-ul nu poartă invoice-ul direct → luăm charge-ul. Separăm
          // acest apel de restul try-ului (audit medium) ca să putem distinge
          // o eroare PERMANENTĂ (charge-ul chiar nu (mai) există — resource_missing
          // / 404 — necesită intervenție manuală, nu retry) de una TRANZITORIE
          // (blip de rețea/API — un retry Stripe poate reuși).
          let charge
          try {
            charge = await stripe.charges.retrieve(dispute.charge)
          } catch (e) {
            const isPermanent = e?.code === 'resource_missing' || e?.statusCode === 404
            if (isPermanent) {
              console.error(
                `[stripe-webhook] EROARE CRITICĂ (necesită intervenție manuală): charge ${dispute.charge} ` +
                `nu există (dispute ${dispute.id}, resource_missing/404):`, e?.message,
              )
              processingError = `dispute clawback: charge ${dispute.charge} inexistent (permanent): ${e?.message || String(e)}`
            } else {
              console.error(
                `[stripe-webhook] eroare tranzitorie la stripe.charges.retrieve pentru dispute ${dispute.id} ` +
                `(charge ${dispute.charge}) — retry posibil:`, e?.message,
              )
              processingError = `dispute clawback: charges.retrieve tranzitoriu eșuat: ${e?.message || String(e)}`
            }
            break
          }
          try {
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
// Citește metadata.plan setat la checkout. Fail-CLOSED la 'free' doar dacă
// subscription-ul chiar lipsește/nu are metadata (audit HIGH). O eroare
// Stripe (ex. timeout tranzitoriu de rețea) NU înseamnă „plan free" —
// înseamnă „nu știm" → aruncăm mai departe ca apelantul să NU aplice niciun
// downgrade pe un client care a plătit efectiv (ar fi un downgrade greșit
// cauzat de o eroare de infra, nu de starea reală a abonamentului).
async function resolvePlan(stripe, subscriptionId, planByPrice = {}) {
  if (!subscriptionId) return 'free'
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  // ★ audit v3 (MF-07): un abonament deja TERMINAL la momentul livrării
  // evenimentului NU acordă plan plătit. Cazul real: webhook mort >3 zile
  // (env Netlify șters), founder-ul retrimite din Stripe Dashboard
  // checkout.session.completed → între timp abonamentul s-a anulat; un
  // abonament canceled nu mai emite niciun eveniment, deci planul ar fi rămas
  // 'pro' pe termen nelimitat. Aceeași listă de statusuri VII ca la
  // customer.subscription.updated (past_due = grace de dunning, nu downgrade).
  if (!['active', 'trialing', 'past_due'].includes(sub.status)) return 'free'
  // Planul din price.id-ul FACTURAT are prioritate (sursa de adevăr folosită
  // și de subscription.updated); metadata.plan rămâne fallback pentru
  // abonamentele fără price mapat (fail-closed prin normalizePlan).
  const items = sub.items?.data || []
  const priced = items.find((i) => i?.price?.id && planByPrice[i.price.id])
  if (priced) return planByPrice[priced.price.id]
  return normalizePlan(sub.metadata?.plan)
}

// ── Helper: best-effort lifecycle event insert ────────────────────
async function safeInsertLifecycleEvent(supabase, userId, eventType, data) {
  try {
    // supabase-js NU aruncă la eroare DB pe insert — întoarce { error } în
    // rezultat. Fără verificare explicită (audit medium), un eșec de insert
    // (ex. constraint/RLS/coloană lipsă) era înghițit silențios de catch-ul
    // gol (care nu se declanșa niciodată pentru erori „soft"). Logăm explicit.
    const { error } = await supabase.from('lifecycle_events').insert({
      user_id:    userId,
      event_type: eventType,
      event_data: data,
    })
    if (error) {
      console.error(`[stripe-webhook] Lifecycle event insert failed (${eventType}):`, error.message)
    }
  } catch (e) {
    console.warn(`[stripe-webhook] Lifecycle event insert threw (${eventType}):`, e.message)
  }
}
