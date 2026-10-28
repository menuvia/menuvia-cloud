// PickupDetails — ora de ridicare, numele și telefonul clientului pe cardurile
// de staff (Bucătărie + Ospătar). Fără ele, o comandă pickup era un card
// „Fără masă" anonim: bucătăria nu știa pentru CÂND s-o pregătească, iar la
// ghișeu nimeni nu știa al CUI e pachetul și pe cine să sune.
// Randează null pe orice comandă care nu e pickup.
import type { Order } from '../lib/orders'
import { D } from '../lib/constants'
import { isScheduledPickupAhead, pickupTimeLabel } from '../lib/pickupOrders'
import { Icon } from './ui/Icon'

interface PickupDetailsProps {
  order: Pick<Order, 'source' | 'pickup_time' | 'created_at' | 'customer_name' | 'customer_phone'>
  // Suprascris în teste; implicit ceasul real (re-randarea vine de la părinte).
  now?: number
}

export default function PickupDetails({ order, now }: PickupDetailsProps) {
  if (order.source !== 'pickup') return null
  const time = pickupTimeLabel(order)
  const name = order.customer_name?.trim() || null
  const phone = order.customer_phone?.trim() || null
  if (time == null && name == null && phone == null) return null
  const ahead = isScheduledPickupAhead(order, now ?? Date.now())

  return (
    <div
      data-testid="pickup-details"
      style={{
        background: D.s3,
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 13,
        color: D.t1,
      }}
    >
      {time != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
          <Icon name="clock" size={14} color={ahead ? D.green : D.amber} />
          <span>
            Ridicare la <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
          </span>
        </div>
      )}
      {name != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="users" size={14} color={D.t2} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </div>
      )}
      {phone != null && (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, '')}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: D.goldL,
            textDecoration: 'none',
            minHeight: 32,
          }}
        >
          <Icon name="phone" size={14} color={D.goldL} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{phone}</span>
        </a>
      )}
    </div>
  )
}
