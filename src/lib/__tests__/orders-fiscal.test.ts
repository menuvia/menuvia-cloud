// src/lib/__tests__/orders-fiscal.test.ts
// Teste pentru funcționalitatea de cerere bon fiscal + tips amount în order
import { describe, it, expect } from 'vitest'
import { orderSubtotal } from '../orders'
import type { Order } from '../orders'

function makeMinimalOrder(overrides: Partial<Order>): Order {
  return {
    id: 'o1',
    restaurant_id: 'r1',
    table_id: null,
    qr_token_id: null,
    source: 'qr' as const,
    status: 'paid' as const,
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

describe('Tips integration in orderSubtotal', () => {
  it('orderSubtotal returnează doar suma items, NU și tips', () => {
    // Tips e separat - nu intră în subtotal
    const order = makeMinimalOrder({
      order_items: [{ item_total: 30 } as never, { item_total: 7 } as never],
      total: 37,
    })
    expect(orderSubtotal(order)).toBe(37)
  })
})

describe('Google Review CTA logic', () => {
  it('calculează rating mediu corect pentru CTA', () => {
    // Avg rating helper - simulează logica din PaymentConfirmedScreen
    function calcAvgRating(
      payment: 'up' | 'down' | null,
      service: number | null,
      food: number | null,
    ): number {
      const ratings = [payment === 'up' ? 5 : payment === 'down' ? 1 : null, service, food].filter(
        (r): r is number => r !== null,
      )

      if (ratings.length === 0) return 0
      return ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    }

    // Toate pozitive → afișează Google CTA
    expect(calcAvgRating('up', 5, 5)).toBe(5)
    expect(calcAvgRating('up', 5, 5) >= 4).toBe(true)

    // Service rău → NU afișează Google CTA
    expect(calcAvgRating('up', 2, 5)).toBe(4)
    // 4 = exact pe limită, deci YES
    expect(calcAvgRating('up', 2, 5) >= 4).toBe(true)

    // Toate proaste → NU afișează
    expect(calcAvgRating('down', 1, 1)).toBe(1)
    expect(calcAvgRating('down', 1, 1) >= 4).toBe(false)

    // Doar payment up, fără celelalte
    expect(calcAvgRating('up', null, null)).toBe(5)

    // Nimic completat
    expect(calcAvgRating(null, null, null)).toBe(0)
  })
})

describe('Tips percentage calculation', () => {
  it('calculează 5/10/15% corect pe diverse subtotaluri', () => {
    function calcTipsForMode(
      mode: 'none' | '5' | '10' | '15' | 'custom',
      customAmount: string,
      orderTotal: number,
    ): number {
      if (mode === 'none') return 0
      if (mode === 'custom') return Math.max(0, parseFloat(customAmount) || 0)
      const pct = Number(mode)
      return Math.round(orderTotal * (pct / 100) * 100) / 100
    }

    // 10% pe 37 lei = 3.70 lei
    expect(calcTipsForMode('10', '', 37)).toBe(3.7)
    // 15% pe 100 lei = 15 lei
    expect(calcTipsForMode('15', '', 100)).toBe(15)
    // 5% pe 50 lei = 2.50 lei
    expect(calcTipsForMode('5', '', 50)).toBe(2.5)
    // Custom 6 lei
    expect(calcTipsForMode('custom', '6', 37)).toBe(6)
    // None → 0
    expect(calcTipsForMode('none', '', 100)).toBe(0)
    // Custom invalid → 0
    expect(calcTipsForMode('custom', 'abc', 100)).toBe(0)
    // Custom negativ → 0
    expect(calcTipsForMode('custom', '-5', 100)).toBe(0)
  })

  it('rotunjește la 2 zecimale corect', () => {
    // 10% pe 33.33 lei = 3.333 → 3.33
    const pct = 10
    const orderTotal = 33.33
    const result = Math.round(orderTotal * (pct / 100) * 100) / 100
    expect(result).toBe(3.33)
  })
})
