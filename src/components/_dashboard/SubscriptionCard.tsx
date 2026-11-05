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
import { useT } from '../../i18n/useT'
import { homeNs } from '../../i18n/ns/home'
import { commonNs } from '../../i18n/ns/common'
import { describeStaffError } from '../../i18n/staffErrors'

// Textele: namespace-ul `home` (lotul L3a). `sub_noCustomer` e neutru
// DELIBERAT: rămâne adevărat și pentru proprietarul pe gratuit, și pentru cel
// cu plan setat manual sau pilot (n-are client Stripe, deci n-are portal).
// Eroarea portalului trece prin `describeStaffError`: în română exact
// `toUserMessage` de dinainte (mesajul românesc al serverului rămâne).

export function SubscriptionCard({
  planName,
  onSeePlans,
}: {
  planName?: string
  // Obligatoriu: fără el, răspunsul `no_customer` ar rămâne iar o fundătură.
  onSeePlans: () => void
}) {
  const { t } = useT(homeNs)
  const tc = useT(commonNs)
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
      else setErr(describeStaffError(be, tc, { fallback: t('sub_portalFallback') }))
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
          {t('sub_title')}
        </div>
        <div style={{ color: D.t2, fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
          {planName ? t('sub_yourPlan', { name: planName }) : ''}
          {/* Fără client Stripe nu există card de actualizat și nici facturi de
              descărcat — textul de mai jos spune unde sunt planurile. */}
          {noCustomer ? null : t('sub_manageHint')}
        </div>
        {noCustomer && (
          <div
            role="status"
            style={{ color: D.t1, fontSize: '0.76rem', marginTop: 6, lineHeight: 1.5 }}
          >
            {t('sub_noCustomer')}
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
          {t('sub_seePlans')}
          <Icon name="chevronRight" size={16} />
        </Button>
      ) : (
        <Button variant="secondary" onClick={handleOpen} loading={loading}>
          {loading ? t('sub_opening') : t('sub_manage')}
          {!loading && <Icon name="chevronRight" size={16} />}
        </Button>
      )}
    </Card>
  )
}
