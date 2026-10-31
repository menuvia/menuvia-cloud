// „Echipa ta” din panoul șefului de vânzări (components/afiliat/TeamSection.tsx,
// pachetul 8b-2, mig 304).
//
//   TT1  „Invită agent” → RPC create_agent_invite cu nota, linkul /echipa/<token> apare O
//        SINGURĂ DATĂ, rețeaua se reîncarcă; „ascunde-l” îl scoate din DOM definitiv
//        (mutațiile „linkul rămâne după ascundere” / „token în listă” pică)
//   TT2  „Retrage”: confirmare refuzată → niciun RPC; acceptată → revoke_agent_invite pe id
//   TT3  contract nepublicat → „Invită agent” dezactivat, cu explicație
//   TT4  plafonul de invitații deschise atins → „Invită agent” dezactivat
//   TT5  contactul recrutului: ascuns fără consimțământ (eticheta „Agentul N”), afișat cu el
//   TT6  refuzul serverului la creare apare ca mesaj, fără link
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, confirmMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), confirmMock: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

import TeamSection from '../afiliat/TeamSection'
import type { SalesNetwork, SalesTeamMember } from '../../lib/salesNetwork'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

function member(over: Partial<SalesTeamMember> = {}): SalesTeamMember {
  return {
    affiliateId: 'ag-1',
    ordinal: 1,
    status: 'active',
    joinedAt: '2026-10-02T10:00:00Z',
    contactShared: false,
    name: null,
    phone: null,
    email: null,
    clientsTotal: 3,
    clientsActive: 2,
    agentEarnedRonCents: 40000,
    headBonusRonCents: 8000,
    lastSaleAt: null,
    ...over,
  }
}

function network(over: Partial<SalesNetwork> = {}): SalesNetwork {
  return {
    role: 'head',
    status: 'active',
    affiliateId: 'head-1',
    contactSharing: false,
    contract: {
      currentVersion: '1.0',
      acceptedVersion: '1.0',
      acceptedAt: '2026-10-01T10:00:00Z',
      needsAcceptance: false,
      currentTextHash: 'a'.repeat(64),
    },
    head: null,
    team: [],
    openInvites: [],
    limits: { openInvitesMax: 20, inviteTtlDays: 14 },
    ...over,
  }
}

const onChanged = vi.fn<() => Promise<void>>()

beforeEach(() => {
  rpcMock.mockReset()
  confirmMock.mockReset()
  onChanged.mockReset().mockResolvedValue(undefined)
})

describe('TeamSection', () => {
  it('TT1: linkul invitației se vede o singură dată', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'create_agent_invite'
        ? Promise.resolve({
            data: {
              ok: true,
              invite_id: 'inv-1',
              kind: 'agent',
              token: TOKEN,
              expires_at: '2026-11-13T10:00:00Z',
            },
            error: null,
          })
        : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'x' } }),
    )
    const user = userEvent.setup()
    const { container, rerender } = render(
      <TeamSection network={network()} onChanged={onChanged} />,
    )
    await user.type(screen.getByLabelText('Notă (opțional)'), 'Ion de la Bistro')
    await user.click(screen.getByRole('button', { name: 'Invită agent' }))

    const input = await screen.findByLabelText('Link invitație')
    expect((input as HTMLInputElement).value).toContain(`/echipa/${TOKEN}`)
    expect(rpcMock).toHaveBeenCalledWith('create_agent_invite', { p_note: 'Ion de la Bistro' })
    expect(onChanged).toHaveBeenCalledTimes(1)

    // Rețeaua reîncărcată (invitația nouă în listă, FĂRĂ token): linkul rămâne până îl ascunde omul.
    rerender(
      <TeamSection
        network={network({
          openInvites: [
            {
              id: 'inv-1',
              note: 'Ion de la Bistro',
              createdAt: '2026-10-30T10:00:00Z',
              expiresAt: '2026-11-13T10:00:00Z',
            },
          ],
        })}
        onChanged={onChanged}
      />,
    )
    expect(screen.getByLabelText('Link invitație')).toBeInTheDocument()
    expect(screen.getByText('Ion de la Bistro')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /am salvat linkul, ascunde-l/i }))
    expect(screen.queryByLabelText('Link invitație')).toBeNull()
    expect(container.innerHTML).not.toContain(TOKEN)
  })

  it('TT2: „Retrage” cere confirmare și cheamă revoke_agent_invite pe id', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null })
    const net = network({
      openInvites: [
        {
          id: 'inv-9',
          note: null,
          createdAt: '2026-10-20T10:00:00Z',
          expiresAt: '2026-11-03T10:00:00Z',
        },
      ],
    })
    const user = userEvent.setup()
    render(<TeamSection network={net} onChanged={onChanged} />)
    expect(screen.getByText('Invitație fără notă')).toBeInTheDocument()

    confirmMock.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Retrage' }))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).not.toHaveBeenCalled()

    confirmMock.mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Retrage' }))
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('revoke_agent_invite', { p_invite_id: 'inv-9' }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  it('TT3: contract nepublicat → invitarea e blocată, cu explicație', () => {
    const net = network({
      contract: {
        currentVersion: null,
        acceptedVersion: '1.0',
        acceptedAt: null,
        needsAcceptance: false,
        currentTextHash: null,
      },
    })
    render(<TeamSection network={net} onChanged={onChanged} />)
    expect(screen.getByRole('button', { name: 'Invită agent' })).toBeDisabled()
    expect(screen.getByText(/contractul de colaborare nu e publicat/i)).toBeInTheDocument()
  })

  it('TT4: plafonul de invitații deschise atins → invitarea e blocată', () => {
    const openInvites = Array.from({ length: 2 }, (_, i) => ({
      id: `inv-${i}`,
      note: `n${i}`,
      createdAt: '2026-10-20T10:00:00Z',
      expiresAt: '2026-11-03T10:00:00Z',
    }))
    render(
      <TeamSection
        network={network({ openInvites, limits: { openInvitesMax: 2, inviteTtlDays: 14 } })}
        onChanged={onChanged}
      />,
    )
    expect(screen.getByText('Invitații deschise (2 din 2)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invită agent' })).toBeDisabled()
  })

  it('TT5: contactul recrutului doar cu consimțământul lui', () => {
    const team = [
      member(),
      member({
        affiliateId: 'ag-2',
        ordinal: 2,
        contactShared: true,
        name: 'Maria Pop',
        phone: '0722 123 456',
        email: 'maria@x.test',
      }),
    ]
    render(<TeamSection network={network({ team })} onChanged={onChanged} />)
    expect(screen.getByText('Agentul 1')).toBeInTheDocument()
    expect(screen.getByText(/agentul nu a ales să le arate/i)).toBeInTheDocument()
    expect(screen.getByText('Maria Pop')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '0722 123 456' })).toHaveAttribute(
      'href',
      'tel:+40722123456',
    )
    expect(screen.getByRole('link', { name: 'maria@x.test' })).toHaveAttribute(
      'href',
      'mailto:maria@x.test',
    )
  })

  it('TT6: refuzul serverului la creare → mesaj, fără link', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, reason: 'too_many_open_invites' }, error: null })
    const user = userEvent.setup()
    render(<TeamSection network={network()} onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: 'Invită agent' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/prea multe invitații deschise/i)
    expect(screen.queryByLabelText('Link invitație')).toBeNull()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
