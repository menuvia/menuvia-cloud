// src/components/OrderClosedScreen.tsx
// ─────────────────────────────────────────────────────────────────
// Ecranul oaspetelui când comanda devine `closed` — terminalul Planului 2:
// ospătarul a închis nota, iar plata s-a făcut (sau se face) la casa
// localului, NU prin Menuvia. Înainte, OrderTracker arăta aici același ecran
// ca la `paid` (Plan 3): „Plată confirmată!" + sumar de plată — o afirmație
// falsă, fiindcă aplicația n-a încasat și n-a verificat nimic.
//
// Păstrează ce are sens după masă: feedback-ul privat + recenzia Google
// (submit_order_feedback cere sesiunea mesei, mig 094), pornind de la
// servire — întrebarea despre plată n-are obiect aici.
// ─────────────────────────────────────────────────────────────────
import type { OrderConfirmationPayload } from '../lib/orders'
import { fmtPrice, type MenuCurrency } from '../lib/currency'
import { T } from '../lib/publicMenuStrings'
import { FeedbackWidget } from './PaymentConfirmedScreen'

const PUB = { bg: '#F8F3EB', text: '#1A1208', muted: '#6B5A3F' } as const

interface OrderClosedScreenProps {
  confirmation: OrderConfirmationPayload
  lang: string
  accent: string
  // null = urmărire limitată (fără sesiune, mig 092): fără numele localului
  // nu are sens feedback-ul legat de Google — ecranul rămâne doar informativ.
  restaurantName: string | null
  googleReviewUrl: string | null
  sessionId?: string | null
  currency?: MenuCurrency
  hideBranding?: boolean
}

export default function OrderClosedScreen({
  confirmation,
  lang,
  accent,
  restaurantName,
  googleReviewUrl,
  sessionId = null,
  currency = 'RON',
  hideBranding = false,
}: OrderClosedScreenProps) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        inset: 0,
        background: PUB.bg,
        zIndex: 300,
        overflowY: 'auto',
        padding: '24px 16px 48px',
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 44, textAlign: 'center', padding: '32px 0 8px' }} aria-hidden="true">
          {'🧾'}
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 26,
            fontWeight: 700,
            color: PUB.text,
            textAlign: 'center',
            margin: '8px 0 10px',
          }}
        >
          {T(lang, 'order_closed_title')}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: PUB.muted,
            textAlign: 'center',
            margin: '0 0 8px',
            lineHeight: 1.5,
          }}
        >
          {T(lang, 'order_closed_pay_at_counter')}
        </p>
        <div
          style={{
            textAlign: 'center',
            fontSize: 14,
            color: PUB.text,
            margin: '0 0 28px',
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          #{confirmation.short_id} · {T(lang, 'total')}{' '}
          <strong style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>
            {fmtPrice(Number(confirmation.total) || 0, currency)}
          </strong>
        </div>

        {restaurantName != null && (
          <FeedbackWidget
            orderId={confirmation.id}
            restaurantName={restaurantName}
            googleReviewUrl={googleReviewUrl}
            accent={accent}
            sessionId={sessionId}
            initialStep="service"
            lang={lang}
          />
        )}

        {!hideBranding && (
          <div
            style={{
              textAlign: 'center',
              marginTop: 32,
              fontSize: 12,
              color: PUB.muted,
              opacity: 0.6,
            }}
          >
            {T(lang, 'powered_by')} <strong style={{ color: accent }}>Menuvia</strong>
          </div>
        )}
      </div>
    </div>
  )
}
