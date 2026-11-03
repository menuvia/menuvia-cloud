// Bucătăria sună când o comandă trece de 20 de minute (lotul G).
//   KA1  comenzile DEJA întârziate la deschiderea ecranului nu sună (cardul e
//        deja roșu; un reload nu face zgomot), iar una care trece pragul cât
//        ecranul e deschis sună O dată, cu tonul de întârziere (440 Hz),
//        diferit de „comandă nouă" (880 Hz). Mutații care pică: fără baseline
//        (sună la deschidere); fără intervalul de 10 s (pragul trecut fără
//        niciun eveniment nu sună); fără `alerted` (sună la fiecare 10 s).
//   KA2  o comandă „Gata de servit", oricât de veche, nu sună.
//   KA3  primul fetch eșuează (listă goală + eroare), apoi un poll reușit aduce
//        comenzi DEJA întârziate → tăcere (ele sunt baseline-ul); una care trece
//        pragul după aceea sună. Mutația care pică: baseline pus și pe eroare.
//   KA4  comutare de restaurant: useOrders mai ține comenzile vechiului
//        restaurant, iar un tick de 10 s cade în fereastra asta; comenzile
//        noului restaurant, deja întârziate, NU sună. Mutația care pică:
//        baseline fără verificarea `restaurant_id`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

const { useOrdersMock, useCtxMock, usePushMock, useAudioMock, playSoundMock } = vi.hoisted(() => ({
  useOrdersMock: vi.fn(),
  useCtxMock: vi.fn(),
  usePushMock: vi.fn(),
  useAudioMock: vi.fn(),
  playSoundMock: vi.fn(),
}))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: useCtxMock }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: useOrdersMock }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: usePushMock }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: useAudioMock }))
vi.mock('../../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/utils')>()
  return { ...actual, playSound: playSoundMock }
})

import KitchenPage from '../../pages/KitchenPage'
import type { Order, OrderStatus } from '../../lib/orders'
import { makeOrder } from './fixtures'

const NOW = new Date('2026-07-20T09:20:00Z')

function ordersHook(orders: Order[], error: string | null = null) {
  return {
    orders,
    loading: false,
    error,
    truncated: false,
    connectionStatus: 'connected',
    advance: vi.fn(),
    byStatus: (statuses: OrderStatus[]) => orders.filter((o) => statuses.includes(o.status)),
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  }
}

const lateCalls = () => playSoundMock.mock.calls.filter(([hz]) => hz === 440)

describe('KitchenPage — alerta de întârziere', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    playSoundMock.mockReset()
    useCtxMock.mockReturnValue({
      activeId: 'r1',
      activeName: 'Bistro',
      activeRole: 'kitchen',
      memberships: [],
      setActive: vi.fn(),
      loading: false,
    })
    usePushMock.mockReturnValue({
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      loading: false,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })
    useAudioMock.mockReturnValue({ locked: false, unlock: vi.fn() })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('KA1 deja întârziată → tăcere; trecerea pragului → un singur sunet', () => {
    useOrdersMock.mockReturnValue(
      ordersHook([
        makeOrder({ id: 'OLD', status: 'preparing', created_at: '2026-07-20T08:50:00Z' }),
        makeOrder({ id: 'A', status: 'confirmed', created_at: '2026-07-20T09:05:00Z' }),
      ]),
    )
    render(<KitchenPage />)
    expect(lateCalls()).toHaveLength(0)

    // 09:20 → 09:24:50: A are încă sub 20 de minute.
    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 50_000)
    })
    expect(lateCalls()).toHaveLength(0)

    // Trece de 09:25 → A devine întârziată.
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(lateCalls()).toEqual([[440, 450]])

    // Încă două minute: nu mai sună.
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(lateCalls()).toHaveLength(1)
  })

  it('KA3 primul fetch eșuat nu devine baseline', () => {
    useOrdersMock.mockReturnValue(ordersHook([], 'Failed to fetch'))
    const view = render(<KitchenPage />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    useOrdersMock.mockReturnValue(
      ordersHook([
        makeOrder({ id: 'OLD', status: 'preparing', created_at: '2026-07-20T08:50:00Z' }),
        makeOrder({ id: 'A', status: 'confirmed', created_at: '2026-07-20T09:05:00Z' }),
      ]),
    )
    view.rerender(<KitchenPage />)
    expect(lateCalls()).toHaveLength(0)
    // A trece de 20 de minute (09:25) cât ecranul e deschis → sună o dată.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000 + 10_000)
    })
    expect(lateCalls()).toEqual([[440, 450]])
  })

  it('KA4 comutarea restaurantului nu sună pe comenzile deja întârziate ale noului local', () => {
    const r1Orders = [makeOrder({ id: 'X', status: 'confirmed', created_at: '2026-07-20T09:15:00Z' })]
    useOrdersMock.mockReturnValue(ordersHook(r1Orders))
    const view = render(<KitchenPage />)
    // Comutare: contextul e pe r2, dar lista e încă a lui r1 — un tick cade aici.
    useCtxMock.mockReturnValue({
      activeId: 'r2',
      activeName: 'Terasa',
      activeRole: 'kitchen',
      memberships: [],
      setActive: vi.fn(),
      loading: false,
    })
    view.rerender(<KitchenPage />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    useOrdersMock.mockReturnValue(
      ordersHook([
        makeOrder({ id: 'B', restaurant_id: 'r2', status: 'preparing', created_at: '2026-07-20T08:40:00Z' }),
      ]),
    )
    view.rerender(<KitchenPage />)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(lateCalls()).toHaveLength(0)
  })

  it('KA2 o comandă „Gata de servit" nu sună, oricât de veche', () => {
    useOrdersMock.mockReturnValue(
      ordersHook([makeOrder({ id: 'R', status: 'ready', created_at: '2026-07-20T09:05:00Z' })]),
    )
    render(<KitchenPage />)
    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(lateCalls()).toHaveLength(0)
  })
})
