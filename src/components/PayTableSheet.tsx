// PayTableSheet — plata online a mesei din meniul QR (Etapa 1).
// Bottom sheet pe tokenii temei (PUB/accent), lazy-loaded din QrMenuPage.
// Fluxul: createTablePayment (suma se calculează pe server) → Stripe Payment
// Element (js.stripe.com) → confirmPayment → succes: bonul fiscal se emite pe
// casa localului prin webhook (settle_table_payment), nu din client.
import { useEffect, useRef, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import {
  createTablePayment,
  loadStripeJs,
  type StripeClient,
  type StripeElements,
  type StripePaymentElement,
} from '../lib/payments'

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
}

type Phase = 'loading' | 'ready' | 'confirming' | 'paid' | 'error'

// Hint-urile de business → mesaj prietenos (restul afișează mesajul serverului).
const HINT_COPY: Record<string, string> = {
  module_disabled: 'Plata online nu este activată la acest local. Cere nota ospătarului.',
  not_connected: 'Localul nu a terminat configurarea plăților online. Cere nota ospătarului.',
  feature_disabled: 'Plata online nu este disponibilă la acest local. Cere nota ospătarului.',
  nothing_to_pay: 'Nu există comenzi de plătit — probabil nota a fost deja încasată.',
  invalid_session: 'Sesiunea mesei a expirat. Scanează din nou codul QR.',
}

export default function PayTableSheet({ token, sessionId, PUB, accent, onClose, onPaid }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeClient | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const paymentElRef = useRef<StripePaymentElement | null>(null)

  useBodyScrollLock(true)

  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      try {
        const intent = await createTablePayment(token, sessionId)
        if (cancelled) return
        setAmount(intent.amount)
        const Stripe = await loadStripeJs()
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
      setPhase('paid')
      onPaid()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Eroare la confirmare. Reîncearcă.')
      setPhase('ready')
    }
  }

  const canConfirm = phase === 'ready'

  return (
    <div
      onClick={phase === 'confirming' ? undefined : onClose}
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
            Plătește masa
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
              {amount.toFixed(2)} lei
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
          onClick={phase === 'paid' || phase === 'error' ? onClose : () => void handleConfirm()}
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
                  ? `Plătește ${amount.toFixed(2)} lei`
                  : 'Plătește'}
        </button>
      </div>
    </div>
  )
}
