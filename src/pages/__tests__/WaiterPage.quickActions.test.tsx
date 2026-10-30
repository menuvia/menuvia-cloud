// Ospătarul — cablajul paginii pentru acțiunile rapide și „Comandă nouă":
//   - „Servit" scoate cardul din „Gata de servit" pe loc, iar cardul de
//     dedesubt urcă sub deget: al doilea tap al unui dublu-tap servea comanda
//     VECINĂ (ux-staff-double-tap-advance);
//   - după „Trimite comanda" ospătarul AFLĂ unde a ajuns comanda, mai ales când
//     a rămas doar pe telefon (ux-staff-order-sent-feedback).
// Hook-urile de date sunt mock-uite; testul privește doar pagina.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Order, OrderConfirmationPayload } from '../../lib/orders'

const h = vi.hoisted(() => ({
  USER: { id: 'u1' },
  useAuth: vi.fn(),
  useRestaurantCtx: vi.fn(),
  useOrders: vi.fn(),
  useFeatures: vi.fn(),
  useBridgeConnected: vi.fn(),
  useReservations: vi.fn(),
  useOfflineOrderQueue: vi.fn(),
  useAudioUnlock: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  sent: { current: null as OrderConfirmationPayload | null },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: h.useAuth }))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: h.useRestaurantCtx }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: h.useOrders }))
vi.mock('../../hooks/useFeatures', () => ({ useFeatures: h.useFeatures }))
vi.mock('../../hooks/useBridgeConnected', () => ({ useBridgeConnected: h.useBridgeConnected }))
vi.mock('../../hooks/useReservations', () => ({ useReservations: h.useReservations }))
vi.mock('../../hooks/useOfflineOrderQueue', () => ({
  useOfflineOrderQueue: h.useOfflineOrderQueue,
}))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: h.useAudioUnlock }))
vi.mock('../../components/ui/useToast', () => ({ useToast: () => h.toast }))

// PostgREST: mesele, harta sălii și alocările de mese — toate goale.
vi.mock('../../lib/supabase', () => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order', 'in', 'limit']) c[k] = () => c
    c.maybeSingle = () => Promise.resolve({ data: null, error: null })
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, ko)
    return c
  }
  return {
    supabase: { from: () => chain(), rpc: () => Promise.resolve({ data: null, error: null }) },
  }
})

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return {
    ...actual,
    fetchWaiterCalls: () => Promise.resolve([]),
    subscribeToWaiterCalls: () => ({ unsubscribe: () => {} }),
  }
})

// „Comandă nouă" — înlocuită cu un buton care raportează confirmarea dată.
vi.mock('../../components/WaiterEntry', async () => {
  const { createElement } = await import('react')
  return {
    default: (props: { onOrderCreated: (c: OrderConfirmationPayload) => void }) =>
      createElement(
        'button',
        {
          onClick: () => {
            if (h.sent.current) props.onOrderCreated(h.sent.current)
          },
        },
        'trimite-test',
      ),
  }
})

import WaiterPage from '../WaiterPage'
import { makeOrder } from '../../components/__tests__/fixtures'
import { STAFF_TAP_GUARD_MS } from '../../lib/tapGuard'

function setOrders(orders: Order[], advance = vi.fn().mockResolvedValue(true)) {
  h.useOrders.mockReturnValue({
    orders,
    loading: false,
    error: null,
    truncated: false,
    connectionStatus: 'connected',
    advance,
    byStatus: () => orders,
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  })
  return advance
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sent.current = null
  h.useAuth.mockReturnValue({ user: h.USER })
  h.useRestaurantCtx.mockReturnValue({
    activeId: 'r1',
    activeName: 'Bistro',
    activeRole: 'waiter',
    memberships: [],
    setActive: vi.fn(),
  })
  h.useFeatures.mockReturnValue({ features: null, loading: true, reload: vi.fn() })
  h.useBridgeConnected.mockReturnValue({ status: null, loading: false })
  h.useReservations.mockReturnValue({ reservations: [], updateStatus: vi.fn(), seat: vi.fn() })
  h.useOfflineOrderQueue.mockReturnValue({
    isOffline: false,
    pendingCount: 0,
    droppedReason: null,
    dismissDropped: vi.fn(),
    authRequired: false,
  })
  h.useAudioUnlock.mockReturnValue({ locked: false, unlock: vi.fn() })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const twoReady = () => [
  makeOrder({ id: 'A', status: 'ready', created_at: '2026-07-20T09:00:00Z' }),
  makeOrder({ id: 'B', status: 'ready', created_at: '2026-07-20T09:05:00Z' }),
]

describe('WaiterPage — „Servit" și dublu-tap peste carduri vecine', () => {
  it('WP1 „Servit" pe A, apoi imediat pe B (a urcat sub deget) → doar A e servită', async () => {
    // Mutație: scoate `!tapGuard()` din handleServit → B e servită din greșeală.
    const advance = setOrders(twoReady())
    render(<WaiterPage />)
    const [servA, servB] = await screen.findAllByRole('button', { name: 'Servit' })
    fireEvent.click(servA)
    fireEvent.click(servB)
    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance).toHaveBeenCalledWith('A', 'ready', { status: 'served', served_by: 'u1' })
  })

  it('WP2 control: un tap DELIBERAT pe B, după fereastra de dublu-tap, o servește', async () => {
    const advance = setOrders(twoReady())
    render(<WaiterPage />)
    const [servA, servB] = await screen.findAllByRole('button', { name: 'Servit' })
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(5_000_000)
    fireEvent.click(servA)
    now.mockReturnValue(5_000_000 + STAFF_TAP_GUARD_MS + 100)
    fireEvent.click(servB)
    expect(advance).toHaveBeenCalledTimes(2)
    expect(advance).toHaveBeenLastCalledWith('B', 'ready', { status: 'served', served_by: 'u1' })
  })
})

describe('WaiterPage — ospătarul află unde a ajuns comanda', () => {
  it('WP3 comanda rămasă DOAR pe telefon (LOCAL-…) → avertisment vizibil, lung', async () => {
    // Mutație: `onOrderCreated={() => {...}}` care ignoră confirmarea → nimic.
    setOrders([])
    h.sent.current = {
      id: 'loc-1',
      short_id: 'LOCAL-4821',
      status: 'new',
      total: 22,
      created_at: '2026-07-20T09:00:00Z',
    }
    render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: /comandă nouă/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'trimite-test' }))
    expect(h.toast.warning).toHaveBeenCalledTimes(1)
    expect(h.toast.warning.mock.calls[0][0]).toMatch(/DOAR pe acest telefon/)
    expect(h.toast.success).not.toHaveBeenCalled()
  })

  it('WP4 comanda ajunsă la server → confirmare cu numărul ei', async () => {
    setOrders([])
    h.sent.current = {
      id: 'o-9',
      short_id: 'A1B2C3',
      status: 'new',
      total: 22,
      created_at: '2026-07-20T09:00:00Z',
    }
    render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: /comandă nouă/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'trimite-test' }))
    expect(h.toast.success).toHaveBeenCalledWith('Comanda #A1B2C3 a fost trimisă la bucătărie.')
  })
})
