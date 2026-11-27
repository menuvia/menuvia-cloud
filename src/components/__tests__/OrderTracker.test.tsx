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

// Lotul C8b: după trimitere banii vin din payload-ul SERVERULUI. create_order
// întoarce totalul DINAINTEA reducerii (contract mig 191, HH1 — 24.00 vs
// 21.60), iar Happy Hour se aplică la COMMIT (trigger amânat, mig 077); poll-ul
// aducea deja `total` + `discount_amount`, dar ecranul afișa `confirmation.total`.
// Mutațiile care pică: totalul afișat revenit la `confirmation.total` (SVT1,
// SVT3); `onServerTotal` necomunicat părintelui (SVT1 — butonul „Plătește
// masa” rămânea pe prețul întreg); deduplicarea scoasă (SVT1, un apel per
// poll); ActiveOrdersBanner care citește doar statusul (SVT4). Controale
// pozitive: payload-ul MINIM (fără sesiune, mig 092) păstrează totalul știut și
// nu raportează nimic (SVT2, SVT5).
describe('OrderTracker — totalul confirmat de server (Happy Hour, lotul C8b)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    statusMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('SVT1 totalul și reducerea vin din poll; părintele află o singură dată', async () => {
    statusMock.mockResolvedValue({
      id: 'o1',
      short_id: 'ABC123',
      status: 'preparing',
      total: 27,
      discount_amount: 3,
    })
    const onServerTotal = vi.fn()
    render(
      <OrderTracker
        confirmation={CONF}
        accent="#000"
        onReset={() => {}}
        previousOrders={[]}
        sessionId="s1"
        onServerTotal={onServerTotal}
      />,
    )
    await tick(0)
    expect(screen.getByText('27.00 lei')).toBeInTheDocument()
    expect(screen.queryByText('30.00 lei')).not.toBeInTheDocument()
    expect(screen.getByTestId('ot-discount')).toHaveTextContent('Reducere aplicată: −3.00 lei')
    await tick(5000 * 2)
    expect(statusMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(onServerTotal).toHaveBeenCalledTimes(1)
    expect(onServerTotal).toHaveBeenCalledWith('o1', 27)
  })

  it('SVT2 payload minim (fără bani) → totalul știut, fără rândul de reducere, fără raport', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing' })
    const onServerTotal = vi.fn()
    render(
      <OrderTracker
        confirmation={CONF}
        accent="#000"
        onReset={() => {}}
        previousOrders={[]}
        onServerTotal={onServerTotal}
      />,
    )
    await tick(0)
    expect(screen.getByText('30.00 lei')).toBeInTheDocument()
    expect(screen.queryByTestId('ot-discount')).not.toBeInTheDocument()
    expect(onServerTotal).not.toHaveBeenCalled()
  })

  it('SVT3 totalul sesiunii și ecranul `closed` folosesc numărul serverului', async () => {
    statusMock.mockResolvedValueOnce({
      id: 'o1',
      short_id: 'ABC123',
      status: 'preparing',
      total: 27,
      discount_amount: 3,
    })
    const prev: OrderConfirmationPayload = { ...CONF, id: 'o0', short_id: 'ZZZ999', total: 10 }
    render(
      <OrderTracker
        confirmation={CONF}
        accent="#000"
        onReset={() => {}}
        previousOrders={[prev]}
        sessionId="s1"
      />,
    )
    await tick(0)
    // 10 (runda anterioară) + 27 (server), nu 10 + 30.
    expect(screen.getByText(/37\.00 lei/)).toBeInTheDocument()

    statusMock.mockResolvedValue({
      id: 'o1',
      short_id: 'ABC123',
      status: 'closed',
      total: 27,
      discount_amount: 3,
    })
    await tick(5000)
    expect(screen.getByRole('status')).toHaveTextContent(/27\.00 lei/)
    expect(screen.getByRole('status')).not.toHaveTextContent(/30\.00 lei/)
  })

  it('SVT4 ActiveOrdersBanner: totalul de server în antet + raportat părintelui', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing', total: 27 })
    const onServerTotal = vi.fn()
    render(
      <ActiveOrdersBanner
        orders={[CONF]}
        accent="#000"
        onAddMore={() => {}}
        sessionId="s1"
        onServerTotal={onServerTotal}
      />,
    )
    await tick(0)
    expect(screen.getByText(/27\.00 lei/)).toBeInTheDocument()
    expect(screen.queryByText(/30\.00 lei/)).not.toBeInTheDocument()
    expect(onServerTotal).toHaveBeenCalledWith('o1', 27)
  })

  it('SVT5 ActiveOrdersBanner: payload minim → totalul din listă, fără raport', async () => {
    statusMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'preparing' })
    const onServerTotal = vi.fn()
    render(
      <ActiveOrdersBanner
        orders={[CONF]}
        accent="#000"
        onAddMore={() => {}}
        onServerTotal={onServerTotal}
      />,
    )
    await tick(0)
    expect(screen.getByText(/30\.00 lei/)).toBeInTheDocument()
    expect(onServerTotal).not.toHaveBeenCalled()
  })
})
