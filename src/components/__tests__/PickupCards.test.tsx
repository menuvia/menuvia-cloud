// Cardurile de staff pentru comenzile de RIDICARE (pickup). Înainte nu afișau
// ora, numele sau telefonul clientului, erau ordonate după plasare, iar în
// Bucătărie o pre-comandă pentru diseară stătea cu timer ROȘU de la prânz.
// Ceasul e FIX (vi.setSystemTime) și orele se citesc în Europe/Bucharest —
// fusul procesului de test nu contează.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../contexts/RestaurantContext', () => ({ useRestaurantCtx: vi.fn() }))
vi.mock('../../hooks/useOrders', () => ({ useOrders: vi.fn() }))
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: vi.fn() }))

import { OrderCard as WaiterOrderCard } from '../WaiterOrderCard'
import { KitchenOrderCard } from '../../pages/KitchenPage'
import PickupDetails from '../PickupDetails'
import { makeOrder } from './fixtures'
import {
  isScheduledPickupAhead,
  pickupTimeLabel,
  sortByDue,
  urgencyAnchor,
} from '../../lib/pickupOrders'

// 12:20 EEST pe 20 iulie 2026.
const NOW = new Date('2026-07-20T09:20:00Z')

const pickup = makeOrder({
  id: 'order-pickup-1',
  source: 'pickup',
  created_at: '2026-07-20T09:00:00Z', // 12:00 local — plasată acum 20 de minute
  pickup_time: '2026-07-20T16:00:00Z', // 19:00 local
  customer_name: 'Ana Pop',
  customer_phone: '+40 722 123 456',
})

describe('lib/pickupOrders', () => {
  it('PK1 ora de ridicare în fusul localului (16:00Z = 19:00 EEST)', () => {
    expect(pickupTimeLabel(pickup)).toBe('19:00')
    expect(pickupTimeLabel(makeOrder({ source: 'waiter', pickup_time: pickup.pickup_time }))).toBeNull()
  })

  it('PK2 programat în viitor → nu e întârziat; după oră → ancora e ora promisă', () => {
    expect(isScheduledPickupAhead(pickup, NOW.getTime())).toBe(true)
    expect(isScheduledPickupAhead(pickup, Date.parse('2026-07-20T16:30:00Z'))).toBe(false)
    expect(urgencyAnchor(pickup)).toBe('2026-07-20T16:00:00.000Z')
    const waiter = makeOrder({ created_at: '2026-07-20T09:00:00Z' })
    expect(urgencyAnchor(waiter)).toBe('2026-07-20T09:00:00Z') // control: neschimbat
  })

  it('PK3 sortare după „când trebuie să fie gata", stabilă la egalitate', () => {
    const a = makeOrder({ id: 'a', created_at: '2026-07-20T09:00:00Z' })
    const b = makeOrder({ id: 'b', source: 'pickup', created_at: '2026-07-20T08:00:00Z', pickup_time: '2026-07-20T16:00:00Z' })
    const c = makeOrder({ id: 'c', source: 'pickup', created_at: '2026-07-20T09:10:00Z', pickup_time: '2026-07-20T09:30:00Z' })
    const d = makeOrder({ id: 'd', created_at: '2026-07-20T09:00:00Z' })
    // Ordinea după plasare ar fi b, a, d, c — pre-comanda pentru 19:00 în FRUNTE.
    expect(sortByDue([a, b, c, d]).map((o) => o.id)).toEqual(['a', 'd', 'c', 'b'])
  })
})

describe('PickupDetails', () => {
  it('PK4 pickup → ora, numele și telefonul apelabil', () => {
    render(<PickupDetails order={pickup} now={NOW.getTime()} />)
    expect(screen.getByText('19:00')).toBeInTheDocument()
    expect(screen.getByText('Ana Pop')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /722 123 456/ })).toHaveAttribute('href', 'tel:+40722123456')
  })

  it('PK5 comandă de la masă → nimic randat (control negativ)', () => {
    render(<PickupDetails order={makeOrder({ source: 'qr', customer_name: 'X' })} />)
    expect(screen.queryByTestId('pickup-details')).toBeNull()
  })
})

describe('cardurile de staff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('PK6 Ospătar: cardul pickup arată ora, clientul și telefonul', () => {
    render(<WaiterOrderCard order={pickup} onPayOpen={vi.fn()} onSplitOpen={vi.fn()} />)
    expect(screen.getByText('19:00')).toBeInTheDocument()
    expect(screen.getByText('Ana Pop')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /722 123 456/ })).toBeInTheDocument()
  })

  it('PK7 Bucătărie: pickup programat peste ore → fără timer, chiar dacă e plasat de mult', () => {
    // Plasat acum 3 ore (> pragul roșu de 20 min), ridicare diseară.
    const old = { ...pickup, created_at: '2026-07-20T06:20:00Z' }
    render(<KitchenOrderCard order={old} onAdvance={vi.fn()} />)
    expect(screen.getByText('19:00')).toBeInTheDocument()
    expect(screen.getByText('Ana Pop')).toBeInTheDocument()
    // Timer-ul ar fi afișat „3h 0m" de la plasare.
    expect(screen.queryByText(/^\d+h \d+m$/)).toBeNull()
  })

  it('PK8 Bucătărie: control pozitiv — o comandă de ospătar veche de 3 ore are timer', () => {
    const waiter = makeOrder({ created_at: '2026-07-20T06:20:00Z' })
    render(<KitchenOrderCard order={waiter} onAdvance={vi.fn()} />)
    expect(screen.getByText('3h 0m')).toBeInTheDocument()
    expect(screen.queryByTestId('pickup-details')).toBeNull()
  })

  it('PK9 Bucătărie: pickup întârziat → timer-ul numără de la ora PROMISĂ', () => {
    const late = { ...pickup, pickup_time: '2026-07-20T09:05:00Z' } // promis 12:05, acum 12:20
    render(<KitchenOrderCard order={late} onAdvance={vi.fn()} />)
    expect(screen.getByText('15m')).toBeInTheDocument() // nu „20m" de la plasare
  })
})
