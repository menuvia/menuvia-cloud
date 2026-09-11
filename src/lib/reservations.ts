// Rezervarea publică: cheia de idempotență + apelul RPC.
//
// De ce e nevoie (audit v3, RES-29): `ReservationSheet` se completează pe un
// telefon, pe rețea mobilă. Un dublu-tap pe „Rezervă", o revenire cu Back sau o
// reîncărcare după ce răspunsul s-a pierdut pe drum trimiteau A DOUA cerere —
// și, până la mig 273, a doua cerere însemna a doua REZERVARE: aceeași
// persoană, același interval, două mese blocate, două emailuri către local și,
// pe `auto_confirm`, două SMS-uri către client. Localul vedea o „dublă
// rezervare" pe care nimeni nu o făcuse intenționat.
//
// Cheia se citește la montarea formularului și se rotește DOAR pe SUCCES —
// aceeași regulă ca la comanda QR și la cea pickup. O rotire prea devreme face
// retrimiterea să pară o cerere nouă (dublura revine); una prea târziu face ca
// următoarea rezervare legitimă de pe același telefon să fie deduplicată tăcut
// de server (rezervare pierdută, fără niciun semn pentru client).

import { supabase } from './supabase'
import { createIdempotencyKeyStore } from './idempotency'

const reservationKeys = createIdempotencyKeyStore('menuvia_idem_resv:')

/** Cheia curentă pentru formularul de rezervare al unui restaurant (scope = id-ul
 *  localului: ne-opțional ȘI stabil, pe când slug-ul se poate schimba). */
export function getReservationIdempotencyKey(scope: string): string {
  return reservationKeys.get(scope)
}

/** Cheie nouă. Se apelează DUPĂ o rezervare confirmată de server. */
export function rotateReservationIdempotencyKey(scope: string): string {
  return reservationKeys.rotate(scope)
}

export interface CreateReservationArgs {
  p_slug: string
  p_customer_name: string
  p_customer_phone: string
  p_party_size: number
  p_starts_at: string
  p_customer_email: string | null
  p_special_requests: string | null
  p_duration_minutes: number | null
  p_zone: string | null
  p_table_id: string | null
}

export interface CreatedReservation {
  reservation_id: string
  confirmation_code: string
  status: string
  table_name: string | null
  starts_at: string
  ends_at: string
  requested_zone: string | null
  party_size: number
}

/**
 * Cheamă `create_reservation_public` cu cheia de idempotență.
 *
 * Compatibilitate cu o bază pe care mig 273 nu e încă aplicată: PostgREST
 * răspunde PGRST202 („function not found") pentru semnătura cu 11 argumente,
 * fiindcă parametrii se potrivesc pe NUME. În cazul ăsta se reîncearcă O
 * SINGURĂ DATĂ cu contractul vechi, fără cheie — rezervarea se face, doar fără
 * protecția la dublură, exact ca înainte. Fără fallback, clientul deployat
 * înaintea migrației ar fi rupt complet rezervările.
 */
export async function createReservationPublic(
  args: CreateReservationArgs,
  idempotencyKey: string | null,
): Promise<CreatedReservation> {
  const withKey =
    idempotencyKey === null ? args : { ...args, p_idempotency_key: idempotencyKey }

  const { data, error } = await supabase.rpc('create_reservation_public', withKey)

  if (error && idempotencyKey !== null && error.code === 'PGRST202') {
    const retry = await supabase.rpc('create_reservation_public', args)
    if (retry.error) throw toReservationError(retry.error)
    return firstRow(retry.data, args)
  }
  if (error) throw toReservationError(error)
  return firstRow(data, args)
}

function firstRow(data: unknown, args: CreateReservationArgs): CreatedReservation {
  const rows = (Array.isArray(data) ? data : [data]) as Partial<CreatedReservation>[]
  const row = rows[0]
  if (!row || !row.reservation_id) {
    throw new Error('Rezervarea nu a putut fi confirmată')
  }
  // Pe calea de COMPATIBILITATE (bază fără mig 273) proiecția are 7 coloane, fără
  // `party_size` — iar ecranul de confirmare îl afișează de acum din rândul
  // serverului, deci fără asta ar randa un număr GOL. Acolo rândul e întotdeauna
  // cel tocmai creat (vechiul RPC nu deduplică), deci numărul cerut ESTE corect.
  return {
    ...(row as CreatedReservation),
    party_size: typeof row.party_size === 'number' ? row.party_size : args.p_party_size,
  }
}

/**
 * Stări în care rezervarea NU mai e vie. O retrimitere idempotentă poate întoarce
 * o rezervare anulată între timp (cheia rămâne legată de rândul ei), iar ecranul
 * de succes are doar două stări — „confirmată" și „în așteptare" — deci ar
 * prezenta un rând mort drept rezervare primită.
 */
export const TERMINAL_RESERVATION_STATUSES = ['cancelled', 'no_show']

/** `true` dacă rezervarea întoarsă nu mai e vie și nu poate fi prezentată drept primită. */
export function isTerminalReservation(status: string): boolean {
  return TERMINAL_RESERVATION_STATUSES.includes(status)
}

// Ca la `createOrder` (orders.ts): aruncăm un `Error` REAL, nu obiectul
// PostgrestError brut — altfel apelantul care testează `e instanceof Error`
// cade pe un mesaj generic și ascunde cauza. `hint`/`code` se păstrează, fiindcă
// `ReservationSheet` mapează pe ele mesajele prietenoase (`table_unavailable`,
// `module_disabled`, `reservation_rate_limit`).
function toReservationError(e: { message?: string; hint?: string; code?: string }): Error {
  const err = new Error(e.message || 'Rezervarea nu a putut fi făcută') as Error & {
    hint?: string
    code?: string
  }
  if (e.hint) err.hint = e.hint
  if (e.code) err.code = e.code
  return err
}
