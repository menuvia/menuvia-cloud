// Panoul „Rețea de vânzări” din FounderPage (mig 304, pachetul 8b-1).
//
//   SP1  contract nepublicat → „Nepublicat — invitațiile sunt blocate", invitația dezactivată
//   SP2  publicare: DRAFT refuzat local (fără confirm, fără RPC); valid cu text în aplicație →
//        confirm + RPC cu (versiune, sha256 REAL al textului) + versiunea și amprenta apar
//   SP3  retragere: fără confirmare nu pleacă nimic; cu confirmare → RPC cu (null, null)
//   SP4  tokenul: linkul apare O SINGURĂ DATĂ (baza publică + /sef-vanzari/ + token),
//        se copiază, dispare la „ascunde" și nu mai apare nici după re-randare, nici în listă
//   SP5  revocare: confirmDialog; refuzat → niciun RPC; acceptat → RPC pe id
//   SP6  rețeaua: motiv obligatoriu, confirmDialog, RPC exact; un cont închis nu are acțiune
//   SP7  RPC lipsă (PGRST202) → „indisponibil", NU „nepublicat"; nicio acțiune de invitare
//   SP8  lista de invitații eșuată → eroare + „Reîncearcă", NU „Nicio invitație"
//   SP9  lista „Rețeaua" necunoscută (încă se încarcă / eroare) nu se arată ca goală
//   SP10 versiune fără text în aplicație → publicarea DEZACTIVATĂ cu explicație, nimic nu pleacă
//   SP11 amprenta publicată se vede scurtată; textul din aplicație care NU îi corespunde e semnalat
//   SP12 versiune publicată al cărei text lipsește din aplicație → semnalată (cei invitați nu pot accepta)
//   SP13 emailul invitației e o RESTRICȚIE (serverul îl impune la răscumpărare), nu o notă:
//        textul de lângă câmp spune regula, iar lista îl arată ca „doar pentru …”
import { createHash, webcrypto } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, confirmMock, contractTextMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  confirmMock: vi.fn(),
  contractTextMock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))
// Harta reală e GOALĂ (fail-closed până la textul avocatului): testele care
// publică injectează un text pentru o versiune.
vi.mock('../../lib/salesContract', () => ({ contractTextFor: contractTextMock }))

import SalesNetworkPanel from '../founder/SalesNetworkPanel'
import { SALES_FAILURE_MESSAGES } from '../../lib/salesNetwork'
import type { AdminAffiliateRow } from '../../lib/founder'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'
const CONTRACT_TEXT = 'CONTRACT DE COLABORARE v1.0\nArt. 1. Ștefan acceptă.'
/** sha256 calculat independent (node:crypto), nu cu funcția testată. */
const CONTRACT_HASH = createHash('sha256').update(CONTRACT_TEXT, 'utf8').digest('hex')

function textFor(version: string): (v: string | null) => string | null {
  return (v) => (v === version ? CONTRACT_TEXT : null)
}

function ok(data: unknown) {
  return Promise.resolve({ data, error: null })
}
function rpcFail(code: string) {
  return Promise.resolve({ data: null, error: { code, message: 'x' } })
}

function networkPayload(version: string | null, textHash: string | null = null) {
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
      current_text_hash: textHash,
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
  affiliate({
    affiliate_id: 'a1',
    full_name: 'Agent Unu',
    status: 'suspended',
    parent_affiliate_id: 'h1',
  }),
  affiliate({ affiliate_id: 'h2', full_name: 'Șef Închis', status: 'closed' }),
]

interface Server {
  published: string | null
  hash: string | null
  invites: unknown[]
}
let server: Server

function installServer() {
  rpcMock.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case 'get_sales_network':
        return ok(networkPayload(server.published, server.hash))
      case 'admin_list_affiliate_invites':
        return ok(server.invites)
      case 'admin_set_sales_contract_version':
        // Ca pe server: retragerea (versiune null) ignoră hash-ul.
        server.published = (args?.p_version as string | null | undefined) ?? null
        server.hash =
          server.published === null
            ? null
            : ((args?.p_text_hash as string | null | undefined) ?? null)
        return ok({ ok: true, version: server.published, text_hash: server.hash, previous: null })
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

function renderPanel(
  affiliates: AdminAffiliateRow[] | null = AFFILIATES,
  error: string | null = null,
) {
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
  contractTextMock.mockReset()
  contractTextMock.mockReturnValue(null)
  onNetworkChanged.mockReset()
  // sha256Hex REAL (crypto.subtle din Node): testele verifică amprenta adevărată.
  vi.stubGlobal('crypto', webcrypto)
  server = { published: null, hash: null, invites: [inviteRow()] }
  installServer()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SalesNetworkPanel', () => {
  it('SP1: contract nepublicat → invitațiile blocate', async () => {
    renderPanel()
    expect(await screen.findByText(/nepublicat — invitațiile sunt blocate/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /creează invitație/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /retrage versiunea/i })).toBeNull()
  })

  it('SP2: publicare — DRAFT refuzat local, versiunea cu text trimite versiunea ȘI sha256', async () => {
    contractTextMock.mockImplementation(textFor('1.0'))
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText(/nepublicat — invitațiile sunt blocate/i)
    const input = screen.getByLabelText(/versiunea de publicat/i)
    const publishButton = () => screen.getByRole('button', { name: /publică versiunea/i })

    await user.type(input, 'agent-1.0-DRAFT')
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.draft_version)).toBeInTheDocument()
    expect(publishButton()).toBeDisabled()
    await user.click(publishButton())
    expect(confirmMock).not.toHaveBeenCalled()
    expect(callsOf('admin_set_sales_contract_version')).toHaveLength(0)

    await user.clear(input)
    await user.type(input, '1.0')
    expect(publishButton()).toBeEnabled()
    await user.click(publishButton())
    await waitFor(() => expect(callsOf('admin_set_sales_contract_version')).toHaveLength(1))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    // Mutațiile „hash-ul versiunii / al altui text / null” pică aici: amprenta e
    // recalculată independent, cu node:crypto, pe EXACT textul din hartă.
    expect(callsOf('admin_set_sales_contract_version')[0][1]).toEqual({
      p_version: '1.0',
      p_text_hash: CONTRACT_HASH,
    })
    expect(await screen.findByText(/publicat: versiunea 1\.0/i)).toBeInTheDocument()
    expect(screen.getByText(CONTRACT_HASH.slice(0, 12) + '…')).toBeInTheDocument()
    expect(
      await screen.findByText(/textul din aplicație corespunde amprentei publicate/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /creează invitație/i })).toBeEnabled()
  })

  it('SP3: retragerea cere confirmare și trimite versiune null', async () => {
    server.published = '1.0'
    server.hash = CONTRACT_HASH
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText(/publicat: versiunea 1\.0/i)

    confirmMock.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: /retrage versiunea/i }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(callsOf('admin_set_sales_contract_version')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /retrage versiunea/i }))
    await waitFor(() => expect(callsOf('admin_set_sales_contract_version')).toHaveLength(1))
    expect(callsOf('admin_set_sales_contract_version')[0][1]).toEqual({
      p_version: null,
      p_text_hash: null,
    })
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
    expect(
      within(row.parentElement as HTMLElement).getByText(/agent · suspendat/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/șef · activ/i)).toBeInTheDocument()
  })

  it('SP7: RPC lipsă → indisponibil, nu „nepublicat"', async () => {
    rpcMock.mockImplementation(() => rpcFail('PGRST202'))
    renderPanel()
    expect((await screen.findAllByText(SALES_FAILURE_MESSAGES.unavailable)).length).toBeGreaterThan(
      0,
    )
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
    expect((await screen.findAllByText(SALES_FAILURE_MESSAGES.unavailable)).length).toBeGreaterThan(
      0,
    )
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

  it('SP10: versiune fără text în aplicație → publicarea e dezactivată, nimic nu pleacă', async () => {
    // Harta reală e goală: contractTextMock întoarce null pentru orice versiune.
    // Mutația „butonul se uită doar la formă” (fără `typedText !== null`) îl
    // activează și trimite publicarea: testul pică.
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText(/nepublicat — invitațiile sunt blocate/i)
    await user.type(screen.getByLabelText(/versiunea de publicat/i), '1.0')
    expect(
      await screen.findByText(/textul contractului v1\.0 nu există încă în aplicație/i),
    ).toBeInTheDocument()
    const publishButton = screen.getByRole('button', { name: /publică versiunea/i })
    expect(publishButton).toBeDisabled()
    await user.click(publishButton)
    expect(confirmMock).not.toHaveBeenCalled()
    expect(callsOf('admin_set_sales_contract_version')).toHaveLength(0)
  })

  it('SP11: amprenta publicată scurtată; textul din aplicație diferit e semnalat', async () => {
    // Mutația „corespunde” necondiționat (fără comparația amprentelor) pică aici.
    contractTextMock.mockImplementation(textFor('1.0'))
    server.published = '1.0'
    server.hash = 'f'.repeat(64)
    renderPanel()
    await screen.findByText(/publicat: versiunea 1\.0/i)
    expect(screen.getByText('ffffffffffff…')).toBeInTheDocument()
    expect(
      await screen.findByText(/textul din aplicație pentru versiunea 1\.0 nu corespunde/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/corespunde amprentei publicate\.$/i)).toBeNull()
  })

  it('SP12: versiune publicată fără text în aplicație → semnalată; retragerea rămâne posibilă', async () => {
    // Mutația „se afișează doar amprenta” (fără ramura missing_text) lasă
    // fondatorul să creadă că invitațiile merg, deși nimeni nu poate accepta.
    server.published = '1.0'
    server.hash = CONTRACT_HASH
    renderPanel()
    expect(
      await screen.findByText(/textul versiunii 1\.0 nu există în aplicație/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retrage versiunea/i })).toBeEnabled()
  })

  it('SP13: emailul e o restricție, nu o notă — regula e scrisă lângă câmp și în listă', async () => {
    // mig 304 (sales_invite_redeem): invitația cu email se acceptă DOAR de un cont cu
    // exact acel email, confirmat. Mutațiile „textul vechi” („Emailul și nota sunt
    // doar pentru tine”) și „emailul afișat ca notă” (fără „doar pentru”) pică aici.
    server.invites = [inviteRow({ email: 'ion@firma.ro', note: 'Ion' })]
    renderPanel()
    expect(await screen.findByText(/· doar pentru ion@firma\.ro · Ion/)).toBeInTheDocument()
    const hint = screen.getByText(/numai de un cont cu exact acest email, confirmat/i)
    expect(hint.id).not.toBe('')
    expect(screen.getByLabelText(/email \(opțional\)/i)).toHaveAttribute(
      'aria-describedby',
      hint.id,
    )
    expect(screen.getByText(/lasă câmpul gol dacă nu știi sigur/i)).toBe(hint)
    expect(document.body.textContent ?? '').not.toMatch(/emailul și nota sunt doar pentru tine/i)
  })
})
