// Setări → Comenzi: comutatorul „Comenzi pentru ridicare" pe planul
// restaurantului.
//
// LOTUL P (nov 2026) a schimbat contractul pe planurile FĂRĂ ridicare: decizia
// fondatorului e că un plan inferior nu vede nimic din cele superioare, deci pe
// Planul 1 (și pe planul NECUNOSCUT — `planSurface` întoarce `null`, „nici
// funcția, nici upsell-ul") cardul de ridicare NU se mai arată deloc, nici
// blocat, nici cu avertisment. PS1, PS3, PS4, PZ4a și PZ4c au fost RESCRISE
// onest pe noul contract (aserțiunea veche cerea comutatorul blocat și textul
// de plan). Textele stărilor `locked`/`locked_on`/`unknown` rămân acoperite în
// lib/pickupCopy (pickupCopy.test.ts), unde trăiesc. Secțiunea se numește
// acum după plan (`sectionLabel`): „Meniu QR" fără comenzi, „Comenzi" pe
// Planul 2, „Comenzi & plăți" pe Planul 3 (din lotul R2 e eticheta sub-tab-ului, vezi mai jos). Pe Planul 1 (fără `pickup_orders`) comutatorul pornea
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
//        Descrierea NU repetă „Setarea rămâne salvată” din nota `locked_on`
//        de deasupra: UN singur loc spune asta, cu modul pornit (PZ4a) ȘI
//        oprit (PS3, unde blocul modului e ancorat ca randat — altfel
//        `getByText` unic ar fi trecut și cu blocul ascuns).
//
// Lotul R2 (nov 2026): secțiunile Setărilor sunt sub-tab-uri ale panoului
// (NAV_GROUPS), nu pastile interne — SettingsTab primește `section` ca prop.
// Testele deschid secțiunea direct; PZ3 trece de la „Aspect meniu" (fost
// „Meniu & aspect") la „Comenzi & plăți" cu `rerender` pe ACEEAȘI instanță,
// exact ca panoul, care ține formularul montat între secțiuni. Numele secțiunii
// după plan („Meniu QR" / „Comenzi") nu mai e al lui SettingsTab, ci al
// sub-tab-ului (`subTabLabel`, dashboardNav.test NV4) — aserțiunile pe numele
// pastilei din PS1/PS2 s-au mutat acolo.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SettingsSection } from '../../lib/dashboardNav'
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
vi.mock('../_dashboard/SubscriptionCard', () => ({ SubscriptionCard: () => null }))

import SettingsTab from '../SettingsTab'
import { surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'
import type { DbPlan } from '../../lib/__tests__/planFeatureMatrix.fixture'

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

function ui(section: SettingsSection, plan: DbPlan, restaurant: Restaurant, planKnown: boolean) {
  return (
    <SettingsTab
      section={section}
      restaurant={restaurant}
      onUpdate={vi.fn(async () => ({ error: null }))}
      plan={plan}
      onSignOut={() => {}}
      surface={planKnown ? surfaceFor(plan) : null}
    />
  )
}

async function openOrders(plan: DbPlan, restaurant: Restaurant, planKnown = true) {
  const user = userEvent.setup()
  const { rerender } = render(ui('orders', plan, restaurant, planKnown))
  // Ancora: e randată secțiunea „Comenzi & plăți" (formular, cu „Salvează"),
  // nu alta — absența cardului nu vine dintr-o secțiune greșită.
  expect(screen.getByRole('button', { name: 'Salvează' })).toBeInTheDocument()
  expect(screen.queryByText('Informații principale')).toBeNull()
  expect(screen.queryByText('Previzualizare')).toBeNull()
  // Trecerea între secțiuni pe ACEEAȘI instanță (ca în panou).
  const show = (section: SettingsSection) => rerender(ui(section, plan, restaurant, planKnown))
  return { user, show }
}

const FLIPBOOK: Restaurant['theme_settings'] = { preset_id: 'cafe', menu_layout: 'flipbook' }
const FLIPBOOK_NOTE = /comanda din meniu nu e disponibilă pe acest stil/

async function openMenuAspect(plan: DbPlan, restaurant: Restaurant, planKnown = true) {
  render(ui('menu', plan, restaurant, planKnown))
  // Ancora: secțiunea flipbook e randată, deci absența notei nu vine dintr-o
  // secțiune greșită sau dintr-un stil nerecunoscut.
  expect(screen.getByText(/Paginile meniului \(\d+\/\d+\)/)).toBeInTheDocument()
}

describe('SettingsTab — ridicarea pe planul restaurantului', () => {
  // PS1 (lotul P): pe Planul 1 cardul nu există — fost comutator blocat cu
  // „Disponibil de la planul Meniu + Comenzi". Mutația care pică: gate-ul
  // `surface?.pickup === true` scos de pe card în SettingsTab.
  it('PS1: pe un plan fără ridicare cardul nu apare deloc', async () => {
    await openOrders('starter', makeRestaurant())
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ridicare/i)).not.toBeInTheDocument()
  })

  it('PS2: pe Meniu + Comenzi ridicarea pornește și arată opțiunile', async () => {
    const { user } = await openOrders('growth', makeRestaurant())
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeEnabled()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()
    expect(screen.getByText(/clienții pot comanda/i)).toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /doar ridicare/ })).toBeInTheDocument()
  })

  // PS3 (lotul P): pornită pe un plan fără ridicare (downgrade) — cardul tot nu
  // apare: din mig 309 pagina publică n-o arată, deci setarea rămasă e inertă,
  // iar un avertisment de plan ar fi exact „vezi ce are planul superior".
  it('PS3: pornită pe un plan fără ridicare (downgrade) — fără card și fără avertisment', async () => {
    await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ON }))
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument()
    expect(screen.queryByText(/Planul tău nu include/)).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /doar ridicare/ })).not.toBeInTheDocument()
  })

  // PS4 (lotul P): plan NECUNOSCUT — `planSurface` e `null`, deci nici funcția
  // (fost: comutator blocat cu „Se verifică planul restaurantului").
  it('PS4: plan necunoscut — fără card, fără verdict despre plan', async () => {
    await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ON }), false)
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument()
    expect(screen.queryByText(/Planul tău nu include/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()
    expect(screen.queryByText(/clienții pot comanda/i)).not.toBeInTheDocument()
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
const FLIPBOOK_WAY_OUT = /alege alt stil din Setări → Aspect meniu/

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
    const { user, show } = await openOrders(
      'growth',
      makeRestaurant({
        pickup_settings: PICKUP_ON,
        theme_settings: { preset_id: 'cafe', menu_layout: 'list', flipbook_pages: [PAGE] },
      }),
    )
    expect(screen.getByText(PROMISE)).toBeInTheDocument()

    show('menu')
    const flipbook = screen.getByRole('button', { name: /Flipbook \(PDF\/pagini\)/ })
    await user.click(flipbook)
    expect(screen.getByRole('button', { name: /Flipbook \(PDF\/pagini\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    show('orders')
    expect(screen.queryByText(PROMISE)).not.toBeInTheDocument()
    expect(screen.getByText(FLIPBOOK_WHY)).toBeInTheDocument()
  })
})

const PICKUP_ONLY_ON: NonNullable<Restaurant['pickup_settings']> = { ...PICKUP_ON, pickup_only: true }
const PICKUP_ONLY_SWITCH = /doar ridicare/
const SUSPENDED = /Pe planul tău modul nu se aplică/
const NORMAL_DESC = /ascunde Harta sălii și Rezervările din dashboard/

describe('SettingsTab — modul „doar ridicare” pe planul restaurantului', () => {
  // PZ4a (lotul P): pe planul fără ridicare cardul lipsește cu totul, deci și
  // comutatorul modului. Suspendarea modului pe panou rămâne în DashboardPage
  // (`pickupOnlyMode`, pickupAvailability.test.ts).
  it('PZ4a: plan fără ridicare (downgrade) — fără comutatorul modului', async () => {
    await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ONLY_ON }))
    expect(screen.queryByRole('switch', { name: PICKUP_ONLY_SWITCH })).not.toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
    expect(screen.queryByText(NORMAL_DESC)).not.toBeInTheDocument()
  })

  it('PZ4b: control — pe Meniu + Comenzi descrierea obișnuită', async () => {
    await openOrders('growth', makeRestaurant({ pickup_settings: PICKUP_ONLY_ON }))
    expect(screen.getByRole('switch', { name: PICKUP_ONLY_SWITCH })).toBeInTheDocument()
    expect(screen.getByText(NORMAL_DESC)).toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })

  // PZ4c (lotul P): plan necunoscut — `planSurface` null, fără card (fost:
  // descrierea obișnuită pe comportamentul stocat).
  it('PZ4c: plan necunoscut — fără card', async () => {
    await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ONLY_ON }), false)
    expect(screen.queryByRole('switch', { name: PICKUP_ONLY_SWITCH })).not.toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })
})
