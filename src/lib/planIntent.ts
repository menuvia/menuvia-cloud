// ─────────────────────────────────────────────────────────────
// planIntent.ts — planul-țintă ales pe pricing/landing, păstrat între
// pricing → /auth → (confirmarea emailului) → checkout.
//
// Defectul reparat (PR 5, „drumul spre primul leu"): intenția stătea în
// `sessionStorage`, iar linkul de confirmare din email se deschide într-un tab
// NOU — adică într-o sesiune de storage nouă, fără intenție. Restaurantul nou
// confirma contul și ateriza pe /dashboard, nu pe checkout: funelul se rupea
// exact între „Începe" și primul leu.
//
// Acum intenția stă în `localStorage` (legată de un cont — vezi „Cui aparține”) cu un TTL de
// 24 h — o intenție expirată e IGNORATĂ și ștearsă, ca un click vechi de o
// săptămână să nu arunce pe cineva în Stripe la următorul login. Linkul de
// confirmare poartă în plus `?plan=` (`authRedirectUrl`), deci funcționează și
// pe ALT dispozitiv, unde storage-ul local nu ajută deloc.
//
// Storage-ul poate ARUNCA (Safari cu „Block All Cookies", unele webview-uri —
// clasa RESID-15): fiecare acces e în try/catch și cade FAIL-OPEN pe „fără
// intenție", niciodată pe o excepție care ar urca la ErrorBoundary.
// ─────────────────────────────────────────────────────────────

const PLAN_INTENT_KEY = 'menuvia.plan_intent'
/**
 * Marcajul de TAB (sessionStorage) al unei intenții încă NElegate de un cont:
 * spune „intenția a fost aleasă în ACEST tab". Moare cu tab-ul.
 */
const PLAN_INTENT_TAB_KEY = 'menuvia.plan_intent_tab'

/** Cât rămâne valabilă intenția: destul pentru un email confirmat a doua zi. */
export const PLAN_INTENT_TTL_MS = 24 * 60 * 60 * 1000

export type PlanIntentId = 'starter' | 'growth' | 'pro'

export function isPlanIntentId(v: unknown): v is PlanIntentId {
  return v === 'starter' || v === 'growth' || v === 'pro'
}

// ── Cui aparține intenția (dispozitiv partajat) ──────────────────────────────
// Cu `localStorage` + TTL 24 h, o intenție fără proprietar trecea la ORICINE se
// autentifica pe același dispozitiv: pe tableta de la bar, vizitatorul alege
// „Meniu + Comenzi" și pleacă, iar ospătarul care se loghează după-amiază e
// trimis pe /pricing și în checkout pentru CONTUL LUI. Regula, cea mai simplă
// care e sigură (oglinda intenției de consimțământ din `terms.ts`):
//   1. La SIGNUP intenția se LEAGĂ de emailul contului nou (`bindPlanIntentToEmail`)
//      — doar ea traversează taburi (confirmarea de email se deschide în alt
//      tab) și e onorată DOAR pentru sesiunea cu acel email.
//   2. O intenție NElegată (aleasă înainte de autentificare, fără signup — ex.
//      un cont existent care se loghează din /pricing) e onorată DOAR în tab-ul
//      în care a fost aleasă (marcaj în `sessionStorage`), adică de prima
//      sesiune care apare acolo; un tab nou, sau browserul redeschis, n-o vede.
//   3. O intenție legată de alt email NU se re-leagă și nu se onorează.
// Rezidual acceptat: în ACELAȘI tab rămas deschis, un om care se loghează după
// ce altcineva a ales un plan ajunge pe Stripe Checkout — fără nicio plată
// făcută (Stripe cere cardul explicit), iar o intenție consumată dispare.
// `?plan=` din linkul de confirmare e tot per-tab (vine în URL-ul tab-ului).

interface StoredIntent {
  plan: PlanIntentId
  at: number
  /** Emailul contului (lowercase) sau null = încă nelegată, valabilă doar în tab. */
  email: string | null
}

function normEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e ? e : null
}

function parseStored(raw: string | null): StoredIntent | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const rec = parsed as Record<string, unknown>
    if (!isPlanIntentId(rec.plan)) return null
    if (typeof rec.at !== 'number' || !Number.isFinite(rec.at)) return null
    const email = typeof rec.email === 'string' ? normEmail(rec.email) : null
    return { plan: rec.plan, at: rec.at, email }
  } catch {
    // JSON stricat sau valoarea brută din versiunea pe sessionStorage.
    return null
  }
}

function hasTabMarker(): boolean {
  try {
    return sessionStorage.getItem(PLAN_INTENT_TAB_KEY) === '1'
  } catch {
    return false
  }
}

/** Intenția stocată, VALIDĂ ca timp (neexpirată), fără verificarea proprietarului. */
function readStoredFresh(now: number): StoredIntent | null {
  try {
    const raw = localStorage.getItem(PLAN_INTENT_KEY)
    if (raw === null) return null
    const stored = parseStored(raw)
    // Data din viitor (ceas dat înapoi) e tratată tot ca expirată: altfel
    // intenția ar putea trăi oricât.
    if (stored && now - stored.at >= 0 && now - stored.at < PLAN_INTENT_TTL_MS) return stored
    localStorage.removeItem(PLAN_INTENT_KEY)
  } catch {
    /* storage indisponibil — „fără intenție" */
  }
  return null
}

/** E intenția stocată a acestei identități (null = vizitator neautentificat)? */
function ownedBy(stored: StoredIntent, email: string | null): boolean {
  if (stored.email !== null) return stored.email === email
  return hasTabMarker()
}

/**
 * Intenția validă (neexpirată) care APARȚINE acestei identități, sau null.
 * `email` = emailul sesiunii curente (null pentru un vizitator neautentificat —
 * vede doar intenția aleasă în tab-ul lui). O intenție expirată sau stricată se
 * ȘTERGE la citire; una a altui cont e lăsată în pace (nu e a noastră).
 *
 * Compatibilitate: un tab deschis înainte de deploy are intenția în
 * `sessionStorage`, ca text simplu — e per-tab prin construcție, deci o citim.
 */
export function readPlanIntent(
  email: string | null | undefined,
  now: number = Date.now(),
): PlanIntentId | null {
  const stored = readStoredFresh(now)
  if (stored && ownedBy(stored, normEmail(email))) return stored.plan
  try {
    const legacy = sessionStorage.getItem(PLAN_INTENT_KEY)
    if (isPlanIntentId(legacy)) return legacy
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Consumă intenția. Fără argument: pe toate (ex. întoarcerea din Stripe).
 * Cu `email`: DOAR dacă intenția e a acestei identități — un login străin pe
 * /pricing nu are voie să șteargă intenția legată de contul altcuiva.
 */
export function clearPlanIntent(email?: string | null, now: number = Date.now()): void {
  const all = email === undefined
  try {
    const stored = all ? null : readStoredFresh(now)
    if (all || (stored && ownedBy(stored, normEmail(email)))) {
      localStorage.removeItem(PLAN_INTENT_KEY)
    }
  } catch {
    /* ignore (private mode) */
  }
  try {
    sessionStorage.removeItem(PLAN_INTENT_KEY)
    sessionStorage.removeItem(PLAN_INTENT_TAB_KEY)
  } catch {
    /* ignore (private mode) */
  }
}

/** Intenție NElegată, aleasă în acest tab (pricing/landing/`?plan=`). */
export function writePlanIntent(plan: string, now: number = Date.now()): void {
  // Doar planurile cunoscute: o valoare oarecare dintr-un URL nu are ce căuta
  // în drumul spre checkout.
  if (!isPlanIntentId(plan)) return
  const value: StoredIntent = { plan, at: now, email: null }
  try {
    localStorage.setItem(PLAN_INTENT_KEY, JSON.stringify(value))
  } catch {
    /* ignore (private mode) — `?plan=` din URL rămâne plasa */
  }
  try {
    sessionStorage.setItem(PLAN_INTENT_TAB_KEY, '1')
  } catch {
    /* ignore (private mode) */
  }
}

/**
 * Leagă intenția aleasă în ACEST tab de contul care tocmai s-a creat/autentificat
 * aici, ca s-o poată onora și tab-ul de confirmare a emailului. O intenție
 * nevăzută din acest tab, sau deja legată de ALT email, rămâne neatinsă.
 */
export function bindPlanIntentToEmail(email: string, now: number = Date.now()): void {
  const e = normEmail(email)
  if (!e) return
  const stored = readStoredFresh(now)
  if (!stored || !ownedBy(stored, e)) return
  const value: StoredIntent = { plan: stored.plan, at: now, email: e }
  try {
    localStorage.setItem(PLAN_INTENT_KEY, JSON.stringify(value))
  } catch {
    /* ignore (private mode) */
  }
}

/** Planul din `?plan=` al unui query string, dacă e unul cunoscut. */
export function planFromSearch(search: string): PlanIntentId | null {
  try {
    const p = new URLSearchParams(search).get('plan')
    return isPlanIntentId(p) ? p : null
  } catch {
    return null
  }
}

/**
 * Modul inițial al formularului de pe /auth. `/auth?plan=…` vine din „Începe"
 * pe un plan — adică de la cineva care NU are încă cont; a-l pune pe
 * „Autentificare" îl obliga să găsească singur comutatorul. Intenția păstrată
 * în storage NU contează aici: un om care revine să se logheze are deja cont.
 */
export function initialAuthMode(search: string): 'login' | 'signup' {
  return planFromSearch(search) ? 'signup' : 'login'
}

/**
 * URL-ul din linkul de confirmare a contului. Poartă `?plan=` când există o
 * intenție, ca funelul să supraviețuiască și unui click pe ALT dispozitiv.
 */
export function authRedirectUrl(origin: string, plan: PlanIntentId | null): string {
  const base = origin.replace(/\/+$/, '') + '/auth'
  return plan ? base + '?plan=' + encodeURIComponent(plan) : base
}

/**
 * Unde duce o sesiune nou apărută pe /auth când există o intenție validă A
 * ACESTUI cont: pe /pricing, unde `usePlanIntentAutoCheckout` pornește plata.
 * null = fără intenție, se aplică destinația obișnuită pe roluri. Folosit de
 * auto-redirect-ul din `App.tsx` (confirmarea din alt tab) și de `onSuccess`.
 *
 * `search`: `?plan=` din URL-ul tab-ului (linkul de confirmare, inclusiv pe ALT
 * dispozitiv, unde storage-ul e gol) — per-tab prin construcție, deci se scrie
 * ca intenție a tab-ului și se onorează.
 */
export function planIntentDestination(
  email: string | null | undefined,
  search: string = '',
  now: number = Date.now(),
): '/pricing' | null {
  const fromUrl = planFromSearch(search)
  if (fromUrl) {
    writePlanIntent(fromUrl, now)
    return '/pricing'
  }
  return readPlanIntent(email, now) ? '/pricing' : null
}
