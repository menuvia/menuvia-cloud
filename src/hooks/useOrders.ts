import { useState, useEffect, useCallback, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  fetchKitchenOrders,
  fetchWaiterOrders,
  fetchOrderById,
  advanceOrderStatus,
  subscribeToOrders,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type AdvanceOrderPayload,
  type RealtimeConnectionStatus,
} from '../lib/orders'

// Refetch periodic ca plasă de siguranță dacă realtime pică tăcut.
// 30s e suficient pentru un POS (comenzile apar mai devreme via realtime
// când canalul e OK; polling-ul prinde doar cazurile când realtime a căzut).
const POLLING_INTERVAL_MS = 30_000

const KITCHEN_STATUSES: OrderStatus[] = ['new', 'confirmed', 'preparing', 'ready']
const WAITER_EXCLUDED: OrderStatus[] = ['paid', 'cancelled']

function belongsInView(order: Order, view: 'kitchen' | 'waiter'): boolean {
  if (view === 'kitchen') return KITCHEN_STATUSES.includes(order.status)
  return !WAITER_EXCLUDED.includes(order.status)
}

// Reconciliere de polling (OPT-7): pentru fiecare comandă nouă, dacă cea
// veche cu același id e IDENTICĂ structural (JSON stabil — include items și
// embed-ul table), păstrăm obiectul VECHI ca referința să nu se schimbe.
// Dacă totul e identic și ordinea/lungimea coincid, întoarcem chiar array-ul
// vechi → setState devine no-op și nimic nu se re-randează.
function reconcileOrders(prev: Order[], next: Order[]): Order[] {
  const byId = new Map(prev.map((o) => [o.id, o]))
  let allSame = prev.length === next.length
  const merged = next.map((n, i) => {
    const old = byId.get(n.id)
    if (old && JSON.stringify(old) === JSON.stringify(n)) {
      if (allSame && prev[i] !== old) allSame = false
      return old
    }
    allSame = false
    return n
  })
  return allSame ? prev : merged
}

// Realtime poate livra coloanele numeric ca string — coercăm defensiv.
function rtStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function rtNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Aplică un UPDATE realtime peste comanda deja hidratată, FĂRĂ round-trip.
// Sigur doar când totalul e neschimbat: orice editare de produse trece prin
// update_order_items care recalculează totalul, deci total identic = doar
// tranziție de status/plată — câmpurile de mai jos sunt exact ce scrie
// advance_order. Toate se iau din rând (rândul realtime e complet), deci
// două evenimente rapide pe aceeași comandă converg la starea finală.
// True dacă payload-ul reprezintă o TRANZIȚIE de status/plată reală (un câmp de
// status sau un timestamp de stadiu chiar s-a schimbat). Folosit ca gardă pentru
// fast-path-ul de merge din realtime: o editare de PRODUSE cu total identic (swap
// la același preț) nu schimbă niciun câmp de status → nu e „tranziție" → refetch,
// ca să nu rămână produse STALE pe Bucătărie/Ospătar (audit comenzi, MEDIUM).
function isStatusTransition(existing: Order, row: Record<string, unknown>): boolean {
  const diff = (a: string | null, b: string | null) => (a ?? '') !== (b ?? '')
  return (
    diff(rtStr(row.status), existing.status) ||
    diff(rtStr(row.confirmed_at), existing.confirmed_at) ||
    diff(rtStr(row.preparing_at), existing.preparing_at) ||
    diff(rtStr(row.ready_at), existing.ready_at) ||
    diff(rtStr(row.served_at), existing.served_at) ||
    diff(rtStr(row.paid_at), existing.paid_at) ||
    diff(rtStr(row.cancelled_at), existing.cancelled_at) ||
    diff(rtStr(row.payment_method), existing.payment_method) ||
    (rtNum(row.paid_amount) ?? -1) !== (existing.paid_amount ?? -1)
  )
}

function mergeRealtimeOrder(existing: Order, row: Record<string, unknown>): Order {
  return {
    ...existing,
    status: (rtStr(row.status) as OrderStatus | null) ?? existing.status,
    payment_method: rtStr(row.payment_method) as PaymentMethod | null,
    paid_amount: rtNum(row.paid_amount),
    notes: rtStr(row.notes),
    cancel_reason: rtStr(row.cancel_reason),
    served_by: rtStr(row.served_by),
    paid_by: rtStr(row.paid_by),
    confirmed_at: rtStr(row.confirmed_at),
    preparing_at: rtStr(row.preparing_at),
    ready_at: rtStr(row.ready_at),
    served_at: rtStr(row.served_at),
    paid_at: rtStr(row.paid_at),
    cancelled_at: rtStr(row.cancelled_at),
  }
}

interface UseOrdersResult {
  orders: Order[]
  loading: boolean
  error: string | null
  connectionStatus: RealtimeConnectionStatus
  // Întoarce true dacă update-ul a reușit, false dacă a fost respins (rol/gate/rețea).
  // Apelanții pe căi de bani (plată) trebuie să verifice rezultatul înainte de a
  // închide optimist modalul.
  advance: (
    orderId: string,
    currentStatus: OrderStatus,
    payload: AdvanceOrderPayload,
  ) => Promise<boolean>
  byStatus: (statuses: OrderStatus[]) => Order[]
}

export function useOrders(
  restaurantId: string | null,
  view: 'kitchen' | 'waiter',
): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('connecting')

  // Snapshot pentru handler-ul realtime (nu re-abonăm canalul la fiecare
  // schimbare de listă). Poate fi cu un frame în urmă — inofensiv: merge-ul
  // ia toate câmpurile volatile din rândul evenimentului, nu din snapshot.
  const ordersRef = useRef<Order[]>([])
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  const upsertOrder = useCallback(
    (order: Order) => {
      setOrders((prev) => {
        if (!belongsInView(order, view)) return prev.filter((o) => o.id !== order.id)
        const idx = prev.findIndex((o) => o.id === order.id)
        if (idx === -1) return [order, ...prev]
        const next = [...prev]
        next[idx] = order
        return next
      })
    },
    [view],
  )

  const removeOrder = useCallback((orderId: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
  }, [])

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const fetcher = view === 'kitchen' ? fetchKitchenOrders : fetchWaiterOrders
    fetcher(restaurantId)
      .then((data) => {
        setOrders(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        // Surfacing real al erorii: Supabase aruncă uneori un obiect simplu
        // ({ message, code, ... }) care NU e instanceof Error → nu masca mesajul
        // ca „Unknown error", ci citește `.message` și din obiect.
        const msg =
          e instanceof Error
            ? e.message
            : e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : 'Unknown error'
        setError(msg)
        setLoading(false)
      })
  }, [restaurantId, view])

  const channelRef = useRef<RealtimeChannel | null>(null)
  // Câte operații advance() sunt in-flight. Polling-ul nu suprascrie state-ul
  // cât timp > 0 (altfel ar reverti update-ul optimist înainte de RPC).
  const pendingAdvancesRef = useRef(0)
  // OPT-3: statusul realtime într-un ref — polling-ul îl consultă fără să
  // re-creeze intervalul la fiecare flap de status.
  const connectionStatusRef = useRef<RealtimeConnectionStatus>('connecting')
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    setConnectionStatus('connecting')
    // Resetăm ȘI ref-ul (nu doar state-ul): la schimbarea restaurantului un
    // 'connected' vechi din ref ar face polling-ul să sară hidratarea corectă
    // și să ruleze throttled pe noul restaurant până la primul flap real.
    connectionStatusRef.current = 'connecting'
    // Timeout: dacă realtime nu raportează SUBSCRIBED în 12s, marcăm
    // disconnected (polling-ul preia datele). Evită bulina blocată pe galben.
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current)
    connectTimeoutRef.current = setTimeout(() => {
      setConnectionStatus((s) => (s === 'connecting' ? 'disconnected' : s))
    }, 12_000)

    const channel = subscribeToOrders(
      restaurantId,
      async (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'DELETE') {
          const deletedId = oldRow?.id
          if (typeof deletedId === 'string') removeOrder(deletedId)
          return
        }
        const orderId = newRow?.id
        if (typeof orderId !== 'string') return
        // UPDATE pe o comandă deja hidratată, cu total neschimbat (= doar
        // status/plată, vezi mergeRealtimeOrder) → aplicăm din payload.
        // Evită un SELECT cu join-uri per eveniment pe Bucătărie + Ospătar
        // în ora de vârf; INSERT-urile și editările de produse refetch-uiesc.
        if (eventType === 'UPDATE') {
          const existing = ordersRef.current.find((o) => o.id === orderId)
          // OPT-7: comandă ABSENTĂ din state, cu status în payload care nu
          // aparține view-ului (ex. served→paid pe Bucătărie) → zero interes,
          // sărim SELECT-ul cu join-uri. Statusul lipsă cade pe refetch.
          const newStatus = rtStr(newRow.status)
          if (!existing && newStatus !== null) {
            const phantom = { status: newStatus } as Order
            if (!belongsInView(phantom, view)) return
          }
          const newTotal = rtNum(newRow.total)
          // Fast-path DOAR pentru tranziții reale de status/plată (total neschimbat
          // ȘI un câmp de status/timestamp chiar s-a schimbat). O editare de produse
          // cu total identic cade pe refetch (altfel produse stale pe Bucătărie).
          if (
            existing &&
            newTotal !== null &&
            Math.abs(newTotal - existing.total) < 0.005 &&
            isStatusTransition(existing, newRow)
          ) {
            upsertOrder(mergeRealtimeOrder(existing, newRow))
            return
          }
        }
        try {
          const hydrated = await fetchOrderById(orderId)
          upsertOrder(hydrated)
        } catch {
          /* order outside SELECT access */
        }
      },
      (status) => {
        connectionStatusRef.current = status
        setConnectionStatus(status)
        if (status === 'connected' && connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
      },
    )
    channelRef.current = channel
    return () => {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      channelRef.current?.unsubscribe()
      channelRef.current = null
    }
    // `view` e citit în handler dar NU e dependență: re-abonarea canalului
    // realtime la fiecare comutare de view ar pierde evenimente în fereastra
    // de reconectare, degeaba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, upsertOrder, removeOrder])

  // Plasă de siguranță: refetch periodic chiar dacă realtime e OK.
  // Prinde scenariile când canalul a căzut tăcut (no SUBSCRIBED status) sau
  // când au apărut evenimente între unsubscribe și re-subscribe.
  // Guard-uri: (1) nu poll-uim când tab-ul e ascuns (cost inutil pe mobil),
  // (2) nu suprascriem dacă un advance() optimist e in-flight.
  useEffect(() => {
    if (!restaurantId) return
    const fetcher = view === 'kitchen' ? fetchKitchenOrders : fetchWaiterOrders
    // OPT-3: heartbeat, nu full-skip — cu realtime 'connected', fetch-ul
    // integral (join dublu pe toată lista) rulează doar la fiecare al 4-lea
    // tick (~120s); pe 'connecting'/'disconnected' rămâne la fiecare tick.
    // NU se sare definitiv: heartbeat-ul rar prinde căderile TĂCUTE de canal.
    let tick = 0
    const interval = setInterval(() => {
      tick += 1
      if (typeof document !== 'undefined' && document.hidden) return
      if (pendingAdvancesRef.current > 0) return
      if (connectionStatusRef.current === 'connected' && tick % 4 !== 0) return
      fetcher(restaurantId)
        .then((data) => {
          // Dublu-check: dacă între timp a pornit un advance, nu suprascrie.
          if (pendingAdvancesRef.current > 0) return
          // OPT-7: reconciliere pe id cu păstrarea REFERINȚELOR — altfel
          // fiecare heartbeat crea obiecte noi pentru comenzi neschimbate,
          // re-randând tot arborele și invalidând orice memo pe carduri.
          setOrders((prev) => reconcileOrders(prev, data))
        })
        .catch(() => {
          /* ignore — păstrăm state-ul curent */
        })
    }, POLLING_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [restaurantId, view])

  const advance = useCallback(
    async (orderId: string, currentStatus: OrderStatus, payload: AdvanceOrderPayload) => {
      let previous: Order | undefined
      setOrders((prev) => {
        previous = prev.find((o) => o.id === orderId)
        return prev.map((o) => (o.id === orderId ? { ...o, ...payload } : o))
      })
      pendingAdvancesRef.current += 1
      try {
        // OPT-5: cu realtime conectat, evenimentul UPDATE aduce rândul
        // autoritativ prin fast-path-ul de merge — refetch-ul cu join dublu
        // de după RPC e redundant. Pe connecting/disconnected hidratăm ca
        // înainte (starea optimistă ar rămâne altfel singura sursă).
        const updated = await advanceOrderStatus(
          orderId,
          { ...payload, _currentStatus: currentStatus },
          { hydrate: connectionStatusRef.current !== 'connected' },
        )
        if (updated) upsertOrder(updated)
        return true
      } catch (e: unknown) {
        if (previous !== undefined) {
          const snap = previous
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.id === orderId)
            if (idx === -1) return prev
            const next = [...prev]
            next[idx] = snap
            return next
          })
        }
        setError(e instanceof Error ? e.message : 'Failed to update order')
        return false
      } finally {
        pendingAdvancesRef.current = Math.max(0, pendingAdvancesRef.current - 1)
      }
    },
    [upsertOrder],
  )

  const byStatus = useCallback(
    (statuses: OrderStatus[]): Order[] => orders.filter((o) => statuses.includes(o.status)),
    [orders],
  )

  return { orders, loading, error, connectionStatus, advance, byStatus }
}
