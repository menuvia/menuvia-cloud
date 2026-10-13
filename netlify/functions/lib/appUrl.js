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
// (implicit APP_URL → VITE_APP_URL), altfel `opts.fallback` (implicit
// DEFAULT_APP_URL).
//
// ATENȚIE — fallback-ul e PER APELANT, nu global: menuvia.ro NU e încă
// cumpărat, iar Netlify NU dă funcțiilor la runtime env-ul din netlify.toml
// (`VITE_APP_URL` de acolo e doar pentru build). Funcțiile care înainte cădeau
// pe `https://menuvia.netlify.app` (stripe-checkout, stripe-portal,
// ai-credits-checkout, send-invite, welcome-email, process-email-queue) își
// păstrează EXACT acel fallback ȘI cheile citite — altfel link-urile Stripe
// (success/cancel/return), token-urile de invitație și link-urile din emailuri
// ar pleca spre un domeniu neînregistrat. Doar funcțiile care aveau deja
// `menuvia.ro` scris de mână rămân pe DEFAULT_APP_URL. „Validă" = origin
// https (sau http DOAR pe localhost — `netlify dev`); orice altceva (gol, typo,
// `javascript:`, http public) cade pe fallback — un link de email care pleacă
// spre o origine stricată e mai rău decât unul spre domeniul de producție.
// Se întoarce DOAR originea (fără cale, fără slash final).

'use strict'

// Domeniul de producție pe .ro — aceeași valoare ca APP_URL/VITE_APP_URL din
// blocul /etc/menuvia/env (docs/VPS_RUNBOOK.md) și din netlify.toml.
const RO_DOMAIN = 'menuvia.ro'
const DEFAULT_APP_URL = `https://${RO_DOMAIN}`
// Domeniul .com (a doua piață). Folosit DOAR prin `siteAppUrl('com')`, la
// cererea explicită (validată pe allowlist) a clientului de pe menuvia.com.
const COM_DOMAIN = 'menuvia.com'
const COM_APP_URL = `https://${COM_DOMAIN}`
// Fallback-ul ISTORIC al funcțiilor de checkout/portal/invitație/email —
// singurul domeniu garantat viu cât timp menuvia.ro nu e cumpărat.
const LEGACY_NETLIFY_URL = 'https://menuvia.netlify.app'

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
 * Netlify); `opts.fallback` păstrează fallback-ul ISTORIC al apelantului
 * (trebuie să fie el însuși o origine validă, altfel DEFAULT_APP_URL);
 * `opts.env` există pentru teste.
 */
function appUrl(opts = {}) {
  const env = opts.env || process.env
  const keys = opts.keys || DEFAULT_KEYS
  for (const k of keys) {
    const o = normalizeOrigin(env[k])
    if (o) return o
  }
  return normalizeOrigin(opts.fallback) || DEFAULT_APP_URL
}

// Site-urile pe care clientul le poate CERE explicit. Allowlist STRICT: corpul
// cererii poartă doar eticheta ('ro'/'com'), niciodată o origine — o origine
// luată din body ar face din emailul de invitație un relay de phishing
// (link brandat Menuvia spre orice domeniu).
const SITE_ORIGINS = Object.freeze({ com: COM_APP_URL })

/**
 * Originea pentru site-ul cerut de client: 'com' → https://menuvia.com;
 * orice altceva (absent, 'ro', gunoi, URL) → `appUrl(opts)`, adică EXACT
 * comportamentul de dinainte al apelantului.
 */
function siteAppUrl(site, opts) {
  if (typeof site === 'string' && Object.prototype.hasOwnProperty.call(SITE_ORIGINS, site)) {
    return SITE_ORIGINS[site]
  }
  return appUrl(opts)
}

/** Link absolut: `appLink('/dashboard?tab=billing')`. */
function appLink(path, opts) {
  const p = typeof path === 'string' && path ? path : '/'
  return appUrl(opts) + (p.startsWith('/') ? p : `/${p}`)
}

module.exports = {
  RO_DOMAIN,
  DEFAULT_APP_URL,
  COM_APP_URL,
  LEGACY_NETLIFY_URL,
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
  siteAppUrl,
}
