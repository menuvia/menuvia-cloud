// =============================================================
// Menuvia — src/pages/KitchenPage.tsx
// Kitchen Dashboard (/kitchen). Dark theme.
// Restaurant selection via RestaurantContext — no local membership query.
// =============================================================

import { useState, useEffect, useRef, CSSProperties } from 'react'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useOrders } from '../hooks/useOrders'
import type { Order, OrderStatus } from '../lib/orders'
import { D } from '../lib/constants'
import { elapsed, urgencyColor, playSound } from '../lib/utils'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { supabase } from '../lib/supabase'

// D imported from constants

const KITCHEN_NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  new: { status: 'confirmed', label: 'Confirmă' },
  confirmed: { status: 'preparing', label: 'Marchează în pregătire' },
  preparing: { status: 'ready', label: 'Gata' },
}

// Board pe 3 coloane (DESIGN_SPEC Val 3): „Noi" cumulează new+confirmed —
// vizual, fără schimbare de statusuri în backend. Butonul de pe card face
// în continuare tranzițiile reale (new→confirmed→preparing→ready).
const COLUMNS: { statuses: OrderStatus[]; label: string }[] = [
  { statuses: ['new', 'confirmed'], label: 'Comenzi noi' },
  { statuses: ['preparing'], label: 'În pregătire' },
  { statuses: ['ready'], label: 'Gata de servit' },
]

// elapsed, urgencyColor, playSound — imported from ../lib/utils

function ElapsedTimer({ createdAt }: { createdAt: string }) {
  const [val, setVal] = useState(() => elapsed(createdAt))
  useEffect(() => {
    const id = setInterval(() => setVal(elapsed(createdAt)), 10_000)
    return () => clearInterval(id)
  }, [createdAt])
  const urg = urgencyColor(createdAt)
  return (
    <span
      style={{
        background: `${urg}22`,
        color: urg,
        borderRadius: 20,
        padding: '3px 9px',
        fontSize: 12,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {val}
    </span>
  )
}

interface OrderCardProps {
  order: Order
  onAdvance: (id: string, cur: OrderStatus, next: OrderStatus) => void
}
function OrderCard({ order, onAdvance }: OrderCardProps) {
  const next = KITCHEN_NEXT[order.status]
  const urg = urgencyColor(order.created_at)
  const card: CSSProperties = {
    background: D.s2,
    // Comenzile noi ies în evidență — border auriu până sunt confirmate
    border: `1px solid ${order.status === 'new' ? D.gold + '88' : D.s3}`,
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
  }
  return (
    <div style={card}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: urg,
          borderRadius: '12px 0 0 12px',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 18,
              fontWeight: 700,
              color: D.t1,
            }}
          >
            {order.table?.name ?? 'Fără masă'}
          </div>
          <div style={{ fontSize: 12, color: D.t2, marginTop: 2 }}>
            #{order.id.slice(-6).toUpperCase()} ·{' '}
            <span
              style={{
                color: order.source === 'qr' ? D.goldL : order.source === 'pickup' ? D.green : D.t2,
              }}
            >
              {order.source === 'qr' ? 'QR' : order.source === 'pickup' ? '📦 Pickup' : 'Ospătar'}
            </span>
          </div>
        </div>
        <ElapsedTimer createdAt={order.created_at} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {order.order_items.map((item) => (
          <div key={item.id}>
            <div style={{ fontSize: 14, color: D.t1 }}>
              {item.product_name_snapshot} × {item.quantity}
            </div>
            {/* Fără prețuri în bucătărie — bucătarul nu are nevoie de bani pe ecran */}
            {item.selected_modifiers.map((mod, i) => (
              <div key={i} style={{ fontSize: 12, color: D.t2, paddingLeft: 12 }}>
                + {mod.option_name}
              </div>
            ))}
          </div>
        ))}
      </div>
      {order.notes != null && order.notes.length > 0 && (
        <div
          style={{
            fontSize: 12,
            color: D.t1,
            fontStyle: 'italic',
            background: D.s3,
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          "{order.notes}"
        </div>
      )}
      {next != null && (
        <button
          onClick={() => onAdvance(order.id, order.status, next.status)}
          style={{
            background: D.gold,
            color: D.bg,
            border: 'none',
            borderRadius: 8,
            padding: '10px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          {next.label}
        </button>
      )}
    </div>
  )
}

// ── Restaurant selector — shown only when user has access to multiple restaurants ──
function RestaurantSelector({
  memberships,
  activeId,
  setActive,
}: {
  memberships: { restaurant_id: string; restaurant: { id: string; name: string; slug: string } }[]
  activeId: string | null
  setActive: (id: string) => void
}) {
  if (memberships.length <= 1) return null
  return (
    <select
      value={activeId ?? ''}
      onChange={(e) => setActive(e.target.value)}
      style={{
        background: D.s3,
        border: `1px solid ${D.s3}`,
        borderRadius: 7,
        color: D.t1,
        padding: '6px 10px',
        fontSize: 13,
        fontFamily: 'DM Sans, sans-serif',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {memberships.map((m) => (
        <option key={m.restaurant_id} value={m.restaurant_id}>
          {m.restaurant.name}
        </option>
      ))}
    </select>
  )
}

export default function KitchenPage() {
  // FIX: use RestaurantContext — no more local membership query, supports multi-restaurant
  const {
    activeId: restaurantId,
    activeName: restaurantName,
    memberships,
    setActive,
    loading: ctxLoading,
  } = useRestaurantCtx()
  // FIX: connected state este acum dinamic — verifică realtime channel status
  const [connected, setConnected] = useState(false)
  const prevOrderIds = useRef(new Set<string>())

  const { orders, loading, error, advance, byStatus } = useOrders(restaurantId, 'kitchen')
  const {
    supported: pushSupported,
    permission: pushPerm,
    subscribed: pushSubscribed,
    loading: pushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = usePushNotifications(restaurantId)

  // Monitorizează statusul realtime channel-ului pentru a reflecta starea reală în UI
  useEffect(() => {
    if (!restaurantId) {
      setConnected(false)
      return
    }
    const ch = supabase.channel(`kitchen-presence:${restaurantId}`).subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
    })
    return () => {
      void ch.unsubscribe()
    }
  }, [restaurantId])

  useEffect(() => {
    const currentIds = new Set(orders.map((o) => o.id))
    for (const o of orders) {
      if (o.status === 'new' && !prevOrderIds.current.has(o.id)) {
        playSound(880, 200)
        break
      }
    }
    prevOrderIds.current = currentIds
  }, [orders])

  function handleAdvance(orderId: string, current: OrderStatus, next: OrderStatus): void {
    void advance(orderId, current, { status: next })
  }

  if (ctxLoading || loading) {
    return (
      <div
        style={{
          background: D.bg,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: D.t2, fontFamily: 'DM Sans, sans-serif' }}>Se încarcă...</span>
      </div>
    )
  }

  return (
    <div style={{ background: D.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          background: D.s1,
          borderBottom: `1px solid ${D.s3}`,
          padding: '0 24px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <span
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 18,
            fontWeight: 700,
            color: D.t1,
          }}
        >
          Bucătărie{restaurantName.length > 0 ? ` — ${restaurantName}` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Restaurant selector — only visible for multi-restaurant users */}
          <RestaurantSelector
            memberships={memberships}
            activeId={restaurantId}
            setActive={setActive}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pushSupported && pushPerm !== 'unsupported' && (
              <button
                onClick={() => {
                  void (pushSubscribed ? pushUnsubscribe() : pushSubscribe())
                }}
                disabled={pushLoading}
                title={
                  pushSubscribed
                    ? 'Notificări active — click pentru a dezactiva'
                    : pushPerm === 'denied'
                      ? 'Notificările sunt blocate în browser'
                      : 'Activează notificările pentru comenzi noi'
                }
                style={{
                  background: 'transparent',
                  border: `1px solid ${pushSubscribed ? D.gold + '55' : D.border}`,
                  borderRadius: 8,
                  padding: '5px 10px',
                  cursor: pushPerm === 'denied' ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: pushSubscribed ? D.gold : D.t3,
                  fontSize: 13,
                  fontFamily: 'DM Sans,sans-serif',
                  opacity: pushLoading ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 16 }}>
                  {pushSubscribed ? '🔔' : pushPerm === 'denied' ? '🔕' : '🔔'}
                </span>
                <span style={{ fontSize: 12 }}>{pushSubscribed ? 'Activ' : 'Notificări'}</span>
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: connected ? D.green : D.red,
                }}
              />
              <span style={{ fontSize: 12, color: D.t2 }}>
                {connected ? 'Conectat' : 'Deconectat'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Push permission banner — shown once until user acts */}
      {pushSupported && pushPerm === 'default' && !pushSubscribed && (
        <div
          style={{
            background: D.goldA,
            borderBottom: `1px solid ${D.gold}33`,
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔔</span>
            <span style={{ fontSize: '0.82rem', color: D.t2, lineHeight: 1.4 }}>
              Activează notificările ca să primești alerte pentru comenzi noi, chiar și cu tab-ul
              închis.
            </span>
          </div>
          <button
            onClick={() => {
              void pushSubscribe()
            }}
            disabled={pushLoading}
            style={{
              background: D.gold,
              color: '#000',
              border: 'none',
              borderRadius: 7,
              padding: '7px 16px',
              fontFamily: 'DM Sans,sans-serif',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {pushLoading ? 'Se activează...' : 'Activează →'}
          </button>
        </div>
      )}

      {error != null && (
        <div style={{ background: `${D.red}22`, color: D.red, padding: '8px 24px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Kanban */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          // auto-fit: 3 coloane pe desktop/tabletă, stack vertical pe telefon
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 1,
          overflow: 'auto',
        }}
      >
        {COLUMNS.map((col) => {
          const colOrders = byStatus(col.statuses)
          return (
            <div
              key={col.label}
              style={{
                background: D.s1,
                borderRight: `1px solid ${D.s3}`,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${D.s3}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 600,
                    color: D.t2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    background: D.s3,
                    color: D.t2,
                    borderRadius: 12,
                    padding: '2px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {colOrders.length}
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {colOrders.map((order) => (
                  <OrderCard key={order.id} order={order} onAdvance={handleAdvance} />
                ))}
                {colOrders.length === 0 && (
                  <div style={{ color: D.t3, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                    {orders.length === 0 && col.label === 'Comenzi noi' ? (
                      <>
                        Nu sunt comenzi în bucătărie.
                        <br />
                        <span style={{ fontSize: 12 }}>
                          Comenzile prin QR vor apărea aici automat.
                        </span>
                      </>
                    ) : (
                      'Nicio comandă'
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
