// =============================================================
// Menuvia — src/pages/WaiterPage.tsx
// Waiter Dashboard (/waiter). Dark theme. No `any`.
// =============================================================

import { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { useOrders } from '../hooks/useOrders'
import { useFeatures } from '../hooks/useFeatures'
import { planTier } from '../lib/features'
import { useReservations } from '../hooks/useReservations'
import type { Order, PaymentMethod } from '../lib/orders'
import { D, STATUS_META } from '../lib/constants'
import { playSound } from '../lib/utils'
import { useInView, revealStyle } from '../lib/motion'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/useToast'
// OPT-10: sheet-urile/modalele condiționale sunt lazy (pattern QrMenuPage) —
// ~2.000+ LOC amânate din chunk-ul inițial al paginii de ospătar. WaiterEntry
// rămâne static (partajează ModifierSheet, folosit imediat la comanda nouă).
const ManualOrderSheet = lazy(() => import('../components/ManualOrderSheet'))
const EditOrderSheet = lazy(() => import('../components/EditOrderSheet'))
const CancelOrderDialog = lazy(() => import('../components/CancelOrderDialog'))
const OrderAuditSheet = lazy(() => import('../components/OrderAuditSheet'))
import {
  fetchWaiterCalls,
  resolveWaiterCall,
  subscribeToWaiterCalls,
  addPartialPayment,
  getOrderPayments,
  applyOrderDiscount,
} from '../lib/orders'
import type { WaiterCall } from '../lib/orders'
import { redeemLoyaltyReward } from '../lib/loyalty'
import WaiterEntry from '../components/WaiterEntry'
import { PayModal, OrderCard } from '../components/WaiterOrderCard'
const DiscountModal = lazy(() => import('../components/DiscountModal'))
const TableStatusBoard = lazy(() => import('../components/TableStatusBoard'))
import type { FloorLayout } from '../lib/floorPlan'
import { suggestHappyHourForOrder, type HappyHourSuggestion } from '../lib/happyHour'
import { syncPendingOrders, getPendingOrders } from '../lib/offlineSync'
import { Icon } from '../components/ui/Icon'
import { EmptyState } from '../components/ui/EmptyState'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

// ── Helpers vizuale ───────────────────────────────────────────

// Wrapper de reveal per-item — hook-ul useInView e apelat înăuntru, nu în
// .map() (regula hooks). Folosit pentru carduri ready / apeluri.
function RevealItem({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ amount: 0.05 })
  return (
    <div ref={ref} style={revealStyle(inView, { delay, y: 8 })}>
      {children}
    </div>
  )
}

// Titlu de secțiune consistent (cu pastilă de count colorată).
function SectionHeading({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span
        style={{
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 12,
          fontWeight: 700,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          background: `${color}1F`,
          color,
          borderRadius: 20,
          padding: '1px 8px',
          fontSize: 11,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
    </div>
  )
}

// ── WaiterPage ────────────────────────────────────────────────

export default function WaiterPage() {
  const { user } = useAuth()
  // Toast în loc de window.alert (audit aug 2026): alert() blochează întreg
  // UI-ul pe cel mai operațional ecran — un ospătar cu tava în mână nu are ce
  // face cu un dialog modal de sistem.
  const toast = useToast()
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
  // ★ audit v3 (DS-1): TRISTATE. `null` = planul NU e cunoscut (primul load
  // sau RPC picat fără cache) — nu înseamnă „fără plăți". Înainte necunoscutul
  // cădea pe `false` → cardul arăta „Închide comanda" (închidere NEfiscală) pe
  // un restaurant Plan 3 și serverul o accepta → comandă `closed` fără bon și
  // fără venit. Acum: necunoscut = fără buton de finalizare + banner de
  // reîncercare; serverul refuză oricum close_order pe planurile fiscale (mig 263).
  const planKnown = restaurantFeatures.features != null
  const paymentsEnabled: boolean | null = planKnown
    ? planTier(restaurantFeatures.features?.plan) >= 3
    : null

  const [payOrder, setPayOrder] = useState<Order | null>(null)
  // Suma deja încasată în plăți parțiale pe comanda din PayModal — ca „Plata
  // integrală" să ceară DOAR restul, nu totalul (altfel server-ul respinge cu
  // overpayment și oricum ar fi dublă-încasare). Vezi mig 172.
  const [payOrderPaid, setPayOrderPaid] = useState(0)
  const [editOrder, setEditOrder] = useState<Order | null>(null)
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null)
  const [auditOrder, setAuditOrder] = useState<Order | null>(null)
  const [discountOrderId, setDiscountOrderId] = useState<string | null>(null)
  const [happyHourSugg, setHappyHourSugg] = useState<HappyHourSuggestion | null>(null)
  const [showEntry, setShowEntry] = useState(false)
  // Masă pre-selectată când deschid „Comandă nouă" din panoul Stadiu mese
  // (null = flux normal, alegi masa în WaiterEntry).
  const [entryTableId, setEntryTableId] = useState<string | null>(null)
  // Vedere: listă de comenzi (implicit) vs panou „Stadiu mese" (doar Pro).
  const [view, setView] = useState<'lista' | 'mese'>('lista')

  // ── Happy Hour suggestion: se încarcă la deschiderea PayModal ──
  // Returnează rule activă curentă care dă cea mai mare reducere pe această
  // comandă. Reset când modal-ul se închide.
  useEffect(() => {
    if (payOrder == null) {
      setPayOrderPaid(0)
      return
    }
    let alive = true
    void suggestHappyHourForOrder(payOrder.id)
      .then((s) => {
        if (alive) setHappyHourSugg(s)
      })
      .catch(() => {
        if (alive) setHappyHourSugg(null)
      })
    // Cât s-a încasat deja în plăți parțiale pe această comandă.
    void getOrderPayments(payOrder.id)
      .then((ps) => {
        if (alive) setPayOrderPaid(ps.reduce((s, p) => s + p.amount, 0))
      })
      .catch(() => {
        if (alive) setPayOrderPaid(0)
      })
    return () => {
      alive = false
    }
  }, [payOrder])

  // ── Offline sync state ────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  // O comandă offline respinsă definitiv de server (produs șters / grup obligatoriu
  // schimbat) e ștearsă din coadă — ospătarul TREBUIE anunțat ca s-o reintroducă.
  const [droppedOrderReason, setDroppedOrderReason] = useState<string | null>(null)

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

    function handleDropped(e: Event) {
      const detail = (e as CustomEvent).detail as { reason?: string } | undefined
      setDroppedOrderReason(detail?.reason ?? 'eroare necunoscută')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('offline-queue-updated', handleQueueUpdate)
    window.addEventListener('offline-sync-auth-required', handleAuthRequired)
    window.addEventListener('offline-order-dropped', handleDropped)

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
      window.removeEventListener('offline-order-dropped', handleDropped)
      navigator.serviceWorker?.removeEventListener('message', swListener)
    }
  }, [])

  const prevReadyIds = useRef(new Set<string>())
  // Primul snapshot hidratat NU e „comandă nouă" — altfel sunetul suna la
  // încărcarea paginii sau după schimbarea restaurantului. Sunăm doar de la
  // al doilea snapshot (pattern oglindit din KitchenPage.tsx).
  const hasSeenInitialReady = useRef(false)

  // ── Waiter calls ──────────────────────────────────────────────
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([])
  const prevCallIds = useRef(new Set<string>())
  // Idem: primul set de apeluri hidratat nu declanșează sunet.
  const hasSeenInitialCalls = useRef(false)

  // Reset la schimbarea restaurantului — noul prim snapshot (apeluri + ready)
  // nu trebuie să sune.
  useEffect(() => {
    prevReadyIds.current = new Set<string>()
    hasSeenInitialReady.current = false
    prevCallIds.current = new Set<string>()
    hasSeenInitialCalls.current = false
  }, [restaurantId])

  useEffect(() => {
    if (!restaurantId) return
    const refresh = () => {
      fetchWaiterCalls(restaurantId)
        .then(setWaiterCalls)
        .catch(() => {})
    }
    refresh()
    const ch = subscribeToWaiterCalls(restaurantId, refresh)
    // Plasă de siguranță: realtime-ul poate cădea tăcut (același motiv pentru
    // care useOrders poll-uiește la 30s). Fără ea, un „Cheamă ospătar" pe canal
    // căzut nu apărea NICIODATĂ până la reload — clientul rămâne neservit.
    const poll = setInterval(refresh, 30000)
    return () => {
      ch.unsubscribe()
      clearInterval(poll)
    }
  }, [restaurantId])

  useEffect(() => {
    if (hasSeenInitialCalls.current) {
      for (const c of waiterCalls) {
        if (!prevCallIds.current.has(c.id)) {
          playSound(660, 400)
          break
        }
      }
    }
    hasSeenInitialCalls.current = true
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
  // Scroll-lock pe fundal cât e deschis modalul Split Bill — consistent cu
  // PayModal/DiscountModal (altfel pe iOS pagina derulează sub overlay).
  useBodyScrollLock(splitOrder != null && paymentsEnabled === true)

  // OPT-8: handleri stabili (useCallback) — altfel memo-ul de pe OrderCard
  // e inert: fiecare render al paginii le dădea identitate nouă.
  const openSplitBill = useCallback((order: Order): void => {
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
  }, [])

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
    } catch (err) {
      // Nu mai inghitim tacut o eroare pe o cale de bani (poate masca un refuz de gate / rol).
      console.error('[WaiterPage] plata partiala a esuat', err)
      const msg = err instanceof Error ? err.message : 'Eroare necunoscută'
      toast.error(`Plata nu a fost înregistrată: ${msg}. Verifică și reîncearcă.`)
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
  // Harta sălii desenată (pentru al doilea mod „Hartă" din panoul Stadiu mese).
  // Localurile fără hartă → null → panoul rămâne pe grilă (fără toggle).
  const [floorLayout, setFloorLayout] = useState<FloorLayout | null>(null)
  useEffect(() => {
    if (!restaurantId) {
      setFloorLayout(null)
      return
    }
    let cancelled = false
    void supabase
      .from('restaurants')
      .select('floor_layout')
      .eq('id', restaurantId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const fl = (data?.floor_layout ?? null) as unknown as FloorLayout | null
        setFloorLayout(fl && Array.isArray(fl.floors) ? fl : null)
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
    // Guard de anulare: la schimbarea restaurantului răspunsul VECHI nu trebuie
    // să seteze scope-ul de mese al restaurantului precedent (ospătarul ar filtra
    // comenzile pe mesele altui local).
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('waiter_table_assignments')
          .select('table_id')
          .eq('restaurant_id', restaurantId)
          .eq('user_id', user.id)
        if (cancelled) return
        // Un blip de rețea/RLS lasă `data:null` FĂRĂ throw (supabase-js). A cădea
        // pe `null` = „arată toate mesele" ar extinde tăcut scope-ul ospătarului
        // la toată sala pe un simplu blip. Pe eroare păstrăm starea anterioară.
        if (error) {
          setAssignedTableIds((prev) => (prev === 'loading' ? null : prev))
          return
        }
        const ids = data ?? []
        setAssignedTableIds(
          ids.length > 0 ? new Set(ids.map((r: Record<string, string>) => r.table_id)) : null,
        )
      } catch {
        if (cancelled) return
        setAssignedTableIds((prev) => (prev === 'loading' ? null : prev))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [restaurantId, user])

  const assignmentsReady = assignedTableIds !== 'loading'
  const loading = ordersLoading || !assignmentsReady

  // If waiter has assignments → show only their tables. Otherwise show all.
  // useMemo to avoid new array reference every render (fixes useEffect dependency)
  const orders = useMemo(() => {
    if (assignedTableIds instanceof Set) {
      // Comenzile fără masă (takeaway / comandă manuală „Fără masă") nu
      // aparțin niciunui ospătar prin alocare de masă — le arătăm TUTUROR
      // ospătarilor activi, indiferent de alocările lor, ca nicio comandă
      // să nu rămână orfană (invizibilă pentru toată lumea).
      return allOrders.filter((o) => o.table_id == null || assignedTableIds.has(o.table_id))
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
    if (hasSeenInitialReady.current) {
      for (const o of readyOrders) {
        if (!prevReadyIds.current.has(o.id)) {
          playSound(440, 300)
          break
        }
      }
    }
    hasSeenInitialReady.current = true
    prevReadyIds.current = new Set(readyOrders.map((o) => o.id))
  }, [orders])

  const handleServit = useCallback(
    (order: Order): void => {
      if (user == null) return
      void advance(order.id, 'ready', { status: 'served', served_by: user.id })
    },
    [user, advance],
  )

  async function handlePay(method: PaymentMethod, amount: number, tips: number): Promise<void> {
    if (payOrder == null || user == null) return
    // Cale de bani: NU închidem optimist modalul. Așteptăm rezultatul și
    // închidem doar la succes; la refuz (rol/gate/rețea) ținem modalul deschis
    // și anunțăm ospătarul în loc să-i lăsăm impresia că plata a trecut.
    const ok = await advance(payOrder.id, 'served', {
      status: 'paid',
      paid_by: user.id,
      payment_method: method,
      paid_amount: amount,
      tips_amount: tips,
    })
    if (ok) {
      setPayOrder(null)
    } else {
      toast.error('Plata nu a fost înregistrată. Verifică și reîncearcă.')
    }
  }

  // Plan 1/2: închidere NON-fiscală (served → closed). Fără sumă, fără metodă
  // de plată — clientul plătește la casa de marcat existentă a localului.
  const handleCloseOrder = useCallback(
    (order: Order): void => {
      if (user == null) return
      void advance(order.id, 'served', { status: 'closed' })
    },
    [user, advance],
  )

  // OPT-8: memoizate — byStatus e stabil (useCallback pe [orders]) și listele
  // își schimbă identitatea doar când chiar se schimbă comenzile.
  const readyOrders = useMemo(() => byStatus(['ready']), [byStatus])
  const openOrders = useMemo(
    () => byStatus(['new', 'confirmed', 'preparing', 'ready', 'served']),
    [byStatus],
  )

  // Mesele afișate în panoul „Stadiu mese": dacă ospătarul are mese alocate,
  // doar ale lui; altfel toate (consistent cu filtrarea comenzilor de mai sus).
  const boardTables = useMemo(
    () =>
      assignedTableIds instanceof Set
        ? tables.filter((t) => assignedTableIds.has(t.id))
        : tables,
    [tables, assignedTableIds],
  )
  // „Adaugă la masă" din panou → deschide „Comandă nouă" pre-selectată pe masa
  // aia (o rundă nouă pe aceeași masă). tableId null (Fără masă) = flux normal.
  const handleAddToTable = useCallback((tableId: string | null) => {
    setEntryTableId(tableId)
    setShowEntry(true)
  }, [])

  // Textul stării de conexiune — expus și non-vizual (aria-label + role=status),
  // nu doar prin culoare + title (title nu apare la touch, mobilul e cazul principal).
  const connectionLabel =
    connectionStatus === 'connected'
      ? 'Live conectat'
      : connectionStatus === 'connecting'
        ? 'Se conectează…'
        : 'Deconectat — se face refresh automat la 30s'

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
          padding: '8px 16px',
          minHeight: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          // La lățimi mici (ex. 375px) grupul de acțiuni trece pe rândul lui,
          // în loc să se suprapună peste titlu.
          flexWrap: 'wrap',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            // `flex: 1 1 220px` → titlul ocupă rândul întâi și forțează wrap-ul
            // grupului de butoane sub el când nu mai încape.
            flex: '1 1 220px',
            minWidth: 0,
          }}
        >
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
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
                minHeight: 44,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name="arrowLeft" size={14} />
              Dashboard
            </button>
          )}
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 18,
                  fontWeight: 700,
                  color: D.t1,
                  whiteSpace: 'nowrap',
                  // Titlul se scurtează cu „…" în loc să treacă peste butoane.
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {isAdminRole ? 'Comenzi live' : 'Ospătar'}
              </span>
              <span
                role="status"
                aria-label={connectionLabel}
                title={connectionLabel}
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
            {/* Subtitlu: numele restaurantului + context — pe un singur rând, cu „…" la depășire */}
            {assignedTableIds instanceof Set ? (
              <div
                style={{
                  fontSize: 11,
                  color: D.gold,
                  marginTop: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                <Icon name="table" size={12} />
                {assignedTableIds.size}{' '}
                {assignedTableIds.size === 1 ? 'masă alocată' : 'mese alocate'} · Comenzile tale
              </div>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: D.t2,
                  marginTop: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {restaurantName.length > 0
                  ? restaurantName
                  : isAdminRole
                    ? 'Vizualizare admin · vezi tot live'
                    : ''}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            // Când grupul ajunge pe rândul lui (wrap la 375px), butoanele înseși
            // pot da wrap și se aliniază la dreapta, fără să se calce între ele.
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          {/* Restaurant selector — only visible for multi-restaurant users */}
          {memberships.length > 1 && (
            <select
              value={restaurantId ?? ''}
              onChange={(e) => setActive(e.target.value)}
              aria-label="Selectează restaurantul activ"
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
                // Aliniat cu ținta de atingere de 44px a butoanelor din grup.
                flexShrink: 0,
                minHeight: 44,
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
              justifyContent: 'center',
              gap: 5,
              // Nu se comprimă sub ținta de atingere de 44px.
              flexShrink: 0,
              minHeight: 44,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="users" size={15} />
            Manual
          </button>
          <button
            onClick={() => {
              // „Comandă nouă" din header = flux normal (alegi masa în WaiterEntry).
              setEntryTableId(null)
              setShowEntry(true)
            }}
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              flexShrink: 0,
              minHeight: 44,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="plus" size={16} />
            Comandă nouă
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name={isOffline ? 'wifi' : 'refresh'} size={14} />
            {isOffline
              ? 'Mod Offline — Comenzile se salvează local (se vor trimite când revine conexiunea).'
              : 'Conexiune restabilită — Se sincronizează comenzile...'}
          </span>
          {pendingSyncCount > 0 && (
            <span style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: 12 }}>
              {pendingSyncCount}{' '}
              {pendingSyncCount === 1 ? 'comandă în așteptare' : 'comenzi în așteptare'}
            </span>
          )}
        </div>
      )}

      {/* Comandă offline pierdută (respinsă definitiv de server) — trebuie reintrodusă */}
      {droppedOrderReason != null && (
        <div
          style={{
            background: D.red,
            color: '#fff',
            padding: '8px 24px',
            fontSize: 13,
            fontFamily: 'DM Sans, sans-serif',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={14} />O comandă offline nu a putut fi trimisă și a fost
            anulată ({droppedOrderReason}). Reintrodu-o manual.
          </span>
          <button
            onClick={() => setDroppedOrderReason(null)}
            aria-label="Închide avertismentul"
            style={{
              background: 'rgba(0,0,0,0.2)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              minWidth: 44,
              height: 32,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
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
        {/* Planul restaurantului nu s-a putut citi: finalizarea comenzilor
            (Plată / Închide) e ascunsă până la un reload reușit (DS-1). */}
        {paymentsEnabled === null && !restaurantFeatures.loading && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 10,
              background: D.s2,
              border: `1px solid ${D.border}`,
              color: D.t2,
              fontSize: 13,
            }}
          >
            <span>Nu am putut încărca planul restaurantului — plata și închiderea comenzilor sunt indisponibile.</span>
            <button
              type="button"
              onClick={() => void restaurantFeatures.reload()}
              style={{
                background: D.gold,
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Reîncearcă
            </button>
          </div>
        )}
        {/* Comutator vedere — doar pe Pro (Fiscalizare): Listă comenzi ↔ Stadiu mese */}
        {paymentsEnabled === true && (
          <div
            role="tablist"
            aria-label="Vedere comenzi"
            style={{
              display: 'inline-flex',
              gap: 4,
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 10,
              padding: 4,
              alignSelf: 'flex-start',
            }}
          >
            {(
              [
                ['lista', 'Listă comenzi', 'orders'],
                ['mese', 'Stadiu mese', 'table'],
              ] as const
            ).map(([v, label, icon]) => {
              const active = view === v
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(v)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    minHeight: 40,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 600,
                    background: active ? D.gold : 'transparent',
                    color: active ? D.bg : D.t2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Icon name={icon} size={15} color={active ? D.bg : D.t2} />
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {/* Loyalty v1 (mig 226): răscumpărare recompensă pe codul cardului.
            RPC-ul e gate-uit server-side (modul + plan + program activ) —
            butonul e mereu vizibil, răspunsul spune clar dacă nu e cazul. */}
        {restaurantId != null && <LoyaltyRedeem restaurantId={restaurantId} />}

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
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="calendar" size={14} />
              Rezervări azi ({activeReservations.length})
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
                            : 'ÎN AȘTEPTARE'}
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
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <Icon name="leaf" size={13} />
                        Cere zona: {r.requested_zone}
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
                                  toast.error(e instanceof Error ? e.message : 'Eroare'),
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
                                  toast.error(e instanceof Error ? e.message : 'Eroare'),
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
        {/* Non-Pro (fără toggle) → mereu lista, ca ospătarul să nu rămână blocat
            pe „Stadiu mese" dacă restaurantul activ trece pe un plan sub Pro. */}
        {view === 'lista' || paymentsEnabled !== true ? (
          <>
        {readyOrders.length > 0 && (
          <div>
            <SectionHeading label="Gata de servit" count={readyOrders.length} color={D.green} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {readyOrders.map((order, i) => (
                <RevealItem key={order.id} delay={Math.min(i, 5) * 40}>
                  <div
                    className="hover-lift"
                    style={{
                      background: STATUS_META.ready.bg,
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
                        {order.table?.name ?? 'Fără masă'}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: D.t2,
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {order.order_items.map((it) => it.product_name_snapshot).join(', ')}
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
                        {order.total.toFixed(2)} lei
                      </div>
                    </div>
                    <button
                      className="pressable"
                      onClick={() => handleServit(order)}
                      style={{
                        background: D.green,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 10,
                        padding: '12px 22px',
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        minHeight: 46,
                      }}
                    >
                      Servit
                    </button>
                  </div>
                </RevealItem>
              ))}
            </div>
          </div>
        )}

        {/* Section 0 - Waiter Calls */}
        {waiterCalls.length > 0 && (
          <div>
            <SectionHeading label="Apeluri ospătar" count={waiterCalls.length} color={D.amber} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* „Cere nota" înaintea chemărilor simple — clientul care vrea
                  să plătească e mai urgent decât cel care vrea să întrebe ceva */}
              {[...waiterCalls]
                .sort(
                  (a, b) =>
                    (b.call_type === 'bill' ? 1 : 0) - (a.call_type === 'bill' ? 1 : 0) ||
                    a.created_at.localeCompare(b.created_at),
                )
                .map((call) => (
                <div
                  key={call.id}
                  className="hover-lift"
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
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Icon
                        name={call.call_type === 'bill' ? 'receipt' : 'bell'}
                        size={16}
                        color={D.amber}
                        label={call.call_type === 'bill' ? 'Cere nota' : 'Apel ospătar'}
                      />
                      {call.table?.name ?? 'Masă necunoscută'}
                      {call.call_type === 'bill' && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            background: 'rgba(232,160,32,0.18)',
                            color: D.amber,
                            borderRadius: 5,
                            padding: '2px 8px',
                            verticalAlign: 'middle',
                          }}
                        >
                          CERE NOTA
                          {call.tip_amount != null && Number(call.tip_amount) > 0 && (
                            <>
                              {' '}
                              · bacșiș propus {Number(call.tip_amount).toFixed(2)} lei
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: D.t2, marginTop: 2 }}>
                      {new Date(call.created_at).toLocaleTimeString('ro-RO', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <button
                    className="pressable"
                    onClick={() => handleResolveCall(call.id)}
                    style={{
                      background: D.amber,
                      color: '#000',
                      border: 'none',
                      borderRadius: 10,
                      padding: '12px 22px',
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      minHeight: 46,
                    }}
                  >
                    Preiau
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 2 — All open orders */}
        <div>
          <SectionHeading
            label="Toate comenzile deschise"
            count={openOrders.length}
            color={D.t2}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Grupare pe masă: ospătarul gândește în mese, nu în comenzi.
                Fără refactor — doar render-ul e grupat; cardurile rămân identice. */}
            {Array.from(
              openOrders.reduce((m, o) => {
                const key = o.table?.name ?? 'Fără masă'
                const arr = m.get(key) ?? []
                arr.push(o)
                m.set(key, arr)
                return m
              }, new Map<string, Order[]>()),
            ).map(([tableName, tableOrders]) => (
              <div key={tableName}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Fraunces, Georgia, serif',
                      fontSize: 18,
                      fontWeight: 700,
                      color: D.t1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <Icon name="table" size={17} color={D.t2} />
                    {tableName}
                  </span>
                  <span style={{ fontSize: 12, color: D.t2 }}>
                    {tableOrders.length === 1 ? '1 comandă' : `${tableOrders.length} comenzi`}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tableOrders.map((order) => (
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
                </div>
              </div>
            ))}
            {openOrders.length === 0 && (
              <EmptyState icon="utensils" title="Nicio comandă deschisă" />
            )}
          </div>
        </div>
          </>
        ) : (
          <Suspense fallback={null}>
          <TableStatusBoard
            tables={boardTables}
            orders={openOrders}
            waiterCalls={waiterCalls}
            floorLayout={floorLayout}
            onAddToTable={handleAddToTable}
            renderOrderCard={(order) => (
              <OrderCard
                order={order}
                onPayOpen={setPayOrder}
                onSplitOpen={openSplitBill}
                onEdit={setEditOrder}
                onCancel={setCancelOrder}
                onAudit={isAdminRole ? setAuditOrder : undefined}
                paymentsEnabled={paymentsEnabled}
                onCloseOrder={handleCloseOrder}
              />
            )}
          />
          </Suspense>
        )}
      </div>

      {payOrder != null &&
        user != null &&
        paymentsEnabled === true &&
        (() => {
          // Live lookup: dacă orders au fost actualizate (ex: discount aplicat),
          // PayModal afișează versiunea curentă, nu cea închisă în payOrder.
          const live = orders.find((o) => o.id === payOrder.id) ?? payOrder
          return (
            <PayModal
              order={live}
              alreadyPaid={payOrderPaid}
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
                  // P1 fix: aplicăm SUMA fixă calculată server-side (computed_discount), nu
                  // procentul brut. Pentru reguli scope category/product, un discount_type
                  // 'percent' ar fi aplicat de _refresh_order_totals pe TOT subtotalul comenzii
                  // (supra-reducere). computed_discount e deja reducerea corectă pe subtotalul
                  // aplicabil (orice scope/tip) → o aplicăm ca 'amount'.
                  await applyOrderDiscount(
                    live.id,
                    'amount',
                    happyHourSugg.computed_discount,
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
            <Suspense fallback={null}>
              <DiscountModal
                order={target}
                onClose={() => setDiscountOrderId(null)}
                onApplied={() => {
                  // Realtime din useOrders va aduce update-ul; nu mai trebuie să facem nimic.
                  // Lăsăm DiscountModal să se închidă singur prin onClose.
                }}
              />
            </Suspense>
          )
        })()}

      {/* Split Bill Modal */}
      {splitOrder != null && paymentsEnabled === true && (
        <div
          className="animate-backdrop"
          onClick={() => setSplitOrder(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: 16,
          }}
        >
          <div
            className="animate-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: D.s2,
              border: '1px solid ' + D.s3,
              borderRadius: 16,
              padding: 28,
              width: 400,
              maxWidth: '100%',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
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
              Plată parțială
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

            {/* „Rămas" e mereu vizibil (egal cu totalul când nu există plăți) —
                e exact informația de care are nevoie ospătarul ca să împartă nota. */}
            <div style={{ background: D.s3, borderRadius: 8, padding: 12 }}>
              {splitPayments.length > 0 && (
                <>
                  <div style={{ fontSize: 12, color: D.t2, marginBottom: 8 }}>
                    Plăți înregistrate:
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
                        {p.method === 'cash' ? 'Cash' : p.method === 'card_pos' ? 'Card' : p.method === 'meal_voucher' ? 'Tichete de masă' : 'Altul'}
                      </span>
                      <span style={{ color: D.green }}>{p.amount.toFixed(2)} lei</span>
                    </div>
                  ))}
                </>
              )}
              <div
                style={{
                  borderTop: splitPayments.length > 0 ? '1px solid ' + D.border : 'none',
                  marginTop: splitPayments.length > 0 ? 8 : 0,
                  paddingTop: splitPayments.length > 0 ? 8 : 0,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <span style={{ color: D.t2 }}>Rămas:</span>
                <span style={{ color: D.t1 }}>
                  {Math.max(
                    0,
                    splitOrder.total - splitPayments.reduce((s, p) => s + p.amount, 0),
                  ).toFixed(2)}{' '}
                  lei
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {(['cash', 'card_pos', 'meal_voucher', 'other'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  className="pressable"
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
                  {m === 'cash' ? 'Cash' : m === 'card_pos' ? 'Card' : m === 'meal_voucher' ? 'Tichete' : 'Altul'}
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
              className="pressable"
              onClick={() => {
                void handlePartialPay()
              }}
              disabled={splitLoading || !splitAmount}
              style={{
                background: D.green,
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '14px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 15,
                fontWeight: 700,
                cursor: splitLoading || !splitAmount ? 'not-allowed' : 'pointer',
                opacity: splitLoading || !splitAmount ? 0.6 : 1,
                minHeight: 48,
              }}
            >
              {splitLoading ? 'Se procesează...' : 'Adaugă plata'}
            </button>
            <button
              className="pressable"
              onClick={() => setSplitOrder(null)}
              style={{
                background: 'transparent',
                color: D.t2,
                border: '1px solid ' + D.s3,
                borderRadius: 10,
                padding: '11px 0',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Închide
            </button>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
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
          onConfirm={async (reason) => {
            const ok = await advance(cancelOrder.id, cancelOrder.status, {
              status: 'cancelled',
              cancel_reason: reason,
            })
            if (ok) setCancelOrder(null)
            return ok
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
      </Suspense>

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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="clock" size={14} color={D.amber} />
              <span>
                Comandă salvată local <strong>#{lastManualOrder.shortId}</strong> — va fi trimisă
                când revine conexiunea
              </span>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={14} color={D.green} />
              <span>
                Comanda <strong>#{lastManualOrder.shortId}</strong> trimisă
              </span>
            </span>
          )}
          <div style={{ fontSize: '0.72rem', color: D.t2, marginTop: 3 }}>
            Click pentru a închide
          </div>
        </div>
      )}

      {showEntry && restaurantId != null && user != null && (
        <WaiterEntry
          restaurantId={restaurantId}
          initialTableId={entryTableId}
          onClose={() => {
            setShowEntry(false)
            setEntryTableId(null)
          }}
          onOrderCreated={() => {
            setShowEntry(false)
            setEntryTableId(null)
          }}
        />
      )}
    </div>
  )
}

// ── Loyalty v1 (mig 226): răscumpărare recompensă pe codul cardului ─────────
// Clientul își arată codul de 6 caractere de pe cardul de puncte; ospătarul
// îl introduce aici. RPC-ul redeem_loyalty_reward e gate-uit server-side
// (is_member + modul + plan + program activ) și scade pragul atomic.
function LoyaltyRedeem({ restaurantId }: { restaurantId: string }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function doRedeem(): Promise<void> {
    if (busy || code.trim().length < 4) return
    setBusy(true)
    setResult(null)
    try {
      const r = await redeemLoyaltyReward(restaurantId, code)
      if (r.ok) {
        setResult({
          ok: true,
          text: `Recompensă: ${r.reward_description}. Puncte rămase: ${r.points_left ?? 0}.`,
        })
        setCode('')
      } else if (r.reason === 'not_enough_points') {
        setResult({
          ok: false,
          text: `Puncte insuficiente: ${r.points ?? 0} din ${r.threshold ?? '—'} necesare.`,
        })
      } else if (r.reason === 'not_found') {
        setResult({ ok: false, text: 'Cod negăsit — verifică-l cu clientul.' })
      } else if (r.reason === 'program_inactive') {
        setResult({ ok: false, text: 'Programul de fidelizare nu e activ.' })
      } else {
        setResult({ ok: false, text: 'Nu am putut verifica codul. Încearcă din nou.' })
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Eroare' })
    }
    setBusy(false)
  }

  return (
    <div style={{ alignSelf: 'flex-start' }}>
      <button
        onClick={() => {
          setOpen((v) => !v)
          setResult(null)
        }}
        className="pressable"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 40,
          padding: '0 14px',
          borderRadius: 10,
          border: `1px solid ${D.border}`,
          background: D.s2,
          color: D.t2,
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Icon name="star" size={15} color={D.gold} />
        Fidelizare — cod client
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            padding: '12px 14px',
            background: D.s2,
            border: `1px solid ${D.border}`,
            borderRadius: 12,
            maxWidth: 380,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: A1B2C3"
              maxLength={6}
              aria-label="Codul de fidelizare al clientului"
              style={{
                flex: 1,
                minHeight: 40,
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${D.border}`,
                background: D.s3,
                color: D.t1,
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 14,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => void doRedeem()}
              disabled={busy || code.trim().length < 4}
              className="pressable"
              style={{
                minHeight: 40,
                padding: '0 16px',
                borderRadius: 8,
                border: 'none',
                background: D.gold,
                color: '#000',
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                opacity: busy || code.trim().length < 4 ? 0.6 : 1,
              }}
            >
              {busy ? 'Se verifică…' : 'Răscumpără'}
            </button>
          </div>
          {result && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: result.ok ? 'rgba(74,222,128,0.12)' : D.redA,
                color: result.ok ? D.green : D.red,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {result.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
