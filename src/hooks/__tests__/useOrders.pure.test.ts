// Teste pe funcțiile PURE din useOrders — cel mai riscant contract frontend
// din repo (auditul aug 2026 l-a găsit complet netestat): merge-ul realtime
// decide când Bucătăria/Ospătarul primesc fast-path (fără refetch) și când NU.
// Bug-ul istoric („audit comenzi MEDIUM"): o editare de PRODUSE cu total identic
// lua fast-path-ul și lăsa produse STALE pe ecranele de staff — reparat prin
// isStatusTransition și protejat până acum doar de un comentariu.
import { describe, it, expect } from 'vitest'
import { reconcileOrders, isStatusTransition, mergeRealtimeOrder } from '../useOrders'
import type { Order } from '../../lib/orders'

// Fixture minimal dar de formă completă (Order e interfața din lib/orders).
function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    restaurant_id: 'r1',
    table_id: null,
    qr_token_id: null,
    source: 'qr',
    status: 'new',
    created_by: null,
    served_by: null,
    paid_by: null,
    payment_method: null,
    paid_amount: null,
    total: 50,
    notes: null,
    cancel_reason: null,
    created_at: '2026-08-20T10:00:00Z',
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
    ...over,
  } as Order
}

describe('isStatusTransition — garda fast-path-ului realtime', () => {
  it('tranziție reală de status → true (fast-path permis)', () => {
    const existing = makeOrder({ status: 'new' })
    expect(isStatusTransition(existing, { status: 'confirmed' })).toBe(true)
  })

  it('timestamp de stadiu nou (served_at) → true chiar cu status identic', () => {
    const existing = makeOrder({ status: 'served', served_at: null })
    expect(
      isStatusTransition(existing, { status: 'served', served_at: '2026-08-20T11:00:00Z' }),
    ).toBe(true)
  })

  it('plată înregistrată (paid_amount + payment_method) → true', () => {
    const existing = makeOrder({ status: 'served', paid_amount: null, payment_method: null })
    expect(
      isStatusTransition(existing, { status: 'served', paid_amount: 50, payment_method: 'cash' }),
    ).toBe(true)
  })

  it('REGRESIA ISTORICĂ: editare de produse cu total identic, fără câmp de status schimbat → false (refetch, nu merge)', () => {
    const existing = makeOrder({ status: 'confirmed', confirmed_at: '2026-08-20T10:05:00Z' })
    // Rândul realtime reflectă aceleași câmpuri de status — doar produsele s-au
    // schimbat (invizibil în rândul orders). Fast-path-ul aici = produse STALE.
    expect(
      isStatusTransition(existing, {
        status: 'confirmed',
        confirmed_at: '2026-08-20T10:05:00Z',
        preparing_at: null,
        ready_at: null,
        served_at: null,
        paid_at: null,
        cancelled_at: null,
        payment_method: null,
        paid_amount: null,
      }),
    ).toBe(false)
  })

  it('coerciția numeric-ca-string din realtime: paid_amount "50" ≡ 50 → false pe valori egale', () => {
    const existing = makeOrder({ status: 'served', paid_amount: 50 })
    expect(isStatusTransition(existing, { status: 'served', paid_amount: '50' })).toBe(false)
    expect(isStatusTransition(existing, { status: 'served', paid_amount: '60' })).toBe(true)
  })
})

describe('mergeRealtimeOrder — aplicarea UPDATE-ului fără round-trip', () => {
  it('scrie exact câmpurile lui advance_order și păstrează restul comenzii', () => {
    const existing = makeOrder({ status: 'served', total: 80, notes: null })
    const merged = mergeRealtimeOrder(existing, {
      status: 'paid',
      paid_at: '2026-08-20T12:00:00Z',
      paid_by: 'u9',
      payment_method: 'cash',
      paid_amount: '80', // realtime livrează numeric ca string — se coerce
    })
    expect(merged.status).toBe('paid')
    expect(merged.paid_at).toBe('2026-08-20T12:00:00Z')
    expect(merged.paid_by).toBe('u9')
    expect(merged.payment_method).toBe('cash')
    expect(merged.paid_amount).toBe(80)
    // Câmpurile neatinse de advance_order rămân din obiectul hidratat.
    expect(merged.total).toBe(80)
    expect(merged.id).toBe('o1')
  })

  it('două evenimente rapide converg la starea finală (rândul realtime e complet)', () => {
    const existing = makeOrder({ status: 'new' })
    const afterConfirm = mergeRealtimeOrder(existing, {
      status: 'confirmed',
      confirmed_at: '2026-08-20T10:05:00Z',
    })
    const afterPreparing = mergeRealtimeOrder(afterConfirm, {
      status: 'preparing',
      confirmed_at: '2026-08-20T10:05:00Z',
      preparing_at: '2026-08-20T10:06:00Z',
    })
    expect(afterPreparing.status).toBe('preparing')
    expect(afterPreparing.confirmed_at).toBe('2026-08-20T10:05:00Z')
    expect(afterPreparing.preparing_at).toBe('2026-08-20T10:06:00Z')
  })
})

describe('reconcileOrders — reconciliere de polling cu păstrarea referințelor', () => {
  it('liste identice structural → întoarce EXACT array-ul vechi (setState no-op)', () => {
    const a = makeOrder({ id: 'a' })
    const b = makeOrder({ id: 'b' })
    const prev = [a, b]
    const next = [makeOrder({ id: 'a' }), makeOrder({ id: 'b' })]
    expect(reconcileOrders(prev, next)).toBe(prev)
  })

  it('o comandă schimbată → array nou, dar comenzile neschimbate păstrează referința VECHE', () => {
    const a = makeOrder({ id: 'a' })
    const b = makeOrder({ id: 'b' })
    const prev = [a, b]
    const next = [makeOrder({ id: 'a' }), makeOrder({ id: 'b', status: 'confirmed' })]
    const out = reconcileOrders(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(a) // referință păstrată → memo-urile pe comandă nu se re-randează
    expect(out[1]).not.toBe(b)
    expect(out[1].status).toBe('confirmed')
  })

  it('comandă nouă apărută → array nou cu ordinea listei next', () => {
    const a = makeOrder({ id: 'a' })
    const out = reconcileOrders([a], [makeOrder({ id: 'nou' }), makeOrder({ id: 'a' })])
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('nou')
    expect(out[1]).toBe(a)
  })

  it('comandă dispărută (ex. cancelled filtrat server-side) → array-ul nou, scurt', () => {
    const a = makeOrder({ id: 'a' })
    const b = makeOrder({ id: 'b' })
    const out = reconcileOrders([a, b], [makeOrder({ id: 'a' })])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(a)
  })

  it('aceleași comenzi în ORDINE diferită → array nou (ordinea contează pe Bucătărie)', () => {
    const a = makeOrder({ id: 'a' })
    const b = makeOrder({ id: 'b' })
    const out = reconcileOrders([a, b], [makeOrder({ id: 'b' }), makeOrder({ id: 'a' })])
    expect(out).not.toBe([a, b])
    expect(out[0]).toBe(b)
    expect(out[1]).toBe(a)
  })
})
