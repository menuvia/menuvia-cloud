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
} from '../lib/orders'

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
  advance: (
    orderId: string,
    currentStatus: OrderStatus,
    payload: AdvanceOrderPayload,
  ) => Promise<void>
  byStatus: (statuses: OrderStatus[]) => Order[]
}

export function useOrders(
  restaurantId: string | null,
  view: 'kitchen' | 'waiter',
): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  useEffect(() => {
    if (!restaurantId) return
    const channel = subscribeToOrders(restaurantId, async (payload) => {
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
    })
    channelRef.current = channel
    return () => {
      channelRef.current?.unsubscribe()
      channelRef.current = null
    }
  }, [restaurantId, upsertOrder, removeOrder])

  const advance = useCallback(
    async (orderId: string, currentStatus: OrderStatus, payload: AdvanceOrderPayload) => {
      let previous: Order | undefined
      setOrders((prev) => {
        previous = prev.find((o) => o.id === orderId)
        return prev.map((o) => (o.id === orderId ? { ...o, ...payload } : o))
      })
      try {
        const updated = await advanceOrderStatus(orderId, {
          ...payload,
          _currentStatus: currentStatus,
        })
        upsertOrder(updated)
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
      }
    },
    [upsertOrder],
  )

  const byStatus = useCallback(
    (statuses: OrderStatus[]): Order[] => orders.filter((o) => statuses.includes(o.status)),
    [orders],
  )

  return { orders, loading, error, advance, byStatus }
}
