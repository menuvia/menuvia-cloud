// Teste pe plafonul listelor de staff (audit v3 RES-36). Fără `.limit()`,
// PostgREST trunchia TĂCUT la max_rows (1000 hosted) și, cu ORDER BY ASC,
// păstra cele mai VECHI comenzi — cele noi dispăreau fără semnal. Acum: cele
// mai NOI N (cerute DESC + LIMIT N+1, întoarse ASC/FIFO) + flag `truncated`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fromMock, chain } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn()
  return { fromMock: vi.fn(() => chain), chain }
})

vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import { fetchWaiterOrders, fetchKitchenOrders, STAFF_ORDERS_FETCH_LIMIT } from '../orders'

function rowsDesc(n: number) {
  // created_at descrescător, ca răspunsul serverului la ORDER BY DESC.
  return Array.from({ length: n }, (_, i) => ({
    id: `o${n - i}`,
    created_at: new Date(Date.UTC(2026, 8, 7, 10, 0, n - i)).toISOString(),
  }))
}

describe('fetchWaiterOrders / fetchKitchenOrders — plafon determinist + truncated', () => {
  beforeEach(() => {
    fromMock.mockClear()
    for (const fn of Object.values(chain)) fn.mockClear()
  })

  it('T1 cere DESC + LIMIT N+1 (plafonul e al nostru, nu max_rows)', async () => {
    chain.limit.mockResolvedValue({ data: [], error: null })
    await fetchWaiterOrders('r1')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(STAFF_ORDERS_FETCH_LIMIT + 1)
    await fetchKitchenOrders('r1')
    expect(chain.limit).toHaveBeenLastCalledWith(STAFF_ORDERS_FETCH_LIMIT + 1)
    expect(chain.in).toHaveBeenLastCalledWith('status', ['new', 'confirmed', 'preparing', 'ready'])
  })

  it('T2 N+1 rânduri → truncated=true, cele mai NOI N, întoarse ASC', async () => {
    const n = STAFF_ORDERS_FETCH_LIMIT + 1
    chain.limit.mockResolvedValue({ data: rowsDesc(n), error: null })
    const page = await fetchWaiterOrders('r1')
    expect(page.truncated).toBe(true)
    expect(page.orders).toHaveLength(STAFF_ORDERS_FETCH_LIMIT)
    // Cea mai NOUĂ (o{n}) e prezentă, cea mai VECHE (o1) lipsește.
    expect(page.orders.some((o) => o.id === `o${n}`)).toBe(true)
    expect(page.orders.some((o) => o.id === 'o1')).toBe(false)
    // Contractul FIFO al paginilor: ASC după created_at.
    for (let i = 1; i < page.orders.length; i++) {
      expect(page.orders[i - 1].created_at <= page.orders[i].created_at).toBe(true)
    }
  })

  it('T3 ≤ N rânduri → truncated=false, toate, ASC', async () => {
    chain.limit.mockResolvedValue({ data: rowsDesc(3), error: null })
    const page = await fetchKitchenOrders('r1')
    expect(page.truncated).toBe(false)
    expect(page.orders.map((o) => o.id)).toEqual(['o1', 'o2', 'o3'])
  })

  it('T4 eroarea PostgREST devine Error real (mesajul ajunge în UI)', async () => {
    chain.limit.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchWaiterOrders('r1')).rejects.toBeInstanceOf(Error)
    await expect(fetchWaiterOrders('r1')).rejects.toThrow('boom')
  })
})
