// Teste pe WaiterEntry — comanda manuală a ospătarului (flux de bani):
//   - masă → meniu → produs → coș → submit cu payload-ul corect
//   - idempotency key: STABIL pe durata unui coș, ROTIT după succes
//   - eroare de validare server (ex. missing_required_group): NU se
//     retry-uiește, mesajul real ajunge la ospătar
//   - meniul pornește la montare, în PARALEL cu mesele, și nu se re-descarcă
//     la fiecare masă / redeschidere (perf-staff-2)
//   - „✕" cu produse în coș cere confirmare (ux-staff-entry-discard)
//   - pagina primește confirmarea (ux-staff-order-sent-feedback)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchTablesMock, createOrderMock, fetchMenuMock, confirmMock } = vi.hoisted(() => ({
  fetchTablesMock: vi.fn(),
  createOrderMock: vi.fn(),
  fetchMenuMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, fetchTables: fetchTablesMock, createOrder: createOrderMock }
})
vi.mock('../../lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/qr')>()
  return { ...actual, fetchMenuForRestaurant: fetchMenuMock }
})
// Dialogul de confirmare e un singleton montat în App; aici e controlabil.
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

import WaiterEntry from '../WaiterEntry'
import { STAFF_MENU_TTL_MS } from '../../lib/staffMenuCache'
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
    // Pagina primește CONFIRMAREA (ca să-i spună ospătarului unde a ajuns
    // comanda). Mutație: vechiul `onOrderCreated()` fără argument → pică.
    expect(onOrderCreated).toHaveBeenCalledWith(expect.objectContaining({ short_id: 'ABC123' }))
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

describe('WaiterEntry — meniul în paralel, fără re-descărcare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTablesMock.mockResolvedValue([TABLE])
    fetchMenuMock.mockResolvedValue(MENU)
  })

  it('WE1 meniul se cere la MONTARE, în paralel cu mesele — nu după alegerea mesei', async () => {
    // Mutație: revino la cererea meniului din goToMenu → 0 apeluri înainte de tap.
    render(<WaiterEntry restaurantId="r-we1" onClose={vi.fn()} onOrderCreated={vi.fn()} />)
    await screen.findByRole('button', { name: 'Masa 7' })
    expect(fetchMenuMock).toHaveBeenCalledWith('r-we1')
    expect(fetchMenuMock).toHaveBeenCalledTimes(1)
  })

  it('WE2 alegerea mesei și redeschiderea foii NU re-descarcă arborele meniului', async () => {
    // Mutație: `fetchMenuForRestaurant` la fiecare goToMenu / montare → 2+ apeluri.
    const user = userEvent.setup()
    const first = render(
      <WaiterEntry restaurantId="r-we2" onClose={vi.fn()} onOrderCreated={vi.fn()} />,
    )
    await user.click(await screen.findByRole('button', { name: 'Masa 7' }))
    expect(await screen.findByRole('button', { name: /ciorbă de burtă/i })).toBeInTheDocument()
    first.unmount()

    render(<WaiterEntry restaurantId="r-we2" onClose={vi.fn()} onOrderCreated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Masa 7' }))
    expect(await screen.findByRole('button', { name: /ciorbă de burtă/i })).toBeInTheDocument()
    expect(fetchMenuMock).toHaveBeenCalledTimes(1)
  })

  it('WE4 foaia ținută deschisă peste TTL: alegerea mesei cere meniul din nou', async () => {
    // Recenzie CodeRabbit pe #321. Mutația care pică: promisiunea de la montare
    // ținută într-un ref și refolosită la alegerea mesei → 1 apel, meniu vechi
    // (prețuri / „Epuizat") cât stă foaia deschisă.
    const user = userEvent.setup()
    const realNow = Date.now.bind(Date)
    let offset = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    try {
      render(<WaiterEntry restaurantId="r-we4" onClose={vi.fn()} onOrderCreated={vi.fn()} />)
      const table = await screen.findByRole('button', { name: 'Masa 7' })
      expect(fetchMenuMock).toHaveBeenCalledTimes(1)
      offset = STAFF_MENU_TTL_MS + 1_000
      await user.click(table)
      expect(await screen.findByRole('button', { name: /ciorbă de burtă/i })).toBeInTheDocument()
      expect(fetchMenuMock).toHaveBeenCalledTimes(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('WE3 meniul picat la montare nu rămâne „lipit": alegerea mesei îl cere din nou', async () => {
    // Mutație: fără resetarea promisiunii la eșec, alegerea mesei refolosește
    // promisiunea respinsă → „Nu s-a putut încărca meniul" la nesfârșit.
    const user = userEvent.setup()
    fetchMenuMock.mockRejectedValueOnce(new Error('TypeError: Load failed'))
    render(<WaiterEntry restaurantId="r-we3" onClose={vi.fn()} onOrderCreated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Masa 7' }))
    expect(await screen.findByRole('button', { name: /ciorbă de burtă/i })).toBeInTheDocument()
    expect(fetchMenuMock).toHaveBeenCalledTimes(2)
  })
})

describe('WaiterEntry — „✕" nu aruncă coșul fără întrebare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTablesMock.mockResolvedValue([TABLE])
    fetchMenuMock.mockResolvedValue(MENU)
  })

  async function addOne(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Masa 7' }))
    await user.click(await screen.findByRole('button', { name: /ciorbă de burtă/i }))
    await user.click(screen.getByRole('button', { name: /adaugă în comandă/i }))
    await screen.findByRole('button', { name: /coș \(1\)/i })
  }

  it('ED1 cu produse în coș, „✕" cere confirmare; „Continuă comanda" păstrează coșul', async () => {
    // Mutație: `onClick={onClose}` pe „✕" → onClose chemat fără întrebare.
    const user = userEvent.setup()
    confirmMock.mockResolvedValue(false)
    const onClose = vi.fn()
    render(<WaiterEntry restaurantId="r1" onClose={onClose} onOrderCreated={vi.fn()} />)
    await addOne(user)

    await user.click(screen.getByRole('button', { name: 'Închide comanda nouă' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /coș \(1\)/i })).toBeInTheDocument()
  })

  it('ED2 confirmarea „Renunță la comandă" închide foaia', async () => {
    const user = userEvent.setup()
    confirmMock.mockResolvedValue(true)
    const onClose = vi.fn()
    render(<WaiterEntry restaurantId="r1" onClose={onClose} onOrderCreated={vi.fn()} />)
    await addOne(user)

    await user.click(screen.getByRole('button', { name: 'Închide comanda nouă' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('ED3 control: coș gol → „✕" închide direct, fără dialog', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<WaiterEntry restaurantId="r1" onClose={onClose} onOrderCreated={vi.fn()} />)
    await screen.findByRole('button', { name: 'Masa 7' })
    await user.click(screen.getByRole('button', { name: 'Închide comanda nouă' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(confirmMock).not.toHaveBeenCalled()
  })
})
