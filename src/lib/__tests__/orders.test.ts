// src/lib/__tests__/orders.test.ts
import { describe, it, expect } from 'vitest'
import { orderSubtotal } from '../orders'
import type { Order } from '../orders'

// Helper pentru a crea un Order minimal (multe câmpuri nu sunt necesare pentru testarea funcției)
function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 'o1',
    restaurant_id: 'r1',
    table_id: null,
    qr_token_id: null,
    source: 'qr' as const,
    status: 'new' as const,
    created_by: null,
    served_by: null,
    paid_by: null,
    payment_method: null,
    paid_amount: null,
    total: 0,
    notes: null,
    cancel_reason: null,
    created_at: '2026-05-17T12:00:00Z',
    confirmed_at: null,
    preparing_at: null,
    ready_at: null,
    served_at: null,
    paid_at: null,
    cancelled_at: null,
    pickup_time: null,
    customer_name: null,
    customer_phone: null,
    discount_type: null,
    discount_value: null,
    discount_amount: 0,
    discount_reason: null,
    discount_applied_by: null,
    discount_applied_at: null,
    table: null,
    order_items: [],
    _created_by_profile: null,
    _served_by_profile: null,
    ...overrides,
  } as Order
}

describe('orderSubtotal()', () => {
  it('calculează subtotalul din order_items când există', () => {
    const order = makeOrder({
      order_items: [
        {
          id: 'i1',
          order_id: 'o1',
          product_id: 'p1',
          product_name_snapshot: 'Cappuccino',
          unit_price_snapshot: 15,
          quantity: 2,
          item_total: 30,
          selected_modifiers: [],
          notes: null,
          created_at: '2026-05-17T12:00:00Z',
        },
        {
          id: 'i2',
          order_id: 'o1',
          product_id: 'p2',
          product_name_snapshot: 'Croissant',
          unit_price_snapshot: 8,
          quantity: 1,
          item_total: 8,
          selected_modifiers: [],
          notes: null,
          created_at: '2026-05-17T12:00:00Z',
        },
      ],
      total: 38,
    })
    expect(orderSubtotal(order)).toBe(38)
  })

  it('returnează 0 pentru comandă fără items și total 0', () => {
    const order = makeOrder({ order_items: [], total: 0, discount_amount: 0 })
    expect(orderSubtotal(order)).toBe(0)
  })

  it('reconstruiește subtotalul din total + discount când items lipsesc', () => {
    const order = makeOrder({
      order_items: [],
      total: 90,
      discount_amount: 10,
    })
    expect(orderSubtotal(order)).toBe(100)
  })

  it('gestionează discount_amount null/undefined ca 0', () => {
    const order = makeOrder({
      order_items: [],
      total: 50,
      // discount_amount default 0
    })
    expect(orderSubtotal(order)).toBe(50)
  })

  it('gestionează item_total ca string (din PG numeric)', () => {
    const order = makeOrder({
      order_items: [
        {
          id: 'i1',
          order_id: 'o1',
          product_id: 'p1',
          product_name_snapshot: 'Test',
          unit_price_snapshot: 25,
          quantity: 1,
          // PostgreSQL numeric vine câteodată ca string
          item_total: '25.50' as unknown as number,
          selected_modifiers: [],
          notes: null,
          created_at: '2026-05-17T12:00:00Z',
        },
      ],
      total: 25.5,
    })
    expect(orderSubtotal(order)).toBe(25.5)
  })

  it('însumează corect 3+ items cu prețuri zecimale', () => {
    const order = makeOrder({
      order_items: [
        { item_total: 12.5 } as never,
        { item_total: 8.75 } as never,
        { item_total: 4.25 } as never,
      ],
      total: 25.5,
    })
    expect(orderSubtotal(order)).toBe(25.5)
  })

  it('returnează 0 dacă item_total e null/undefined', () => {
    const order = makeOrder({
      order_items: [
        { item_total: null as unknown as number } as never,
        { item_total: undefined as unknown as number } as never,
      ],
      total: 0,
    })
    expect(orderSubtotal(order)).toBe(0)
  })
})
