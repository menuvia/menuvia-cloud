// netlify/functions/lib/livemode.js
// Gardă `livemode` pentru AMBELE webhook-uri Stripe (stripe-webhook.js și
// stripe-connect-webhook.js).
//
// De ce: cheile Stripe TEST nu au voie să ajungă în producție (cu ele cardul de
// test 4242 ar da Planul 3 gratuit — regula de aur), iar rândurile de test nu au
// voie să intre în registrul real de comisioane. Semnătura webhook-ului NU
// apără de asta: un endpoint de test cu secretul lui își semnează corect
// evenimentele. Singurul semnal e `event.livemode`, comparat cu modul cheii
// secrete a platformei (STRIPE_SECRET_KEY) — aceeași sursă pentru ambele
// webhook-uri.
//
// Contract (se apelează DUPĂ verificarea semnăturii și ÎNAINTE de orice efect —
// DB, email, Stripe, RPC):
//   - mod cheie „unknown" (lipsă / prefix străin) → 500 `livemode_unknown`,
//     FAIL-CLOSED: o configurare greșită trebuie să fie VIZIBILĂ, nu ocolită;
//   - `event.livemode` ≠ modul cheii → 200 `{received:true, ignored:'livemode_mismatch'}`
//     (Stripe NU trebuie să retrimită un eveniment din alt mod) + linia
//     `ALERT livemode mismatch`;
//   - `event.livemode` care nu e boolean (lipsă) → tratat ca nepotrivire.
// Logul nu conține secrete și nici payload: doar id-ul, tipul, livemode și modul.

'use strict'

// sk_/rk_ + live|test: cheia secretă și cheia restricționată. Orice altceva
// (pk_*, șir gol, whsec_*, typo) → 'unknown'.
function stripeKeyMode(key) {
  if (typeof key !== 'string') return 'unknown'
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live'
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test'
  return 'unknown'
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// Întoarce `null` când evenimentul poate fi procesat, altfel răspunsul HTTP
// final. `tag` = prefixul de log al funcției ('[stripe-webhook]' etc.).
function livemodeGuard(stripeEvent, secretKey, tag) {
  const keyMode = stripeKeyMode(secretKey)
  const ev = stripeEvent || {}
  const evLive = typeof ev.livemode === 'boolean' ? String(ev.livemode) : 'missing'
  const alert = () =>
    console.error(
      `${tag} ALERT livemode mismatch event=${ev.id} type=${ev.type} ` +
      `livemode=${evLive} key_mode=${keyMode}`,
    )

  if (keyMode === 'unknown') {
    alert()
    return json(500, { error: 'livemode_unknown' })
  }
  if (typeof ev.livemode !== 'boolean' || ev.livemode !== (keyMode === 'live')) {
    alert()
    return json(200, { received: true, ignored: 'livemode_mismatch' })
  }
  return null
}

module.exports = { stripeKeyMode, livemodeGuard }
