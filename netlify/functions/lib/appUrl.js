// netlify/functions/lib/appUrl.js
// Sursa UNICĂ a domeniului aplicației pentru funcțiile Netlify (și shim-ul VPS,
// care le rulează neschimbate). Înainte, 8 funcții aveau `menuvia.ro` scris de
// mână și ~37 de link-uri foloseau fallback-uri DIFERITE (`menuvia.ro` într-un
// loc, `menuvia.netlify.app` în altele, `APP_URL` vs `VITE_APP_URL`) — o a doua
// piață (menuvia.com) ar fi cerut să le găsești pe toate de mână.
//
// NU e o funcție Netlify: directorul `lib/` n-are `lib.js`/`index.js`, deci
// zip-it-and-ship-it nu-l expune, iar `deploy/server.js` listează doar
// fișierele `.js` din rădăcina lui `netlify/functions/`.
//
// Regula de rezolvare: prima valoare VALIDĂ din env, în ordinea cheilor
// (implicit APP_URL → VITE_APP_URL), altfel DEFAULT_APP_URL. „Validă" = origin
// https (sau http DOAR pe localhost — `netlify dev`); orice altceva (gol, typo,
// `javascript:`, http public) cade pe fallback — un link de email care pleacă
// spre o origine stricată e mai rău decât unul spre domeniul de producție.
// Se întoarce DOAR originea (fără cale, fără slash final).

'use strict'

// Domeniul de producție pe .ro — aceeași valoare ca APP_URL/VITE_APP_URL din
// blocul /etc/menuvia/env (docs/VPS_RUNBOOK.md) și din netlify.toml.
const RO_DOMAIN = 'menuvia.ro'
const DEFAULT_APP_URL = `https://${RO_DOMAIN}`

// Domeniul de email (expeditori, reply-to). NU se schimbă cu site-ul: Resend
// are verificat doar acest domeniu; un expeditor @menuvia.com ar fi respins.
const MAIL_DOMAIN = RO_DOMAIN
const FROM_HELLO = `Menuvia <hello@${MAIL_DOMAIN}>`
const FROM_PILOT_LEADS = `Menuvia Leads <pilot@${MAIL_DOMAIN}>`
const FROM_PILOT_CODVIA = `Codvia Comenzi <pilot@${MAIL_DOMAIN}>`
const FOUNDER_EMAIL = `radu@${MAIL_DOMAIN}`
const NOREPLY_EMAIL = `noreply@${MAIL_DOMAIN}`

// Originile .ro de pe care pot veni formularele publice (CORS).
const RO_SITE_ORIGINS = [DEFAULT_APP_URL, `https://www.${RO_DOMAIN}`]

const DEFAULT_KEYS = ['APP_URL', 'VITE_APP_URL']

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/** Originea normalizată dacă `raw` e acceptabil, altfel null. */
function normalizeOrigin(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let u
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  if (u.username || u.password) return null
  if (u.protocol === 'https:') return u.origin
  if (u.protocol === 'http:' && isLocalHost(u.hostname)) return u.origin
  return null
}

/**
 * Originea aplicației. `opts.keys` permite unei funcții să păstreze o
 * precedență proprie (ex. sitemap citește întâi `URL`, domeniul primar
 * Netlify); `opts.env` există pentru teste.
 */
function appUrl(opts = {}) {
  const env = opts.env || process.env
  const keys = opts.keys || DEFAULT_KEYS
  for (const k of keys) {
    const o = normalizeOrigin(env[k])
    if (o) return o
  }
  return DEFAULT_APP_URL
}

/** Link absolut: `appLink('/dashboard?tab=billing')`. */
function appLink(path, opts) {
  const p = typeof path === 'string' && path ? path : '/'
  return appUrl(opts) + (p.startsWith('/') ? p : `/${p}`)
}

module.exports = {
  RO_DOMAIN,
  DEFAULT_APP_URL,
  MAIL_DOMAIN,
  FROM_HELLO,
  FROM_PILOT_LEADS,
  FROM_PILOT_CODVIA,
  FOUNDER_EMAIL,
  NOREPLY_EMAIL,
  RO_SITE_ORIGINS,
  normalizeOrigin,
  appUrl,
  appLink,
}
