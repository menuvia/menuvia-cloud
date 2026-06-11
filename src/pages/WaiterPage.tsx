// =============================================================
// Menuvia — src/pages/WaiterPage.tsx
// Waiter Dashboard (/waiter). Dark theme. No `any`.
// =============================================================

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useOrders } from '../hooks/useOrders'
import { useFeatures } from '../hooks/useFeatures'
import { planTier } from '../lib/features'
import { useReservations } from '../hooks/useReservations'
import type { Order, PaymentMethod } from '../lib/orders'
import { D } from '../lib/constants'
import { playSound } from '../lib/utils'
import { supabase } from '../lib/supabase'
import ManualOrderSheet from '../components/ManualOrderSheet'
import EditOrderSheet from '../components/EditOrderSheet'
import CancelOrderDialog from '../components/CancelOrderDialog'
import OrderAuditSheet from '../components/OrderAuditSheet'
import {
  fetchWaiterCalls,
  resolveWaiterCall,
  subscribeToWaiterCalls,
  addPartialPayment,
  getOrderPayments,
  applyOrderDiscount,
} from '../lib/orders'
import type { WaiterCall } from '../lib/orders'
import WaiterEntry from '../components/WaiterEntry'
import { PayModal, OrderCard } from '../components/WaiterOrderCard'
import DiscountModal from '../components/DiscountModal'
import { suggestHappyHourForOrder, type HappyHourSuggestion } from '../lib/happyHour'
import { syncPendingOrders, getPendingOrders } from '../lib/offlineSync'

// ── WaiterPage ────────────────────────────────────────────────

export default function WaiterPage() {
  const { user } = useAuth()
  // FIX: use RestaurantContext — no more local membership query, supports multi-restaurant
  const {
    activeId: restaurantId,
    activeName: restaurantName,
    activeRole,
    memberships,
    setActive,
  } = useRestaurantCtx()
  const isAdminRole = activeRole === 'owner' || activeRole === 'manager'

  // Regula de aur: bani + bon = Plan 3, fără excepții. Planul vine de la
  // RESTAURANT (get_restaurant_features), nu de la profilul ospătarului.
  // Cât timp features se încarcă, default-ul SIGUR e fără plăți (tier < 3) —
  // mai bine un ospătar vede „Închide comanda" o secundă decât să înregistreze
  // o plată pe un plan care nu o permite. Gating-ul real e oricum server-side.
  const restaurantFeatures = useFeatures(restaurantId)
  const paymentsEnabled = planTier(restaurantFeatures.features?.plan) >= 3

  const [payOrder, setPayOrder] = useState<Order | null>(null)
  const [editOrder, setEditOrder] = useState<Order | null>(null)
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null)
  const [auditOrder, setAuditOrder] = useState<Order | null>(null)
  const [discountOrderId, setDiscountOrderId] = useState<string | null>(null)
  const [happyHourSugg, setHappyHourSugg] = useState<HappyHourSuggestion | null>(null)
  const [showEntry, setShowEntry] = useState(false)

  // ── Happy Hour suggestion: se încarcă la deschiderea PayModal ──
  // Returnează rule activă curentă care dă cea mai mare reducere pe această
  // comandă. Reset când modal-ul se închide.
  useEffect(() => {
    if (payOrder == null) return
    let alive = true
    void suggestHappyHourForOrder(payOrder.id)
      .then((s) => {
        if (alive) setHappyHourSugg(s)
      })
      .catch(() => {
        if (alive) setHappyHourSugg(null)
      })
    return () => {
      alive = false
    }
  }, [payOrder])

  // ── Offline sync state ────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false)
      syncPendingOrders().catch(console.error)
    }
    function handleOffline() {
      setIsOffline(true)
    }
    function handleQueueUpdate(e: Event) {
      const customE = e as CustomEvent<number>
      setPendingSyncCount(customE.detail)
    }

    // Initial load check
    getPendingOrders()
      .then((q) => setPendingSyncCount(q.length))
      .catch(() => {})

    function handleAuthRequired() {
      // Sesiunea expirată — comenzile offline sunt blocate
      // Reîncărcarea paginii va redirecta la login
      console.warn('[WaiterPage] Sesiune expirată, sync offline blocat')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('offline-queue-updated', handleQueueUpdate)
    window.addEventListener('offline-sync-auth-required', handleAuthRequired)

    // Also listen for sw messages (Background sync triggers)
    const swListener = (e: MessageEvent) => {
      if (e.data && e.data.type === 'SYNC_NOW') {
        syncPendingOrders().catch(console.error)
      }
    }
    navigator.serviceWorker?.addEventListener('message', swListener)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('offline-queue-updated', handleQueueUpdate)
      window.removeEventListener('offline-sync-auth-required', handleAuthRequired)
      navigator.serviceWorker?.removeEventListener('message', swListener)
    }
  }, [])

  const prevReadyIds = useRef(new Set<string>())

  // ── Waiter calls ──────────────────────────────────────────────
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([])
  const prevCallIds = useRef(new Set<string>())

  useEffect(() => {
    if (!restaurantId) return
    fetchWaiterCalls(restaurantId)
      .then(setWaiterCalls)
      .catch(() => {})
    const ch = subscribeToWaiterCalls(restaurantId, () => {
      fetchWaiterCalls(restaurantId)
        .then(setWaiterCalls)
        .catch(() => {})
    })
    return () => {
      ch.unsubscribe()
    }
  }, [restaurantId])

  useEffect(() => {
    for (const c of waiterCalls) {
      if (!prevCallIds.current.has(c.id)) {
        playSound(660, 400)
        break
      }
    }
    prevCallIds.current = new Set(waiterCalls.map((c) => c.id))
  }, [waiterCalls])

  function handleResolveCall(callId: string): void {
    void resolveWaiterCall(callId).then(() => {
      setWaiterCalls((prev) => prev.filter((c) => c.id !== callId))
    })
  }

  // ── Split bill ────────────────────────────────────────────────
  const [splitOrder, setSplitOrder] = useState<Order | null>(null)
  const [splitAmount, setSplitAmount] = useState('')
  const [splitMethod, setSplitMethod] = useState<PaymentMethod>('cash')
  const [splitPayments, setSplitPayments] = useState<
    Array<{ id: string; amount: number; method: string; created_at: string }>
  >([])
  const [splitLoading, setSplitLoading] = useState(false)

  function openSplitBill(order: Order): void {
    setSplitOrder(order)
    setSplitAmount('')
    setSplitMethod('cash')
    setSplitLoading(true)
    getOrderPayments(order.id)
      .then((p) => {
        setSplitPayments(p)
        setSplitLoading(false)
      })
      .catch(() => setSplitLoading(false))
  }

  async function handlePartialPay(): Promise<void> {
    if (!splitOrder) return
    const amt = parseFloat(splitAmount)
    if (!amt || amt <= 0) return
    setSplitLoading(true)
    try {
      const result = await addPartialPayment(splitOrder.id, amt, splitMethod)
      if (result.fully_paid) {
        setSplitOrder(null)
        return
      }
      const payments = await getOrderPayments(splitOrder.id)
      setSplitPayments(payments)
      setSplitAmount('')
    } catch {
      /* ignore */
    }
    setSplitLoading(false)
  }

  const {
    orders: allOrders,
    loading: ordersLoading,
    error,
    advance,
    connectionStatus,
  } = useOrders(restaurantId, 'waiter')

  // Rezervări azi — start/end calculat o singură dată pe zi
  const todayRange = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { from: start.toISOString(), to: end.toISOString() }
  }, [])
  const {
    reservations,
    updateStatus: updateReservationStatus,
    seat: seatReservation,
  } = useReservations(restaurantId, todayRange)
  const activeReservations = useMemo(
    () =>
      reservations.filter(
        (r) => r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'completed',
      ),
    [reservations],
  )

  // Mese disponibile pentru alocare manuală la așezare
  const [tables, setTables] = useState<{ id: string; name: string; seats: number | null }[]>([])
  const [tablesLoadError, setTablesLoadError] = useState<string | null>(null)
  useEffect(() => {
    if (!restaurantId) {
      setTables([])
      return
    }
    // Guard împotriva race-ului la switch rapid de restaurant.
    let cancelled = false
    setTablesLoadError(null)
    void supabase
      .from('tables')
      .select('id, name, seats')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) {
          setTablesLoadError(e.message)
          setTables([])
        } else {
          setTables((data ?? []) as typeof tables)
        }
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])
  // Masă selectată per rezervare (pentru cele fără masă alocată).
  // Reset la schimbarea restaurantului — altfel pick-urile vechi rămân
  // (pre-fill greșit + memory accumulator pe sesiuni lungi).
  const [seatTablePick, setSeatTablePick] = useState<Record<string, string>>({})
  useEffect(() => {
    setSeatTablePick({})
  }, [restaurantId])

  const [showManualOrder, setShowManualOrder] = useState(false)
  const [lastManualOrder, setLastManualOrder] = useState<{ id: string; shortId: string } | null>(
    null,
  )

  // ── Table assignments — filter orders to waiter's assigned tables ──
  // 'loading' = still fetching | Set = has assignments | null = no assignments (show all)
  const [assignedTableIds, setAssignedTableIds] = useState<Set<string> | null | 'loading'>(
    'loading',
  )
  useEffect(() => {
    if (!restaurantId || !user) {
      setAssignedTableIds(null)
      return
    }
    setAssignedTableIds('loading')
    void (async () => {
      try {
        const { data } = await supabase
          .from('waiter_table_assignments')
          .select('table_id')
          .eq('restaurant_id', restaurantId)
          .eq('user_id', user.id)
        const ids = data ?? []
        setAssignedTableIds(
          ids.length > 0 ? new Set(ids.map((r: Record<string, string>) => r.table_id)) : null,
        )
      } catch {
        setAssignedTableIds(null)
      }
    })()
  }, [restaurantId, user])

  const assignmentsReady = assignedTableIds !== 'loading'
  const loading = ordersLoading || !assignmentsReady

  // If waiter has assignments → show only their tables. Otherwise show all.
  // useMemo to avoid new array reference every render (fixes useEffect dependency)
  const orders = useMemo(() => {
    if (assignedTableIds instanceof Set) {
      return allOrders.filter((o) => o.table_id != null && assignedTableIds.has(o.table_id))
    }
    return allOrders
  }, [allOrders, assignedTableIds])

  const byStatus = useCallback(
    (statuses: import('../lib/orders').OrderStatus[]) =>
      orders.filter((o) => statuses.includes(o.status)),
    [orders],
  )

  // Sound on new ready orders
  useEffect(() => {
    const readyOrders = orders.filter((o) => o.status === 'ready')
    for (const o of readyOrders) {
      if (!prevReadyIds.current.has(o.id)) {
        playSound(440, 300)
        break
      }
    }
    prevReadyIds.current = new Set(readyOrders.map((o) => o.id))
  }, [orders])

  function handleServit(order: Order): void {
    if (user == null) return
    void advance(order.id, 'ready', { status: 'served', served_by: user.id })
  }

  function handlePay(method: PaymentMethod, amount: number, tips: number): void {
    if (payOrder == null || user == null) return
    void advance(payOrder.id, 'served', {
      status: 'paid',
      paid_by: user.id,
      payment_method: method,
      paid_amount: amount,
      tips_amount: tips,
    })
    setPayOrder(null)
  }

  // Plan 1/2: închidere NON-fiscală (served → closed). Fără sumă, fără metodă
  // de plată — clientul plătește la casa de marcat existentă a localului.
  function handleCloseOrder(order: Order): void {
    if (user == null) return
    void advance(order.id, 'served', { status: 'closed' })
  }

  const readyOrders = byStatus(['ready'])
  const openOrders = byStatus(['new', 'confirmed', 'preparing', 'ready', 'served'])

  if (loading) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isAdminRole && (
            <button
              onClick={() => {
                window.history.pushState({}, '', '/dashboard')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}
              title="Înapoi la Dashboard"
              style={{
                background: 'transparent',
                color: D.t2,
                border: `1px solid ${D.s3}`,
                borderRadius: 7,
                padding: '5px 10px',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Dashboard
            </button>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 18,
                  fontWeight: 700,
                  color: D.t1,
                }}
              >
                {isAdminRole ? 'Comenzi live' : 'Ospătar'}
                {restaurantName.length > 0 ? ` — ${restaurantName}` : ''}
              </span>
              <span
                title={
                  connectionStatus === 'connected'
                    ? 'Live conectat'
                    : connectionStatus === 'connecting'
                      ? 'Se conectează…'
                      : 'Deconectat — se face refresh automat la 30s'
                }
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    connectionStatus === 'connected'
                      ? D.green
                      : connectionStatus === 'connecting'
                        ? D.amber
                        : D.red,
                  boxShadow: connectionStatus === 'connected' ? `0 0 6px ${D.green}88` : 'none',
                  flexShrink: 0,
                }}
              />
            </div>
            {assignedTableIds instanceof Set && (
              <div style={{ fontSize: 11, color: D.gold, marginTop: 1 }}>
                🪑 {assignedTableIds.size}{' '}
                {assignedTableIds.size === 1 ? 'masă alocată' : 'mese alocate'} · Comenzile tale
              </div>
            )}
            {isAdminRole && !(assignedTableIds instanceof Set) && (
              <div style={{ fontSize: 11, color: D.t3, marginTop: 1 }}>
                Vizualizare admin · vezi tot live
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Restaurant selector — only visible for multi-restaurant users */}
          {memberships.length > 1 && (
            <select
              value={restaurantId ?? ''}
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
          )}
          <button
            onClick={() => setShowManualOrder(true)}
            style={{
              background: D.s3,
              color: D.t1,
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              padding: '8px 14px',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            🧑‍💼 Manual
          </button>
          <button
            onClick={() => setShowEntry(true)}
            style={{
              background: D.gold,
              color: D.bg,
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Comandă nouă
          </button>
        </div>
      </div>

      {/* Offline Sync Banner */}
      {(isOffline || pendingSyncCount > 0) && (
        <div
          style={{
            background: isOffline ? '#854d0e' : '#166534',
            color: '#fff',
            padding: '6px 24px',
            fontSize: 12,
            fontFamily: 'DM Sans, sans-serif',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            {isOffline
              ? '📡 Mod Offline — Comenzile se salvează local (se vor trimite când revine conexiunea).'
              : '🔄 Conexiune restabilită — Se sincronizează comenzile...'}
          </span>
          {pendingSyncCount > 0 && (
            <span style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: 12 }}>
              {pendingSyncCount}{' '}
              {pendingSyncCount === 1 ? 'comandă în așteptare' : 'comenzi în așteptare'}
            </span>
          )}
        </div>
      )}

      {error != null && (
        <div style={{ background: `${D.red}22`, color: D.red, padding: '8px 24px', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 800,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Section 0 — Rezervări azi */}
        {activeReservations.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 12,
                fontWeight: 600,
                color: D.gold,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 12,
              }}
            >
              📅 Rezervări azi ({activeReservations.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeReservations.map((r) => {
                const t = new Date(r.starts_at).toLocaleTimeString('ro-RO', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <div
                    key={r.id}
                    style={{
                      background: D.s2,
                      border: `1px solid ${D.s3}`,
                      borderRadius: 12,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span
                          style={{
                            fontFamily: 'Fraunces, Georgia, serif',
                            fontSize: 20,
                            fontWeight: 700,
                            color: D.t1,
                          }}
                        >
                          {t}
                        </span>
                        <span style={{ fontSize: 14, color: D.t1 }}>{r.customer_name}</span>
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: r.status === 'seated' ? D.green : D.gold,
                        }}
                      >
                        {r.status === 'seated'
                          ? 'AȘEZAT'
                          : r.status === 'confirmed'
                            ? 'CONFIRMAT'
                            : 'PENDING'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: D.t2, marginBottom: 10 }}>
                      {r.party_size} {r.party_size === 1 ? 'persoană' : 'persoane'}
                      {r.table?.name ? ` · Masa ${r.table.name}` : ' · fără masă'}
                      {' · '}
                      <a href={'tel:' + r.customer_phone} style={{ color: D.gold }}>
                        {r.customer_phone}
                      </a>
                    </div>
                    {r.requested_zone && !r.table?.name && (
                      <div
                        style={{
                          fontSize: 12,
                          color: D.amber,
                          marginBottom: 8,
                          padding: '4px 8px',
                          background: 'rgba(232,160,32,0.08)',
                          borderRadius: 6,
                          display: 'inline-block',
                        }}
                      >
                        🌿 Cere zona: {r.requested_zone}
                      </div>
                    )}
                    {r.special_requests && (
                      <div
                        style={{
                          fontSize: 12,
                          color: D.t2,
                          fontStyle: 'italic',
                          marginBottom: 10,
                          padding: '6px 10px',
                          background: D.s1,
                          borderRadius: 6,
                        }}
                      >
                        „{r.special_requests}"
                      </div>
                    )}
                    {r.status !== 'seated' &&
                      (() => {
                        // O singură sursă de adevăr pentru pickul de masă:
                        // pickul manual al ospătarului, fallback la masa pre-alocată.
                        const pick = seatTablePick[r.id] ?? r.table_id ?? ''
                        const canSeat = pick.length > 0
                        return (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                            <select
                              value={pick}
                              onChange={(e) =>
                                setSeatTablePick((p) => ({ ...p, [r.id]: e.target.value }))
                              }
                              style={{
                                flex: '0 0 auto',
                                maxWidth: 120,
                                background: D.s1,
                                color: D.t1,
                                border: `1px solid ${D.s3}`,
                                borderRadius: 8,
                                padding: '0 8px',
                                fontSize: 13,
                              }}
                            >
                              <option value="">Alege masă…</option>
                              {tables.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                  {t.seats ? ` (${t.seats})` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                if (!canSeat) return
                                void seatReservation(r.id, pick).catch((e) =>
                                  alert(e instanceof Error ? e.message : 'Eroare'),
                                )
                              }}
                              disabled={!canSeat}
                              title={canSeat ? 'Marchează ca așezat' : 'Alege întâi o masă'}
                              style={{
                                flex: 1,
                                padding: '10px',
                                background: canSeat ? D.green : D.s3,
                                color: canSeat ? '#fff' : D.t3,
                                border: 'none',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: canSeat ? 'pointer' : 'not-allowed',
                                opacity: canSeat ? 1 : 0.7,
                              }}
                            >
                              Așezat
                            </button>
                            <button
                              onClick={() => {
                                if (!confirm('Marchezi ca no-show?')) return
                                void updateReservationStatus(r.id, 'no_show').catch((e) =>
                                  alert(e instanceof Error ? e.message : 'Eroare'),
                                )
                              }}
                              style={{
                                padding: '10px 14px',
                                background: 'transparent',
                                color: D.red,
                                border: `1px solid ${D.red}`,
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              No-show
                            </button>
                          </div>
                        )
                      })()}
                  </div>
                )
              })}
            </div>
            {tablesLoadError && (
              <div
                style={{
                  fontSize: 12,
                  color: D.red,
                  marginTop: 8,
                  padding: '6px 10px',
                  background: 'rgba(224,85,85,0.10)',
                  borderRadius: 6,
                }}
              >
                Nu am putut încărca lista meselor: {tablesLoadError}
              </div>
            )}
          </div>
        )}

        {/* Section 1 — Ready */}
        {readyOrders.length > 0 && (
          <div>
            <div
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 12,
                fontWeight: 600,
                color: D.green,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 12,
              }}
            >
              Gata de servit ({readyOrders.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {readyOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    background: 'rgba(76,175,110,0.08)',
                    border: `1px solid ${D.green}44`,
                    borderRadius: 12,
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 16,
                        fontWeight: 700,
                        color: D.t1,
                      }}
                    >
                      {order.table?.name ?? 'Fără masă'}
                    </div>
                    <div style={{ fontSize: 13, color: D.t2, marginTop: 2 }}>
                      {order.order_items.map((i) => i.product_name_snapshot).join(', ')}
                    </div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 16,
                        fontWeight: 700,
                        color: D.t1,
                        marginTop: 4,
                      }}
                    >
                      {order.total.toFixed(2)} lei
                    </div>
                  </div>
                  <button
                    onClick={() => handleServit(order)}
                    style={{
                      background: D.green,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px 20px',
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Servit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 0 - Waiter Calls */}
        {waiterCalls.length > 0 && (
          <div>
            <div
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 12,
                fontWeight: 600,
                color: D.amber,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 12,
              }}
            >
              Apeluri ospatar ({waiterCalls.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {waiterCalls.map((call) => (
                <div
                  key={call.id}
                  style={{
                    background: 'rgba(232,160,32,0.08)',
                    border: '1px solid rgba(232,160,32,0.3)',
                    borderRadius: 12,
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: 16,
                        fontWeight: 700,
                        color: D.t1,
                      }}
                    >
                      {call.table?.name ?? 'Masa necunoscuta'}
                    </div>
                    <div style={{ fontSize: 12, color: D.t2, marginTop: 2 }}>
                      {new Date(call.created_at).toLocaleTimeString('ro-RO', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => handleResolveCall(call.id)}
                    style={{
                      background: D.amber,
                      color: '#000',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px 20px',
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Rezolvat
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 2 — All open orders */}
        <div>
          <div
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 12,
              fontWeight: 600,
              color: D.t2,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            Toate comenzile deschise ({openOrders.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {openOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onPayOpen={setPayOrder}
                onSplitOpen={openSplitBill}
                onEdit={setEditOrder}
                onCancel={setCancelOrder}
                onAudit={isAdminRole ? setAuditOrder : undefined}
                paymentsEnabled={paymentsEnabled}
                onCloseOrder={handleCloseOrder}
              />
            ))}
            {openOrders.length === 0 && (
              <div style={{ color: D.t3, fontSize: 14, textAlign: 'center', padding: 32 }}>
                Nicio comandă deschisă
              </div>
            )}
          </div>
        </div>
      </div>

      {payOrder != null &&
        user != null &&
        paymentsEnabled &&
        (() => {
          // Live lookup: dacă orders au fost actualizate (ex: discount aplicat),
          // PayModal afișează versiunea curentă, nu cea închisă în payOrder.
          const live = orders.find((o) => o.id === payOrder.id) ?? payOrder
          return (
            <PayModal
              order={live}
              onConfirm={handlePay}
              onClose={() => {
                setPayOrder(null)
                setHappyHourSugg(null)
              }}
              onDiscountClick={() => setDiscountOrderId(live.id)}
              happyHourSuggestion={happyHourSugg}
              onApplyHappyHour={async () => {
                if (!happyHourSugg) return
                try {
                  await applyOrderDiscount(
                    live.id,
                    happyHourSugg.discount_type,
                    happyHourSugg.discount_value,
                    `🎉 Happy Hour: ${happyHourSugg.rule_name}`,
                  )
                  setHappyHourSugg(null)
                } catch (err) {
                  console.error('[WaiterPage] Apply happy hour failed', err)
                }
              }}
            />
          )
        })()}

      {discountOrderId != null &&
        (() => {
          const target = orders.find((o) => o.id === discountOrderId)
          if (target == null) {
            // Order n-a fost găsit — închidem
            setDiscountOrderId(null)
            return null
          }
          return (
            <DiscountModal
              order={target}
              onClose={() => setDiscountOrderId(null)}
              onApplied={() => {
                // Realtime din useOrders va aduce update-ul; nu mai trebuie să facem nimic.
                // Lăsăm DiscountModal să se închidă singur prin onClose.
              }}
            />
          )
        })()}

      {/* Split Bill Modal */}
      {splitOrder != null && paymentsEnabled && (
        <div
          onClick={() => setSplitOrder(null)}
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
              border: '1px solid ' + D.s3,
              borderRadius: 16,
              padding: 28,
              width: 400,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
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
              Plata partiala
            </div>
            <div>
              <div style={{ color: D.t2, fontSize: 13 }}>Masa: {splitOrder.table?.name ?? '-'}</div>
              <div
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 28,
                  fontWeight: 900,
                  color: D.gold,
                }}
              >
                {splitOrder.total.toFixed(2)} lei
              </div>
            </div>

            {splitPayments.length > 0 && (
              <div style={{ background: D.s3, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: D.t3, marginBottom: 8 }}>
                  Plati inregistrate:
                </div>
                {splitPayments.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      color: D.t2,
                      padding: '2px 0',
                    }}
                  >
                    <span>
                      {p.method === 'cash' ? 'Cash' : p.method === 'card_pos' ? 'Card' : 'Altul'}
                    </span>
                    <span style={{ color: D.green }}>{p.amount.toFixed(2)} lei</span>
                  </div>
                ))}
                <div
                  style={{
                    borderTop: '1px solid ' + D.border,
                    marginTop: 8,
                    paddingTop: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  <span style={{ color: D.t2 }}>Ramas:</span>
                  <span style={{ color: D.t1 }}>
                    {Math.max(
                      0,
                      splitOrder.total - splitPayments.reduce((s, p) => s + p.amount, 0),
                    ).toFixed(2)}{' '}
                    lei
                  </span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {(['cash', 'card_pos', 'other'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setSplitMethod(m)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    background: splitMethod === m ? D.goldA : D.s3,
                    border: '1px solid ' + (splitMethod === m ? D.gold : D.s3),
                    borderRadius: 8,
                    color: splitMethod === m ? D.gold : D.t2,
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {m === 'cash' ? 'Cash' : m === 'card_pos' ? 'Card' : 'Altul'}
                </button>
              ))}
            </div>

            <div>
              <div style={{ color: D.t2, fontSize: 12, marginBottom: 6 }}>Suma (lei)</div>
              <input
                type="number"
                value={splitAmount}
                onChange={(e) => setSplitAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: D.s3,
                  border: '1px solid ' + D.s3,
                  borderRadius: 8,
                  color: D.t1,
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 16,
                  padding: '10px 12px',
                }}
              />
            </div>

            <button
              onClick={() => {
                void handlePartialPay()
              }}
              disabled={splitLoading || !splitAmount}
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
                opacity: splitLoading ? 0.7 : 1,
              }}
            >
              {splitLoading ? 'Se proceseaza...' : 'Adauga plata'}
            </button>
            <button
              onClick={() => setSplitOrder(null)}
              style={{
                background: 'transparent',
                color: D.t2,
                border: '1px solid ' + D.s3,
                borderRadius: 8,
                padding: '10px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Inchide
            </button>
          </div>
        </div>
      )}

      {editOrder != null && (
        <EditOrderSheet
          order={editOrder}
          onClose={() => setEditOrder(null)}
          onSaved={() => setEditOrder(null)}
        />
      )}

      {cancelOrder != null && (
        <CancelOrderDialog
          order={cancelOrder}
          onClose={() => setCancelOrder(null)}
          onConfirm={(reason) => {
            void advance(cancelOrder.id, cancelOrder.status, {
              status: 'cancelled',
              cancel_reason: reason,
            })
            setCancelOrder(null)
          }}
        />
      )}

      {auditOrder != null && (
        <OrderAuditSheet
          orderId={auditOrder.id}
          orderShortId={auditOrder.id.slice(-6).toUpperCase()}
          onClose={() => setAuditOrder(null)}
        />
      )}

      {showManualOrder && restaurantId != null && (
        <ManualOrderSheet
          restaurantId={restaurantId}
          onClose={() => setShowManualOrder(false)}
          onOrderPlaced={(_id, shortId) => {
            setLastManualOrder({ id: _id, shortId })
            setShowManualOrder(false)
          }}
        />
      )}

      {lastManualOrder && (
        <div
          onClick={() => setLastManualOrder(null)}
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex: 9999,
            background: D.s2,
            border: `1px solid ${D.green}44`,
            borderLeft: `3px solid ${D.green}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: '0.875rem',
            color: D.t1,
            boxShadow: '0 8px 32px rgba(0,0,0,.4)',
            minWidth: 220,
            cursor: 'pointer',
          }}
        >
          {lastManualOrder.shortId.startsWith('LOCAL-') ? (
            <>
              <span style={{ color: D.amber }}>⏳</span> Comandă salvată local{' '}
              <strong>#{lastManualOrder.shortId}</strong> — va fi trimisă când revine conexiunea
            </>
          ) : (
            <>
              <span style={{ color: D.green }}>✓</span> Comanda{' '}
              <strong>#{lastManualOrder.shortId}</strong> trimisă
            </>
          )}
          <div style={{ fontSize: '0.72rem', color: D.t3, marginTop: 3 }}>
            Click pentru a închide
          </div>
        </div>
      )}

      {showEntry && restaurantId != null && user != null && (
        <WaiterEntry
          restaurantId={restaurantId}
          onClose={() => setShowEntry(false)}
          onOrderCreated={() => setShowEntry(false)}
        />
      )}
    </div>
  )
}
