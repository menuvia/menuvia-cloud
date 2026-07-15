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
import { Icon, type IconName } from '../components/ui/Icon'
import { EmptyState } from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'

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

// Culoarea de accent pentru un nivel de urgență. `calm` → null (fără accent);
// apelanții care au nevoie de o culoare neutră fac `?? D.t2`.
function urgencyLevelColor(level: UrgencyLevel): string | null {
  if (level === 'late') return D.red
  if (level === 'warn') return D.amber
  return null
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
  const color = urgencyLevelColor(level) ?? D.t2
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
  // Re-render la 10s (aceeași cadență ca ElapsedTimer) — altfel border-ul/fundalul
  // cardului rămâneau „calme" până la următorul poll (~30s) deși chip-ul de timp
  // devenise deja amber/roșu: stare vizuală contradictorie pe același card.
  const [, setUrgencyTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setUrgencyTick((t) => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])
  const level = urgencyLevel(order.created_at)
  const urgColor = urgencyLevelColor(level)
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
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                verticalAlign: 'middle',
                color: order.source === 'qr' ? D.goldL : order.source === 'pickup' ? D.green : D.t2,
              }}
            >
              {order.source === 'qr' ? (
                <>
                  <Icon name="qr" size={13} />
                  QR
                </>
              ) : order.source === 'pickup' ? (
                <>
                  <Icon name="box" size={13} />
                  Pickup
                </>
              ) : (
                'Ospătar'
              )}
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
            {/* Notița PER PRODUS („fără ceapă") e instrucțiune de preparare —
                fără ea pe card, bucătarul gătea greșit deși clientul o scrisese. */}
            {item.notes != null && item.notes.length > 0 && (
              <div
                style={{ fontSize: 12, color: D.amber, fontStyle: 'italic', paddingLeft: 12 }}
              >
                ✎ {item.notes}
              </div>
            )}
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
          „{order.notes}”
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
      aria-label={'Selectează restaurantul'}
      style={{
        background: D.s3,
        border: `1px solid ${D.s3}`,
        borderRadius: 7,
        color: D.t1,
        minHeight: 44,
        padding: '6px 10px',
        fontSize: 13,
        fontFamily: 'DM Sans, sans-serif',
        cursor: 'pointer',
        outline: 'none',
        // Numele lungi de restaurant nu au voie să împingă header-ul în overflow la 375px.
        maxWidth: 140,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
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
  // Dismiss local pe banner-ul de eroare: pe un ecran deschis toată ziua, o eroare
  // tranzientă nu trebuie să lase un banner roșu perpetuu. O eroare NOUĂ (text diferit)
  // redeschide bannerul.
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const { orders, loading, error, advance, byStatus, connectionStatus } = useOrders(
    restaurantId,
    'kitchen',
  )
  // Indicatorul reflectă starea REALĂ a canalului de comenzi (useOrders), nu un canal de
  // prezență separat care putea arăta „Conectat" când realtime-ul comenzilor era căzut.
  // Cele 3 stări rămân distincte: 'connecting' (starea inițială, câteva secunde la fiecare
  // deschidere) NU e „Deconectat" — altfel staff-ul vede o alarmă falsă roșie la fiecare load.
  const connDot =
    connectionStatus === 'connected' ? D.green : connectionStatus === 'connecting' ? D.amber : D.red
  const connLabel =
    connectionStatus === 'connected'
      ? 'Conectat'
      : connectionStatus === 'connecting'
        ? 'Se conectează...'
        : 'Deconectat'
  const {
    supported: pushSupported,
    permission: pushPerm,
    subscribed: pushSubscribed,
    loading: pushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = usePushNotifications(restaurantId)


  // Reset la schimbarea restaurantului — noul prim snapshot nu trebuie să sune,
  // iar o eroare închisă pe vechiul restaurant nu ascunde una de pe cel nou.
  useEffect(() => {
    prevOrderIds.current = new Set<string>()
    hasSeenInitialSnapshot.current = false
    setDismissedError(null)
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
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 1,
          padding: 12,
        }}
      >
        {[0, 1, 2].map((col) => (
          <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
            <Skeleton variant="title" width="50%" />
            <Skeleton variant="card" count={3} />
          </div>
        ))}
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
            // La 375px cu selector multi-restaurant, titlul cedează primul:
            // ellipsis în loc de wrap/overflow în înălțimea fixă de 56px.
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Bucătărie{restaurantName.length > 0 ? ` — ${restaurantName}` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Restaurant selector — only visible for multi-restaurant users */}
          <RestaurantSelector
            memberships={memberships}
            activeId={restaurantId}
            setActive={setActive}
          />
          {pushSupported && pushPerm !== 'unsupported' && (
            <button
              onClick={() => {
                void (pushSubscribed ? pushUnsubscribe() : pushSubscribe())
              }}
              disabled={pushLoading || (!pushSubscribed && pushPerm === 'denied')}
              aria-label={
                pushSubscribed
                  ? 'Notificări active — dezactivează'
                  : pushPerm === 'denied'
                    ? 'Notificările sunt blocate din setările browserului'
                    : 'Activează notificările pentru comenzi noi'
              }
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
                minHeight: 44,
                cursor: pushPerm === 'denied' ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: pushSubscribed ? D.gold : D.t2,
                fontSize: 13,
                fontFamily: 'DM Sans,sans-serif',
                opacity: pushLoading || (!pushSubscribed && pushPerm === 'denied') ? 0.6 : 1,
              }}
            >
              <Icon name="bell" size={16} />
              {/* „Blocate" e vizibil și pe touch — title-ul nu se afișează pe tablete KDS */}
              <span style={{ fontSize: 12 }}>
                {pushSubscribed ? 'Activ' : pushPerm === 'denied' ? 'Blocate' : 'Notificări'}
              </span>
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: connDot,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: D.t2, whiteSpace: 'nowrap' }}>{connLabel}</span>
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
            <Icon name="bell" size={18} color={D.gold} />
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
              minHeight: 44,
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

      {error != null && error !== dismissedError && (
        <div
          style={{
            background: `${D.red}22`,
            color: D.red,
            padding: '4px 12px 4px 24px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {/* Mesaj acționabil în română — erorile din useOrders vin brute (engleză/tehnice);
              detaliul tehnic rămâne vizibil, secundar, pentru diagnoză. */}
          <span style={{ minWidth: 0 }}>
            Nu am putut sincroniza comenzile. Verifică conexiunea și reîncearcă.{' '}
            <span style={{ opacity: 0.65, fontSize: 11 }}>({error})</span>
          </span>
          <button
            onClick={() => setDismissedError(error)}
            aria-label={'Închide mesajul de eroare'}
            style={{
              background: 'transparent',
              border: 'none',
              color: D.red,
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              padding: 0,
            }}
          >
            <Icon name="close" size={16} />
          </button>
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
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <EmptyState
                      compact
                      icon={
                        (col.label === 'Gata de servit'
                          ? 'check'
                          : col.label === 'În pregătire'
                            ? 'utensils'
                            : 'receipt') satisfies IconName
                      }
                      title="Nicio comandă"
                      description={
                        orders.length === 0 && col.label === 'Comenzi noi'
                          ? 'Comenzile prin QR vor apărea aici automat.'
                          : undefined
                      }
                    />
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
