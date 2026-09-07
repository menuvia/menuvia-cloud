// Teste pe PickupCheckoutSheet — fluxul de bani al comenzii cu ridicare
// (audit v3 FC-01 / RES-24). Cheia de idempotență e SINGURA barieră contra
// comenzii pickup DUBLE la răspuns pierdut: trebuie să fie STABILĂ între
// retrimiteri (inclusiv după închiderea/redeschiderea sheet-ului) și ROTITĂ
// doar pe succes. Înainte de #237 stătea într-un useRef care murea cu sheet-ul.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { createOrderMock } = vi.hoisted(() => ({ createOrderMock: vi.fn() }))

vi.mock('../../lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orders')>()
  return { ...actual, createOrder: createOrderMock }
})
// Sloturi deterministe (fără ceas); componenta le formatează cu
// toLocaleTimeString și trimite ISO-ul brut ca pickup_time.
vi.mock('../../lib/pickupSlots', () => ({
  buildPickupSlots: () => ['2026-09-07T10:00:00.000Z', '2026-09-07T10:30:00.000Z'],
}))

import PickupCheckoutSheet from '../PickupCheckoutSheet'
import { getTheme } from '../../lib/themes'
import { makeRestaurant, makeCartItem } from './fixtures'
import type { CreateOrderArgs } from '../../lib/orders'

const STORAGE_KEY = 'menuvia_idem_pickup:demo'
const PUB = {
  bg: '#fff',
  surface: '#f6f6f6',
  text: '#111',
  text2: '#444',
  text3: '#777',
  border: '#ddd',
  borderStrong: '#bbb',
}

function renderSheet(onSuccess = vi.fn()) {
  return render(
    <PickupCheckoutSheet
      restaurant={makeRestaurant({ slug: 'demo' })}
      cart={[makeCartItem({ quantity: 1 })]}
      cartTotal={30}
      theme={getTheme('cafe')}
      accent="#c8102e"
      PUB={PUB}
      onClose={() => {}}
      onSuccess={onSuccess}
    />,
  )
}

async function fillAndSubmit(): Promise<void> {
  await userEvent.type(screen.getByPlaceholderText('Ion Popescu'), 'Ana Pop')
  await userEvent.type(screen.getByPlaceholderText('07XX XXX XXX'), '0722000111')
  // Slotul e OBLIGATORIU (validare necondiționată); îl alegem după formă, nu
  // după textul exact — eticheta depinde de fusul orar al runner-ului.
  const slot = screen.getAllByRole('button').find((b) => /^\d{1,2}:\d{2}$/.test(b.textContent ?? ''))
  if (!slot) throw new Error('niciun slot randat')
  await userEvent.click(slot)
  await userEvent.click(screen.getByRole('button', { name: /trimite comanda/i }))
}

function sentKey(callIndex: number): string | undefined {
  const args = createOrderMock.mock.calls[callIndex]?.[0] as CreateOrderArgs | undefined
  return args?.idempotency_key
}

describe('PickupCheckoutSheet — idempotența comenzii pickup', () => {
  beforeEach(() => {
    sessionStorage.clear()
    createOrderMock.mockReset()
  })

  it('S1 submit trimite source=pickup, fără masă, cu cheia din sessionStorage', async () => {
    createOrderMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'new', total: 30 })
    renderSheet()
    const persisted = sessionStorage.getItem(STORAGE_KEY)
    expect(persisted).toBeTruthy()
    await fillAndSubmit()
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1))
    const args = createOrderMock.mock.calls[0][0] as CreateOrderArgs
    expect(args.source).toBe('pickup')
    expect(args.table_id).toBeNull()
    expect(args.pickup_time).toBe('2026-09-07T10:00:00.000Z')
    expect(args.idempotency_key).toBe(persisted)
  })

  it('S2 eșec → eroare afișată, cheia NESCHIMBATĂ, retrimiterea refolosește aceeași cheie', async () => {
    createOrderMock
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'o1', short_id: 'ABC123', status: 'new', total: 30 })
    const onSuccess = vi.fn()
    renderSheet(onSuccess)
    const before = sessionStorage.getItem(STORAGE_KEY)
    await fillAndSubmit()
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/comanda nu s-a trimis/i)).toBeInTheDocument()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(onSuccess).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /trimite comanda/i }))
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2))
    expect(sentKey(1)).toBe(sentKey(0))
  })

  it('S3 eșec → sheet închis și redeschis → aceeași cheie (miezul FC-01)', async () => {
    createOrderMock.mockRejectedValueOnce(new Error('Failed to fetch'))
    const first = renderSheet()
    await fillAndSubmit()
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1))
    first.unmount()

    createOrderMock.mockResolvedValueOnce({ id: 'o1', short_id: 'ABC123', status: 'new', total: 30 })
    renderSheet()
    await fillAndSubmit()
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2))
    expect(sentKey(1)).toBe(sentKey(0))
  })

  it('S4 succes → onSuccess o dată, cheia din storage e ROTITĂ (≠ cea trimisă)', async () => {
    createOrderMock.mockResolvedValue({ id: 'o1', short_id: 'ABC123', status: 'new', total: 30 })
    const onSuccess = vi.fn()
    renderSheet(onSuccess)
    await fillAndSubmit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith('ABC123', '2026-09-07T10:00:00.000Z', 30)
    const after = sessionStorage.getItem(STORAGE_KEY)
    expect(after).toBeTruthy()
    expect(after).not.toBe(sentKey(0))
  })
})
