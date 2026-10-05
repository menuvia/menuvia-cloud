// Teste pe secțiunea „Acces partener" din tab-ul Echipă (owner), mig 286.
// Regulile pe care le păzesc: cererea se APROBĂ sau se REFUZĂ explicit (nimic
// automat), un acces acordat se revocă DOAR după confirmare, iar o revocare
// existentă nu mai oferă acțiuni (partenerul poate cere din nou, nu ownerul).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PartnerAccessRow } from '../../lib/founder'

const getPartnerAccess = vi.fn<(restaurantId: string) => Promise<PartnerAccessRow[]>>()
const grantPartnerAccess = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>()
const revokePartnerAccess = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>()

vi.mock('../../lib/founder', () => ({
  getPartnerAccess: (restaurantId: string) => getPartnerAccess(restaurantId),
  grantPartnerAccess: (id: string) => grantPartnerAccess(id),
  revokePartnerAccess: (id: string) => revokePartnerAccess(id),
}))

import PartnerAccessSection from '../PartnerAccessSection'

function row(over: Partial<PartnerAccessRow>): PartnerAccessRow {
  return {
    attribution_id: 'att-1',
    affiliate_email: 'partener@exemplu.ro',
    affiliate_name: 'Partener X',
    revoked_at: null,
    requested_at: null,
    consented_at: null,
    state: 'none',
    ...over,
  }
}

beforeEach(() => {
  getPartnerAccess.mockReset()
  grantPartnerAccess.mockReset().mockResolvedValue({ ok: true })
  revokePartnerAccess.mockReset().mockResolvedValue({ ok: true })
})

describe('PartnerAccessSection', () => {
  it('fără cereri/acces — nu randează nimic', async () => {
    getPartnerAccess.mockResolvedValue([])
    const { container } = render(<PartnerAccessSection restaurantId="r1" toast={vi.fn()} />)
    await waitFor(() => expect(getPartnerAccess).toHaveBeenCalledWith('r1'))
    expect(container).toBeEmptyDOMElement()
  })

  it('cerere în așteptare — „Aprobă" cheamă grant, „Refuză" cheamă revoke', async () => {
    getPartnerAccess.mockResolvedValue([row({ state: 'requested', requested_at: '2026-10-01T10:00:00Z' })])
    const toast = vi.fn()
    render(<PartnerAccessSection restaurantId="r1" toast={toast} />)

    expect(await screen.findByText('Partener X')).toBeInTheDocument()
    expect(screen.getByText('Cerere trimisă')).toBeInTheDocument()
    // Nu există „Revocă accesul" pe o cerere neaprobată.
    expect(screen.queryByRole('button', { name: /revocă accesul/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Aprobă' }))
    await waitFor(() => expect(grantPartnerAccess).toHaveBeenCalledWith('att-1'))
    expect(revokePartnerAccess).not.toHaveBeenCalled()

    // După „Aprobă" lista se reîncarcă (rândurile se golesc o clipă) — așteptăm butonul.
    await userEvent.click(await screen.findByRole('button', { name: 'Refuză' }))
    await waitFor(() => expect(revokePartnerAccess).toHaveBeenCalledWith('att-1'))
  })

  it('acces acordat — revocarea cere confirmare înainte de apel', async () => {
    getPartnerAccess.mockResolvedValue([
      row({ state: 'granted', consented_at: '2026-10-01T10:00:00Z' }),
    ])
    render(<PartnerAccessSection restaurantId="r1" toast={vi.fn()} />)

    expect(await screen.findByText('Acces acordat')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprobă' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /revocă accesul/i }))
    // Un singur click NU revocă: apare confirmarea.
    expect(revokePartnerAccess).not.toHaveBeenCalled()
    expect(screen.getByText(/sigur revoci/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /da, revocă/i }))
    await waitFor(() => expect(revokePartnerAccess).toHaveBeenCalledWith('att-1'))
  })

  it('acces revocat — fără acțiuni pentru owner', async () => {
    getPartnerAccess.mockResolvedValue([
      row({ state: 'revoked', revoked_at: '2026-10-02T10:00:00Z' }),
    ])
    render(<PartnerAccessSection restaurantId="r1" toast={vi.fn()} />)
    expect(await screen.findByText('Acces revocat')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('refuzul serverului ajunge în toast și nu strică lista', async () => {
    getPartnerAccess.mockResolvedValue([row({ state: 'requested', requested_at: '2026-10-01T10:00:00Z' })])
    grantPartnerAccess.mockResolvedValue({ ok: false, error: 'Atribuirea nu mai este activă.' })
    const toast = vi.fn()
    render(<PartnerAccessSection restaurantId="r1" toast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aprobă' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Atribuirea nu mai este activă.', 'error'))
    expect(screen.getByText('Cerere trimisă')).toBeInTheDocument()
  })
})
