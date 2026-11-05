// Ospătarul — cablajul paginii pentru acțiunile rapide și „Comandă nouă":
//   - „Servit" scoate cardul din „Gata de servit" pe loc, iar cardul de
//     dedesubt urcă sub deget: al doilea tap al unui dublu-tap servea comanda
//     VECINĂ (ux-staff-double-tap-advance);
//   - după „Trimite comanda" ospătarul AFLĂ unde a ajuns comanda, mai ales când
//     a rămas doar pe telefon (ux-staff-order-sent-feedback).
//   - WR1 ospătarul are „Ieși din cont" în antet (înainte nicio ieșire: singura
//     era în Setări → Cont, tab doar pentru owner/manager) și NU are „Înapoi la
//     panou". Mutația care pică: butonul scos / randat doar pentru admini.
//   - WR2 control: managerul are ambele.
//   - WP5–WP7 (lotul O7b) Planul 3: pasul următor de pe card (lib/waiterSteps.ts)
//     — garda de dublu-tap pe cheia comenzii, fără dublură pe `ready` în listă,
//     iar în „Stadiu mese” (unde „Gata de servit” nu există) cardul poartă
//     „Servit”, deci și drumul spre plată.
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
import { featuresFor } from '../../lib/__tests__/planSurfaceFixtures'

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

describe('WaiterPage — ieșirea din cont și drumul înapoi, pe rol', () => {
  it('WR1 ospătarul: „Ieși din cont" da, „Înapoi la panou" nu', async () => {
    setOrders([])
    render(<WaiterPage />)
    expect(await screen.findByRole('button', { name: 'Ieși din cont' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Înapoi la panou/ })).not.toBeInTheDocument()
  })

  it('WR2 control: managerul are și „Înapoi la panou"', async () => {
    h.useRestaurantCtx.mockReturnValue({
      activeId: 'r1',
      activeName: 'Bistro',
      activeRole: 'manager',
      memberships: [],
      setActive: vi.fn(),
    })
    setOrders([])
    render(<WaiterPage />)
    expect(await screen.findByRole('button', { name: 'Ieși din cont' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Înapoi la panou/ })).toBeInTheDocument()
  })
})

// Lotul O7b — Planul 3: ospătarul împinge comanda înainte de pe propriul card.
// Înainte, fără ecran de bucătărie, o comandă nouă nu putea fi nici servită,
// nici încasată (plata apare doar pe `served`, „Închide comanda” e interzisă).
describe('WaiterPage — Planul 3: pasul următor pe card (lotul O7b)', () => {
  beforeEach(() => {
    h.useFeatures.mockReturnValue({ features: featuresFor('pro'), loading: false, reload: vi.fn() })
  })

  it('WP5 „Marchează în pregătire” pe A: un singur apel la dublu-tap, iar B (alt card) trece', async () => {
    // Mutații care pică: handler fără tapGuard (A avansată de două ori);
    // domeniu 'list' (tap-ul DELIBERAT pe B înghițit); status curent hardcodat.
    const advance = setOrders([
      makeOrder({ id: 'A', status: 'new', created_at: '2026-07-20T09:00:00Z' }),
      makeOrder({ id: 'B', status: 'confirmed', created_at: '2026-07-20T09:05:00Z' }),
    ])
    render(<WaiterPage />)
    const [stepA, stepB] = await screen.findAllByRole('button', { name: 'Marchează în pregătire' })
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(7_000_000)
    fireEvent.click(stepA)
    fireEvent.click(stepA)
    fireEvent.click(stepB)
    expect(advance).toHaveBeenCalledTimes(2)
    expect(advance).toHaveBeenNthCalledWith(1, 'A', 'new', { status: 'preparing' })
    expect(advance).toHaveBeenNthCalledWith(2, 'B', 'confirmed', { status: 'preparing' })
  })

  it('WP6 listă: comanda `ready` are UN singur „Servit” (Gata de servit); `preparing` are pe al ei', async () => {
    // Mutația care pică: handleForwardStep dat necondiționat în listă → două
    // butoane „Servit” pentru aceeași comandă `ready` (3 în total).
    const advance = setOrders([
      makeOrder({ id: 'R', status: 'ready', created_at: '2026-07-20T09:00:00Z' }),
      makeOrder({ id: 'P', status: 'preparing', created_at: '2026-07-20T09:05:00Z' }),
    ])
    render(<WaiterPage />)
    const served = await screen.findAllByRole('button', { name: 'Servit' })
    expect(served).toHaveLength(2)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(9_000_000)
    fireEvent.click(served[0]!)
    now.mockReturnValue(9_000_000 + STAFF_TAP_GUARD_MS + 100)
    fireEvent.click(served[1]!)
    expect(advance).toHaveBeenCalledTimes(2)
    // fiecare buton pe comanda lui, cu statusul ei real
    expect(advance).toHaveBeenCalledWith('R', 'ready', { status: 'served', served_by: 'u1' })
    expect(advance).toHaveBeenCalledWith('P', 'preparing', { status: 'served', served_by: 'u1' })
  })

  it('WP7 „Stadiu mese”: comanda `ready` are „Servit” pe card (acolo „Gata de servit” lipsește)', async () => {
    // Mutația care pică: onAdvance nelegat în renderOrderCard — golul de
    // dinainte: fără „Servit”, deci fără drum spre plată în vederea pe mese.
    const advance = setOrders([
      makeOrder({ id: 'R', status: 'ready', created_at: '2026-07-20T09:00:00Z' }),
    ])
    render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('tab', { name: /stadiu mese/i }))
    // TableStatusBoard e lazy; cardul „Fără masă” se deschide cu „Vezi (1)”.
    fireEvent.click(await screen.findByRole('button', { name: /^vezi \(1\)/i }, { timeout: 5000 }))
    const servit = await screen.findAllByRole('button', { name: 'Servit' })
    // control: în vederea pe mese nu există ReadyOrderCard, deci butonul e al cardului
    expect(servit).toHaveLength(1)
    fireEvent.click(servit[0]!)
    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance).toHaveBeenCalledWith('R', 'ready', { status: 'served', served_by: 'u1' })
    // Plafon propriu: prima încărcare a chunk-ului lazy poate depăși cele 5 s implicite.
  }, 15_000)
})
