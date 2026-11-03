// „Toate locațiile" (lotul A, mig 314) — ecranul.
//
//   LT1  două locații → câte un card, cu comenzile de azi, deschise acum și
//        ultima comandă; încasările apar DOAR pe locația cu sumă (non-null) —
//        pe cea cu `revenueToday: null` NU se afișează „0 lei" (nici
//        eticheta „Încasări azi"). Mutația care pică: `fmtPrice(loc.revenueToday ?? 0)`
//        afișat necondiționat.
//   LT2  „Deschide" pe cardul altei locații → `onOpen(id)`; locația curentă
//        are „Deschisă acum", fără buton. Mutația care pică: butonul legat de
//        `activeId` în loc de id-ul cardului.
//   LT3  eroare → mesajul în română + „Reîncearcă", fără nicio cifră;
//        „Reîncearcă" refă cererea și arată cardurile. Mutația care pică:
//        eroarea colapsată la „nicio locație" (listă goală).
//   LT4  RPC nedeployat (`null`) → „nu este încă disponibil", NU „nicio
//        locație". Control: o listă goală REALĂ spune „nicio locație".
//        Mutația care pică: `rows ?? []`.
//   LT5  cât se încarcă: nicio cifră și niciun mesaj afirmat.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LocationSummary } from '../../lib/locations'

const m = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../lib/locations', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/locations')),
  fetchLocationsSummary: m.fetch,
}))

import LocationsTab from '../LocationsTab'

const A: LocationSummary = {
  id: 'r1',
  name: 'Bistro Centru',
  slug: 'bistro-centru',
  ordersToday: 12,
  openOrders: 3,
  revenueToday: 845.5,
  lastOrderAt: new Date().toISOString(),
}
const B: LocationSummary = {
  id: 'r2',
  name: 'Bistro Gară',
  slug: 'bistro-gara',
  ordersToday: 4,
  openOrders: 1,
  revenueToday: null,
  lastOrderAt: null,
}

beforeEach(() => {
  m.fetch.mockReset()
})

const card = (name: string) => {
  const heading = screen.getByRole('heading', { name })
  const el = heading.closest('[data-testid="location-card"]')
  if (!(el instanceof HTMLElement)) throw new Error(`cardul ${name} lipsește`)
  return el
}

describe('LocationsTab', () => {
  it('LT1: un card per locație; încasările doar unde există suma', async () => {
    m.fetch.mockResolvedValue([A, B])
    render(<LocationsTab activeId="r1" onOpen={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Bistro Centru' })).toBeInTheDocument()
    expect(screen.getAllByTestId('location-card')).toHaveLength(2)

    const a = within(card('Bistro Centru'))
    expect(a.getByText('12')).toBeInTheDocument()
    expect(a.getByText('3')).toBeInTheDocument()
    expect(a.getByText('Încasări azi')).toBeInTheDocument()
    expect(a.getByText('845.50 lei')).toBeInTheDocument()
    expect(a.getByText(/^azi, \d{2}:\d{2}$/)).toBeInTheDocument()

    const b = card('Bistro Gară')
    expect(within(b).getByText('4')).toBeInTheDocument()
    expect(within(b).queryByText('Încasări azi')).toBeNull()
    expect(b.textContent ?? '').not.toMatch(/lei/)
    expect(within(b).getByText('Nicio comandă încă')).toBeInTheDocument()
  })

  it('LT2: „Deschide" trimite id-ul cardului; locația curentă nu are buton', async () => {
    m.fetch.mockResolvedValue([A, B])
    const onOpen = vi.fn()
    render(<LocationsTab activeId="r1" onOpen={onOpen} />)
    await screen.findByRole('heading', { name: 'Bistro Gară' })
    expect(within(card('Bistro Centru')).queryByRole('button')).toBeNull()
    expect(within(card('Bistro Centru')).getByText('Deschisă acum')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Deschide Bistro Gară' }))
    expect(onOpen).toHaveBeenCalledWith('r2')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('LT3: eroare → mesaj + „Reîncearcă"; reîncercarea aduce cardurile', async () => {
    m.fetch.mockRejectedValueOnce(new Error('Nu am putut încărca rezumatul locațiilor.'))
    m.fetch.mockResolvedValueOnce([A, B])
    render(<LocationsTab activeId="r1" onOpen={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Nu am putut încărca rezumatul locațiilor.')
    expect(screen.queryAllByTestId('location-card')).toHaveLength(0)
    expect(screen.queryByText(/nicio locație/i)).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(await screen.findAllByTestId('location-card')).toHaveLength(2)
    expect(m.fetch).toHaveBeenCalledTimes(2)
  })

  it('LT4: RPC nedeployat → „nu este încă disponibil", nu „nicio locație"', async () => {
    m.fetch.mockResolvedValue(null)
    const { unmount } = render(<LocationsTab activeId="r1" onOpen={vi.fn()} />)
    expect(await screen.findByText(/nu este încă disponibil/)).toBeInTheDocument()
    expect(screen.queryByText(/nicio locație/i)).toBeNull()
    unmount()
    // Control: lista goală REALĂ.
    m.fetch.mockResolvedValue([])
    render(<LocationsTab activeId="r1" onOpen={vi.fn()} />)
    expect(await screen.findByText(/nicio locație/i)).toBeInTheDocument()
    expect(screen.queryByText(/nu este încă disponibil/)).toBeNull()
  })

  it('LT5: cât se încarcă nu se afirmă nimic', () => {
    m.fetch.mockReturnValue(new Promise(() => {}))
    render(<LocationsTab activeId="r1" onOpen={vi.fn()} />)
    expect(screen.queryAllByTestId('location-card')).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/nicio locație|nu este încă disponibil/i)).toBeNull()
  })
})
