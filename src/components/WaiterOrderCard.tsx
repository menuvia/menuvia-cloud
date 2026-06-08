// ─────────────────────────────────────────────────────────────
// PayModal + OrderCard — extracted from WaiterPage
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import type { Order, PaymentMethod } from '../lib/orders'
import { D } from '../lib/constants'
import { elapsed } from '../lib/utils'

// FIX: vechiul cod calcula elapsed() o dată la render → timer înghețat
// în WaiterPage (KitchenPage folosea deja ElapsedTimer). Hook partajat acum.
function useElapsed(createdAt: string): string {
  const [val, setVal] = useState(() => elapsed(createdAt))
  useEffect(() => {
    const id = setInterval(() => setVal(elapsed(createdAt)), 15_000)
    return () => clearInterval(id)
  }, [createdAt])
  return val
}

// STATUS_META — local display metadata for order status badges
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: 'Nou', color: D.t2, bg: D.s3 },
  confirmed: { label: 'Confirmat', color: D.amber, bg: 'rgba(232,160,32,0.12)' },
  preparing: { label: 'In preparare', color: D.goldL, bg: D.goldA },
  ready: { label: 'Gata de servit', color: D.green, bg: 'rgba(76,175,110,0.12)' },
  served: { label: 'Servit', color: '#7EB8F7', bg: 'rgba(126,184,247,0.12)' },
  paid: { label: 'Platit', color: D.t3, bg: D.s2 },
  cancelled: { label: 'Anulat', color: D.red, bg: 'rgba(224,85,85,0.10)' },
}

// ── PayModal ──────────────────────────────────────────────────

interface PayModalProps {
  order: Order
  onConfirm: (method: PaymentMethod, amount: number, tips: number) => void
  onClose: () => void
  onDiscountClick?: (() => void) | undefined
  happyHourSuggestion?: {
    rule_name: string
    computed_discount: number
    discount_type: 'percent' | 'amount'
    discount_value: number
  } | null
  onApplyHappyHour?: (() => void) | undefined
}

function PayModal({
  order,
  onConfirm,
  onClose,
  onDiscountClick,
  happyHourSuggestion,
  onApplyHappyHour,
}: PayModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tipsMode, setTipsMode] = useState<'none' | '5' | '10' | '15' | 'custom'>('none')
  const [tipsCustom, setTipsCustom] = useState('')
  const orderTotal = order.total

  // Calculează tips în funcție de mod
  const tipsAmount: number = (() => {
    if (tipsMode === 'none') return 0
    if (tipsMode === 'custom') return Math.max(0, parseFloat(tipsCustom) || 0)
    const pct = Number(tipsMode)
    return Math.round(orderTotal * (pct / 100) * 100) / 100
  })()

  const grandTotal = orderTotal + tipsAmount
  const [amount, setAmount] = useState(String(grandTotal.toFixed(2)))

  // Re-sync amount când se schimbă order.total sau tips
  useEffect(() => {
    setAmount(String(grandTotal.toFixed(2)))
  }, [grandTotal])

  const hasDiscount = order.discount_type != null && order.discount_amount > 0
  const subtotal = hasDiscount ? orderTotal + order.discount_amount : orderTotal

  const methods: { key: PaymentMethod; label: string }[] = [
    { key: 'cash', label: 'Cash' },
    { key: 'card_pos', label: 'Card POS' },
    { key: 'other', label: 'Altă metodă' },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: D.s2,
          border: `1px solid ${D.s3}`,
          borderRadius: 16,
          padding: 28,
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 20,
            fontWeight: 700,
            color: D.t1,
          }}
        >
          Înregistrează plată
        </div>

        <div>
          <div style={{ color: D.t2, fontSize: 13, marginBottom: 6 }}>
            Masă: {order.table?.name ?? '—'}
          </div>

          {hasDiscount ? (
            <div style={{ background: D.s3, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: D.t2,
                  padding: '2px 0',
                }}
              >
                <span>Subtotal:</span>
                <span style={{ color: D.t1 }}>{subtotal.toFixed(2)} lei</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: D.t2,
                  padding: '2px 0',
                }}
              >
                <span>
                  Reducere
                  {order.discount_type === 'percent' ? ` (${order.discount_value}%)` : ''}:
                </span>
                <span style={{ color: D.green }}>− {order.discount_amount.toFixed(2)} lei</span>
              </div>
              <div
                style={{
                  borderTop: `1px solid ${D.border}`,
                  marginTop: 6,
                  paddingTop: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                <span style={{ color: D.t1 }}>Total de plată:</span>
                <span
                  style={{ color: D.green, fontFamily: 'Fraunces, Georgia, serif', fontSize: 22 }}
                >
                  {order.total.toFixed(2)} lei
                </span>
              </div>
            </div>
          ) : (
            <div
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 32,
                fontWeight: 900,
                color: D.green,
              }}
            >
              {order.total.toFixed(2)} lei
            </div>
          )}

          {onDiscountClick && (
            <button
              onClick={onDiscountClick}
              style={{
                marginTop: 8,
                background: hasDiscount ? D.goldA : 'transparent',
                border: `1px solid ${hasDiscount ? D.gold : D.border}`,
                borderRadius: 8,
                color: hasDiscount ? D.gold : D.t2,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {hasDiscount ? '🎁 Modifică / scoate reducerea' : '🎁 Aplică reducere'}
            </button>
          )}
        </div>

        {/* Happy Hour suggestion (only shown if no discount already applied) */}
        {happyHourSuggestion != null && !hasDiscount && onApplyHappyHour && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(200,150,60,0.15), rgba(200,150,60,0.08))',
              border: `1px solid ${D.gold}`,
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>🎉</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: D.gold }}>
                  Happy Hour activ!
                </div>
                <div style={{ fontSize: 11, color: D.t2 }}>
                  {happyHourSuggestion.rule_name} · {happyHourSuggestion.discount_value}
                  {happyHourSuggestion.discount_type === 'percent' ? '%' : ' lei'}
                </div>
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: 18,
                  fontWeight: 700,
                  color: D.gold,
                }}
              >
                −{happyHourSuggestion.computed_discount.toFixed(2)}
              </div>
            </div>
            <button
              onClick={onApplyHappyHour}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Aplică Happy Hour
            </button>
          </div>
        )}

        {/* Method selector */}
        <div style={{ display: 'flex', gap: 8 }}>
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              style={{
                flex: 1,
                padding: '10px 0',
                background: method === m.key ? D.goldA : D.s3,
                border: `1px solid ${method === m.key ? D.gold : D.s3}`,
                borderRadius: 8,
                color: method === m.key ? D.gold : D.t2,
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Tips selector */}
        <div>
          <div style={{ color: D.t2, fontSize: 12, marginBottom: 6 }}>
            Bacșiș {tipsAmount > 0 ? `(${tipsAmount.toFixed(2)} lei)` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['none', '5', '10', '15', 'custom'] as const).map((opt) => {
              const label = opt === 'none' ? 'Fără' : opt === 'custom' ? 'Sumă' : `${opt}%`
              const active = tipsMode === opt
              return (
                <button
                  key={opt}
                  onClick={() => setTipsMode(opt)}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    background: active ? D.green : D.s3,
                    border: `1px solid ${active ? D.green : D.s3}`,
                    borderRadius: 8,
                    color: active ? '#fff' : D.t2,
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {tipsMode === 'custom' && (
            <input
              type="number"
              value={tipsCustom}
              onChange={(e) => setTipsCustom(e.target.value)}
              placeholder="0.00"
              step="0.50"
              min="0"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: D.s3,
                border: `1px solid ${D.s3}`,
                borderRadius: 8,
                color: D.t1,
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                padding: '8px 12px',
                marginTop: 6,
              }}
            />
          )}
        </div>

        {/* Amount input */}
        <div>
          <div style={{ color: D.t2, fontSize: 12, marginBottom: 6 }}>
            Sumă încasată (lei){' '}
            {tipsAmount > 0 && <span style={{ color: D.t3 }}>— include bacșiș</span>}
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: D.s3,
              border: `1px solid ${D.s3}`,
              borderRadius: 8,
              color: D.t1,
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 16,
              padding: '10px 12px',
            }}
          />
        </div>

        <button
          onClick={() => onConfirm(method, parseFloat(amount) || grandTotal, tipsAmount)}
          style={{
            background: D.green,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '12px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Confirmă plata
        </button>

        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            color: D.t2,
            border: `1px solid ${D.s3}`,
            borderRadius: 8,
            padding: '10px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Anulează
        </button>
      </div>
    </div>
  )
}

// ── OrderCard ─────────────────────────────────────────────────

interface OrderCardProps {
  order: Order
  onPayOpen: (order: Order) => void
  onSplitOpen: (order: Order) => void
  onEdit?: (order: Order) => void
  onCancel?: (order: Order) => void
}

function OrderCard({ order, onPayOpen, onSplitOpen, onEdit, onCancel }: OrderCardProps) {
  const meta = STATUS_META[order.status]
  const elapsedStr = useElapsed(order.created_at)

  return (
    <div
      style={{
        background: D.s2,
        border: `1px solid ${D.s3}`,
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 16,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              {order.table?.name ?? 'Fără masă'}
            </span>
            {/* Source badge */}
            <span
              style={{
                fontSize: '0.65rem',
                padding: '2px 7px',
                borderRadius: 100,
                fontWeight: 600,
                background:
                  order.source === 'qr'
                    ? 'rgba(200,150,60,.15)'
                    : order.source === 'pickup'
                      ? 'rgba(76,175,110,.15)'
                      : 'rgba(76,175,110,.15)',
                color:
                  order.source === 'qr' ? D.gold : order.source === 'pickup' ? D.green : D.green,
                border: `1px solid ${order.source === 'qr' ? D.gold + '44' : 'rgba(76,175,110,.3)'}`,
              }}
            >
              {order.source === 'qr'
                ? '📱 QR'
                : order.source === 'pickup'
                  ? '📦 Pickup'
                  : '🧑‍💼 Manual'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: D.t2, marginTop: 2 }}>
            #{order.id.slice(-6).toUpperCase()} · {elapsedStr}
          </div>
          {/* Who took the order */}
          {order._created_by_profile?.full_name && (
            <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 2 }}>
              Preluat de:{' '}
              <span style={{ color: D.t2, fontWeight: 500 }}>
                {order._created_by_profile.full_name}
              </span>
            </div>
          )}
          {/* Who served */}
          {order._served_by_profile?.full_name && order.status !== 'new' && (
            <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 1 }}>
              Servit de:{' '}
              <span style={{ color: D.green, fontWeight: 500 }}>
                {order._served_by_profile.full_name}
              </span>
            </div>
          )}
        </div>
        <div
          style={{
            background: meta.bg,
            color: meta.color,
            borderRadius: 20,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {meta.label}
        </div>
      </div>

      <div style={{ fontSize: 13, color: D.t2 }}>
        {order.order_items.map((item, i) => (
          <span key={item.id}>
            {item.product_name_snapshot} ×{item.quantity}
            {i < order.order_items.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>

      <div
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 18,
          fontWeight: 700,
          color: D.t1,
        }}
      >
        {order.total.toFixed(2)} lei
      </div>

      {/* Edit + Cancel — available for any non-terminal status */}
      {(onEdit || onCancel) && order.status !== 'paid' && order.status !== 'cancelled' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {onEdit && (
            <button
              onClick={() => onEdit(order)}
              style={{
                flex: 1,
                background: 'transparent',
                color: D.gold,
                border: `1px solid ${D.gold}77`,
                borderRadius: 8,
                padding: '8px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ✎ Editează
            </button>
          )}
          {onCancel && (
            <button
              onClick={() => onCancel(order)}
              style={{
                flex: 1,
                background: 'transparent',
                color: D.red,
                border: `1px solid ${D.red}77`,
                borderRadius: 8,
                padding: '8px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Anulează
            </button>
          )}
        </div>
      )}

      {/* Payment buttons for served orders */}
      {order.status === 'served' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onPayOpen(order)}
            style={{
              flex: 1,
              background: D.green,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Plată integrală
          </button>
          <button
            onClick={() => onSplitOpen(order)}
            style={{
              flex: 1,
              background: D.s3,
              color: D.t1,
              border: '1px solid ' + D.border,
              borderRadius: 8,
              padding: '10px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Plată parțială
          </button>
        </div>
      )}
    </div>
  )
}

export { PayModal, OrderCard, STATUS_META }
