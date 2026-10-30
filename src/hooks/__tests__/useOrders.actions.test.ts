// Acțiunile rapide de pe ecranele de staff (Confirmă / În pregătire / Gata /
// Servit / Închide) prin useOrders.advance:
//   - dublu-tap: cât o acțiune e în curs pe o comandă, a doua e refuzată
//     (starea optimistă mută comanda la pasul următor, iar butonul ei arăta
//     DEJA acțiunea următoare — al doilea tap o avansa încă o dată);
//   - eroarea ajunge PE COMANDĂ, în română, și dispare singură — nu mai e un
//     banner de pagină lipicios, cu textul englezesc al serverului;
//   - rollback-ul nu se oprește la instantaneu: cere rândul REAL (de obicei
//     acțiunea e respinsă tocmai fiindcă un coleg a mutat deja comanda).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const m = vi.hoisted(() => ({
  fetchKitchenOrders: vi.fn(),
  fetchWaiterOrders: vi.fn(),
  fetchOrderById: vi.fn(),
  advanceOrderStatus: vi.fn(),
  subscribeToOrders: vi.fn(),
}))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, ...m }
})

import { useOrders, ACTION_ERROR_TTL_MS } from '../useOrders'
import { makeOrder } from '../../components/__tests__/fixtures'

async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function hint(message: string, h: string): Error {
  return Object.assign(new Error(message), { hint: h })
}

async function mountKitchen() {
  const hook = renderHook(() => useOrders('r1', 'kitchen'))
  await tick(0)
  return hook
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const fn of Object.values(m)) fn.mockReset()
  m.fetchKitchenOrders.mockResolvedValue({
    orders: [makeOrder({ id: 'A', status: 'new' }), makeOrder({ id: 'B', status: 'preparing' })],
    truncated: false,
  })
  m.subscribeToOrders.mockReturnValue({ unsubscribe: vi.fn() })
  m.fetchOrderById.mockRejectedValue(new Error('TypeError: Failed to fetch'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useOrders.advance — dublu-tap', () => {
  it('UA1 al doilea tap pe aceeași comandă, cât prima acțiune e în curs, NU mai pleacă la server', async () => {
    // Mutație: scoate garda `pendingSetRef.current.has(orderId)` → RPC-ul e
    // chemat de două ori și comanda sare DOUĂ stări (new → preparing).
    const { result } = await mountKitchen()
    let resolveRpc: (v: null) => void = () => {}
    m.advanceOrderStatus.mockImplementation(
      () =>
        new Promise<null>((r) => {
          resolveRpc = r
        }),
    )

    let first: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      first = result.current.advance('A', 'new', { status: 'confirmed' })
    })
    expect(result.current.pendingIds.has('A')).toBe(true)
    // Butonul arată acum „Marchează în pregătire" — al doilea tap al
    // dublu-tap-ului îl apasă.
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')
    let second: boolean | null = null
    await act(async () => {
      second = await result.current.advance('A', 'confirmed', { status: 'preparing' })
    })
    expect(second).toBe(false)
    expect(m.advanceOrderStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRpc(null)
      await first
    })
    expect(result.current.pendingIds.has('A')).toBe(false)
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')
  })

  it('UA2 control: după ce prima acțiune s-a terminat, următoarea pe aceeași comandă pleacă', async () => {
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockResolvedValue(null)
    await act(async () => {
      await result.current.advance('A', 'new', { status: 'confirmed' })
    })
    await act(async () => {
      await result.current.advance('A', 'confirmed', { status: 'preparing' })
    })
    expect(m.advanceOrderStatus).toHaveBeenCalledTimes(2)
  })

  it('UA3 lock-ul e PE COMANDĂ: o acțiune pe altă comandă nu e blocată', async () => {
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockImplementation(() => new Promise(() => {}))
    await act(async () => {
      void result.current.advance('A', 'new', { status: 'confirmed' })
      void result.current.advance('B', 'preparing', { status: 'ready' })
    })
    expect(m.advanceOrderStatus).toHaveBeenCalledTimes(2)
    expect([...result.current.pendingIds].sort()).toEqual(['A', 'B'])
  })
})

describe('useOrders.advance — eroarea, lângă acțiune', () => {
  it('UA4 refuzul serverului → text RO pe comandă, NU în bannerul paginii; dispare singur', async () => {
    // Mutație: vechiul `setError(e.message)` → `error` = textul englezesc al
    // serverului, `actionErrors` gol → UA4 pică.
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockRejectedValueOnce(
      hint('Order not in a preparable state (current: ready)', 'invalid_transition'),
    )
    let ok: boolean | null = null
    await act(async () => {
      ok = await result.current.advance('B', 'preparing', { status: 'ready' })
    })
    expect(ok).toBe(false)
    expect(result.current.actionErrors.B).toMatch(/s-a schimbat între timp/i)
    expect(result.current.actionErrors.B).not.toMatch(/order|state/i)
    expect(result.current.error).toBeNull()

    await tick(ACTION_ERROR_TTL_MS)
    expect(result.current.actionErrors.B).toBeUndefined()
  })

  it('UA5 rollback cu ADEVĂRUL: după refuz, comanda arată starea reală (a mutat-o un coleg)', async () => {
    // Mutație: rollback doar la instantaneu (fără fetchOrderById) → B rămâne
    // „preparing" deși colegul a marcat-o deja „ready".
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockRejectedValueOnce(
      hint('Order not in a preparable state (current: ready)', 'invalid_transition'),
    )
    m.fetchOrderById.mockResolvedValueOnce(makeOrder({ id: 'B', status: 'ready' }))
    await act(async () => {
      await result.current.advance('B', 'preparing', { status: 'ready' })
    })
    await tick(0)
    expect(m.fetchOrderById).toHaveBeenCalledWith('B')
    expect(result.current.orders.find((o) => o.id === 'B')?.status).toBe('ready')
  })

  it('UA6 fără rețea (iPhone): rollback la instantaneu + „Fără conexiune"', async () => {
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockRejectedValueOnce(new Error('TypeError: Load failed'))
    await act(async () => {
      await result.current.advance('A', 'new', { status: 'confirmed' })
    })
    await tick(0)
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('new')
    expect(result.current.actionErrors.A).toMatch(/fără conexiune/i)
  })

  it('UA7 o acțiune nouă pe comandă șterge eroarea veche', async () => {
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'))
    await act(async () => {
      await result.current.advance('A', 'new', { status: 'confirmed' })
    })
    expect(result.current.actionErrors.A).toBeDefined()
    m.advanceOrderStatus.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.advance('A', 'new', { status: 'confirmed' })
    })
    expect(result.current.actionErrors.A).toBeUndefined()
  })

  it('UA8 throwOnError (dialogurile de plată/anulare): eroarea e aruncată, nu dublată pe card', async () => {
    const { result } = await mountKitchen()
    m.advanceOrderStatus.mockRejectedValueOnce(hint('Suma nu acoperă totalul', 'underpayment'))
    let caught: unknown = null
    await act(async () => {
      caught = await result.current
        .advance('B', 'preparing', { status: 'ready' }, { throwOnError: true })
        .catch((e: unknown) => e)
    })
    expect((caught as { hint?: string } | null)?.hint).toBe('underpayment')
    expect(result.current.actionErrors.B).toBeUndefined()
    expect(result.current.error).toBeNull()
  })
})
