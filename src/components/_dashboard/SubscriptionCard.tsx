// ─────────────────────────────────────────────────────────────
// SubscriptionCard — card „Abonament & facturare" din Setări → Abonament & cont
// (SettingsTab): ORICE plan, doar PROPRIETARUL (abonamentul e pe contul lui).
// ─────────────────────────────────────────────────────────────
// Buton care deschide Portalul de facturare Stripe (actualizare card / schimbare
// plan / facturi). Închide bucla emailurilor de dunning: CTA-ul „Actualizează
// metoda de plată →" (payment_failed / payment_recovered) trimite la
// /dashboard?tab=billing — aici e locul unde userul poate acționa efectiv.
// `no_customer` (proprietar pe gratuit care n-a pornit niciodată un checkout,
// sau cu plan setat manual — pilot / FounderPage) → mesaj adevărat + „Vezi
// planurile", nu o fundătură.
// Componentă self-contained (stare proprie de loading/eroare).
import { useState } from 'react'
import { D } from '../../lib/constants'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Icon } from '../ui/Icon'
import { openBillingPortal, type BillingError } from '../../lib/billing'
import { toUserMessage } from '../../lib/userMessages'

// Neutru DELIBERAT: rămâne adevărat și pentru proprietarul pe gratuit, și pentru
// cel cu plan setat manual sau pilot (n-are client Stripe, deci n-are portal).
const NO_CUSTOMER_TEXT =
  'Contul tău nu are un abonament plătit cu cardul, deci aici nu ai nimic de gestionat. Planurile și prețurile sunt pe pagina de planuri.'
const PORTAL_FALLBACK = 'Nu am putut deschide portalul de facturare. Reîncearcă în câteva momente.'

export function SubscriptionCard({
  planName,
  onSeePlans,
}: {
  planName?: string
  // Obligatoriu: fără el, răspunsul `no_customer` ar rămâne iar o fundătură.
  onSeePlans: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [noCustomer, setNoCustomer] = useState(false)

  async function handleOpen() {
    setErr(null)
    setNoCustomer(false)
    setLoading(true)
    try {
      await openBillingPortal()
      // openBillingPortal redirecționează la succes; nu ajungem aici.
    } catch (e) {
      const be = e as BillingError
      // Serverul (stripe-portal.js) e singura autoritate pe „are client
      // Stripe": un fost abonat retrogradat pe gratuit are încă facturi în
      // portal, deci nu se poate decide din plan înainte de click.
      if (be.code === 'no_customer') setNoCustomer(true)
      else setErr(toUserMessage(be, PORTAL_FALLBACK))
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
        {noCustomer && (
          <div
            role="status"
            style={{ color: D.t1, fontSize: '0.76rem', marginTop: 6, lineHeight: 1.5 }}
          >
            {NO_CUSTOMER_TEXT}
          </div>
        )}
        {err && (
          <div
            role="alert"
            style={{ color: D.red, fontSize: '0.76rem', marginTop: 6, lineHeight: 1.5 }}
          >
            {err}
          </div>
        )}
      </div>
      {noCustomer ? (
        <Button variant="primary" onClick={onSeePlans}>
          Vezi planurile
          <Icon name="chevronRight" size={16} />
        </Button>
      ) : (
        <Button variant="secondary" onClick={handleOpen} loading={loading}>
          {loading ? 'Se deschide…' : 'Gestionează abonamentul'}
          {!loading && <Icon name="chevronRight" size={16} />}
        </Button>
      )}
    </Card>
  )
}
