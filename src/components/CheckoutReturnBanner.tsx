// Bannerul de întoarcere din Stripe (`?checkout=success|cancelled`).
//
// DELIBERAT nu e un `role="dialog"` și nu stă fixat JOS: overlay-urile de jos
// interceptează click-urile pe bara de navigare mobilă (clasa documentată în
// CLAUDE.md, cookie banner / cardurile PWA). E o bandă `role="status"` sus,
// care se poate închide și nu blochează nimic sub ea.
import { useAuth } from '../contexts/AuthContext'
import { useCheckoutReturn, type CheckoutReturnStatus } from '../hooks/useCheckoutReturn'
import { D } from '../lib/constants'

const COPY: Record<Exclude<CheckoutReturnStatus, 'idle'>, { title: string; body: string }> = {
  activating: {
    title: 'Activăm planul…',
    body: 'Plata a fost primită. Actualizăm contul tău — durează câteva secunde.',
  },
  active: {
    title: 'Planul tău e activ',
    body: 'Mulțumim! Funcțiile noului plan sunt disponibile de acum.',
  },
  slow: {
    title: 'Activarea durează mai mult decât de obicei',
    body: 'Plata a fost primită, dar planul nu apare încă în cont. Reîncarcă pagina peste un minut; dacă nu se schimbă, scrie-ne.',
  },
  cancelled: {
    title: 'Plata a fost anulată',
    body: 'Nu s-a încasat nimic. Poți alege un plan oricând de pe această pagină.',
  },
}

export default function CheckoutReturnBanner() {
  const { user, profile, refreshProfile } = useAuth()
  const { status, dismiss } = useCheckoutReturn({
    hasUser: user != null,
    plan: profile?.plan ?? null,
    refreshProfile,
  })

  if (status === 'idle') return null
  const copy = COPY[status]
  const tone =
    status === 'active'
      ? { bg: D.greenA, border: D.green }
      : status === 'cancelled' || status === 'slow'
        ? { bg: D.amberA, border: D.amber }
        : { bg: D.infoA, border: D.info }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="checkout-return-banner"
      style={{
        position: 'fixed',
        top: 12,
        left: 16,
        right: 16,
        zIndex: 9000,
        maxWidth: 560,
        margin: '0 auto',
        background: D.s1,
        backgroundImage: `linear-gradient(${tone.bg}, ${tone.bg})`,
        border: `1px solid ${tone.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        fontFamily: D.fontBody,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: D.t1, fontWeight: 700, fontSize: '0.95rem' }}>{copy.title}</div>
        <div style={{ color: D.t2, fontSize: '0.85rem', marginTop: 2, lineHeight: 1.45 }}>
          {copy.body}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Închide mesajul"
        style={{
          background: 'transparent',
          border: 'none',
          color: D.t2,
          fontSize: '1.1rem',
          lineHeight: 1,
          cursor: 'pointer',
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  )
}
