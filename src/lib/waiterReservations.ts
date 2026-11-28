// ─────────────────────────────────────────────────────────────
// Rezervările zilei pe ecranul ospătarului (lotul C2b, nov 2026).
//
// Defectul: secțiunea „Rezervări azi” stătea DEASUPRA apelurilor și a lui
// „Gata de servit” și arăta TOATE rezervările zilei, fiecare cu selector de
// masă și două butoane. Cu zece rezervări, un client care cerea nota ajungea
// la ~1500 px sub antet. Rezervările deja așezate rămâneau acolo toată seara,
// fără nicio acțiune, deși politica ospătarului (mig 143) permite
// seated → completed.
//
// Regula de aici (pagina o randează JOS, după comenzi):
//   - implicit se văd doar rezervările NESOSITE (pending / confirmed) care
//     încep în cel mult `windowMin` minute — INCLUSIV cele întârziate: un
//     client care întârzie cere o decizie (așezat sau neprezentat), iar
//     janitoarele le scot singure (no-show automat după grație, mig 234;
//     `expired` pentru pending, mig 289);
//   - „Toate” arată și restul zilei plus rezervările așezate, care primesc
//     „Finalizează”;
//   - titlul spune ora următoarei rezervări care încă n-a început.
// Pur, fără React: pagina îi dă ceasul (`nowMs`), testele îl fixează.
// ─────────────────────────────────────────────────────────────
import type { ReservationStatus } from '../hooks/useReservations'

/** Fereastra implicită: rezervările nesosite din următoarele 2 ore. */
export const WAITER_RESERVATION_WINDOW_MIN = 120

interface ReservationLike {
  status: ReservationStatus
  starts_at: string
}

export interface WaiterReservationsView<R extends ReservationLike> {
  /** Ce se vede implicit: nesosite, care încep până la `now + fereastră` (și cele întârziate). */
  due: R[]
  /** Toate rezervările active ale zilei (nesosite + așezate), în ordinea orei. */
  all: R[]
  /** Prima rezervare nesosită care n-a început încă (ora din titlu), sau null. */
  next: R | null
}

/** Ospătarul încă așteaptă clientul (rezervarea n-a fost așezată). */
export function isUnarrived(status: ReservationStatus): boolean {
  return status === 'pending' || status === 'confirmed'
}

/** Rezervare încă deschisă pe ecranul ospătarului: nesosită sau la masă. */
function isOpenForWaiter(status: ReservationStatus): boolean {
  return isUnarrived(status) || status === 'seated'
}

export function waiterReservationsView<R extends ReservationLike>(
  reservations: readonly R[],
  nowMs: number,
  windowMin: number = WAITER_RESERVATION_WINDOW_MIN,
): WaiterReservationsView<R> {
  const at = (r: R): number => Date.parse(r.starts_at)
  // Sortare stabilă pe oră; o oră ilizibilă (NaN) merge la final, nu strică ordinea.
  const all = reservations
    .filter((r) => isOpenForWaiter(r.status))
    .map((r, i) => ({ r, i, t: at(r) }))
    .sort((a, b) => {
      const ta = Number.isFinite(a.t) ? a.t : Number.POSITIVE_INFINITY
      const tb = Number.isFinite(b.t) ? b.t : Number.POSITIVE_INFINITY
      return ta - tb || a.i - b.i
    })
    .map((x) => x.r)
  const horizon = nowMs + windowMin * 60_000
  const unarrived = all.filter((r) => isUnarrived(r.status))
  // `<=` pe orizont: o rezervare EXACT la limita ferestrei intră.
  const due = unarrived.filter((r) => at(r) <= horizon)
  const next = unarrived.find((r) => at(r) >= nowMs) ?? null
  return { due, all, next }
}
