// Teste pe EditOrderSheet — editarea unei comenzi existente (flux de bani):
//   - payload-ul RPC: option_ids + baselineTotal (optimistic lock, mig 146+)
//   - refetch-ul la deschidere actualizează baseline-ul, dar NU suprascrie
//     un coș deja editat (dirtyRef)
//   - guard-uri: coș gol / produs orfan → save blocat, RPC neapelat
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { updateOrderItemsMock, fetchOrderByIdMock, fetchMenuMock } = vi.hoisted(() => ({
  updateOrderItemsMock: vi.fn(),
  fetchOrderByIdMock: vi.fn(),
  fetchMenuMock: vi.fn(),
}))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return {
    ...actual,
    updateOrderItems: updateOrderItemsMock,
    fetchOrderById: fetchOrderByIdMock,
  }
})
vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchMenuForRestaurant: fetchMenuMock }
})

import EditOrderSheet from '../EditOrderSheet'
import { makeOrder, makeOrderItem, makeCategory, makeProduct } from './fixtures'

const MENU = [
  makeCategory({ id: 'c1', name: 'Supe', products: [makeProduct({ id: 'p1', name: 'Ciorbă' })] }),
]

function baseOrder() {
  return makeOrder({
    id: 'o1',
    total: 20,
    order_items: [
      makeOrderItem({
        id: 'it1',
        product_id: 'p1',
        product_name_snapshot: 'Ciorbă',
        unit_price_snapshot: 10,
        quantity: 2,
        item_total: 20,
        selected_modifiers: [
          {
            group_id: 'g1',
            group_name: 'Pâine',
            option_id: 'op-paine',
            option_name: 'Cu pâine',
            price_delta: 0,
          },
        ],
      }),
    ],
  })
}

describe('EditOrderSheet — editarea comenzii (bani + optimistic lock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMenuMock.mockResolvedValue(MENU)
    // Default: refetch-ul întoarce exact aceeași stare (fără edit concurent).
    fetchOrderByIdMock.mockResolvedValue(baseOrder())
    updateOrderItemsMock.mockResolvedValue({
      id: 'o1',
      total: 30,
      discount_amount: 0,
      items_count: 1,
    })
  })

  it('salvarea trimite option_ids + baselineTotal către update_order_items', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    render(<EditOrderSheet order={baseOrder()} onClose={vi.fn()} onSaved={onSaved} />)

    // +1 la cantitate, apoi salvează.
    await user.click(screen.getByRole('button', { name: '+' }))
    await user.click(screen.getByRole('button', { name: /salvează/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(updateOrderItemsMock).toHaveBeenCalledTimes(1)
    const [orderId, items, baseline] = updateOrderItemsMock.mock.calls[0]
    expect(orderId).toBe('o1')
    expect(items).toEqual([
      { product_id: 'p1', quantity: 3, option_ids: ['op-paine'], notes: null },
    ])
    // Baseline-ul de optimistic lock = totalul pe care s-a bazat editarea.
    expect(baseline).toBe(20)
  })

  it('refetch-ul la deschidere actualizează baseline-ul când comanda s-a schimbat între timp', async () => {
    const user = userEvent.setup()
    // Alt ospătar a modificat comanda: total 25, qty 3 (utilizatorul nostru
    // n-a apucat să editeze → snapshot-ul proaspăt se aplică).
    const fresh = baseOrder()
    fresh.total = 25
    fresh.order_items[0].quantity = 3
    fetchOrderByIdMock.mockResolvedValue(fresh)

    render(<EditOrderSheet order={baseOrder()} onClose={vi.fn()} onSaved={vi.fn()} />)

    // Așteaptă aplicarea refetch-ului (qty 3 vizibil în stepper).
    await screen.findByText('3')
    await user.click(screen.getByRole('button', { name: /salvează/i }))

    await waitFor(() => expect(updateOrderItemsMock).toHaveBeenCalledTimes(1))
    const [, items, baseline] = updateOrderItemsMock.mock.calls[0]
    expect(items[0].quantity).toBe(3)
    expect(baseline).toBe(25)
  })

  it('coșul deja editat NU e suprascris de refetch (dirty guard)', async () => {
    const user = userEvent.setup()
    // Refetch-ul e ținut în aer până DUPĂ ce userul editează.
    let resolveFresh: (o: ReturnType<typeof baseOrder>) => void = () => {}
    fetchOrderByIdMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFresh = resolve
      }),
    )

    render(<EditOrderSheet order={baseOrder()} onClose={vi.fn()} onSaved={vi.fn()} />)

    // Userul editează întâi (qty 2 → 3)...
    await user.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByText('3')).toBeInTheDocument()

    // ...apoi sosește refetch-ul cu qty 5 — trebuie IGNORAT (munca userului primează).
    const fresh = baseOrder()
    fresh.order_items[0].quantity = 5
    fresh.total = 50
    resolveFresh(fresh)
    // Lasă microtask-urile să curgă, apoi verifică că qty rămâne 3.
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
    expect(screen.queryByText('5')).not.toBeInTheDocument()
  })

  it('produs orfan (șters din meniu) blochează salvarea cu mesaj explicit', async () => {
    const user = userEvent.setup()
    const orphanOrder = baseOrder()
    orphanOrder.order_items[0].product_id = null
    fetchOrderByIdMock.mockResolvedValue(orphanOrder)

    render(<EditOrderSheet order={orphanOrder} onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /salvează/i }))

    expect(await screen.findByText(/produse șterse din meniu/i)).toBeInTheDocument()
    // RPC-ul validează oricum, dar nu trebuie să ajungem la el.
    expect(updateOrderItemsMock).not.toHaveBeenCalled()
  })

  it('ES1 refuzul serverului ajunge în română, cu motivul real (nu „Eroare la salvare")', async () => {
    const user = userEvent.setup()
    // Forma PostgREST brută (nu `instanceof Error`) — exact ce arunca vechiul
    // updateOrderItems; sheet-ul arăta „Eroare la salvare". Mutație: revino la
    // `e instanceof Error ? e.message : 'Eroare la salvare'` → ES1 pică.
    updateOrderItemsMock.mockRejectedValueOnce({
      message:
        'update_order_items: comanda a fost modificată între timp (total 25, așteptat 20). Redeschide comanda și încearcă din nou.',
      code: '40001',
    })

    render(<EditOrderSheet order={baseOrder()} onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /salvează/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/modificată între timp de altcineva/i)
    expect(alert).not.toHaveTextContent(/eroare la salvare/i)
    expect(alert).not.toHaveTextContent(/update_order_items/)
  })

  it('ES2 căderea de rețea (iPhone: „Load failed") → mesaj de conexiune, nu textul brut', async () => {
    const user = userEvent.setup()
    updateOrderItemsMock.mockRejectedValueOnce(new Error('TypeError: Load failed'))

    render(<EditOrderSheet order={baseOrder()} onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /salvează/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/fără conexiune/i)
    expect(alert).not.toHaveTextContent(/load failed/i)
  })

  it('coșul golit complet blochează salvarea (anularea are alt buton)', async () => {
    const user = userEvent.setup()

    render(<EditOrderSheet order={baseOrder()} onClose={vi.fn()} onSaved={vi.fn()} />)

    // Șterge singurul item, apoi încearcă să salvezi.
    await user.click(screen.getByRole('button', { name: /șterge/i }))
    await user.click(screen.getByRole('button', { name: /salvează/i }))

    expect(await screen.findByText(/cel puțin 1 produs/i)).toBeInTheDocument()
    expect(updateOrderItemsMock).not.toHaveBeenCalled()
  })
})
