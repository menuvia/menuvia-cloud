// ─────────────────────────────────────────────────────────────
// SubscriptionCard — card „Abonament & facturare" pe Acasă (doar admin, tier ≥ 2).
// ─────────────────────────────────────────────────────────────
// Buton care deschide Portalul de facturare Stripe (actualizare card / schimbare
// plan / facturi). Închide bucla emailurilor de dunning: CTA-ul „Actualizează
// metoda de plată →" (payment_failed / payment_recovered) trimite la
// /dashboard?tab=billing — aici e locul unde userul poate acționa efectiv.
// Componentă self-contained (stare proprie de loading/eroare) ca să nu adauge
// complexitate în HomeTab.
import { useState } from 'react'
import { D } from '../../lib/constants'
import { Card } from '../ui/Card'
import { Icon } from '../ui/Icon'
import { openBillingPortal, type BillingError } from '../../lib/billing'

export function SubscriptionCard({ planName }: { planName?: string }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleOpen() {
    setErr(null)
    setLoading(true)
    try {
      await openBillingPortal()
      // openBillingPortal redirecționează la succes; nu ajungem aici.
    } catch (e) {
      const be = e as BillingError
      setErr(be.message || 'Nu am putut deschide portalul de facturare.')
      setLoading(false)
    }
  }

  return (
    <Card
      variant="flat"
      padding="18px 20px"
      radius={14}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        border: `1px solid ${D.border}`,
      }}
    >
      <span style={{ fontSize: '1.5rem' }} aria-hidden="true">
        💳
      </span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ color: D.t1, fontSize: '0.92rem', fontWeight: 600 }}>
          Abonament &amp; facturare
        </div>
        <div style={{ color: D.t2, fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
          {planName ? `Planul tău: ${planName}. ` : ''}Actualizează cardul, schimbă planul sau
          descarcă facturile.
        </div>
        {err && (
          <div
            role="alert"
            style={{ color: D.red, fontSize: '0.76rem', marginTop: 6, lineHeight: 1.5 }}
          >
            {err}
          </div>
        )}
      </div>
      <button
        onClick={handleOpen}
        disabled={loading}
        className="pressable"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          background: 'transparent',
          color: D.t1,
          border: `1px solid ${D.border}`,
          borderRadius: 9,
          padding: '11px 18px',
          fontSize: '0.82rem',
          fontWeight: 700,
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.6 : 1,
          fontFamily: 'DM Sans,sans-serif',
          whiteSpace: 'nowrap',
          minHeight: 44,
        }}
      >
        {loading ? 'Se deschide…' : 'Gestionează abonamentul'}
        {!loading && <Icon name="chevronRight" size={16} color={D.t1} />}
      </button>
    </Card>
  )
}
