// Panoul „Epuizate” al personalului (mig 313, lotul B) — bucătărie + ospătar.
//
//   SS1  lista vine din fetchStaffSoldOutProducts, cu sursa pe rând („Epuizat ·
//        din stoc”); butonul unui produs disponibil cheamă RPC-ul
//        `setProductSoldOut(id, true)` — NU un UPDATE direct, pe care ospătarul
//        nu-l are — și rândul trece pe „Epuizat · manual”. Mutația care pică:
//        `!p.is_sold_out` → `p.is_sold_out` în toggle (starea inversă trimisă),
//        sau starea întoarsă de server necontopită în rând.
//   SS2  refuzul serverului se afișează pe RÂNDUL produsului, prin toUserMessage
//        (42501 → textul românesc de drepturi), nu ca text brut; rândul rămâne
//        neschimbat. Mutația care pică: eroarea înghițită (catch gol) sau
//        `e.message` afișat brut.
//   SS3  eroarea de încărcare are „Reîncearcă”, care reface citirea. Mutația
//        care pică: `reloadKey` scos din dependențele efectului.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({ fetch: vi.fn(), set: vi.fn() }))

vi.mock('../../lib/soldOut', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/soldOut')>()
  return { ...actual, fetchStaffSoldOutProducts: m.fetch, setProductSoldOut: m.set }
})

import StaffSoldOutSheet from '../StaffSoldOutSheet'
import { MSG_NO_PERMISSION } from '../../lib/userMessages'

const ROWS = [
  {
    id: 'p-supa',
    name: 'Supă',
    emoji: '🍲',
    is_sold_out: true,
    sold_out_source: 'stock',
    display_order: 1,
  },
  {
    id: 'p-apa',
    name: 'Apă',
    emoji: '💧',
    is_sold_out: false,
    sold_out_source: null,
    display_order: 0,
  },
]

beforeEach(() => {
  m.fetch.mockReset()
  m.set.mockReset()
})

describe('StaffSoldOutSheet', () => {
  it('SS1 lista cu sursa; „Marchează epuizat” cheamă RPC-ul și actualizează rândul', async () => {
    const user = userEvent.setup()
    m.fetch.mockResolvedValue(ROWS)
    m.set.mockResolvedValue({ is_sold_out: true, sold_out_source: 'manual' })
    render(<StaffSoldOutSheet restaurantId="r1" onClose={vi.fn()} />)

    expect(await screen.findByText('Epuizat · din stoc')).toBeInTheDocument()
    expect(m.fetch).toHaveBeenCalledWith('r1')
    expect(screen.getByText('1 produs epuizat.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Marchează epuizat: Apă' }))
    expect(m.set).toHaveBeenCalledWith('p-apa', true)
    expect(await screen.findByText('Epuizat · manual')).toBeInTheDocument()
    expect(screen.getByText('2 produse epuizate.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marchează disponibil: Apă' })).toBeInTheDocument()
  })

  it('SS2 refuzul serverului apare pe rând, în română; rândul rămâne neschimbat', async () => {
    const user = userEvent.setup()
    m.fetch.mockResolvedValue(ROWS)
    m.set.mockRejectedValue(
      Object.assign(new Error('permission denied for function set_product_sold_out'), {
        code: '42501',
      }),
    )
    render(<StaffSoldOutSheet restaurantId="r1" onClose={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Marchează disponibil: Supă' }))
    expect(m.set).toHaveBeenCalledWith('p-supa', false)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(MSG_NO_PERMISSION)
    expect(alert.textContent).not.toContain('permission denied')
    expect(screen.getByText('Epuizat · din stoc')).toBeInTheDocument()
  })

  it('SS3 eroarea de încărcare are „Reîncearcă”, care reface citirea', async () => {
    const user = userEvent.setup()
    m.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ROWS)
    render(<StaffSoldOutSheet restaurantId="r1" onClose={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Reîncearcă' }))
    await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Epuizat · din stoc')).toBeInTheDocument()
  })
})
