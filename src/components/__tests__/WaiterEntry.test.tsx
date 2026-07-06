// Teste pe WaiterEntry — comanda manuală a ospătarului (flux de bani):
//   - masă → meniu → produs → coș → submit cu payload-ul corect
//   - idempotency key: STABIL pe durata unui coș, ROTIT după succes
//   - eroare de validare server (ex. missing_required_group): NU se
//     retry-uiește, mesajul real ajunge la ospătar
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchTablesMock, createOrderMock, fetchMenuMock } = vi.hoisted(() => ({
  fetchTablesMock: vi.fn(),
  createOrderMock: vi.fn(),
  fetchMenuMock: vi.fn(),
}))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, fetchTables: fetchTablesMock, createOrder: createOrderMock }
})
vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchMenuForRestaurant: fetchMenuMock }
})

import WaiterEntry from '../WaiterEntry'
import type { CreateOrderArgs } from '../../lib/orders'
import { makeTable, makeCategory, makeProduct } from './fixtures'

const TABLE = makeTable({ id: 't1', name: 'Masa 7' })
const PRODUCT = makeProduct({ id: 'p1', name: 'Ciorbă de burtă', price: 22 })
const MENU = [makeCategory({ id: 'c1', name: 'Supe', products: [PRODUCT] })]

function confirmationFor(args: CreateOrderArgs) {
  return {
    id: 'o1',
    short_id: 'ABC123',
    status: 'new' as const,
    total: args.cart.reduce((s, i) => s + i.unit_price_snapshot * i.quantity, 0),
    created_at: '2026-01-01T00:00:00Z',
  }
}

// Parcurge fluxul complet până la submit: masă → produs → coș → trimite.
async function placeOneOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Masa 7' }))
  await user.click(await screen.findByRole('button', { name: /ciorbă de burtă/i }))
  // ModifierSheet (fără grupuri) → adaugă direct.
  await user.click(screen.getByRole('button', { name: /adaugă în comandă/i }))
  await user.click(screen.getByRole('button', { name: /coș \(1\)/i }))
  await user.click(screen.getByRole('button', { name: /trimite comanda/i }))
}

describe('WaiterEntry — fluxul de bani al comenzii manuale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTablesMock.mockResolvedValue([TABLE])
    fetchMenuMock.mockResolvedValue(MENU)
  })

  it('trimite comanda cu payload-ul corect: masă, source waiter, coș, idempotency key', async () => {
    const user = userEvent.setup()
    createOrderMock.mockImplementation((args: CreateOrderArgs) =>
      Promise.resolve(confirmationFor(args)),
    )
    const onOrderCreated = vi.fn()

    render(<WaiterEntry restaurantId="r1" onClose={vi.fn()} onOrderCreated={onOrderCreated} />)
    await placeOneOrder(user)

    await waitFor(() => expect(onOrderCreated).toHaveBeenCalledTimes(1))
    expect(createOrderMock).toHaveBeenCalledTimes(1)
    const args: CreateOrderArgs = createOrderMock.mock.calls[0][0]
    expect(args.restaurant_id).toBe('r1')
    expect(args.source).toBe('waiter')
    expect(args.table_id).toBe('t1')
    expect(args.qr_token_id).toBeNull()
    expect(args.cart).toHaveLength(1)
    expect(args.cart[0]).toMatchObject({
      product_id: 'p1',
      unit_price_snapshot: 22,
      quantity: 1,
    })
    // Dedup server-side (index UNIQUE pe restaurant_id+idempotency_key).
    expect(args.idempotency_key).toBeTruthy()
  })

  it('totalul din coș reflectă cantitatea (22 × 2 = 44.00 lei)', async () => {
    const user = userEvent.setup()
    render(<WaiterEntry restaurantId="r1" onClose={vi.fn()} onOrderCreated={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Masa 7' }))
    await user.click(await screen.findByRole('button', { name: /ciorbă de burtă/i }))
    await user.click(screen.getByRole('button', { name: /adaugă în comandă/i }))
    await user.click(screen.getByRole('button', { name: /coș \(1\)/i }))

    await user.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByText('Total: 44.00 lei')).toBeInTheDocument()
    // Minusul sub 1 e clamp-uit — două minusuri nu duc totalul la 0.
    await user.click(screen.getByRole('button', { name: '−' }))
    await user.click(screen.getByRole('button', { name: '−' }))
    expect(screen.getByText('Total: 22.00 lei')).toBeInTheDocument()
  })

  it('retry pe eroare de rețea REFOLOSEȘTE aceeași cheie de idempotență (dedup server)', async () => {
    const user = userEvent.setup()
    // Primul apel pică pe rețea, al doilea reușește — bucla internă de retry
    // (1s backoff) trebuie să trimită AMBELE încercări cu aceeași cheie,
    // altfel dedup-ul serverului nu mai leagă retry-ul de comanda originală
    // și un răspuns pierdut poate produce DOUĂ comenzi.
    createOrderMock
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementationOnce((args: CreateOrderArgs) => Promise.resolve(confirmationFor(args)))
    const onOrderCreated = vi.fn()

    render(<WaiterEntry restaurantId="r1" onClose={vi.fn()} onOrderCreated={onOrderCreated} />)
    await placeOneOrder(user)

    // Backoff-ul primului retry e 1s (timere reale) — așteptăm generos.
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2), { timeout: 4000 })
    await waitFor(() => expect(onOrderCreated).toHaveBeenCalledTimes(1))

    const firstKey = (createOrderMock.mock.calls[0][0] as CreateOrderArgs).idempotency_key
    const secondKey = (createOrderMock.mock.calls[1][0] as CreateOrderArgs).idempotency_key
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })

  it('eroare de VALIDARE server: un singur apel (fără retry) + mesajul real afișat', async () => {
    const user = userEvent.setup()
    createOrderMock.mockRejectedValue(
      new Error('Selectează opțiunile obligatorii pentru „Ciorbă de burtă".'),
    )
    const onOrderCreated = vi.fn()

    render(<WaiterEntry restaurantId="r1" onClose={vi.fn()} onOrderCreated={onOrderCreated} />)
    await placeOneOrder(user)

    // Mesajul de business ajunge la ospătar (createOrder aruncă Error real —
    // capcana din CLAUDE.md despre hint-urile missing_required_group).
    expect(
      await screen.findByText(/selectează opțiunile obligatorii/i),
    ).toBeInTheDocument()
    // Erorile non-network NU se retry-uiesc (ar dubla latența degeaba).
    expect(createOrderMock).toHaveBeenCalledTimes(1)
    expect(onOrderCreated).not.toHaveBeenCalled()
  })
})
