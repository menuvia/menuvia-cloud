// Piesele comune ale ecranelor de personal în limba personalului (lotul L4c):
// panoul „Epuizate” (Ospătar + Bucătărie, namespace `orders`), „Ieși din cont”
// (Panou + Ospătar + Bucătărie, `common`) și „Ajutor” (bara laterală a
// panoului, `dashboard`). Controlul românesc al fiecăreia e suita ei
// (StaffSoldOutSheet SS1–SS3, SignOutButton SO1–SO3, HelpButton HB1–HB5),
// NESCHIMBATĂ. Prefixul LB continuă suita Bucătăriei (KitchenPageLang LB0–LB6).
//   LB7  „Epuizate” în germană: titlul, sursa stării („Ausverkauft · laut
//        Bestand”), pluralul, butonul cu numele produsului, căutarea; un refuz
//        42501 → textul de drepturi al limbii, nu „permission denied” și nici
//        textul românesc. Mutația care pică: `toUserMessage` readus pe rând
//        (în germană ar apărea MSG_NO_PERMISSION, adică româna).
//   LB8  „Ieși din cont” în franceză: butonul, confirmarea (titlu, descriere
//        cu avertismentul paginii ÎNAINTE, eticheta, „Annuler” explicit —
//        altfel anularea venea din cromul pe `<html lang>`, adică „Anulează”)
//        și refuzul de rețea în franceză. Mutația care pică: descrierea românească scrisă în cod.
//   LB9  „Ajutor” în engleză (agentul cu canalele lui, apoi suportul), iar în
//        română etichetele acțiunilor sunt EXACT cele din `buildHelpOptions`
//        (oracolul românesc, folosit și de agentContact.test). Mutația care
//        pică: cheia `help_emailSupport` confundată cu `help_emailAgent`.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MyAgent, MyAgentResult } from '../../lib/agentContact'

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  set: vi.fn(),
  signOut: vi.fn<() => Promise<void>>(),
  confirm: vi.fn<
    (o: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>
  >(),
  loadMyAgent: vi.fn<(restaurantId: string) => Promise<MyAgentResult | null>>(),
}))

vi.mock('../../lib/soldOut', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/soldOut')>()
  return { ...actual, fetchStaffSoldOutProducts: h.fetch, setProductSoldOut: h.set }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ signOut: h.signOut }) }))
vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))
vi.mock('../../lib/myAgent', () => ({ loadMyAgent: (id: string) => h.loadMyAgent(id) }))

import StaffSoldOutSheet from '../StaffSoldOutSheet'
import { SignOutButton } from '../SignOutButton'
import { HelpButton } from '../HelpButton'
import { buildHelpOptions } from '../../lib/agentContact'
import { CONTACT_EMAIL } from '../../lib/domain'
import { MSG_NO_PERMISSION } from '../../lib/userMessages'
import { preloadNamespace } from '../../i18n/core'
import { ordersNs } from '../../i18n/ns/orders'
import { commonNs } from '../../i18n/ns/common'
import { dashboardNs } from '../../i18n/ns/dashboard'
import dashboardRo from '../../i18n/ns/dashboard/ro'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [
      preloadNamespace(ordersNs, l),
      preloadNamespace(commonNs, l),
      preloadNamespace(dashboardNs, l),
    ]),
  )
})

beforeEach(() => {
  h.fetch.mockReset()
  h.set.mockReset()
  h.signOut.mockReset()
  h.confirm.mockReset()
  h.loadMyAgent.mockReset()
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

const ROWS = [
  { id: 'p-supa', name: 'Supă', emoji: '🍲', is_sold_out: true, sold_out_source: 'stock', display_order: 1 },
  { id: 'p-apa', name: 'Apă', emoji: '💧', is_sold_out: false, sold_out_source: null, display_order: 0 },
]

describe('panoul „Epuizate” în limba personalului', () => {
  it('LB7: în germană — titlul, sursa, pluralul, butoanele; refuzul în germană', async () => {
    const user = userEvent.setup()
    h.fetch.mockResolvedValue(ROWS)
    h.set.mockRejectedValue(
      Object.assign(new Error('permission denied for function set_product_sold_out'), { code: '42501' }),
    )
    // Modal-ul se randează într-un portal: textul se citește din `document.body`.
    inLang('de', <StaffSoldOutSheet restaurantId="r1" onClose={vi.fn()} />)

    expect(await screen.findByText('Ausverkauft · laut Bestand')).toBeInTheDocument()
    expect(screen.getByText('Ausverkaufte Produkte')).toBeInTheDocument()
    expect(screen.getByText('1 Produkt ausverkauft.')).toBeInTheDocument()
    expect(screen.getByText('Verfügbar')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Produkt suchen' })).toHaveAttribute('placeholder', 'Produkt suchen')
    expect(document.body).toHaveTextContent('erscheint auf der Speisekarte als „Ausverkauft“')

    await user.click(screen.getByRole('button', { name: 'Als ausverkauft markieren: Apă' }))
    expect(h.set).toHaveBeenCalledWith('p-apa', true)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sie haben keine Berechtigung für diese Aktion.')
    expect(alert.textContent).not.toContain('permission denied')
    expect(alert.textContent).not.toContain(MSG_NO_PERMISSION)

    const text = document.body.textContent ?? ''
    for (const ro of ['Produse epuizate', 'Epuizat', 'Disponibil', 'Marchează', 'din stoc', 'Caută']) {
      expect(text, ro).not.toContain(ro)
    }
  })
})

describe('„Ieși din cont” în limba personalului', () => {
  it('LB8: în franceză — butonul, confirmarea și refuzul de rețea', async () => {
    h.confirm.mockResolvedValue(true)
    h.signOut.mockRejectedValue(new TypeError('Failed to fetch'))
    inLang('fr', <SignOutButton variant="header" warning="1 commande n’a pas encore été envoyée." />)
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(h.confirm).toHaveBeenCalledWith({
      title: 'Se déconnecter ?',
      description: '1 commande n’a pas encore été envoyée. Vous devrez vous reconnecter sur cet appareil.',
      confirmLabel: 'Se déconnecter',
      cancelLabel: 'Annuler',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Vérifiez votre accès à Internet et réessayez.',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeEnabled())
    expect(document.body.textContent ?? '').not.toMatch(/Ieși din cont|Fără conexiune/)
  })
})

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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('„Ajutor” în limba personalului', () => {
  it('LB9: în engleză — agentul, apoi suportul; în română etichetele = buildHelpOptions', async () => {
    h.loadMyAgent.mockResolvedValue(agent())
    const withAgent = inLang('en', <HelpButton restaurantId="r1" enabled />)
    await waitFor(() => expect(h.loadMyAgent).toHaveBeenCalledTimes(1))
    await settle()
    await userEvent.click(screen.getByRole('button', { name: /help/i }))
    expect(screen.getByText('Your Menuvia agent, Agent Unu, can help you:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call the agent' })).toHaveAttribute('href', 'tel:+40721000111')
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send an email' })).toHaveAttribute('href', 'mailto:agent@exemplu.ro')
    expect(screen.queryByRole('link', { name: 'Email us' })).toBeNull()
    withAgent.unmount()

    h.loadMyAgent.mockResolvedValue({ has_agent: false })
    inLang('en', <HelpButton restaurantId="r1" enabled />)
    await settle()
    await userEvent.click(screen.getByRole('button', { name: /help/i }))
    expect(screen.getByText('Have a question or a problem? Email us.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Email us' })).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`)
    expect(document.body.textContent ?? '').not.toMatch(/Ajutor|Scrie|Agentul/)

    // Oracolul românesc: etichetele din `buildHelpOptions` (agent + suport).
    const agentLabels = buildHelpOptions(agent(), CONTACT_EMAIL).actions.map((a) => a.label)
    const supportLabels = buildHelpOptions(null, CONTACT_EMAIL).actions.map((a) => a.label)
    expect([dashboardRo.help_call, dashboardRo.help_whatsapp, dashboardRo.help_emailAgent]).toEqual(agentLabels)
    expect([dashboardRo.help_emailSupport]).toEqual(supportLabels)
  })
})
