// netlify/functions/lib/jsonBody.js
// Corpul JSON al unei cereri POST, citit O SINGURĂ dată, la fel în toate
// funcțiile din contractul de eroare al personalului (lotul L8d,
// tests/functions/fn-error-code-ratchet.test.js).
//
// De ce: `JSON.parse('null')` REUȘEȘTE, deci ramura `bad_json` nu se lua, iar
// prima citire de proprietate (`body.plan`, `const { restaurant_id } = body`)
// arunca un TypeError neprins: platforma răspundea cu un 5xx fără corp de
// contract, fără `code` — exact clasa pe care L8d o închide. Era așa în șapte
// din cele opt funcții (doar stripe-portal se apăra singur).
//
// Contract:
//   - corp lipsă sau gol → `{}`, ca înainte (`event.body ? … : {}` și
//     `event.body || '{}'` dădeau același lucru);
//   - JSON valid care e un OBIECT simplu → obiectul;
//   - ne-JSON SAU JSON care nu e obiect (`null`, un număr, un șir, `true`, un
//     tablou) → ARUNCĂ, iar apelantul răspunde cu ramura lui `bad_json`
//     existentă (niciun răspuns nou, deci registrul FEC2 nu se schimbă).
//     Un tablou sau un scalar nu e o cerere: înainte cădea pe validările de
//     după (`plan_unavailable`, `missing_restaurant` …), cu un mesaj care
//     descria alt defect. Niciun client al aplicației nu trimite așa ceva.
'use strict'

function parseObjectBody(raw) {
  if (!raw) return {}
  const value = JSON.parse(raw)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Corpul cererii nu e un obiect JSON')
  }
  return value
}

module.exports = { parseObjectBody }
