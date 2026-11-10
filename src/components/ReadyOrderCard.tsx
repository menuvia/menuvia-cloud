// Cardul „Gata de servit" de pe ecranul ospătarului (scos din WaiterPage).
// Butonul „Servit" stă dezactivat cât acțiunea e în curs, iar refuzul
// serverului apare SUB card, în limba personalului (ux-staff-double-tap-advance +
// ux-staff-action-errors). Garda de dublu-tap ÎNTRE carduri (cardul vecin
// urcă sub deget după „Servit") e în pagină, pe handler — lib/tapGuard.ts.
import { memo } from 'react'
import type { Order, StaffActionFailure } from '../lib/orders'
import { D } from '../lib/constants'
import { ActionErrorNote } from './ActionErrorNote'
import { OrderLineDetails } from './OrderLineDetails'
import { useT } from '../i18n/useT'
import { ordersNs } from '../i18n/ns/orders'

interface ReadyOrderCardProps {
  order: Order
  onServe: (order: Order) => void
  pending?: boolean
  actionError?: StaffActionFailure | null
  onDismissError?: (id: string) => void
}

function ReadyOrderCardInner({
  order,
  onServe,
  pending = false,
  actionError = null,
  onDismissError,
}: ReadyOrderCardProps) {
  const { t } = useT(ordersNs)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        className="hover-lift"
        style={{
          background: D.greenA,
          border: `1px solid ${D.green}55`,
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 18,
              fontWeight: 700,
              color: D.t1,
            }}
          >
            {order.table?.name ?? t('noTable')}
          </div>
          {/* Ce se servește, cu cantitatea, opțiunile, extra-urile și nota
              (lotul O2a): înainte doar numele, fără cantitate. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
            {order.order_items.map((it) => (
              <div key={it.id} data-testid="order-line" style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: D.t2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.product_name_snapshot} ×{it.quantity}
                </div>
                <OrderLineDetails item={it} />
              </div>
            ))}
          </div>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 17,
              fontWeight: 700,
              color: D.t1,
              marginTop: 6,
            }}
          >
            {t('money', { amount: order.total.toFixed(2) })}
          </div>
        </div>
        <button
          className="pressable"
          disabled={pending}
          aria-busy={pending}
          onClick={() => onServe(order)}
          style={{
            background: D.green,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '12px 22px',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            fontWeight: 700,
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending ? 0.6 : 1,
            whiteSpace: 'nowrap',
            minHeight: 46,
          }}
        >
          {pending ? t('saving') : t('ready_serve')}
        </button>
      </div>
      {actionError != null && (
        <ActionErrorNote
          error={actionError}
          onDismiss={onDismissError ? () => onDismissError(order.id) : undefined}
        />
      )}
    </div>
  )
}

const ReadyOrderCard = memo(ReadyOrderCardInner)

export { ReadyOrderCard }
