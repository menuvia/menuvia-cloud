// ─────────────────────────────────────────────────────────────
// checkout.ts — traducerea răspunsurilor lui `stripe-checkout` în mesaje
// pentru om.
//
// De ce există: funcția întoarcea NOUĂ forme de răspuns non-200 (405 text
// simplu, 400 ×2, 401 ×2, 429, 503 ×3, 409, 500 — din L8d și 502
// `checkout_create_failed` + 409 `checkout_in_progress`, iar fiecare JSON
// poartă `code`), iar clientul trata exact
// DOUĂ dintre ele — restul lăsau butonul mut, adică omul apăsa „Activează",
// nu se întâmpla nimic vizibil și pleca. E cel mai scump click din produs.
//
// Disciplina de mesaje: textele ÎN ROMÂNĂ venite de la server sunt scrise
// pentru client și se afișează ca atare; cele în engleză sunt interne
// (`Stripe not configured`, `Invalid token`, …) și se ÎNLOCUIESC — un mesaj
// intern arătat clientului e tot o formă de tăcere.
//
// `action` spune interfeței ce să ofere mai departe; `code` e stabil pentru
// teste și telemetrie (mesajele se pot rescrie fără să rupă testele).
//
// Limba (lotul L8d): fiecare eșec poartă `key`, cheia textului din namespace-ul
// `home` (`ck_*`), iar `describeCheckoutFailure` primește opțional un
// traducător. Fără traducător — singurul apelant de azi, pagina de prețuri,
// site de marketing în română prin decizie — ieșirea e EXACT cea de dinainte.
// Cu traducător, regula e a lui `describeStaffError`: textul românesc al
// serverului se păstrează DOAR în română; în altă limbă ramura dă textul
// cheii ei. Modulul stă în pachetul de INTRARE (App.tsx), deci namespace-ul nu
// se importă aici (SK4) — doar TIPUL lui, iar româna rezervelor e dublată în
// `CHECKOUT_MESSAGES_RO` (egalitatea o ține CH10).
//
// Adresa de contact din texte (`{email}`) vine din `CONTACT_EMAIL`
// (lib/domain.ts, deja în pachetul de intrare) — aceeași rută pe care o
// numește serverul (`contact@${MAIL_DOMAIN}` în stripe-checkout.js).
// ─────────────────────────────────────────────────────────────
import type { Translator } from '../i18n/core'
import type homeRo from '../i18n/ns/home/ro'
import { CONTACT_EMAIL } from './domain'

export type CheckoutAction = 'retry' | 'login' | 'billing' | 'contact' | 'quote'

/** Rezervele românești ale ramurilor — EXACT `ck_*` din ns/home/ro.ts (CH10). */
export const CHECKOUT_MESSAGES_RO = {
  ck_subscriptionExists: 'Ai deja un abonament activ. Schimbi planul din Portalul de facturare.',
  ck_planRequiresQuote:
    'Planul Fiscalizare se activează pe bază de ofertă, împreună cu instalarea pe casa ta de marcat. Cere o ofertă.',
  ck_subscriptionLookupFailed: 'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.',
  ck_createFailed: 'Nu am putut porni plata. Reîncearcă în câteva momente, iar dacă se repetă scrie-ne la {email}.',
  ck_checkoutInProgress:
    'O plată pentru acest cont e deja în curs. Reîncearcă în câteva momente.',
  ck_network: 'Nu am putut contacta serverul de plată. Verifică internetul și reîncearcă.',
  ck_auth: 'Sesiunea a expirat. Autentifică-te din nou și reia activarea.',
  ck_rateLimited: 'Prea multe încercări. Reîncearcă în câteva minute.',
  ck_unavailable: 'Serviciu temporar indisponibil. Reîncearcă în câteva momente.',
  ck_notConfigured:
    'Plata online nu e disponibilă momentan. Contactează-ne și îți activăm planul manual.',
  ck_planUnavailable: 'Planul ales nu poate fi activat acum. Scrie-ne și îl activăm noi.',
  ck_unknown: 'Nu am putut porni plata. Reîncearcă, iar dacă se repetă scrie-ne pe email.',
}

export type CheckoutMessageKey = keyof typeof CHECKOUT_MESSAGES_RO

/** Traducătorul de care are nevoie `describeCheckoutFailure` (namespace-ul `home`). */
export type CheckoutTranslator = Pick<Translator<typeof homeRo>, 'lang' | 't'>

export interface CheckoutFailure {
  code: string
  message: string
  action: CheckoutAction
  /** Cheia textului ramurii (ns `home`), pentru o afișare localizată. */
  key?: CheckoutMessageKey
}

/** Mesaje interne (engleză) care NU au ce căuta în fața clientului. */
const INTERNAL_MESSAGES = new Set([
  'Stripe not configured',
  'Invalid JSON body',
  'Missing Authorization header',
  'Invalid token',
  'Rate limit service unavailable',
  'Method not allowed',
])

function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = (body as { error?: unknown }).error
  if (typeof raw !== 'string') return null
  const msg = raw.trim()
  if (!msg || INTERNAL_MESSAGES.has(msg)) return null
  return msg
}

function serverCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = (body as { code?: unknown }).code
  return typeof raw === 'string' && raw ? raw : null
}

/**
 * Traduce un răspuns non-200 al funcției de checkout într-un mesaj afișabil.
 *
 * @param status codul HTTP (0 pentru „n-am ajuns la server")
 * @param body corpul parsat, sau `null` dacă nu era JSON (ex. 405 text simplu)
 * @param tr traducătorul ns `home` în limba ecranului; lipsă = româna de azi
 */
export function describeCheckoutFailure(
  status: number,
  body: unknown,
  tr?: CheckoutTranslator,
): CheckoutFailure {
  const serverCodeValue = serverCode(body)
  // Textul românesc al serverului: doar pe un ecran în română (fără traducător
  // sau cu traducător românesc). În altă limbă ar face ecranul amestecat.
  const msg = !tr || tr.lang === 'ro' ? serverMessage(body) : null
  // `{email}` = ruta de suport; o cheie fără loc pentru el rămâne neschimbată.
  const text = (key: CheckoutMessageKey): string =>
    tr ? tr.t(key, { email: CONTACT_EMAIL }) : CHECKOUT_MESSAGES_RO[key].replace('{email}', CONTACT_EMAIL)
  // `server` = textul serverului pe ramurile care îl păstrează, `null` pe cele
  // care îl înlocuiesc mereu (rețea, sesiune, configurare).
  const failure = (
    code: string,
    key: CheckoutMessageKey,
    action: CheckoutAction,
    server: string | null,
  ): CheckoutFailure => ({ code, key, action, message: server ?? text(key) })

  // Coduri explicite de business — au întotdeauna mesaj românesc de la server.
  // `subscription_exists`: FĂRĂ concatenare — mesajul serverului spune deja
  // „Schimbă planul din Portalul de facturare", iar butonul de lângă banner
  // poartă aceeași etichetă; un adaos ar fi a treia repetiție.
  if (serverCodeValue === 'subscription_exists')
    return failure(serverCodeValue, 'ck_subscriptionExists', 'billing', msg)
  // Planul 3 (Fiscalizare) nu se cumpără singur: butonul de pe pagina de
  // prețuri nu ajunge aici, dar un client vechi sau un POST direct da.
  if (serverCodeValue === 'plan_requires_quote')
    return failure(serverCodeValue, 'ck_planRequiresQuote', 'quote', msg)
  if (serverCodeValue === 'subscription_lookup_failed')
    return failure(serverCodeValue, 'ck_subscriptionLookupFailed', 'retry', msg)
  // Stripe a respins crearea clientului sau a sesiunii (lotul L8d: înainte,
  // excepție neprinsă, fără corp). Tranzitoriu cel mai adesea; textul numește
  // adresa de suport pentru cazul în care se repetă (acțiunea rămâne `retry`).
  if (serverCodeValue === 'checkout_create_failed')
    return failure(serverCodeValue, 'ck_createFailed', 'retry', msg)
  // 409: o plată a contului e deja în mișcare și serverul n-a putut garanta una
  // singură (sesiunile deschise necitibile / neînchise, sau o cerere simultană
  // cu aceeași cheie). Reîncercarea, peste câteva momente, o reia sau o închide.
  if (serverCodeValue === 'checkout_in_progress')
    return failure(serverCodeValue, 'ck_checkoutInProgress', 'retry', msg)

  if (status === 0) return failure('network', 'ck_network', 'retry', null)
  // 401 = sesiune expirată → autentificare, nu „reîncearcă".
  if (status === 401) return failure('auth', 'ck_auth', 'login', null)
  if (status === 429) return failure('rate_limited', 'ck_rateLimited', 'retry', msg)
  if (status === 503) return failure('unavailable', 'ck_unavailable', 'retry', msg)
  // Cazul REAL de azi: funcțiile rulează fără variabile de mediu, deci
  // `Stripe not configured`. Clientul nu are ce repara — îl trimitem la noi.
  if (status === 500) return failure('not_configured', 'ck_notConfigured', 'contact', null)
  // Planul cerut nu are price ID în Stripe: mesajul serverului e românesc
  // și numește planul, deci merită păstrat.
  if (status === 400) return failure('plan_unavailable', 'ck_planUnavailable', 'contact', msg)

  return failure('unknown', 'ck_unknown', 'retry', msg)
}

/** Eroare aruncată de fluxul de checkout — poartă codul și acțiunea sugerată. */
export class CheckoutError extends Error {
  code: string
  action: CheckoutAction
  constructor(failure: CheckoutFailure) {
    super(failure.message)
    this.name = 'CheckoutError'
    this.code = failure.code
    this.action = failure.action
  }
}

/**
 * Extrage URL-ul de redirect dintr-un răspuns 200, validat.
 *
 * Validarea nu e ceremonie: valoarea ajunge direct în `window.location.href`,
 * deci acceptăm DOAR https absolut. Orice altceva → null (tratat ca eșec).
 */
export function readCheckoutUrl(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const url = (body as { url?: unknown }).url
  if (typeof url !== 'string' || !url) return null
  try {
    // Parsare reală, nu `startsWith('https://')`: acela accepta și `https://`
    // gol, pe care atribuirea în `window.location.href` îl poate arunca în
    // afara oricărui `catch` (recenzie CodeRabbit pe #261).
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null
    return url
  } catch {
    return null
  }
}
