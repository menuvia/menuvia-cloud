// src/lib/__tests__/orders.test.ts
import { describe, it, expect } from 'vitest'
import { orderSubtotal, describeAuditEntry } from '../orders'
import type { Order, AuditEntry } from '../orders'

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

// Helper: AuditEntry minimal cu override-uri
function makeEntry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    created_at: '2026-06-09T10:00:00Z',
    actor_id: 'u1',
    actor_name: 'Maria',
    table_name: 'orders',
    operation: 'UPDATE',
    row_id: 'o1',
    changed_keys: null,
    diff_short: null,
    ...overrides,
  }
}

describe('describeAuditEntry()', () => {
  describe('tabel orders', () => {
    it('INSERT → creare comandă', () => {
      expect(describeAuditEntry(makeEntry({ operation: 'INSERT' }))).toBe('A creat comanda')
    })

    it('DELETE → ștergere comandă', () => {
      expect(describeAuditEntry(makeEntry({ operation: 'DELETE' }))).toBe('A șters comanda')
    })

    it('mapează tranzițiile de status cunoscute', () => {
      const transitions: Array<[string, string]> = [
        ['confirmed', 'A confirmat comanda'],
        ['preparing', 'A trimis la pregătire'],
        ['ready', 'A marcat ca gata'],
        ['served', 'A marcat ca servit'],
        ['paid', 'A încasat plata'],
        ['cancelled', 'A anulat comanda'],
      ]
      for (const [to, expected] of transitions) {
        const e = makeEntry({
          changed_keys: ['status'],
          diff_short: { status: { to } },
        })
        expect(describeAuditEntry(e)).toBe(expected)
      }
    })

    it('status necunoscut → fallback cu săgeată', () => {
      const e = makeEntry({ changed_keys: ['status'], diff_short: { status: { to: 'weird' } } })
      expect(describeAuditEntry(e)).toBe('Status → weird')
    })

    it('schimbare de discount → modificare reducere', () => {
      const e = makeEntry({ changed_keys: ['discount_value', 'discount_amount'] })
      expect(describeAuditEntry(e)).toBe('A modificat reducerea')
    })

    it('doar total schimbat → recalcul total', () => {
      const e = makeEntry({ changed_keys: ['total'] })
      expect(describeAuditEntry(e)).toBe('A recalculat totalul')
    })

    it('alte chei → modificare generică', () => {
      const e = makeEntry({ changed_keys: ['notes'] })
      expect(describeAuditEntry(e)).toBe('A modificat comanda')
    })
  })

  describe('tabel order_items', () => {
    it('UPDATE summary → count + total formatat', () => {
      const e = makeEntry({
        table_name: 'order_items',
        operation: 'UPDATE',
        diff_short: {
          items: { from: [1, 2, 3], to: [1, 2] },
          total: { from: 30, to: 22.5 },
        },
      })
      expect(describeAuditEntry(e)).toBe('A modificat comanda (3 → 2 produse · total 22.50 lei)')
    })

    it('UPDATE summary fără count valid → "produse"', () => {
      const e = makeEntry({
        table_name: 'order_items',
        operation: 'UPDATE',
        diff_short: { total: { to: 10 } },
      })
      expect(describeAuditEntry(e)).toBe('A modificat comanda (produse · total 10.00 lei)')
    })

    it('INSERT → adăugare produs cu nume + cantitate', () => {
      const e = makeEntry({
        table_name: 'order_items',
        operation: 'INSERT',
        diff_short: { product_name_snapshot: 'Cappuccino', quantity: 2 },
      })
      expect(describeAuditEntry(e)).toBe('A adăugat Cappuccino × 2')
    })

    it('INSERT fără date → fallback', () => {
      const e = makeEntry({ table_name: 'order_items', operation: 'INSERT', diff_short: null })
      expect(describeAuditEntry(e)).toBe('A adăugat produs × 1')
    })

    it('DELETE → ștergere produs', () => {
      const e = makeEntry({
        table_name: 'order_items',
        operation: 'DELETE',
        diff_short: { product_name_snapshot: 'Espresso', quantity: 1 },
      })
      expect(describeAuditEntry(e)).toBe('A șters Espresso × 1')
    })
  })

  it('tabel necunoscut → fallback table · operation', () => {
    const e = makeEntry({ table_name: 'payments', operation: 'INSERT' })
    expect(describeAuditEntry(e)).toBe('payments · INSERT')
  })
})
