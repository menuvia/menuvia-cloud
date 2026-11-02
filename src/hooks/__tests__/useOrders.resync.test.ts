// perf-staff-1: useOrders recuperează evenimentele pierdute. Realtime NU
// re-livrează ce s-a emis cât canalul era căzut sau cât tab-ul era suspendat
// în fundal; până acum lista se reîmprospăta abia la heartbeat (~120 s cu
// realtime „conectat", 30 s altfel). Acum: fetch IMEDIAT la RE-conectarea
// canalului, la revenirea în prim-plan după o pauză și la `online`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RealtimeConnectionStatus, StaffOrdersPage } from '../../lib/orders'

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

import { useOrders } from '../useOrders'
import { makeOrder } from '../../components/__tests__/fixtures'

let onStatus: (s: RealtimeConnectionStatus) => void = () => {}
let hidden = false

async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function status(s: RealtimeConnectionStatus): Promise<void> {
  await act(async () => {
    onStatus(s)
  })
  await tick(0)
}

async function setHidden(h: boolean): Promise<void> {
  hidden = h
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await tick(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const fn of Object.values(m)) fn.mockReset()
  m.fetchKitchenOrders.mockResolvedValue({
    orders: [makeOrder({ id: 'A', status: 'new' })],
    truncated: false,
  })
  m.subscribeToOrders.mockImplementation(
    (_rid: string, _onEvent: unknown, cb: (s: RealtimeConnectionStatus) => void) => {
      onStatus = cb
      return { unsubscribe: vi.fn() }
    },
  )
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
})

afterEach(() => {
  Reflect.deleteProperty(document, 'hidden')
  vi.useRealTimers()
})

describe('useOrders — resincronizare', () => {
  it('RS1 RE-conectarea canalului → fetch imediat, iar comanda pierdută apare', async () => {
    // Mutație: scoate apelul resync din callback-ul de status → fetch-ul
    // rămâne la 1 până la heartbeat.
    const { result } = renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    await status('connected')
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(1) // primul SUBSCRIBED nu dublează fetch-ul

    await status('disconnected')
    // Cât canalul a fost căzut a intrat comanda B — niciun eveniment n-o aduce.
    m.fetchKitchenOrders.mockResolvedValue({
      orders: [makeOrder({ id: 'A', status: 'new' }), makeOrder({ id: 'B', status: 'new' })],
      truncated: false,
    })
    await status('connected')
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)
    expect(result.current.orders.map((o) => o.id).sort()).toEqual(['A', 'B'])
  })

  it('RS2 revenirea în prim-plan după o pauză lungă → fetch imediat', async () => {
    renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    await status('connected')
    await setHidden(true)
    await tick(20_000) // sub heartbeat-ul de 30 s și ascuns oricum
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(1)
    await setHidden(false)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)
  })

  it('RS3 control: o ascundere scurtă (deblocare de telefon) NU declanșează fetch', async () => {
    renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    await status('connected')
    await setHidden(true)
    await tick(3_000)
    await setHidden(false)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(1)
  })

  it('RS4 evenimentul `online` → fetch imediat', async () => {
    renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await tick(0)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)
  })

  it('RS5 un fetch reușit închide bannerul de sincronizare (nu mai e lipicios)', async () => {
    m.fetchKitchenOrders.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'))
    const { result } = renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    expect(result.current.error).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await tick(0)
    expect(result.current.error).toBeNull()
  })

  it('RS6 resync-ul cerut cât o acțiune e în curs NU suprascrie starea optimistă; rulează după', async () => {
    const { result } = renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    let resolveRpc: (v: null) => void = () => {}
    m.advanceOrderStatus.mockImplementation(
      () =>
        new Promise<null>((r) => {
          resolveRpc = r
        }),
    )
    let pending: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      pending = result.current.advance('A', 'new', { status: 'confirmed' })
    })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await tick(0)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(1)
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')

    m.fetchKitchenOrders.mockResolvedValue({
      orders: [makeOrder({ id: 'A', status: 'confirmed' })],
      truncated: false,
    })
    await act(async () => {
      resolveRpc(null)
      await pending
    })
    await tick(0)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)
  })

  it('RS7 un semnal venit în fereastra de 2 s e AMÂNAT, nu pierdut: reconectarea de după `online` tot reîncarcă', async () => {
    // Telefonul revine: `online` (sau `visibilitychange`) la t=0, canalul se
    // reabonează la ~1 s. Comanda B e creată între cele două — nu e în lista de
    // la t=0 și evenimentul ei nu vine pe canal. Mutație: semnalul din fereastră
    // e aruncat (`return`, varianta de dinainte) → fetch-ul rămâne la 2 și B
    // apare abia la heartbeat (~120 s cu realtime conectat).
    const { result } = renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    await status('connected')
    await status('disconnected')
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await tick(0)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)

    m.fetchKitchenOrders.mockResolvedValue({
      orders: [makeOrder({ id: 'A', status: 'new' }), makeOrder({ id: 'B', status: 'new' })],
      truncated: false,
    })
    await tick(1_000)
    await status('connected')
    // În fereastră: încă niciun fetch nou...
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)
    // ...dar la capătul ei pleacă unul, iar B apare.
    await tick(1_000)
    await tick(0)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(3)
    expect(result.current.orders.map((o) => o.id).sort()).toEqual(['A', 'B'])
  })

  it('RS8 o listă cerută ÎNAINTEA unei acțiuni și sosită DUPĂ ea nu readuce comanda pe pasul vechi', async () => {
    // Bucătarul se întoarce la tabletă (resync pornit) și apasă imediat
    // „Confirmă"; RPC-ul reușește înainte să sosească lista, care e de
    // dinainte de acțiune. Mutație: fără contorul de epocă, lista veche se
    // aplică (pendingAdvances e deja 0) → A revine la `new`, iar cu realtime
    // conectat nimic n-o mai corecta până la heartbeat.
    const { result } = renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    let resolveStale: (p: StaffOrdersPage) => void = () => {}
    m.fetchKitchenOrders.mockImplementationOnce(
      () =>
        new Promise<StaffOrdersPage>((r) => {
          resolveStale = r
        }),
    )
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)

    m.advanceOrderStatus.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.advance('A', 'new', { status: 'confirmed' })
    })
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')

    m.fetchKitchenOrders.mockResolvedValue({
      orders: [makeOrder({ id: 'A', status: 'confirmed' })],
      truncated: false,
    })
    await act(async () => {
      resolveStale({ orders: [makeOrder({ id: 'A', status: 'new' })], truncated: false })
    })
    await tick(0)
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')
    // Lista veche e înlocuită de una cerută DUPĂ acțiune.
    await tick(2_000)
    await tick(0)
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(3)
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')
  })

  it('RS9 la fel pentru heartbeat: lista pornită înaintea acțiunii nu se aplică după ea', async () => {
    // Mutație: heartbeat-ul verifică doar `pendingAdvances > 0` (acțiunea s-a
    // terminat deja când sosește lista) → A revine la `new`.
    const { result } = renderHook(() => useOrders('r1', 'kitchen'))
    await tick(0)
    let resolveStale: (p: StaffOrdersPage) => void = () => {}
    m.fetchKitchenOrders.mockImplementationOnce(
      () =>
        new Promise<StaffOrdersPage>((r) => {
          resolveStale = r
        }),
    )
    await tick(30_000) // canal neconectat → heartbeat la fiecare tick
    expect(m.fetchKitchenOrders).toHaveBeenCalledTimes(2)

    m.advanceOrderStatus.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.advance('A', 'new', { status: 'confirmed' })
    })
    await act(async () => {
      resolveStale({ orders: [makeOrder({ id: 'A', status: 'new' })], truncated: false })
    })
    await tick(0)
    expect(result.current.orders.find((o) => o.id === 'A')?.status).toBe('confirmed')
  })
})
