// Teste pe polling-ul din OrderTracker (audit v3 RES-36). După o stare
// TERMINALĂ a serverului (paid/cancelled/closed) nimic nu mai variază, deci
// polling-ul anon (get_order_public_status, fără rate-limit) trebuie să se
// OPREASCĂ. Înainte, `paid` rămânea poll-uit la 5 s cât timp ecranul „Plată
// confirmată" stătea deschis — pe o justificare falsă.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }))
vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, getOrderPublicStatus: statusMock, requestFiscalReceipt: vi.fn() }
})

import { OrderTracker, ActiveOrdersBanner } from '../OrderTracker'
import type { OrderConfirmationPayload } from '../../lib/orders'
import { readableTextOn } from '../../lib/themes'

const CONF: OrderConfirmationPayload = {
  id: 'o1',
  short_id: 'ABC123',
  status: 'new',
  total: 30,
  created_at: '2026-09-07T10:00:00Z',
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('OrderTracker — polling-ul se oprește pe stări terminale', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    statusMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('paid → un singur poll, apoi intervalul e oprit', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'paid', total: 30, paid_amount: 30, tips_amount: 0 })
    render(<OrderTracker confirmation={CONF} accent="#000" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
    await tick(0)
    expect(statusMock).toHaveBeenCalledTimes(1)
    await tick(5000 * 4)
    expect(statusMock).toHaveBeenCalledTimes(1)
  })

  it('preparing (ne-terminal) → polling-ul continuă la fiecare 5 s (control pozitiv)', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing', total: 30 })
    render(<OrderTracker confirmation={CONF} accent="#000" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
    await tick(0)
    expect(statusMock).toHaveBeenCalledTimes(1)
    await tick(5000 * 3)
    expect(statusMock.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  // perf-guest-11: după servire mai urmează doar închiderea/plata (minute), deci
  // ritmul de 5 s pe toată durata mesei era risipă pe un RPC anon nelimitat.
  // Mutația care pică: intervalul fix de 5 s (aici ar fi 4 apeluri, nu 1).
  it('served → ritmul încetinește la 20 s', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'served', total: 30 })
    render(<OrderTracker confirmation={CONF} accent="#000" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
    await tick(0)
    expect(statusMock).toHaveBeenCalledTimes(1)
    await tick(15000)
    expect(statusMock).toHaveBeenCalledTimes(1)
    await tick(5000)
    expect(statusMock).toHaveBeenCalledTimes(2)
  })

  // perf-guest-11: cu fila ascunsă nu pleacă nicio cerere, iar la revenire
  // starea vine IMEDIAT, nu la următorul tick. Mutația care pică: fără
  // ascultătorul de `visibilitychange`.
  it('fila ascunsă → zero cereri; la revenire → poll imediat', async () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    try {
      statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing', total: 30 })
      render(<OrderTracker confirmation={CONF} accent="#000" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
      await tick(0)
      expect(statusMock).toHaveBeenCalledTimes(1)
      hidden = true
      await tick(30000)
      expect(statusMock).toHaveBeenCalledTimes(1)
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await tick(0)
      expect(statusMock).toHaveBeenCalledTimes(2)
    } finally {
      Reflect.deleteProperty(document, 'hidden')
    }
  })

  it('ActiveOrdersBanner: la revenirea în tab reîmprospătează imediat', async () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    try {
      statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing', total: 30 })
      render(<ActiveOrdersBanner orders={[CONF]} accent="#000" onAddMore={() => {}} sessionId="s1" />)
      await tick(0)
      expect(statusMock).toHaveBeenCalledTimes(1)
      hidden = true
      await tick(12000)
      expect(statusMock).toHaveBeenCalledTimes(1)
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await tick(0)
      expect(statusMock).toHaveBeenCalledTimes(2)
    } finally {
      Reflect.deleteProperty(document, 'hidden')
    }
  })

  it('cancelled → un singur poll (paritate cu paid/closed)', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'cancelled', total: 30 })
    render(<OrderTracker confirmation={CONF} accent="#000" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
    await tick(0)
    await tick(5000 * 3)
    expect(statusMock).toHaveBeenCalledTimes(1)
  })
})

// ux-guest-4: pe auriul implicit din Setări albul are 2,66:1. Mutația care pică:
// `color: '#fff'` readus pe „+ Adaugă produse" (ecranul de urmărire).
describe('OrderTracker — text lizibil peste accent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    statusMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('„+ Adaugă produse" folosește culoarea calculată, nu alb', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing', total: 30 })
    render(<OrderTracker confirmation={CONF} accent="#C8963C" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
    await tick(0)
    const expected = readableTextOn('#C8963C', '#1A1208')
    expect(expected).not.toBe('#FFFFFF')
    expect(screen.getByRole('button', { name: /adaugă produse/i })).toHaveStyle({ color: expected })
  })
})
