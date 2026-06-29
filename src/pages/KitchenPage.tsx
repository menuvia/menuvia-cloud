// =============================================================
// Menuvia — src/pages/KitchenPage.tsx
// Kitchen Dashboard (/kitchen). Dark theme.
// Restaurant selection via RestaurantContext — no local membership query.
// =============================================================

import { useState, useEffect, useRef, CSSProperties, ReactNode } from 'react'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useOrders } from '../hooks/useOrders'
import type { Order, OrderStatus } from '../lib/orders'
import { D } from '../lib/constants'
import { elapsed, urgencyColor, playSound } from '../lib/utils'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useInView, revealStyle } from '../lib/motion'

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

// Nivel de urgență derivat din vârsta comenzii. Refolosește exact pragurile
// din `urgencyColor` (10m → amber, 20m → red), dar le mapează la un nivel
// semantic ca să putem escalada întreg cardul, nu doar o dungă subțire.
type UrgencyLevel = 'calm' | 'warn' | 'late'
function urgencyLevel(createdAt: string): UrgencyLevel {
  const c = urgencyColor(createdAt)
  if (c === D.red) return 'late'
  if (c === D.amber) return 'warn'
  return 'calm'
}

// Wrapper mic pentru reveal per-card — hook-ul useInView e apelat înăuntru,
// nu în .map() (regula hooks). Comanda nouă „aterizează" lin în coloană.
function RevealItem({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ amount: 0.05 })
  return (
    <div ref={ref} style={revealStyle(inView, { delay, y: 10 })}>
      {children}
    </div>
  )
}

// Timer mare, citibil de la distanță. Culoarea + intensitatea cresc cu vârsta.
function ElapsedTimer({ createdAt }: { createdAt: string }) {
  const [val, setVal] = useState(() => elapsed(createdAt))
  useEffect(() => {
    const id = setInterval(() => setVal(elapsed(createdAt)), 10_000)
    return () => clearInterval(id)
  }, [createdAt])
  const level = urgencyLevel(createdAt)
  const color = level === 'late' ? D.red : level === 'warn' ? D.amber : D.t2
  const calm = level === 'calm'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: calm ? D.s3 : `${color}1F`,
        color: calm ? D.t2 : color,
        border: `1px solid ${calm ? D.border : `${color}55`}`,
        borderRadius: 10,
        padding: '5px 10px',
        fontSize: 18,
        fontWeight: 800,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {!calm && (
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: color,
          }}
        />
      )}
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
  const level = urgencyLevel(order.created_at)
  const urgColor = level === 'late' ? D.red : level === 'warn' ? D.amber : null
  const isNew = order.status === 'new'
  // Urgența îmbracă TOT cardul (border + tentă de fundal), nu o dungă laterală.
  // Calm → border auriu doar pentru comenzi noi neconfirmate. Warn/late escaladează.
  const accent = urgColor ?? (isNew ? D.gold : null)
  const card: CSSProperties = {
    background:
      level === 'late'
        ? `${D.red}14`
        : level === 'warn'
          ? `${D.amber}10`
          : D.s2,
    border: `1.5px solid ${accent != null ? `${accent}99` : D.s3}`,
    boxShadow: level === 'late' ? `0 0 0 1px ${D.red}33, 0 4px 16px ${D.red}1A` : 'none',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    position: 'relative',
  }
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 20,
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
            <div style={{ fontSize: 15, color: D.t1, fontWeight: 600 }}>
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
          className="pressable"
          onClick={(e) => {
            // Feedback tactil scurt pe tap — bucătarul vede că butonul a „prins".
            e.currentTarget.classList.remove('animate-bump')
            void e.currentTarget.offsetWidth
            e.currentTarget.classList.add('animate-bump')
            onAdvance(order.id, order.status, next.status)
          }}
          style={{
            background: D.gold,
            color: D.bg,
            border: 'none',
            borderRadius: 10,
            padding: '14px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
            minHeight: 48,
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
  const prevOrderIds = useRef(new Set<string>())
  // Primul snapshot hidratat NU e „comandă nouă" — altfel beep-ul suna la încărcarea
  // paginii sau după schimbarea restaurantului. Sunăm doar de la al doilea snapshot.
  const hasSeenInitialSnapshot = useRef(false)

  const { orders, loading, error, advance, byStatus, connectionStatus } = useOrders(
    restaurantId,
    'kitchen',
  )
  // Indicatorul reflectă starea REALĂ a canalului de comenzi (useOrders), nu un canal de
  // prezență separat care putea arăta „Conectat" când realtime-ul comenzilor era căzut.
  const connected = connectionStatus === 'connected'
  const {
    supported: pushSupported,
    permission: pushPerm,
    subscribed: pushSubscribed,
    loading: pushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = usePushNotifications(restaurantId)


  // Reset la schimbarea restaurantului — noul prim snapshot nu trebuie să sune.
  useEffect(() => {
    prevOrderIds.current = new Set<string>()
    hasSeenInitialSnapshot.current = false
  }, [restaurantId])

  useEffect(() => {
    const currentIds = new Set(orders.map((o) => o.id))
    if (hasSeenInitialSnapshot.current) {
      for (const o of orders) {
        if (o.status === 'new' && !prevOrderIds.current.has(o.id)) {
          playSound(880, 200)
          break
        }
      }
    }
    hasSeenInitialSnapshot.current = true
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
                {colOrders.map((order, i) => (
                  <RevealItem key={order.id} delay={Math.min(i, 4) * 40}>
                    <OrderCard order={order} onAdvance={handleAdvance} />
                  </RevealItem>
                ))}
                {colOrders.length === 0 && (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      color: D.t3,
                      textAlign: 'center',
                      padding: '40px 16px',
                      minHeight: 160,
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        border: `1.5px dashed ${D.s4}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        opacity: 0.7,
                      }}
                    >
                      {col.label === 'Gata de servit' ? '✓' : col.label === 'În pregătire' ? '🍳' : '🍽️'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: D.t2 }}>Nicio comandă</div>
                    {orders.length === 0 && col.label === 'Comenzi noi' && (
                      <span style={{ fontSize: 12, color: D.t3, maxWidth: 200, lineHeight: 1.4 }}>
                        Comenzile prin QR vor apărea aici automat.
                      </span>
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
