// Setări → Comenzi & plăți: comutatorul „Comenzi pentru ridicare" pe planul
// restaurantului. Pe Planul 1 (fără `pickup_orders`) comutatorul pornea
// ridicarea pentru oaspeți, iar serverul (`enforce_ordering_enabled`, mig 083)
// le respingea apoi FIECARE comandă. Ce păzesc:
//   PS1  plan fără ridicare + oprită: comutatorul e blocat și spune de ce
//        (pică pe codul vechi: comutatorul era activ — mutația „scoate
//        `disabled`/`canSetPickupEnabled`").
//   PS2  control pozitiv: pe Meniu + Comenzi pornește normal și arată opțiunile.
//   PS3  plan fără ridicare dar PORNITĂ (downgrade): se poate opri, cu
//        avertisment; odată oprită, nu se mai poate reporni.
//   PS4  plan NECUNOSCUT (features în încărcare / RPC picat — DashboardPage
//        trimite atunci 'free'): comutatorul e blocat, fără „comenzile sunt
//        respinse" (mutația: `pickupToggleState(plan, …)` fără `planKnown` →
//        un local pe Meniu + Comenzi vede alarma falsă și își oprește ridicarea).
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

describe('SettingsTab — ridicarea pe planul restaurantului', () => {
  it('PS1: pe un plan fără ridicare comutatorul e blocat și spune de ce', async () => {
    const user = await openOrders('starter', makeRestaurant())
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeDisabled()
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/Disponibil de la planul Meniu \+ Comenzi/)).toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('switch', { name: /doar ridicare/ })).not.toBeInTheDocument()
  })

  it('PS2: pe Meniu + Comenzi ridicarea pornește și arată opțiunile', async () => {
    const user = await openOrders('growth', makeRestaurant())
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeEnabled()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /doar ridicare/ })).toBeInTheDocument()
  })

  it('PS3: pornită pe un plan fără ridicare — se poate doar opri, cu avertisment', async () => {
    const user = await openOrders('free', makeRestaurant({ pickup_settings: PICKUP_ON }))
    const sw = screen.getByRole('switch', { name: SWITCH })
    expect(sw).toBeEnabled()
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/comenzile lor sunt respinse/)).toBeInTheDocument()

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
    expect(screen.queryByText(/comenzile lor sunt respinse/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Disponibil de la planul/)).not.toBeInTheDocument()
    expect(screen.getByText(/Nu am putut verifica planul restaurantului/)).toBeInTheDocument()

    await user.click(sw)
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
  })
})
