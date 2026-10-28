// Panoul „Rețea de vânzări” din FounderPage (mig 302, pachetul 8b-1).
//
//   SP1  contract nepublicat → „Nepublicat — invitațiile sunt blocate", invitația dezactivată
//   SP2  publicare: DRAFT refuzat local (fără confirm, fără RPC); valid → confirm + RPC + versiunea apare
//   SP3  retragere: fără confirmare nu pleacă nimic; cu confirmare → RPC cu versiune null
//   SP4  tokenul: linkul apare O SINGURĂ DATĂ (baza publică + /sef-vanzari/ + token),
//        se copiază, dispare la „ascunde" și nu mai apare nici după re-randare, nici în listă
//   SP5  revocare: confirmDialog; refuzat → niciun RPC; acceptat → RPC pe id
//   SP6  rețeaua: motiv obligatoriu, confirmDialog, RPC exact; un cont închis nu are acțiune
//   SP7  RPC lipsă (PGRST202) → „indisponibil", NU „nepublicat"; nicio acțiune de invitare
//   SP8  lista de invitații eșuată → eroare + „Reîncearcă", NU „Nicio invitație"
//   SP9  lista „Rețeaua" necunoscută (încă se încarcă / eroare) nu se arată ca goală
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, confirmMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), confirmMock: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

import SalesNetworkPanel from '../founder/SalesNetworkPanel'
import { SALES_FAILURE_MESSAGES } from '../../lib/salesNetwork'
import type { AdminAffiliateRow } from '../../lib/founder'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

function ok(data: unknown) {
  return Promise.resolve({ data, error: null })
}
function rpcFail(code: string) {
  return Promise.resolve({ data: null, error: { code, message: 'x' } })
}

function networkPayload(version: string | null) {
  return {
    ok: true,
    role: null,
    status: null,
    affiliate_id: null,
    contact_sharing: false,
    contract: {
      current_version: version,
      accepted_version: null,
      accepted_at: null,
      needs_acceptance: false,
    },
    head: null,
    team: [],
    open_invites: [],
    limits: { open_invites_max: 20, invite_ttl_days: 14 },
  }
}

function inviteRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    kind: 'head',
    state: 'open',
    email: null,
    note: 'Ion',
    created_at: '2026-10-27T10:00:00Z',
    expires_at: '2026-11-10T10:00:00Z',
    used_at: null,
    revoked_at: null,
    invited_by_affiliate_id: null,
    invited_by_name: null,
    used_by_affiliate_id: null,
    used_by_name: null,
    ...over,
  }
}

function affiliate(over: Partial<AdminAffiliateRow>): AdminAffiliateRow {
  return {
    affiliate_id: 'x',
    email: null,
    full_name: null,
    referral_code: 'COD',
    status: 'active',
    parent_affiliate_id: null,
    balance_ron_cents: 0,
    restaurants: [],
    created_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

const AFFILIATES: AdminAffiliateRow[] = [
  affiliate({ affiliate_id: 'h1', full_name: 'Șef Unu', status: 'active' }),
  affiliate({ affiliate_id: 'a1', full_name: 'Agent Unu', status: 'suspended', parent_affiliate_id: 'h1' }),
  affiliate({ affiliate_id: 'h2', full_name: 'Șef Închis', status: 'closed' }),
]

interface Server {
  published: string | null
  invites: unknown[]
}
let server: Server

function installServer() {
  rpcMock.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case 'get_sales_network':
        return ok(networkPayload(server.published))
      case 'admin_list_affiliate_invites':
        return ok(server.invites)
      case 'admin_set_sales_contract_version':
        server.published = (args?.p_version as string | null | undefined) ?? null
        return ok({ ok: true, version: server.published, previous: null })
      case 'admin_create_sales_head_invite':
        return ok({
          ok: true,
          invite_id: 'i-new',
          kind: 'head',
          token: TOKEN,
          expires_at: '2026-11-11T10:00:00Z',
        })
      case 'admin_revoke_affiliate_invite':
        return ok({ ok: true })
      case 'admin_set_affiliate_status':
        return ok({ ok: true, status: args?.p_status })
      default:
        return rpcFail('PGRST202')
    }
  })
}

function callsOf(fn: string): unknown[][] {
  return rpcMock.mock.calls.filter((c: unknown[]) => c[0] === fn)
}

const onNetworkChanged = vi.fn()

function renderPanel(affiliates: AdminAffiliateRow[] | null = AFFILIATES, error: string | null = null) {
  return render(
    <SalesNetworkPanel
      affiliates={affiliates}
      affiliatesError={error}
      onNetworkChanged={onNetworkChanged}
    />,
  )
}

beforeEach(() => {
  rpcMock.mockReset()
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
  onNetworkChanged.mockReset()
  server = { published: null, invites: [inviteRow()] }
  installServer()
})

describe('SalesNetworkPanel', () => {
  it('SP1: contract nepublicat → invitațiile blocate', async () => {
    renderPanel()
    expect(await screen.findByText(/nepublicat — invitațiile sunt blocate/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /creează invitație/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /retrage versiunea/i })).toBeNull()
  })

  it('SP2: publicare — DRAFT refuzat local, versiunea validă trece prin confirm și RPC', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText(/nepublicat — invitațiile sunt blocate/i)
    const input = screen.getByLabelText(/versiunea de publicat/i)

    await user.type(input, 'agent-1.0-DRAFT')
    await user.click(screen.getByRole('button', { name: /publică versiunea/i }))
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.draft_version)).toBeInTheDocument()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(callsOf('admin_set_sales_contract_version')).toHaveLength(0)

    await user.clear(input)
    await user.type(input, '1.0')
    await user.click(screen.getByRole('button', { name: /publică versiunea/i }))
    await waitFor(() => expect(callsOf('admin_set_sales_contract_version')).toHaveLength(1))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(callsOf('admin_set_sales_contract_version')[0][1]).toEqual({ p_version: '1.0' })
    expect(await screen.findByText(/publicat: versiunea 1\.0/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /creează invitație/i })).toBeEnabled()
  })

  it('SP3: retragerea cere confirmare și trimite versiune null', async () => {
    server.published = '1.0'
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText(/publicat: versiunea 1\.0/i)

    confirmMock.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: /retrage versiunea/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(callsOf('admin_set_sales_contract_version')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /retrage versiunea/i }))
    await waitFor(() => expect(callsOf('admin_set_sales_contract_version')).toHaveLength(1))
    expect(callsOf('admin_set_sales_contract_version')[0][1]).toEqual({ p_version: null })
    expect(await screen.findByText(/nepublicat — invitațiile sunt blocate/i)).toBeInTheDocument()
  })

  it('SP4: linkul cu token apare o singură dată', async () => {
    server.published = '1.0'
    const user = userEvent.setup()
    const view = renderPanel()
    await screen.findByText(/publicat: versiunea 1\.0/i)

    await user.type(screen.getByLabelText(/email \(opțional\)/i), 'sef@x.test')
    await user.click(screen.getByRole('button', { name: /creează invitație/i }))

    const linkInput = await screen.findByLabelText(/^link invitație$/i)
    const expected = `${window.location.origin}/sef-vanzari/${TOKEN}`
    expect(linkInput).toHaveValue(expected)
    expect(screen.getByText(/linkul se vede o singură dată/i)).toBeInTheDocument()
    expect(callsOf('admin_create_sales_head_invite')[0][1]).toEqual({
      p_email: 'sef@x.test',
      p_note: null,
    })

    await user.click(screen.getByRole('button', { name: /^copiază$/i }))
    expect(await screen.findByText(/link copiat/i)).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(expected)

    await user.click(screen.getByRole('button', { name: /am salvat linkul/i }))
    expect(screen.queryByLabelText(/^link invitație$/i)).toBeNull()

    // re-randare: nu reapare, nici în listă, nici oriunde în pagină
    view.rerender(
      <SalesNetworkPanel
        affiliates={AFFILIATES}
        affiliatesError={null}
        onNetworkChanged={onNetworkChanged}
      />,
    )
    expect(screen.queryByLabelText(/^link invitație$/i)).toBeNull()
    expect(screen.queryByDisplayValue(new RegExp(TOKEN))).toBeNull()
    expect(document.body.textContent ?? '').not.toContain(TOKEN)
  })

  it('SP5: revocarea trece prin confirmDialog', async () => {
    const user = userEvent.setup()
    renderPanel()
    const revoke = await screen.findByRole('button', { name: /^revocă$/i })

    confirmMock.mockResolvedValueOnce(false)
    await user.click(revoke)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(callsOf('admin_revoke_affiliate_invite')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^revocă$/i }))
    await waitFor(() => expect(callsOf('admin_revoke_affiliate_invite')).toHaveLength(1))
    expect(callsOf('admin_revoke_affiliate_invite')[0][1]).toEqual({ p_invite_id: 'i1' })
  })

  it('SP5b: invitațiile folosite / revocate nu au buton de revocare', async () => {
    server.invites = [
      inviteRow({ id: 'i2', state: 'used', used_by_name: 'Maria' }),
      inviteRow({ id: 'i3', state: 'revoked' }),
    ]
    renderPanel()
    expect(await screen.findByText(/folosită · Maria/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^revocă$/i })).toBeNull()
  })

  it('SP6: starea unui cont — motiv obligatoriu, confirmare, RPC exact', async () => {
    const user = userEvent.setup()
    renderPanel()
    const changeButtons = await screen.findAllByRole('button', { name: /schimbă starea/i })
    // „Șef Închis" (closed) nu are acțiune: doar h1 și a1.
    expect(changeButtons).toHaveLength(2)

    await user.click(changeButtons[0])
    await user.click(screen.getByRole('button', { name: /^aplică$/i }))
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.reason_required)).toBeInTheDocument()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(callsOf('admin_set_affiliate_status')).toHaveLength(0)

    await user.type(screen.getByLabelText(/motiv \(obligatoriu\)/i), 'nu răspunde de o lună')
    await user.click(screen.getByRole('button', { name: /^aplică$/i }))
    await waitFor(() => expect(callsOf('admin_set_affiliate_status')).toHaveLength(1))
    expect(callsOf('admin_set_affiliate_status')[0][1]).toEqual({
      p_affiliate_id: 'h1',
      p_status: 'suspended',
      p_reason: 'nu răspunde de o lună',
    })
    expect(confirmMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onNetworkChanged).toHaveBeenCalledTimes(1))
  })

  it('SP6b: confirmarea refuzată nu trimite nimic', async () => {
    const user = userEvent.setup()
    renderPanel()
    const changeButtons = await screen.findAllByRole('button', { name: /schimbă starea/i })
    await user.click(changeButtons[1]) // agentul suspendat → implicit „Activ"
    await user.type(screen.getByLabelText(/motiv \(obligatoriu\)/i), 'reactivat după clarificări')
    confirmMock.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: /^aplică$/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(callsOf('admin_set_affiliate_status')).toHaveLength(0)
    expect(onNetworkChanged).not.toHaveBeenCalled()
  })

  it('SP6c: rolul se vede din legătura cu șeful', async () => {
    renderPanel()
    const row = (await screen.findByText('Agent Unu')).closest('div') as HTMLElement
    expect(within(row.parentElement as HTMLElement).getByText(/agent · suspendat/i)).toBeInTheDocument()
    expect(screen.getByText(/șef · activ/i)).toBeInTheDocument()
  })

  it('SP7: RPC lipsă → indisponibil, nu „nepublicat"', async () => {
    rpcMock.mockImplementation(() => rpcFail('PGRST202'))
    renderPanel()
    expect((await screen.findAllByText(SALES_FAILURE_MESSAGES.unavailable)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/nepublicat — invitațiile sunt blocate/i)).toBeNull()
    expect(screen.getByRole('button', { name: /creează invitație/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /publică versiunea/i })).toBeNull()
  })

  it('SP8: lista de invitații eșuată → eroare, nu „nicio invitație"', async () => {
    server.published = '1.0'
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_sales_network') return ok(networkPayload('1.0'))
      return rpcFail('PGRST202')
    })
    renderPanel()
    await screen.findByText(/publicat: versiunea 1\.0/i)
    expect((await screen.findAllByText(SALES_FAILURE_MESSAGES.unavailable)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/nicio invitație încă/i)).toBeNull()
  })

  it('SP9: rețeaua necunoscută nu se arată ca goală', async () => {
    const view = renderPanel(null, null)
    expect(await screen.findByText(/se încarcă rețeaua/i)).toBeInTheDocument()
    expect(screen.queryByText(/niciun cont în rețea/i)).toBeNull()
    view.rerender(
      <SalesNetworkPanel
        affiliates={null}
        affiliatesError="Eroare la încărcare."
        onNetworkChanged={onNetworkChanged}
      />,
    )
    expect(screen.getByText('Eroare la încărcare.')).toBeInTheDocument()
    expect(screen.queryByText(/niciun cont în rețea/i)).toBeNull()
  })
})
