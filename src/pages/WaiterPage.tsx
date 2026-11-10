// =============================================================
// Menuvia — src/pages/WaiterPage.tsx
// Waiter Dashboard (/waiter). Dark theme. No `any`.
// =============================================================

import { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useRestaurantCtx } from '../contexts/RestaurantContext'
import { SignOutButton } from '../components/SignOutButton'
import { useOrders } from '../hooks/useOrders'
import { useFeatures } from '../hooks/useFeatures'
import { hasFeature } from '../lib/features'
import { useBridgeConnected } from '../hooks/useBridgeConnected'
import { useRomaniaTodayRange } from '../hooks/useRomaniaTodayRange'
import { BridgeOfflineBanner } from '../components/BridgeOfflineBanner'
import { planSurface } from '../lib/planSurface'
import { useReservations } from '../hooks/useReservations'
import { useOfflineOrderQueue } from '../hooks/useOfflineOrderQueue'
import { useAudioUnlock } from '../hooks/useAudioUnlock'
import { createTapGuard } from '../lib/tapGuard'
import { waiterForwardStep } from '../lib/waiterSteps'
import type { Order, PaymentMethod, OrderConfirmationPayload } from '../lib/orders'
import { D } from '../lib/constants'
import { playSound } from '../lib/utils'
import { useInView, revealStyle } from '../lib/motion'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/useToast'
// OPT-10: sheet-urile/modalele condiționale sunt lazy (pattern QrMenuPage) —
// ~2.000+ LOC amânate din chunk-ul inițial al paginii de ospătar. WaiterEntry
// rămâne static (partajează ModifierSheet, folosit imediat la comanda nouă).
const EditOrderSheet = lazy(() => import('../components/EditOrderSheet'))
const CancelOrderDialog = lazy(() => import('../components/CancelOrderDialog'))
const OrderAuditSheet = lazy(() => import('../components/OrderAuditSheet'))
// Panoul „Epuizate” (mig 313): ospătarul marchează ce s-a terminat.
const StaffSoldOutSheet = lazy(() => import('../components/StaffSoldOutSheet'))
import {
  fetchWaiterCalls,
  resolveWaiterCall,
  subscribeToWaiterCalls,
  addPartialPayment,
  getOrderPayments,
  applyOrderDiscount,
  describeCancelRejection,
  voidPaymentsAndCancel,
  describePayRejection,
  closeSessionOrders,
  describeWaiterOrderSent,
  STAFF_ORDERS_FETCH_LIMIT,
  reprintKitchenTicket,
} from '../lib/orders'
import type { OrderPaymentRow } from '../lib/orders'
import type { WaiterCall } from '../lib/orders'
import { redeemLoyaltyReward } from '../lib/loyalty'
import WaiterEntry from '../components/WaiterEntry'
import { PayModal, OrderCard, type PayResult } from '../components/WaiterOrderCard'
import { ReadyOrderCard } from '../components/ReadyOrderCard'
const DiscountModal = lazy(() => import('../components/DiscountModal'))
const TableStatusBoard = lazy(() => import('../components/TableStatusBoard'))
import type { FloorLayout } from '../lib/floorPlan'
import { suggestHappyHourForOrder, type HappyHourSuggestion } from '../lib/happyHour'
import { Icon } from '../components/ui/Icon'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { sortByDue } from '../lib/pickupOrders'
// Lotul L4b: textele ecranului vin din namespace-ul `waiter` (+ `orders` pentru
// refuzul anulării, `common` pentru „Reîncearcă” / „Închide” și erori).
import { useT } from '../i18n/useT'
import { waiterNs } from '../i18n/ns/waiter'
import { ordersNs } from '../i18n/ns/orders'
import { commonNs } from '../i18n/ns/common'
import { paymentsNs } from '../i18n/ns/payments'
import { describeStaffError } from '../i18n/staffErrors'

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
          fontFamily: D.fontBody,
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
  // Hook-urile de limbă stau SUS, înaintea oricărui return timpuriu. Traducătorul
  // nu se numește `t`: pagina are deja variabile locale `t` (ora rezervării,
  // mesele din `.map`).
  const tw = useT(waiterNs)
  const to = useT(ordersNs)
  const tc = useT(commonNs)
  // `payments` (PayModal, DiscountModal, `describePayRejection`): cerut AICI,
  // sus, ca modalele de plată să nu suspende la deschidere — PayModal nu are
  // `<Suspense>` propriu, deci o primă încărcare a limbii ar fi golit pagina.
  const tpay = useT(paymentsNs)
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
  // Cât timp features se încarcă, planul e NECUNOSCUT (`null`, mai jos): nici
  // „Plată", nici „Închide comanda" — nu „fără plăți" (comentariul vechi de
  // aici descria comportamentul DINAINTE de DS-1). Gating-ul real e server-side.
  const restaurantFeatures = useFeatures(restaurantId)
  // ★ audit v3 (DS-1): TRISTATE. `null` = planul NU e cunoscut (primul load
  // sau RPC picat fără cache) — nu înseamnă „fără plăți". Înainte necunoscutul
  // cădea pe `false` → cardul arăta „Închide comanda" (închidere NEfiscală) pe
  // un restaurant Plan 3 și serverul o accepta → comandă `closed` fără bon și
  // fără venit. Acum: necunoscut = fără buton de finalizare + banner de
  // reîncercare; serverul refuză oricum close_order pe planurile fiscale (mig 263).
  // Sursa e `planSurface(...).fiscal` (= moneyTier ≥ 3, lotul P): tristate-ul
  // vine din `null`-ul suprafeței pe un plan necunoscut.
  const paymentsEnabled: boolean | null = planSurface(restaurantFeatures.features)?.fiscal ?? null
  // Lotul O3b: retipărirea tichetului de bucătărie (după o editare imprimanta
  // nu primea nimic). Doar pe planul cu tichete de bucătărie.
  const kitchenTickets = hasFeature(restaurantFeatures.features, 'kitchen_tickets')
  // Retipărirea în curs, per comandă: RPC-ul ocolește deduplicarea tichetelor
  // și inserează un rând NOU la fiecare apel, deci un dublu-tap scotea două
  // tichete (recenzia CodeRabbit pe #349). Ref-ul blochează sincron, starea
  // dezactivează butonul.
  const reprintingRef = useRef<Set<string>>(new Set())
  const [reprintingIds, setReprintingIds] = useState<ReadonlySet<string>>(() => new Set())
  const handleReprint = useCallback(
    async (o: Order) => {
      if (reprintingRef.current.has(o.id)) return
      reprintingRef.current.add(o.id)
      setReprintingIds(new Set(reprintingRef.current))
      try {
        const r = await reprintKitchenTicket(o.id)
        // „În coadă”, nu „a plecat”: RPC-ul doar pune tichetul în coada
        // bridge-ului; tipărirea se vede în Setări → Bridge.
        if (r === 'ok') toast.success(tw.t('reprint_ok'))
        else if (r === 'no_kitchen_printer') toast.warning(tw.t('reprint_noPrinter'))
        else toast.error(tw.t('reprint_err'))
      } finally {
        reprintingRef.current.delete(o.id)
        setReprintingIds(new Set(reprintingRef.current))
      }
    },
    [toast, tw],
  )
  // Handler STABIL pentru OrderCard (memo, OPT-8); undefined = fără buton.
  const onReprint = useMemo(
    () => (kitchenTickets ? (o: Order) => void handleReprint(o) : undefined),
    [kitchenTickets, handleReprint],
  )

  // ★ audit v3 (rangul 8): pe planurile fiscale comenzile se încasează normal
  // chiar dacă bridge-ul e căzut — dar atunci NU se emite niciun bon. Banner-ul
  // face zgomotul pe care tăcerea nu-l face. Interogăm doar când știm SIGUR că
  // planul e fiscal (`=== true`), niciodată pe necunoscut.
  const bridge = useBridgeConnected(restaurantId, paymentsEnabled === true)

  const [payOrder, setPayOrder] = useState<Order | null>(null)
  // Suma deja încasată în plăți parțiale pe comanda din PayModal — ca „Plata
  // integrală" să ceară DOAR restul, nu totalul (altfel server-ul respinge cu
  // overpayment și oricum ar fi dublă-încasare). Vezi mig 172.
  const [payOrderPaid, setPayOrderPaid] = useState(0)
  const [editOrder, setEditOrder] = useState<Order | null>(null)
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null)
  // Plățile deja înregistrate pe comanda din dialogul de anulare (mig 270:
  // anularea peste bani e respinsă server-side; ieșirea e storno-ul). null =
  // necunoscut → dialogul NU blochează, serverul rămâne gate-ul (tristate).
  const [cancelPayments, setCancelPayments] = useState<OrderPaymentRow[] | null>(null)
  const [auditOrder, setAuditOrder] = useState<Order | null>(null)
  const [discountOrderId, setDiscountOrderId] = useState<string | null>(null)
  const [happyHourSugg, setHappyHourSugg] = useState<HappyHourSuggestion | null>(null)
  const [showEntry, setShowEntry] = useState(false)
  const [showSoldOut, setShowSoldOut] = useState(false)
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

  useEffect(() => {
    if (cancelOrder == null) {
      setCancelPayments(null)
      return
    }
    let alive = true
    setCancelPayments(null)
    void getOrderPayments(cancelOrder.id)
      .then((ps) => {
        if (alive) setCancelPayments(ps)
      })
      .catch(() => {
        if (alive) setCancelPayments(null)
      })
    return () => {
      alive = false
    }
  }, [cancelOrder])

  // ── Coada comenzilor salvate pe telefon (offline) ─────────────
  // Se golește SINGURĂ: la montare, la revenirea în prim-plan, la `online` și
  // periodic cât nu e goală (useOfflineOrderQueue).
  const offlineQueue = useOfflineOrderQueue()
  // Sunetul (apeluri / comenzi gata) se deblochează la prima atingere — pe
  // iPhone altfel rămânea mut (lib/staffAudio.ts).
  useAudioUnlock()

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
      // În română: mesajul serverului ca atare (textul de dinainte). În altă
      // limbă un text românesc al serverului nu se arată: clasa erorii, plafonul
      // de supra-încasare (hint `overpayment`, mig 258) sau textul generic.
      const msg = err instanceof Error ? err.message : tw.t('split_errUnknown')
      toast.error(
        tw.lang === 'ro'
          ? tw.t('split_errWithMsg', { msg })
          : describeStaffError(err, tc, {
              fallback: tw.t('split_errGeneric'),
              hints: { overpayment: tw.t('split_errOverpayment'), insufficient_role: tpay.t('payRej_role') },
            }),
      )
    }
    setSplitLoading(false)
  }

  const {
    orders: allOrders,
    loading: ordersLoading,
    error,
    truncated: ordersTruncated,
    advance,
    connectionStatus,
    pendingIds,
    actionErrors,
    dismissActionError,
  } = useOrders(restaurantId, 'waiter')
  // Anti dublu-tap între carduri: „Servit" / „Închide comanda" scot cardul din
  // listă pe loc, iar cardul de dedesubt urcă sub deget (lib/tapGuard.ts).
  const tapGuard = useMemo(() => createTapGuard(), [])

  // Rezervări azi — ziua ROMÂNEASCĂ, recalculată la trecerea miezului nopții
  // (tableta lăsată deschisă peste noapte rămânea pe ziua de ieri).
  const todayRange = useRomaniaTodayRange()
  const {
    reservations,
    updateStatus: updateReservationStatus,
    seat: seatReservation,
  } = useReservations(restaurantId, todayRange)
  const activeReservations = useMemo(
    () =>
      reservations.filter(
        (r) =>
          r.status !== 'cancelled' &&
          r.status !== 'no_show' &&
          r.status !== 'completed' &&
          r.status !== 'expired',
      ),
    [reservations],
  )

  // Mese disponibile pentru alocare manuală la așezare
  const [tables, setTables] = useState<{ id: string; name: string; seats: number | null }[]>([])
  // Eroarea brută: textul se compune la randare, în limba curentă.
  const [tablesLoadError, setTablesLoadError] = useState<{ err: unknown } | null>(null)
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
          setTablesLoadError({ err: e })
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
        // Fără `>` urmat de un generic pe același rând (fals-pozitiv al
        // scanerului SK5); logica e aceeași: zero alocări → null (toate mesele).
        const ids = (data ?? []) as Array<{ table_id: string }>
        setAssignedTableIds(ids.length === 0 ? null : new Set(ids.map((r) => r.table_id)))
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
      // Pickup după ora de ridicare, restul FIFO (lib/pickupOrders).
      sortByDue(orders.filter((o) => statuses.includes(o.status))),
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
      if (user == null || !tapGuard()) return
      void advance(order.id, 'ready', { status: 'served', served_by: user.id })
    },
    [user, advance, tapGuard],
  )

  // Planul 3 (lotul O7b): pasul următor de pe card — un singur advance_order
  // per tap (lib/waiterSteps.ts). Statusul REAL al comenzii, nu unul hardcodat:
  // advanceOrderStatus derivă acțiunea (start_preparing / mark_ready /
  // mark_served) din perechea curent → țintă. Garda de dublu-tap e pe cheia
  // comenzii, cu domeniul pasului ('list' doar când pasul intră/iese din
  // `ready` și cardurile se re-așază). Refuzul rămâne contractul useOrders:
  // lacăt, rollback + refetch, mesaj în română pe card.
  const handleForwardStep = useCallback(
    (order: Order): void => {
      const step = waiterForwardStep(order)
      if (user == null || step == null || !tapGuard(order.id, step.scope)) return
      void advance(
        order.id,
        order.status,
        step.target === 'served' ? { status: 'served', served_by: user.id } : { status: step.target },
      )
    },
    [user, advance, tapGuard],
  )

  // Recenzia O7b: intrările spre plată trec prin ACEEAȘI gardă. „Servit” de pe
  // card aplică optimist `served`, iar în locul butonului de pas apar, fix sub
  // deget, „Plată integrală | Plată parțială”: al doilea tap al unui dublu-tap
  // deschidea PayModal / plata parțială cu mark_served încă în aer (la un
  // refuz, cardul revenea pe `preparing` cu modalul de plată deschis peste
  // el). Domeniul 'card': plata pe ALT card rămâne liberă.
  const handlePayOpen = useCallback(
    (order: Order): void => {
      if (tapGuard(order.id, 'card')) setPayOrder(order)
    },
    [tapGuard],
  )
  const handleSplitOpen = useCallback(
    (order: Order): void => {
      if (tapGuard(order.id, 'card')) openSplitBill(order)
    },
    [tapGuard, openSplitBill],
  )

  /** Încasează comanda din PayModal; la refuz întoarce mesajul serverului (modalul rămâne deschis). */
  async function handlePay(method: PaymentMethod, amount: number, tips: number): Promise<PayResult> {
    if (payOrder == null || user == null) return { ok: false }
    // Cale de bani: NU închidem optimist modalul. Așteptăm rezultatul și
    // închidem doar la succes; la refuz (rol/gate/rețea) ținem modalul deschis
    // și îi spunem ospătarului CE a refuzat serverul (underpayment/overpayment
    // cu sumele, metodă invalidă, rol) — în modal, singura suprafață vizibilă.
    try {
      await advance(
        payOrder.id,
        'served',
        {
          status: 'paid',
          paid_by: user.id,
          payment_method: method,
          paid_amount: amount,
          tips_amount: tips,
        },
        { throwOnError: true },
      )
      setPayOrder(null)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: describePayRejection(e, tpay) }
    }
  }

  // Plan 1/2: închidere NON-fiscală (served → closed). Fără sumă, fără metodă
  // de plată — clientul plătește la casa de marcat existentă a localului.
  const handleCloseOrder = useCallback(
    (order: Order): void => {
      if (user == null || !tapGuard()) return
      // Statusul REAL al comenzii (nu `served` hardcodat): închiderea e acum
      // posibilă din orice stare deschisă, iar serverul alege acțiunea
      // `close_order` din status-țintă.
      void advance(order.id, order.status, { status: 'closed' })
    },
    [user, advance, tapGuard],
  )

  // După „Trimite comanda" ospătarul AFLĂ unde a ajuns comanda — mai ales când
  // a rămas DOAR pe telefon (coada offline, `LOCAL-…`). Înainte foaia se
  // închidea fără niciun semn (ux-staff-order-sent-feedback).
  const handleOrderSent = useCallback(
    (confirmation: OrderConfirmationPayload): void => {
      const msg = describeWaiterOrderSent(confirmation, tw)
      if (msg.kind === 'warning') toast.warning(msg.text, 10_000)
      else toast.success(msg.text)
    },
    [toast, tw],
  )

  // „Închide masa": toate comenzile deschise ale sesiunii + sesiunea (QR).
  // Comenzile ies din listă prin realtime/poll; eroarea serverului (plan fiscal,
  // sesiune străină) se arată ca toast, nu se înghite.
  const handleCloseTable = useCallback(
    (order: Order): void => {
      const sessionId = order.session_id
      if (user == null || sessionId == null) return
      void (async () => {
        try {
          const r = await closeSessionOrders(sessionId)
          const cancelled = r.cancelled_count ?? 0
          const ordersPart = tw.tp('closeTable_orders', r.closed_count)
          toast.success(
            r.already_closed === true
              ? tw.t('closeTable_already')
              : cancelled > 0
                ? tw.t('closeTable_doneCancelled', {
                    orders: ordersPart,
                    rounds: tw.tp('closeTable_rounds', cancelled),
                  })
                : tw.t('closeTable_done', { orders: ordersPart }),
          )
        } catch (e: unknown) {
          // În română: mesajul serverului ca atare (textul de dinainte). În altă
          // limbă refuzurile de business au textul lor — altfel cădeau pe
          // „Reîncearcă", deși serverul le va respinge din nou.
          toast.error(
            describeStaffError(e, tc, {
              fallback: tw.t('closeTable_err'),
              hints:
                tw.lang === 'ro'
                  ? undefined
                  : {
                      fiscal_plan_requires_payment: tw.t('closeTable_errFiscal'),
                      cancel_over_payments: tw.t('closeTable_errPayments'),
                    },
            }),
          )
        }
      })()
    },
    [user, toast, tw, tc],
  )

  // OPT-8: memoizate — byStatus e stabil (useCallback pe [orders]) și listele
  // își schimbă identitatea doar când chiar se schimbă comenzile.
  const readyOrders = useMemo(() => byStatus(['ready']), [byStatus])
  const openOrders = useMemo(
    () => byStatus(['new', 'confirmed', 'preparing', 'ready', 'served']),
    [byStatus],
  )

  // „Închide masa" anulează rundele NEservite ale sesiunii (mig 288) — dialogul
  // de confirmare le numără. Lista trunchiată (STAFF_ORDERS_FETCH_LIMIT) nu dă
  // un număr sigur → null (necunoscut), iar dialogul folosește textul generic.
  const unservedBySession = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) {
      if (o.session_id == null) continue
      if (o.status !== 'new' && o.status !== 'confirmed' && o.status !== 'preparing') continue
      m.set(o.session_id, (m.get(o.session_id) ?? 0) + 1)
    }
    return m
  }, [orders])
  const sessionUnservedCount = useCallback(
    (order: Order): number | null => {
      if (ordersTruncated || order.session_id == null) return null
      return unservedBySession.get(order.session_id) ?? 0
    },
    [ordersTruncated, unservedBySession],
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
      ? tw.t('header_conn_connected')
      : connectionStatus === 'connecting'
        ? tw.t('header_conn_connecting')
        : tw.t('header_conn_disconnected')

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
        <span style={{ color: D.t2, fontFamily: 'DM Sans, sans-serif' }}>{tw.t('loading')}</span>
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
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon name="arrowLeft" size={14} />}
              onClick={() => {
                window.history.pushState({}, '', '/dashboard')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}
              title={tw.t('header_backTitle')}
              style={{ flexShrink: 0 }}
            >
              {tw.t('header_back')}
            </Button>
          )}
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <PageHeader
                as="h1"
                compact
                title={isAdminRole ? tw.t('header_titleAdmin') : tw.t('header_titleWaiter')}
                style={{ flex: '0 1 auto', minWidth: 0 }}
              />
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
                  boxShadow: connectionStatus === 'connected' ? `0 0 6px ${D.greenBorder}` : 'none',
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
                {tw.tp('header_assigned', assignedTableIds.size)}
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
                    ? tw.t('header_adminView')
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
              aria-label={tw.t('header_selectRestaurant')}
              style={{
                background: D.s3,
                border: `1px solid ${D.s3}`,
                borderRadius: 7,
                color: D.t1,
                padding: '6px 10px',
                fontSize: 13,
                fontFamily: D.fontBody,
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
          <Button
            variant="secondary"
            onClick={() => setShowSoldOut(true)}
            icon={<Icon name="alert" size={15} />}
            aria-label={tw.t('header_soldOutAria')}
            style={{ flexShrink: 0 }}
          >
            {tw.t('header_soldOut')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              // „Comandă nouă" din header = flux normal (alegi masa în WaiterEntry).
              setEntryTableId(null)
              setShowEntry(true)
            }}
            icon={<Icon name="plus" size={16} />}
            style={{ flexShrink: 0 }}
          >
            {tw.t('header_newOrder')}
          </Button>
          {/* Ieșirea din cont, pentru ORICE rol — ospătarul nu avea niciuna. */}
          <SignOutButton
            variant="header"
            warning={
              offlineQueue.pendingCount > 0
                ? tw.tp('header_signOutPending', offlineQueue.pendingCount)
                : undefined
            }
          />
        </div>
      </div>

      {/* Offline Sync Banner */}
      {(offlineQueue.isOffline || offlineQueue.pendingCount > 0) && (
        <div
          role="status"
          style={{
            background:
              offlineQueue.isOffline || offlineQueue.authRequired ? D.warningSolid : D.successSolid,
            color: D.onSolid,
            padding: '6px 24px',
            fontSize: 12,
            fontFamily: D.fontBody,
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name={offlineQueue.isOffline ? 'wifi' : 'refresh'} size={14} />
            {offlineQueue.isOffline
              ? tw.t('offline_mode')
              : offlineQueue.authRequired
                ? tw.t('offline_authRequired')
                : tw.t('offline_syncing')}
          </span>
          {offlineQueue.pendingCount > 0 && (
            <span style={{ background: D.scrim, padding: '2px 8px', borderRadius: 12 }}>
              {tw.tp('offline_pending', offlineQueue.pendingCount)}
            </span>
          )}
        </div>
      )}

      {/* Comandă offline pierdută (respinsă definitiv de server) — trebuie reintrodusă */}
      {offlineQueue.droppedReason != null && (
        <div
          style={{
            background: D.dangerSolid,
            color: D.onSolid,
            padding: '8px 24px',
            fontSize: 13,
            fontFamily: D.fontBody,
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={14} />
            {tw.t('offline_dropped', { reason: offlineQueue.droppedReason })}
          </span>
          <button
            onClick={offlineQueue.dismissDropped}
            aria-label={tw.t('offline_dismissAria')}
            style={{
              background: D.scrim,
              color: D.onSolid,
              border: 'none',
              borderRadius: 8,
              minWidth: 44,
              minHeight: 44,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {ordersTruncated && (
        <div
          role="status"
          style={{ background: D.amberA, color: D.amber, padding: '8px 24px', fontSize: 13 }}
        >
          {tw.t('list_truncated', { limit: STAFF_ORDERS_FETCH_LIMIT })}
        </div>
      )}

      {/* Doar erorile de ÎNCĂRCARE a listei (refuzul unei acțiuni stă pe card).
          Dispare singur la următorul fetch reușit (useOrders). */}
      {error != null && (
        <div
          role="alert"
          style={{ background: D.redA, color: D.red, padding: '8px 24px', fontSize: 13 }}
        >
          {tw.t('list_loadError')}{' '}
          <span style={{ opacity: 0.65, fontSize: 11 }}>({error})</span>
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
            <span>{tw.t('plan_loadError')}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void restaurantFeatures.reload()}
              style={{ flexShrink: 0 }}
            >
              {tc.t('retry')}
            </Button>
          </div>
        )}
        <BridgeOfflineBanner status={bridge.status} compact />
        {/* Comutator vedere — doar pe Pro (Fiscalizare): Listă comenzi ↔ Stadiu mese */}
        {paymentsEnabled === true && (
          <div
            role="tablist"
            aria-label={tw.t('view_aria')}
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
                ['lista', 'view_list', 'orders'],
                ['mese', 'view_tables', 'table'],
              ] as const
            ).map(([v, labelKey, icon]) => {
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
                    fontFamily: D.fontBody,
                    fontSize: 13,
                    fontWeight: 600,
                    background: active ? D.gold : 'transparent',
                    color: active ? D.bg : D.t2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Icon name={icon} size={15} color={active ? D.bg : D.t2} />
                  {tw.t(labelKey)}
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
                fontFamily: D.fontBody,
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
              {tw.t('resv_title', { n: activeReservations.length })}
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
                            fontFamily: D.fontDisplay,
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
                          ? tw.t('resv_seated')
                          : r.status === 'confirmed'
                            ? tw.t('resv_confirmed')
                            : tw.t('resv_pending')}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: D.t2, marginBottom: 10 }}>
                      {tw.tp('resv_party', r.party_size)}
                      {' · '}
                      {r.table?.name ? tw.t('resv_atTable', { table: r.table.name }) : tw.t('resv_noTable')}
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
                          background: D.amberA,
                          borderRadius: 6,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <Icon name="leaf" size={13} />
                        {tw.t('resv_zone', { zone: r.requested_zone })}
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
                        {tw.t('resv_special', { text: r.special_requests })}
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
                              <option value="">{tw.t('resv_pickTable')}</option>
                              {tables.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                  {t.seats ? ` (${t.seats})` : ''}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                if (!canSeat) return
                                void seatReservation(r.id, pick).catch((e) =>
                                  toast.error(describeStaffError(e, tc)),
                                )
                              }}
                              disabled={!canSeat}
                              title={canSeat ? tw.t('resv_seatTitle') : tw.t('resv_pickFirst')}
                              style={{ flex: 1 }}
                            >
                              {tw.t('resv_seat')}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                if (!confirm(tw.t('resv_noShowConfirm'))) return
                                void updateReservationStatus(r.id, 'no_show').catch((e) =>
                                  toast.error(describeStaffError(e, tc)),
                                )
                              }}
                            >
                              {tw.t('resv_noShow')}
                            </Button>
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
                  background: D.redA,
                  borderRadius: 6,
                }}
              >
                {tw.t('resv_tablesError', {
                  error: describeStaffError(tablesLoadError.err, tc, {
                    fallback: tw.t('resv_tablesErrorFallback'),
                  }),
                })}
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
            <SectionHeading label={tw.t('section_ready')} count={readyOrders.length} color={D.green} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {readyOrders.map((order, i) => (
                <RevealItem key={order.id} delay={Math.min(i, 5) * 40}>
                  <ReadyOrderCard
                    order={order}
                    onServe={handleServit}
                    pending={pendingIds.has(order.id)}
                    actionError={actionErrors[order.id] ?? null}
                    onDismissError={dismissActionError}
                  />
                </RevealItem>
              ))}
            </div>
          </div>
        )}

        {/* Section 0 - Waiter Calls */}
        {waiterCalls.length > 0 && (
          <div>
            <SectionHeading label={tw.t('section_calls')} count={waiterCalls.length} color={D.amber} />
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
                    background: D.amberA,
                    border: `1px solid ${D.amberBorder}`,
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
                        fontFamily: D.fontDisplay,
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
                        label={call.call_type === 'bill' ? tw.t('call_billAria') : tw.t('call_waiterAria')}
                      />
                      {call.table?.name ?? tw.t('call_unknownTable')}
                      {call.call_type === 'bill' && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            background: D.amberA,
                            color: D.amber,
                            borderRadius: 5,
                            padding: '2px 8px',
                            verticalAlign: 'middle',
                          }}
                        >
                          {tw.t('call_billBadge')}
                          {call.tip_amount != null && Number(call.tip_amount) > 0 && (
                            <>
                              {' '}
                              {tw.t('call_tip', { amount: Number(call.tip_amount).toFixed(2) })}
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
                  <Button
                    variant="primary"
                    className="pressable"
                    onClick={() => handleResolveCall(call.id)}
                  >
                    {tw.t('call_take')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 2 — All open orders */}
        <div>
          <SectionHeading
            label={tw.t('section_open')}
            count={openOrders.length}
            color={D.t2}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Grupare pe masă: ospătarul gândește în mese, nu în comenzi.
                Fără refactor — doar render-ul e grupat; cardurile rămân identice. */}
            {Array.from(
              openOrders.reduce((m, o) => {
                const key = o.table?.name ?? tw.t('noTable')
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
                      fontFamily: D.fontDisplay,
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
                    {tw.tp('group_orders', tableOrders.length)}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tableOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onPayOpen={handlePayOpen}
                      onSplitOpen={handleSplitOpen}
                      onEdit={setEditOrder}
                      onCancel={setCancelOrder}
                      onReprint={onReprint}
                      reprinting={reprintingIds.has(order.id)}
                      onAudit={isAdminRole ? setAuditOrder : undefined}
                      paymentsEnabled={paymentsEnabled}
                      onCloseOrder={handleCloseOrder}
                      // `ready` are deja „Servit” în „Gata de servit” (ReadyOrderCard):
                      // un al doilea buton pentru aceeași comandă ar fi dublură.
                      onAdvance={order.status === 'ready' ? undefined : handleForwardStep}
                      onCloseTable={handleCloseTable}
                      sessionUnservedCount={sessionUnservedCount(order)}
                      pending={pendingIds.has(order.id)}
                      actionError={actionErrors[order.id] ?? null}
                      onDismissError={dismissActionError}
                    />
                  ))}
                </div>
              </div>
            ))}
            {openOrders.length === 0 && (
              <EmptyState icon="utensils" title={tw.t('empty_open')} />
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
                onPayOpen={handlePayOpen}
                onSplitOpen={handleSplitOpen}
                onEdit={setEditOrder}
                onCancel={setCancelOrder}
                onReprint={onReprint}
                reprinting={reprintingIds.has(order.id)}
                onAudit={isAdminRole ? setAuditOrder : undefined}
                paymentsEnabled={paymentsEnabled}
                onCloseOrder={handleCloseOrder}
                // În „Stadiu mese” ReadyOrderCard NU se randează: fără pasul de
                // pe card, o comandă `ready` n-avea „Servit”, deci nici plată.
                onAdvance={handleForwardStep}
                onCloseTable={handleCloseTable}
                sessionUnservedCount={sessionUnservedCount(order)}
                pending={pendingIds.has(order.id)}
                actionError={actionErrors[order.id] ?? null}
                onDismissError={dismissActionError}
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
            background: D.overlay,
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
              boxShadow: D.shadowLg,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div
              style={{
                fontFamily: D.fontDisplay,
                fontSize: 20,
                fontWeight: 700,
                color: D.t1,
              }}
            >
              {tw.t('split_title')}
            </div>
            <div>
              <div style={{ color: D.t2, fontSize: 13 }}>
                {tw.t('split_table', { table: splitOrder.table?.name ?? '-' })}
              </div>
              <div
                style={{
                  fontFamily: D.fontDisplay,
                  fontSize: 28,
                  fontWeight: 900,
                  color: D.gold,
                }}
              >
                {tw.t('money', { amount: splitOrder.total.toFixed(2) })}
              </div>
            </div>

            {/* „Rămas" e mereu vizibil (egal cu totalul când nu există plăți) —
                e exact informația de care are nevoie ospătarul ca să împartă nota. */}
            <div style={{ background: D.s3, borderRadius: 8, padding: 12 }}>
              {splitPayments.length > 0 && (
                <>
                  <div style={{ fontSize: 12, color: D.t2, marginBottom: 8 }}>
                    {tw.t('split_recorded')}
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
                        {p.method === 'cash'
                          ? tw.t('split_listCash')
                          : p.method === 'card_pos'
                            ? tw.t('split_listCard')
                            : p.method === 'meal_voucher'
                              ? tw.t('split_listVoucher')
                              : tw.t('split_listOther')}
                      </span>
                      <span style={{ color: D.green }}>
                        {tw.t('money', { amount: p.amount.toFixed(2) })}
                      </span>
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
                <span style={{ color: D.t2 }}>{tw.t('split_remaining')}</span>
                <span style={{ color: D.t1 }}>
                  {tw.t('money', {
                    amount: Math.max(
                      0,
                      splitOrder.total - splitPayments.reduce((s, p) => s + p.amount, 0),
                    ).toFixed(2),
                  })}
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
                    fontFamily: D.fontBody,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {m === 'cash'
                    ? tw.t('split_btnCash')
                    : m === 'card_pos'
                      ? tw.t('split_btnCard')
                      : m === 'meal_voucher'
                        ? tw.t('split_btnVoucher')
                        : tw.t('split_btnOther')}
                </button>
              ))}
            </div>

            <div>
              <div style={{ color: D.t2, fontSize: 12, marginBottom: 6 }}>{tw.t('split_amountLabel')}</div>
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
                  fontFamily: D.fontBody,
                  fontSize: 16,
                  padding: '10px 12px',
                }}
              />
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="pressable"
              onClick={() => {
                void handlePartialPay()
              }}
              disabled={!splitAmount}
              loading={splitLoading}
            >
              {splitLoading ? tw.t('split_processing') : tw.t('split_add')}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              className="pressable"
              onClick={() => setSplitOrder(null)}
            >
              {tc.t('close')}
            </Button>
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
          payments={cancelPayments}
          onClose={() => setCancelOrder(null)}
          onVoidAndCancel={async (reason) => {
            // Storno pe TOATE plățile + anulare într-un singur RPC (o singură
            // tranzacție): nu există „stornat parțial și comanda încă deschisă".
            // Banii au fost returnați (online = refund manual în Stripe); fiecare
            // storno e auditat server-side. Cardul dispare la evenimentul
            // realtime (cancelled iese din vederea de ospătar) sau la heartbeat.
            try {
              await voidPaymentsAndCancel(cancelOrder.id, reason)
              setCancelOrder(null)
              return { ok: true }
            } catch (e) {
              void getOrderPayments(cancelOrder.id)
                .then(setCancelPayments)
                .catch(() => setCancelPayments(null))
              return { ok: false, message: describeCancelRejection(e, to) }
            }
          }}
          onConfirm={async (reason) => {
            try {
              await advance(
                cancelOrder.id,
                cancelOrder.status,
                { status: 'cancelled', cancel_reason: reason },
                { throwOnError: true },
              )
              setCancelOrder(null)
              return { ok: true }
            } catch (e) {
              // Refuzul serverului (cancel_over_payments / cancel_reason_required
              // / rol) ajunge ÎN dialog, cu textul lui, nu ca eroare generică.
              return { ok: false, message: describeCancelRejection(e, to) }
            }
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

      </Suspense>

      {showSoldOut && restaurantId != null && (
        <Suspense fallback={null}>
          <StaffSoldOutSheet restaurantId={restaurantId} onClose={() => setShowSoldOut(false)} />
        </Suspense>
      )}

      {showEntry && restaurantId != null && user != null && (
        <WaiterEntry
          restaurantId={restaurantId}
          initialTableId={entryTableId}
          onClose={() => {
            setShowEntry(false)
            setEntryTableId(null)
          }}
          onOrderCreated={(confirmation) => {
            setShowEntry(false)
            setEntryTableId(null)
            handleOrderSent(confirmation)
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
// Lotul L4b: rezultatul se ține ca DATE (nu ca text), iar mesajul se compune
// la randare, în limba curentă. Recompensa e textul localului (dată).
type RedeemResult =
  | { kind: 'ok'; reward: string; points: number }
  | { kind: 'not_enough'; points: number; threshold: number | null }
  | { kind: 'not_found' }
  | { kind: 'inactive' }
  | { kind: 'failed' }
  | { kind: 'error'; err: unknown }

function LoyaltyRedeem({ restaurantId }: { restaurantId: string }) {
  const { t } = useT(waiterNs)
  const tc = useT(commonNs)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RedeemResult | null>(null)

  async function doRedeem(): Promise<void> {
    if (busy || code.trim().length < 4) return
    setBusy(true)
    setResult(null)
    try {
      const r = await redeemLoyaltyReward(restaurantId, code)
      if (r.ok) {
        setResult({ kind: 'ok', reward: String(r.reward_description), points: r.points_left ?? 0 })
        setCode('')
      } else if (r.reason === 'not_enough_points') {
        setResult({ kind: 'not_enough', points: r.points ?? 0, threshold: r.threshold ?? null })
      } else if (r.reason === 'not_found') {
        setResult({ kind: 'not_found' })
      } else if (r.reason === 'program_inactive') {
        setResult({ kind: 'inactive' })
      } else {
        setResult({ kind: 'failed' })
      }
    } catch (e) {
      setResult({ kind: 'error', err: e })
    }
    setBusy(false)
  }

  function resultText(res: RedeemResult): string {
    switch (res.kind) {
      case 'ok':
        return t('loyalty_ok', { reward: res.reward, points: res.points })
      case 'not_enough':
        return t('loyalty_notEnough', { points: res.points, threshold: res.threshold ?? '—' })
      case 'not_found':
        return t('loyalty_notFound')
      case 'inactive':
        return t('loyalty_inactive')
      case 'failed':
        return t('loyalty_err')
      case 'error':
        return describeStaffError(res.err, tc, { fallback: t('loyalty_err') })
    }
  }

  return (
    <div style={{ alignSelf: 'flex-start' }}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen((v) => !v)
          setResult(null)
        }}
        className="pressable"
        icon={<Icon name="star" size={15} color={D.gold} />}
      >
        {t('loyalty_button')}
      </Button>
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
              placeholder={t('loyalty_placeholder')}
              maxLength={6}
              aria-label={t('loyalty_aria')}
              style={{
                flex: 1,
                minHeight: 40,
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${D.border}`,
                background: D.s3,
                color: D.t1,
                fontFamily: D.fontBody,
                fontSize: 14,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                boxSizing: 'border-box',
              }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void doRedeem()}
              disabled={code.trim().length < 4}
              loading={busy}
              className="pressable"
            >
              {busy ? t('loyalty_checking') : t('loyalty_redeem')}
            </Button>
          </div>
          {result && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: result.kind === 'ok' ? D.greenA : D.redA,
                color: result.kind === 'ok' ? D.green : D.red,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {resultText(result)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
