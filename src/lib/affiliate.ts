// src/lib/affiliate.ts
// Captură și stocare cod de referral pentru programul de afiliere.
//
// Flux: vizitatorul deschide `menuvia.ro/r/:cod` sau orice pagină cu `?ref=cod`
// → captureReferralFromUrl() salvează codul CANONIC într-un cookie de 90 de zile
// (vezi limita Safari mai jos) și curăță URL-ul fără reîncărcare. La checkout, getStoredReferral() oferă codul, care e trimis
// către `stripe-checkout` și, mai departe, către RPC-ul de atribuire.
//
// Cookie funcțional (nu de tracking publicitar): identifică afiliatul care a
// adus clientul. Menționat în politica de cookies; nu necesită consimțământ de
// marketing fiindcă e strict necesar fluxului de atribuire afiliat.

import { supabase } from './supabase'

const REFERRAL_COOKIE = 'mv_ref'
// Vanity capturat dar NErezolvat încă (RPC picat / plafon global / rețea /
// checkout înaintea răspunsului). Vezi „Vanity în așteptare" mai jos.
const PENDING_VANITY_COOKIE = 'mv_ref_pending'
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

// ── Captura linkului de referral (mig 295) ───────────────────────────────
// Două forme, ambele capturate ÎNAINTEA router-ului (main.tsx):
//   • `/r/:cod`            → rescris la `/` (păstrând query-ul și hash-ul);
//   • `?ref=COD` pe ORICE rută → parametrul se scoate, DESTINAȚIA rămâne
//     (ex. `/pricing?ref=abc&plan=growth` → `/pricing?plan=growth`).
// `:cod` poate fi codul (8 hex) SAU vanity_slug-ul afiliatului (097:66-67,
// `^[a-z0-9-]{2,40}$` — cu CRATIMĂ; vechiul sanitizeCode o ștergea, deci un
// vanity „ion-pop" devenea „ionpop", care nu potrivea nimic). Serverul
// (`resolve_referral_code`) întoarce codul CANONIC; cookie-ul și touch-ul îl
// primesc pe acela.
//
// LIMITĂ CUNOSCUTĂ (Safari/ITP): cookie-urile scrise din JavaScript expiră pe
// Safari după 7 zile (24h în unele cazuri de tracking), oricât ar cere
// Max-Age. Atribuirea de 90 de zile e deci „până la 90", iar pe iPhone poate fi
// 7. Remedierea reală e un cookie setat de SERVER (Set-Cookie pe un răspuns
// HTTP de pe același domeniu) — consemnat, neimplementat.

export interface ReferralCapture {
  /** Valoarea brută din URL, normalizată (lowercase, fără spații). */
  raw: string
  /** Calea + query + hash de păstrat (fără parametrul/segmentul de referral). */
  cleanUrl: string
}

const VANITY_RE = /^[a-z0-9-]{2,40}$/

/** Normalizare pentru cod SAU vanity: lowercase, păstrează cratima. */
export function normalizeReferralInput(input: string): string {
  return input.trim().toLowerCase().slice(0, 40)
}

/** Forma acceptată la captură (cod sau vanity). */
export function isReferralCandidate(value: string): boolean {
  return VANITY_RE.test(value)
}

/**
 * Funcție PURĂ: extrage referral-ul din `pathname` + `search` + `hash`.
 * Întoarce null dacă URL-ul nu conține niciun referral.
 */
export function parseReferralFromLocation(
  pathname: string,
  search: string,
  hash = '',
): ReferralCapture | null {
  const params = new URLSearchParams(search)
  const pathMatch = pathname.match(/^\/r\/([^/]+)\/?$/)
  let raw: string | null = null
  let path = pathname
  if (pathMatch) {
    let segment = pathMatch[1]
    try {
      segment = decodeURIComponent(segment)
    } catch {
      // segment malformat → îl folosim brut; validarea de mai jos îl respinge
    }
    raw = segment
    path = '/'
  }
  const refParam = params.get('ref')
  if (refParam !== null) {
    // Segmentul /r/:cod are prioritate; `ref` se scoate oricum din URL.
    if (raw === null) raw = refParam
    params.delete('ref')
  }
  if (raw === null) return null
  const qs = params.toString()
  return {
    raw: normalizeReferralInput(raw),
    cleanUrl: `${path}${qs ? `?${qs}` : ''}${hash}`,
  }
}

function recordTouch(code: string): void {
  // Înregistrăm touch-ul server-side (incrementality fail-closed): corelăm
  // visitor_id-ul cu această vizită reală. Fire-and-forget — nu blocăm
  // randarea și ignorăm erorile (cookie blocat, anon etc.).
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
}

/** Codul canonic de la server; null = necunoscut / inactiv / RPC indisponibil. */
async function resolveCanonical(candidate: string): Promise<{ code: string | null; known: boolean }> {
  try {
    const { data, error } = await supabase.rpc('resolve_referral_code', { p_code: candidate })
    if (error || !data) return { code: null, known: false }
    const body = data as { referral_code?: unknown; rate_limited?: unknown }
    if (body.rate_limited === true) return { code: null, known: false }
    const code = typeof body.referral_code === 'string' ? body.referral_code : null
    return { code: code && isValidCode(code) ? code : null, known: true }
  } catch {
    return { code: null, known: false }
  }
}

// ── Vanity în așteptare (recenzie #286) ──────────────────────────────────
// Un vanity (cu cratimă) NU trece de `isValidCode`, deci, spre deosebire de un
// cod clasic, nu poate fi scris direct în `mv_ref`: are nevoie de răspunsul lui
// `resolve_referral_code`. Dacă acel răspuns nu vine (eroare RPC, plafonul
// global 600/15 min, rețea) sau vine DUPĂ checkout, atribuirea se pierdea
// TĂCUT. Acum valoarea brută (validată, max 40 de caractere) stă într-un cookie
// separat cu ACELAȘI Max-Age de 90 de zile și se reîncearcă: la orice
// încărcare ulterioară (captureReferralFromUrl fără referral în URL) și înainte
// de checkout (resolvePendingReferral, cu timeout — nu blochează plata).
// Rezolvat → `mv_ref` primește codul canonic și cookie-ul în așteptare se
// șterge; serverul spune „necunoscut/inactiv" → se șterge (nu mai are rost);
// necunoscut (eșec) → rămâne pentru încercarea următoare.

function readPendingVanity(): string | null {
  try {
    const raw = readCookie(PENDING_VANITY_COOKIE)
    if (!raw) return null
    const value = normalizeReferralInput(raw)
    return isReferralCandidate(value) ? value : null
  } catch {
    return null
  }
}

function writePendingVanity(value: string): void {
  try {
    writeCookie(PENDING_VANITY_COOKIE, value)
  } catch {
    // cookie blocat → nimic de persistat; rămâne doar încercarea curentă
  }
}

function clearPendingVanity(): void {
  try {
    document.cookie = `${PENDING_VANITY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
  } catch {
    // ignorat
  }
}

/**
 * Aplică rezultatul rezolvării unui vanity aflat în așteptare. Șterge
 * cookie-ul în așteptare DOAR dacă el conține încă exact valoarea rezolvată —
 * o captură mai nouă (alt link) între timp nu are voie să fie ștearsă.
 */
function applyPendingResolution(value: string, res: { code: string | null; known: boolean }): void {
  if (res.code) {
    writeCookie(REFERRAL_COOKIE, res.code)
    if (readPendingVanity() === value) clearPendingVanity()
    recordTouch(res.code)
  } else if (res.known) {
    if (readPendingVanity() === value) clearPendingVanity()
  }
}

let pendingInFlight: Promise<void> | null = null

// O singură rezolvare în zbor: captura și pre-checkout-ul împart aceeași
// promisiune (altfel două touch-uri pentru aceeași vizită).
function resolvePendingNow(fresh?: string): Promise<void> {
  if (pendingInFlight && fresh === undefined) return pendingInFlight
  const value = fresh ?? readPendingVanity()
  if (!value) return Promise.resolve()
  const run: Promise<void> = resolveCanonical(value)
    .then((res) => applyPendingResolution(value, res))
    .catch(() => undefined)
    .finally(() => {
      if (pendingInFlight === run) pendingInFlight = null
    })
  pendingInFlight = run
  return run
}

/**
 * Înainte de checkout: dacă există un vanity nerezolvat, încearcă rezolvarea,
 * dar NU așteaptă mai mult de `timeoutMs`. Nu aruncă niciodată; un eșec lasă
 * checkout-ul să plece fără referral (și vanity-ul rămâne pentru data viitoare).
 */
export async function resolvePendingReferral(timeoutMs = 1500): Promise<void> {
  if (!readPendingVanity()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([resolvePendingNow(), timeout])
  } catch {
    // resolvePendingNow nu respinge; garda e pentru orice surpriză
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Dacă URL-ul curent conține un referral (`/r/:cod` sau `?ref=`), îl capturează
 * și curăță URL-ul (păstrând destinația). Apelat o singură dată la bootstrap,
 * ÎNAINTEA randării router-ului. Returnează valoarea capturată (normalizată)
 * sau null. Codul canonic ajunge în cookie asincron, după rezolvare. Fără
 * referral în URL, reîncearcă un vanity rămas în așteptare.
 */
export function captureReferralFromUrl(): string | null {
  const { pathname, search, hash } = window.location
  const cap = parseReferralFromLocation(pathname, search, hash)
  if (!cap) {
    void resolvePendingNow()
    return null
  }

  // URL-ul se curăță ÎNTOTDEAUNA (și pe valori malformate).
  window.history.replaceState(window.history.state, '', cap.cleanUrl)
  if (!isReferralCandidate(cap.raw)) return null

  // Un cod clasic (fără cratimă) se scrie IMEDIAT — comportamentul de până
  // acum, ca un checkout rapid să nu piardă atribuirea dacă rezolvarea întârzie.
  const looksLikeCode = isValidCode(cap.raw)
  if (looksLikeCode) {
    writeCookie(REFERRAL_COOKIE, cap.raw)
    // Ultimul link câștigă: un vanity vechi în așteptare nu are voie să
    // suprascrie mai târziu codul tocmai capturat.
    clearPendingVanity()
  } else {
    // Vanity: persistat ÎNAINTEA rezolvării, ca un checkout rapid sau un RPC
    // picat să nu-l piardă.
    writePendingVanity(cap.raw)
  }

  if (!looksLikeCode) {
    void resolvePendingNow(cap.raw)
    return cap.raw
  }

  void resolveCanonical(cap.raw).then((res) => {
    const { code, known } = res
    if (code) {
      if (code !== cap.raw) writeCookie(REFERRAL_COOKIE, code)
      recordTouch(code)
    } else if (!known) {
      // RPC indisponibil (DB fără 295 / rețea / plafon) → contractul vechi:
      // codul brut, validat de server la touch și la checkout.
      recordTouch(cap.raw)
    }
  })
  return cap.raw
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
