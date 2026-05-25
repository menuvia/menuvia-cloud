// src/hooks/useOrdersQuery.ts
// ─────────────────────────────────────────────────────────────────
// EXEMPLU REFACTOR: hook-ul de orders folosind TanStack Query
//
// AVANTAJE vs custom hook actual:
//   • Cache automat — nu re-fetch dacă datele sunt fresh (staleTime)
//   • Optimistic updates — UI se actualizează imediat, fără să aștepte server
//   • Auto-retry pe erori network
//   • Devtools în development (Cmd+Shift+T) — vezi exact ce queries rulează
//   • Auto-invalidation prin Supabase Realtime
//   • Loading/Error/Empty states standardizate
//
// FOLOSIRE:
//   const { data: orders, isLoading, error } = useActiveOrders(restaurantId)
//   const updateMutation = useUpdateOrderStatus()
//   updateMutation.mutate({ orderId, newStatus: 'preparing' })
// ─────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryKeys } from '../lib/queryClient'
import type { Order, OrderStatus } from '../lib/orders'

// ─────────────────────────────────────────────────────────────────
// FETCH — listă comenzi active
// ─────────────────────────────────────────────────────────────────
async function fetchActiveOrders(restaurantId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      `
      *,
      table:restaurant_tables(*),
      order_items(*),
      _created_by_profile:profiles!orders_created_by_fkey(full_name),
      _served_by_profile:profiles!orders_served_by_fkey(full_name)
    `,
    )
    .eq('restaurant_id', restaurantId)
    .in('status', ['new', 'confirmed', 'preparing', 'ready'])
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as Order[]
}

export function useActiveOrders(restaurantId: string | null) {
  const queryClient = useQueryClient()

  // Subscribe la realtime — invalidează query-ul când se schimbă orders
  useEffect(() => {
    if (!restaurantId) return

    const channel = supabase
      .channel(`orders:${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          // Realtime change → invalidează query-ul, TanStack re-fetch
          queryClient.invalidateQueries({ queryKey: queryKeys.orders(restaurantId, 'active') })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [restaurantId, queryClient])

  return useQuery({
    queryKey: restaurantId ? queryKeys.orders(restaurantId, 'active') : ['orders', 'disabled'],
    queryFn: () => fetchActiveOrders(restaurantId!),
    enabled: !!restaurantId,
  })
}

// ─────────────────────────────────────────────────────────────────
// MUTATION — schimbare status comandă cu optimistic update
// ─────────────────────────────────────────────────────────────────
async function updateOrderStatus(params: {
  orderId: string
  newStatus: OrderStatus
}): Promise<void> {
  const { error } = await supabase.rpc('update_order_status', {
    p_order_id: params.orderId,
    p_new_status: params.newStatus,
  })
  if (error) throw error
}

export function useUpdateOrderStatus(restaurantId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateOrderStatus,

    // Optimistic update — UI se actualizează imediat, înainte de răspuns server
    onMutate: async ({ orderId, newStatus }) => {
      const queryKey = queryKeys.orders(restaurantId, 'active')

      // Anulează refetches în zbor (să nu suprascrie optimistic update)
      await queryClient.cancelQueries({ queryKey })

      // Snapshot data curentă pentru rollback dacă pică server
      const previous = queryClient.getQueryData<Order[]>(queryKey)

      // Update optimist
      queryClient.setQueryData<Order[]>(queryKey, (old) =>
        old?.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
      )

      return { previous }
    },

    onError: (_err, _vars, context) => {
      // Rollback la valorile anterioare
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.orders(restaurantId, 'active'), context.previous)
      }
    },

    onSettled: () => {
      // Re-fetch pentru a fi sigur că avem state real de la server
      queryClient.invalidateQueries({ queryKey: queryKeys.orders(restaurantId, 'active') })
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// EXEMPLU FOLOSIRE ÎN COMPONENT:
//
//   function KitchenPage({ restaurantId }) {
//     const { data: orders, isLoading, error } = useActiveOrders(restaurantId)
//     const update = useUpdateOrderStatus(restaurantId)
//
//     if (isLoading) return <Spinner />
//     if (error)     return <ErrorBox message={error.message} />
//
//     return (
//       <ul>
//         {orders?.map(o => (
//           <li key={o.id}>
//             {o.id} — {o.status}
//             <button onClick={() => update.mutate({ orderId: o.id, newStatus: 'preparing' })}>
//               Începe preparat
//             </button>
//           </li>
//         ))}
//       </ul>
//     )
//   }
//
// Observă: 0 logică de fetch în component, 0 useState, 0 useEffect manual.
// Toată complexitatea (cache, retry, realtime) e încapsulată în hooks.
// ─────────────────────────────────────────────────────────────────
