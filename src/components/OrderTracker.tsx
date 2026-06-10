// ─────────────────────────────────────────────────────────────
// OrderTracker + ActiveOrdersBanner — order confirmation & session tracking
// Extracted from QrMenuPage to reduce file size.
// FIX: RLS blochează SELECT pe `orders` pentru anon users, așa că
// `postgres_changes` nu primea niciodată UPDATE-urile. Acum polling
// prin get_order_public_status RPC (SECURITY DEFINER).
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react'
import type { OrderConfirmationPayload } from '../lib/orders'
import { getOrderPublicStatus, requestFiscalReceipt } from '../lib/orders'
import PaymentConfirmedScreen from './PaymentConfirmedScreen'

const ORDER_STEPS = [
  { status: 'new', label: 'Trimisă', n: '1' },
  { status: 'confirmed', label: 'Confirmată', n: '2' },
  { status: 'preparing', label: 'În preparare', n: '3' },
  { status: 'ready', label: 'Gata de servit', n: '4' },
  { status: 'served', label: 'Servită', n: '5' },
]

interface OrderTrackerProps {
  confirmation: OrderConfirmationPayload
  accent: string
  onReset: (addMore?: boolean) => void
  previousOrders: OrderConfirmationPayload[]
}

function OrderTracker({ confirmation, accent, onReset, previousOrders }: OrderTrackerProps) {
  const [status, setStatus] = useState<string>(confirmation.status ?? 'new')
  const [tipsAmount, setTipsAmount] = useState<number>(0)
  const [paidAmount, setPaidAmount] = useState<number>(Number(confirmation.total))
  const [restaurantInfo, setRestaurantInfo] = useState<{
    name: string
    slug: string
    google_review_url: string | null
  } | null>(null)
  const [fiscalRequestedAt, setFiscalRequestedAt] = useState<string | null>(null)
  const [fiscalRequesting, setFiscalRequesting] = useState(false)
  const statusRef = useRef<string>(status)
  statusRef.current = status

  useEffect(() => {
    // Skip polling entirely for LOCAL- offline orders (not in DB yet)
    if (confirmation.short_id?.startsWith('LOCAL-')) return

    let cancelled = false
    // 'closed' (Plan 2 non-fiscal) = terminal, nu emite bon → oprește polling.
    // 'paid' rămâne polling: așteptăm fiscal_receipt_requested_at.
    const TERMINAL = ['cancelled', 'closed']

    const poll = async () => {
      // Continuă polling chiar și după 'paid' — vrem să prindem și fiscal_receipt update
      if (TERMINAL.includes(statusRef.current)) return
      const payload = await getOrderPublicStatus(confirmation.id)
      if (cancelled || !payload) return
      const p = payload as unknown as Record<string, unknown>
      setStatus(p.status as string)
      if (typeof p.tips_amount === 'number' || typeof p.tips_amount === 'string') {
        setTipsAmount(Number(p.tips_amount) || 0)
      }
      if (typeof p.paid_amount === 'number' || typeof p.paid_amount === 'string') {
        setPaidAmount(Number(p.paid_amount) || Number(confirmation.total))
      }
      if (p.fiscal_receipt_requested_at) {
        setFiscalRequestedAt(p.fiscal_receipt_requested_at as string)
      }
      if (p.restaurant && typeof p.restaurant === 'object') {
        const r = p.restaurant as Record<string, unknown>
        setRestaurantInfo({
          name: String(r.name || ''),
          slug: String(r.slug || ''),
          google_review_url: (r.google_review_url as string) || null,
        })
      }
    }

    void poll()
    const interval = setInterval(() => {
      void poll()
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // status exclus din deps intentionat — folosim ref pentru a evita
    // restart-ul intervalului la fiecare update de status
  }, [confirmation.id, confirmation.short_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRequestFiscalReceipt() {
    if (fiscalRequesting || fiscalRequestedAt) return
    setFiscalRequesting(true)
    try {
      const result = await requestFiscalReceipt(confirmation.id)
      if (result?.requested_at) {
        setFiscalRequestedAt(String(result.requested_at))
      }
    } catch (e) {
      console.warn('fiscal receipt request failed:', e)
    } finally {
      setFiscalRequesting(false)
    }
  }

  const currentIdx = ORDER_STEPS.findIndex((s) => s.status === status)
  // 'closed' = Plan 2 terminal (mulțumire fără bon fiscal); 'paid' = Plan 3 cu bon.
  const isPaid = status === 'paid'
  const isClosed = status === 'closed'
  const isDone = status === 'served' || status === 'paid' || status === 'closed'
  const isCancelled = status === 'cancelled'

  // ── Plată confirmată → afișează ecranul dedicat cu feedback + Google review
  if ((isPaid || isClosed) && restaurantInfo) {
    return (
      <PaymentConfirmedScreen
        confirmation={{ ...confirmation, total: paidAmount } as OrderConfirmationPayload}
        restaurantName={restaurantInfo.name}
        googleReviewUrl={restaurantInfo.google_review_url}
        accent={accent}
        tipsAmount={tipsAmount}
        // Plan 2 (closed): masa închisă fără bon fiscal — ascunde CTA-ul de bon.
        onRequestFiscalReceipt={isClosed ? undefined : handleRequestFiscalReceipt}
        fiscalReceiptRequested={isClosed ? true : !!fiscalRequestedAt}
      />
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: PUB.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px 32px',
        zIndex: 300,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 22,
          fontWeight: 700,
          color: PUB.text,
          marginBottom: 4,
        }}
      >
        Comanda #{confirmation.short_id}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 20,
          fontWeight: 700,
          color: accent,
          marginBottom: 32,
        }}
      >
        {Number(confirmation.total).toFixed(2)} lei
      </div>

      {isCancelled ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 48, color: '#c0392b' }}>✕</div>
          <div style={{ color: '#c0392b', fontSize: 16, fontWeight: 600, marginTop: 12 }}>
            Comanda a fost anulată
          </div>
        </div>
      ) : (
        <div
          style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          {ORDER_STEPS.map((step, i) => {
            const isActive = i === currentIdx
            const isPast = i < currentIdx || isDone
            const isFuture = i > currentIdx && !isDone
            return (
              <div
                key={step.status}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative' }}
              >
                {i < ORDER_STEPS.length - 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 19,
                      top: 40,
                      width: 2,
                      height: 28,
                      background: isPast ? accent : '#D4C8B8',
                    }}
                  />
                )}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: isPast || isActive ? accent : '#EDE7D9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    border: isActive ? '3px solid ' + accent : 'none',
                    boxShadow: isActive ? '0 0 0 4px ' + accent + '33' : 'none',
                    color: isPast || isActive ? '#fff' : PUB.text,
                    fontWeight: 700,
                  }}
                >
                  {isPast ? '✓' : step.n}
                </div>
                <div style={{ paddingTop: 8, paddingBottom: 28 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: isActive ? 700 : 500,
                      color: isFuture ? '#B8AD9E' : PUB.text,
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    {step.label}
                  </div>
                  {isActive && !isDone && (
                    <div style={{ fontSize: 12, color: '#5C4A2A', marginTop: 2 }}>Acum</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginTop: 24,
          width: '100%',
          maxWidth: 320,
        }}
      >
        {/* "Add more" — keeps session history, goes back to menu */}
        {!isCancelled && (
          <button
            onClick={() => onReset(true)}
            style={{
              background: accent,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '14px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            + Adaugă produse
          </button>
        )}
        {/* Full reset — clears everything */}
        <button
          onClick={() => onReset(false)}
          style={{
            background: 'transparent',
            color: '#9A8C7A',
            border: '1px solid #D4C8B8',
            borderRadius: 12,
            padding: '12px 0',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          {isCancelled ? 'Comandă nouă' : 'Închide sesiunea'}
        </button>
      </div>
      {/* Show session total if there are previous orders */}
      {previousOrders.length > 0 && !isCancelled && (
        <div style={{ marginTop: 16, fontSize: '0.8rem', color: '#9A8C7A', textAlign: 'center' }}>
          Total sesiune:{' '}
          {(
            previousOrders.reduce((s, o) => s + Number(o.total), 0) + Number(confirmation.total)
          ).toFixed(2)}{' '}
          lei ({previousOrders.length + 1} comenzi)
        </div>
      )}
    </div>
  )
}

const PUB = { bg: '#F8F3EB', text: '#1A1208' } as const

// ── ActiveOrdersBanner ─────────────────────────────────────────
// Shows live status of all orders placed in this QR session.
// Collapses to a single line, expands to show each order's status.

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new: { label: 'Primit', color: '#5C4A2A' },
  confirmed: { label: 'Confirmat', color: '#E8A020' },
  preparing: { label: 'Se prepară', color: '#C8963C' },
  ready: { label: 'Gata de servit', color: '#4CAF6E' },
  served: { label: 'Servit', color: '#7EB8F7' },
  paid: { label: 'Plătit', color: '#9A9590' },
  cancelled: { label: 'Anulat', color: '#c0392b' },
}

interface ActiveOrdersBannerProps {
  orders: OrderConfirmationPayload[]
  accent: string
  onAddMore: () => void
}

function ActiveOrdersBanner({ orders, accent, onAddMore }: ActiveOrdersBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((o) => [o.id, o.status])),
  )
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses

  // Polling pentru toate comenzile active
  useEffect(() => {
    if (orders.length === 0) return

    let cancelled = false

    const TERMINAL = ['paid', 'served', 'cancelled']

    const pollAll = async () => {
      // Poll solo pentru comenzi non-terminale și non-offline
      const active = orders.filter(
        (o) =>
          !o.short_id?.startsWith('LOCAL-') &&
          !TERMINAL.includes(statusesRef.current[o.id] ?? o.status),
      )
      if (active.length === 0) return

      const results = await Promise.all(
        active.map(async (o) => {
          const payload = await getOrderPublicStatus(o.id)
          return { id: o.id, status: payload?.status ?? null }
        }),
      )
      if (cancelled) return
      setStatuses((prev) => {
        const next = { ...prev }
        for (const r of results) {
          if (r.status) next[r.id] = r.status
        }
        return next
      })
    }

    void pollAll()
    const interval = setInterval(() => {
      void pollAll()
    }, 6000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [orders])

  const totalSpent = orders.reduce((s, o) => s + Number(o.total), 0)
  const activeCount = orders.filter((o) => {
    const st = statuses[o.id] || o.status
    return !['served', 'paid', 'cancelled'].includes(st)
  }).length

  return (
    <div
      style={{
        background: '#FDF8F2',
        border: '1px solid #E8DFD0',
        borderRadius: 12,
        margin: '0 0 12px',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧾</span>
          <div>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: '#1A1208',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {orders.length} comandă{orders.length !== 1 ? '' : ''} · {totalSpent.toFixed(2)} lei
              total
            </span>
            {activeCount > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: '0.7rem',
                  background: accent + '22',
                  color: accent,
                  padding: '1px 7px',
                  borderRadius: 100,
                  fontWeight: 600,
                  border: `1px solid ${accent}44`,
                }}
              >
                {activeCount} activ{activeCount !== 1 ? 'e' : 'ă'}
              </span>
            )}
          </div>
        </div>
        <span
          style={{
            color: '#9A8C7A',
            fontSize: 12,
            transition: 'transform .2s',
            transform: expanded ? 'rotate(180deg)' : 'none',
          }}
        >
          ▾
        </span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid #E8DFD0',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {orders.map((order) => {
            const st = statuses[order.id] || order.status
            const meta = STATUS_LABEL[st] || { label: st, color: '#5C4A2A' }
            return (
              <div
                key={order.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: '#FFF9F3',
                  borderRadius: 8,
                  border: '1px solid #EDE3D4',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: meta.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '0.82rem',
                      color: '#1A1208',
                      fontFamily: 'DM Sans, sans-serif',
                      fontWeight: 500,
                    }}
                  >
                    Comanda #{order.short_id}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '0.72rem', color: meta.color, fontWeight: 600 }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: '#9A8C7A' }}>
                    {Number(order.total).toFixed(2)} lei
                  </span>
                </div>
              </div>
            )
          })}
          <button
            onClick={onAddMore}
            style={{
              marginTop: 4,
              background: accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            + Adaugă produse
          </button>
        </div>
      )}
    </div>
  )
}

export { OrderTracker, ActiveOrdersBanner }
