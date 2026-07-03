// src/components/PaymentConfirmedScreen.tsx
// ─────────────────────────────────────────────────────────────────
// Ecran afișat după ce comanda devine `paid` (status terminal).
// Conține:
//   1. Animație checkmark + mesaj "Plată confirmată!"
//   2. Feedback widget rotativ (experiență plată / servire / mâncare)
//   3. Google Review CTA (apare după feedback pozitiv)
//   4. Sumar plată (subtotal, tips, total)
//   5. Buton "Am nevoie de bonul fiscal"
//   6. LanguageSwitcher RO/EN în colț
//
// Folosit din OrderTracker când status === 'paid'.
// ─────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { OrderConfirmationPayload } from '../lib/orders'
import { t, useLanguage } from '../lib/i18n'
import LanguageSwitcher from './LanguageSwitcher'

const PUB = { bg: '#F8F3EB', text: '#1A1208', muted: '#6B5A3F' } as const

// Acceptă DOAR scheme http/https pentru href-uri provenite din date editabile de
// restaurant (google_review_url). Blochează javascript:/data: etc. → anti-XSS pe
// ecranul public de plată (audit P2). Returnează null pentru orice URL nesigur.
function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    const proto = new URL(u).protocol
    return proto === 'https:' || proto === 'http:' ? u : null
  } catch {
    return null
  }
}

interface PaymentConfirmedScreenProps {
  confirmation: OrderConfirmationPayload
  restaurantName: string
  googleReviewUrl: string | null
  accent: string
  tipsAmount?: number
  fastPayFee?: number
  onRequestFiscalReceipt?: () => void
  fiscalReceiptRequested?: boolean
  // Sesiunea mesei: submit_order_feedback (mig 094) RESPINGE feedback-ul pe
  // comenzile de la masă fără sesiune validă — fără ea, tot funnel-ul e mort
  // pe cazul principal (QR la masă), cu eroarea înghițită silențios.
  sessionId?: string | null
}

export default function PaymentConfirmedScreen({
  confirmation,
  restaurantName,
  googleReviewUrl,
  accent,
  tipsAmount = 0,
  fastPayFee = 0,
  onRequestFiscalReceipt,
  fiscalReceiptRequested = false,
  sessionId = null,
}: PaymentConfirmedScreenProps) {
  const { lang } = useLanguage()
  const total = Number(confirmation.total) || 0
  const subtotal = total - tipsAmount - fastPayFee

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: PUB.bg,
        zIndex: 300,
        overflowY: 'auto',
        padding: '24px 16px 48px',
      }}
    >
      <LanguageSwitcher variant="light" position="top-right" />

      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {/* Animație checkmark */}
        <CheckmarkAnimation accent={accent} />

        {/* Mesaj */}
        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 28,
            fontWeight: 700,
            color: PUB.text,
            textAlign: 'center',
            margin: '8px 0 12px',
          }}
        >
          {t('paid.title', lang)}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: PUB.muted,
            textAlign: 'center',
            margin: '0 0 28px',
            lineHeight: 1.5,
            whiteSpace: 'pre-line',
          }}
        >
          {t('paid.subtitle', lang)}
        </p>

        {/* Feedback widget */}
        <FeedbackWidget
          orderId={confirmation.id}
          restaurantName={restaurantName}
          googleReviewUrl={googleReviewUrl}
          accent={accent}
          sessionId={sessionId}
        />

        {/* Sumar plată */}
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E8DFD0',
            borderRadius: 14,
            padding: 20,
            marginTop: 24,
          }}
        >
          <SummaryRow
            label={t('paid.subtotal', lang)}
            value={`${subtotal.toFixed(2)} ${t('common.lei', lang)}`}
          />
          {tipsAmount > 0 && (
            <SummaryRow
              label={t('paid.tips', lang)}
              value={`${tipsAmount.toFixed(2)} ${t('common.lei', lang)}`}
              muted
            />
          )}
          {fastPayFee > 0 && (
            <SummaryRow
              label={t('paid.fastPayFee', lang)}
              value={`${fastPayFee.toFixed(2)} ${t('common.lei', lang)}`}
              muted
            />
          )}
          <div
            style={{
              height: 1,
              background: '#E8DFD0',
              margin: '12px 0',
              borderTop: '1px dashed #D5CBB8',
              opacity: 0.6,
            }}
          />
          <SummaryRow
            label={t('paid.total', lang)}
            value={`${total.toFixed(2)} ${t('common.lei', lang)}`}
            bold
          />

          {/* Buton bon fiscal */}
          {onRequestFiscalReceipt && (
            <button
              type="button"
              onClick={onRequestFiscalReceipt}
              disabled={fiscalReceiptRequested}
              style={{
                width: '100%',
                marginTop: 16,
                padding: '14px 16px',
                background: 'transparent',
                border: `1.5px solid ${fiscalReceiptRequested ? '#7EB87E' : PUB.text}`,
                borderRadius: 999,
                color: fiscalReceiptRequested ? '#4CAF6E' : PUB.text,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'DM Sans, sans-serif',
                cursor: fiscalReceiptRequested ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontSize: 16 }}>{fiscalReceiptRequested ? '✓' : '🧾'}</span>
              {fiscalReceiptRequested
                ? t('paid.fiscalRequested', lang)
                : t('paid.needFiscalReceipt', lang)}
            </button>
          )}
        </div>

        {/* Powered by */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 32,
            fontSize: 12,
            color: PUB.muted,
            opacity: 0.6,
          }}
        >
          {t('common.poweredBy', lang)} <strong style={{ color: accent }}>Menuvia</strong>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// CheckmarkAnimation — animație SVG cu cerc + check
// ─────────────────────────────────────────────────────────────────
function CheckmarkAnimation({ accent }: { accent: string }) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '32px 0 16px',
        position: 'relative',
      }}
    >
      {/* Floating dots */}
      <Dot color={accent} top={20} left="20%" delay={0.3} />
      <Dot color={accent} top={60} right="22%" delay={0.5} />
      <Dot color={accent} top={75} left="32%" delay={0.7} />
      <Dot color={accent} top={10} right="32%" delay={0.4} />

      <svg
        width="96"
        height="96"
        viewBox="0 0 96 96"
        style={{
          transform: animated ? 'scale(1)' : 'scale(0)',
          transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Cerc */}
        <circle
          cx="48"
          cy="48"
          r="44"
          fill={accent}
          opacity="0.15"
          style={{
            transform: animated ? 'scale(1)' : 'scale(0)',
            transformOrigin: 'center',
            transition: 'transform 0.4s ease-out',
          }}
        />
        <circle cx="48" cy="48" r="32" fill={accent} />
        {/* Checkmark */}
        <path
          d="M 32 48 L 44 60 L 64 38"
          stroke="#FFFFFF"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            strokeDasharray: 60,
            strokeDashoffset: animated ? 0 : 60,
            transition: 'stroke-dashoffset 0.5s ease-out 0.2s',
          }}
        />
      </svg>
    </div>
  )
}

function Dot({
  color,
  top,
  left,
  right,
  delay,
}: {
  color: string
  top: number
  left?: string
  right?: string
  delay: number
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay * 1000)
    return () => clearTimeout(t)
  }, [delay])
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
        right,
        width: 6,
        height: 6,
        background: color,
        borderRadius: 2,
        transform: `rotate(45deg) scale(${visible ? 1 : 0})`,
        opacity: visible ? 0.8 : 0,
        transition: 'all 0.4s ease-out',
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────
// SummaryRow — un rând în sumar
// ─────────────────────────────────────────────────────────────────
function SummaryRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string
  value: string
  bold?: boolean
  muted?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '6px 0',
        fontSize: bold ? 17 : 14,
        fontWeight: bold ? 700 : 400,
        color: muted ? PUB.muted : PUB.text,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// FeedbackWidget — rotează prin 3 întrebări, salvează în order_feedback
// ─────────────────────────────────────────────────────────────────
type FeedbackStep = 'payment' | 'service' | 'food' | 'complete'

interface FeedbackWidgetProps {
  orderId: string
  restaurantName: string
  googleReviewUrl: string | null
  accent: string
  sessionId?: string | null
}

function FeedbackWidget({
  orderId,
  restaurantName,
  googleReviewUrl,
  accent,
  sessionId = null,
}: FeedbackWidgetProps) {
  const { lang } = useLanguage()
  const [step, setStep] = useState<FeedbackStep>('payment')
  const [paymentRating, setPaymentRating] = useState<'up' | 'down' | null>(null)
  const [serviceRating, setServiceRating] = useState<number | null>(null)
  const [foodRating, setFoodRating] = useState<number | null>(null)
  const [negativeFeedback, setNegativeFeedback] = useState('')
  // Interceptare privată (pattern Qerko/sunday): ORICE notă slabă — nu doar
  // degetul în jos la plată — deschide formularul de feedback privat, ca
  // nemulțumirea să ajungă la owner ÎNAINTE să ajungă pe Google.
  const [negativeFor, setNegativeFor] = useState<'payment' | 'service' | 'food' | null>(null)

  async function saveFeedback(type: 'payment' | 'service' | 'food', rating: number, text?: string) {
    try {
      // RPC public (mig 043, session-gate în mig 094): comenzile de la masă
      // CER p_session_id valid — fără el serverul respinge feedback-ul.
      await supabase.rpc('submit_order_feedback', {
        p_order_id: orderId,
        p_feedback_type: type,
        p_rating: rating,
        p_comment: text || null,
        p_session_id: sessionId,
      })
    } catch (e) {
      // Silent — feedback e nice-to-have, nu blocăm flow-ul
      console.warn('feedback save failed:', e)
    }
  }

  function handlePayment(rating: 'up' | 'down') {
    setPaymentRating(rating)
    void saveFeedback('payment', rating === 'up' ? 5 : 1)
    if (rating === 'down') {
      setNegativeFor('payment')
    } else {
      setTimeout(() => setStep('service'), 600)
    }
  }

  function handleService(stars: number) {
    setServiceRating(stars)
    void saveFeedback('service', stars)
    if (stars <= 3) {
      setNegativeFor('service')
    } else {
      setTimeout(() => setStep('food'), 600)
    }
  }

  function handleFood(stars: number) {
    setFoodRating(stars)
    void saveFeedback('food', stars)
    if (stars <= 3) {
      setNegativeFor('food')
    } else {
      setTimeout(() => setStep('complete'), 600)
    }
  }

  function submitNegativeFeedback() {
    if (negativeFeedback.trim() && negativeFor) {
      const rating =
        negativeFor === 'payment' ? 1
        : negativeFor === 'service' ? (serviceRating ?? 1)
        : (foodRating ?? 1)
      void saveFeedback(negativeFor, rating, negativeFeedback.trim())
    }
    // După ce clientul și-a spus oful, nu-l mai plimbăm prin restul
    // întrebărilor — mulțumim și încheiem.
    setNegativeFor(null)
    setStep('complete')
  }

  // Calculează dacă să arătăm Google Review CTA
  const avgRating = [
    paymentRating === 'up' ? 5 : paymentRating === 'down' ? 1 : null,
    serviceRating,
    foodRating,
  ]
    .filter((r): r is number => r !== null)
    .reduce((a, b, _, arr) => a + b / arr.length, 0)
  const safeReviewUrl = safeHttpUrl(googleReviewUrl)
  const showGoogleCTA = step === 'complete' && avgRating >= 4 && safeReviewUrl

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E8DFD0',
        borderRadius: 14,
        padding: 24,
        textAlign: 'center',
      }}
    >
      {/* Title */}
      <div
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 17,
          fontWeight: 700,
          color: PUB.text,
          marginBottom: 14,
        }}
      >
        {step === 'complete' ? t('feedback.thanks', lang) : t('feedback.title', lang)}
      </div>

      {/* Step: Payment */}
      {step === 'payment' && negativeFor === null && (
        <>
          <div style={{ fontSize: 14, color: PUB.muted, marginBottom: 18 }}>
            {t('feedback.askPayment', lang)}
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <ThumbButton
              direction="down"
              active={paymentRating === 'down'}
              onClick={() => handlePayment('down')}
            />
            <ThumbButton
              direction="up"
              active={paymentRating === 'up'}
              onClick={() => handlePayment('up')}
            />
          </div>
        </>
      )}

      {/* Feedback privat — orice notă slabă, indiferent de pas */}
      {negativeFor !== null && (
        <>
          <div style={{ fontSize: 14, color: PUB.muted, marginBottom: 14 }}>
            {t('feedback.negative', lang)}
          </div>
          <textarea
            value={negativeFeedback}
            onChange={(e) => setNegativeFeedback(e.target.value)}
            placeholder={t('feedback.negativePlaceholder', lang)}
            rows={3}
            maxLength={500}
            style={{
              width: '100%',
              padding: 12,
              border: '1px solid #E8DFD0',
              borderRadius: 10,
              fontSize: 13,
              fontFamily: 'DM Sans, sans-serif',
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: 12,
            }}
          />
          <button
            onClick={submitNegativeFeedback}
            style={{
              background: accent,
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 999,
              padding: '10px 24px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            {t('feedback.send', lang)}
          </button>
        </>
      )}

      {/* Step: Service */}
      {step === 'service' && negativeFor === null && (
        <>
          <div style={{ fontSize: 14, color: PUB.muted, marginBottom: 18 }}>
            {t('feedback.askService', lang)}
          </div>
          <StarRating value={serviceRating} onChange={handleService} accent={accent} />
        </>
      )}

      {/* Step: Food */}
      {step === 'food' && negativeFor === null && (
        <>
          <div style={{ fontSize: 14, color: PUB.muted, marginBottom: 18 }}>
            {t('feedback.askFood', lang)}
          </div>
          <StarRating value={foodRating} onChange={handleFood} accent={accent} />
        </>
      )}

      {/* Step: Complete + Google Review CTA */}
      {step === 'complete' && (
        <>
          {showGoogleCTA && safeReviewUrl ? (
            <>
              <div style={{ fontSize: 13, color: PUB.muted, marginBottom: 16, lineHeight: 1.5 }}>
                {t('feedback.googleCTAText', lang)} <strong>{restaurantName}</strong>.
              </div>
              <a
                href={safeReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  border: `1.5px solid ${accent}`,
                  borderRadius: 999,
                  padding: '12px 20px',
                  textDecoration: 'none',
                  color: accent,
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: 'DM Sans, sans-serif',
                  background: '#FFFFFF',
                  transition: 'all 0.15s',
                }}
              >
                <GoogleLogo />
                {t('feedback.googleCTAButton', lang)}
              </a>
            </>
          ) : (
            <div style={{ fontSize: 13, color: PUB.muted }}>{t('feedback.thanks', lang)}.</div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// ThumbButton — buton thumb-up / thumb-down rotund
// ─────────────────────────────────────────────────────────────────
function ThumbButton({
  direction,
  active,
  onClick,
}: {
  direction: 'up' | 'down'
  active: boolean
  onClick: () => void
}) {
  const color = direction === 'up' ? '#4CAF6E' : '#E25555'
  return (
    <button
      onClick={onClick}
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        border: `2px solid ${color}`,
        background: active ? color : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 26,
        transition: 'all 0.2s',
        transform: active ? 'scale(1.1)' : 'scale(1)',
      }}
      aria-label={direction === 'up' ? 'Bine' : 'Nu prea bine'}
    >
      {direction === 'up' ? '👍' : '👎'}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// StarRating — 5 stele clickable
// ─────────────────────────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  accent,
}: {
  value: number | null
  onChange: (v: number) => void
  accent: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = (hovered ?? value ?? 0) >= n
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(null)}
            aria-label={`${n} stele`}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              width: 38,
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.1s',
              transform: filled ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path
                d="M12 2 L14.4 8.4 L21 9.2 L16 13.8 L17.3 20.5 L12 17.2 L6.7 20.5 L8 13.8 L3 9.2 L9.6 8.4 Z"
                fill={filled ? accent : 'none'}
                stroke={accent}
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}
