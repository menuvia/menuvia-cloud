// Extra-urile plătite ajung pe ecranele personalului (lotul O2a, audit nov 2026
// OPT-1 / STAFF-OPT-3 / OPT-11 / STAFF-OPT-10). Înainte, extras_added nu era
// cerut deloc de ecranele de staff, iar cardul ospătarului arăta doar
// „Pizza ×1, Pizza ×1".
//
//   OL1  orderItemExtraNames: `extra_name` (forma vie), `name` (rânduri dinainte
//        de mig 088), intrări goale/necunoscute sărite. [PICĂ: doar `name`
//        citit — exact bug-ul tichetului de bucătărie]
//   OL2  OrderLineDetails „list": câte un rând pe opțiune și pe extra, plus nota;
//        o linie fără nimic nu randează nimic (control).
//   OL3  bucătăria (KitchenOrderCard) arată extra-ul. [PICĂ: OrderLineDetails
//        scos de pe card — rămân doar opțiunile, ca înainte]
//   OL4  cardul ospătarului: câte un rând pe linie, cu opțiunea, extra-ul și nota.
//        [PICĂ: lista „Pizza ×1, Pizza ×1" de dinainte]
//   OL5  „Gata de servit": cantitatea și extra-ul apar (înainte doar numele).
//   OL6  interogarea comenzilor de staff cere `extras_added` — fără ea, toate
//        ecranele de mai sus primesc o listă goală. [PICĂ: coloana scoasă din
//        ORDER_SELECT]
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const { fromMock, chain } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(async () => ({ data: [], error: null }))
  return { fromMock: vi.fn(() => chain), chain }
})
vi.mock('../../lib/supabase', () => ({ supabase: { from: fromMock } }))
// KitchenPage își montează hook-urile doar ca pagină; aici randăm doar cardul,
// dar modulul le importă — le neutralizăm ca în KitchenOrderCard.pending.test.
vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: vi.fn() }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: vi.fn() }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: vi.fn() }))
vi.mock('../../hooks/useAudioUnlock', () => ({ useAudioUnlock: vi.fn() }))

import { OrderLineDetails } from '../OrderLineDetails'
import { KitchenOrderCard } from '../../pages/KitchenPage'
import { OrderCard } from '../WaiterOrderCard'
import { ReadyOrderCard } from '../ReadyOrderCard'
import { fetchKitchenOrders, fetchWaiterOrders, orderItemExtraNames } from '../../lib/orders'
import { makeOrder, makeOrderItem } from './fixtures'

const burger = makeOrderItem({
  id: 'l1',
  product_name_snapshot: 'Burger',
  quantity: 1,
  selected_modifiers: [
    { group_id: 'g1', group_name: 'Gătire', option_id: 'o1', option_name: 'Mediu', price_delta: 0 },
  ],
  extras_added: [{ extra_id: 'e1', extra_name: 'Bacon', price: 5 }],
  notes: 'fără ceapă',
})
const pizza = makeOrderItem({ id: 'l2', product_name_snapshot: 'Pizza', quantity: 2 })

describe('extra-urile pe ecranele personalului', () => {
  it('OL1 orderItemExtraNames citește extra_name, apoi name, și sare golurile', () => {
    expect(
      orderItemExtraNames({
        extras_added: [
          { extra_id: 'e1', extra_name: 'Bacon', price: 5 },
          { name: 'Ceapă extra', price: 2 },
          { extra_name: '  ', name: '' },
          { extra_name: ' Cașcaval ' },
        ],
      }),
    ).toEqual(['Bacon', 'Ceapă extra', 'Cașcaval'])
    expect(orderItemExtraNames({ extras_added: null })).toEqual([])
    expect(orderItemExtraNames({})).toEqual([])
  })

  it('OL2 „list": un rând pe opțiune și pe extra, plus nota; linia goală nu randează nimic', () => {
    const { unmount } = render(<OrderLineDetails item={burger} variant="list" />)
    expect(screen.getByText('+ Mediu')).toBeInTheDocument()
    expect(screen.getByTestId('line-extra')).toHaveTextContent('+ Bacon')
    expect(screen.getByText('✎ fără ceapă')).toBeInTheDocument()
    unmount()
    const empty = render(<OrderLineDetails item={pizza} variant="list" />)
    expect(empty.container).toBeEmptyDOMElement()
  })

  it('OL3 bucătăria arată extra-ul plătit', () => {
    render(
      <KitchenOrderCard
        order={makeOrder({ id: 'K1', status: 'confirmed', order_items: [burger, pizza] })}
        onAdvance={vi.fn()}
      />,
    )
    expect(screen.getByText('+ Mediu')).toBeInTheDocument()
    expect(screen.getByTestId('line-extra')).toHaveTextContent('+ Bacon')
    expect(screen.getByText('✎ fără ceapă')).toBeInTheDocument()
  })

  it('OL4 cardul ospătarului: câte un rând pe linie, cu opțiuni, extra și notă', () => {
    render(
      <OrderCard
        order={makeOrder({ id: 'W1', status: 'preparing', order_items: [burger, pizza] })}
        paymentsEnabled={null}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
      />,
    )
    const lines = screen.getAllByTestId('order-line')
    expect(lines).toHaveLength(2)
    expect(within(lines[0]).getByText('Burger ×1')).toBeInTheDocument()
    expect(within(lines[0]).getByText('Mediu · + Bacon')).toBeInTheDocument()
    expect(within(lines[0]).getByText('✎ fără ceapă')).toBeInTheDocument()
    expect(within(lines[1]).getByText('Pizza ×2')).toBeInTheDocument()
  })

  it('OL5 „Gata de servit": cantitatea și extra-ul apar', () => {
    render(
      <ReadyOrderCard
        order={makeOrder({ id: 'R1', status: 'ready', order_items: [burger, pizza] })}
        onServe={vi.fn()}
      />,
    )
    const lines = screen.getAllByTestId('order-line')
    expect(within(lines[0]).getByText('Burger ×1')).toBeInTheDocument()
    expect(within(lines[0]).getByText('Mediu · + Bacon')).toBeInTheDocument()
    expect(within(lines[1]).getByText('Pizza ×2')).toBeInTheDocument()
  })

  it('OL6 comenzile de staff se cer cu extras_added', async () => {
    await fetchKitchenOrders('r1')
    await fetchWaiterOrders('r1')
    const selects = chain.select.mock.calls.map((c) => String(c[0]))
    expect(selects.length).toBeGreaterThanOrEqual(2)
    for (const sel of selects) expect(sel).toMatch(/order_items\([^)]*\bextras_added\b/)
  })
})
