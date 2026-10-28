// Pagina de răscumpărare a invitațiilor de rețea (/sef-vanzari/:token, /echipa/:token).
//
//   PG1  fără sesiune → înscriere cu ?next= pe invitație (replace), niciun apel de rețea
//   PG2  contract NEpublicat → „se deschide în curând", butonul rămâne dezactivat
//   PG3  versiune publicată FĂRĂ text în bundle → buton dezactivat (nu se acceptă un document neafișat)
//   PG4  CUI invalid → mesaj, serverul nu e chemat
//   PG5  succes → RPC cu parametrii exacți (hash pe textul afișat, consimțământ nebifat implicit),
//        navigare pe /afiliat prin replace
//   PG6  URL-ul curent pierde tokenul la montare
//   PG7  invite_invalid → UN singur mesaj, formularul se blochează
//   PG8  cont deja în rețea → mesaj, fără formular
//   PG9  token cu formă greșită → același mesaj generic, fără apel de rețea
//   PG10 RPC nedeployat → „indisponibil", fără formular (tristate)
//   PG11 rolul de agent cheamă RPC-ul de agent
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, useAuthMock, contractTextMock, sha256Mock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useAuthMock: vi.fn(),
  contractTextMock: vi.fn(),
  sha256Mock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('../../lib/salesContract', () => ({ contractTextFor: contractTextMock }))
vi.mock('../../lib/salesNetwork', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/salesNetwork')>()
  return { ...actual, sha256Hex: sha256Mock }
})

import SalesInviteRedeemPage from '../SalesInviteRedeemPage'
import { SALES_FAILURE_MESSAGES } from '../../lib/salesNetwork'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'
const CONTRACT_TEXT = 'TEXT CONTRACT VERSIUNEA 1.0'
const VALID_CUI = '14399840'

function ok(data: unknown) {
  return Promise.resolve({ data, error: null })
}
function rpcFail(code: string) {
  return Promise.resolve({ data: null, error: { code, message: 'x' } })
}

function networkPayload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    role: null,
    status: null,
    affiliate_id: null,
    contact_sharing: false,
    contract: {
      current_version: '1.0',
      accepted_version: null,
      accepted_at: null,
      needs_acceptance: false,
    },
    head: null,
    team: [],
    open_invites: [],
    limits: { open_invites_max: 20, invite_ttl_days: 14 },
    ...over,
  }
}

function redeemPayload(role: 'head' | 'agent') {
  return {
    ok: true,
    affiliate_id: 'aff-1',
    role,
    status: 'active',
    referral_code: 'ABC1234',
    parent_affiliate_id: null,
    already: false,
  }
}

function serverReturns(opts: { network?: Record<string, unknown>; redeem?: unknown } = {}) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === 'get_sales_network') return ok(networkPayload(opts.network))
    if (fn === 'redeem_sales_head_invite') return ok(opts.redeem ?? redeemPayload('head'))
    if (fn === 'redeem_agent_invite') return ok(opts.redeem ?? redeemPayload('agent'))
    return rpcFail('PGRST202')
  })
}

function redeemCalls(): unknown[][] {
  return rpcMock.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith('redeem_'))
}

const navigate = vi.fn()
const replace = vi.fn()

function renderPage(kind: 'head' | 'agent' = 'head', token: string = TOKEN) {
  const base = kind === 'head' ? '/sef-vanzari' : '/echipa'
  window.history.replaceState({}, '', `${base}/${token}`)
  return render(
    <SalesInviteRedeemPage kind={kind} token={token} navigate={navigate} replace={replace} />,
  )
}

const submitButton = () => screen.getByRole('button', { name: /accept și intru în echipă/i })

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^telefon$/i), '0722 123 456')
  await user.type(screen.getByLabelText(/^cui/i), VALID_CUI)
}

beforeEach(() => {
  rpcMock.mockReset()
  navigate.mockReset()
  replace.mockReset()
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'u1', email: 'ana@x.test' }, loading: false })
  contractTextMock.mockReset()
  contractTextMock.mockImplementation((version: string | null) =>
    version === '1.0' ? CONTRACT_TEXT : null,
  )
  sha256Mock.mockReset()
  sha256Mock.mockImplementation((text: string) => Promise.resolve(`hash(${text})`))
})

describe('SalesInviteRedeemPage', () => {
  it('PG1: fără sesiune → înscriere cu next pe invitație, fără apeluri de rețea', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false })
    serverReturns()
    renderPage('head')
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(replace).toHaveBeenCalledWith(
      `/auth?mode=signup&lang=ro&next=${encodeURIComponent(`/sef-vanzari/${TOKEN}`)}`,
    )
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('PG2: contract nepublicat → „se deschide în curând", butonul rămâne dezactivat', async () => {
    serverReturns({
      network: {
        contract: {
          current_version: null,
          accepted_version: null,
          accepted_at: null,
          needs_acceptance: false,
        },
      },
    })
    const user = userEvent.setup()
    renderPage('head')
    expect(await screen.findByText(/programul se deschide în curând/i)).toBeInTheDocument()
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    expect(submitButton()).toBeDisabled()
    await user.click(submitButton())
    expect(redeemCalls()).toHaveLength(0)
  })

  it('PG3: versiune publicată fără text în bundle → buton dezactivat', async () => {
    serverReturns({
      network: {
        contract: {
          current_version: '9.9',
          accepted_version: null,
          accepted_at: null,
          needs_acceptance: false,
        },
      },
    })
    const user = userEvent.setup()
    renderPage('head')
    expect(await screen.findByText(/nu poate fi afișat în această versiune/i)).toBeInTheDocument()
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    expect(submitButton()).toBeDisabled()
    expect(redeemCalls()).toHaveLength(0)
  })

  it('PG4: CUI invalid → mesaj, serverul nu e chemat', async () => {
    serverReturns()
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    await user.type(screen.getByLabelText(/^telefon$/i), '0722 123 456')
    await user.type(screen.getByLabelText(/^cui/i), '14399841') // cifra de control greșită
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.cui_invalid)).toBeInTheDocument()
    expect(redeemCalls()).toHaveLength(0)
    expect(replace).not.toHaveBeenCalled()
  })

  it('PG5: succes → RPC exact, consimțământul NEbifat implicit, navigare pe /afiliat', async () => {
    serverReturns()
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    expect(screen.getByLabelText(/arată numele, telefonul/i)).not.toBeChecked()
    expect(screen.getByLabelText(/am citit și accept/i)).not.toBeChecked()
    expect(submitButton()).toBeDisabled()

    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/afiliat'))
    expect(redeemCalls()).toHaveLength(1)
    expect(redeemCalls()[0]).toEqual([
      'redeem_sales_head_invite',
      {
        p_token: TOKEN,
        p_phone: '0722 123 456',
        p_cui: VALID_CUI,
        p_contract_version: '1.0',
        p_contract_hash: `hash(${CONTRACT_TEXT})`,
        p_share_contact: false,
      },
    ])
    expect(sha256Mock).toHaveBeenCalledWith(CONTRACT_TEXT)
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('PG5b: consimțământul bifat explicit ajunge la server', async () => {
    serverReturns()
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    await fillValid(user)
    await user.click(screen.getByLabelText(/arată numele, telefonul/i))
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    await waitFor(() => expect(redeemCalls()).toHaveLength(1))
    expect((redeemCalls()[0][1] as Record<string, unknown>).p_share_contact).toBe(true)
  })

  it('PG6: URL-ul pierde tokenul la montare', async () => {
    serverReturns()
    renderPage('agent')
    await screen.findByText(CONTRACT_TEXT)
    expect(window.location.pathname).toBe('/echipa')
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('PG7: invite_invalid → un singur mesaj generic, formularul se blochează', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_sales_network') return ok(networkPayload())
      return ok({ ok: false, reason: 'invite_invalid' })
    })
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.invite_invalid)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(submitButton()).toBeDisabled()
  })

  it('PG8: cont deja în rețea → mesaj, fără formular', async () => {
    serverReturns({ network: { role: 'agent', status: 'active', affiliate_id: 'aff-9' } })
    renderPage('head')
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.already_affiliate)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^cui/i)).toBeNull()
  })

  it('PG9: token cu formă greșită → mesaj generic, fără apel de rețea', async () => {
    serverReturns()
    renderPage('head', 'prea-scurt')
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.invite_invalid)).toBeInTheDocument()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('PG10: RPC nedeployat → „indisponibil", fără formular', async () => {
    rpcMock.mockImplementation(() => rpcFail('PGRST202'))
    renderPage('head')
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.unavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept și intru în echipă/i })).toBeNull()
  })

  it('PG11: rolul de agent cheamă RPC-ul de agent', async () => {
    serverReturns()
    const user = userEvent.setup()
    renderPage('agent')
    await screen.findByText(CONTRACT_TEXT)
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    await waitFor(() => expect(redeemCalls()).toHaveLength(1))
    expect(redeemCalls()[0][0]).toBe('redeem_agent_invite')
  })
})
