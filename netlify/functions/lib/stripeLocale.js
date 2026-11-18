// netlify/functions/lib/stripeLocale.js
// Limba paginilor Stripe (Checkout, Portalul de facturare) = limba panoului
// personalului (lotul L8d).
//
// Clientul trimite în corp `ui_lang` — limba REZOLVATĂ a interfeței
// (`useUiLang()`, deci doar o limbă activă pentru personal). Serverul o
// validează pe lista ÎNCHISĂ a limbilor personalului (`STAFF_LANGS` din
// lib/emailLang.js, oglinda lui `src/i18n/langs.ts`, ținută de EL5 — fără o a
// doua listă) și o dă lui Stripe ca `locale` DOAR când e validă. Toate patru
// (ro/en/fr/de) sunt locale acceptate și de Checkout, și de Portal.
//
// Absent / invalid (client vechi, valoare străină, alt tip) → `null`, iar
// apelantul NU pune cheia `locale` deloc: Stripe rămâne pe „auto” (limba
// browserului), exact comportamentul de dinainte. Nu aruncă niciodată: o
// etichetă de limbă nu are voie să blocheze o plată.
'use strict'

const { STAFF_LANGS } = require('./emailLang')

function stripeLocale(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return STAFF_LANGS.includes(s) ? s : null
}

module.exports = { stripeLocale }
