// Setări pe planul restaurantului (lotul P, nov 2026). Decizia fondatorului:
// „ce treabă avem cu date de fiscalizare pe al doilea plan, nu mai zic de
// primul" — un plan inferior nu vede nimic din cele superioare, nici blocat.
// Ce vede planul vine din `planSurface` (aici construit din matricea reală,
// planSurfaceFixtures). Fiecare test trece prin TOATE secțiunile.
//
//   ST1  Planul 1: secțiunea se numește „Meniu QR"; fără ridicare, sugestii la
//        coș, cote TVA, plăți online, fidelizare și fără rândul badge-ului
//        „Creat cu Menuvia" (fost chip cu lacăt „Plan Meniu + Comenzi"); niciun
//        termen fiscal (TVA / bon fiscal / casă de marcat / Bridge fiscal) în
//        nicio secțiune. Mutația care pică: oricare gate `surface?.… === true`
//        scos (cardul revine), sau textul Google Reviews / Moneda nefiltrat.
//   ST1b SMS pe Planul 1 urmează FEATURE-UL, nu comenzile: starter are
//        `sms_notifications` (cardul apare — un modul pornit se poate opri),
//        free nu (cardul lipsește, nici blocat). Mutația care pică: cardul
//        montat pe `surface?.ordering` (starterul pierde cardul) sau
//        necondiționat (free îl primește).
//   ST2  Planul 2: „Comenzi"; ridicare, sugestii, fidelizare, SMS și badge-ul
//        DA; cote TVA și plăți online NU; niciun termen fiscal.
//        Mutația care pică: `vat` derivat din `ordering`.
//   ST3  control pozitiv pe Planul 3: „Comenzi & plăți", cotele TVA, plățile
//        online și textele cu plată/fiscalizare apar — nimic nu se ascunde.
//   ST4  plan NECUNOSCUT (`surface` null): nimic dependent de plan (nici
//        ridicare, nici cote, nici cardurile de module cu plan).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { useRestaurantModules } from '../../hooks/useRestaurantModules'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/restaurants', () => ({ changeRestaurantSlug: vi.fn() }))
// Cardurile cu fetch propriu: stub-uri cu un text recognoscibil, ca prezența
// lor să fie vizibilă fără rețea.
vi.mock('../VatRatesEditor', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-editor-cote') }
})
vi.mock('../OnlinePaymentsCard', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-plati-online') }
})
vi.mock('../LoyaltySettingsCard', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-fidelizare') }
})
vi.mock('../SmsNotificationsCard', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-sms') }
})
vi.mock('../MfaCard', () => ({ default: () => null }))
vi.mock('../GdprCard', () => ({ default: () => null }))
vi.mock('../menu/MenuPreview', () => ({ default: () => null }))
vi.mock('../_dashboard/AgentCard', () => ({ AgentCard: () => null }))

import SettingsTab from '../SettingsTab'
import { surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'
import type { PlanSurface } from '../../lib/planSurface'

function makeRestaurant(): Restaurant {
  return {
    id: 'rest-1',
    owner_id: 'owner-1',
    name: 'Bistro Test',
    tagline: null,
    city: 'Sibiu',
    slug: 'bistro-test',
    description: null,
    address: null,
    phone: null,
    hours: null,
    primary_color: '#C8963C',
    logo_url: null,
    cover_url: null,
    is_active: true,
    floor_layout: null,
    socials: null,
    amenities: [],
    hours_structured: null,
    wifi_password: null,
    timezone: 'Europe/Bucharest',
    checkout_suggestion_settings: null,
    theme_settings: null,
    pickup_settings: null,
    google_place_id: null,
    google_review_url: null,
    menu_languages: [],
    currency: 'RON',
    country: 'RO',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  }
}

const modulesState = {
  modules: {},
  loading: false,
  loadError: false,
  isEnabled: () => false,
  setModule: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
} as unknown as ReturnType<typeof useRestaurantModules>

const FISCAL = /\bTVA\b|bon(ul|uri)? fiscal|cas[aă] de marcat|Bridge fiscal|fiscaliz/i
const SECTIONS = [/Restaurant/, /Meniu & aspect/, /Comenzi|Meniu QR/, /Cont/]

/** Randează Setările, trece prin toate secțiunile și întoarce textul fiecăreia. */
async function renderAll(plan: string, surface: PlanSurface | null): Promise<string[]> {
  const user = userEvent.setup()
  const { container } = render(
    <SettingsTab
      restaurant={makeRestaurant()}
      onUpdate={vi.fn(async () => ({ error: null }))}
      plan={plan}
      onSignOut={() => {}}
      modulesState={modulesState}
      surface={surface}
    />,
  )
  const texts: string[] = []
  for (const name of SECTIONS) {
    await user.click(screen.getByRole('tab', { name }))
    expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
    texts.push(container.textContent ?? '')
  }
  return texts
}

async function openOrders(): Promise<void> {
  await userEvent.setup().click(screen.getByRole('tab', { name: /Comenzi|Meniu QR/ }))
}

describe('SettingsTab — fiecare plan vede doar ce are', () => {
  it('ST1: Planul 1 — „Meniu QR", fără nimic din planurile superioare', async () => {
    const texts = await renderAll('starter', surfaceFor('starter'))
    for (const t of texts) expect(t).not.toMatch(FISCAL)
    const all = texts.join('\n')
    expect(screen.getByRole('tab', { name: 'Meniu QR' })).toBeInTheDocument()
    expect(all).not.toMatch(/Creat cu Menuvia/)
    expect(all).not.toMatch(/Plan Meniu \+ Comenzi/)
    expect(all).not.toMatch(/stub-plati-online|stub-fidelizare|stub-editor-cote/)
    expect(all).not.toMatch(/Sugestii la coș/)
    expect(all).not.toMatch(/ridicare/i)
    // Ancora: secțiunea „Meniu QR" are modulele (rezervările sunt pe orice plan).
    await openOrders()
    expect(screen.getByRole('switch', { name: 'Rezervări' })).toBeInTheDocument()
  })

  it('ST1b: SMS pe Planul 1 urmează feature-ul — starter da, free nu', async () => {
    const { unmount } = render(
      <SettingsTab
        restaurant={makeRestaurant()}
        onUpdate={vi.fn(async () => ({ error: null }))}
        plan="starter"
        onSignOut={() => {}}
        modulesState={modulesState}
        surface={surfaceFor('starter')}
      />,
    )
    await openOrders()
    expect(screen.getByText('stub-sms')).toBeInTheDocument()
    unmount()
    const texts = await renderAll('free', surfaceFor('free'))
    expect(texts.join('\n')).not.toMatch(/stub-sms/)
    for (const t of texts) expect(t).not.toMatch(FISCAL)
  })

  it('ST2: Planul 2 — „Comenzi" cu ridicare, sugestii și module; fără TVA și plăți', async () => {
    const texts = await renderAll('growth', surfaceFor('growth'))
    for (const t of texts) expect(t).not.toMatch(FISCAL)
    expect(screen.getByRole('tab', { name: 'Comenzi' })).toBeInTheDocument()
    const all = texts.join('\n')
    expect(all).toMatch(/Creat cu Menuvia/)
    expect(all).not.toMatch(/stub-plati-online|stub-editor-cote/)
    await openOrders()
    expect(screen.getByRole('switch', { name: 'Comenzi pentru ridicare' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Sugestii la coș' })).toBeInTheDocument()
    expect(screen.getByText('stub-fidelizare')).toBeInTheDocument()
    expect(screen.getByText('stub-sms')).toBeInTheDocument()
  })

  it('ST3: control pozitiv — pe Planul 3 totul rămâne, inclusiv cotele TVA și plățile', async () => {
    const texts = await renderAll('pro', surfaceFor('pro'))
    expect(screen.getByRole('tab', { name: 'Comenzi & plăți' })).toBeInTheDocument()
    expect(texts.join('\n')).toMatch(FISCAL)
    await openOrders()
    expect(screen.getByText('Cote TVA')).toBeInTheDocument()
    expect(screen.getByText('stub-editor-cote')).toBeInTheDocument()
    expect(screen.getByText('stub-plati-online')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Comenzi pentru ridicare' })).toBeInTheDocument()
  })

  it('ST4: plan necunoscut — nimic dependent de plan', async () => {
    const texts = await renderAll('free', null)
    const all = texts.join('\n')
    expect(all).not.toMatch(FISCAL)
    expect(all).not.toMatch(/stub-plati-online|stub-fidelizare|stub-sms|stub-editor-cote/)
    expect(all).not.toMatch(/Creat cu Menuvia/)
    await openOrders()
    expect(screen.queryByRole('switch', { name: 'Comenzi pentru ridicare' })).toBeNull()
  })
})
