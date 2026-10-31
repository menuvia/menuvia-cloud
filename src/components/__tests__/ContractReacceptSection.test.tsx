// „Contract nou de colaborare” în panoul agentului (mig 308).
//   KR1  textul verificat se arată; butonul e blocat până la bifă; acceptarea
//        cheamă accept_sales_contract cu versiunea și hash-ul TEXTULUI AFIȘAT,
//        apoi reîncarcă rețeaua
//   KR2  textul lipsește din aplicație → mesaj, fără bifă și fără buton
//   KR3  hash-ul local ≠ cel publicat → textul NU se arată, fără buton
//   KR4  refuz de contract de la server → mesajul PANOULUI („Reîncarcă pagina”),
//        nu cel al răscumpărării („linkul invitației”); fără reîncărcare
//   KR5  alt refuz (cont închis) → mesajul lui
//   KR6  o versiune nouă resetează bifa (bifa e legată de hash, nu e un boolean)
//   KR4b contract retras între timp → „Contractul a fost retras”, nu mesajul
//        despre invitații al răscumpărării
//   KR7  aceeași versiune republicată cu alt text → „s-a modificat de când l-ai
//        acceptat”, nu „ai acceptat ultima dată versiunea v2.0”
//   KR8  acceptare reușită + reîncărcare care NU aduce date noi (rețea picată) →
//        confirmare pe ecran, fără formular (mutația fără starea locală pică)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock, contractTextMock, sha256Mock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  contractTextMock: vi.fn(),
  sha256Mock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../../lib/salesContract', () => ({ contractTextFor: contractTextMock }))
vi.mock('../../lib/salesNetwork', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/salesNetwork')>()
  return { ...actual, sha256Hex: sha256Mock }
})

import ContractReacceptSection from '../afiliat/ContractReacceptSection'
import { SALES_FAILURE_MESSAGES, type SalesContractStatus } from '../../lib/salesNetwork'

const TEXTS: Record<string, string> = { '2.0': 'TEXT VERSIUNEA 2.0', '3.0': 'TEXT VERSIUNEA 3.0' }
const hashOf = (t: string) => `hash(${t})`

function contract(version: string, over: Partial<SalesContractStatus> = {}): SalesContractStatus {
  return {
    currentVersion: version,
    acceptedVersion: '1.0',
    acceptedAt: '2026-10-01T10:00:00Z',
    needsAcceptance: true,
    currentTextHash: hashOf(TEXTS[version] ?? ''),
    ...over,
  }
}

const onAccepted = vi.fn(async () => undefined)

beforeEach(() => {
  rpcMock.mockReset()
  onAccepted.mockClear()
  contractTextMock.mockReset().mockImplementation((v: string | null) => (v !== null ? (TEXTS[v] ?? null) : null))
  sha256Mock.mockReset().mockImplementation(async (t: string) => hashOf(t))
})

describe('ContractReacceptSection', () => {
  it('KR1: text verificat → bifă → acceptare cu hash-ul textului afișat', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, already: false, version: '2.0' }, error: null })
    const user = userEvent.setup()
    render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    expect(await screen.findByText('TEXT VERSIUNEA 2.0')).toBeInTheDocument()
    expect(screen.getByText(/ultima dată versiunea v1\.0/)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Accept contractul' })
    expect(btn).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(btn).toBeEnabled()
    await user.click(btn)
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(rpcMock).toHaveBeenCalledWith('accept_sales_contract', {
      p_contract_version: '2.0',
      p_contract_hash: hashOf('TEXT VERSIUNEA 2.0'),
    })
  })

  it('KR2: textul lipsește din aplicație → mesaj, fără bifă și fără buton', async () => {
    contractTextMock.mockReturnValue(null)
    render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    expect(await screen.findByText(/nu este încă în aplicație/)).toBeInTheDocument()
    expect(screen.queryByText(/Citește textul de mai jos/)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept contractul' })).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('KR3: hash local ≠ publicat → textul nu se arată, fără buton', async () => {
    render(
      <ContractReacceptSection
        contract={contract('2.0', { currentTextHash: 'f'.repeat(64) })}
        onAccepted={onAccepted}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/nu este cel publicat/)
    expect(screen.queryByText('TEXT VERSIUNEA 2.0')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept contractul' })).toBeNull()
  })

  it('KR4: refuz de contract → mesajul panoului, fără reîncărcare', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, reason: 'contract_hash_mismatch' }, error: null })
    const user = userEvent.setup()
    render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept contractul' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Reîncarcă pagina și citește versiunea curentă')
    expect(alert).not.toHaveTextContent(/linkul invitației/)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('KR5: cont închis → mesajul lui', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, reason: 'account_closed' }, error: null })
    const user = userEvent.setup()
    render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept contractul' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(SALES_FAILURE_MESSAGES.account_closed)
  })

  it('KR6: o versiune nouă resetează bifa', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    await user.click(await screen.findByRole('checkbox'))
    expect(screen.getByRole('checkbox')).toBeChecked()
    rerender(<ContractReacceptSection contract={contract('3.0')} onAccepted={onAccepted} />)
    expect(await screen.findByText('TEXT VERSIUNEA 3.0')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Accept contractul' })).toBeDisabled()
  })

  it('KR4b: contract retras între timp → mesajul panoului, fără invitații', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, reason: 'contract_not_published' }, error: null })
    const user = userEvent.setup()
    render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept contractul' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Contractul a fost retras între timp. Reîncarcă pagina.')
    expect(alert).not.toHaveTextContent(/invitați/)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('KR7: aceeași versiune, alt text → „s-a modificat”, nu „ai acceptat ultima dată v2.0”', async () => {
    render(
      <ContractReacceptSection contract={contract('2.0', { acceptedVersion: '2.0' })} onAccepted={onAccepted} />,
    )
    expect(await screen.findByText('TEXT VERSIUNEA 2.0')).toBeInTheDocument()
    expect(screen.getByText(/s-a modificat de când l-ai acceptat/)).toBeInTheDocument()
    expect(screen.queryByText(/ultima dată versiunea v2\.0/)).toBeNull()
  })

  it('KR8: acceptare reușită, reîncărcarea nu aduce date noi → confirmare, fără formular', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, already: false, version: '2.0' }, error: null })
    const user = userEvent.setup()
    // onAccepted nu schimbă props-urile: exact ce se vede când reload-ul pică.
    render(<ContractReacceptSection contract={contract('2.0')} onAccepted={onAccepted} />)
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept contractul' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Ai acceptat contractul v2.0.')
    expect(screen.queryByRole('button', { name: 'Accept contractul' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
