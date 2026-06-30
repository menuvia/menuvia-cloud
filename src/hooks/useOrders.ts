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
        setError(e instanceof Error ? e.message : 'Unknown error')
        setLoading(false)
      })
  }, [restaurantId, view])

  const channelRef = useRef<RealtimeChannel | null>(null)
  // Câte operații advance() sunt in-flight. Polling-ul nu suprascrie state-ul
  // cât timp > 0 (altfel ar reverti update-ul optimist înainte de RPC).
  const pendingAdvancesRef = useRef(0)
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    setConnectionStatus('connecting')
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
        try {
          const hydrated = await fetchOrderById(orderId)
          upsertOrder(hydrated)
        } catch {
          /* order outside SELECT access */
        }
      },
      (status) => {
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
  }, [restaurantId, upsertOrder, removeOrder])

  // Plasă de siguranță: refetch periodic chiar dacă realtime e OK.
  // Prinde scenariile când canalul a căzut tăcut (no SUBSCRIBED status) sau
  // când au apărut evenimente între unsubscribe și re-subscribe.
  // Guard-uri: (1) nu poll-uim când tab-ul e ascuns (cost inutil pe mobil),
  // (2) nu suprascriem dacă un advance() optimist e in-flight.
  useEffect(() => {
    if (!restaurantId) return
    const fetcher = view === 'kitchen' ? fetchKitchenOrders : fetchWaiterOrders
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (pendingAdvancesRef.current > 0) return
      fetcher(restaurantId)
        .then((data) => {
          // Dublu-check: dacă între timp a pornit un advance, nu suprascrie.
          if (pendingAdvancesRef.current > 0) return
          setOrders(data)
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
        const updated = await advanceOrderStatus(orderId, {
          ...payload,
          _currentStatus: currentStatus,
        })
        upsertOrder(updated)
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
