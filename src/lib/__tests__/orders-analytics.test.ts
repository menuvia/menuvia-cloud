// src/lib/__tests__/orders-analytics.test.ts
// `order_placed` se emite DOAR pentru comenzile PERSONALULUI (PH-DPA-1).
//   OA1  comanda ospătarului confirmată de server → un singur `order_placed`,
//        cu localul și numerele coșului, fără nicio cheie de canal sau de PII.
//   OA2  comanda QR și cea de ridicare (ale OASPETELUI) → niciun eveniment:
//        acolo Menuvia e persoana împuternicită a restaurantului, iar DPA-ul
//        (menuvia-pack/05 §3.4 + Anexa 2) nu cunoaște PostHog. Mutația care
//        pică: garda `args.source === 'waiter'` scoasă din createOrder.
//   OA3  comanda ospătarului salvată OFFLINE nu se numără (nu e încă o comandă).
// Clichetul static pe fișierele fluxului oaspetelui e AE6 (analyticsEvents.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { rpcMock, savePendingOrderMock, trackMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  savePendingOrderMock: vi.fn(),
  trackMock: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../offlineSync', () => ({ savePendingOrder: savePendingOrderMock }))
vi.mock('../analytics', () => ({ track: trackMock }))

type OrdersModule = typeof import('../orders')
type Args = Parameters<OrdersModule['createOrder']>[0]

function makeArgs(overrides: Partial<Args> = {}): Args {
  return {
    restaurant_id: 'r1',
    source: 'qr',
    table_id: 't1',
    qr_token_id: 'tok1',
    notes: 'fără ceapă',
    cart: [
      {
        _key: 'k1',
        product_id: 'p1',
        product_name_snapshot: 'Cappuccino',
        unit_price_snapshot: 15,
        quantity: 2,
        selected_modifiers: [],
        notes: null,
      },
      {
        _key: 'k2',
        product_id: 'p2',
        product_name_snapshot: 'Croissant',
        unit_price_snapshot: 9,
        quantity: 1,
        selected_modifiers: [],
        notes: null,
      },
    ],
    session_id: 'sess-1',
    ...overrides,
  }
}

const payload = {
  id: 'o1',
  short_id: 'A1',
  status: 'new',
  total: 39,
  created_at: '2026-11-18T10:00:00Z',
}

beforeEach(() => {
  rpcMock.mockReset()
  savePendingOrderMock.mockReset()
  trackMock.mockReset()
  vi.stubGlobal('navigator', { onLine: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOrder — order_placed doar pentru personal', () => {
  it('OA1 comanda ospătarului confirmată → un order_placed fără PII și fără canal', async () => {
    const { createOrder } = await import('../orders')
    rpcMock.mockResolvedValueOnce({ data: payload, error: null })
    await createOrder(makeArgs({ source: 'waiter', qr_token_id: null, session_id: null }))
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock.mock.calls[0]).toEqual([
      'order_placed',
      { restaurant_id: 'r1', item_count: 3, line_count: 2 },
    ])
  })

  it('OA2 comanda oaspetelui (QR, ridicare) nu emite nimic', async () => {
    const { createOrder } = await import('../orders')
    // Ridicarea are forma REALĂ din PickupCheckoutSheet: fără masă, fără token QR
    // și fără sesiune — deci doar `source` o deosebește de comanda ospătarului
    // (OA1 are tot `qr_token_id: null`). Mutația care pică: garda din createOrder
    // pusă pe token (`!args.qr_token_id`) în loc de `source === 'waiter'`.
    const pickup = makeArgs({
      source: 'pickup',
      table_id: null,
      qr_token_id: null,
      session_id: null,
      notes: null,
      pickup_time: '2026-11-18T12:30:00Z',
      customer_name: 'Ana',
      customer_phone: '+40722000000',
    })
    for (const args of [makeArgs({ source: 'qr' }), pickup]) {
      rpcMock.mockResolvedValueOnce({ data: payload, error: null })
      await createOrder(args)
    }
    expect(rpcMock).toHaveBeenCalledTimes(2)
    // Controlul fixturii: a doua cerere chiar a plecat ca ridicare FĂRĂ token.
    expect(rpcMock.mock.calls[1]?.[1]).toMatchObject({
      p_source: 'pickup',
      p_qr_token_id: null,
      p_table_id: null,
    })
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('OA3 comanda ospătarului salvată offline nu se numără', async () => {
    const { createOrder } = await import('../orders')
    vi.stubGlobal('navigator', { onLine: false })
    savePendingOrderMock.mockResolvedValueOnce(undefined)
    await createOrder(makeArgs({ source: 'waiter', qr_token_id: null, session_id: null }))
    expect(savePendingOrderMock).toHaveBeenCalledTimes(1)
    expect(trackMock).not.toHaveBeenCalled()
  })
})
