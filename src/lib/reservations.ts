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
import type { ReservationStatus } from '../hooks/useReservations'

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
 * Limbile oaspetelui pe care le acceptă rezervarea (mig 328): oglinda
 * `MENU_LANGS` din `i18nMenu.ts` și a CHECK-ului de pe
 * `reservations.guest_language` (R14 le compară). Tabela stă aici, nu importată
 * din `i18nMenu.ts`, ca modulul să rămână ușor pentru panou (care îl citește
 * pentru etichetele de status).
 */
export const RESERVATION_GUEST_LANGS: readonly string[] = ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es']

/**
 * Limba oaspetelui pentru `p_guest_language`: subeticheta primară, lowercase
 * ('en-US' → 'en'), doar una din cele 7; altfel `null` — atunci parametrul nu
 * se trimite deloc. Serverul normalizează la fel (o etichetă necunoscută nu
 * respinge niciodată rezervarea), deci aici e doar ca să nu trimitem gunoi.
 */
export function reservationGuestLanguage(lang: string | null | undefined): string | null {
  if (typeof lang !== 'string') return null
  const m = /^([A-Za-z]{2,3})(?:[-_].*)?$/.exec(lang.trim())
  const primary = m ? m[1].toLowerCase() : ''
  return RESERVATION_GUEST_LANGS.includes(primary) ? primary : null
}

/**
 * Cheamă `create_reservation_public` cu cheia de idempotență și limba oaspetelui.
 *
 * Contractele, de la cel mai nou la cel mai vechi — PostgREST potrivește
 * funcția după NUMELE argumentelor, deci o bază rămasă în urmă răspunde
 * PGRST202 („function not found") la un argument pe care nu-l cunoaște:
 *   1. mig 328: + `p_guest_language` (doar dacă limba e cunoscută);
 *   2. mig 273: + `p_idempotency_key` (doar dacă există cheie);
 *   3. contractul de dinainte, fără niciunul.
 * Pe PGRST202 se coboară O treaptă și se reîncearcă; orice altă eroare iese
 * imediat. Ordinea de deploy e liberă: o bază fără 328 primește rezervarea cu
 * cheie (fără limbă), una fără 273 o primește fără protecția la dublură —
 * exact ca înainte. Fără trepte, clientul deployat înaintea migrației ar fi
 * rupt complet rezervările.
 */
export async function createReservationPublic(
  args: CreateReservationArgs,
  idempotencyKey: string | null,
  guestLanguage: string | null = null,
): Promise<CreatedReservation> {
  const lang = reservationGuestLanguage(guestLanguage)
  const withKey: Record<string, unknown> =
    idempotencyKey === null ? { ...args } : { ...args, p_idempotency_key: idempotencyKey }
  const attempts: Record<string, unknown>[] = []
  if (lang !== null) attempts.push({ ...withKey, p_guest_language: lang })
  attempts.push(withKey)
  if (idempotencyKey !== null) attempts.push({ ...args })

  let last: { message?: string; hint?: string; code?: string } | null = null
  for (let i = 0; i < attempts.length; i++) {
    const { data, error } = await supabase.rpc('create_reservation_public', attempts[i])
    if (!error) return firstRow(data, args)
    last = error
    if (error.code !== 'PGRST202') break
  }
  throw toReservationError(last ?? {})
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
export const TERMINAL_RESERVATION_STATUSES = ['cancelled', 'no_show', 'expired']

/**
 * Etichetele de status din dashboard. `expired` (mig 289) = rezervare `pending`
 * rămasă în trecut, pe care nimeni nu a confirmat-o — NU „anulată" (nu a anulat
 * nimeni) și NU „no-show" (clientul nu a ratat nimic confirmat).
 */
export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'În așteptare',
  confirmed: 'Confirmată',
  seated: 'La masă',
  completed: 'Finalizată',
  cancelled: 'Anulată',
  no_show: 'No-show',
  expired: 'Expirată',
}

/** Pragul peste care o rezervare `confirmed` rămasă neînchisă e „nerezolvată" (mig 289: nu se rescrie automat). */
export const STALE_CONFIRMED_HOURS = 48

/**
 * Câte zile rămân vizibile rezervările `expired` în secțiunea „Neconfirmate /
 * expirate". `expired` nu are nicio acțiune (e terminal), deci fără plafon
 * secțiunea ar crește la nesfârșit; o săptămână ajunge ca owner-ul să vadă ce
 * a ratat. `pending`/`confirmed` vechi NU au plafon — acelea cer o decizie.
 */
export const STALE_EXPIRED_DAYS = 7

/**
 * Filtrul PostgREST `or` pentru secțiunea „Neconfirmate / expirate" din
 * dashboard: `pending` din trecut FĂRĂ limită inferioară de dată (janitorul
 * orar le mută pe cele vechi în `expired`, dar între ticuri `pending` încă
 * există) + `expired` doar din ultimele `STALE_EXPIRED_DAYS` zile (informativ,
 * fără acțiuni) + `confirmed` mai vechi de 48h, pe care fereastra no-show
 * (mig 234) nu le mai atinge și care trebuie rezolvate de mână.
 */
export function buildStaleReservationsFilter(now: Date): string {
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - STALE_CONFIRMED_HOURS * 3600 * 1000).toISOString()
  const expiredFloorIso = new Date(
    now.getTime() - STALE_EXPIRED_DAYS * 24 * 3600 * 1000,
  ).toISOString()
  return (
    `and(status.eq.pending,starts_at.lt.${nowIso}),` +
    `and(status.eq.expired,starts_at.gte.${expiredFloorIso},starts_at.lt.${nowIso}),` +
    `and(status.eq.confirmed,starts_at.lt.${staleIso})`
  )
}

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
