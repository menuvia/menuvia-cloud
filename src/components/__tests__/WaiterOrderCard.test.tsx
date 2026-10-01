// Teste pe OrderCard (WaiterOrderCard) — TRISTATE-ul de plan (audit v3 DS-1 /
// RES-24). Regula de aur în UI: pe `served`, Plan 3 (true) arată Plată
// integrală/parțială; Plan 1/2 (false) arată „Închide comanda" (nefiscal);
// NECUNOSCUT (null) nu arată NICIUN buton de finalizare — o închidere nefiscală
// pe Plan 3 ar însemna bani fără bon. Default-ul prop-ului e null (fail-closed).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderCard } from '../WaiterOrderCard'
import { makeOrder } from './fixtures'
import type { Order } from '../../lib/orders'

// Dialogul de confirmare e un singleton montat în App (<ConfirmRoot/>); în test
// îl înlocuim cu un mock controlabil, ca să vedem DACĂ și CU CE se cere confirmare.
const confirmMock = vi.hoisted(() =>
  vi.fn<(opts: { title: string; description?: string }) => Promise<boolean>>(),
)
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

beforeEach(() => {
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

const FINAL_BUTTON = /^(plată integrală|plată parțială|închide comanda)$/i

function renderCard(order: Order, paymentsEnabled?: boolean | null) {
  const onPayOpen = vi.fn()
  const onSplitOpen = vi.fn()
  const onCloseOrder = vi.fn()
  const props = {
    order,
    onPayOpen,
    onSplitOpen,
    onCloseOrder,
    ...(paymentsEnabled === undefined ? {} : { paymentsEnabled }),
  }
  render(<OrderCard {...props} />)
  return { onPayOpen, onSplitOpen, onCloseOrder }
}

describe('OrderCard — tristate paymentsEnabled', () => {
  it('T1 true (Plan 3) → Plată integrală + parțială, fără „Închide comanda"', async () => {
    const order = makeOrder({ status: 'served' })
    const { onPayOpen, onCloseOrder } = renderCard(order, true)
    expect(screen.getByRole('button', { name: /^plată integrală$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^plată parțială$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^închide comanda$/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^plată integrală$/i }))
    expect(onPayOpen).toHaveBeenCalledWith(order)
    expect(onCloseOrder).not.toHaveBeenCalled()
  })

  it('T2 false (Plan 1/2) → „Închide comanda" nefiscal, fără butoane de plată', async () => {
    const order = makeOrder({ status: 'served' })
    const { onPayOpen, onCloseOrder } = renderCard(order, false)
    expect(screen.getByRole('button', { name: /^închide comanda$/i })).toBeInTheDocument()
    expect(screen.getByText(/plata și bonul se fac pe casa de marcat existentă/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^plată integrală$/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    expect(onCloseOrder).toHaveBeenCalledWith(order)
    expect(onPayOpen).not.toHaveBeenCalled()
  })

  it('T3 null (plan NECUNOSCUT) → NICIUN buton de finalizare, chiar cu handler-ele prezente', () => {
    renderCard(makeOrder({ status: 'served' }), null)
    expect(screen.queryByRole('button', { name: FINAL_BUTTON })).toBeNull()
    expect(screen.getByText(/se verifică planul restaurantului/i)).toBeInTheDocument()
  })

  it('T4 status ≠ served → fără finalizare pe Plan 3 și pe plan necunoscut', () => {
    // (pe Plan 1/2 comanda are „Închide comanda" din orice stare deschisă — T6/T8)
    for (const pe of [true, null] as const) {
      const { unmount } = render(
        <OrderCard
          order={makeOrder({ status: 'ready' })}
          onPayOpen={vi.fn()}
          onSplitOpen={vi.fn()}
          onCloseOrder={vi.fn()}
          paymentsEnabled={pe}
        />,
      )
      expect(screen.queryByRole('button', { name: FINAL_BUTTON })).toBeNull()
      unmount()
    }
  })

  it('T5 prop OMIS → se comportă ca null (default fail-closed)', () => {
    renderCard(makeOrder({ status: 'served' }))
    expect(screen.queryByRole('button', { name: FINAL_BUTTON })).toBeNull()
    expect(screen.getByText(/se verifică planul restaurantului/i)).toBeInTheDocument()
  })
})

// ── Închidere din ORICE stare deschisă (Plan 1/2) + „Închide masa" ───────────
// Pe producție 5 comenzi de ospătar stăteau în `new` de 2–89 zile: butonul
// exista doar din `served`, iar niciun alt drum nu le scotea din Bucătărie.
// Serverul (advance_order close_order, mig 270) acceptă deja toate aceste stări.
describe('OrderCard — „Închide comanda" din orice stare deschisă (Plan 1/2)', () => {
  const OPEN = ['new', 'confirmed', 'preparing', 'ready', 'served'] as const
  const TERMINAL = ['paid', 'cancelled', 'closed'] as const

  function renderPlain(order: Order, paymentsEnabled: boolean | null) {
    return render(
      <OrderCard
        order={order}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
        onCloseOrder={vi.fn()}
        paymentsEnabled={paymentsEnabled}
      />,
    )
  }

  it('T6 false → butonul apare pe FIECARE stare deschisă și pe NICIUNA terminală', () => {
    for (const status of OPEN) {
      const { unmount } = renderPlain(makeOrder({ status }), false)
      expect(screen.getByRole('button', { name: /^închide comanda$/i }), status).toBeInTheDocument()
      unmount()
    }
    for (const status of TERMINAL) {
      const { unmount } = renderPlain(makeOrder({ status }), false)
      expect(screen.queryByRole('button', { name: /^închide comanda$/i }), status).toBeNull()
      unmount()
    }
  })

  it('T7 true / null → NICIO „Închide comanda" pe stările ne-servite (regula de aur)', () => {
    for (const pe of [true, null] as const) {
      for (const status of ['new', 'confirmed', 'preparing', 'ready'] as const) {
        const { unmount } = renderPlain(makeOrder({ status }), pe)
        expect(
          screen.queryByRole('button', { name: /^închide comanda$/i }),
          `${String(pe)}/${status}`,
        ).toBeNull()
        unmount()
      }
    }
  })

  it('T8 din `new` cere confirmare (avertizează că se scade stoc / se dau puncte) și închide doar după „da"', async () => {
    const order = makeOrder({ status: 'new' })
    const { onCloseOrder } = renderCard(order, false)
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    const opts = confirmMock.mock.calls[0]![0]
    expect(opts.title).toMatch(/înainte să fie servită/i)
    expect(opts.description).toMatch(/stocul/i)
    expect(opts.description).toMatch(/anulează/i)
    await waitFor(() => expect(onCloseOrder).toHaveBeenCalledWith(order))
  })

  it('T9 confirmare REFUZATĂ → comanda NU se închide', async () => {
    confirmMock.mockResolvedValue(false)
    const { onCloseOrder } = renderCard(makeOrder({ status: 'preparing' }), false)
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(onCloseOrder).not.toHaveBeenCalled()
  })

  it('T10 din `served` NU se cere confirmare (pasul normal, ca înainte)', async () => {
    const order = makeOrder({ status: 'served' })
    const { onCloseOrder } = renderCard(order, false)
    await userEvent.click(screen.getByRole('button', { name: /^închide comanda$/i }))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onCloseOrder).toHaveBeenCalledWith(order)
  })
})

describe('OrderCard — „Închide masa" (închide sesiunea)', () => {
  function renderWithTable(order: Order, paymentsEnabled: boolean | null) {
    const onCloseTable = vi.fn()
    render(
      <OrderCard
        order={order}
        onPayOpen={vi.fn()}
        onSplitOpen={vi.fn()}
        onCloseOrder={vi.fn()}
        onCloseTable={onCloseTable}
        paymentsEnabled={paymentsEnabled}
      />,
    )
    return { onCloseTable }
  }

  it('T11 comandă cu session_id + Plan 1/2 → „Închide masa" cere confirmare apoi cheamă handlerul', async () => {
    const order = makeOrder({ status: 'ready', session_id: 'sess-1' })
    const { onCloseTable } = renderWithTable(order, false)
    await userEvent.click(screen.getByRole('button', { name: /^închide masa$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0]![0].title).toMatch(/închizi masa/i)
    await waitFor(() => expect(onCloseTable).toHaveBeenCalledWith(order))
  })

  it('T12 confirmare refuzată → sesiunea NU se închide', async () => {
    confirmMock.mockResolvedValue(false)
    const { onCloseTable } = renderWithTable(
      makeOrder({ status: 'served', session_id: 'sess-1' }),
      false,
    )
    await userEvent.click(screen.getByRole('button', { name: /^închide masa$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(onCloseTable).not.toHaveBeenCalled()
  })

  it('T13 fără session_id (comandă de ospătar) sau pe Plan 3 / plan necunoscut → fără „Închide masa"', () => {
    const cases: [Order, boolean | null][] = [
      [makeOrder({ status: 'served', session_id: null }), false],
      [makeOrder({ status: 'served' }), false],
      [makeOrder({ status: 'served', session_id: 'sess-1' }), true],
      [makeOrder({ status: 'served', session_id: 'sess-1' }), null],
    ]
    for (const [order, pe] of cases) {
      const { unmount } = render(
        <OrderCard
          order={order}
          onPayOpen={vi.fn()}
          onSplitOpen={vi.fn()}
          onCloseOrder={vi.fn()}
          onCloseTable={vi.fn()}
          paymentsEnabled={pe}
        />,
      )
      expect(screen.queryByRole('button', { name: /^închide masa$/i })).toBeNull()
      unmount()
    }
  })
})
