// Teste pe polling-ul din OrderTracker (audit v3 RES-36). După o stare
// TERMINALĂ a serverului (paid/cancelled/closed) nimic nu mai variază, deci
// polling-ul anon (get_order_public_status, fără rate-limit) trebuie să se
// OPREASCĂ. Înainte, `paid` rămânea poll-uit la 5 s cât timp ecranul „Plată
// confirmată" stătea deschis — pe o justificare falsă.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }))
vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, getOrderPublicStatus: statusMock, requestFiscalReceipt: vi.fn() }
})

import { OrderTracker } from '../OrderTracker'
import type { OrderConfirmationPayload } from '../../lib/orders'

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

  it('cancelled → un singur poll (paritate cu paid/closed)', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'cancelled', total: 30 })
    render(<OrderTracker confirmation={CONF} accent="#000" onReset={() => {}} previousOrders={[]} sessionId="s1" />)
    await tick(0)
    await tick(5000 * 3)
    expect(statusMock).toHaveBeenCalledTimes(1)
  })
})
