// Teste pe cardul „Agentul tău Menuvia” (mig 303), de pe Acasă și din Setări.
// Regulile pe care le păzesc:
//   AG1  fără agent atribuit (sau stare necunoscută) NU se randează nimic — patronii
//        veniți singuri nu văd nimic nou; control pozitiv: AG2 randează
//   AG2  accesul se acordă DOAR printr-un buton explicit (nicio bifă, niciun apel la
//        montare), cu textul a ce vede/NU vede agentul în fața butonului
//   AG3  contactul agentului apare doar când serverul îl întoarce (consimțământ)
//   AG4  retragerea accesului cere confirmare; refuzul confirmării nu cheamă RPC-ul
//   AG5  cererea agentului: „Permite” sau „Refuză”, fără confirmare pentru refuz
//   AG6  fără drept de administrare (manager/fondator) nu există butoane
//   AG7  refuzul serverului ajunge în card, fără să-l strice
//   AG8  `enabled={false}` nu face nici măcar apelul
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MyAgent, MyAgentResult } from '../../lib/agentContact'
import type { AgentActionResult } from '../../lib/myAgent'

const loadMyAgent = vi.fn<(restaurantId: string) => Promise<MyAgentResult | null>>()
const ownerGrantPartnerAccess = vi.fn<(id: string) => Promise<AgentActionResult>>()
const revokePartnerAccess = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>()
const confirmMock = vi.hoisted(() =>
  vi.fn<(opts: { title: string; description?: string; destructive?: boolean }) => Promise<boolean>>(),
)

vi.mock('../../lib/myAgent', () => ({
  loadMyAgent: (id: string) => loadMyAgent(id),
  ownerGrantPartnerAccess: (id: string) => ownerGrantPartnerAccess(id),
}))
vi.mock('../../lib/founder', () => ({
  revokePartnerAccess: (id: string) => revokePartnerAccess(id),
}))
vi.mock('../ui/confirm', () => ({ confirm: confirmMock }))

import { AgentCard } from '../_dashboard/AgentCard'

function agent(over: Partial<MyAgent> = {}): MyAgent {
  return {
    has_agent: true,
    attribution_id: 'att-1',
    agent_name: 'Agent Unu',
    contact_shared: false,
    phone: null,
    email: null,
    access_state: 'none',
    can_manage: true,
    ...over,
  }
}

const GRANT = 'Permite accesul agentului'

beforeEach(() => {
  loadMyAgent.mockReset()
  ownerGrantPartnerAccess.mockReset().mockResolvedValue({ ok: true, state: 'granted' })
  revokePartnerAccess.mockReset().mockResolvedValue({ ok: true })
  confirmMock.mockReset().mockResolvedValue(true)
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('AgentCard', () => {
  it('AG1: fără agent / formă necunoscută / eroare → nu randează nimic', async () => {
    const scenarii: Array<() => void> = [
      () => loadMyAgent.mockResolvedValue({ has_agent: false }),
      () => loadMyAgent.mockResolvedValue(null),
      () => loadMyAgent.mockRejectedValue(new Error('Acces interzis')),
    ]
    for (const prepare of scenarii) {
      loadMyAgent.mockReset()
      prepare()
      const { container, unmount } = render(<AgentCard restaurantId="r1" />)
      await waitFor(() => expect(loadMyAgent).toHaveBeenCalledTimes(1))
      await settle()
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('AG2: acordarea e un buton explicit — nicio bifă, nimic la montare, textul spune ce NU vede agentul', async () => {
    loadMyAgent.mockResolvedValueOnce(agent()).mockResolvedValue(agent({ access_state: 'granted' }))
    render(<AgentCard restaurantId="r1" />)

    expect(await screen.findByText('Agent Unu')).toBeInTheDocument()
    expect(screen.getByText('Fără acces')).toBeInTheDocument()
    // Textul din 286: doar meniu + mese/QR; explicit ce NU vede.
    expect(screen.getByText(/DOAR meniul/)).toBeInTheDocument()
    expect(screen.getByText(/NU vede comenzile/)).toBeInTheDocument()
    // Explicit și NEbifat dinainte: niciun checkbox/switch, niciun apel de acordare.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(ownerGrantPartnerAccess).not.toHaveBeenCalled()
    expect(revokePartnerAccess).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: GRANT }))
    await waitFor(() => expect(ownerGrantPartnerAccess).toHaveBeenCalledWith('att-1'))
    // După reîncărcare cardul arată starea nouă și butonul dispare.
    expect(await screen.findByText('Acces acordat')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: GRANT })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retrage accesul/i })).toBeInTheDocument()
  })

  it('AG3: contactul apare doar dacă serverul îl întoarce (consimțământ), ca linkuri sigure', async () => {
    loadMyAgent.mockResolvedValue(
      agent({ contact_shared: true, phone: '0721 000 111', email: 'agent@exemplu.ro' }),
    )
    const { unmount } = render(<AgentCard restaurantId="r1" />)
    const tel = await screen.findByRole('link', { name: '0721 000 111' })
    expect(tel).toHaveAttribute('href', 'tel:+40721000111')
    expect(screen.getByRole('link', { name: 'agent@exemplu.ro' })).toHaveAttribute(
      'href',
      'mailto:agent@exemplu.ro',
    )
    unmount()

    // Fără consimțământ: serverul întoarce null/null → nicio legătură, doar numele.
    loadMyAgent.mockReset().mockResolvedValue(agent())
    render(<AgentCard restaurantId="r1" />)
    expect(await screen.findByText('Agent Unu')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('AG4: retragerea cere confirmare; refuzul confirmării nu cheamă RPC-ul', async () => {
    loadMyAgent.mockResolvedValue(agent({ access_state: 'granted' }))
    render(<AgentCard restaurantId="r1" />)
    const revoke = await screen.findByRole('button', { name: /retrage accesul/i })

    confirmMock.mockResolvedValueOnce(false)
    await userEvent.click(revoke)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    const opts = confirmMock.mock.calls[0]![0]
    expect(opts.title).toMatch(/retragi accesul/i)
    expect(opts.destructive).toBe(true)
    await settle() // lasă continuarea după confirm să ruleze — altfel „nu s-a apelat” e vacuu
    expect(revokePartnerAccess).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /retrage accesul/i }))
    await waitFor(() => expect(revokePartnerAccess).toHaveBeenCalledWith('att-1'))
    expect(confirmMock).toHaveBeenCalledTimes(2)
  })

  it('AG5: cerere în așteptare — „Permite” și „Refuză” (refuzul fără confirmare)', async () => {
    loadMyAgent.mockResolvedValue(agent({ access_state: 'requested' }))
    render(<AgentCard restaurantId="r1" />)
    expect(await screen.findByText('Agentul a cerut acces')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: GRANT })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refuză cererea' }))
    await waitFor(() => expect(revokePartnerAccess).toHaveBeenCalledWith('att-1'))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(ownerGrantPartnerAccess).not.toHaveBeenCalled()
  })

  it('AG6: fără drept de administrare (manager / fondator) — nicio acțiune', async () => {
    loadMyAgent.mockResolvedValue(agent({ can_manage: false, access_state: 'requested' }))
    render(<AgentCard restaurantId="r1" />)
    expect(await screen.findByText('Agent Unu')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/doar proprietarul/i)).toBeInTheDocument()
  })

  it('AG7: refuzul / eroarea serverului ajunge în card și nu-l strică', async () => {
    loadMyAgent.mockResolvedValue(agent())
    ownerGrantPartnerAccess.mockResolvedValueOnce({ ok: false, error: 'Agentul nu mai este activ.' })
    render(<AgentCard restaurantId="r1" />)
    await userEvent.click(await screen.findByRole('button', { name: GRANT }))
    expect(await screen.findByRole('status')).toHaveTextContent('Agentul nu mai este activ.')
    expect(screen.getByText('Fără acces')).toBeInTheDocument()

    ownerGrantPartnerAccess.mockRejectedValueOnce(new Error('Acces interzis'))
    await userEvent.click(screen.getByRole('button', { name: GRANT }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Acces interzis'))
    expect(screen.getByRole('button', { name: GRANT })).toBeEnabled()
  })

  it('AG8: enabled=false — niciun apel, nimic randat', async () => {
    loadMyAgent.mockResolvedValue(agent())
    const { container } = render(<AgentCard restaurantId="r1" enabled={false} />)
    await settle()
    expect(loadMyAgent).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
