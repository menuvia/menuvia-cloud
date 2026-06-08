import { supabase } from './supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'paid'
  | 'cancelled'
export type OrderSource = 'qr' | 'waiter' | 'pickup'
export type PaymentMethod = 'cash' | 'card_pos' | 'other'

export interface SelectedExtra {
  id: string
  name: string
  price: number
}

export interface SelectedModifier {
  group_id: string
  group_name: string
  option_id: string
  option_name: string
  price_delta: number
}

export interface CartItem {
  _key: string
  product_id: string
  product_name_snapshot: string
  unit_price_snapshot: number
  quantity: number
  selected_modifiers: SelectedModifier[]
  notes: string | null
  selected_extras?: SelectedExtra[]
  upsell_source?: 'extra' | 'pairing' | 'checkout_suggestion'
}

export interface RestaurantTable {
  id: string
  restaurant_id: string
  name: string
  slug: string
  seats: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string | null
  product_name_snapshot: string
  unit_price_snapshot: number
  quantity: number
  item_total: number
  selected_modifiers: SelectedModifier[]
  notes: string | null
  created_at: string
}

export interface Order {
  id: string
  restaurant_id: string
  table_id: string | null
  qr_token_id: string | null
  source: OrderSource
  status: OrderStatus
  created_by: string | null
  served_by: string | null
  paid_by: string | null
  payment_method: PaymentMethod | null
  paid_amount: number | null
  total: number
  notes: string | null
  cancel_reason: string | null
  created_at: string
  confirmed_at: string | null
  preparing_at: string | null
  ready_at: string | null
  served_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  pickup_time: string | null
  customer_name: string | null
  customer_phone: string | null
  // Discount fields (migration 031)
  discount_type: 'percent' | 'amount' | null
  discount_value: number | null
  discount_amount: number
  discount_reason: string | null
  discount_applied_by: string | null
  discount_applied_at: string | null
  table: RestaurantTable | null
  order_items: OrderItem[]
  _created_by_profile: { full_name: string | null } | null
  _served_by_profile: { full_name: string | null } | null
}

export interface OrderConfirmationPayload {
  id: string
  short_id: string
  status: 'new'
  total: number
  created_at: string
}

export interface AdvanceOrderPayload {
  status: OrderStatus
  _currentStatus?: OrderStatus
  served_by?: string
  paid_by?: string
  payment_method?: PaymentMethod
  paid_amount?: number
  tips_amount?: number
  cancel_reason?: string
}

export interface OrderRealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

const ORDER_SELECT = `
  *,
  table:tables(id, name, slug, seats),
  order_items(id, product_id, product_name_snapshot, unit_price_snapshot, quantity, item_total, selected_modifiers, notes),
  _created_by_profile:profiles!orders_created_by_fkey(full_name),
  _served_by_profile:profiles!orders_served_by_fkey(full_name)
` as const

export async function fetchKitchenOrders(restaurantId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('restaurant_id', restaurantId)
    .in('status', ['new', 'confirmed', 'preparing', 'ready'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Order[]
}

export async function fetchWaiterOrders(restaurantId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('restaurant_id', restaurantId)
    .not('status', 'in', '("paid","cancelled")')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Order[]
}

export async function fetchOrderById(orderId: string): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .single()
  if (error) throw error
  return data as unknown as Order
}

const STATUS_TO_ACTION: Record<string, string> = {
  'new→confirmed': 'confirm',
  'confirmed→preparing': 'start_preparing',
  'preparing→ready': 'mark_ready',
  'ready→served': 'mark_served',
  'served→paid': 'mark_paid',
}

export async function advanceOrderStatus(
  orderId: string,
  payload: AdvanceOrderPayload,
): Promise<Order> {
  const current = payload._currentStatus
  const target = payload.status
  let action: string
  if (target === 'cancelled') {
    action = 'cancel'
  } else if (current && STATUS_TO_ACTION[`${current}→${target}`]) {
    action = STATUS_TO_ACTION[`${current}→${target}`]
  } else {
    action =
      target === 'confirmed'
        ? 'confirm'
        : target === 'preparing'
          ? 'start_preparing'
          : target === 'ready'
            ? 'mark_ready'
            : target === 'served'
              ? 'mark_served'
              : target === 'paid'
                ? 'mark_paid'
                : target
  }
  const { error: rpcError } = await supabase.rpc('advance_order', {
    p_order_id: orderId,
    p_action: action,
    p_payment_method: payload.payment_method ?? null,
    p_paid_amount: payload.paid_amount ?? null,
    p_tips_amount: payload.tips_amount ?? null,
    p_cancel_reason: payload.cancel_reason ?? null,
  })
  if (rpcError) throw rpcError
  return fetchOrderById(orderId)
}

export interface CreateOrderArgs {
  restaurant_id: string
  source: 'qr' | 'waiter' | 'pickup'
  table_id: string | null
  qr_token_id: string | null
  notes: string | null
  cart: CartItem[]
  idempotency_key?: string
  pickup_time?: string | null
  customer_name?: string | null
  customer_phone?: string | null
}

export async function createOrder(args: CreateOrderArgs): Promise<OrderConfirmationPayload> {
  const p_items = args.cart.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    option_ids: item.selected_modifiers.map((m) => m.option_id),
    extra_ids: (item.selected_extras ?? []).map((e) => e.id),
    upsell_source: item.upsell_source ?? null,
    notes: item.notes ?? null,
  }))

  try {
    // Fast-path: dacă e evident offline și e comandă de ospătar, nu facem fetch inutil
    if (!navigator.onLine && args.source === 'waiter') {
      throw new TypeError('offline')
    }

    const { data, error } = await supabase.rpc('create_order', {
      p_restaurant_id: args.restaurant_id,
      p_source: args.source,
      p_table_id: args.table_id ?? null,
      p_qr_token_id: args.qr_token_id ?? null,
      p_notes: args.notes ?? null,
      p_items,
      p_idempotency_key: args.idempotency_key ?? null,
      p_pickup_time: args.pickup_time ?? null,
      p_customer_name: args.customer_name ?? null,
      p_customer_phone: args.customer_phone ?? null,
    })

    if (error) {
      // Eroare de rețea (edge down, timeout) → tratăm ca offline
      if (error.message?.includes('fetch') || error.code === '503') {
        throw new TypeError('network-error')
      }
      throw error // Eroare business logic → propagă normal
    }

    return data as OrderConfirmationPayload
  } catch (err) {
    // Offline sau eroare de rețea + comandă ospătar → salvăm în IndexedDB
    if (err instanceof TypeError && args.source === 'waiter') {
      console.warn(
        '[createOrder] Offline — comandă salvată local, va fi sincronizată când revine conexiunea',
      )
      const { savePendingOrder } = await import('./offlineSync')
      return savePendingOrder(args)
    }
    throw err // orice altceva (QR client offline, eroare business) → propagă
  }
}

// Edit items pe comandă non-terminală, fără plăți parțiale.
// Server validează rol + status + plăți + produs/modificatori; client doar
// trimite snapshot-ul nou complet.
// Istoric audit pentru o comandă: orders + order_items.
// Folosește view-ul public.v_audit_recent (mig 044) care joinează profile
// pentru numele actorului. RLS filtrează: owner/manager văd tot audit-ul
// restaurantelor lor; waiter vede doar propriile acțiuni.
export interface AuditEntry {
  id: number
  created_at: string
  actor_id: string | null
  actor_name: string | null
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  row_id: string
  changed_keys: string[] | null
  diff_short: Record<string, unknown> | null
}

export async function fetchOrderAuditHistory(orderId: string): Promise<AuditEntry[]> {
  // RPC SECURITY DEFINER cu role check (owner/manager only) — mig 080.
  // Pe RLS-ul direct pe audit_log filtrarea jsonb e fragilă; RPC-ul
  // joacă rolul de query unificat + permission gate.
  const { data, error } = await supabase.rpc('get_order_audit_history', {
    p_order_id: orderId,
  })
  if (error) throw error
  return (data ?? []) as unknown as AuditEntry[]
}

export interface EditOrderItemPayload {
  product_id: string
  quantity: number
  option_ids: string[]
  notes: string | null
}

export async function updateOrderItems(
  orderId: string,
  items: EditOrderItemPayload[],
): Promise<{ id: string; total: number; discount_amount: number; items_count: number }> {
  const p_items = items.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    option_ids: item.option_ids,
    notes: item.notes,
  }))
  const { data, error } = await supabase.rpc('update_order_items', {
    p_order_id: orderId,
    p_items,
  })
  if (error) throw error
  return data as { id: string; total: number; discount_amount: number; items_count: number }
}

export async function fetchTables(restaurantId: string): Promise<RestaurantTable[]> {
  const { data, error } = await supabase
    .from('tables')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as RestaurantTable[]
}

export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function subscribeToOrders(
  restaurantId: string,
  onEvent: (payload: OrderRealtimePayload) => void,
  onStatus?: (status: RealtimeConnectionStatus) => void,
) {
  return supabase
    .channel(`orders:${restaurantId}`)
    .on<RealtimePostgresChangesPayload<Record<string, unknown>>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => {
        onEvent({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          new: (payload.new ?? {}) as Record<string, unknown>,
          old: (payload.old ?? {}) as Record<string, unknown>,
        })
      },
    )
    .subscribe((status) => {
      if (!onStatus) return
      // Supabase realtime status: SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED
      if (status === 'SUBSCRIBED') onStatus('connected')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
        onStatus('disconnected')
      else onStatus('connecting')
    })
}

// ── Waiter calls ──
export interface WaiterCall {
  id: string
  restaurant_id: string
  table_id: string | null
  status: 'pending' | 'resolved'
  created_at: string
  resolved_at: string | null
  table?: { name: string } | null
}

export async function fetchWaiterCalls(restaurantId: string): Promise<WaiterCall[]> {
  const { data, error } = await supabase
    .from('waiter_calls')
    .select('*, table:tables(name)')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as WaiterCall[]
}

export async function callWaiter(qrTokenId: string): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.rpc('call_waiter', { p_qr_token_id: qrTokenId })
  if (error) throw error
  return data as { ok: boolean; message?: string }
}

export async function resolveWaiterCall(callId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_waiter_call', { p_call_id: callId })
  if (error) throw error
}

export function subscribeToWaiterCalls(restaurantId: string, onEvent: () => void) {
  return supabase
    .channel(`waiter_calls:${restaurantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'waiter_calls',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => onEvent(),
    )
    .subscribe()
}

// ── Split bill ──
export async function addPartialPayment(
  orderId: string,
  amount: number,
  method: PaymentMethod,
): Promise<{ ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }> {
  const { data, error } = await supabase.rpc('add_partial_payment', {
    p_order_id: orderId,
    p_amount: amount,
    p_method: method,
  })
  if (error) throw error
  return data as { ok: boolean; total_paid: number; remaining: number; fully_paid: boolean }
}

export async function getOrderPayments(
  orderId: string,
): Promise<Array<{ id: string; amount: number; method: string; created_at: string }>> {
  const { data, error } = await supabase.rpc('get_order_payments', { p_order_id: orderId })
  if (error) throw error
  return (data ?? []) as Array<{ id: string; amount: number; method: string; created_at: string }>
}

// ── Public order status (pentru QR tracking, clienți anon) ──
// FIX: OrderTracker/ActiveOrdersBanner se abonau la postgres_changes pe `orders`
// cu client anon, dar RLS blochează SELECT-ul → statusul nu se actualiza niciodată.
// Acum folosim un RPC SECURITY DEFINER + polling.
export interface PublicOrderStatus {
  id: string
  status: OrderStatus
  total: number
  tips_amount?: number
  paid_amount?: number
  payment_method?: string | null
  discount_amount?: number
  created_at: string
  confirmed_at?: string | null
  preparing_at?: string | null
  ready_at?: string | null
  served_at?: string | null
  paid_at?: string | null
  cancelled_at?: string | null
  fiscal_receipt_requested_at?: string | null
  restaurant?: {
    name: string
    slug: string
    google_review_url: string | null
  }
}

export async function getOrderPublicStatus(orderId: string): Promise<PublicOrderStatus | null> {
  const { data, error } = await supabase.rpc('get_order_public_status', { p_order_id: orderId })
  if (error || data == null) return null
  return data as PublicOrderStatus
}

// ── Cerere bon fiscal (migration 043) ──
// Apelat de clientul final după plată. Marchează în DB că patronul trebuie
// să tipărească bonul fiscal pentru această comandă. Notificarea ajunge la
// ospătar prin Realtime subscribe.
export async function requestFiscalReceipt(
  orderId: string,
): Promise<{ success: boolean; already_requested: boolean; requested_at: string } | null> {
  const { data, error } = await supabase.rpc('request_fiscal_receipt', { p_order_id: orderId })
  if (error || data == null) return null
  return data as { success: boolean; already_requested: boolean; requested_at: string }
}

// ── Rotate QR token (tranzacțional) ──
// FIX: vechea implementare făcea UPDATE + INSERT separat; dacă INSERT-ul pica,
// masa rămânea fără QR activ. Acum este atomic prin RPC.
export async function rotateQrToken(
  tableId: string,
): Promise<{ ok: boolean; new_token_id: string }> {
  const { data, error } = await supabase.rpc('rotate_qr_token', { p_table_id: tableId })
  if (error) throw error
  return data as { ok: boolean; new_token_id: string }
}

// ── Discount-uri pe comandă (migration 031) ──
// RPC apply_order_discount validează: doar admin/manager, comandă neplătită,
// valoare > 0, procent <= 100. Recalculează automat orders.total.
export async function applyOrderDiscount(
  orderId: string,
  type: 'percent' | 'amount',
  value: number,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('apply_order_discount', {
    p_order_id: orderId,
    p_type: type,
    p_value: value,
    p_reason: reason,
  })
  if (error) throw error
}

export async function removeOrderDiscount(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_order_discount', {
    p_order_id: orderId,
  })
  if (error) throw error
}

/**
 * Compute subtotal client-side din order_items (fallback când nu vine din server).
 * Folosit pentru afișare breakdown subtotal/discount/total în PayModal.
 */
export function orderSubtotal(order: Order): number {
  if (!order.order_items?.length) {
    // Fallback: total + discount_amount (reverse engineering)
    return order.total + (order.discount_amount || 0)
  }
  return order.order_items.reduce((sum, it) => sum + Number(it.item_total || 0), 0)
}
