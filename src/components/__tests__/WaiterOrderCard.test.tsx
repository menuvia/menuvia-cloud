// Teste pe OrderCard (WaiterOrderCard) — TRISTATE-ul de plan (audit v3 DS-1 /
// RES-24). Regula de aur în UI: pe `served`, Plan 3 (true) arată Plată
// integrală/parțială; Plan 1/2 (false) arată „Închide comanda" (nefiscal);
// NECUNOSCUT (null) nu arată NICIUN buton de finalizare — o închidere nefiscală
// pe Plan 3 ar însemna bani fără bon. Default-ul prop-ului e null (fail-closed).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderCard } from '../WaiterOrderCard'
import { makeOrder } from './fixtures'
import type { Order } from '../../lib/orders'

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

  it('T4 status ≠ served → fără finalizare indiferent de plan', () => {
    for (const pe of [true, false, null] as const) {
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
