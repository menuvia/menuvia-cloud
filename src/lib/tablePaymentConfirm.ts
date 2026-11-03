// ─────────────────────────────────────────────────────────────
// tablePaymentConfirm.ts — confirmarea plății online la masă de la SERVER
// (lotul E, mig 312).
// ─────────────────────────────────────────────────────────────
// „Plătit” pe meniul QR apare DOAR când DB-ul spune `succeeded`, adică după ce
// webhook-ul a decontat plata (`settle_table_payment`). Rezultatul din browser
// al lui `stripe.confirmPayment` doar PORNEȘTE confirmarea: poate fi
// `processing`, iar webhook-ul poate întârzia sau eșua.
//
// Piese pure, fără React, testate separat:
//   • `pollTablePaymentStatus` — polling cu backoff până la un rezultat
//     terminal sau până la termen (atunci UI-ul arată „în curs de confirmare”,
//     NU „Plătit”);
//   • `buildTablePaymentReturnUrl` / `parseTablePaymentReturn` /
//     `tablePaymentReturnCleanUrl` — `return_url`-ul Stripe (3DS și celelalte
//     metode cu redirect) poartă plata și sesiunea, ca pagina reîncărcată să
//     reia confirmarea de la server și apoi să curețe URL-ul. Sesiunea e în URL
//     deliberat: după un settle reușit pe toată nota, 084 închide sesiunea, iar
//     la reîncărcare `open_table_session` deschide una NOUĂ — cu ea, RPC-ul ar
//     întoarce `unknown` pentru plata veche. Felul plății (masă / split) NU mai
//     e în URL: îl spune serverul (`kind`, din `table_payments.kind`);
//   • `applyTablePaymentOutcome` / `makeServerPaidHandler` — decizia „masa e
//     plătită” pe felul venit de la SERVER.
import {
  TABLE_PAYMENT_UNKNOWN,
  type TablePaymentPublicKind,
  type TablePaymentPublicResult,
} from './payments'

/** Pauzele dintre interogări (ms); ultima se repetă până la termen. */
export const CONFIRM_POLL_DELAYS_MS: readonly number[] = [1000, 1500, 2000, 3000, 4000, 5000]
/** Cât așteptăm confirmarea serverului înainte de „în curs de confirmare” (ceas real). */
export const CONFIRM_DEADLINE_MS = 40_000
/**
 * `failed` în DB e „ultima încercare a eșuat” și rămâne retryable (mig 207):
 * după ce un card a fost refuzat, oaspetele poate reîncerca cu alt card pe
 * ACELAȘI intent, iar până sosește webhook-ul de succes rândul e încă
 * `failed`. Fără un succes raportat de browser, `failed` devine terminal abia
 * după această grație; CU un succes raportat de browser nu devine terminal
 * deloc (vezi `browserStatus`).
 */
export const CONFIRM_FAILED_GRACE_MS = 10_000

export type ServerConfirmOutcome = 'succeeded' | 'failed' | 'canceled' | 'timeout'

/**
 * Ce a raportat BROWSERUL (Stripe.js după `confirmPayment`, `cancel` care a
 * găsit intent-ul deja reușit, sau `redirect_status` la revenirea din
 * redirect). NU e niciodată „Plătit” — doar spune că un `failed` din DB e o
 * încercare ANTERIOARĂ pe același intent, nu rezultatul acesteia.
 */
export type TablePaymentBrowserStatus = 'succeeded' | 'processing'

/** Doar `succeeded`/`processing` sunt succese raportate; orice altceva = nimic raportat. */
export function browserStatusFrom(s: string | null | undefined): TablePaymentBrowserStatus | null {
  return s === 'succeeded' || s === 'processing' ? s : null
}

export interface PollOptions {
  deadlineMs?: number
  delaysMs?: readonly number[]
  failedGraceMs?: number
  /** Succesul raportat de browser: cu el, `failed` din DB NU e terminal. */
  browserStatus?: TablePaymentBrowserStatus | null
  /** Ceasul (implicit `Date.now`); termenul se măsoară pe el, nu pe pauze. */
  now?: () => number
}

/**
 * Interoghează statusul imediat, apoi cu backoff, până la `succeeded` /
 * `canceled` / `failed` sau până la termen (`timeout`).
 * `pending`/`processing`/`unknown` continuă polling-ul — `unknown` (eroare de
 * rețea, plafon) NU e niciodată tratat ca plătit. `failed` e terminal doar
 * fără succes raportat de browser și doar după grație; cu succes raportat se
 * așteaptă `succeeded` până la termen.
 *
 * Termenul e pe CEAS REAL și are un paznic propriu (`setTimeout` la termen):
 * o cerere care nu se mai întoarce nu poate ține UI-ul în „confirmăm…” la
 * nesfârșit. `onOutcome` primește și felul plății (`kind`) spus de server —
 * ultimul cunoscut. O excepție în `onOutcome` nu blochează oprirea. Întoarce
 * funcția de oprire: după ea niciun rezultat (nici unul aflat deja în zbor)
 * nu mai ajunge la `onOutcome`.
 */
export function pollTablePaymentStatus(
  fetchStatus: () => Promise<TablePaymentPublicResult>,
  onOutcome: (outcome: ServerConfirmOutcome, kind: TablePaymentPublicKind) => void,
  opts: PollOptions = {},
): () => void {
  const deadline = opts.deadlineMs ?? CONFIRM_DEADLINE_MS
  const delays = opts.delaysMs ?? CONFIRM_POLL_DELAYS_MS
  const failedGrace = opts.failedGraceMs ?? CONFIRM_FAILED_GRACE_MS
  const browserReported = opts.browserStatus != null
  const now = opts.now ?? (() => Date.now())
  const startedAt = now()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let kind: TablePaymentPublicKind = 'unknown'
  let attempt = 0

  const clearTimers = (): void => {
    if (timer != null) clearTimeout(timer)
    timer = null
    if (watchdog != null) clearTimeout(watchdog)
    watchdog = null
  }

  const finish = (outcome: ServerConfirmOutcome): void => {
    if (stopped) return
    stopped = true
    clearTimers()
    try {
      onOutcome(outcome, kind)
    } catch {
      /* o excepție a consumatorului (storage, părinte) nu are voie să lase
         polling-ul „pornit” — starea e deja oprită */
    }
  }

  // Paznicul termenului: independent de cererile în zbor.
  watchdog = setTimeout(() => finish('timeout'), deadline)

  const tick = (): void => {
    fetchStatus()
      .catch((): TablePaymentPublicResult => TABLE_PAYMENT_UNKNOWN)
      .then((res) => {
        if (stopped) return
        if (res.kind !== 'unknown') kind = res.kind
        const elapsed = now() - startedAt
        const status = res.status
        if (status === 'succeeded' || status === 'canceled') return finish(status)
        if (status === 'failed' && !browserReported && elapsed >= failedGrace) return finish('failed')
        if (elapsed >= deadline) return finish('timeout')
        const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5000
        attempt += 1
        timer = setTimeout(tick, delay)
      })
  }

  tick()
  return () => {
    stopped = true
    // Un timer deja declanșat e inofensiv de anulat; cererea în zbor e
    // neutralizată de `stopped`.
    clearTimers()
  }
}

// ── Decizia „masa e plătită” — pe felul spus de SERVER ─────────
/**
 * Masa devine „plătită” local DOAR pe `succeeded` al unei plăți `table`
 * (toată nota). `split` = plată parțială; `unknown` = nu știm → nu marcăm.
 */
export function applyTablePaymentOutcome(o: {
  kind: TablePaymentPublicKind
  status: ServerConfirmOutcome
}): { markTablePaid: boolean } {
  return { markTablePaid: o.status === 'succeeded' && o.kind === 'table' }
}

/** `onPaid` pentru PayTableSheet: marchează masa doar dacă serverul spune `table`. */
export function makeServerPaidHandler(
  markTablePaid: () => void,
): (kind: TablePaymentPublicKind) => void {
  return (kind) => {
    if (applyTablePaymentOutcome({ kind, status: 'succeeded' }).markTablePaid) markTablePaid()
  }
}

// ── return_url: reluarea după redirect ─────────────────────────
/** Parametrii noștri; Stripe adaugă `payment_intent`, `…_client_secret`, `redirect_status`. */
const P_PAYMENT = 'tp'
const P_SESSION = 'tps'
/** Moștenit (felul plății, scos din URL): doar se curăță, nu se mai citește. */
const P_KIND_LEGACY = 'tpk'
const STRIPE_PARAMS = ['payment_intent', 'payment_intent_client_secret', 'redirect_status'] as const
const RETURN_PARAMS: readonly string[] = [...STRIPE_PARAMS, P_PAYMENT, P_SESSION, P_KIND_LEGACY]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTENT_RE = /^pi_[A-Za-z0-9_]{1,200}$/

/** `return_url`-ul pentru `confirmPayment`: pagina curentă + plata și sesiunea. */
export function buildTablePaymentReturnUrl(
  href: string,
  p: { paymentId: string; sessionId: string },
): string {
  const url = new URL(href)
  for (const k of RETURN_PARAMS) url.searchParams.delete(k)
  url.searchParams.set(P_PAYMENT, p.paymentId)
  url.searchParams.set(P_SESSION, p.sessionId)
  return url.toString()
}

export interface TablePaymentReturn {
  /** uuid-ul plății (preferat) sau `pi_…` venit de la Stripe. */
  paymentRef: string
  sessionId: string
  /** Stripe a raportat eșecul redirect-ului — nu are rost să așteptăm serverul. */
  redirectFailed: boolean
  /** `redirect_status` = succeeded/processing: succes raportat de browser. */
  browserStatus: TablePaymentBrowserStatus | null
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
    redirectFailed: redirectStatus === 'failed' || redirectStatus === 'requires_payment_method',
    browserStatus: browserStatusFrom(redirectStatus),
  }
}

/** URL-ul curent fără parametrii revenirii (path + query + hash), pentru `replaceState`. */
export function stripTablePaymentReturn(href: string): string {
  const url = new URL(href)
  for (const k of RETURN_PARAMS) url.searchParams.delete(k)
  const search = url.searchParams.toString()
  return url.pathname + (search ? '?' + search : '') + url.hash
}

/**
 * URL-ul curățat dacă `href` poartă ORICARE parametru al revenirii — chiar și
 * când revenirea nu se poate citi (sesiune lipsă, referință stricată): un
 * `payment_intent_client_secret` rămas în bara de adrese ajunge în istoric și
 * într-un link copiat. `null` = nimic de curățat (sau URL invalid).
 */
export function tablePaymentReturnCleanUrl(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!RETURN_PARAMS.some((k) => url.searchParams.has(k))) return null
  return stripTablePaymentReturn(href)
}
