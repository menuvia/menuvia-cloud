// src/components/OrdersTab.tsx
// ─────────────────────────────────────────────────────────────────
// Tab "Comenzi" în DashboardPage — vedere owner/manager a tuturor
// comenzilor active. Înainte de această componentă, dashboard-ul NU
// avea niciun loc unde să vezi lista de comenzi: trebuia să mergi la
// pagina separată /kitchen. Asta era principalul motiv pentru care
// utilizatorii spuneau "nu știi ce comenzi ai".
//
// Acoperă feedback-ul concret:
//   - "nu știi ce comenzi ai de unde ai" → coloane pe status + badge
//     prominent cu masa + sursa (QR/Pickup/Ospătar)
//   - "nu știi care e făcută și cum e făcută" → 4 coloane vizuale +
//     timer scurs cu culoare de urgență + status label clar
//   - "nu știi unde să dai 'finalizează comanda' / scoți bon" →
//     buton mare "💰 Plătit" pe comenzile servite, deschide formular
//     simplu cash/card + bacșiș
// ─────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useOrders } from '../hooks/useOrders'
import type { Order, OrderStatus, PaymentMethod } from '../lib/orders'
import { D } from '../lib/constants'
import { elapsed, urgencyColor } from '../lib/utils'
import { InlineSpinner, QueryError } from './PageLoader'

// ── Status configuration: ordinea coloanelor + etichete + culori ──
interface StatusColumn {
  statuses: OrderStatus[]
  label: string
  icon: string
  color: string
  description: string
}

const COLUMNS: StatusColumn[] = [
  {
    statuses: ['new', 'confirmed'],
    label: 'Noi',
    icon: '🆕',
    color: '#3B82F6', // blue
    description: 'Comenzi neacceptate sau confirmate',
  },
  {
    statuses: ['preparing'],
    label: 'În preparare',
    icon: '👨‍🍳',
    color: '#F59E0B', // amber
    description: 'Bucătăria lucrează',
  },
  {
    statuses: ['ready'],
    label: 'Gata',
    icon: '✅',
    color: '#10B981', // emerald
    description: 'De ridicat / livrat la masă',
  },
  {
    statuses: ['served'],
    label: 'De plătit',
    icon: '💰',
    color: '#C8963C', // gold
    description: 'Livrate, așteaptă plata',
  },
]

// ── Tranziții valide per status (butoanele primare afișate pe card) ──
const PRIMARY_ACTION: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  new: { next: 'confirmed', label: 'Acceptă comanda' },
  confirmed: { next: 'preparing', label: 'Începe prepararea' },
  preparing: { next: 'ready', label: 'Marchează gata' },
  ready: { next: 'served', label: 'A fost servit' },
  // 'served' are propriul UI (formular plată) — nu intră aici
}

// ── Mini-form inline pentru plată (declanșat de "💰 Plătit") ──
function PaymentForm({
  order,
  onConfirm,
  onCancel,
}: {
  order: Order
  onConfirm: (method: PaymentMethod, paidAmount: number, tipsAmount: number) => void
  onCancel: () => void
}) {
  const total = Number(order.total ?? 0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidStr, setPaidStr] = useState(total.toFixed(2))
  const [tipsStr, setTipsStr] = useState('0')

  const paid = parseFloat(paidStr) || 0
  const tips = parseFloat(tipsStr) || 0
  const change = Math.max(0, paid - total - tips)
  const insufficient = paid < total + tips

  return (
    <div
      style={{
        background: D.s3,
        border: `1px solid ${D.gold}55`,
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginTop: 6,
      }}
    >
      <div style={{ fontSize: 13, color: D.t1, fontWeight: 600 }}>
        Total comandă:{' '}
        <span style={{ color: D.gold, fontFamily: 'Fraunces, serif' }}>{total.toFixed(2)} lei</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          onClick={() => setMethod('cash')}
          style={{
            padding: '10px',
            borderRadius: 8,
            background: method === 'cash' ? D.gold : D.s2,
            color: method === 'cash' ? '#000' : D.t2,
            border: `1px solid ${method === 'cash' ? D.gold : D.border}`,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          💵 Cash
        </button>
        <button
          type="button"
          onClick={() => setMethod('card')}
          style={{
            padding: '10px',
            borderRadius: 8,
            background: method === 'card' ? D.gold : D.s2,
            color: method === 'card' ? '#000' : D.t2,
            border: `1px solid ${method === 'card' ? D.gold : D.border}`,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          💳 Card
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: D.t3 }}>Sumă primită (lei)</span>
          <input
            type="number"
            step="0.01"
            value={paidStr}
            onChange={(e) => setPaidStr(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 7,
              background: D.s2,
              border: `1px solid ${D.border}`,
              color: D.t1,
              fontSize: 14,
              fontFamily: 'DM Sans, sans-serif',
              outline: 'none',
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: D.t3 }}>Bacșiș (lei)</span>
          <input
            type="number"
            step="0.01"
            value={tipsStr}
            onChange={(e) => setTipsStr(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 7,
              background: D.s2,
              border: `1px solid ${D.border}`,
              color: D.t1,
              fontSize: 14,
              fontFamily: 'DM Sans, sans-serif',
              outline: 'none',
            }}
          />
        </label>
      </div>

      {change > 0 && (
        <div
          style={{
            fontSize: 12,
            color: D.green,
            padding: '6px 10px',
            background: `${D.green}15`,
            borderRadius: 6,
          }}
        >
          Rest de dat: <strong>{change.toFixed(2)} lei</strong>
        </div>
      )}
      {insufficient && paid > 0 && (
        <div
          style={{
            fontSize: 12,
            color: D.red,
            padding: '6px 10px',
            background: `${D.red}15`,
            borderRadius: 6,
          }}
        >
          Suma primită e mai mică decât totalul + bacșiș.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: 8,
            background: 'transparent',
            color: D.t2,
            border: `1px solid ${D.border}`,
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 13,
          }}
        >
          Renunță
        </button>
        <button
          type="button"
          onClick={() => onConfirm(method, paid, tips)}
          disabled={insufficient}
          style={{
            flex: 2,
            padding: '10px',
            borderRadius: 8,
            background: insufficient ? D.s2 : D.gold,
            color: insufficient ? D.t3 : '#000',
            border: 'none',
            cursor: insufficient ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: 14,
            opacity: insufficient ? 0.5 : 1,
          }}
        >
          ✓ Confirmă plata
        </button>
      </div>
    </div>
  )
}

// ── Card pentru o singură comandă ──
interface OrderCardProps {
  order: Order
  onAdvance: (orderId: string, currentStatus: OrderStatus, nextStatus: OrderStatus) => Promise<void>
  onPay: (
    orderId: string,
    method: PaymentMethod,
    paidAmount: number,
    tipsAmount: number,
  ) => Promise<void>
  onCancel: (orderId: string, currentStatus: OrderStatus) => Promise<void>
}
function OrderCard({ order, onAdvance, onPay, onCancel }: OrderCardProps) {
  const [showPayment, setShowPayment] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  const action = PRIMARY_ACTION[order.status]
  const urg = urgencyColor(order.created_at)
  const total = Number(order.total ?? 0)

  // Determinăm sursa și culoarea ei
  const sourceLabel =
    order.source === 'qr' ? 'QR' : order.source === 'pickup' ? '📦 Pickup' : '👤 Ospătar'
  const sourceColor = order.source === 'qr' ? D.gold : order.source === 'pickup' ? D.green : D.t2

  async function handlePrimary() {
    if (!action || pending) return
    setPending(true)
    try {
      await onAdvance(order.id, order.status, action.next)
    } finally {
      setPending(false)
    }
  }

  async function handlePay(method: PaymentMethod, paidAmount: number, tipsAmount: number) {
    if (pending) return
    setPending(true)
    setShowPayment(false)
    try {
      await onPay(order.id, method, paidAmount, tipsAmount)
    } finally {
      setPending(false)
    }
  }

  async function handleCancel() {
    if (pending) return
    setPending(true)
    setShowCancelConfirm(false)
    try {
      await onCancel(order.id, order.status)
    } finally {
      setPending(false)
    }
  }

  const card: CSSProperties = {
    background: D.s2,
    border: `1px solid ${D.border}`,
    borderRadius: 12,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    position: 'relative',
    overflow: 'hidden',
    opacity: pending ? 0.6 : 1,
    transition: 'opacity 0.15s',
  }

  return (
    <div style={card}>
      {/* Bandă de urgență (stânga) */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: urg,
        }}
      />

      {/* Header: masa + ID + sursa + timer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 17,
              fontWeight: 700,
              color: D.t1,
              lineHeight: 1.2,
            }}
          >
            {order.table?.name ?? 'Fără masă'}
          </div>
          <div style={{ fontSize: 11, color: D.t3, marginTop: 2, display: 'flex', gap: 8 }}>
            <span style={{ fontFamily: 'monospace' }}>#{order.id.slice(-6).toUpperCase()}</span>
            <span style={{ color: sourceColor, fontWeight: 600 }}>{sourceLabel}</span>
          </div>
        </div>
        <span
          style={{
            background: `${urg}22`,
            color: urg,
            borderRadius: 16,
            padding: '3px 9px',
            fontSize: 11,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}
        >
          {elapsed(order.created_at)}
        </span>
      </div>

      {/* Produse */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {order.order_items.map((item) => (
          <div key={item.id}>
            <div style={{ fontSize: 13, color: D.t1, lineHeight: 1.35 }}>
              <span style={{ color: D.gold, fontWeight: 600 }}>×{item.quantity}</span>{' '}
              {item.product_name_snapshot}
            </div>
            {item.selected_modifiers.length > 0 &&
              item.selected_modifiers.map((mod, i) => (
                <div
                  key={i}
                  style={{ fontSize: 11, color: D.t3, paddingLeft: 18, lineHeight: 1.3 }}
                >
                  + {mod.option_name}
                  {mod.price_delta > 0 ? ` (+${mod.price_delta.toFixed(2)} lei)` : ''}
                </div>
              ))}
          </div>
        ))}
      </div>

      {order.notes != null && order.notes.length > 0 && (
        <div
          style={{
            fontSize: 12,
            color: D.t2,
            fontStyle: 'italic',
            background: D.s3,
            padding: '6px 10px',
            borderRadius: 6,
            borderLeft: `2px solid ${D.gold}`,
          }}
        >
          "{order.notes}"
        </div>
      )}

      {/* Total */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 0',
          borderTop: `1px solid ${D.border}`,
        }}
      >
        <span style={{ fontSize: 11, color: D.t3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Total
        </span>
        <span style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 700, color: D.t1 }}>
          {total.toFixed(2)} lei
        </span>
      </div>

      {/* Acțiuni primare */}
      {!showPayment && !showCancelConfirm && (
        <>
          {action && (
            <button
              type="button"
              onClick={handlePrimary}
              disabled={pending}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '11px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                cursor: pending ? 'wait' : 'pointer',
                width: '100%',
              }}
            >
              {action.label} →
            </button>
          )}

          {order.status === 'served' && (
            <button
              type="button"
              onClick={() => setShowPayment(true)}
              disabled={pending}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '12px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 15,
                fontWeight: 700,
                cursor: pending ? 'wait' : 'pointer',
                width: '100%',
                boxShadow: `0 2px 8px ${D.gold}33`,
              }}
            >
              💰 Plătește comanda
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCancelConfirm(true)}
            disabled={pending}
            style={{
              background: 'transparent',
              color: D.t3,
              border: 'none',
              padding: '4px 0',
              fontSize: 11,
              cursor: pending ? 'wait' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              textAlign: 'center',
            }}
          >
            Anulează comanda
          </button>
        </>
      )}

      {showCancelConfirm && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            background: `${D.red}11`,
            border: `1px solid ${D.red}55`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 12, color: D.t1 }}>Sigur anulezi această comandă?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowCancelConfirm(false)}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: 7,
                background: 'transparent',
                color: D.t2,
                border: `1px solid ${D.border}`,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Renunță
            </button>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: 7,
                background: D.red,
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Da, anulează
            </button>
          </div>
        </div>
      )}

      {showPayment && (
        <PaymentForm order={order} onConfirm={handlePay} onCancel={() => setShowPayment(false)} />
      )}
    </div>
  )
}

// ── Coloană de status ──
function StatusColumn({
  column,
  orders,
  onAdvance,
  onPay,
  onCancel,
}: {
  column: StatusColumn
  orders: Order[]
  onAdvance: OrderCardProps['onAdvance']
  onPay: OrderCardProps['onPay']
  onCancel: OrderCardProps['onCancel']
}) {
  return (
    <div
      style={{
        background: D.s1,
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 200,
        border: `1px solid ${D.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 8,
          borderBottom: `1px solid ${D.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{column.icon}</span>
          <div>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 14,
                fontWeight: 600,
                color: D.t1,
              }}
            >
              {column.label}
            </div>
            <div style={{ fontSize: 10, color: D.t3, marginTop: 1 }}>{column.description}</div>
          </div>
        </div>
        <span
          style={{
            background: column.color,
            color: '#fff',
            borderRadius: 14,
            padding: '2px 9px',
            fontSize: 12,
            fontWeight: 700,
            minWidth: 24,
            textAlign: 'center',
          }}
        >
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <div
          style={{
            color: D.t3,
            fontSize: 12,
            textAlign: 'center',
            padding: '24px 8px',
            fontStyle: 'italic',
          }}
        >
          Nicio comandă aici
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              onAdvance={onAdvance}
              onPay={onPay}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Componenta principală ──
export default function OrdersTab({ restaurantId }: { restaurantId: string }) {
  const { orders, loading, error, advance } = useOrders(restaurantId, 'waiter')

  // Group orders by column based on status
  const ordersByColumn = useMemo(() => {
    return COLUMNS.map((col) => ({
      column: col,
      orders: orders.filter((o) => col.statuses.includes(o.status)),
    }))
  }, [orders])

  const total = orders.length

  if (loading) {
    return <InlineSpinner label="Se încarcă comenzile..." />
  }
  if (error != null) {
    return <QueryError message={error} />
  }

  async function handleAdvance(
    orderId: string,
    currentStatus: OrderStatus,
    nextStatus: OrderStatus,
  ) {
    await advance(orderId, currentStatus, { status: nextStatus })
  }

  async function handlePay(
    orderId: string,
    method: PaymentMethod,
    paidAmount: number,
    tipsAmount: number,
  ) {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    await advance(orderId, order.status, {
      status: 'paid',
      payment_method: method,
      paid_amount: paidAmount,
      tips_amount: tipsAmount,
    })
  }

  async function handleCancel(orderId: string, currentStatus: OrderStatus) {
    await advance(orderId, currentStatus, {
      status: 'cancelled',
      cancel_reason: 'Anulat de manager din Dashboard',
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header cu contor total */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 22,
              fontWeight: 600,
              color: D.t1,
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            Comenzi active
          </h2>
          <div style={{ fontSize: 13, color: D.t3, marginTop: 2 }}>
            {total === 0
              ? 'Nicio comandă activă acum'
              : `${total} ${total === 1 ? 'comandă activă' : 'comenzi active'} · actualizate în timp real`}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            background: D.s2,
            borderRadius: 14,
            border: `1px dashed ${D.border}`,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 18,
              color: D.t1,
              marginBottom: 6,
            }}
          >
            Toate comenzile sunt rezolvate
          </div>
          <div style={{ fontSize: 13, color: D.t3 }}>
            Aici vor apărea comenzile noi imediat ce sunt plasate de clienți.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {ordersByColumn.map(({ column, orders: colOrders }) => (
            <StatusColumn
              key={column.label}
              column={column}
              orders={colOrders}
              onAdvance={handleAdvance}
              onPay={handlePay}
              onCancel={handleCancel}
            />
          ))}
        </div>
      )}
    </div>
  )
}
