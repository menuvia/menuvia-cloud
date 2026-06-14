// src/lib/__tests__/orders-create.test.ts
// Teste pentru createOrder() — calea de bani:
//   - online fast-path → supabase.rpc('create_order')
//   - eroare server (plan gate, business logic) → propagă
//   - offline + waiter → savePendingOrder, returnează payload sintetic
//   - network-error + waiter → savePendingOrder, returnează payload sintetic
//
// IMPORTANT: ../supabase și ./offlineSync sunt mock-uite — niciun test nu
// atinge rețeaua reală.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────
// Mock-uim modulul supabase ÎNAINTE să importăm orders.ts.
// vi.mock se hoistează la top — folosim vi.hoisted pentru a hoista și
// declarația mock-urilor, altfel cădem cu "Cannot access before initialization".
const { rpcMock, savePendingOrderMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  savePendingOrderMock: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

// Mock pentru offlineSync — savePendingOrder e un dynamic import în createOrder,
// dar vi.mock-ul intercepteaza și dynamic imports.
vi.mock('../offlineSync', () => ({
  savePendingOrder: savePendingOrderMock,
}))

// Import DUPĂ vi.mock — Vitest hoistează vi.mock, dar suntem expliciți.
import { createOrder } from '../orders'
import type { CreateOrderArgs, OrderConfirmationPayload, CartItem } from '../orders'

// ── Helpers ─────────────────────────────────────────────────────

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    _key: 'k1',
    product_id: 'p1',
    product_name_snapshot: 'Cappuccino',
    unit_price_snapshot: 15,
    quantity: 1,
    selected_modifiers: [],
    notes: null,
    ...overrides,
  }
}

function makeArgs(overrides: Partial<CreateOrderArgs> = {}): CreateOrderArgs {
  return {
    restaurant_id: 'r1',
    source: 'qr',
    table_id: 't1',
    qr_token_id: 'tok1',
    notes: null,
    cart: [makeCartItem()],
    session_id: 'sess-1',
    ...overrides,
  }
}

const validPayload: OrderConfirmationPayload = {
  id: 'order-uuid-1',
  short_id: 'A1B2',
  status: 'new',
  total: 15,
  created_at: '2026-06-14T10:00:00Z',
}

// ── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
  rpcMock.mockReset()
  savePendingOrderMock.mockReset()
  // Implicit, în jsdom navigator.onLine e true. Stub-ul cu false e per-test.
  vi.stubGlobal('navigator', { onLine: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ───────────────────────────────────────────────────────

describe('createOrder() — online fast-path', () => {
  it('returnează payload-ul parsat când supabase.rpc reușește', async () => {
    rpcMock.mockResolvedValueOnce({ data: validPayload, error: null })

    const result = await createOrder(makeArgs())

    expect(result).toEqual(validPayload)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith(
      'create_order',
      expect.objectContaining({
        p_restaurant_id: 'r1',
        p_source: 'qr',
        p_table_id: 't1',
        p_qr_token_id: 'tok1',
        p_session_id: 'sess-1',
        p_items: expect.any(Array),
      }),
    )
    expect(savePendingOrderMock).not.toHaveBeenCalled()
  })

  it('mapează cart-ul în p_items cu option_ids și extra_ids corect', async () => {
    rpcMock.mockResolvedValueOnce({ data: validPayload, error: null })

    const cart: CartItem[] = [
      makeCartItem({
        product_id: 'p-coffee',
        quantity: 2,
        selected_modifiers: [
          {
            group_id: 'g1',
            group_name: 'Lapte',
            option_id: 'opt-soy',
            option_name: 'Soia',
            price_delta: 2,
          },
        ],
        selected_extras: [{ id: 'extra-1', name: 'Sirop vanilie', price: 3 }],
        upsell_source: 'pairing',
        notes: 'fără zahăr',
      }),
    ]

    await createOrder(makeArgs({ cart }))

    const call = rpcMock.mock.calls[0]
    expect(call[0]).toBe('create_order')
    const params = call[1] as { p_items: unknown[] }
    expect(params.p_items).toEqual([
      {
        product_id: 'p-coffee',
        quantity: 2,
        option_ids: ['opt-soy'],
        extra_ids: ['extra-1'],
        upsell_source: 'pairing',
        notes: 'fără zahăr',
      },
    ])
  })
})

describe('createOrder() — propagare erori server (business logic)', () => {
  it('aruncă eroarea când supabase.rpc returnează error de plan gate', async () => {
    const planError = {
      message: 'Featurea X nu e disponibilă pe planul tău',
      code: 'P0001',
    }
    rpcMock.mockResolvedValueOnce({ data: null, error: planError })

    await expect(createOrder(makeArgs())).rejects.toMatchObject({
      message: 'Featurea X nu e disponibilă pe planul tău',
    })

    // Eroarea de business nu trebuie să declanșeze offline queue
    expect(savePendingOrderMock).not.toHaveBeenCalled()
  })

  it('NU declanșează savePendingOrder pe eroare business chiar dacă source=waiter', async () => {
    const businessError = {
      message: 'Produs șters între timp',
      code: 'P0002',
    }
    rpcMock.mockResolvedValueOnce({ data: null, error: businessError })

    await expect(createOrder(makeArgs({ source: 'waiter' }))).rejects.toMatchObject({
      message: 'Produs șters între timp',
    })
    expect(savePendingOrderMock).not.toHaveBeenCalled()
  })
})

describe('createOrder() — offline fast-path (waiter)', () => {
  it('când navigator.onLine === false și source=waiter, ocolește rpc și salvează local', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    const offlinePayload: OrderConfirmationPayload = {
      id: 'local-uuid',
      short_id: 'LOCAL-1234',
      status: 'new',
      total: 15,
      created_at: '2026-06-14T10:00:00Z',
    }
    savePendingOrderMock.mockResolvedValueOnce(offlinePayload)

    const result = await createOrder(makeArgs({ source: 'waiter' }))

    expect(rpcMock).not.toHaveBeenCalled()
    expect(savePendingOrderMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(offlinePayload)
    expect(result.short_id).toMatch(/^LOCAL-/)
  })

  it('când navigator.onLine === false dar source=qr, NU intră în offline fallback (propagă)', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    // Clientul QR este online by definition — dacă RPC merge, OK; dacă nu, eroarea
    // se propagă. Aici simulăm RPC reușit ca să confirmăm că fast-path-ul offline
    // NU se declanșează pentru source='qr'.
    rpcMock.mockResolvedValueOnce({ data: validPayload, error: null })

    const result = await createOrder(makeArgs({ source: 'qr' }))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(savePendingOrderMock).not.toHaveBeenCalled()
    expect(result).toEqual(validPayload)
  })
})

describe('createOrder() — network-error fallback (waiter)', () => {
  it('când rpc aruncă TypeError("network-error"), salvează local pentru waiter', async () => {
    rpcMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const offlinePayload: OrderConfirmationPayload = {
      id: 'local-uuid-2',
      short_id: 'LOCAL-5678',
      status: 'new',
      total: 15,
      created_at: '2026-06-14T10:00:00Z',
    }
    savePendingOrderMock.mockResolvedValueOnce(offlinePayload)

    const result = await createOrder(makeArgs({ source: 'waiter' }))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(savePendingOrderMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(offlinePayload)
  })

  it('când rpc returnează error cu message "fetch failed" (cod simulat), e tratat ca network', async () => {
    // În createOrder: if (error.message?.includes('fetch') || error.code === '503')
    // → aruncă TypeError('network-error') → prins de catch → savePendingOrder.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'fetch failed mid-flight', code: 'NETERR' },
    })

    const offlinePayload: OrderConfirmationPayload = {
      id: 'local-uuid-3',
      short_id: 'LOCAL-9999',
      status: 'new',
      total: 15,
      created_at: '2026-06-14T10:00:00Z',
    }
    savePendingOrderMock.mockResolvedValueOnce(offlinePayload)

    const result = await createOrder(makeArgs({ source: 'waiter' }))

    expect(savePendingOrderMock).toHaveBeenCalledTimes(1)
    expect(result.short_id).toBe('LOCAL-9999')
  })

  it('când rpc aruncă TypeError dar source=qr, propagă eroarea (clientul nu are queue)', async () => {
    rpcMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(createOrder(makeArgs({ source: 'qr' }))).rejects.toThrow(TypeError)
    expect(savePendingOrderMock).not.toHaveBeenCalled()
  })
})
