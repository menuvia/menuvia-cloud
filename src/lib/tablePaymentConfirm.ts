// ─────────────────────────────────────────────────────────────
// tablePaymentConfirm.ts — confirmarea plății online la masă de la SERVER
// (lotul E, mig 312).
// ─────────────────────────────────────────────────────────────
// „Plătit” pe meniul QR apare DOAR când DB-ul spune `succeeded`, adică după ce
// webhook-ul a decontat plata (`settle_table_payment`). Rezultatul din browser
// al lui `stripe.confirmPayment` doar PORNEȘTE confirmarea: poate fi
// `processing`, iar webhook-ul poate întârzia sau eșua.
//
// Două piese pure, fără React, testate separat:
//   • `pollTablePaymentStatus` — polling cu backoff până la un rezultat
//     terminal sau până la termen (atunci UI-ul arată „în curs de confirmare”,
//     NU „Plătit”);
//   • `buildTablePaymentReturnUrl` / `parseTablePaymentReturn` /
//     `stripTablePaymentReturn` — `return_url`-ul Stripe (3DS și celelalte
//     metode cu redirect) poartă plata, sesiunea și felul ei, ca pagina
//     reîncărcată să reia confirmarea de la server și apoi să curețe URL-ul.
//     Sesiunea e în URL deliberat: după un settle reușit pe toată nota, 084
//     închide sesiunea, iar la reîncărcare `open_table_session` deschide una
//     NOUĂ — cu ea, RPC-ul ar întoarce `unknown` pentru plata veche.
import type { TablePaymentPublicStatus } from './payments'

/** Pauzele dintre interogări (ms); ultima se repetă până la termen. */
export const CONFIRM_POLL_DELAYS_MS: readonly number[] = [1000, 1500, 2000, 3000, 4000, 5000]
/** Cât așteptăm confirmarea serverului înainte de „în curs de confirmare”. */
export const CONFIRM_DEADLINE_MS = 40_000
/**
 * `failed` în DB e „ultima încercare a eșuat” și rămâne retryable (mig 207):
 * după ce un card a fost refuzat, oaspetele poate reîncerca cu alt card pe
 * ACELAȘI intent, iar până sosește webhook-ul de succes rândul e încă
 * `failed`. De aceea `failed` devine terminal abia după această grație — altfel
 * am afișa „plata a eșuat” pentru o plată care tocmai a reușit.
 */
export const CONFIRM_FAILED_GRACE_MS = 10_000

export type ServerConfirmOutcome = 'succeeded' | 'failed' | 'canceled' | 'timeout'

/**
 * Interoghează statusul imediat, apoi cu backoff, până la `succeeded` /
 * `canceled` / `failed` (după grație) sau până la termen (`timeout`).
 * `pending`/`processing`/`unknown` continuă polling-ul — `unknown` (eroare de
 * rețea, plafon) NU e niciodată tratat ca plătit. Timpul se numără pe pauzele
 * programate (determinist, fără ceas). Întoarce funcția de oprire: după ea
 * niciun rezultat (nici unul aflat deja în zbor) nu mai ajunge la `onOutcome`.
 */
export function pollTablePaymentStatus(
  fetchStatus: () => Promise<TablePaymentPublicStatus>,
  onOutcome: (outcome: ServerConfirmOutcome) => void,
  opts: { deadlineMs?: number; delaysMs?: readonly number[]; failedGraceMs?: number } = {},
): () => void {
  const deadline = opts.deadlineMs ?? CONFIRM_DEADLINE_MS
  const delays = opts.delaysMs ?? CONFIRM_POLL_DELAYS_MS
  const failedGrace = opts.failedGraceMs ?? CONFIRM_FAILED_GRACE_MS
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let elapsed = 0
  let attempt = 0

  const finish = (outcome: ServerConfirmOutcome): void => {
    stopped = true
    onOutcome(outcome)
  }

  const tick = (): void => {
    fetchStatus()
      .catch((): TablePaymentPublicStatus => 'unknown')
      .then((status) => {
        if (stopped) return
        if (status === 'succeeded' || status === 'canceled') return finish(status)
        if (status === 'failed' && elapsed >= failedGrace) return finish('failed')
        if (elapsed >= deadline) return finish('timeout')
        const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5000
        attempt += 1
        elapsed += delay
        timer = setTimeout(tick, delay)
      })
  }

  tick()
  return () => {
    stopped = true
    // Un timer deja declanșat e inofensiv de anulat; cererea în zbor e
    // neutralizată de `stopped`.
    if (timer != null) clearTimeout(timer)
  }
}

// ── return_url: reluarea după redirect ─────────────────────────
type TablePaymentKind = 'table' | 'split'

/** Parametrii noștri; Stripe adaugă `payment_intent`, `…_client_secret`, `redirect_status`. */
const P_PAYMENT = 'tp'
const P_SESSION = 'tps'
const P_KIND = 'tpk'
const STRIPE_PARAMS = ['payment_intent', 'payment_intent_client_secret', 'redirect_status'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTENT_RE = /^pi_[A-Za-z0-9_]{1,200}$/

/** `return_url`-ul pentru `confirmPayment`: pagina curentă + plata, sesiunea, felul. */
export function buildTablePaymentReturnUrl(
  href: string,
  p: { paymentId: string; sessionId: string; kind: TablePaymentKind },
): string {
  const url = new URL(href)
  for (const k of [...STRIPE_PARAMS, P_PAYMENT, P_SESSION, P_KIND]) url.searchParams.delete(k)
  url.searchParams.set(P_PAYMENT, p.paymentId)
  url.searchParams.set(P_SESSION, p.sessionId)
  url.searchParams.set(P_KIND, p.kind)
  return url.toString()
}

export interface TablePaymentReturn {
  /** uuid-ul plății (preferat) sau `pi_…` venit de la Stripe. */
  paymentRef: string
  sessionId: string
  /** `table` DOAR dacă URL-ul o spune explicit; altfel `split` (nu marcăm masa plătită). */
  kind: TablePaymentKind
  /** Stripe a raportat eșecul redirect-ului — nu are rost să așteptăm serverul. */
  redirectFailed: boolean
}

/**
 * Citește revenirea din redirect-ul Stripe. `null` dacă URL-ul nu e o revenire
 * (lipsesc parametrii Stripe) sau nu are o sesiune/plată validă — atunci nu se
 * reia nimic (fără sesiune RPC-ul ar întoarce oricum `unknown`).
 */
export function parseTablePaymentReturn(href: string): TablePaymentReturn | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const q = url.searchParams
  const redirectStatus = q.get('redirect_status')
  const intent = q.get('payment_intent')
  if (redirectStatus == null && intent == null) return null
  const sessionId = q.get(P_SESSION) ?? ''
  if (!UUID_RE.test(sessionId)) return null
  const pid = q.get(P_PAYMENT) ?? ''
  const paymentRef = UUID_RE.test(pid) ? pid : intent != null && INTENT_RE.test(intent) ? intent : null
  if (paymentRef == null) return null
  return {
    paymentRef,
    sessionId,
    kind: q.get(P_KIND) === 'table' ? 'table' : 'split',
    redirectFailed: redirectStatus === 'failed',
  }
}

/** URL-ul curent fără parametrii revenirii (path + query + hash), pentru `replaceState`. */
export function stripTablePaymentReturn(href: string): string {
  const url = new URL(href)
  for (const k of [...STRIPE_PARAMS, P_PAYMENT, P_SESSION, P_KIND]) url.searchParams.delete(k)
  const search = url.searchParams.toString()
  return url.pathname + (search ? '?' + search : '') + url.hash
}
