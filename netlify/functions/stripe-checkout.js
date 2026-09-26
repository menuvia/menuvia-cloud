// netlify/functions/stripe-checkout.js
// Creates a Stripe Checkout Session for Pro plan subscription.
// Auth: validates Supabase JWT.

const { createClient } = require('@supabase/supabase-js')
const Stripe = require('stripe')
// Versiunea de API PINUITĂ (audit v3 OPS-8) pentru CERERILE noastre către Stripe:
// fără pin, un bump de SDK schimbă tăcut forma răspunsurilor pe care le citim
// (subscriptions.list, checkout sessions…). NU acoperă evenimentele de WEBHOOK:
// versiunea lor e setată per endpoint în Stripe Dashboard (act de fondator, A9)
// și trebuie ținută egală cu aceasta. Se schimbă DELIBERAT, cu tests/functions/
// verzi (stripe-node 14.x → '2023-10-16').
const STRIPE_API_VERSION = '2023-10-16'

// Planurile care primesc trial (RES-11). Oglinda EXACTĂ a `TRIAL_PLAN_IDS` din
// src/lib/pricingCopy.ts — se schimbă în AMBELE locuri. Gate-ul stă AICI, pe
// server: clientul arată trialul doar pe starter/growth, dar un POST direct
// `{plan:'pro'}` (sau fallback-ul `onCheckout('pro')` din PricingPage când
// WhatsApp nu e configurat) ajunge tot aici. Cu trial FĂRĂ card, un trial pe
// pro/enterprise ar da 30 de zile de Plan 3 (`fiscal_receipt`) fără nicio
// metodă de plată — regula de aur cere gate server-side.
const TRIAL_PLANS = ['starter', 'growth']

// Durata trialului: `STRIPE_TRIAL_DAYS` NESETAT = 30 (= `TRIAL_DAYS` din
// pricingCopy.ts, promisiunea de pe pagina de prețuri). Parsare STRICTĂ:
// `parseInt('30abc')` dădea 30, iar o valoare fără plafon (typo `3000`) trecea
// de `Number.isFinite` și Stripe respingea TOATE checkout-urile cu trial (max
// 730 de zile). Acceptăm doar 0–90; orice altceva → 30, cu avertisment în log.
const DEFAULT_TRIAL_DAYS = 30
const MAX_TRIAL_DAYS = 90
function resolveTrialDays(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_TRIAL_DAYS
  const s = String(raw).trim()
  if (/^\d{1,3}$/.test(s)) {
    const n = Number(s)
    if (n <= MAX_TRIAL_DAYS) return n
  }
  console.warn(`[stripe-checkout] STRIPE_TRIAL_DAYS invalid (${JSON.stringify(raw)}), folosesc ${DEFAULT_TRIAL_DAYS}`)
  return DEFAULT_TRIAL_DAYS
}

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

  // .every(Boolean): lipsa ORICĂRUI price ID trebuie să eșueze vizibil la boot
  // (aliniat cu validarea din stripe-webhook.js) — altfel un plan neconfigurat
  // ar trece nedetectat până la primul checkout eșuat în producție.
  if (!STRIPE_SECRET_KEY || !Object.values(PRICE_IDS).every(Boolean)) {
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
  // Fail-closed pe eroare de infra (aliniat cu send-invite.js): dacă limiterul nu
  // poate fi verificat, respingem cererea în loc s-o lăsăm să treacă nesupravegheat.
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_function_name:  'stripe_checkout',
      p_scope_key:      user.id,
      p_max_requests:   10,
      p_window_minutes: 5,
    })
    if (rlErr) {
      console.error('[stripe-checkout] rate limit RPC failed (fail-closed):', rlErr.message)
      return jsonResponse(503, { error: 'Rate limit service unavailable' })
    }
    if (rlOk === false) {
      return jsonResponse(429, { error: 'Prea multe încercări. Reîncearcă în câteva minute.' })
    }
  } catch (e) {
    console.error('[stripe-checkout] rate limit check threw (fail-closed):', e?.message)
    return jsonResponse(503, { error: 'Rate limit service unavailable' })
  }

  // Get or create Stripe customer
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, timeout: 6000, maxNetworkRetries: 0 })

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .single()

  // Eroare de DB tranzitorie ≠ „profil inexistent" — fără verificare, un blip
  // ar crea un customer Stripe DUPLICAT (customerId rămâne undefined → ramura
  // de creare) pentru un user care are deja unul (audit săpt. 10).
  if (profileErr) {
    console.error('[stripe-checkout] profile lookup failed:', profileErr.message)
    return jsonResponse(503, { error: 'Serviciu temporar indisponibil. Reîncearcă.' })
  }

  let customerId = profile?.stripe_customer_id

  // OPT-R2: true DOAR când această cerere a creat customer-ul ȘI a câștigat
  // UPDATE-ul atomic → istoricul de subscripții e garantat gol, sărim lookup-ul.
  let isFreshCustomer = false

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email || user.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id

    // Anti race la creare concurentă (2 cereri simultane fără stripe_customer_id
    // ar crea 2 customeri Stripe pentru același user). UPDATE atomic condiționat
    // pe .is('stripe_customer_id', null): doar cererea care câștigă cursa scrie.
    const { data: updatedRows } = await supabase.from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id')

    if (updatedRows && updatedRows.length > 0) {
      // Am câștigat cursa cu un customer creat acum → fără subscripții posibile.
      isFreshCustomer = true
    }
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
          console.warn('[stripe-checkout] cleanup orphan Stripe customer failed:', e?.message)
        }
      }
    }
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
        // Best-effort — nu blocăm checkout-ul, dar logăm cu context structurat
        // ca eșecurile de atribuire să fie vizibile (nu doar un warn pierdut).
        console.error('[stripe-checkout] affiliate capture failed:', {
          referralCode, userId: user.id, customerId, error: attrErr.message,
        })
      }
    } catch (e) {
      console.error('[stripe-checkout] affiliate capture threw:', {
        referralCode, userId: user.id, customerId, error: e?.message || String(e),
      })
    }
  }

  const appUrl = VITE_APP_URL || 'https://menuvia.netlify.app'

  // Trial configurabil — default 30 zile. `STRIPE_TRIAL_DAYS=0` îl dezactivează
  // fără cod; orice valoare invalidă cade pe 30 (resolveTrialDays, sus).
  const trialDays = resolveTrialDays(STRIPE_TRIAL_DAYS)

  // ── Anti dublu-abonament (#5) + trial-once (#15) ───────────────────────────
  // Self-contained în Stripe (fără coloană nouă în DB): citim istoricul de
  // subscripții al clientului.
  //   • dacă există deja una activă/în trial → 409 (schimbarea planului se face
  //     din Portalul de facturare, nu printr-un nou checkout — altfel dublă plată);
  //   • dacă a existat VREODATĂ un trial → nu mai acordăm altul (anti trial-farming).
  let allowTrial = trialDays > 0 && TRIAL_PLANS.includes(requestedPlan)
  let subsAll = []
  // OPT-R2: pe un customer creat de NOI cu milisecunde în urmă (isFreshCustomer)
  // lista de subscripții e garantat goală — sărim RTT-ul Stripe. Pe orice altă
  // cale (customer existent sau adoptat după cursă) verificarea rămâne integrală.
  if (isFreshCustomer) {
    subsAll = []
  } else try {
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

  // 'unpaid' și 'incomplete' acoperă fereastra dintre eșecul repetat de plată
  // și anularea efectivă a subscripției — fără ele, un checkout nou ar putea
  // porni un al doilea abonament pe o subscripție încă "vie" la Stripe.
  const hasLive = subsAll.some(
    (s) => ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status),
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

  // RES-11 — trial FĂRĂ card. Două chei, în DOUĂ locuri diferite, ambele DOAR
  // pe ramura cu trial:
  //   • `payment_method_collection` e parametru al SESIUNII (lângă `mode`), NU
  //     al lui `subscription_data` — pus acolo, Stripe respinge cererea;
  //   • `trial_settings.end_behavior.missing_payment_method: 'cancel'` stă ÎN
  //     `subscription_data`: fără card la ziua 30, abonamentul se ANULEAZĂ (nu
  //     intră în `past_due`, deci dunning-ul nu pornește pe oameni fără card) →
  //     `customer.subscription.deleted` → planul cade pe free în webhook.
  // Pe ramura fără trial (trial deja folosit, plan exclus, trial dezactivat)
  // prima factură e imediată, deci cardul e cerut oricum — nu trimitem nimic.
  let session
  try {
    session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        client_reference_id: user.id,
        mode: 'subscription',
        ...(allowTrial ? { payment_method_collection: 'if_required' } : {}),
        // Datele de facturare ale abonatului (denumire, CUI, adresă): factura
        // SRL-ului Menuvia le cere, iar până acum nu le colecta nimic — customer-ul
        // Stripe avea doar emailul. Rămân pe Stripe Customer (fără coloane noi).
        // `customer_update` e OBLIGATORIU fiindcă sesiunea primește un customer
        // existent: fără el, Stripe nu poate salva numele/adresa colectate.
        tax_id_collection: { enabled: true },
        billing_address_collection: 'required',
        customer_update: { name: 'auto', address: 'auto' },
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
          ...(allowTrial
            ? {
                trial_period_days: trialDays,
                trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
              }
            : {}),
        },
      },
      {
        // Idempotență: cheia trebuie să includă TOATE intrările care schimbă corpul cererii
        // (plan, referral_code, trial), altfel Stripe respinge cheia reutilizată cu params
        // diferiți (idempotency_error). Click-uri repetate cu EXACT aceeași cerere → aceeași
        // sesiune (dedup); orice diferență → cheie nouă.
        // Fereastră temporală de 30 min: fără ea, aceeași cerere repetată mult mai
        // târziu (ex. a doua zi) ar rămâne blocată pe cheia veche la Stripe.
        // Prefixul `checkout_v2_`: RES-11 a schimbat corpul cererii (chei noi), iar
        // o cerere repetată peste deploy, în aceeași fereastră de 30 min, ar fi
        // plecat cu corpul NOU pe cheia VECHE → `idempotency_error` la Stripe.
        idempotencyKey: `checkout_v2_${user.id}_${requestedPlan}_${referralCode || 'none'}_${allowTrial ? trialDays : 0}_${Math.floor(Date.now() / (30 * 60 * 1000))}`,
      },
    )
  } catch (e) {
    // Fail-closed VIZIBIL: fără try/catch, o respingere Stripe (parametru
    // necunoscut pe versiunea pinuită, CUI refuzat etc.) ieșea din handler ca
    // excepție → 500/502 fără corp și fără cauză în log. Clientul afișează
    // mesajul românesc (describeCheckoutFailure) și oferă reîncercarea.
    console.error('[stripe-checkout] session create failed:', {
      type: e?.type, code: e?.code, param: e?.param, message: e?.message,
    })
    return jsonResponse(502, {
      error: 'Nu am putut porni plata. Reîncearcă în câteva momente.',
      code: 'checkout_create_failed',
    })
  }

  return jsonResponse(200, { url: session.url })
}
