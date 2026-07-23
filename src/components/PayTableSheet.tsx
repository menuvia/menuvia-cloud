// PayTableSheet — plata online a mesei din meniul QR (Etapa 1).
// Bottom sheet pe tokenii temei (PUB/accent), lazy-loaded din QrMenuPage.
// Fluxul: createTablePayment (suma se calculează pe server) → Stripe Payment
// Element (js.stripe.com) → confirmPayment → succes: bonul fiscal se emite pe
// casa localului prin webhook (settle_table_payment), nu din client.
import { useEffect, useRef, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import {
  cancelTablePayment,
  createTablePayment,
  loadStripeJs,
  type SplitClaimInput,
  type StripeClient,
  type StripeElements,
  type StripePaymentElement,
} from '../lib/payments'
import { fmtPrice, resolveMenuCurrency, type MenuCurrency } from '../lib/currency'

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
  /** Chemat DOAR după confirmarea Stripe reușită. */
  onPaid: () => void
  /** Clientul renunță la plata online — părintele cheamă nota la ospătar. */
  onPayOtherwise: () => void
  /** Split pe itemi (mig 229): plătește DOAR produsele selectate. */
  claims?: readonly SplitClaimInput[]
}

type Phase = 'loading' | 'ready' | 'confirming' | 'paid' | 'error'

// Hint-urile de business → mesaj prietenos (restul afișează mesajul serverului).
const HINT_COPY: Record<string, string> = {
  module_disabled: 'Plata online nu este activată la acest local. Cere nota ospătarului.',
  not_connected: 'Localul nu a terminat configurarea plăților online. Cere nota ospătarului.',
  feature_disabled: 'Plata online nu este disponibilă la acest local. Cere nota ospătarului.',
  nothing_to_pay: 'Nu există comenzi de plătit — probabil nota a fost deja încasată.',
  invalid_session: 'Sesiunea mesei a expirat. Scanează din nou codul QR.',
  currency_not_supported:
    'Plata online e disponibilă doar pentru meniuri în lei. Cere nota ospătarului.',
  items_already_claimed:
    'Cineva de la masă plătește deja o parte din aceste produse. Alege altele sau reîncearcă.',
  invalid_items: 'Nota s-a schimbat între timp — redeschide împărțirea notei.',
}

// Cheia sessionStorage cu ultimul intent split al ACESTUI telefon: dacă
// sheet-ul a murit mid-flow (refresh/crash), claims-urile lui ar rămâne
// blocate — la redeschidere anulăm best-effort plata veche înainte de una nouă.
const splitPidKey = (sessionId: string): string => `menuvia_split_pid_${sessionId}`

export default function PayTableSheet({ token, sessionId, PUB, accent, onClose, onPaid, onPayOtherwise, claims }: Props) {
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

  useBodyScrollLock(true)

  useEffect(() => {
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
          const stalePid = sessionStorage.getItem(splitPidKey(sessionId))
          if (stalePid) {
            try {
              await cancelTablePayment(stalePid, token, sessionId)
            } catch {
              /* best-effort */
            }
            sessionStorage.removeItem(splitPidKey(sessionId))
          }
        }
        const intent = await createTablePayment(token, sessionId, claims)
        // Checkpoint-ul pid-ului se scrie ÎNAINTE de verificarea `cancelled`:
        // dacă sheet-ul a fost închis/demontat cât timp cererea era pe fir,
        // serverul TOT a creat plata (cu claims) — fără pid, nimic n-ar mai
        // elibera claims-urile de pe acest telefon.
        if (claims && claims.length > 0) {
          sessionStorage.setItem(splitPidKey(sessionId), intent.payment_id)
        }
        if (cancelled) {
          // Sheet închis mid-request: anulăm best-effort plata abia creată
          // (eliberează claims-urile imediat, nu la TTL/redeschidere).
          if (claims && claims.length > 0) {
            void cancelTablePayment(intent.payment_id, token, sessionId)
              .then(() => sessionStorage.removeItem(splitPidKey(sessionId)))
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
        })
        const paymentEl = elements.create('payment')
        stripeRef.current = stripe
        elementsRef.current = elements
        paymentElRef.current = paymentEl
        // Montăm după ce sheet-ul e în starea 'ready' (div-ul există în DOM).
        setPhase('ready')
      } catch (e) {
        if (cancelled) return
        const hint = (e as Error & { hint?: string }).hint
        setErrorMsg(
          (hint && HINT_COPY[hint]) ||
            (e instanceof Error ? e.message : 'Plata nu a putut fi inițiată.'),
        )
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
        // revin pe pagina QR (starea se reia din sessionStorage/QR rescan).
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      })
      if (result.error) {
        setErrorMsg(result.error.message || 'Plata a fost refuzată. Încearcă alt card.')
        setPhase('ready')
        return
      }
      // „Plătit" DOAR pe succeeded explicit: unele metode rezolvă în
      // 'processing' (pot încă eșua) — confirmarea reală vine prin webhook.
      const piStatus = result.paymentIntent?.status
      if (piStatus && piStatus !== 'succeeded') {
        setErrorMsg('Plata se procesează — confirmarea apare în scurt timp. Nu mai încerca o dată.')
        setPhase('ready')
        return
      }
      sessionStorage.removeItem(splitPidKey(sessionId))
      setPhase('paid')
      onPaid()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Eroare la confirmare. Reîncearcă.')
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
        sessionStorage.removeItem(splitPidKey(sessionId))
        if (result === 'succeeded') {
          setPhase('paid')
          onPaid()
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

  function handleClose(): void {
    // În modul split, închiderea fără plată eliberează claims-urile
    // (best-effort) — altfel colegii de masă văd produsele „revendicate".
    if (claims && claims.length > 0 && paymentId && phase !== 'paid') {
      void cancelTablePayment(paymentId, token, sessionId)
        .then(() => sessionStorage.removeItem(splitPidKey(sessionId)))
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
    if (phase !== 'confirming') handleClose()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      onClick={phase === 'confirming' ? undefined : handleClose}
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
        aria-label="Plătește masa"
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
            {claims && claims.length > 0 ? 'Plătește partea ta' : 'Plătește masa'}
          </span>
          {amount != null && (
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 18,
                fontWeight: 700,
                color: accent,
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
            Se pregătește plata…
          </div>
        )}

        {phase === 'error' && (
          <div
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
            <strong>Plata a fost efectuată.</strong>
            <br />
            Bonul fiscal se emite la casa restaurantului. Mulțumim!
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
              Plată securizată prin Stripe. Banii ajung direct la restaurant.
            </div>
          </>
        )}

        <button
          type="button"
          disabled={!canConfirm && phase !== 'paid' && phase !== 'error'}
          onClick={phase === 'paid' || phase === 'error' ? handleClose : () => void handleConfirm()}
          className={canConfirm || phase === 'paid' || phase === 'error' ? 'pressable' : ''}
          style={{
            background:
              phase === 'paid' || phase === 'error'
                ? PUB.surface
                : canConfirm
                  ? accent
                  : PUB.surface,
            color: phase === 'paid' || phase === 'error' ? PUB.text : canConfirm ? '#fff' : PUB.text3,
            border:
              phase === 'paid' || phase === 'error' ? `1px solid ${PUB.borderStrong}` : 'none',
            borderRadius: 16,
            padding: '15px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 16,
            fontWeight: 700,
            cursor:
              canConfirm || phase === 'paid' || phase === 'error' ? 'pointer' : 'not-allowed',
            opacity: phase === 'confirming' ? 0.7 : 1,
          }}
        >
          {phase === 'confirming'
            ? 'Se procesează…'
            : phase === 'paid'
              ? 'Închide'
              : phase === 'error'
                ? 'Închide'
                : amount != null
                  ? `Plătește ${fmtPrice(amount, currency)}`
                  : 'Plătește'}
        </button>

        {(phase === 'ready' || phase === 'error') && (
          <button
            type="button"
            onClick={() => void handlePayOtherwise()}
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
            Renunț — plătesc la ospătar
          </button>
        )}
      </div>
    </div>
  )
}
