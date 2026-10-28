// Teste pe „Acces de partener" din panoul afiliatului (AfiliatPage), mig 286.
// Regula centrală: „Intră pe dashboard" apare DOAR când ownerul a acordat
// accesul. Fără el (nimic cerut / cerere trimisă / revocat) afiliatul vede doar
// starea și, unde are sens, „Cere acces" — niciodată o cale spre dashboard.
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
    expect(screen.queryByRole('button', { name: /intră pe dashboard/i })).not.toBeInTheDocument()

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

  it('acces acordat — „Intră pe dashboard" duce pe restaurantul acordat, cu originea afiliat', async () => {
    listPartnerAttributions.mockResolvedValue([
      attribution({
        state: 'granted',
        consented_at: '2026-10-01T10:00:00Z',
        restaurants: [{ restaurant_id: 'r-1', name: 'Bistro Test', city: 'Cluj', is_active: true }],
      }),
    ])
    render(<PartnerAccessList />)
    expect(await screen.findByText('Acces acordat')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /intră pe dashboard/i }))
    expect(enterFounderView).toHaveBeenCalledWith('r-1', 'afiliat')
  })

  it('acces revocat — „Cere din nou", fără dashboard', async () => {
    listPartnerAttributions.mockResolvedValue([
      attribution({ state: 'revoked', revoked_at: '2026-10-02T10:00:00Z' }),
    ])
    render(<PartnerAccessList />)
    expect(await screen.findByText('Acces revocat')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /intră pe dashboard/i })).not.toBeInTheDocument()
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
})
