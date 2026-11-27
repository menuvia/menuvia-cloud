// Ospătarul — cablajul paginii pentru plata integrală și plata parțială
// (lotul C2a). Hook-urile de date sunt mock-uite (ca în
// WaiterPage.quickActions); `getOrderPayments` e controlat de test.
//
//   PMU3  PayModal: citirea plăților EȘUATĂ → alertă, „Confirmă plata”
//         dezactivat (nu „0 lei încasați”); „Reîncearcă” re-citește, iar cu
//         40 lei încasați restul e 60 și butonul se activează. Mutația care
//         pică: `.catch` care pune suma încasată pe 0 (butonul activ pe total).
//   SPB7  „Plată parțială” arată comanda VIE: o reducere aplicată între timp
//         (total 100 → 80) se vede în modal, la total și la „Rămas”. Mutația
//         care pică: modalul randat din instantaneul `splitOrder`.
//   SPB8  plățile comenzii deschise ANTERIOR nu apar pe următoarea: cât se
//         citesc plățile lui B, „Plăți înregistrate” (ale lui A) lipsește și
//         se vede așteptarea. Mutația care pică: registrul ținut în pagină,
//         fără reset la deschidere (bug-ul de dinainte).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import type { Order, OrderPaymentRow } from '../../lib/orders'

const h = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useRestaurantCtx: vi.fn(),
  useOrders: vi.fn(),
  useFeatures: vi.fn(),
  useBridgeConnected: vi.fn(),
  useReservations: vi.fn(),
  useOfflineOrderQueue: vi.fn(),
  useAudioUnlock: vi.fn(),
  getOrderPayments: vi.fn<(id: string) => Promise<OrderPaymentRow[]>>(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: h.useAuth }))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: h.useRestaurantCtx }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: h.useOrders }))
vi.mock('../../hooks/useFeatures', () => ({ useFeatures: h.useFeatures }))
vi.mock('../../hooks/useBridgeConnected', () => ({ useBridgeConnected: h.useBridgeConnected }))
vi.mock('../../hooks/useReservations', () => ({ useReservations: h.useReservations }))
vi.mock('../../hooks/useOfflineOrderQueue', () => ({ useOfflineOrderQueue: h.useOfflineOrderQueue }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: h.useAudioUnlock }))
vi.mock('../../components/ui/useToast', () => ({ useToast: () => h.toast }))

// PostgREST: mesele, harta sălii, alocările, sugestia Happy Hour — toate goale.
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
    getOrderPayments: (id: string) => h.getOrderPayments(id),
  }
})

import WaiterPage from '../WaiterPage'
import { makeOrder } from '../../components/__tests__/fixtures'
import { featuresFor } from '../../lib/__tests__/planSurfaceFixtures'

function setOrders(orders: Order[]): void {
  h.useOrders.mockReturnValue({
    orders,
    loading: false,
    error: null,
    truncated: false,
    connectionStatus: 'connected',
    advance: vi.fn().mockResolvedValue(true),
    byStatus: () => orders,
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  })
}

const pay = (id: string, amount: number): OrderPaymentRow => ({
  id,
  amount,
  method: 'cash',
  created_at: '2026-07-20T09:00:00Z',
})

const served = (id: string, total: number) =>
  makeOrder({ id, status: 'served', total, created_at: '2026-07-20T09:00:00Z' })

const splitDialog = () => screen.getByRole('dialog', { name: 'Plată parțială' })

// Garda de dublu-tap e per comandă (domeniul 'card'): primul tap pe fiecare
// card trece, deci testele nu umblă la ceas.
beforeEach(() => {
  vi.clearAllMocks()
  h.getOrderPayments.mockReset()
  h.useAuth.mockReturnValue({ user: { id: 'u1' } })
  h.useRestaurantCtx.mockReturnValue({
    activeId: 'r1',
    activeName: 'Bistro',
    activeRole: 'waiter',
    memberships: [],
    setActive: vi.fn(),
  })
  // Planul 3: plata integrală și cea parțială există pe card.
  h.useFeatures.mockReturnValue({ features: featuresFor('pro'), loading: false, reload: vi.fn() })
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

describe('WaiterPage — plata integrală: suma încasată necunoscută nu e 0', () => {
  it('PMU3: citire eșuată → dezactivat + „Reîncearcă”; re-citire → restul și butonul activ', async () => {
    setOrders([served('A', 100)])
    h.getOrderPayments.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([pay('p1', 40)])
    render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Plată integrală' }))

    expect(await screen.findByText(/Nu am putut citi plățile deja înregistrate pe comandă/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmă plata' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(await screen.findByText('Rest de plată:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmă plata' })).toBeEnabled()
    expect(h.getOrderPayments).toHaveBeenCalledTimes(2)
    expect(h.getOrderPayments).toHaveBeenLastCalledWith('A')
  })
})

describe('WaiterPage — plata parțială pe comanda vie', () => {
  it('SPB7: o reducere aplicată între timp (100 → 80) se vede în modal', async () => {
    setOrders([served('A', 100)])
    h.getOrderPayments.mockResolvedValue([])
    const view = render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Plată parțială' }))
    expect(await within(splitDialog()).findByText('Rămas:')).toBeInTheDocument()
    // Control: totalul de la deschidere.
    expect(within(splitDialog()).getAllByText('100.00 lei').length).toBeGreaterThan(0)

    setOrders([served('A', 80)])
    view.rerender(<WaiterPage />)
    const dialog = splitDialog()
    expect(within(dialog).queryByText('100.00 lei')).toBeNull()
    // Totalul și „Rămas” (fără plăți) urmează comanda vie.
    expect(within(dialog).getAllByText('80.00 lei')).toHaveLength(2)
  })

  it('SPB8: plățile comenzii anterioare nu apar cât se citesc ale următoarei', async () => {
    setOrders([served('A', 100)])
    let releaseB: (rows: OrderPaymentRow[]) => void = () => {}
    h.getOrderPayments.mockImplementation((id) =>
      id === 'A'
        ? Promise.resolve([pay('pa', 40)])
        : new Promise<OrderPaymentRow[]>((resolve) => {
            releaseB = resolve
          }),
    )
    const view = render(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Plată parțială' }))
    expect(await within(splitDialog()).findByText('Plăți înregistrate:')).toBeInTheDocument()
    fireEvent.click(within(splitDialog()).getByRole('button', { name: 'Închide' }))
    expect(screen.queryByRole('dialog', { name: 'Plată parțială' })).toBeNull()

    setOrders([served('B', 70)])
    view.rerender(<WaiterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Plată parțială' }))
    const dialog = splitDialog()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Se citesc plățile înregistrate…')
    expect(within(dialog).queryByText('Plăți înregistrate:')).toBeNull()
    expect(within(dialog).queryByText('40.00 lei')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Adaugă plata' })).toBeDisabled()

    // Control pozitiv: registrul lui B sosește și e al lui B.
    await act(async () => {
      releaseB([])
    })
    expect(within(splitDialog()).getByText('Rămas:')).toBeInTheDocument()
    expect(within(splitDialog()).getAllByText('70.00 lei')).toHaveLength(2)
  })
})
