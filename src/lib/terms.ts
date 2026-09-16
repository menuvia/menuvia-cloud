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
 * Câte intenții ținem simultan. Sunt indexate pe email, nu într-un singur
 * slot: două înregistrări din taburi diferite se suprascriau, iar primul om
 * ajungea să vadă ecranul de acceptare deși bifase (recenzie CodeRabbit pe
 * #261). Plafonul ține `localStorage` mărginit — intențiile cele mai vechi
 * cad primele, iar pierderea uneia înseamnă doar o întrebare în plus.
 */
const MAX_PENDING = 5

type PendingMap = Record<string, string>

function readAll(): PendingMap {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: PendingMap = {}
    for (const [email, version] of Object.entries(parsed as Record<string, unknown>)) {
      if (email && typeof version === 'string' && version) out[email] = version
    }
    return out
  } catch {
    // Inclusiv JSON stricat (o cheie dintr-o versiune veche) → tratat ca gol.
    return {}
  }
}

function writeAll(map: PendingMap): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(map))
  } catch {
    // Private mode / cotă plină: rămâne ecranul de acceptare ca plasă.
  }
}

/**
 * Reține că omul a bifat Termenii la signup, ca să consemnăm după ce apare
 * sesiunea. `localStorage`, nu `sessionStorage`: confirmarea de email poate
 * veni în alt tab, la ore distanță.
 *
 * Indexat pe email deliberat: pe un dispozitiv partajat, A se înregistrează și
 * nu confirmă, apoi B se autentifică — o intenție fără email ar consemna în
 * contul lui B un consimțământ pe care nu l-a dat, adică exact defectul pe dos.
 */
export function storePendingTermsConsent(email: string, version: string = TERMS_VERSION): void {
  const key = email.toLowerCase()
  const map = readAll()
  delete map[key]
  const entries = Object.entries(map).slice(-(MAX_PENDING - 1))
  entries.push([key, version])
  writeAll(Object.fromEntries(entries))
}

/** Intenția păstrată pentru ACEST email, sau `null`. */
export function readPendingTermsConsent(email: string): PendingTermsConsent | null {
  if (!email) return null
  const key = email.toLowerCase()
  const version = readAll()[key]
  return version ? { version, email: key } : null
}

/** Șterge intenția unui singur cont (fără email: pe toate). */
export function clearPendingTermsConsent(email?: string): void {
  if (!email) {
    try {
      localStorage.removeItem(PENDING_KEY)
    } catch {
      /* ignore */
    }
    return
  }
  const map = readAll()
  delete map[email.toLowerCase()]
  writeAll(map)
}

/**
 * Consemnează acceptarea. Aruncă un `Error` REAL cu `code`/`hint` păstrate
 * (același tipar ca `createOrder`/`createReservationPublic`) — apelanții
 * afișează mesajul, nu îl înghit.
 */
export async function recordTermsAcceptance(
  version: string = TERMS_VERSION,
  email?: string,
): Promise<void> {
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
  // Curățăm DOAR intenția contului consemnat; ale altor conturi rămân.
  clearPendingTermsConsent(email)
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
