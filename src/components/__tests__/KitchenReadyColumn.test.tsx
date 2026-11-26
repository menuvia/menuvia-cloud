// Bucătăria, lotul C3a: coloana „Gata de servit” calmă și cantitatea în față.
// Prefixele KG (Kitchen, Gata — continuă lib/__tests__/kitchenReady.test.ts,
// KG1–KG4) și KQ (Kitchen, cantitate) — verificate cu grep, nefolosite înainte.
//   KG5  cardul GATA e calm: o comandă plasată acum 40 de minute și gata de 2
//        nu e escaladată (data-urgency „calm”), iar timer-ul arată „Gata de
//        2m” (din `ready_at`), nu „40m”. Control pozitiv: ACEEAȘI comandă în
//        „În pregătire” e roșie, cu „40m”. Mutația care pică: urgența
//        calculată pe `created_at` indiferent de status (codul de dinainte).
//   KG6  coloana „Gata” arată întregi doar comenzile gata din ultimele 10
//        minute; cele mai vechi stau într-un rând „+2 așteaptă ospătarul”
//        (aria-expanded=false) care, apăsat, le arată; totalul coloanei le
//        numără pe toate. Mutația care pică: coloana randată fără
//        `splitReadyColumn` (toate cardurile la vedere, fără rând).
//   KG7  ordinea din „Gata” e pe `ready_at`, cea mai recentă sus — nu FIFO pe
//        plasare. Mutația care pică: `sortByDue` păstrat pe coloana „Gata”.
//   KG8  o comandă trece în rândul „așteaptă” odată cu trecerea timpului, fără
//        niciun eveniment (ceasul paginii, 30 s). Mutația care pică: ceasul
//        de 30 s scos (pagina se re-randa doar la o comandă nouă).
//   KQ1  cantitatea stă ÎNAINTEA numelui, ca pe tichetul tipărit („2×
//        Paste carbonara”), cu chip pe cantitate > 1; „1×” fără chip.
//        Mutația care pică: formatul de dinainte, `{nume} × {qty}`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

const { useOrdersMock, useCtxMock, usePushMock, useAudioMock } = vi.hoisted(() => ({
  useOrdersMock: vi.fn(),
  useCtxMock: vi.fn(),
  usePushMock: vi.fn(),
  useAudioMock: vi.fn(),
}))
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: useCtxMock }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: useOrdersMock }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: usePushMock }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: useAudioMock }))
vi.mock('../../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/utils')>()
  return { ...actual, playSound: vi.fn() }
})

import KitchenPage, { KitchenOrderCard } from '../../pages/KitchenPage'
import type { Order, OrderStatus } from '../../lib/orders'
import { makeOrder, makeOrderItem, makeTable } from './fixtures'

const NOW = Date.parse('2026-07-20T09:20:00Z')
const minAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString()

function ordersHook(orders: Order[]) {
  return {
    orders,
    loading: false,
    error: null,
    snapshotFor: 'r1',
    truncated: false,
    connectionStatus: 'connected',
    advance: vi.fn(),
    byStatus: (statuses: OrderStatus[]) => orders.filter((o) => statuses.includes(o.status)),
    pendingIds: new Set<string>(),
    actionErrors: {},
    dismissActionError: vi.fn(),
  }
}

/** O comandă gata de `readyMin` minute, plasată acum `createdMin` minute, la masa `name`. */
function ready(name: string, readyMin: number, createdMin = 45): Order {
  return makeOrder({
    id: `o-${name}`,
    status: 'ready',
    table: makeTable({ name }),
    created_at: minAgo(createdMin),
    ready_at: minAgo(readyMin),
  })
}

const readyCol = (): HTMLElement => screen.getByTestId('kitchen-col-ready')
/** Numele meselor din cardurile vizibile ale coloanei „Gata”, în ordine. */
const readyTables = (): string[] =>
  within(readyCol())
    .queryAllByTestId('kitchen-card')
    .map((c) => (c.textContent ?? '').match(/^(T\d+)/)?.[1] ?? '?')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
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

describe('KitchenOrderCard — cardul gata e calm', () => {
  it('KG5 gata de 2 minute, plasată acum 40: calm, „Gata de 2m”; control: aceeași în pregătire e roșie', () => {
    const order = ready('T1', 2, 40)
    const view = render(<KitchenOrderCard order={order} onAdvance={vi.fn()} />)
    expect(screen.getByTestId('kitchen-card')).toHaveAttribute('data-urgency', 'calm')
    expect(screen.getByTestId('kitchen-ready-timer')).toHaveTextContent('Gata de 2m')
    expect(screen.queryByText('40m')).toBeNull()
    // Bucătăria n-are niciun pas pe „ready” (îl ridică ospătarul).
    expect(screen.queryByRole('button')).toBeNull()
    view.unmount()

    // Control pozitiv: fără statusul „ready”, aceeași vârstă escaladează.
    render(<KitchenOrderCard order={{ ...order, status: 'preparing' }} onAdvance={vi.fn()} />)
    expect(screen.getByTestId('kitchen-card')).toHaveAttribute('data-urgency', 'late')
    expect(screen.getByText('40m')).toBeInTheDocument()
    expect(screen.queryByTestId('kitchen-ready-timer')).toBeNull()
  })
})

describe('KitchenPage — coloana „Gata de servit”', () => {
  it('KG6 doar ultimele 10 minute la vedere; restul în „+2 așteaptă ospătarul”, care se deschide', () => {
    useOrdersMock.mockReturnValue(
      ordersHook([ready('T1', 2), ready('T2', 12), ready('T3', 30), ready('T4', 5)]),
    )
    render(<KitchenPage />)
    expect(readyTables()).toEqual(['T1', 'T4'])
    expect(within(readyCol()).getByTestId('kitchen-col-count')).toHaveTextContent('4')
    const toggle = within(readyCol()).getByRole('button', { name: '+2 așteaptă ospătarul' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(readyTables()).toEqual(['T1', 'T4', 'T2', 'T3'])
  })

  it('KG7 ordinea e pe ready_at (cea mai recentă sus), nu pe plasare', () => {
    // T5 plasată prima (acum 50 de min), dar gata abia acum un minut.
    useOrdersMock.mockReturnValue(
      ordersHook([ready('T6', 8, 20), ready('T5', 1, 50), ready('T7', 4, 30)]),
    )
    render(<KitchenPage />)
    expect(readyTables()).toEqual(['T5', 'T7', 'T6'])
    expect(within(readyCol()).queryByRole('button', { name: /așteaptă ospătarul/ })).toBeNull()
  })

  it('KG8 o comandă trece în „așteaptă” odată cu timpul, fără niciun eveniment', () => {
    useOrdersMock.mockReturnValue(ordersHook([ready('T8', 9), ready('T9', 1)]))
    render(<KitchenPage />)
    expect(readyTables()).toEqual(['T9', 'T8'])
    // T8 trece de 10 minute; ceasul paginii (30 s) re-randează coloana.
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(readyTables()).toEqual(['T9'])
    expect(within(readyCol()).getByRole('button', { name: '+1 așteaptă ospătarul' })).toBeInTheDocument()
  })
})

describe('KitchenOrderCard — cantitatea în față', () => {
  it('KQ1 „2×” înaintea numelui, cu chip; „1×” fără chip', () => {
    const order = makeOrder({
      id: 'Q',
      status: 'preparing',
      created_at: minAgo(1),
      order_items: [
        makeOrderItem({ id: 'l1', product_name_snapshot: 'Paste carbonara', quantity: 2 }),
        makeOrderItem({ id: 'l2', product_name_snapshot: 'Apă plată', quantity: 1 }),
      ],
    })
    render(<KitchenOrderCard order={order} onAdvance={vi.fn()} />)
    const [two, one] = screen.getAllByTestId('kitchen-line')
    expect(two.textContent).toMatch(/^2×\s*Paste carbonara$/)
    expect(one.textContent).toMatch(/^1×\s*Apă plată$/)
    const qtyTwo = within(two).getByTestId('kitchen-qty')
    expect(qtyTwo).toHaveTextContent('2×')
    expect(qtyTwo).toHaveAttribute('data-multi', 'true')
    expect(within(one).getByTestId('kitchen-qty')).not.toHaveAttribute('data-multi')
    // Cantitatea vine ÎNAINTE de nume în DOM (nu doar vizual).
    const name = within(two).getByText('Paste carbonara')
    expect(qtyTwo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Formatul de dinainte nu mai apare.
    expect(screen.queryByText(/×\s*2$/)).toBeNull()
  })
})
