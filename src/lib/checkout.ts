// ─────────────────────────────────────────────────────────────
// checkout.ts — traducerea răspunsurilor lui `stripe-checkout` în mesaje
// pentru om.
//
// De ce există: funcția întoarce ZECE forme de răspuns non-200 (405 text
// simplu, 400 ×2, 401 ×2, 429, 503 ×3, 409, 500, iar din RES-11 și 502
// `checkout_create_failed`), iar clientul trata exact
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
// ─────────────────────────────────────────────────────────────

export type CheckoutAction = 'retry' | 'login' | 'billing' | 'contact'

export interface CheckoutFailure {
  code: string
  message: string
  action: CheckoutAction
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
 */
export function describeCheckoutFailure(status: number, body: unknown): CheckoutFailure {
  const code = serverCode(body)
  const msg = serverMessage(body)

  // Coduri explicite de business — au întotdeauna mesaj românesc de la server.
  if (code === 'subscription_exists') {
    // FĂRĂ concatenare: mesajul serverului spune deja „Schimbă planul din
    // Portalul de facturare", iar butonul de lângă banner poartă aceeași
    // etichetă — un adaos ar fi a treia repetiție a aceleiași propoziții.
    return {
      code,
      message: msg ?? 'Ai deja un abonament activ. Schimbi planul din Portalul de facturare.',
      action: 'billing',
    }
  }
  if (code === 'checkout_create_failed') {
    // Stripe a respins crearea sesiunii (RES-11: try/catch în stripe-checkout.js).
    // Tranzitoriu cel mai adesea; mesajul serverului e românesc.
    return {
      code,
      message: msg ?? 'Nu am putut porni plata. Reîncearcă în câteva momente.',
      action: 'retry',
    }
  }
  if (code === 'subscription_lookup_failed') {
    return {
      code,
      message: msg ?? 'Nu am putut verifica abonamentele existente. Reîncearcă în câteva momente.',
      action: 'retry',
    }
  }

  if (status === 0) {
    return {
      code: 'network',
      message: 'Nu am putut contacta serverul de plată. Verifică internetul și reîncearcă.',
      action: 'retry',
    }
  }
  if (status === 401) {
    return {
      code: 'auth',
      message: 'Sesiunea a expirat. Autentifică-te din nou și reia activarea.',
      action: 'login',
    }
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: msg ?? 'Prea multe încercări. Reîncearcă în câteva minute.',
      action: 'retry',
    }
  }
  if (status === 503) {
    return {
      code: 'unavailable',
      message: msg ?? 'Serviciu temporar indisponibil. Reîncearcă în câteva momente.',
      action: 'retry',
    }
  }
  if (status === 500) {
    // Cazul REAL de azi: funcțiile rulează fără variabile de mediu, deci
    // `Stripe not configured`. Clientul nu are ce repara — îl trimitem la noi.
    return {
      code: 'not_configured',
      message:
        'Plata online nu e disponibilă momentan. Scrie-ne pe WhatsApp și îți activăm planul manual.',
      action: 'contact',
    }
  }
  if (status === 400) {
    // Planul cerut nu are price ID în Stripe: mesajul serverului e românesc
    // și numește planul, deci merită păstrat.
    return {
      code: 'plan_unavailable',
      message: msg ?? 'Planul ales nu poate fi activat acum. Scrie-ne și îl activăm noi.',
      action: 'contact',
    }
  }

  return {
    code: 'unknown',
    message: msg ?? 'Nu am putut porni plata. Reîncearcă, iar dacă se repetă scrie-ne pe WhatsApp.',
    action: 'retry',
  }
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
