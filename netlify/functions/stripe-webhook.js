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
const { livemodeGuard } = require('./lib/livemode')
// Versiunea de API PINUITĂ (audit v3 OPS-8) pentru CERERILE noastre către Stripe:
// fără pin, un bump de SDK schimbă tăcut forma răspunsurilor pe care le citim
// (subscriptions.list, checkout sessions…). NU acoperă evenimentele de WEBHOOK:
// versiunea lor e setată per endpoint în Stripe Dashboard (act de fondator, A9)
// și trebuie ținută egală cu aceasta. Se schimbă DELIBERAT, cu
// tests/stripe-contract/ verzi — suita care încarcă SDK-ul REAL; tests/functions/
// înlocuiește modulul 'stripe' cu totul și e oarbă la un bump de SDK.
// Implicitul SDK-ului se mută la fiecare versiune majoră (v22:
// '2026-08-26.dahlia', v23: '2026-09-30.endive'), deci pin-ul poartă greutate
// reală: fără el, cererile ar trece TĂCUT pe implicitul SDK-ului instalat.
const STRIPE_API_VERSION = '2023-10-16'

// ── Citiri tolerante la forma payload-ului de webhook ───────────────
// Forma evenimentelor o decide versiunea ENDPOINT-ului din Stripe, nu SDK-ul
// și nu pin-ul de mai sus. Un cont Stripe NOU pornește pe versiunea curentă,
// iar între '2023-10-16' și dahlia exact patru citiri de aici s-au mutat
// (basil, 2025-03-31): price-ul liniei de factură, tipul liniei, abonamentul
// facturii și factura charge-ului. Fără citirile duble, un endpoint creat pe
// versiunea implicită ar sări TĂCUT comisioanele și clawback-urile de afiliere
// (RPC-urile întorc skip pe plan/factură null, evenimentul se marchează
// 'completed', iar Job 8 din automation-cron citește doar rândurile 'failed').
const refId = (x) => (typeof x === 'string' ? x : x && x.id) || null
function linePriceId(l) {
  if (l && l.price && l.price.id) return l.price.id
  const p = l && l.pricing && l.pricing.price_details && l.pricing.price_details.price
  return refId(p)
}
function isSubscriptionLine(l) {
  return !!l && (l.type === 'subscription' || (l.parent && l.parent.type === 'subscription_item_details'))
}
function invoiceSubscriptionId(inv) {
  if (!inv) return null
  return refId(inv.subscription) ||
    refId(inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription)
}

// ── Abonament unic la finalizare (lotul #61) ────────────────────────
// Stările în care un abonament ține planul VIU: aceeași listă ca resolvePlan și
// customer.subscription.updated (past_due = grace de dunning, nu downgrade).
const LIVE_SUB_STATUSES = ['active', 'trialing', 'past_due']
// Stările din care un abonament încă POATE factura: cele vii + `unpaid`
// (factura rămâne deschisă și se poate plăti) + `incomplete` (prima plată se
// mai poate confirma ~23 h). Oglinda `hasLive` din stripe-checkout.js. Decide
// dacă un abonament NOU, găsit lângă altul viu, trebuie ANULAT: unul lăsat în
// aceste stări fără să-l mai urmărească profilul ar putea începe să încaseze.
const BILLABLE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']
// Id-ul ajunge într-un filtru PostgREST `or(...)`, unde virgula, punctul,
// două-punctele, parantezele și ghilimelele sunt sintaxă: intră doar forma Stripe
// (`sub_` + alfanumerice; `_` e acceptat, nu e sintaxă PostgREST).
const SUB_ID_RE = /^sub_[A-Za-z0-9_]{1,250}$/
const isSubscriptionId = (x) => typeof x === 'string' && SUB_ID_RE.test(x)
// Profilul e LIBER sau ține deja ACEST abonament (relivrare) — ceea ce un
// singur UPDATE decide sub lacătul rândului.
const freeOrSameSubscription = (subId) =>
  `stripe_subscription_id.is.null,stripe_subscription_id.eq.${subId}`
// Urma pusă pe duplicatul anulat (cancellation_details.comment, persistă pe
// abonamentul anulat). La o reluare după un 500, abonamentul NOU e deja
// `canceled`; fără urmă n-am distinge „l-am anulat noi ca duplicat, mai e de
// rambursat” de un replay al unui abonament vechi încheiat legitim.
const DUPLICATE_CANCEL_MARKER = 'menuvia:duplicate_subscription'
const CLAIM_ATTEMPTS = 3
// Rambursarea dublurii poartă `metadata.menuvia_reason` = această valoare (plus
// abonamentul și factura): singurul mod de a recunoaște, într-un
// `charge.refund.updated`, o rambursare pornită de NOI — cheia de idempotență nu
// apare pe obiectul Refund.
const DUPLICATE_REFUND_REASON = 'duplicate_subscription'
// Câte rambursări EȘUATE (pe un motiv reîncercabil, mai jos) pe aceeași plată
// acceptăm înainte de a preda omului: fiecare reîncercare e o rambursare nouă
// (cheie nouă), iar o metodă de plată care nu poate primi bani înapoi ar eșua la
// nesfârșit.
const DUPLICATE_REFUND_MAX_ATTEMPTS = 3
// Motivele de eșec după care o rambursare NOUĂ pe aceeași plată e reîncercată
// automat (recenzie pe #386, R1). Orice altceva e FINAL și trece la om, fără
// nicio rambursare nouă: `canceled` = o anulare făcută de un OM (codul nostru
// nu apelează refunds.cancel, o rambursare pe card se anulează doar din
// Dashboard, iar un `requires_action` neonorat devine `failed`, nu `canceled` —
// docs.stripe.com/refunds), iar pentru `merchant_request`,
// `expired_or_canceled_card`, `lost_or_stolen_card` și
// `charge_for_pending_refund_disputed` Stripe cere altă cale de restituire, pe
// care fondatorul, avertizat de ALERT, o poate porni deja — o reîncercare
// automată ar putea plăti a doua oară. Un motiv pe care nu-l cunoaștem (adăugat
// de Stripe ulterior) e tot final: fail-closed pe bani. Un `failed` fără motiv
// e tratat ca `unknown` (categoria de rezervă a Stripe; nu poartă semnul unei
// decizii umane).
const RETRYABLE_REFUND_FAILURES = ['unknown', 'declined', 'insufficient_funds']
// null = rambursarea nu e moartă (succeeded/pending/requires_action/necunoscut);
// 'retryable' / 'final' după regula de mai sus.
function deadRefundKind(r) {
  if (!r) return null
  if (r.status === 'canceled') return 'final'
  if (r.status !== 'failed') return null
  return RETRYABLE_REFUND_FAILURES.includes(r.failure_reason || 'unknown') ? 'retryable' : 'final'
}
const INVOICE_ID_RE = /^in_[A-Za-z0-9_]{1,250}$/

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

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 })
  const sig = event.headers['stripe-signature']
  const rawBody = getRawBody(event)

  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    // `type` distinge o semnătură greșită (StripeSignatureVerificationError) de
    // un payload pe care SDK-ul îl refuză din alt motiv — ex. un endpoint creat
    // cu payload „thin" (v2), pe care stripe-node 22 îl respinge cu Error simplu.
    console.error('[stripe-webhook] Signature verification failed:', (err && err.type) || 'Error', err && err.message)
    return jsonResponse(400, { error: 'Invalid signature' })
  }

  // Gardă livemode (lib/livemode.js): cheia TEST nu are voie să proceseze evenimente
  // live și invers. DUPĂ semnătură, ÎNAINTE de orice efect (DB/email/Stripe/RPC).
  const modeBlock = livemodeGuard(stripeEvent, STRIPE_SECRET_KEY, '[stripe-webhook]')
  if (modeBlock) return modeBlock

  // Versiunea endpoint-ului ≠ pin-ul: citirile de mai jos sunt tolerante la
  // ambele forme cunoscute, dar o nepotrivire trebuie să se VADĂ — endpoint-ul
  // se recreează pe pin (versiunea nu se poate schimba pe un endpoint existent).
  if (stripeEvent.api_version && stripeEvent.api_version !== STRIPE_API_VERSION) {
    console.error(
      `[stripe-webhook] ALERT api_version mismatch endpoint=${stripeEvent.api_version} ` +
      `pin=${STRIPE_API_VERSION} event=${stripeEvent.id} type=${stripeEvent.type}`,
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── SEC-003: idempotency dedup ─────────────────────────────────
  // Persistăm `data` ÎNTREG (object + previous_attributes), nu doar
  // `data.object`. Pentru subscription.updated, `previous_attributes` e
  // singura sursă a tranziției de plan (ex. Plan 3 → Plan 2) — necesară
  // pentru reconstrucția corectă a comisioanelor de afiliere downstream.
  // `reprocessing` = rândul exista și a fost redeschis (Stripe retrimite după un
  // 500). Unele verificări se fac DOAR atunci, ca să nu coste nimic pe calea
  // obișnuită (vezi customer.subscription.updated).
  let reprocessing = false
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

      reprocessing = true
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
        // subscription=null — înainte resolvePlan('free') → DOWNGRADE tăcut al
        // unui plătitor care tocmai a cumpărat credite AI (același
        // client_reference_id); azi validarea abonamentului de mai jos ar da 500
        // la nesfârșit pe o plată reușită.
        if (session.mode !== 'subscription') {
          console.warn(`[stripe-webhook] checkout.session.completed mode='${session.mode}' neabonament, ignorat (${session.id})`)
          break
        }

        const refUserId = session.client_reference_id
        const customerId = session.customer
        const subscriptionId = refId(session.subscription)

        if (!refUserId) throw new Error('No client_reference_id in session')
        userId = refUserId

        // O sesiune de ABONAMENT finalizată poartă mereu abonamentul. Lipsa lui
        // (sau o formă necunoscută) e o formă de payload pe care n-o știm citi:
        // 500 → Stripe retrimite, rândul rămâne 'failed', vizibil. Înainte se
        // scria planul 'free' cu stripe_subscription_id NULL — profilul pierdea
        // abonamentul pe care îl urmărea.
        if (!isSubscriptionId(subscriptionId)) {
          throw new Error(`checkout ${session.id || '?'}: abonament lipsă sau cu formă necunoscută`)
        }

        // Citește planul REAL din metadata subscription-ului (setat la
        // checkout). Fără asta, toate abonamentele deveneau 'pro' hardcodat.
        // resolvePlan aruncă la eroare Stripe (nu mai întoarce 'free' silențios,
        // audit HIGH) — prindem aici explicit ca să NU aplicăm niciun downgrade
        // pe un client care tocmai a plătit: lăsăm planul curent neschimbat și
        // logăm clar (best-effort alert dacă există un mecanism; altfel console.error).
        let finalPlan
        let subscription
        try {
          ({ plan: finalPlan, subscription } = await resolvePlan(stripe, subscriptionId, PLAN_BY_PRICE))
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

        // ★ Abonament UNIC la finalizare (lotul #61). Mai multe sesiuni Checkout
        // pot ajunge să fie finalizate pentru același cont: chei de idempotență
        // diferite (prefix schimbat la un deploy, granița ferestrei de 30 min,
        // alt cod de afiliere, două planuri în două taburi) sau două cereri
        // simultane care trec AMÂNDOUĂ de verificarea `subscription_exists`
        // înainte ca vreuna să existe. Rezultatul ar fi DOUĂ abonamente vii,
        // facturate amândouă. Înainte, al doilea checkout suprascria
        // necondiționat `stripe_subscription_id`, iar primul rămânea viu și
        // facturat fără ca aplicația să-l mai urmărească (updated/deleted îl sar
        // ca „stale”). Decizia e acum în DATE, nu într-o citire: vezi
        // claimProfileSubscription. Tot acolo stă și vechiul anti-clobber pe
        // replay (abonament vechi deja terminal → nu suprascrie unul mai nou).
        const claim = await claimProfileSubscription(supabase, stripe, {
          userId: refUserId,
          customerId,
          subscriptionId,
          subscription,
          plan: finalPlan,
          menuvia: isMenuviaPlanSubscription(subscription, refUserId, PLAN_BY_PRICE),
        })

        if (claim.outcome === 'no_profile') {
          console.warn(`[stripe-webhook] checkout ${session.id || '?'}: profil inexistent pentru user ${refUserId} (abonament ${subscriptionId})`)
          break
        }
        if (claim.outcome === 'stale') {
          console.log(`[stripe-webhook] Skip stale checkout for terminal subscription ${subscriptionId} (current: ${claim.current})`)
          break
        }
        if (claim.outcome === 'foreign') {
          // Profilul ține deja un abonament, iar acesta NU e un abonament de plan
          // Menuvia (nici metadata `supabase_user_id` a contului, nici un price din
          // PLAN_BY_PRICE): nu-l anulăm și nu-l rambursăm — poate fi al altui
          // produs pe același cont Stripe (docs/ECOSISTEM.md §4). Profilul rămâne
          // neatins, ca înaintea lotului #61; omul decide din ALERT.
          console.error(
            `[stripe-webhook] ALERT foreign subscription user=${refUserId} ` +
            `current=${claim.current || '?'} subscription=${subscriptionId} status=${subscription.status} — ` +
            'nu e abonament de plan Menuvia, neatins',
          )
          break
        }
        if (claim.outcome === 'duplicate') {
          // Primul abonament înregistrat RĂMÂNE, al doilea se anulează (și se
          // rambursează dacă a încasat). De ce primul: stripe-checkout refuză cu
          // `subscription_exists` orice checkout nou cât există un abonament viu,
          // iar schimbarea de plan se face din Portalul de facturare, pe ACELAȘI
          // abonament — deci un al doilea abonament viu e mereu un accident de
          // cursă, nu o intenție. „Primul” e decis de UPDATE-ul condiționat din
          // claimProfileSubscription (lacătul rândului), deci e determinist și
          // coincide cu ce arată deja aplicația; profilul NU se atinge, fără
          // subscription_started.
          // Alarma pleacă ÎNAINTEA apelurilor Stripe: dacă anularea sau
          // rambursarea pică (500 → reluare), dublura rămâne vizibilă în log.
          console.error(
            `[stripe-webhook] ALERT duplicate subscription user=${refUserId} ` +
            `kept=${claim.current || '?'} duplicate=${subscriptionId} status=${subscription.status}`,
          )
          const settled = await settleDuplicateSubscription(stripe, supabase, subscription, {
            userId: refUserId,
            subscriptionId,
            keptSubscriptionId: claim.current,
            reprocessing,
          })
          logDuplicateRefund(`duplicate subscription ${subscriptionId} settled: ` +
            `cancel=${settled.canceledNow ? 'now' : 'already'}` +
            (settled.keptVerified === false ? ' kept=UNVERIFIED' : ''), subscriptionId, settled.refund)
          break
        }

        await safeInsertLifecycleEvent(supabase, refUserId, 'subscription_started', {
          plan: finalPlan, subscription_id: subscriptionId,
        })

        console.log(
          `[stripe-webhook] User ${refUserId} upgraded to ${finalPlan}` +
          (claim.replaced ? ` (înlocuiește abonamentul încheiat ${claim.replaced})` : ''),
        )
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
        const activePlan = LIVE_SUB_STATUSES.includes(status) ? subPlan : 'free'

        // Scrierea e CONDIȚIONATĂ, nu doar verificarea de mai sus: între citire
        // și UPDATE, checkout-ul altui abonament poate înregistra profilul
        // (claimProfileSubscription). Un UPDATE necondiționat l-ar suprascrie, iar
        // abonamentul înregistrat ar rămâne viu și neurmărit — exact dublura pe
        // care o previne finalizarea. Același WHERE ca acolo, sub lacătul rândului.
        if (!isSubscriptionId(subscription.id)) {
          throw new Error(`customer.subscription.updated: id de abonament cu formă necunoscută`)
        }
        // Profil GOL: evenimentul l-ar revendica pe baza INSTANTANEULUI din
        // payload. O dublură anulată de noi (lotul #61) poate avea încă în zbor
        // un `updated` de DINAINTEA anulării (status `active`), relivrat după ce
        // abonamentul păstrat s-a încheiat și profilul s-a golit; fără citirea
        // din Stripe, profilul ar primi un plan PLĂTIT pe un abonament anulat,
        // care nu mai emite niciun eveniment — pe termen nelimitat. Se citește
        // DOAR pe profilul gol: pe calea obișnuită profilul ține deja abonamentul
        // evenimentului. O eroare Stripe aruncă (500 → Stripe retrimite).
        const claimsEmptyProfile = !profile.stripe_subscription_id
        if (claimsEmptyProfile && await isCanceledDuplicate(stripe, subscription.id)) {
          console.log(`[stripe-webhook] Skip updated pentru dublura anulată ${subscription.id} (profil gol, instantaneu dinaintea anulării)`)
          break
        }
        const { data: written, error } = await supabase
          .from('profiles')
          .update({
            plan: activePlan,
            stripe_subscription_id: subscription.id,
          })
          .eq('id', profile.id)
          .or(freeOrSameSubscription(subscription.id))
          .select('id')

        if (error) throw new Error(`Subscription update failed: ${error.message}`)
        if (!written || written.length === 0) {
          console.log(`[stripe-webhook] Skip stale subscription ${subscription.id} (profilul a primit alt abonament între citire și scriere)`)
          break
        }

        // Verificarea de DUPĂ scriere (recenzie CodeRabbit pe #386, K1). Citirea
        // de mai sus e înaintea UPDATE-ului: finalizarea poate anula dublura între
        // ele, iar `deleted`-ul ei, sosit cât profilul încă era gol, a fost sărit
        // (DUP26). Fără a doua citire, scrierea ar lăsa profilul pe un abonament
        // anulat cu plan plătit, fără niciun eveniment care să-l mai corecteze.
        // Deci starea de după scriere se aliniază cu starea abonamentului din
        // ACEST moment, indiferent de ordinea webhook-urilor. Rulează doar când
        // evenimentul a revendicat un profil GOL (citirea se plătea deja) sau la
        // o REPROCESARE: dacă citirea de aici pică după scriere, la reluare
        // profilul ține deja abonamentul, iar fără `reprocessing` reluarea ar sări
        // verificarea și ar fixa starea greșită. Pe calea obișnuită (profilul ține
        // abonamentul, prima livrare) nu se citește nimic.
        if (claimsEmptyProfile || reprocessing) {
          let canceledDup
          try {
            canceledDup = await isCanceledDuplicate(stripe, subscription.id)
          } catch (e) {
            processingError = `customer.subscription.updated ${subscription.id}: verificarea de după scriere ` +
              `n-a putut citi abonamentul: ${e?.message || String(e)}`
            console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
            break
          }
          if (canceledDup) {
            // Revenire CONDIȚIONATĂ: atinge doar un rând care ține ÎNCĂ dublura.
            // Dacă între timp profilul a primit alt abonament (finalizarea unui
            // abonament nou, care înlocuiește unul anulat prin CAS), nu-l șterge.
            // `free`, ca `customer.subscription.deleted` pe un profil care ține
            // abonamentul încheiat; fără email și fără tranziția atribuirii — nu e
            // abonamentul clientului.
            const { data: reverted, error: revertErr } = await supabase
              .from('profiles')
              .update({ plan: 'free', stripe_subscription_id: null })
              .eq('id', profile.id)
              .eq('stripe_subscription_id', subscription.id)
              .select('id')
            if (revertErr) throw new Error(`Revert după dublura anulată ${subscription.id} eșuat: ${revertErr.message}`)
            console.error(
              `[stripe-webhook] ALERT updated pe dublura anulată ${subscription.id} (anulată între citire și scriere) ` +
              `user=${profile.id} — scrierea ${reverted && reverted.length ? 'revenită: profil gol, plan free' : 'nu mai e în profil (golit de deleted-ul dublurii sau înlocuit de alt abonament), neatinsă'}`,
            )
            break
          }
        }

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

        // Condiționat, ca la updated: dacă între citire și scriere checkout-ul
        // unui abonament NOU a înlocuit unul încheiat (claimProfileSubscription),
        // un downgrade necondiționat ar șterge abonamentul nou din profil — viu,
        // facturat și neurmărit.
        if (!isSubscriptionId(subscription.id)) {
          throw new Error(`customer.subscription.deleted: id de abonament cu formă necunoscută`)
        }
        // Dublura anulată de noi, pe profil GOL (cel păstrat s-a încheiat între
        // timp): nu e abonamentul clientului — fără al doilea email de anulare și
        // fără tranziția atribuirii. Payload-ul lui `deleted` e instantaneul DE
        // DUPĂ anulare, deci poartă urma (fără citire Stripe). Pe un profil care
        // chiar ține abonamentul se retrogradează ca de obicei.
        if (!profile.stripe_subscription_id && isOurDuplicateCancel(subscription)) {
          console.log(`[stripe-webhook] Skip deleted pentru dublura anulată ${subscription.id} (profil gol)`)
          break
        }
        const { data: downgraded, error } = await supabase
          .from('profiles')
          .update({
            plan: 'free',
            stripe_subscription_id: null,
          })
          .eq('id', profile.id)
          .or(freeOrSameSubscription(subscription.id))
          .select('id')

        if (error) throw new Error(`Downgrade failed: ${error.message}`)
        if (!downgraded || downgraded.length === 0) {
          console.log(`[stripe-webhook] Skip stale deleted subscription ${subscription.id} (profilul a primit alt abonament între citire și scriere)`)
          break
        }

        // Afiliere (mig 293): abonamentul S-A ÎNCHEIAT → atribuirea `canceled`
        // (fără comisioane noi, fără acces de partener — poarta 193). Acesta e
        // SINGURUL loc care stinge o atribuire: refund-ul / disputa / plata
        // eșuată pe O factură se recuperează prin clawback, nu prin terminal
        // (ireversibil). DUPĂ downgrade, ÎNAINTEA evenimentului de lifecycle:
        // un eșec al RPC-ului → 500 → Stripe retrimite; reluarea e sigură
        // (downgrade idempotent, RPC idempotent pe terminal) și emailul de
        // anulare nu se dublează, fiindcă încă nu fusese pus în coadă.
        try {
          await setAttributionTerminal(supabase, { profileId: profile.id }, 'canceled',
            `customer.subscription.deleted ${subscription.id}`)
        } catch (e) {
          processingError = `affiliate attribution status failed: ${e?.message || String(e)}`
          console.error(`[stripe-webhook] ${processingError}`)
          break
        }

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
          // Afiliere: un eșec de plată, chiar TERMINAL, NU stinge atribuirea —
          // terminal e ireversibil, iar clientul poate plăti ulterior. Dacă
          // dunning-ul eșuează definitiv, Stripe anulează abonamentul și
          // `customer.subscription.deleted` face tranziția (`canceled`).
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
          .select('id, stripe_subscription_id')
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
        if (profile) userId = profile.id
        const invoiceSubId = invoiceSubscriptionId(invoice)

        // ── Factura DUBLURII anulate de noi (lotul #61) ───────────────────────
        // Banii pot ajunge pe dublură DUPĂ ce am anulat-o la finalizare: o metodă
        // cu decontare întârziată (SEPA, transfer) ține abonamentul `active` cu
        // PaymentIntent `processing`, anularea nu oprește o plată deja în
        // procesare, iar factura devine `paid` mai târziu — fără nicio
        // rambursare (la decontare factura era `open`, nu `paid`). Tot aici
        // ajunge și un `invoice.paid` al dublurii RELUAT după rambursare (500 la
        // prima încercare): fără gardă, ar scrie comision de afiliere pe bani
        // deja returnați, pe care `charge.refunded` (consumat înaintea lui) nu-l
        // mai stornează niciodată. Deci: rambursăm FACTURA EVENIMENTULUI
        // (idempotent: refunds.list + aceeași cheie ca la decontare) și sărim
        // lifecycle-ul și comisionul — factura dublurii nu e a clientului.
        // Fără citire Stripe pe calea obișnuită: claimProfileSubscription nu
        // scrie niciodată o dublură în profil, iar `customer.subscription.updated`
        // pe profil gol citește abonamentul și sare dublura anulată (DUP25) — iar
        // dacă a scris-o totuși într-o cursă, verificarea de după scriere revine
        // (DUP27; profilul o poate ține doar TRANZITORIU, rezidual în CLAUDE.md) —,
        // deci factura abonamentului urmărit nu se verifică.
        // ORDINEA contează: un `invoice.paid` al dublurii procesat ÎNAINTEA
        // finalizării ei (abonamentul încă viu, fără urmă) trece pe calea
        // obișnuită — lifecycle + comision —, iar rambursarea de la finalizare
        // emite `charge.refunded` → clawback (DUP24; reziduuri în CLAUDE.md).
        if (invoice.amount_paid > 0 && isSubscriptionId(invoiceSubId) &&
            !(profile && profile.stripe_subscription_id === invoiceSubId)) {
          let duplicate
          try {
            duplicate = await isCanceledDuplicate(stripe, invoiceSubId)
          } catch (e) {
            processingError = `invoice.paid ${invoice.id}: abonamentul ${invoiceSubId} nu se poate citi: ${e?.message || String(e)}`
            console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
            break
          }
          if (duplicate) {
            console.error(
              `[stripe-webhook] ALERT invoice.paid pe abonamentul DUBLURĂ ${invoiceSubId} (anulat la finalizare) ` +
              `invoice=${invoice.id} amount_paid=${invoice.amount_paid} — se rambursează, fără comision`,
            )
            try {
              const r = await refundDuplicateInvoice(stripe, invoice.id, invoiceSubId)
              logDuplicateRefund(`duplicate subscription ${invoiceSubId} invoice.paid`, invoiceSubId, r)
            } catch (e) {
              processingError = `invoice.paid ${invoice.id}: rambursarea dublurii ${invoiceSubId} a eșuat: ${e?.message || String(e)}`
              console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
            }
            break
          }
        }

        if (profile) {
          await safeInsertLifecycleEvent(supabase, profile.id, 'invoice_paid', {
            billing_reason:  billingReason,
            amount_paid:     invoice.amount_paid,
            currency:        invoice.currency,
            invoice_id:      invoice.id,
            subscription_id: invoiceSubId,
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
            const planLines = invoiceLines.filter((l) => linePriceId(l) && PLAN_BY_PRICE[linePriceId(l)])
            const subPool = planLines.length
              ? planLines
              : invoiceLines.filter(isSubscriptionLine)
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
            const billedPriceId = linePriceId(subLine)
            const billedPlan = PLAN_BY_PRICE[billedPriceId] || null
            // Bani reali pe un abonament, dar NICIO linie cu price lizibil = o
            // formă de payload pe care n-o știm citi (nu un plan necunoscut).
            // Tăcerea ar pierde comisionul definitiv; 500 → Stripe retrimite și
            // rândul rămâne 'failed', vizibil în Job 8. Un price LIZIBIL dar
            // nemapat rămâne skip (fail-closed pe plan, ca până acum).
            if (!billedPlan && (invoiceSubId || invoiceLines.some(isSubscriptionLine)) &&
                !invoiceLines.some((l) => linePriceId(l))) {
              processingError = `invoice.paid ${invoice.id}: nicio linie cu price lizibil ` +
                `(api_version=${stripeEvent.api_version || '?'}) — formă de payload necunoscută`
              console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
              break
            }
            const { error: commErr } = await supabase.rpc('process_affiliate_invoice_paid', {
              p_event_id:               stripeEvent.id,
              p_stripe_customer_id:     customerId,
              p_stripe_subscription_id: invoiceSubId,
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
        let charge = stripeEvent.data.object
        try {
          // Pe un endpoint basil+ (dahlia) Charge NU mai are câmpul `invoice`.
          // Re-citim charge-ul: răspunsul cererii NOASTRE e randat pe pin, deci îl
          // are. `invoice: null` e legitim (plată unică, ex. credite AI) → skip.
          if (!('invoice' in charge)) {
            charge = await stripe.charges.retrieve(charge.id)
          }
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
          // Afiliere: un refund TOTAL pe o factură NU stinge atribuirea (un
          // refund de bunăvoință pe o lună ar fi oprit pe veci comisioanele unui
          // client care rămâne abonat). Banii facturii se recuperează prin
          // clawback-ul de mai sus; sfârșitul abonamentului vine prin
          // `customer.subscription.deleted`.
        } catch (e) {
          console.error('[stripe-webhook] affiliate clawback threw:', e?.message)
          processingError = `affiliate clawback threw: ${e?.message || String(e)}`
        }
        break
      }

      case 'charge.refund.updated': {
        // ── Rambursarea DUBLURII a eșuat după creare (lotul #61, K3) ──────────
        // refunds.create poate întoarce `pending`/`requires_action`, iar
        // rambursarea poate deveni `failed`/`canceled` ulterior (ex. contul
        // destinație închis) — inclusiv una născută `succeeded`: o rambursare
        // pe card poate eșua și după ce a fost postată, până la 30 de zile.
        // Stripe anunță asta prin acest eveniment (endpoint-ul trebuie ABONAT la
        // el — pas de fondator OBLIGATORIU, GHID_FONDATOR PASUL 5: fără el, un
        // eșec după un `succeeded` nu lasă NICIUN semnal). Evenimentul e marcat
        // Deprecated la Stripe în favoarea lui `refund.updated`/`refund.failed`,
        // care există abia din 2024-10-28.acacia; pe endpoint-ul pinuit
        // 2023-10-16 e singura sursă, și se emite în continuare pentru
        // rambursările cu charge (ale noastre: card). Ne ocupăm DOAR de
        // rambursările pornite de noi pentru o dublură (metadata
        // `menuvia_reason`); orice altă rambursare (ex. una făcută manual din
        // Dashboard) nu e a noastră de reîncercat. Clawback-ul de afiliere
        // rămâne pe `charge.refunded`, neatins.
        const refund = stripeEvent.data.object || {}
        const meta = refund.metadata || {}
        if (meta.menuvia_reason !== DUPLICATE_REFUND_REASON) {
          console.log(`[stripe-webhook] charge.refund.updated ${refund.id || '?'}: nu e o rambursare de dublură, ignorat`)
          break
        }
        const dupInvoiceId = meta.menuvia_invoice
        const dupSubId = meta.menuvia_subscription
        if (typeof dupInvoiceId !== 'string' || !INVOICE_ID_RE.test(dupInvoiceId) || !isSubscriptionId(dupSubId)) {
          // Metadata NOASTRĂ cu formă necunoscută = nu știm ce să rambursăm: 500,
          // vizibil, nu tăcere.
          throw new Error(`charge.refund.updated ${refund.id || '?'}: metadata de dublură cu formă necunoscută`)
        }
        const deadKind = deadRefundKind(refund)
        if (!deadKind) {
          console.log(`[stripe-webhook] charge.refund.updated ${refund.id}: rambursarea dublurii ${dupSubId} e ${refund.status}, nimic de făcut`)
          break
        }
        if (deadKind === 'final') {
          // Anulată de un om, sau un eșec pentru care Stripe cere altă cale de
          // restituire (RETRYABLE_REFUND_FAILURES): NICIO rambursare nouă și
          // nicio citire — decizia se ia pe obiectul din eveniment, deci nu
          // depinde de ce mai arată lista. Omul verifică și decide.
          console.error(
            `[stripe-webhook] ALERT duplicate refund ${refund.status} refund=${refund.id} subscription=${dupSubId} ` +
            `invoice=${dupInvoiceId} amount=${refund.amount} failure_reason=${refund.failure_reason || '?'} — ` +
            'rambursare MANUALĂ, FĂRĂ reîncercare automată: o rambursare anulată e decizia unui om, iar pentru ' +
            'acest motiv Stripe cere altă cale de restituire (o reîncercare ar putea plăti a doua oară); ' +
            'verifică plata în Dashboard',
          )
          break
        }
        console.error(
          `[stripe-webhook] ALERT duplicate refund ${refund.status} refund=${refund.id} subscription=${dupSubId} ` +
          `invoice=${dupInvoiceId} amount=${refund.amount} failure_reason=${refund.failure_reason || '?'} — ` +
          // Rezultatul reîncercării vine în linia `refund retry … refund=<stare>` de
          // mai jos: plafonul atins sau un refuz permanent al plății îl fac
          // `refund=manual` (cu ALERT propriu), deci mesajul nu promite că
          // reîncercarea rulează.
          'se reîncearcă automat (NU rambursa manual decât dacă linia de rezultat spune refund=manual)',
        )
        // Reîncercarea trece prin ACEEAȘI decizie ca decontarea: factura e încă
        // plătită, `refunds.list` arată că restul NU e rambursat (o reîncercare
        // deja reușită → `already_refunded`, în curs → `refund_pending`) și că
        // nicio rambursare de pe plată nu e finală, iar cheia derivă din
        // numărul de rambursări moarte — deci NOUĂ față de cea eșuată și
        // identică pentru două livrări ale aceluiași eșec. O eroare Stripe aruncă
        // (500 → Stripe retrimite evenimentul).
        const retried = await refundDuplicateInvoice(stripe, dupInvoiceId, dupSubId)
        logDuplicateRefund(`duplicate subscription ${dupSubId} refund retry after ${refund.id} ${refund.status}:`, dupSubId, retried)
        if (!['refunded', 'refund_pending', 'already_refunded', 'manual'].includes(retried.status)) {
          // nothing_paid / pending_payment pe o factură a cărei rambursare a
          // eșuat: starea nu se potrivește cu nimic cunoscut → omul verifică.
          console.error(
            `[stripe-webhook] ALERT duplicate refund ${refund.id}: factura ${dupInvoiceId} nu mai e rambursabilă ` +
            `(${retried.status}) — verificare MANUALĂ`,
          )
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
          // Baza storno-ului = SUMA DISPUTATĂ (mig 293), nu tot charge-ul: o
          // dispută pe rest după un refund parțial nu are voie să storneze iar
          // partea deja refundată (RPC-ul plafonează oricum la restul comisionului).
          // Sumă lipsă/invalidă = formă necunoscută → 500, nu ghicim.
          if (!Number.isInteger(dispute.amount) || dispute.amount <= 0) {
            processingError = `dispute clawback: dispute.amount invalid (${dispute.amount}) pe ${dispute.id}`
            console.error(`[stripe-webhook] ALERTĂ (retry): ${processingError}`)
            break
          }
          try {
            const { error: clawErr } = await supabase.rpc('process_affiliate_refund', {
              p_event_id:            stripeEvent.id,
              p_stripe_invoice_id:   charge.invoice || null,
              p_charge_amount_cents: charge.amount,
              p_refund_id:           `dispute_${dispute.id}`, // cheie idempotentă stabilă
              p_refund_amount_cents: dispute.amount,           // suma disputată (pierdută)
              p_event_created_at:    new Date(stripeEvent.created * 1000).toISOString(),
            })
            if (clawErr) {
              console.error('[stripe-webhook] dispute clawback failed:', clawErr.message)
              processingError = `dispute clawback failed: ${clawErr.message}`
            }
            // Dispută pierdută: clawback-ul de mai sus recuperează comisionul;
            // atribuirea NU devine terminală (vezi refund-ul total).
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

// ── Helper: atribuirea de afiliere iese din `active` (mig 293) ─────
// set_affiliate_attribution_status e idempotent (terminal rămâne terminal) și
// întoarce `no_attribution` pentru clienții neatribuiți. Lookup-ul de profil pe
// customer: PGRST116 (fără profil) = nimic de făcut; ORICE altă eroare ARUNCĂ —
// apelantul o face 500, iar Stripe retrimite (o atribuire rămasă `active` ține
// accesul de partener viu, poarta din mig 193).
async function setAttributionTerminal(supabase, { profileId, customerId }, status, reason) {
  let pid = profileId || null
  if (!pid) {
    if (typeof customerId !== 'string' || !customerId) return null
    const { data: profile, error: lookupErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()
    if (lookupErr && lookupErr.code !== 'PGRST116') {
      throw new Error(`lookup profil eșuat pentru customer ${customerId}: ${lookupErr.message}`)
    }
    if (!profile) return null
    pid = profile.id
  }
  const { data, error } = await supabase.rpc('set_affiliate_attribution_status', {
    p_referred_profile_id: pid,
    p_status:              status,
    p_reason:              reason,
  })
  if (error) throw new Error(`set_affiliate_attribution_status: ${error.message}`)
  return data
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

// ── Helper: resolve plan from subscription ─────────────────────────
/**
 * Planul canonic al unui abonament Stripe la momentul livrării evenimentului.
 * Fail-CLOSED la 'free' dacă abonamentul lipsește, e terminal (canceled /
 * unpaid / incomplete_expired) sau nu are nici price mapat, nici metadata
 * validă (audit HIGH). O eroare Stripe (ex. timeout tranzitoriu de rețea) NU
 * înseamnă „plan free" — înseamnă „nu știm" → aruncăm mai departe ca
 * apelantul să NU aplice niciun downgrade pe un client care a plătit efectiv.
 * Întoarce și abonamentul citit: finalizarea îi folosește starea, factura și
 * urma de anulare (claimProfileSubscription / settleDuplicateSubscription), fără
 * a-l citi a doua oară.
 * @param {import('stripe')} stripe clientul Stripe
 * @param {string} subscriptionId id-ul abonamentului din sesiune (validat de apelant)
 * @param {Record<string,string>} [planByPrice] mapă price.id → plan canonic
 * @returns {Promise<{ plan: 'free'|'starter'|'growth'|'pro'|'enterprise', subscription: object }>}
 */
async function resolvePlan(stripe, subscriptionId, planByPrice = {}) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  return { plan: planForSubscription(sub, planByPrice), subscription: sub }
}

function planForSubscription(sub, planByPrice) {
  // ★ audit v3 (MF-07): un abonament deja TERMINAL la momentul livrării
  // evenimentului NU acordă plan plătit. Cazul real: webhook mort >3 zile
  // (env Netlify șters), founder-ul retrimite din Stripe Dashboard
  // checkout.session.completed → între timp abonamentul s-a anulat; un
  // abonament canceled nu mai emite niciun eveniment, deci planul ar fi rămas
  // 'pro' pe termen nelimitat. Aceeași listă de statusuri VII ca la
  // customer.subscription.updated (past_due = grace de dunning, nu downgrade).
  if (!LIVE_SUB_STATUSES.includes(sub && sub.status)) return 'free'
  // Planul din price.id-ul FACTURAT are prioritate (sursa de adevăr folosită
  // și de subscription.updated); metadata.plan rămâne fallback pentru
  // abonamentele fără price mapat (fail-closed prin normalizePlan).
  const items = sub.items?.data || []
  const priced = items.find((i) => i?.price?.id && planByPrice[i.price.id])
  if (priced) return planByPrice[priced.price.id]
  return normalizePlan(sub.metadata?.plan)
}

// ── Abonament unic la finalizare (lotul #61) ──────────────────────
/**
 * Leagă abonamentul unei sesiuni finalizate de profil, ATOMIC, și spune ce s-a
 * întâmplat:
 *   written    profilul era liber / avea deja ACEST abonament (relivrare) /
 *              avea unul care nu mai e VIU → scris; `replaced` = cel vechi. „Nu
 *              mai e viu” = încheiat (deleted pierdut / necunoscut lui Stripe)
 *              SAU `unpaid`/`incomplete` — al doilea caz e REZIDUAL: cel vechi
 *              își poate încă plăti factura deschisă, neurmărit (DUP3b)
 *   stale      abonamentul sesiunii nu mai poate factura și profilul ține altul
 *              (replay întârziat al unui abonament vechi) → nimic de făcut
 *   foreign    profilul ține alt abonament, iar acesta NU e un abonament de plan
 *              Menuvia (`menuvia` false) → nimic de făcut, nici anulare
 *   duplicate  profilul ține ALT abonament VIU, iar acesta e de plan Menuvia → e
 *              dublura; `current` = cel păstrat
 *   no_profile contul nu (mai) există
 *
 * De ce un UPDATE condiționat și nu o citire: două webhook-uri concurente pot
 * citi AMÂNDOUĂ profilul liber înainte ca vreunul să scrie. Un singur
 * `UPDATE profiles … WHERE id = $1 AND (stripe_subscription_id IS NULL OR
 * stripe_subscription_id = $2)` (ce trimite PostgREST pentru lanțul de mai jos,
 * într-o singură instrucțiune) ia lacătul rândului; sub READ COMMITTED, al doilea
 * UPDATE așteaptă lacătul și își RE-EVALUEAZĂ WHERE-ul pe rândul deja scris de
 * primul, deci primește 0 rânduri. Garanția vine din Postgres, nu din cod, și
 * nu cere o migrație (un RPC DEFINER ar face exact același UPDATE … RETURNING).
 * Înlocuirea unui abonament încheiat e un compare-and-swap pe valoarea VECHE,
 * cu aceeași semantică: dintre doi concurenți, unul singur o găsește.
 */
async function claimProfileSubscription(supabase, stripe, { userId, customerId, subscriptionId, subscription, plan, menuvia }) {
  // Reluare după un 500 la mijlocul decontării unei dubluri: abonamentul e deja
  // anulat DE NOI (urma de pe el); profilul nu se atinge, decontarea continuă.
  if (isOurDuplicateCancel(subscription)) {
    return { outcome: 'duplicate', current: keptFromCancelMarker(subscription) }
  }
  // Decizia „poate factura” e pe STAREA abonamentului, nu pe planul rezolvat:
  // un abonament viu cu price nemapat rezolvă 'free', dar încasează.
  const billable = BILLABLE_SUB_STATUSES.includes(subscription && subscription.status)
  const payload = { plan, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId }

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const { data: claimed, error: claimErr } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .or(freeOrSameSubscription(subscriptionId))
      .select('id')
    if (claimErr) throw new Error(`Profile update failed: ${claimErr.message}`)
    if (claimed && claimed.length > 0) return { outcome: 'written', replaced: null }

    const prof = await readProfileSubscription(supabase, userId)
    if (!prof.exists) return { outcome: 'no_profile' }
    const current = prof.current
    // Profilul s-a eliberat / a primit chiar acest abonament între cele două
    // instrucțiuni → încă o încercare de înregistrare.
    if (!current || current === subscriptionId) continue
    if (!billable) return { outcome: 'stale', current }
    // Anularea + rambursarea sunt ireversibile: le facem doar pe un abonament
    // creat de checkout-ul NOSTRU. Unul străin (alt produs pe același cont
    // Stripe) nu e „dublura” noastră și nici nu înlocuiește abonamentul din
    // profil — se lasă neatins.
    if (!menuvia) return { outcome: 'foreign', current }
    if (await isLiveSubscription(stripe, current)) {
      // Re-validarea deținătorului IMEDIAT înaintea anulării (recenzie CodeRabbit
      // pe #386, K2): citirea din Stripe de mai sus durează, iar între timp
      // `customer.subscription.deleted` al celui păstrat poate goli profilul
      // (sau altă finalizare îl poate înlocui). Anularea + rambursarea ar lăsa
      // atunci contul FĂRĂ niciun abonament viu — mai rău decât înaintea lotului,
      // când aceeași ordine lăsa abonamentul nou înregistrat. Dacă profilul nu
      // mai ține abonamentul citit viu, decizia se reia prin bucla de revendicare
      // (UPDATE-ul condiționat), mărginită de CLAIM_ATTEMPTS. Între această
      // citire și anulare rămâne doar latența cererii de anulare; acea fereastră
      // se DETECTEAZĂ după anulare (verifyKeptAfterCancel), nu se poate închide:
      // un abonament anulat nu se mai reactivează.
      const again = await readProfileSubscription(supabase, userId)
      if (!again.exists) return { outcome: 'no_profile' }
      if (again.current === current) return { outcome: 'duplicate', current }
      continue
    }

    // Cel din profil nu mai e VIU (încheiat — deleted pierdut / întârziat — sau
    // unpaid/incomplete, rezidual DUP3b): abonamentul nou îl înlocuiește — doar
    // dacă profilul ține ÎNCĂ acea valoare.
    const { data: replaced, error: casErr } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .eq('stripe_subscription_id', current)
      .select('id')
    if (casErr) throw new Error(`Profile update failed: ${casErr.message}`)
    if (replaced && replaced.length > 0) return { outcome: 'written', replaced: current }
    // Altcineva a scris între citire și CAS → re-evaluăm de la capăt.
  }
  // 500 → Stripe retrimite; la reluare decizia se ia din nou, pe starea de atunci.
  throw new Error(`profilul ${userId}: abonamentul s-a schimbat concurent de ${CLAIM_ATTEMPTS} ori`)
}

// Abonamentul ținut acum de profil. PGRST116 (zero rânduri) = contul nu (mai)
// există; orice altă eroare e de infra și urcă (500).
async function readProfileSubscription(supabase, userId) {
  const { data: prof, error } = await supabase
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .single()
  if (error && error.code !== 'PGRST116') throw new Error(`Profile lookup failed: ${error.message}`)
  return prof ? { exists: true, current: prof.stripe_subscription_id || null } : { exists: false, current: null }
}

// Abonamentul ținut de profil mai e VIU? Aceeași regulă ca resolvePlan. Un id pe
// care Stripe nu-l cunoaște (resource_missing — ex. rămas din modul de test) nu
// poate factura în acest mod → tratat ca încheiat. Orice altă eroare e
// tranzitorie și urcă (500): fără răspuns nu decidem nimic.
async function isLiveSubscription(stripe, subscriptionId) {
  try {
    const s = await stripe.subscriptions.retrieve(subscriptionId)
    return LIVE_SUB_STATUSES.includes(s && s.status)
  } catch (e) {
    if (e && (e.code === 'resource_missing' || e.statusCode === 404)) return false
    throw e
  }
}

// Abonament de plan Menuvia = creat de stripe-checkout.js, care pune pe FIECARE
// abonament `metadata.supabase_user_id` (contul) — sau, pentru abonamentele fără
// acea metadata, un price din PLAN_BY_PRICE. Orice altceva cu același
// client_reference_id (alt produs pe același cont Stripe, un Payment Link) NU e
// al nostru de anulat.
function isMenuviaPlanSubscription(sub, userId, planByPrice) {
  const owner = sub && sub.metadata && sub.metadata.supabase_user_id
  if (typeof owner === 'string' && owner !== '' && owner === userId) return true
  const items = (sub && sub.items && sub.items.data) || []
  return items.some((i) => {
    const p = refId(i && i.price)
    return !!p && Object.prototype.hasOwnProperty.call(planByPrice, p)
  })
}

function isOurDuplicateCancel(sub) {
  const comment = sub && sub.cancellation_details && sub.cancellation_details.comment
  return !!sub && sub.status === 'canceled' &&
    typeof comment === 'string' && comment.startsWith(DUPLICATE_CANCEL_MARKER)
}
function keptFromCancelMarker(sub) {
  const m = /;kept=(sub_[A-Za-z0-9_]+)/.exec(String(sub.cancellation_details.comment))
  return m ? m[1] : null
}

// Abonamentul facturii e o dublură pe care AM anulat-o noi (urma pe ea)? Un id
// pe care Stripe nu-l cunoaște (resource_missing) nu e dublura noastră. Orice
// altă eroare e tranzitorie și urcă (500): fără răspuns nu decidem nimic.
async function isCanceledDuplicate(stripe, subscriptionId) {
  try {
    return isOurDuplicateCancel(await stripe.subscriptions.retrieve(subscriptionId))
  } catch (e) {
    if (e && (e.code === 'resource_missing' || e.statusCode === 404)) return false
    throw e
  }
}

// O linie de log per decontare (finalizare sau invoice.paid), aceeași formă.
function logDuplicateRefund(prefix, subscriptionId, r) {
  console.log(
    `[stripe-webhook] ${prefix} refund=${r.status}` +
    (r.invoiceId ? ` invoice=${r.invoiceId}` : '') +
    (Number.isInteger(r.amount) ? ` amount=${r.amount}` : '') +
    (Number.isInteger(r.amountDue) ? ` amount_due=${r.amountDue}` : '') +
    (r.refundId ? ` refund_id=${r.refundId}` : '') +
    (r.refundState ? ` refund_state=${r.refundState}` : ''),
  )
  if (r.status === 'manual') {
    const why = r.finalRefund
      ? `are rambursarea ${r.refundId || '?'} ${r.finalRefund} (anulată de un om / Stripe cere altă cale de ` +
        'restituire), FĂRĂ reîncercare automată'
      : r.failedAttempts
        ? `${r.failedAttempts} rambursări eșuate pe plată (plafonul reîncercărilor)`
        : r.reason
          ? `Stripe refuză rambursarea (${r.reason})`
          : 'plătită în afara Stripe'
    console.error(
      `[stripe-webhook] ALERT duplicate subscription ${subscriptionId}: factura ${r.invoiceId} ${why} — rambursare MANUALĂ` +
      (Number.isInteger(r.amount) ? ` (${r.amount})` : ''),
    )
  }
  if (r.status === 'refund_pending') {
    // Banii NU sunt încă înapoi: rambursarea poate eșua ulterior. Eșecul vine ca
    // `charge.refund.updated` (endpoint-ul trebuie abonat la el — pas de
    // fondator), iar ramura lui reîncearcă cu o cheie nouă (motiv reîncercabil)
    // sau predă omului (anulare / motiv final).
    console.error(
      `[stripe-webhook] ALERT duplicate subscription ${subscriptionId}: rambursarea ${r.refundId || '?'} a facturii ` +
      `${r.invoiceId} e ${r.refundState} (încă neîncasată înapoi) — dacă eșuează, charge.refund.updated o ` +
      'reîncearcă (motiv tranzitoriu) sau cere rambursare MANUALĂ',
    )
  }
  if (r.status === 'pending_payment') {
    // Factura e deschisă cu plata încă în procesare (decontare întârziată):
    // anularea nu oprește o plată deja pornită. Dacă se încasează, ramura
    // invoice.paid o rambursează automat; dacă eșuează, nu e nimic de returnat.
    console.log(
      `[stripe-webhook] duplicate subscription ${subscriptionId}: factura ${r.invoiceId} e deschisă — ` +
      'dacă se încasează după anulare, invoice.paid o rambursează',
    )
  }
}

/**
 * Anulează abonamentul DUBLURĂ și îi rambursează factura plătită. Ordinea e
 * deliberată: întâi anularea (oprește facturarea VIITOARE), apoi verificarea că
 * abonamentul păstrat e încă ținut și viu (verifyKeptAfterCancel), apoi
 * rambursarea.
 * Fiecare pas verifică starea înainte să acționeze, deci o reluare după un 500
 * între pași ajunge la aceeași stare finală fără dubluri:
 *   - anularea rulează doar cât abonamentul încă poate factura. DELETE-ul nu
 *     primește cheie de idempotență: Stripe o ignoră pe DELETE („idempotent by
 *     definition”, docs.stripe.com/api/idempotent_requests), deci idempotența
 *     vine din verificarea stării + urma din `cancellation_details`, care
 *     supraviețuiește pe abonamentul anulat (răspuns pierdut → la reluare
 *     abonamentul e deja `canceled` CU urmă → se sare direct la rambursare);
 *   - rambursarea: refunds.list înainte (o cheie de idempotență expiră după
 *     24 h, iar Stripe retrimite webhook-ul până la 3 zile) + cheie derivată din
 *     factură (dublu-apel în aceeași fereastră) + `charge_already_refunded`.
 * Un eșec Stripe ARUNCĂ → 500 → Stripe retrimite (paritate cu restul fișierului).
 * `prorate`/`invoice_now` false: fără factură finală și fără credit — banii
 * facturii se întorc integral prin rambursare.
 */
async function settleDuplicateSubscription(stripe, supabase, sub, { userId, subscriptionId, keptSubscriptionId, reprocessing = false }) {
  let canceledNow = false
  let keptVerified = null
  if (BILLABLE_SUB_STATUSES.includes(sub && sub.status)) {
    await stripe.subscriptions.cancel(subscriptionId, {
      prorate: false,
      invoice_now: false,
      cancellation_details: { comment: `${DUPLICATE_CANCEL_MARKER};kept=${keptSubscriptionId || 'unknown'}` },
    })
    canceledNow = true
    // Imediat după anulare, ÎNAINTEA rambursării: dacă rambursarea pică (500),
    // verificarea a rulat deja la această livrare.
    keptVerified = await verifyKeptAfterCancel(supabase, stripe, { userId, subscriptionId, keptSubscriptionId })
  } else if (reprocessing && isOurDuplicateCancel(sub)) {
    // Reluare după un 500 (recenzie pe #386, R7): anularea s-a aplicat la o
    // livrare anterioară, dar acea livrare se poate să se fi oprit ÎNAINTEA
    // verificării — răspunsul DELETE pierdut după scriere, limita de timp a
    // funcției. Reluarea vede dublura deja anulată și nu mai trece prin ramura
    // de mai sus, deci fără acest pas fereastra K2 rămânea nesemnalată pentru
    // totdeauna. Costă o citire DB + una Stripe, DOAR pe reprocesare (o
    // livrare nouă cu urma deja pusă — ex. un replay de test — nu plătește
    // nimic). Dacă verificarea rulase deja (500 la rambursare), o repetă:
    // aceeași concluzie, cel mult un ALERT repetat.
    keptVerified = await verifyKeptAfterCancel(supabase, stripe, { userId, subscriptionId, keptSubscriptionId, onRetry: true })
  }
  // Factura de rambursat la finalizare: `latest_invoice` al dublurii (abia
  // creată de Checkout → prima ei factură).
  const invoiceId = refId(sub && sub.latest_invoice)
  const refund = invoiceId
    ? await refundDuplicateInvoice(stripe, invoiceId, subscriptionId)
    : { status: 'no_invoice' }
  return { canceledNow, keptVerified, refund }
}

/**
 * Fereastra reziduală a re-validării din claimProfileSubscription (K2): între
 * ultima citire a profilului și anulare, abonamentul păstrat se poate încheia
 * (sau profilul se poate goli / schimba). Un abonament anulat nu se poate
 * reactiva, deci aici doar DETECTĂM și semnalăm: profilul trebuie să țină încă
 * abonamentul păstrat ȘI acesta trebuie să fie viu în Stripe. Altfel contul
 * poate fi rămas FĂRĂ abonament viu → ALERT pentru acțiune manuală (clientul
 * reface checkout-ul; rambursarea dublurii continuă: banii unui abonament anulat
 * nu se păstrează). Nu aruncă: o eroare de citire e ea însăși un motiv de
 * verificare manuală, iar un 500 ar amâna rambursarea unui abonament deja anulat
 * (DUP29: ambele citiri au câte un caz de eroare). `onRetry` = reverificarea de
 * la reluare (settleDuplicateSubscription): anularea e de la o livrare
 * anterioară, deci un păstrat încheiat DUPĂ ea poate fi o încheiere obișnuită —
 * ALERT-ul o spune.
 * @returns {Promise<boolean>} true = păstratul e ținut de profil și viu
 */
async function verifyKeptAfterCancel(supabase, stripe, { userId, subscriptionId, keptSubscriptionId, onRetry = false }) {
  let held = null
  let keptStatus = null
  const problems = []
  try {
    held = (await readProfileSubscription(supabase, userId)).current
  } catch (e) {
    problems.push(`profilul nu s-a putut re-citi: ${e?.message || String(e)}`)
  }
  if (!isSubscriptionId(keptSubscriptionId)) {
    problems.push('abonamentul păstrat e necunoscut')
  } else {
    try {
      const s = await stripe.subscriptions.retrieve(keptSubscriptionId)
      keptStatus = (s && s.status) || null
    } catch (e) {
      if (e && (e.code === 'resource_missing' || e.statusCode === 404)) keptStatus = 'resource_missing'
      else problems.push(`abonamentul păstrat nu s-a putut citi: ${e?.message || String(e)}`)
    }
  }
  const ok = problems.length === 0 && held === keptSubscriptionId && LIVE_SUB_STATUSES.includes(keptStatus)
  if (!ok) {
    console.error(
      `[stripe-webhook] ALERT duplicate cancel MANUAL user=${userId} canceled=${subscriptionId} ` +
      `kept=${keptSubscriptionId} profile_holds=${held || 'null'} kept_status=${keptStatus || '?'}` +
      (problems.length ? ` (${problems.join('; ')})` : '') +
      ' — dublura e deja anulată (ireversibil) și se rambursează; dacă abonamentul păstrat nu mai e viu, ' +
      'contul a rămas fără abonament: contactează clientul să refacă checkout-ul' +
      (onRetry
        ? ' (reverificare la reluare: anularea e de la o livrare anterioară — dacă cel păstrat s-a încheiat ' +
          'DUPĂ ea, poate fi o încheiere obișnuită)'
        : ''),
    )
  }
  return ok
}

// Rambursează o factură a dublurii: `latest_invoice` la finalizare, factura
// EVENIMENTULUI în invoice.paid (banii ajunși după anulare). Doar o factură
// `paid` cu `amount_paid > 0` se rambursează; trialul fără bani (factura de 0)
// nu are ce. O factură `open` cu sumă de plată e o plată ÎN CURS (decontare
// întârziată): raportată distinct, fiindcă banii pot încă sosi — atunci îi
// rambursează invoice.paid.
async function refundDuplicateInvoice(stripe, invoiceId, subscriptionId) {
  const inv = await stripe.invoices.retrieve(invoiceId)
  const paid = Number.isInteger(inv && inv.amount_paid) ? inv.amount_paid : 0
  const due = Number.isInteger(inv && inv.amount_due) ? inv.amount_due : 0
  if (inv && inv.status === 'open' && due > 0) return { status: 'pending_payment', invoiceId, amountDue: due }
  if (!inv || inv.status !== 'paid' || paid <= 0) return { status: 'nothing_paid', invoiceId }

  const target = invoicePaymentTarget(inv)
  if (!target) {
    // Plătită în afara Stripe: nu există ce rambursa prin API — o face omul.
    if (inv.paid_out_of_band) return { status: 'manual', invoiceId, amount: paid }
    // Bani încasați fără plată lizibilă = formă necunoscută: 500, nu tăcere.
    throw new Error(`factura ${invoiceId} a dublurii ${subscriptionId}: plătită fără payment_intent/charge lizibil`)
  }

  const prior = (((await stripe.refunds.list({ ...target, limit: 100 })) || {}).data || []).filter(Boolean)
  // O rambursare `pending`/`requires_action` contează ca făcută: banii sunt pe
  // drum; dacă eșuează, `charge.refund.updated` aduce reîncercarea.
  const live = prior.filter((r) => !deadRefundKind(r))
  const refunded = live.reduce((sum, r) => sum + (Number.isInteger(r.amount) ? r.amount : 0), 0)
  if (refunded >= paid) {
    // Acoperită, dar banii pot fi încă pe drum (recenzie pe #386, R2): o
    // reluare după un răspuns pierdut (rambursarea creată `pending` la Stripe,
    // cererea noastră căzută în timeout) ajunge AICI, nu la ramura de creare —
    // fără acest caz, ALERT-ul `pending` nu pleca la nicio livrare.
    const inFlight = live.find((r) => r.status === 'pending' || r.status === 'requires_action')
    if (inFlight) {
      return { status: 'refund_pending', invoiceId, amount: refunded, refundId: inFlight.id, refundState: inFlight.status }
    }
    return { status: 'already_refunded', invoiceId, amount: refunded }
  }
  // Oglinda deciziei din `charge.refund.updated` (R1): o rambursare FINALĂ pe
  // plată (anulată de un om / motiv pentru care Stripe cere altă cale) înseamnă
  // că decizia e a omului. Altfel un `invoice.paid` sau o finalizare relivrată
  // ar reface tăcut rambursarea pe care cineva a anulat-o — plată dublă dacă a
  // returnat deja banii pe altă cale.
  const final = prior.find((r) => deadRefundKind(r) === 'final')
  if (final) {
    return {
      status: 'manual', invoiceId, amount: paid - refunded, refundId: final.id,
      finalRefund: final.failure_reason ? `${final.status}/${final.failure_reason}` : final.status,
    }
  }

  // Cheia de idempotență (K3). Prima încercare păstrează cheia de dinainte,
  // `dupsub_refund_<factură>`: ea acoperă cererea AMBIGUĂ (răspuns pierdut) —
  // reluarea în 24 h primește rambursarea deja creată, nu una nouă. Dar exact
  // de aceea, după ce o rambursare a EȘUAT, aceeași cheie ar întoarce răspunsul
  // ORIGINAL (rambursarea moartă), nu una nouă. Deci cheia derivă determinist
  // din numărul de rambursări moarte de pe plată: două livrări ale aceluiași
  // eșec văd același număr → aceeași cheie → o singură rambursare nouă. (Aici
  // toate cele moarte sunt reîncercabile: una finală a ieșit mai sus.)
  const dead = prior.filter((r) => deadRefundKind(r) === 'retryable').length
  if (dead >= DUPLICATE_REFUND_MAX_ATTEMPTS) {
    return { status: 'manual', invoiceId, amount: paid - refunded, failedAttempts: dead }
  }
  const idempotencyKey = dead === 0 ? `dupsub_refund_${invoiceId}` : `dupsub_refund_${invoiceId}_retry${dead}`

  let r
  try {
    // Fără `amount`: rambursează restul nerambursat al plății.
    r = await stripe.refunds.create(
      {
        ...target,
        reason: 'duplicate',
        metadata: {
          menuvia_reason: DUPLICATE_REFUND_REASON,
          menuvia_subscription: subscriptionId,
          menuvia_invoice: invoiceId,
        },
      },
      { idempotencyKey },
    )
  } catch (e) {
    if (e && e.code === 'charge_already_refunded') return { status: 'already_refunded', invoiceId }
    // Refuzuri PERMANENTE ale plății (coduri de eroare Stripe): o reluare n-ar
    // schimba nimic, iar un 500 ar bucla 3 zile. Omul rambursează pe altă cale.
    if (e && (e.code === 'charge_disputed' || e.code === 'charge_expired_for_refund')) {
      return { status: 'manual', invoiceId, amount: paid - refunded, reason: e.code }
    }
    throw e
  }
  const st = r && r.status
  const base = { invoiceId, amount: r && r.amount, refundId: r && r.id, idempotencyKey }
  if (st === 'succeeded') return { status: 'refunded', ...base }
  if (st === 'pending' || st === 'requires_action') return { status: 'refund_pending', refundState: st, ...base }
  // Moartă din prima (sau stare necunoscută): 500 → Stripe retrimite; reluarea
  // vede rambursarea moartă în refunds.list: reîncercabilă → cheia următoare,
  // până la DUPLICATE_REFUND_MAX_ATTEMPTS; finală → manual, fără reîncercare.
  throw new Error(
    `rambursarea ${(r && r.id) || '?'} a dublurii ${subscriptionId} (factura ${invoiceId}) întoarsă ` +
    `status=${st || '?'}${r && r.failure_reason ? ` (${r.failure_reason})` : ''}`,
  )
}

// Plata facturii, pe forma pin-ului: răspunsul cererii NOASTRE (invoices.retrieve)
// e randat pe '2023-10-16', unde factura are `payment_intent` / `charge`. Pe
// basil+ (dahlia) câmpurile au dispărut în favoarea listei `payments`; ramura de
// jos o citește dacă pin-ul se mută și lista e prezentă, altfel funcția întoarce
// null și apelantul aruncă (formă necunoscută → 500), nu sare tăcut rambursarea.
function invoicePaymentTarget(inv) {
  const pi = refId(inv.payment_intent)
  if (pi) return { payment_intent: pi }
  const ch = refId(inv.charge)
  if (ch) return { charge: ch }
  const payments = (inv.payments && inv.payments.data) || []
  for (const p of payments) {
    if (!p || p.status !== 'paid' || !p.payment) continue
    const ppi = refId(p.payment.payment_intent)
    if (ppi) return { payment_intent: ppi }
    const pch = refId(p.payment.charge)
    if (pch) return { charge: pch }
  }
  return null
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
