// Pagina de răscumpărare a invitațiilor de rețea (/sef-vanzari/:token, /echipa/:token).
//
//   PG1  fără sesiune → înscriere cu ?next= pe invitație (replace), niciun apel de rețea
//   PG2  contract NEpublicat → „se deschide în curând", butonul rămâne dezactivat
//   PG3  versiune publicată FĂRĂ text în bundle → „s-a actualizat", buton dezactivat (nu se
//        acceptă un document neafișat); „Reîncarcă pagina" merge pe calea CU token
//   PG4  CUI invalid → mesaj, serverul nu e chemat
//   PG5  succes → RPC cu parametrii exacți (hash VERIFICAT al textului afișat, consimțământ
//        nebifat implicit), navigare pe /afiliat prin replace
//   PG6  URL-ul curent pierde tokenul la montare
//   PG7  invite_invalid → UN singur mesaj, formularul se blochează, ieșire spre ALT cont
//        (invitația poate fi legată de emailul altui cont)
//   PG8  cont deja în rețea → mesaj, fără formular
//   PG9  token cu formă greșită → același mesaj generic, fără apel de rețea
//   PG10 RPC nedeployat → „indisponibil", fără formular (tristate)
//   PG11 rolul de agent cheamă RPC-ul de agent
//   PG12 sha256(text local) ≠ amprenta publicată → textul NU se afișează, acceptarea e blocată
//   PG13 `cui_conflict` → mesajul stă la câmpul CUI (aria-describedby), nu în josul formularului
//   PG14 `anonymous_account` → formular blocat + deconectare spre un cont cu email
//   PG15 `contract_hash_mismatch` de la server → se reîncarcă contractul, bifa nu supraviețuiește
//   PG16 adresa FĂRĂ token (reîncărcare din browser / adresă copiată) → „redeschide linkul”,
//        NU `invite_invalid`, niciun apel de rețea (cu și fără sesiune)
//   PG17 bifa de contact spune ADEVĂRAT cine vede contactul: și PATRONII restaurantelor
//        aduse (get_my_agent, mig 303), nu doar rețeaua; retragerea e în panou
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, useAuthMock, contractTextMock, sha256Mock, signOutMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useAuthMock: vi.fn(),
  contractTextMock: vi.fn(),
  sha256Mock: vi.fn(),
  signOutMock: vi.fn(),
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
// sha256Hex e înlocuit cu `hash(<text>)`: amprenta publicată a textului de mai sus.
const PUBLISHED_HASH = `hash(${CONTRACT_TEXT})`
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
    contract: contract('1.0', PUBLISHED_HASH),
    head: null,
    team: [],
    open_invites: [],
    limits: { open_invites_max: 20, invite_ttl_days: 14 },
    ...over,
  }
}

function contract(version: string | null, textHash: string | null) {
  return {
    current_version: version,
    accepted_version: null,
    accepted_at: null,
    needs_acceptance: false,
    current_text_hash: textHash,
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
const reloadAt = vi.fn()

function renderPage(kind: 'head' | 'agent' = 'head', token: string = TOKEN) {
  const base = kind === 'head' ? '/sef-vanzari' : '/echipa'
  window.history.replaceState({}, '', `${base}/${token}`)
  return render(
    <SalesInviteRedeemPage
      kind={kind}
      token={token}
      navigate={navigate}
      replace={replace}
      reloadAt={reloadAt}
    />,
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
  reloadAt.mockReset()
  signOutMock.mockReset()
  signOutMock.mockResolvedValue(undefined)
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({
    user: { id: 'u1', email: 'ana@x.test' },
    loading: false,
    signOut: signOutMock,
  })
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
    serverReturns({ network: { contract: contract(null, null) } })
    const user = userEvent.setup()
    renderPage('head')
    expect(await screen.findByText(/programul se deschide în curând/i)).toBeInTheDocument()
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    expect(submitButton()).toBeDisabled()
    await user.click(submitButton())
    expect(redeemCalls()).toHaveLength(0)
  })

  it('PG3: versiune publicată fără text în bundle → buton dezactivat, reîncărcare cu token', async () => {
    serverReturns({ network: { contract: contract('9.9', 'e'.repeat(64)) } })
    const user = userEvent.setup()
    renderPage('head')
    expect(await screen.findByText(/nu poate fi afișat în această versiune/i)).toBeInTheDocument()
    // Notificarea trimite la BUTONUL paginii, nu la F5 (care ar pierde tokenul).
    // Mutația „înapoi la «reîncarcă pagina» generic” pică aici.
    expect(screen.getByText(/apasă butonul „reîncarcă pagina” de mai jos/i)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/s-a actualizat — reîncarcă pagina/i)
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    expect(screen.getByLabelText(/am citit și accept/i)).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
    expect(redeemCalls()).toHaveLength(0)
    // Tokenul a fost scos din URL la montare: un reload simplu ar pierde invitația.
    // Mutația „reloadAt(basePath)” (fără token) pică aici.
    await user.click(screen.getByRole('button', { name: /^reîncarcă pagina$/i }))
    expect(reloadAt).toHaveBeenCalledWith(`/sef-vanzari/${TOKEN}`)
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
        p_contract_hash: PUBLISHED_HASH,
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

  it('PG7: invite_invalid → un singur mesaj generic, formularul se blochează, ieșire spre alt cont', async () => {
    // Mutația „invite_invalid doar blochează” (fără butonul de deconectare) lasă
    // omul logat cu contul greșit pe o invitație legată de alt email: pică aici.
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_sales_network') return ok(networkPayload())
      return ok({ ok: false, reason: 'invite_invalid' })
    })
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    // Control: înainte de refuz nu există nicio ieșire spre alt cont.
    expect(screen.queryByRole('button', { name: /folosește alt cont/i })).toBeNull()
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.invite_invalid)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(submitButton()).toBeDisabled()
    expect(screen.queryByRole('button', { name: /intră cu emailul tău/i })).toBeNull()
    await user.click(
      screen.getByRole('button', { name: /^deconectează-te și folosește alt cont$/i }),
    )
    expect(signOutMock).toHaveBeenCalledTimes(1)
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

  it('PG12: amprenta locală ≠ cea publicată → textul nu se arată, acceptarea e blocată', async () => {
    // Mutația „orice hash calculat e bun” (contractGate fără comparație) afișează
    // textul și activează butonul: testul pică.
    serverReturns({ network: { contract: contract('1.0', 'f'.repeat(64)) } })
    const user = userEvent.setup()
    renderPage('head')
    expect(
      await screen.findByText(/nu este cel publicat pentru versiunea 1\.0/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/apasă butonul „reîncarcă pagina” de mai jos/i)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/s-a actualizat — reîncarcă pagina/i)
    expect(sha256Mock).toHaveBeenCalledWith(CONTRACT_TEXT)
    expect(screen.queryByText(CONTRACT_TEXT)).toBeNull()
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    expect(screen.getByLabelText(/am citit și accept/i)).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
    await user.click(submitButton())
    expect(redeemCalls()).toHaveLength(0)
  })

  it('PG13: cui_conflict → mesajul stă la câmpul CUI', async () => {
    // Mutația „toate refuzurile în formError” lasă câmpul CUI fără aria-describedby.
    serverReturns({ redeem: { ok: false, reason: 'cui_conflict' } })
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    const msg = await screen.findByText(SALES_FAILURE_MESSAGES.cui_conflict)
    const cuiInput = screen.getByLabelText(/^cui/i)
    expect(cuiInput).toHaveAttribute('aria-invalid', 'true')
    expect(cuiInput).toHaveAttribute('aria-describedby', msg.id)
    expect(screen.getAllByText(SALES_FAILURE_MESSAGES.cui_conflict)).toHaveLength(1)
    // CUI-ul se poate corecta: formularul NU se blochează.
    expect(submitButton()).toBeEnabled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('PG14: anonymous_account → formular blocat, deconectare spre cont cu email', async () => {
    // Mutația „anonymous_account tratat ca orice eroare” lasă butonul de trimitere
    // activ și fără ieșire spre un cont cu email.
    serverReturns({ redeem: { ok: false, reason: 'anonymous_account' } })
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    expect(await screen.findByText(SALES_FAILURE_MESSAGES.anonymous_account)).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    expect(screen.queryByRole('button', { name: /folosește alt cont/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /deconectează-te și intră cu emailul/i }))
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('PG15: contract_hash_mismatch → contractul se reîncarcă, bifa nu supraviețuiește', async () => {
    // Mutația „fără reload pe contract_hash_mismatch” lasă pagina pe versiunea veche.
    const published = { version: '1.0', hash: PUBLISHED_HASH }
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_sales_network')
        return ok(networkPayload({ contract: contract(published.version, published.hash) }))
      // Între citire și trimitere, fondatorul a publicat 1.1 (text absent din acest bundle).
      published.version = '1.1'
      published.hash = 'c'.repeat(64)
      return ok({ ok: false, reason: 'contract_hash_mismatch' })
    })
    const user = userEvent.setup()
    renderPage('head')
    await screen.findByText(CONTRACT_TEXT)
    await fillValid(user)
    await user.click(screen.getByLabelText(/am citit și accept/i))
    await user.click(submitButton())
    expect(
      await screen.findByText(SALES_FAILURE_MESSAGES.contract_hash_mismatch),
    ).toBeInTheDocument()
    expect(await screen.findByText(/nu poate fi afișat în această versiune/i)).toBeInTheDocument()
    expect(rpcMock.mock.calls.filter((c: unknown[]) => c[0] === 'get_sales_network')).toHaveLength(
      2,
    )
    expect(screen.getByLabelText(/am citit și accept/i)).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
  })

  it('PG16: adresa fără token → „redeschide linkul”, NU invite_invalid, niciun apel', async () => {
    // Tokenul e scos din URL la montare, deci un F5 / „Deschide în browser” /
    // o adresă copiată ajung pe /echipa fără el. Mutația „ramura token gol
    // scoasă” cade pe invite_invalid („cere o invitație nouă”) și pică aici.
    serverReturns()
    renderPage('agent', '')
    expect(await screen.findByText(/deschide din nou linkul primit/i)).toBeInTheDocument()
    expect(screen.getByText(/invitația ta nu a fost folosită/i)).toBeInTheDocument()
    expect(screen.queryByText(SALES_FAILURE_MESSAGES.invite_invalid)).toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/nu este validă|cere o invitație nouă/i)
    expect(screen.queryByRole('button', { name: /accept și intru în echipă/i })).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('PG16b: adresa fără token și fără sesiune → același mesaj, fără trimitere la înscriere', async () => {
    // Mutația „trim scos” (doar `token === ''`) lasă tokenul din spații pe invite_invalid.
    useAuthMock.mockReturnValue({ user: null, loading: false })
    serverReturns()
    renderPage('head', '   ')
    expect(await screen.findByText(/deschide din nou linkul primit/i)).toBeInTheDocument()
    expect(screen.queryByText(SALES_FAILURE_MESSAGES.invite_invalid)).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  // PG17 — mutația care pică: textul vechi al bifei („…agenților din echipa mea (poți
  // retrage oricând)”), care tăcea despre patroni, sau nota scoasă de lângă bifă.
  it.each(['head', 'agent'] as const)(
    'PG17 (%s): bifa pomenește patronii și panoul',
    async (kind) => {
      serverReturns()
      renderPage(kind)
      await screen.findByText(CONTRACT_TEXT)
      const box = screen.getByLabelText(/arată numele, telefonul/i)
      const label = box.closest('label')?.textContent ?? ''
      expect(label).toMatch(/patronilor restaurantelor pe care le aduc/i)
      expect(label).toMatch(/din panoul tău/i)
      // Numele e afișat patronilor ORICUM (mig 303): nota o spune, legată de bifă.
      const noteId = box.getAttribute('aria-describedby') ?? ''
      expect(document.getElementById(noteId)?.textContent ?? '').toMatch(
        /numele tău îl văd oricum patronii/i,
      )
    },
  )
})
