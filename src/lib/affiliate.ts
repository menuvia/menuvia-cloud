// src/lib/affiliate.ts
// Captură și stocare cod de referral pentru programul de afiliere.
//
// Flux: vizitatorul deschide `menuvia.ro/r/:cod` → captureReferralFromUrl()
// salvează codul într-un cookie de 90 de zile și rescrie URL-ul la `/` (fără
// reîncărcare). La checkout, getStoredReferral() oferă codul, care e trimis
// către `stripe-checkout` și, mai departe, către RPC-ul de atribuire.
//
// Cookie funcțional (nu de tracking publicitar): identifică afiliatul care a
// adus clientul. Menționat în politica de cookies; nu necesită consimțământ de
// marketing fiindcă e strict necesar fluxului de atribuire afiliat.

import { supabase } from './supabase'

const REFERRAL_COOKIE = 'mv_ref'
const VISITOR_COOKIE = 'mv_vid'
const MAX_AGE_DAYS = 90

// Codurile de referral respectă `^[a-z0-9]{6,32}$` (vezi mig 097). Sanitizăm
// la fel atât la scriere cât și la citire ca să nu stocăm gunoi.
function sanitizeCode(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32)
}

function isValidCode(code: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(code)
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`
  const parts = document.cookie ? document.cookie.split('; ') : []
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length))
    }
  }
  return null
}

function writeCookie(name: string, value: string): void {
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60
  // SameSite=Lax: cookie-ul supraviețuiește navigării de pe link-ul afiliat
  // către signup/checkout pe același site. Secure pe HTTPS (prod).
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`
}

// id anonim per-vizitator, folosit pentru gate-ul de incrementality (corelează
// touch-ul de la /r/:cod cu conversia de la checkout). Generat o singură dată.
function getOrCreateVisitorId(): string {
  const existing = readCookie(VISITOR_COOKIE)
  if (existing) return existing
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `v-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  writeCookie(VISITOR_COOKIE, id)
  return id
}

/** Întoarce visitor_id-ul stocat (sau null dacă nu există încă). */
export function getVisitorId(): string | null {
  return readCookie(VISITOR_COOKIE)
}

/**
 * Dacă URL-ul curent e `/r/:cod`, salvează codul în cookie și rescrie URL-ul la
 * `/` (sau la calea originală fără segmentul de referral). Apelat o singură dată
 * la bootstrap, ÎNAINTE de randarea router-ului. Returnează codul capturat sau null.
 */
export function captureReferralFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/r\/([^/]+)\/?$/)
  if (!match) return null

  const code = sanitizeCode(match[1])
  if (!isValidCode(code)) {
    // Cod malformat → curățăm URL-ul oricum, fără să stocăm nimic.
    window.history.replaceState({}, '', '/')
    return null
  }

  writeCookie(REFERRAL_COOKIE, code)
  // Înregistrăm touch-ul server-side (incrementality fail-closed): corelăm
  // visitor_id-ul cu această vizită reală pe /r/:cod. Fire-and-forget — nu
  // blocăm randarea și ignorăm erorile (cookie blocat, anon etc.).
  const visitorId = getOrCreateVisitorId()
  // .rpc() întoarce un PromiseLike (fără .catch) → forma then(onOk, onErr).
  void supabase
    .rpc('record_affiliate_touch', { p_referral_code: code, p_visitor_id: visitorId })
    .then(
      () => undefined,
      (err: unknown) => {
        // Fire-and-forget, dar logăm eroarea (diagnosticabil când atribuirea pică în prod).
        console.warn('[affiliate] record_affiliate_touch failed:', err)
      },
    )
  // Rescriem la rădăcină — landing-ul decide de aici încolo. Codul rămâne în cookie.
  window.history.replaceState({}, '', '/')
  return code
}

/** Întoarce codul de referral stocat (validat) sau null. */
export function getStoredReferral(): string | null {
  const raw = readCookie(REFERRAL_COOKIE)
  if (!raw) return null
  const code = sanitizeCode(raw)
  return isValidCode(code) ? code : null
}

// Formatare monedă RO din minor-units (cents). 87000 → „870,00 RON".
// Cache-uim formatter-ele per monedă (Intl.NumberFormat e relativ scump de creat).
const formatterCache = new Map<string, Intl.NumberFormat>()

function getFormatter(currency: string): Intl.NumberFormat {
  let fmt = formatterCache.get(currency)
  if (!fmt) {
    fmt = new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    })
    formatterCache.set(currency, fmt)
  }
  return fmt
}

/**
 * Formatează o sumă în cents ca monedă în format românesc.
 * `currency` e opțional (default 'RON') → apelurile existente rămân neschimbate.
 */
export function formatRON(cents: number | null | undefined, currency = 'RON'): string {
  return getFormatter(currency).format((cents ?? 0) / 100)
}

/** Construiește URL-ul public de referral pentru un cod. */
export function referralUrl(code: string): string {
  const base = (import.meta.env.VITE_APP_URL as string | undefined) || window.location.origin
  return `${base.replace(/\/$/, '')}/r/${code}`
}
