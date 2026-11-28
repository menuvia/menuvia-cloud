import type { Order } from './orders'

// Coloana „Gata de servit” a Bucătăriei (lotul C3a). O comandă `ready` stă în
// vederea bucătăriei până când ospătarul apasă „Servit”, iar bucătăria NU o
// poate scoate (`mark_served` exclude rolul kitchen, mig 291; janitorul 288
// sare Planul 3) — deci, în orele de vârf, coloana creștea cu carduri care nu
// mai sunt treaba bucătarului. Regula de afișare stă AICI (pură, testată) și
// nu în pagină (react-refresh/only-export-components):
//   - se văd întregi doar comenzile gata din ultimele
//     KITCHEN_READY_RECENT_MINUTES minute; cele mai vechi se strâng într-un
//     rând „+N așteaptă ospătarul”, care se poate deschide;
//   - vârsta se măsoară din `ready_at` (momentul în care a ieșit din
//     bucătărie), NU din `created_at` — o comandă plasată acum 40 de minute,
//     gata de 2 minute, e „proaspătă” aici;
//   - ordinea e pe `ready_at`, cea mai recentă SUS: ce tocmai a terminat
//     bucătarul apare imediat sub deget, fără derulare.
// Datele NU se ating: comanda rămâne `ready` pentru ospătar (served_at /
// served_by și fluxul de plată pe Planul 3 rămân ale lui).

/** Câte minute rămâne o comandă `ready` vizibilă întreagă în coloana „Gata”. */
export const KITCHEN_READY_RECENT_MINUTES = 10

type ReadyOrder = Pick<Order, 'id' | 'ready_at'>

/**
 * Momentul în care comanda a devenit gata, în ms. `ready_at` lipsă sau
 * ilizibil → `now`: starea OPTIMISTĂ de după „Gata” are deja statusul, dar nu
 * și `ready_at` (îl aduce evenimentul realtime) — comanda abia a ieșit, deci e
 * cea mai recentă, nu una ascunsă în rândul „așteaptă”.
 */
export function readyMoment(order: Pick<Order, 'ready_at'>, now: number): number {
  const t = order.ready_at == null ? Number.NaN : Date.parse(order.ready_at)
  return Number.isNaN(t) ? now : t
}

/**
 * Împarte comenzile `ready` în cele afișate întregi (`recent`, gata de cel
 * mult KITCHEN_READY_RECENT_MINUTES minute, inclusiv pragul) și cele strânse
 * în rândul „+N așteaptă ospătarul” (`waiting`). Ambele liste sunt ordonate pe
 * `ready_at` descrescător (la egalitate, pe id — ordine stabilă între randări).
 */
export function splitReadyColumn<T extends ReadyOrder>(
  orders: ReadonlyArray<T>,
  now: number = Date.now(),
): { recent: T[]; waiting: T[] } {
  const cutoff = now - KITCHEN_READY_RECENT_MINUTES * 60_000
  const sorted = [...orders].sort(
    (a, b) => readyMoment(b, now) - readyMoment(a, now) || a.id.localeCompare(b.id),
  )
  const recent: T[] = []
  const waiting: T[] = []
  for (const o of sorted) {
    if (readyMoment(o, now) >= cutoff) recent.push(o)
    else waiting.push(o)
  }
  return { recent, waiting }
}
