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
import { Button } from '../ui/Button'
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
      // Managerul (non-owner) nu are stripe_customer_id — planul aparține
      // restaurantului, dar abonamentul e pe contul PROPRIETARULUI. Fără mesajul
      // dedicat, managerul primea dead-end-ul derutant „Nu ai încă un abonament".
      setErr(
        be.code === 'no_customer'
          ? 'Abonamentul e gestionat de contul proprietarului restaurantului.'
          : be.message || 'Nu am putut deschide portalul de facturare.',
      )
      setLoading(false)
    }
  }

  return (
    <Card
      variant="flat"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <Icon name="receipt" size={24} color={D.gold} />
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
      <Button variant="secondary" onClick={handleOpen} loading={loading}>
        {loading ? 'Se deschide…' : 'Gestionează abonamentul'}
        {!loading && <Icon name="chevronRight" size={16} />}
      </Button>
    </Card>
  )
}
