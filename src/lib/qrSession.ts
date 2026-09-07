// Snapshot-ul sesiunii de masă pentru meniul QR (audit v3, FC-02).
//
// Comenzile trimise, id-ul sesiunii și comenzile deja plătite online trăiau
// DOAR în state-ul React al QrMenuPage. Pe telefon, calea cea mai comună de la
// masă — client comandă, pune telefonul în buzunar 15 min, iOS Safari evacuează
// tab-ul, la redeschidere pagina se reîncarcă (sau back/refresh) — golea totul:
// fără banner de urmărire, fără „Plătește online"/split (butonul cere
// previousOrders.length > 0), deși nota există server-side. Snapshot-ul stă în
// sessionStorage per token (același spațiu ca cheia de idempotență), cu TTL
// scurt: o sesiune de masă nu durează ore, iar un snapshot vechi n-are voie să
// reînvie o notă închisă (serverul recalculează oricum suma la plată).
import type { OrderConfirmationPayload } from './orders'

export interface QrSessionSnapshot {
  previousOrders: OrderConfirmationPayload[]
  sessionId: string | null
  paidOrderIds: string[]
  savedAt: number
}

const TTL_MS = 6 * 60 * 60 * 1000
const storageKey = (token: string): string => 'menuvia_qr_session:' + token

function isConfirmation(v: unknown): v is OrderConfirmationPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { total?: unknown }).total === 'number'
  )
}

/** Citește snapshot-ul (null dacă lipsește, e corupt sau expirat). */
export function loadQrSessionSnapshot(token: string): QrSessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(storageKey(token))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<QrSessionSnapshot> | null
    if (!parsed || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > TTL_MS) {
      sessionStorage.removeItem(storageKey(token))
      return null
    }
    return {
      previousOrders: Array.isArray(parsed.previousOrders)
        ? parsed.previousOrders.filter(isConfirmation)
        : [],
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      paidOrderIds: Array.isArray(parsed.paidOrderIds)
        ? parsed.paidOrderIds.filter((x): x is string => typeof x === 'string')
        : [],
      savedAt: parsed.savedAt,
    }
  } catch {
    return null
  }
}

/** Scrie snapshot-ul; un snapshot gol (fără comenzi și fără sesiune) șterge cheia. */
export function saveQrSessionSnapshot(
  token: string,
  snap: Omit<QrSessionSnapshot, 'savedAt'>,
): void {
  try {
    if (snap.previousOrders.length === 0 && snap.sessionId == null) {
      sessionStorage.removeItem(storageKey(token))
      return
    }
    sessionStorage.setItem(
      storageKey(token),
      JSON.stringify({ ...snap, savedAt: Date.now() } satisfies QrSessionSnapshot),
    )
  } catch {
    /* sessionStorage indisponibil (private mode/quota) — degradăm la memorie */
  }
}

export function clearQrSessionSnapshot(token: string): void {
  try {
    sessionStorage.removeItem(storageKey(token))
  } catch {
    /* no-op */
  }
}

/**
 * Reconciliază snapshot-ul rehidratat cu sesiunea CONFIRMATĂ de server
 * (`open_table_session`). Snapshot-ul identifică MASA (cheia e token-ul), dar
 * comenzile/plățile aparțin unei SESIUNI concrete: dacă serverul a deschis o
 * sesiune NOUĂ (masa s-a eliberat între timp — nota veche e închisă/plătită)
 * sau id-ul diferă de cel din snapshot, comenzile vechi nu au voie să reînvie
 * (audit v3 RES-27: totalul „Plătește masa" ar fi numărat nota altcuiva /
 * o notă deja închisă). Fail-closed spre stare curată: un snapshot pe care
 * serverul nu-l confirmă se aruncă. Funcție PURĂ, testabilă.
 */
export function reconcileQrSessionSnapshot(
  snap: Pick<QrSessionSnapshot, 'sessionId' | 'previousOrders'> | null,
  server: { session_id: string; is_new: boolean },
): { keep: boolean; sessionId: string } {
  const keep =
    snap != null &&
    snap.previousOrders.length > 0 &&
    !server.is_new &&
    snap.sessionId != null &&
    snap.sessionId === server.session_id
  return { keep, sessionId: server.session_id }
}
