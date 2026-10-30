// Teste pe „Clienții mei" din panoul agentului de vânzări (AfiliatPage), mig 286/303.
// Regula centrală: „Editează meniul" (intrarea pe dashboard-ul clientului) apare
// DOAR când patronul a acordat accesul. Fără el (nimic cerut / cerere trimisă /
// revocat) agentul vede doar starea și, unde are sens, „Cere acces" — niciodată o
// cale spre dashboard.
//
// Modul cu `clients` (pachetul 8b-2, CL1–CL3): un rând per client din
// get_affiliate_dashboard; o citire EȘUATĂ a stării accesului nu ascunde clienții.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PartnerAttribution } from '../../lib/founder'

const listPartnerAttributions = vi.fn<() => Promise<PartnerAttribution[]>>()
const requestPartnerAccess = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>()
const enterFounderView = vi.fn<(id: string, origin?: string) => Promise<void>>()

vi.mock('../../lib/founder', () => ({
  listPartnerAttributions: () => listPartnerAttributions(),
  requestPartnerAccess: (id: string) => requestPartnerAccess(id),
  enterFounderView: (id: string, origin?: string) => enterFounderView(id, origin),
}))

import PartnerAccessList from '../PartnerAccessList'

function attribution(over: Partial<PartnerAttribution>): PartnerAttribution {
  return {
    attribution_id: 'att-1',
    status: 'active',
    state: 'none',
    requested_at: null,
    consented_at: null,
    revoked_at: null,
    restaurant_names: ['Bistro Test'],
    restaurants: [],
    ...over,
  }
}

beforeEach(() => {
  listPartnerAttributions.mockReset()
  requestPartnerAccess.mockReset().mockResolvedValue({ ok: true })
  enterFounderView.mockReset().mockResolvedValue(undefined)
})

describe('PartnerAccessList', () => {
  it('fără atribuiri — nu randează nimic', async () => {
    listPartnerAttributions.mockResolvedValue([])
    const { container } = render(<PartnerAccessList />)
    await waitFor(() => expect(listPartnerAttributions).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('nimic cerut — „Cere acces", fără „Intră pe dashboard"', async () => {
    listPartnerAttributions.mockResolvedValue([attribution({ state: 'none' })])
    render(<PartnerAccessList />)
    expect(await screen.findByText('Bistro Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editează meniul/i })).not.toBeInTheDocument()

    listPartnerAttributions.mockResolvedValue([
      attribution({ state: 'requested', requested_at: '2026-10-01T10:00:00Z' }),
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Cere acces' }))
    await waitFor(() => expect(requestPartnerAccess).toHaveBeenCalledWith('att-1'))
    // După cerere, lista se reîncarcă: starea devine „Cerere trimisă", fără buton.
    expect(await screen.findByText('Cerere trimisă')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cere acces' })).not.toBeInTheDocument()
  })

  it('cerere trimisă — fără nicio cale spre dashboard', async () => {
    listPartnerAttributions.mockResolvedValue([
      attribution({ state: 'requested', requested_at: '2026-10-01T10:00:00Z' }),
    ])
    render(<PartnerAccessList />)
    expect(await screen.findByText('Cerere trimisă')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('acces acordat — „Editează meniul" duce pe restaurantul acordat, cu originea afiliat', async () => {
    listPartnerAttributions.mockResolvedValue([
      attribution({
        state: 'granted',
        consented_at: '2026-10-01T10:00:00Z',
        restaurants: [{ restaurant_id: 'r-1', name: 'Bistro Test', city: 'Cluj', is_active: true }],
      }),
    ])
    render(<PartnerAccessList />)
    expect(await screen.findByText('Acces acordat')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /editează meniul/i }))
    expect(enterFounderView).toHaveBeenCalledWith('r-1', 'afiliat')
  })

  it('acces revocat — „Cere din nou", fără dashboard', async () => {
    listPartnerAttributions.mockResolvedValue([
      attribution({ state: 'revoked', revoked_at: '2026-10-02T10:00:00Z' }),
    ])
    render(<PartnerAccessList />)
    expect(await screen.findByText('Acces revocat')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editează meniul/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cere din nou' }))
    await waitFor(() => expect(requestPartnerAccess).toHaveBeenCalledWith('att-1'))
  })

  it('refuzul serverului la cerere apare ca alertă', async () => {
    listPartnerAttributions.mockResolvedValue([attribution({ state: 'none' })])
    requestPartnerAccess.mockResolvedValue({ ok: false, error: 'Clientul nu are încă un restaurant creat.' })
    render(<PartnerAccessList />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cere acces' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/nu are încă un restaurant/i)
  })

  // CL1 — mutația care pică: rândurile construite din `items` (atribuirile) în loc de
  // `clients` → clientul terminal (absent din list_partner_attributions) dispare.
  it('CL1: cu `clients`, un rând per client, inclusiv cel fără stare de acces', async () => {
    listPartnerAttributions.mockResolvedValue([attribution({ state: 'none' })])
    render(
      <PartnerAccessList
        clients={[
          { attribution_id: 'att-1', status: 'active', restaurant_names: ['Bistro Test'], city: 'Cluj', commission_cents: 1500 },
          { attribution_id: 'att-2', status: 'canceled', restaurant_names: ['Pizzeria Veche'], city: null, commission_cents: 0 },
        ]}
        formatMoney={(c) => `${c / 100} lei`}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Cere acces' })).toBeInTheDocument()
    expect(screen.getByText('Pizzeria Veche')).toBeInTheDocument()
    expect(screen.getByText(/Cluj · abonat · comisionul tău: 15 lei/)).toBeInTheDocument()
    // O singură acțiune: clientul anulat (fără stare de acces) nu primește niciun buton.
    expect(screen.getAllByRole('button', { name: /cere acces|cere din nou|editează meniul/i })).toHaveLength(1)
  })

  // CL2 — mutația care pică: `if (failed) return null` (forma veche, care ascundea
  // secțiunea pe eroare) sau lipsa butonului „Reîncearcă".
  it('CL2: starea accesului nu se poate citi → clienții rămân, cu „Reîncearcă"', async () => {
    listPartnerAttributions.mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <PartnerAccessList
        clients={[{ attribution_id: 'att-1', status: 'active', restaurant_names: ['Bistro Test'], city: null, commission_cents: 0 }]}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    expect(screen.getByText('Bistro Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cere acces' })).not.toBeInTheDocument()

    listPartnerAttributions.mockResolvedValue([attribution({ state: 'none' })])
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(await screen.findByRole('button', { name: 'Cere acces' })).toBeInTheDocument()
  })

  // CL3 — mutația care pică: `return null` pe listă goală și în modul cu `clients`
  // (agentul fără clienți n-ar vedea nicio explicație).
  it('CL3: cu `clients` gol, mesaj de pornire în loc de secțiune ascunsă', async () => {
    listPartnerAttributions.mockResolvedValue([])
    render(<PartnerAccessList clients={[]} />)
    expect(await screen.findByText(/Încă n-ai niciun client/)).toBeInTheDocument()
  })
})
