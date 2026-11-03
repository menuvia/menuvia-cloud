// PayTableSheet — plata online a mesei din meniul QR (Etapa 1).
// Bottom sheet pe tokenii temei (PUB/accent), lazy-loaded din QrMenuPage.
// Fluxul: createTablePayment (suma se calculează pe server) → Stripe Payment
// Element (js.stripe.com) → confirmPayment → confirmarea SERVERULUI (lotul E,
// mig 312): „Plătit” apare DOAR când `get_table_payment_public_status` spune
// `succeeded`, adică după ce webhook-ul a decontat plata (settle_table_payment)
// — rezultatul din browser al lui Stripe doar pornește polling-ul. Bonul
// fiscal se emite pe casa localului din aceeași decontare, nu din client.
// Cu `resume` (revenirea din redirect-ul Stripe, ex. 3DS) sheet-ul sare direct
// la confirmarea de la server, fără plată nouă.
import { useEffect, useRef, useState } from 'react'
import { FocusTrap } from './ui/FocusTrap'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import {
  cancelTablePayment,
  createTablePayment,
  fetchTablePaymentStatus,
  loadStripeJs,
  type SplitClaimInput,
  type StripeClient,
  type TablePaymentPublicKind,
  type StripeElements,
  type StripePaymentElement,
} from '../lib/payments'
import { fmtPrice, resolveMenuCurrency, type MenuCurrency } from '../lib/currency'
import { T } from '../lib/publicMenuStrings'
import { Tf } from '../lib/guestI18n'
import { describeGuestError, PAY_TABLE_ERROR_OPTS } from '../lib/guestErrors'
import { legibleOn, readableTextOn } from '../lib/themes'
import {
  browserStatusFrom,
  buildTablePaymentReturnUrl,
  pollTablePaymentStatus,
  type ServerConfirmOutcome,
  type TablePaymentBrowserStatus,
} from '../lib/tablePaymentConfirm'

interface PUBColors {
  bg: string
  surface: string
  text: string
  text2: string
  text3: string
  border: string
  borderStrong: string
}

interface Props {
  token: string
  sessionId: string
  PUB: PUBColors
  accent: string
  onClose: () => void
  /**
   * Chemat DOAR după ce SERVERUL confirmă plata (`succeeded` în DB, mig 312),
   * cu felul plății spus tot de server (`table` = toată nota, `split` = parte).
   */
  onPaid: (kind: TablePaymentPublicKind) => void
  /** Clientul renunță la plata online — părintele cheamă nota la ospătar. */
  onPayOtherwise: () => void
  /** Split pe itemi (mig 229): plătește DOAR produsele selectate. */
  claims?: readonly SplitClaimInput[]
  /** Limba aleasă de oaspete în meniu — default 'ro'. */
  lang?: string
  /**
   * Revenirea din redirect-ul Stripe (`return_url`): nu se creează nicio plată
   * nouă, se reia doar confirmarea de la server pentru plata existentă.
   */
  resume?: {
    paymentRef: string
    redirectFailed: boolean
    /** `redirect_status` = succeeded/processing (succes raportat de browser). */
    browserStatus: TablePaymentBrowserStatus | null
  }
}

// confirming_server = așteptăm DB-ul (webhook → settle); pending_confirmation =
// termenul a trecut fără confirmare: NU e „Plătit”, oaspetele poate reverifica.
type Phase =
  | 'loading'
  | 'ready'
  | 'confirming'
  | 'confirming_server'
  | 'pending_confirmation'
  | 'paid'
  | 'error'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cheia sessionStorage cu ultimul intent split al ACESTUI telefon: dacă
// sheet-ul a murit mid-flow (refresh/crash), claims-urile lui ar rămâne
// blocate — la redeschidere anulăm best-effort plata veche înainte de una nouă.
const splitPidKey = (sessionId: string): string => `menuvia_split_pid_${sessionId}`

// Accesul la sessionStorage ARUNCĂ în Safari cu cookie-urile blocate (și în
// unele webview-uri) — RESID-15. Aici un throw ar lăsa sheet-ul blocat în
// „confirmăm plata…” sau ar raporta eroare pe o plată deja creată, deci
// fiecare acces e fail-open: checkpoint-ul pid-ului e best-effort (TTL-ul de
// 15 min al claims-urilor preia).
function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* storage indisponibil — best-effort */
  }
}
function safeRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* storage indisponibil — best-effort */
  }
}

export default function PayTableSheet({
  token,
  sessionId,
  PUB,
  accent,
  onClose,
  onPaid,
  onPayOtherwise,
  claims,
  lang = 'ro',
  resume,
}: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  // Moneda vine din răspunsul serverului (begin_table_payment) — nu din client.
  const [currency, setCurrency] = useState<MenuCurrency>('RON')
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeClient | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const paymentElRef = useRef<StripePaymentElement | null>(null)
  // Polling-ul confirmării de la server: oprit la unmount și la o repornire.
  const stopPollRef = useRef<(() => void) | null>(null)
  // Referința plății confirmate acum + succesul raportat de browser (pentru
  // „Verifică din nou”: reverificarea păstrează aceeași semantică a lui `failed`).
  const confirmRefRef = useRef<string | null>(null)
  const confirmBrowserRef = useRef<TablePaymentBrowserStatus | null>(null)
  // Felul plății spus de SERVER (mig 312): la reluarea din redirect nu-l știm
  // până răspunde serverul — URL-ul nu-l mai poartă.
  const [serverKind, setServerKind] = useState<TablePaymentPublicKind>('unknown')
  const isSplit = (claims != null && claims.length > 0) || serverKind === 'split'
  // Rezultatul serverului sosește la secunde după randarea care a pornit
  // polling-ul: părintele trebuie chemat cu callback-ul CURENT, nu cu unul
  // închis peste comenzile de atunci.
  const onPaidRef = useRef(onPaid)
  onPaidRef.current = onPaid
  const langRef = useRef(lang)
  langRef.current = lang

  useBodyScrollLock(true)

  useEffect(
    () => () => {
      stopPollRef.current?.()
      stopPollRef.current = null
    },
    [],
  )

  // `browserStatus` = ce a raportat browserul (succeeded/processing): cu el, un
  // `failed` din DB e o încercare ANTERIOARĂ pe același intent (primul card
  // refuzat), nu rezultatul acesteia — polling-ul așteaptă `succeeded` sau
  // termenul, nu declară eșecul.
  function startServerConfirmation(
    ref: string,
    browserStatus: TablePaymentBrowserStatus | null,
  ): void {
    stopPollRef.current?.()
    confirmRefRef.current = ref
    confirmBrowserRef.current = browserStatus
    setErrorMsg(null)
    setPhase('confirming_server')
    stopPollRef.current = pollTablePaymentStatus(
      () => fetchTablePaymentStatus(token, sessionId, ref),
      (outcome: ServerConfirmOutcome, kind: TablePaymentPublicKind) => {
        stopPollRef.current = null
        if (kind !== 'unknown') setServerKind(kind)
        if (outcome === 'succeeded') {
          // Starea întâi: nimic după (storage, părinte) nu poate bloca „Plătit”.
          setPhase('paid')
          safeRemove(splitPidKey(sessionId))
          onPaidRef.current(kind)
        } else if (outcome === 'timeout') {
          setPhase('pending_confirmation')
        } else {
          setErrorMsg(T(langRef.current, outcome === 'failed' ? 'pt_server_failed' : 'pt_server_canceled'))
          setPhase('error')
        }
      },
      { browserStatus },
    )
  }

  useEffect(() => {
    if (resume) {
      // Revenire din redirect: plata există deja — doar confirmarea de la server.
      if (UUID_RE.test(resume.paymentRef)) setPaymentId(resume.paymentRef)
      if (resume.redirectFailed) {
        setErrorMsg(T(lang, 'pt_declined'))
        setPhase('error')
        // O singură interogare, DOAR pentru felul plății: la închidere un
        // split își eliberează claims-urile (handleClose), iar felul nu mai
        // vine din URL. Fără polling, fără „Plătit”.
        let gone = false
        void fetchTablePaymentStatus(token, sessionId, resume.paymentRef).then(
          (r) => {
            if (!gone && r.kind !== 'unknown') setServerKind(r.kind)
          },
          () => {
            /* best-effort: fără fel, claims-urile le eliberează TTL-ul de 15 min */
          },
        )
        return () => {
          gone = true
        }
      }
      startServerConfirmation(resume.paymentRef, resume.browserStatus)
      return undefined
    }
    let cancelled = false
    async function init(): Promise<void> {
      try {
        // OPT-R2: pornim încărcarea Stripe.js în PARALEL cu curățarea claims-
        // urilor stale + createTablePayment — sunt latențe independente
        // (loadStripeJs nu depinde de intent). `.catch(() => {})` neutralizează
        // o respingere ne-așteptată dacă init-ul aruncă înainte de await-ul de
        // mai jos; eroarea reală tot iese prin `await stripePromise`.
        const stripePromise = loadStripeJs()
        stripePromise.catch(() => {})
        if (claims && claims.length > 0) {
          // Eliberăm claims-urile unei încercări anterioare crăpate mid-flow
          // (best-effort — dacă plata veche chiar a reușit, cancel-ul e refuzat
          // și webhook-ul ei își vede de drum).
          const stalePid = safeGet(splitPidKey(sessionId))
          if (stalePid) {
            try {
              await cancelTablePayment(stalePid, token, sessionId)
            } catch {
              /* best-effort */
            }
            safeRemove(splitPidKey(sessionId))
          }
        }
        const intent = await createTablePayment(token, sessionId, claims)
        // Checkpoint-ul pid-ului se scrie ÎNAINTE de verificarea `cancelled`:
        // dacă sheet-ul a fost închis/demontat cât timp cererea era pe fir,
        // serverul TOT a creat plata (cu claims) — fără pid, nimic n-ar mai
        // elibera claims-urile de pe acest telefon.
        if (claims && claims.length > 0) {
          safeSet(splitPidKey(sessionId), intent.payment_id)
        }
        if (cancelled) {
          // Sheet închis mid-request: anulăm best-effort plata abia creată
          // (eliberează claims-urile imediat, nu la TTL/redeschidere).
          if (claims && claims.length > 0) {
            void cancelTablePayment(intent.payment_id, token, sessionId)
              .then(() => safeRemove(splitPidKey(sessionId)))
              .catch(() => {
                /* best-effort: pid-ul din sessionStorage preia la redeschidere */
              })
          }
          return
        }
        setAmount(intent.amount)
        setPaymentId(intent.payment_id)
        setCurrency(resolveMenuCurrency(intent.currency))
        const Stripe = await stripePromise
        if (cancelled) return
        const stripe = Stripe(intent.publishable_key, {
          stripeAccount: intent.stripe_account_id,
        })
        const elements = stripe.elements({
          clientSecret: intent.client_secret,
          appearance: { theme: 'stripe' },
          // Formularul și mesajele de card ale Stripe în limba oaspetelui.
          locale: lang,
        })
        const paymentEl = elements.create('payment')
        stripeRef.current = stripe
        elementsRef.current = elements
        paymentElRef.current = paymentEl
        // Montăm după ce sheet-ul e în starea 'ready' (div-ul există în DOM).
        setPhase('ready')
      } catch (e) {
        if (cancelled) return
        setErrorMsg(describeGuestError(lang, e, PAY_TABLE_ERROR_OPTS))
        setPhase('error')
      }
    }
    void init()
    return () => {
      cancelled = true
      paymentElRef.current?.unmount()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sessionId])

  // Montarea Payment Element-ului cere div-ul din faza 'ready'.
  useEffect(() => {
    if (phase === 'ready' && mountRef.current && paymentElRef.current) {
      paymentElRef.current.mount(mountRef.current)
    }
  }, [phase])

  async function handleConfirm(): Promise<void> {
    if (!stripeRef.current || !elementsRef.current) return
    setPhase('confirming')
    setErrorMsg(null)
    try {
      const result = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        // Cardurile nu redirecționează cu 'if_required'; metodele cu redirect
        // (3DS & co.) revin pe pagina QR cu plata, sesiunea și felul ei în URL
        // — QrMenuPage reia confirmarea de la server, apoi curăță URL-ul.
        confirmParams: {
          return_url: paymentId
            ? buildTablePaymentReturnUrl(window.location.href, {
                paymentId,
                sessionId,
              })
            : window.location.href,
        },
        redirect: 'if_required',
      })
      if (result.error) {
        // Mesajul vine de la Stripe, localizat prin `locale` (nu e text de-al nostru).
        setErrorMsg(result.error.message || T(lang, 'pt_declined'))
        setPhase('ready')
        return
      }
      // Cardul refuzat după confirmare: înapoi la formular, fără server.
      const piStatus = result.paymentIntent?.status
      if (piStatus === 'requires_payment_method') {
        setErrorMsg(T(lang, 'pt_declined'))
        setPhase('ready')
        return
      }
      // Orice altceva (`succeeded`, `processing`, …) e doar rezultatul din
      // BROWSER: „Plătit” îl spune serverul, după decontare (mig 312).
      if (paymentId) {
        startServerConfirmation(paymentId, browserStatusFrom(piStatus))
      } else {
        setErrorMsg(T(lang, 'pt_processing'))
        setPhase('ready')
      }
    } catch (e) {
      setErrorMsg(describeGuestError(lang, e, { fallback: 'pt_confirm_failed' }))
      setPhase('ready')
    }
  }


  async function handlePayOtherwise(): Promise<void> {
    // Anulăm intent-ul ca să nu rămână confirmabil (altfel un tap întârziat
    // ar putea încasa banii DUPĂ ce ospătarul ia cash). Dacă între timp plata
    // chiar a reușit, arătăm starea de plătit — nu chemăm nota degeaba.
    if (paymentId) {
      try {
        const result = await cancelTablePayment(paymentId, token, sessionId)
        safeRemove(splitPidKey(sessionId))
        if (result === 'succeeded') {
          // Stripe zice că a trecut — „Plătit” tot serverul îl confirmă.
          startServerConfirmation(paymentId, 'succeeded')
          return
        }
      } catch {
        // Anularea a eșuat pe rețea — tot lăsăm clientul la ospătar; intent-ul
        // neconfirmat expiră singur, iar settle-ul sare comenzile plătite cash.
      }
    }
    onPayOtherwise()
  }

  const canConfirm = phase === 'ready'
  // Banii pot fi deja în drum: nicio anulare, nicio trimitere la ospătar.
  const awaitingServer = phase === 'confirming_server' || phase === 'pending_confirmation'

  function handleRecheck(): void {
    if (confirmRefRef.current) {
      startServerConfirmation(confirmRefRef.current, confirmBrowserRef.current)
    }
  }

  function handleClose(): void {
    // În modul split, închiderea fără plată eliberează claims-urile
    // (best-effort) — altfel colegii de masă văd produsele „revendicate".
    // NU și cât așteptăm serverul: plata poate fi deja încasată. `isSplit`, nu
    // `claims`: la reluarea din redirect (ex. 3DS eșuat) claims-urile nu mai
    // sunt în props, iar felul îl spune serverul.
    if (isSplit && paymentId && phase !== 'paid' && !awaitingServer) {
      void cancelTablePayment(paymentId, token, sessionId)
        .then(() => safeRemove(splitPidKey(sessionId)))
        .catch(() => {
          /* best-effort: TTL-ul de 15 min + pid-ul din sessionStorage preiau */
        })
    }
    onClose()
  }

  // Semantică de dialog modal (paritate cu ProductSheet): focus în panou la
  // deschidere, restaurare la închidere + Escape → handleClose. Escape respectă
  // aceeași gardă ca backdrop-ul (blocat în timpul confirmării Stripe); ref-ul
  // ține varianta curentă, nu una stale de la montare.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const escCloseRef = useRef<() => void>(() => {})
  escCloseRef.current = () => {
    if (phase !== 'confirming' && phase !== 'confirming_server') handleClose()
  }
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') escCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      prev?.focus()
    }
  }, [])

  return (
    <div
      onClick={phase === 'confirming' || phase === 'confirming_server' ? undefined : handleClose}
      className="animate-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,18,8,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 120,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={T(lang, 'pay_table')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PUB.bg,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '16px 20px calc(20px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          outline: 'none',
        }}
      >
        <FocusTrap />
        <div
          style={{ width: 40, height: 4, borderRadius: 2, background: PUB.border, margin: '0 auto' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 20,
              fontWeight: 700,
              color: PUB.text,
            }}
          >
            {isSplit ? T(lang, 'pay_your_share') : T(lang, 'pay_table')}
          </span>
          {amount != null && (
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 18,
                fontWeight: 700,
                color: legibleOn(accent, PUB.bg),
              }}
            >
              {fmtPrice(amount, currency)}
            </span>
          )}
        </div>

        {phase === 'loading' && (
          <div
            role="status"
            aria-busy="true"
            style={{ color: PUB.text2, fontSize: 14, padding: '28px 0', textAlign: 'center' }}
          >
            {T(lang, 'pt_preparing')}
          </div>
        )}

        {phase === 'confirming_server' && (
          <div
            role="status"
            aria-busy="true"
            style={{ color: PUB.text2, fontSize: 14, padding: '28px 0', textAlign: 'center' }}
          >
            <div
              aria-hidden="true"
              style={{
                animation: 'spin 0.8s linear infinite',
                width: 28,
                height: 28,
                margin: '0 auto 12px',
                borderRadius: '50%',
                border: `3px solid ${PUB.border}`,
                borderTopColor: legibleOn(accent, PUB.bg),
              }}
            />
            {T(lang, 'pt_confirming_server')}
          </div>
        )}

        {phase === 'pending_confirmation' && (
          <div
            role="status"
            style={{
              background: PUB.surface,
              border: `1px solid ${PUB.borderStrong}`,
              borderRadius: 12,
              padding: '14px 16px',
              color: PUB.text,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <strong>{T(lang, 'pt_pending_title')}</strong>
            <br />
            {T(lang, 'pt_pending_body')}
          </div>
        )}

        {phase === 'error' && (
          <div
            role="alert"
            style={{
              background: 'rgba(192,57,43,0.08)',
              border: '1px solid rgba(192,57,43,0.25)',
              borderRadius: 12,
              padding: '14px 16px',
              color: '#c0392b',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {errorMsg}
          </div>
        )}

        {phase === 'paid' && (
          <div
            style={{
              background: 'rgba(46,139,87,0.1)',
              border: '1px solid rgba(46,139,87,0.3)',
              borderRadius: 12,
              padding: '16px',
              color: PUB.text,
              fontSize: 14,
              lineHeight: 1.6,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
            <strong>{T(lang, 'pt_done')}</strong>
            <br />
            {T(lang, 'pt_done_receipt')}
          </div>
        )}

        {(phase === 'ready' || phase === 'confirming') && (
          <>
            {/* Containerul Payment Element (Stripe injectează iframe-ul aici). */}
            <div ref={mountRef} style={{ minHeight: 220 }} />
            {errorMsg && (
              <div style={{ color: '#c0392b', fontSize: 13, lineHeight: 1.5 }}>{errorMsg}</div>
            )}
            <div style={{ fontSize: 11, color: PUB.text3, textAlign: 'center' }}>
              {T(lang, 'pt_secure')}
            </div>
          </>
        )}

        {(() => {
          // Butonul principal: „Plătește” (ready), „Verifică din nou”
          // (pending_confirmation), „Închide” (paid/error), dezactivat cât
          // așteaptă Stripe sau serverul.
          const closeLike = phase === 'paid' || phase === 'error'
          const primary = canConfirm || phase === 'pending_confirmation'
          const enabled = primary || closeLike
          return (
            <button
              type="button"
              disabled={!enabled}
              onClick={
                closeLike
                  ? handleClose
                  : phase === 'pending_confirmation'
                    ? handleRecheck
                    : () => void handleConfirm()
              }
              className={enabled ? 'pressable' : ''}
              style={{
                background: closeLike ? PUB.surface : primary ? accent : PUB.surface,
                color: closeLike
                  ? PUB.text
                  : primary
                    ? readableTextOn(accent, PUB.text)
                    : PUB.text3,
                border: closeLike ? `1px solid ${PUB.borderStrong}` : 'none',
                borderRadius: 16,
                padding: '15px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 16,
                fontWeight: 700,
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: phase === 'confirming' || phase === 'confirming_server' ? 0.7 : 1,
              }}
            >
              {phase === 'confirming' || phase === 'confirming_server'
                ? T(lang, 'pt_processing_short')
                : phase === 'pending_confirmation'
                  ? T(lang, 'pt_recheck')
                  : closeLike
                    ? T(lang, 'close')
                    : amount != null
                      ? Tf(lang, 'pt_pay_amount', { amount: fmtPrice(amount, currency) })
                      : T(lang, 'pt_pay')}
            </button>
          )
        })()}

        {/* Secundar: „plătesc la ospătar” (ready/error) sau „Închide” cât
            așteptăm confirmarea — atunci banii pot fi deja în drum, deci NU
            oferim trimiterea la ospătar (ar însemna o a doua încasare). */}
        {(phase === 'ready' || phase === 'error' || phase === 'pending_confirmation') && (
          <button
            type="button"
            onClick={phase === 'pending_confirmation' ? handleClose : () => void handlePayOtherwise()}
            className="pressable"
            style={{
              background: 'transparent',
              color: PUB.text2,
              border: `1px solid ${PUB.borderStrong}`,
              borderRadius: 16,
              padding: '13px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {phase === 'pending_confirmation' ? T(lang, 'close') : T(lang, 'pt_pay_waiter')}
          </button>
        )}
      </div>
    </div>
  )
}
