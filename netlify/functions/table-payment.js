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
  // Split pe itemi (mig 229)
  invalid_items: 400,
  items_already_claimed: 409,
}

const UUID_RE = /^[0-9a-f-]{36}$/i

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
  if (!token || !UUID_RE.test(sessionId) || !['create', 'cancel', 'bill'].includes(action)) {
    return jsonResponse(400, { error: 'token și session_id sunt obligatorii.' })
  }
  if (action === 'cancel' && !UUID_RE.test(paymentId)) {
    return jsonResponse(400, { error: 'payment_id este obligatoriu la anulare.' })
  }

  // Split pe itemi (mig 229): body.items nevid pe 'create' → begin_split_payment.
  // Validare de SHAPE aici (uuid + întreg 1..99, max 60); conținutul (există
  // itemul, e liber, sesiunea lui) se validează în RPC, sub lock-ul sesiunii.
  let claims = null
  if (action === 'create' && Array.isArray(body.items) && body.items.length > 0) {
    if (body.items.length > 60) {
      return jsonResponse(400, { error: 'Selecție prea mare.', hint: 'invalid_items' })
    }
    claims = []
    for (const it of body.items) {
      const id = it && typeof it.order_item_id === 'string' ? it.order_item_id : ''
      const qty = it ? Number(it.quantity) : NaN
      if (!UUID_RE.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        return jsonResponse(400, { error: 'Selecție invalidă.', hint: 'invalid_items' })
      }
      claims.push({ order_item_id: id, quantity: qty })
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Rate limit per sesiune (fail-closed, ca la stripe-checkout): un client
  // care tot regenerează intent-uri nu poate spama Stripe-ul localului.
  try {
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', {
      // Bucket separat pentru cancel: renunțarea (mecanism de siguranță) nu
      // trebuie să devină indisponibilă pentru că masa a tot deschis sheet-ul.
      // Bucket separat și pentru bill/split — nota se poate reîncărca des
      // (mai multe telefoane) fără să consume bugetul de create.
      p_function_name:
        action === 'cancel' ? 'table_payment_cancel'
        : action === 'bill' ? 'table_payment_bill'
        : claims ? 'table_payment_split'
        : 'table_payment',
      p_scope_key: sessionId,
      p_max_requests: action === 'bill' || claims ? 30 : 10,
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

  // Nota mesei pentru split (mig 229): comenzile deschise + cantitățile
  // rămase per item. Toată validarea (token+sesiune+gate-uri) e în RPC.
  if (action === 'bill') {
    let { data: bill, error: billErr } = await supabase.rpc('get_table_bill', {
      p_session_id: sessionId,
      p_token: token,
    })
    if (billErr) {
      const status = HINT_STATUS[billErr.hint] || (billErr.message?.includes('Featurea') ? 403 : 500)
      if (status === 500) console.error('[table-payment] bill failed:', billErr.message)
      return jsonResponse(status, { error: billErr.message, hint: billErr.hint || null })
    }

    // Curățare claims stale: intent-urile split neconfirmate >15 min (telefon
    // mort mid-flow) se anulează la Stripe cu disciplina provably-dead — DOAR
    // cancel-ul reușit eliberează claims-urile (settle 'canceled'). Un eșec de
    // cancel NU blochează nota (itemii respectivi rămân „în plată").
    const staleIntents = Array.isArray(bill.stale_split_intents) ? bill.stale_split_intents : []
    if (staleIntents.length > 0 && bill.stripe_account_id) {
      const stripeS = new Stripe(STRIPE_SECRET_KEY, { timeout: 6000, maxNetworkRetries: 0 })
      // Fiecare intent stale se anulează+settle-ază INDEPENDENT — perechea
      // cancel→settle rămâne serială per intent (settle DOAR după cancel reușit),
      // dar intent-urile diferite rulează în paralel ca nota să nu aștepte N×RTT.
      const results = await Promise.all(
        staleIntents.map(async (stale) => {
          try {
            await stripeS.paymentIntents.cancel(stale, { stripeAccount: bill.stripe_account_id })
          } catch (e) {
            if (!(e && e.payment_intent && e.payment_intent.status === 'canceled')) {
              // Ne-anulabil (posibil mid-confirm/succeeded) — îl lăsăm în pace.
              return false
            }
          }
          const { error: staleSettleErr } = await supabase.rpc('settle_table_payment', {
            p_intent_id: stale,
            p_outcome: 'canceled',
            p_error_info: 'Selecție abandonată (telefon inactiv) — anulată la încărcarea notei.',
          })
          if (staleSettleErr) {
            console.error('[table-payment] settle pe intent split stale a eșuat:', staleSettleErr.message)
            return false
          }
          return true
        }),
      )
      const freed = results.filter(Boolean).length
      // Claims eliberate → cantitățile rămase s-au schimbat; re-luăm nota.
      if (freed > 0) {
        const retry = await supabase.rpc('get_table_bill', { p_session_id: sessionId, p_token: token })
        if (!retry.error && retry.data) bill = retry.data
      }
    }

    // Câmpurile interne nu pleacă spre client.
    delete bill.stale_split_intents
    delete bill.stripe_account_id
    return jsonResponse(200, bill)
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
    const stripeC = new Stripe(STRIPE_SECRET_KEY, { timeout: 6000, maxNetworkRetries: 0 })
    try {
      await stripeC.paymentIntents.cancel(c.stripe_payment_intent_id, {
        stripeAccount: c.stripe_account_id,
      })
    } catch (e) {
      // „A plătit deja" DOAR cu dovadă explicită: unexpected_state se ridică
      // și pentru intent 'processing' (ne-anulabil, dar poate încă eșua) —
      // nu-i spunem clientului „plătit" pe un regex generic.
      const piStatus = e && e.payment_intent && e.payment_intent.status
      const already =
        piStatus === 'succeeded' ||
        (e && e.code === 'payment_intent_unexpected_state' && /succeeded/i.test(e.message || ''))
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

  // 1) Suma + gate-urile, server-side. Cu claims → split pe itemi (mig 229);
  // fără → toată nota (mig 211). Ambele întorc superseded_intents — bucla de
  // supersede de mai jos se aplică identic.
  const { data: begin, error: beginErr } = claims
    ? await supabase.rpc('begin_split_payment', {
        p_session_id: sessionId,
        p_token: token,
        p_claims: claims,
      })
    : await supabase.rpc('begin_table_payment', {
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

  const stripe = new Stripe(STRIPE_SECRET_KEY, { timeout: 6000, maxNetworkRetries: 0 })

  // 1b) Un singur intent live per sesiune (mig 211): intent-urile deschise de
  // alte telefoane la aceeași masă se anulează la Stripe ÎNAINTE de a crea
  // unul nou. Dacă unul a apucat să REUȘEASCĂ, nota e deja plătită — anulăm
  // rândul nou și refuzăm curat (altfel al doilea client ar plăti și el tot).
  const superseded = Array.isArray(begin.superseded_intents) ? begin.superseded_intents : []
  for (const oldIntent of superseded) {
    // Continuăm la crearea noului intent DOAR dacă cel vechi e DOVEDIT mort
    // (cancel reușit, ori Stripe confirmă că e deja 'canceled'). Orice altă
    // stare — 'succeeded', 'processing', 'requires_action', necunoscută, sau
    // o eroare de rețea la cancel — înseamnă că intent-ul vechi POATE încă
    // încasa: a continua ar dubla nota (fereastra `processing` din review).
    let provablyDead = false
    try {
      await stripe.paymentIntents.cancel(oldIntent, { stripeAccount: begin.stripe_account_id })
      provablyDead = true
      const { error: oldSettleErr } = await supabase.rpc('settle_table_payment', {
        p_intent_id: oldIntent,
        p_outcome: 'canceled',
        p_error_info: 'Înlocuit de o plată nouă (alt telefon la masă).',
      })
      if (oldSettleErr) {
        // Intent-ul E anulat la Stripe — webhook-ul de canceled va marca rândul.
        console.error('[table-payment] settle pe intent înlocuit a eșuat (webhook-ul preia):', oldSettleErr.message)
      }
    } catch (e) {
      // Deja anulat (ex. un begin anterior l-a curățat) = mort, benign.
      if (e && e.payment_intent && e.payment_intent.status === 'canceled') {
        provablyDead = true
      } else {
        console.error('[table-payment] cancel pe intent înlocuit — stare ne-terminală/eroare:',
          (e && e.payment_intent && e.payment_intent.status) || (e && e.message))
      }
    }
    if (!provablyDead) {
      // Nu putem dovedi că plata veche e moartă → posibil plătită/în curs.
      // Anulăm rândul nou și refuzăm, ca să NU încasăm nota a doua oară.
      const { error: cancelNewErr } = await supabase.rpc('cancel_table_payment', {
        p_payment_id: begin.payment_id,
        p_session_id: sessionId,
        p_token: token,
      })
      if (cancelNewErr) {
        console.error('[table-payment] anularea plății noi (supersede ne-mort) a eșuat:', cancelNewErr.message)
      }
      return jsonResponse(409, {
        error: 'O plată a acestei mese este deja în curs sau finalizată. Cere nota ospătarului dacă nu ai plătit tu.',
        hint: 'nothing_to_pay',
      })
    }
  }

  // 2) PaymentIntent pe contul conectat. Idempotency-Key = payment_id:
  // un retry de rețea al aceluiași begin NU dublează intent-ul.
  let intent
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: amountBani,
        // Moneda vine din RPC (mig 209 o gate-uiește pe RON cât timp bonul
        // fiscal e FiscalNet) — nu o hardcodăm ca să nu mintă la extindere.
        // NB: amountBani (*100) presupune monedă cu 2 zecimale — la relaxarea
        // gate-ului, zecimalele se iau per monedă (HUF are 0).
        currency: String(begin.currency || 'RON').toLowerCase(),
        automatic_payment_methods: { enabled: true },
        ...(feeBani > 0 ? { application_fee_amount: feeBani } : {}),
        description: claims ? 'Menuvia — parte din nota mesei' : 'Menuvia — nota mesei',
        metadata: {
          menuvia_payment_id: begin.payment_id,
          menuvia_kind: claims ? 'split' : 'table',
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
    // Eliberăm rândul nou (și claims-urile lui, la split) în loc să așteptăm
    // TTL-ul de 15 min — best-effort, rândul e 'created' fără intent.
    const { error: cancelErr } = await supabase.rpc('cancel_table_payment', {
      p_payment_id: begin.payment_id,
      p_session_id: sessionId,
      p_token: token,
    })
    if (cancelErr) {
      console.error('[table-payment] anularea după create-fail a eșuat:', cancelErr.message)
    }
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
    // Rândul nu are intent atașat (attach-ul a picat) → RPC-ul îl anulează
    // direct și eliberează claims-urile split (best-effort).
    const { error: rowCancelErr } = await supabase.rpc('cancel_table_payment', {
      p_payment_id: begin.payment_id,
      p_session_id: sessionId,
      p_token: token,
    })
    if (rowCancelErr) {
      console.error('[table-payment] anularea rândului după attach-fail a eșuat:', rowCancelErr.message)
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
