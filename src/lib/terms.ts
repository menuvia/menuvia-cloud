// ─────────────────────────────────────────────────────────────
// terms.ts — consemnarea consimțământului la Termeni (mig 042).
//
// Defectul reparat: `record_terms_acceptance` cere `auth.uid()`, iar pe prod
// confirmarea de email e PORNITĂ, deci `signUp` întoarce `session = null` prin
// construcție. RPC-ul era chemat imediat după signup, pica mereu cu
// „Autentificare necesară", iar eșecul era un `console.warn`. Rezultatul,
// măsurat pe producție: 0 din 7 conturi au `terms_accepted_at`, inclusiv unul
// creat la 10 zile după ce codul fusese livrat. Consimțământul nu se poate
// reconstitui retroactiv, deci fiecare zi adăuga o gaură permanentă.
//
// Forma corectă: bifa de la signup se PĂSTREAZĂ local ca intenție, iar
// consemnarea se face la PRIMA sesiune autentificată (confirmarea de email,
// sau primul login). Pentru conturile care n-au nicio intenție păstrată
// (istorice, sau alt dispozitiv) rămâne ecranul de acceptare din
// `TermsAcceptanceGate`.
//
// RPC-ul e idempotent (`coalesce(terms_accepted_at, now())`), deci o a doua
// consemnare NU rescrie data primei acceptări.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

/** Versiunea de Termeni prezentată azi în UI. */
export const TERMS_VERSION = '1.0'

const PENDING_KEY = 'menuvia.terms_pending'

export interface PendingTermsConsent {
  version: string
  /** Emailul care a bifat — intenția NU se moștenește între conturi. */
  email: string
}

/**
 * Reține că omul a bifat Termenii la signup, ca să consemnăm după ce apare
 * sesiunea. `localStorage`, nu `sessionStorage`: confirmarea de email poate
 * veni în alt tab, la ore distanță.
 *
 * Emailul e parte din cheie deliberat: pe un dispozitiv partajat, A se
 * înregistrează și nu confirmă, apoi B se autentifică — fără potrivire de
 * email am consemna în contul lui B un consimțământ pe care B nu l-a dat,
 * adică exact defectul pe care îl reparăm, pe dos.
 */
export function storePendingTermsConsent(email: string, version: string = TERMS_VERSION): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version, email: email.toLowerCase() }))
  } catch {
    // Private mode / cotă plină: rămâne ecranul de acceptare ca plasă.
  }
}

export function readPendingTermsConsent(): PendingTermsConsent | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { version, email } = parsed as { version?: unknown; email?: unknown }
    if (typeof version !== 'string' || !version) return null
    if (typeof email !== 'string' || !email) return null
    return { version, email }
  } catch {
    // Inclusiv JSON stricat (versiune veche de cheie) → tratat ca absent.
    return null
  }
}

/** Intenția păstrată aparține sesiunii curente? */
export function pendingConsentMatches(
  pending: PendingTermsConsent | null,
  email: string | null | undefined,
): boolean {
  if (!pending || !email) return false
  return pending.email === email.toLowerCase()
}

export function clearPendingTermsConsent(): void {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Consemnează acceptarea. Aruncă un `Error` REAL cu `code`/`hint` păstrate
 * (același tipar ca `createOrder`/`createReservationPublic`) — apelanții
 * afișează mesajul, nu îl înghit.
 */
export async function recordTermsAcceptance(version: string = TERMS_VERSION): Promise<void> {
  const { error } = await supabase.rpc('record_terms_acceptance', { p_version: version })
  if (error) {
    const err = new Error(
      error.message || 'Nu am putut consemna acceptarea Termenilor.',
    ) as Error & {
      code?: string
      hint?: string
    }
    err.code = error.code
    err.hint = error.hint ?? undefined
    throw err
  }
  clearPendingTermsConsent()
}

/**
 * Are nevoie contul de ecranul de acceptare?
 *
 * TRISTATE deliberat: `null` (profil neîncărcat, sau interogare picată) NU
 * înseamnă „nu a acceptat". Un blip de rețea nu are voie să blocheze
 * dashboard-ul unui om care a acceptat deja — aceeași disciplină ca tristate-ul
 * de plan din WaiterPage și ca bannerul casei neconectate.
 */
export function needsTermsAcceptance(
  profile: { terms_accepted_at?: string | null } | null | undefined,
): boolean {
  if (!profile) return false
  return !profile.terms_accepted_at
}
