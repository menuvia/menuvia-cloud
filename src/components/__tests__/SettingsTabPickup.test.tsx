// Setări → Comenzi & plăți: comutatorul „Comenzi pentru ridicare" pe planul
// restaurantului. Pe Planul 1 (fără `pickup_orders`) comutatorul pornea
// ridicarea pentru oaspeți, iar serverul (`enforce_ordering_enabled`, mig 083)
// le respingea apoi FIECARE comandă. Din mig 309 pagina publică nici nu mai
// arată ridicarea fără `pickup_orders`, deci textele cardului (lib/pickupCopy)
// spun asta, derivate din ACEEAȘI stare a comutatorului. Ce păzesc:
//   PS1  plan fără ridicare + oprită: comutatorul e blocat și spune de ce, iar
//        descrierea nu promite comenzi (pică pe codul vechi: comutatorul era
//        activ — mutația „scoate `disabled`/`canSetPickupEnabled`"; și pe
//        descrierea care promitea pe orice plan).
//   PS2  control pozitiv: pe Meniu + Comenzi pornește normal, arată opțiunile
//        și promite comenzile.
//   PS3  plan fără ridicare dar PORNITĂ (downgrade): se poate opri, cu UN
//        SINGUR avertisment, adevărat după 309 (oaspeții nu văd ridicarea,
//        setarea rămâne) — nu „văd formularul, dar comenzile sunt respinse";
//        odată oprită, nu se mai poate reporni.
//   PS4  plan NECUNOSCUT (features în încărcare / RPC picat — DashboardPage
//        trimite atunci 'free'): comutatorul e blocat, fără avertismentul de
//        plan (mutația: `pickupToggleState(plan, …)` fără `planKnown` → un
//        local pe Meniu + Comenzi vede alarma falsă și își oprește ridicarea).
//   PS5  Meniu & aspect, stilul flipbook: nota „comanda din meniu nu e
//        disponibilă pe acest stil” sugerează că pe celelalte stiluri se poate
//        comanda, deci apare DOAR pe un plan cu comenzi — nu pe ridicarea
//        pornită a unui plan fără ea (din 309 pagina publică n-o arată) și nu pe
//        planul necunoscut. Mutația care pică: condiția veche
//        `planTier(plan) >= 2 || pickup_settings.enabled`. Control pozitiv pe
//        Meniu + Comenzi.
//
// Reziduurile lui #324 (R1, R2):
//   PZ1  Meniu + Comenzi, ridicarea pornită, stilul EFECTIV Flipbook (cu
//        pagini): descrierea cardului de ridicare NU promite comenzi și spune
//        de ce + ce face owner-ul. Mutația care pică: descrierea fără stil
//        (`pickupCardDescription(feature)` — promitea și pe flipbook).
//   PZ2  control pozitiv + sursa UNICĂ a layout-ului efectiv: Flipbook FĂRĂ
//        pagini e listă pentru oaspete (are coș), deci promisiunea rămâne.
//        Mutația care pică: un SettingsTab care citește doar `menu_layout`.
//   PZ3  starea NESALVATĂ: owner-ul alege Flipbook în „Meniu & aspect” și
//        trece la „Comenzi & plăți” fără să salveze — descrierea se schimbă
//        deja. Mutația care pică: stilul citit din `restaurant.theme_settings`.
//   PZ4  „Doar ridicare” pe un plan CUNOSCUT fără ridicare (downgrade): modul
//        e suspendat pe panou (DashboardPage, `pickupOnlyMode`), deci descrierea
//        comutatorului NU mai spune „ascunde Harta sălii și Rezervările”, ci
//        că nu se aplică. Control pozitiv pe Meniu + Comenzi și pe planul
//        NECUNOSCUT (comportamentul stocat — fără verdict de plan).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/restaurants', () => ({ changeRestaurantSlug: vi.fn() }))
// Cardurile cu fetch propriu nu țin de comutator — stub-uri goale.
vi.mock('../VatRatesEditor', () => ({ default: () => null }))
vi.mock('../OnlinePaymentsCard', () => ({ default: () => null }))
vi.mock('../LoyaltySettingsCard', () => ({ default: () => null }))
vi.mock('../SmsNotificationsCard', () => ({ default: () => null }))
vi.mock('../MfaCard', () => ({ default: () => null }))
vi.mock('../GdprCard', () => ({ default: () => null }))
vi.mock('../menu/MenuPreview', () => ({ default: () => null }))
vi.mock('../_dashboard/AgentCard', () => ({ AgentCard: () => null }))

import SettingsTab from '../SettingsTab'

const PICKUP_ON: NonNullable<Restaurant['pickup_settings']> = {
  enabled: true,
  min_lead_time_minutes: 20,
  slot_interval_minutes: 15,
  open_hours: { start: '09:00', end: '21:00' },
  instructions: null,
  pickup_only: false,
}

function makeRestaurant(over: Partial<Restaurant> = {}): Restaurant {
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
    ...over,
  }
}

const SWITCH = 'Comenzi pentru ridicare'

async function openOrders(plan: string, restaurant: Restaurant, planKnown = true) {
  const user = userEvent.setup()
  render(
    <SettingsTab
      restaurant={restaurant}
      onUpdate={vi.fn(async () => ({ error: null }))}
      plan={plan}
      planKnown={planKnown}
      onSignOut={() => {}}
    />,
  )
  await user.click(screen.getByRole('tab', { name: /Comenzi & plăți/ }))
  return user
}

const FLIPBOOK: Restaurant['theme_settings'] = { preset_id: 'cafe', menu_layout: 'flipbook' }
const FLIPBOOK_NOTE = /comanda din meniu nu e disponibilă pe acest stil/

async function openMenuAspect(plan: string, restaurant: Restaurant, planKnown = true) {
  const user = userEvent.setup()
  render(
    <SettingsTab
      restaurant={restaurant}
      onUpdate={vi.fn(async () => ({ error: null }))}
      plan={plan}
      planKnown={planKnown}
      onSignOut={() => {}}
    />,
  )
  await user.click(screen.getByRole('tab', { name: /Meniu & aspect/ }))
  // Ancora: secțiunea flipbook e randată, deci absența notei nu vine dintr-un
  // tab greșit sau dintr-un stil nerecunoscut.
  expect(screen.getByText(/Paginile meniului \(\d+\/\d+\)/)).toBeInTheDocument()
}

describe('SettingsTab — ridicarea pe planul restaurantului', () => {
  it('PS1: pe un plan fără ridicare comutatorul e blocat și spune de ce', async () => {
    const user = await openOrders('starter', makeRestaurant())
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeDisabled()
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/Disponibil de la planul Meniu \+ Comenzi/)).toBeInTheDocument()
    expect(screen.queryByText(/clienții pot comanda/i)).not.toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('switch', { name: /doar ridicare/ })).not.toBeInTheDocument()
  })

  it('PS2: pe Meniu + Comenzi ridicarea pornește și arată opțiunile', async () => {
    const user = await openOrders('growth', makeRestaurant())
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeEnabled()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()
    expect(screen.getByText(/clienții pot comanda/i)).toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /doar ridicare/ })).toBeInTheDocument()
  })

  it('PS3: pornită pe un plan fără ridicare — se poate doar opri, cu avertisment', async () => {
    const user = await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ON }))
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeEnabled()
    expect(sw).toHaveAttribute('aria-checked', 'true')
    // UN singur avertisment (fără al doilea, paralel), cu ce e adevărat după 309.
    expect(screen.getAllByText(/Planul tău nu include comenzile pentru ridicare/)).toHaveLength(1)
    expect(screen.getByText(/nu văd ridicarea pe pagina publică/)).toBeInTheDocument()
    expect(screen.getByText(/Setarea rămâne salvată/)).toBeInTheDocument()
    expect(screen.queryByText(/văd formularul|sunt respinse/)).not.toBeInTheDocument()
    expect(screen.queryByText(/clienții pot comanda/i)).not.toBeInTheDocument()

    await user.click(sw)
    const off = screen.getByRole('switch', { name: SWITCH })
    expect(off).toHaveAttribute('aria-checked', 'false')
    // Odată oprită, nu se mai poate reporni pe acest plan.
    expect(off).toBeDisabled()
    expect(screen.getByText(/Disponibil de la planul Meniu \+ Comenzi/)).toBeInTheDocument()
  })

  it('PS4: plan necunoscut — blocat, fără verdict fals despre plan', async () => {
    const user = await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ON }), false)
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeDisabled()
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(/Planul tău nu include/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()
    // Nici promisiunea de comenzi: planul nu e cunoscut.
    expect(screen.queryByText(/clienții pot comanda/i)).not.toBeInTheDocument()
    // Textul nu pretinde un eșec: „unknown" e și starea de încărcare normală.
    expect(screen.getByText(/Se verifică planul restaurantului/)).toBeInTheDocument()
    expect(screen.queryByText(/Nu am putut/)).not.toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SettingsTab — nota flipbook despre comanda din meniu', () => {
  it('PS5a: plan fără ridicare, cu ridicarea pornită (downgrade) — fără notă', async () => {
    await openMenuAspect(
      'free',
      makeRestaurant({ pickup_settings: PICKUP_ON, theme_settings: FLIPBOOK }),
    )
    expect(screen.queryByText(FLIPBOOK_NOTE)).not.toBeInTheDocument()
  })

  it('PS5b: plan necunoscut — fără notă (nici promisiune implicită)', async () => {
    await openMenuAspect(
      'free',
      makeRestaurant({ pickup_settings: PICKUP_ON, theme_settings: FLIPBOOK }),
      false,
    )
    expect(screen.queryByText(FLIPBOOK_NOTE)).not.toBeInTheDocument()
  })

  it('PS5c: control pozitiv — pe Meniu + Comenzi nota apare', async () => {
    await openMenuAspect('growth', makeRestaurant({ theme_settings: FLIPBOOK }))
    expect(screen.getByText(FLIPBOOK_NOTE)).toBeInTheDocument()
  })
})

const PAGE = 'https://cdn.example.com/meniu-1.webp'
const PROMISE = /clienții pot comanda/i
const FLIPBOOK_WHY = /stilul Flipbook pagina publică arată meniul ca pe o carte, fără coș/
const FLIPBOOK_WAY_OUT = /alege alt stil din Setări → Meniu & aspect/

describe('SettingsTab — ridicarea pe stilul Flipbook', () => {
  it('PZ1: plan cu ridicare + Flipbook cu pagini — fără promisiune, cu motivul', async () => {
    await openOrders(
      'growth',
      makeRestaurant({
        pickup_settings: PICKUP_ON,
        theme_settings: { preset_id: 'cafe', menu_layout: 'flipbook', flipbook_pages: [PAGE] },
      }),
    )
    // Ancora: cardul de ridicare e randat, pornit, pe planul care îl include.
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(PROMISE)).not.toBeInTheDocument()
    expect(screen.getByText(FLIPBOOK_WHY)).toBeInTheDocument()
    expect(screen.getByText(FLIPBOOK_WAY_OUT)).toBeInTheDocument()
    // Nu e o notă de plan: planul include ridicarea.
    expect(screen.queryByText(/Disponibil de la planul|Planul tău nu include/)).not.toBeInTheDocument()
  })

  it('PZ2: control — Flipbook FĂRĂ pagini e listă pentru oaspete, promisiunea rămâne', async () => {
    await openOrders('growth', makeRestaurant({ pickup_settings: PICKUP_ON, theme_settings: FLIPBOOK }))
    expect(screen.getByText(PROMISE)).toBeInTheDocument()
    expect(screen.queryByText(FLIPBOOK_WHY)).not.toBeInTheDocument()
  })

  it('PZ3: stilul ales și NESALVAT schimbă deja descrierea', async () => {
    const user = await openOrders(
      'growth',
      makeRestaurant({
        pickup_settings: PICKUP_ON,
        theme_settings: { preset_id: 'cafe', menu_layout: 'list', flipbook_pages: [PAGE] },
      }),
    )
    expect(screen.getByText(PROMISE)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Meniu & aspect/ }))
    const flipbook = screen.getByRole('button', { name: /Flipbook \(PDF\/pagini\)/ })
    await user.click(flipbook)
    expect(screen.getByRole('button', { name: /Flipbook \(PDF\/pagini\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('tab', { name: /Comenzi & plăți/ }))
    expect(screen.queryByText(PROMISE)).not.toBeInTheDocument()
    expect(screen.getByText(FLIPBOOK_WHY)).toBeInTheDocument()
  })
})

const PICKUP_ONLY_ON: NonNullable<Restaurant['pickup_settings']> = { ...PICKUP_ON, pickup_only: true }
const PICKUP_ONLY_SWITCH = /doar ridicare/
const SUSPENDED = /Pe planul tău modul nu se aplică/
const NORMAL_DESC = /ascunde Harta sălii și Rezervările din dashboard/

describe('SettingsTab — modul „doar ridicare” pe planul restaurantului', () => {
  it('PZ4a: plan fără ridicare (downgrade) — descrierea spune că modul nu se aplică', async () => {
    await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ONLY_ON }))
    // Ancora: comutatorul de mod e randat și rămâne pornit (rândul nu se rescrie).
    expect(screen.getByRole('switch', { name: PICKUP_ONLY_SWITCH })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(SUSPENDED)).toBeInTheDocument()
    expect(screen.getByText(/panoul îți arată mesele și rezervările/)).toBeInTheDocument()
    expect(screen.queryByText(NORMAL_DESC)).not.toBeInTheDocument()
  })

  it('PZ4b: control — pe Meniu + Comenzi descrierea obișnuită', async () => {
    await openOrders('growth', makeRestaurant({ pickup_settings: PICKUP_ONLY_ON }))
    expect(screen.getByRole('switch', { name: PICKUP_ONLY_SWITCH })).toBeInTheDocument()
    expect(screen.getByText(NORMAL_DESC)).toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })

  it('PZ4c: plan necunoscut — comportamentul stocat, fără verdict de plan', async () => {
    await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ONLY_ON }), false)
    expect(screen.getByText(NORMAL_DESC)).toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })
})
