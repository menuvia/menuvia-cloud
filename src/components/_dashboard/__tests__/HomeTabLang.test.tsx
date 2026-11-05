// „Acasă” în limba personalului (lotul L3a): HomeTab și cardurile lui citesc
// textele din namespace-ul `home` (+ `common` pentru „Reîncearcă”/„Închide”).
//   HL1  control: fără provider (azi, mereu româna) ecranul e cel de dinainte —
//        salutul, „Comenzi azi”, pașii de configurare (cu „(completat)” în
//        numele accesibil), acțiunile rapide, oferta. Mutația care pică: o
//        cheie cu text românesc schimbat (testele vechi ar prinde doar o parte).
//   HL2  `<UiLangScope lang="en">`: același ecran în engleză și NICIUN cuvânt
//        românesc rămas (nici diacritice). Mutația care pică: un text lăsat în
//        cod în HomeTab sau în PlanUpsellCard (ex. „Acțiuni rapide”).
//   HL3  engleză, numărul de produse necunoscut: numele accesibil al pasului e
//        „Add products (status unknown)” — sufixul vine tot din dicționar.
//        Mutația care pică: `it.label + ' (stare necunoscută)'` readus.
//   HL4  PlanUpsellCard în germană: titlul, regiunea „Angebot: …”, beneficiile
//        și butonul; numele comercial al planului (PLAN_LABELS) rămâne cel
//        românesc, netradus (regula 4). Mutația care pică: COPY cu text fix.
//   HL5  SubscriptionCard în germană: textele cardului, iar un refuz al
//        serverului cu mesaj ROMÂNESC nu ajunge pe ecran — apare textul de
//        rezervă german. Mutația care pică: `toUserMessage` în loc de
//        `describeStaffError` (ar afișa româna într-un card german).
//   HL6  PlanUnknownBanner în franceză, cu „Réessayer” din `common`.
//        Mutația care pică: butonul cu „Reîncearcă” scris în cod.
//   HL7  AgentCard în engleză, pe o cerere de acces: titlul, starea, ce vede
//        și ce NU vede agentul, butoanele. Mutația care pică: eticheta stării
//        citită din `lib/agentContact` (era română fixă) în loc de dicționar.
import { Suspense, type ComponentProps, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MyAgentResult } from '../../../lib/agentContact'

const { counts, codvia, agentState, openBillingPortal } = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  codvia: { open: null as boolean | null },
  agentState: { agent: null as MyAgentResult | null },
  openBillingPortal: vi.fn<() => Promise<never>>(),
}))

// Builder thenable (ca în HomeTab.test.tsx): `await from(t)…` dă {count, data, error}.
vi.mock('../../../lib/supabase', () => {
  type MockResult = { data: unknown[] | null; count: number | null; error: unknown }
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'gte', 'gt', 'in', 'not', 'limit', 'order']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (onFulfilled: (v: MockResult) => unknown, onRejected?: (e: unknown) => unknown) => {
      const n = counts[table] ?? 0
      const result: MockResult = { data: n > 0 ? [{ id: 'x' }] : [], count: n, error: null }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    }
    return b
  }
  const rpc = vi.fn(() => Promise.resolve({ data: [], error: null }))
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc } }
})
vi.mock('../../../lib/health', () => ({
  fetchHealthScore: () => new Promise(() => {}),
  scoreLabel: () => '',
  scoreColor: () => '#888',
  getActionableSuggestions: () => [],
  planHealthScore: () => 0,
}))
vi.mock('../../../hooks/useBridgeConnected', () => ({
  useBridgeConnected: () => ({ status: null, loading: false, reload: vi.fn() }),
}))
vi.mock('../../../hooks/useCodviaOrdersOpen', () => ({
  useCodviaOrdersOpen: () => codvia.open,
}))
// AgentCard e REAL (HL7): agentul vine din hook; `null` = cardul nu se randează.
vi.mock('../../../hooks/useMyAgent', () => ({
  useMyAgent: () => ({ agent: agentState.agent, reload: vi.fn() }),
}))
vi.mock('../../../lib/billing', () => ({
  openBillingPortal: () => openBillingPortal(),
}))

import HomeTab from '../HomeTab'
import { AgentCard } from '../AgentCard'
import { PlanUpsellCard } from '../PlanUpsellCard'
import { PlanUnknownBanner } from '../PlanBanners'
import { SubscriptionCard } from '../SubscriptionCard'
import { surfaceFor } from '../../../lib/__tests__/planSurfaceFixtures'
import { planUpsellTarget } from '../../../lib/planSurface'
import { PLAN_LABELS } from '../../../lib/constants'
import { preloadNamespace } from '../../../i18n/core'
import { homeNs } from '../../../i18n/ns/home'
import { commonNs } from '../../../i18n/ns/common'
import { UiLangScope } from '../../../i18n/UiLangContext'
import type { StaffLang } from '../../../i18n/langs'

type Props = ComponentProps<typeof HomeTab>

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [preloadNamespace(homeNs, l), preloadNamespace(commonNs, l)]),
  )
})

beforeEach(() => {
  codvia.open = null
  agentState.agent = null
  openBillingPortal.mockReset()
  for (const k of Object.keys(counts)) delete counts[k]
  // Fără mese → pasul „QR-uri pentru mese” rămâne de făcut, deci cardul de
  // configurare se vede; restul pașilor sunt făcuți.
  Object.assign(counts, { tables: 0, categories: 2, orders: 3, restaurant_memberships: 3 })
  localStorage.setItem('menuvia.menu_checked.r1', '1')
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
}

function renderHome(lang: StaffLang | null, over: Partial<Props> = {}) {
  const surface = surfaceFor('growth')
  const props: Props = {
    restaurantId: 'r1',
    restaurantName: 'Bistro Test',
    surface,
    upsell: planUpsellTarget(surface, { fiscalMarket: true }),
    isAdmin: true,
    isOwner: true,
    productCount: 12,
    pickupOnly: false,
    onNavigate: vi.fn(),
    onViewMenu: vi.fn(),
    onPricing: vi.fn(),
    onOrderQrStands: vi.fn(),
    ...over,
  }
  return inLang(lang, <HomeTab {...props} />)
}

describe('Acasă în limba personalului', () => {
  it('HL1: control — fără provider, româna de dinainte', async () => {
    renderHome(null)
    expect(await screen.findByText('Bun venit, Bistro Test')).toBeInTheDocument()
    expect(screen.getByText('Comenzi azi')).toBeInTheDocument()
    expect(await screen.findByText('Configurare restaurant')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Generează QR-uri pentru mese' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă produse (completat)' })).toBeInTheDocument()
    expect(screen.getByText('Acțiuni rapide')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Ofertă: Plata la masă' })).toBeInTheDocument()
  })

  it('HL2: în engleză tot ecranul e englezesc, fără niciun cuvânt românesc', async () => {
    const { container } = renderHome('en')
    expect(await screen.findByText('Welcome, Bistro Test')).toBeInTheDocument()
    expect(screen.getByText('Orders today')).toBeInTheDocument()
    expect(screen.getByText('Active products')).toBeInTheDocument()
    expect(await screen.findByText('Restaurant setup')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Generate QR codes for your tables' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add products (done)' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toBeInTheDocument()
    expect(screen.getByText('Quick actions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View public menu' })).toBeInTheDocument()
    const offer = screen.getByRole('region', { name: 'Offer: Pay at the table' })
    expect(within(offer).getByRole('button', { name: 'See plan' })).toBeInTheDocument()
    // Singurul text românesc admis e numele comercial al planului (regula 4).
    const text = (container.textContent ?? '').replace(PLAN_LABELS.pro, '')
    expect(text).not.toMatch(
      /[ăâîșțşţĂÂÎȘȚ]|Bun venit|Comenzi|Configur|Acțiuni|Adaugă|Vezi|Ofertă|pași|azi\b/,
    )
  })

  it('HL3: în engleză, starea necunoscută a unui pas e și ea tradusă', async () => {
    renderHome('en', { productCount: null })
    expect(
      await screen.findByRole('button', { name: 'Add products (status unknown)' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText('Active products').nextElementSibling).toHaveTextContent('…'),
    )
  })

  it('HL4: oferta în germană, cu numele planului netradus', () => {
    inLang('de', <PlanUpsellCard target="payments" onSeePlan={vi.fn()} />)
    const card = screen.getByRole('region', { name: 'Angebot: Bezahlen am Tisch' })
    expect(within(card).getByRole('heading')).toHaveTextContent('Bezahlen am Tisch')
    expect(card).toHaveTextContent(`Im Tarif ${PLAN_LABELS.pro}.`)
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Gäste bezahlen mit dem Smartphone',
      'Der Fiskalbeleg wird automatisch ausgestellt',
      'Einnahmen und MwSt. erscheinen automatisch in den Berichten',
    ])
    expect(within(card).getByRole('button', { name: 'Tarif ansehen' })).toBeInTheDocument()
  })

  it('HL5: abonamentul în germană; un refuz românesc al serverului nu ajunge pe ecran', async () => {
    openBillingPortal.mockRejectedValueOnce(
      Object.assign(new Error('Portalul de facturare nu e disponibil momentan.'), {
        code: 'portal_unavailable',
      }),
    )
    const user = userEvent.setup()
    const { container } = inLang(
      'de',
      <SubscriptionCard planName="Meniu Digital" onSeePlans={vi.fn()} />,
    )
    expect(screen.getByText('Abonnement & Abrechnung')).toBeInTheDocument()
    expect(container).toHaveTextContent('Ihr Tarif: Meniu Digital. Aktualisieren Sie Ihre Karte')
    await user.click(screen.getByRole('button', { name: 'Abonnement verwalten' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das Abrechnungsportal konnte nicht geöffnet werden. Versuchen Sie es in einigen Augenblicken erneut.',
    )
    expect(container.textContent ?? '').not.toMatch(/Portalul de facturare/)
  })

  it('HL6: banda „planul nu s-a încărcat” în franceză', async () => {
    const onRetry = vi.fn()
    inLang('fr', <PlanUnknownBanner onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Nous n’avons pas pu charger la formule du restaurant/,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('HL7: agentul în engleză, pe o cerere de acces', () => {
    agentState.agent = {
      has_agent: true,
      attribution_id: 'att-1',
      agent_name: null,
      contact_shared: false,
      phone: null,
      email: null,
      access_state: 'requested',
      can_manage: true,
    }
    const { container } = inLang('en', <AgentCard restaurantId="r1" />)
    expect(screen.getByText('Your Menuvia agent')).toBeInTheDocument()
    expect(screen.getByText('Sales agent')).toBeInTheDocument()
    expect(screen.getByTestId('agent-access-badge')).toHaveTextContent(
      'The agent has requested access',
    )
    expect(screen.getByText(/ONLY the menu/)).toHaveTextContent(/do NOT see orders/)
    expect(screen.getByRole('button', { name: 'Give the agent access' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline request' })).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/[ăâîșțĂÂÎȘȚ]|Agentul|Acces\b/)
  })
})
