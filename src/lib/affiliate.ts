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

const REFERRAL_COOKIE = 'mv_ref'
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

function writeReferralCookie(code: string): void {
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60
  // SameSite=Lax: cookie-ul supraviețuiește navigării de pe link-ul afiliat
  // către signup/checkout pe același site. Secure pe HTTPS (prod).
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`
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

  writeReferralCookie(code)
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
