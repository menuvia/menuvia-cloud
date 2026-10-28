// Teste pe butonul „Ajutor” din bara laterală (mig 303).
//   HB1  fără agent → adresa de suport din lib/domain (nu un literal în componentă)
//   HB2  agent cu consimțământ → apel / WhatsApp / email ale agentului, FĂRĂ suport
//   HB3  agent FĂRĂ consimțământ → suportul; nicio cifră din telefon în pagină
//   HB4  `enabled={false}` (staff fără drepturi) → niciun apel RPC, doar suportul
//   HB5  panoul e închis până la click; textul nu promite termene de răspuns
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MyAgent, MyAgentResult } from '../../lib/agentContact'
import { CONTACT_EMAIL } from '../../lib/domain'

const loadMyAgent = vi.fn<(restaurantId: string) => Promise<MyAgentResult | null>>()
vi.mock('../../lib/myAgent', () => ({
  loadMyAgent: (id: string) => loadMyAgent(id),
}))

import { HelpButton } from '../HelpButton'

function agent(over: Partial<MyAgent> = {}): MyAgent {
  return {
    has_agent: true,
    attribution_id: 'att-1',
    agent_name: 'Agent Unu',
    contact_shared: true,
    phone: '0721 000 111',
    email: 'agent@exemplu.ro',
    access_state: 'none',
    can_manage: true,
    ...over,
  }
}

beforeEach(() => {
  loadMyAgent.mockReset()
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('HelpButton', () => {
  it('HB1: fără agent → adresa de suport', async () => {
    loadMyAgent.mockResolvedValue({ has_agent: false })
    render(<HelpButton restaurantId="r1" enabled />)
    await waitFor(() => expect(loadMyAgent).toHaveBeenCalledTimes(1))
    await settle()
    await userEvent.click(screen.getByRole('button', { name: /ajutor/i }))
    expect(screen.getByRole('link', { name: 'Scrie-ne pe email' })).toHaveAttribute(
      'href',
      `mailto:${CONTACT_EMAIL}`,
    )
    expect(screen.queryByRole('link', { name: 'Sună agentul' })).not.toBeInTheDocument()
  })

  it('HB2: agent cu consimțământ → canalele agentului, fără suport', async () => {
    loadMyAgent.mockResolvedValue(agent())
    render(<HelpButton restaurantId="r1" enabled />)
    await userEvent.click(screen.getByRole('button', { name: /ajutor/i }))
    expect(await screen.findByRole('link', { name: 'Sună agentul' })).toHaveAttribute(
      'href',
      'tel:+40721000111',
    )
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/40721000111',
    )
    expect(screen.getByRole('link', { name: 'Scrie pe email' })).toHaveAttribute(
      'href',
      'mailto:agent@exemplu.ro',
    )
    expect(screen.queryByRole('link', { name: 'Scrie-ne pe email' })).not.toBeInTheDocument()
    expect(screen.getByText(/Agentul tău Menuvia, Agent Unu/)).toBeInTheDocument()
  })

  it('HB3: agent FĂRĂ consimțământ → suportul, fără datele agentului', async () => {
    loadMyAgent.mockResolvedValue(agent({ contact_shared: false }))
    const { container } = render(<HelpButton restaurantId="r1" enabled />)
    await waitFor(() => expect(loadMyAgent).toHaveBeenCalledTimes(1))
    await settle()
    await userEvent.click(screen.getByRole('button', { name: /ajutor/i }))
    expect(screen.getByRole('link', { name: 'Scrie-ne pe email' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sună agentul' })).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('0721')
    expect(container.innerHTML).not.toContain('agent@exemplu.ro')
  })

  it('HB4: enabled=false → niciun apel RPC, doar suportul', async () => {
    loadMyAgent.mockResolvedValue(agent())
    render(<HelpButton restaurantId="r1" enabled={false} />)
    await settle()
    expect(loadMyAgent).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /ajutor/i }))
    expect(screen.getByRole('link', { name: 'Scrie-ne pe email' })).toBeInTheDocument()
  })

  it('HB5: panoul e închis până la click; fără promisiuni de termen', async () => {
    loadMyAgent.mockResolvedValue({ has_agent: false })
    render(<HelpButton restaurantId="r1" enabled />)
    await settle()
    expect(screen.queryByTestId('help-panel')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /ajutor/i }))
    const panel = screen.getByTestId('help-panel')
    expect(panel.textContent ?? '').not.toMatch(/\d+\s*ore|fondator|direct/i)
  })
})
