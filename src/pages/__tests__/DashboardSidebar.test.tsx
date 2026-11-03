// Bara laterală a panoului pe planul restaurantului (lotul P, nov 2026).
// Decizia fondatorului: un plan inferior nu vede nimic din cele superioare, cu
// UN SINGUR upsell, pe Acasă. Ce vede planul vine din `planSurface`
// (DashboardPage), construit aici din matricea reală (planSurfaceFixtures).
//
//   DS1  Planul 1 (proprietar): fără „Vezi ca ospătar" (nici butonul din bara
//        laterală, nici cel din bara mobilă), fără banda „Vezi planurile" a
//        planului gratuit (scoasă — upsell-ul e unul, pe Acasă), fără grupurile
//        Comenzi/Rapoarte și fără niciun termen fiscal în bara laterală.
//        Mutația care pică: `surface?.staff === true` scos de pe buton, sau
//        FreePlanBanner readus.
//   DS2  Planul 2: „Vezi ca ospătar" DA; în Rapoarte fila casei se numește
//        „Imprimantă bucătărie" (nu „Casă & tichete"), fără TVA / Încasări /
//        Facturi. Mutația care pică: `labelWithoutFiscal` ignorat.
//   DS3  control pozitiv pe Planul 3: „Casă & tichete", „TVA", „Încasări" și
//        „Facturi" apar, ca înainte.
//   DS4  plan necunoscut (features neîncărcate): fără „Vezi ca ospătar".
//   DS5  ținta upsell-ului dată Acasei: Planul 1 → 'ordering', Planul 2 →
//        'payments', Planul 3 → null, planul necunoscut → null.
//        Mutația care pică: `upsell` calculat fără `planUpsellTarget`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { RestaurantFeatures } from '../../lib/features'

const { state, homeProps } = vi.hoisted(() => ({
  state: { features: null as RestaurantFeatures | null },
  homeProps: { upsell: undefined as unknown },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../contexts/RestaurantContext', () => ({
  useRestaurantCtx: () => ({
    activeId: 'rest-1',
    activeRole: 'owner',
    setActive: vi.fn(),
    founderViewId: null,
  }),
}))
vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({
    features: state.features,
    loading: false,
    loadError: false,
    has: (n: string) => state.features?.features[n]?.enabled ?? false,
    limit: () => null,
    within: () => true,
    reload: vi.fn(async () => {}),
  }),
}))
vi.mock('../../hooks/useRestaurantModules', () => ({
  useRestaurantModules: () => ({
    modules: {},
    loading: false,
    loadError: false,
    isEnabled: () => false,
    setModule: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  }),
}))
vi.mock('../../hooks/usePlanLimits', () => ({
  usePlanLimits: () => ({
    limits: { plan: 'starter', max_products: 300, max_restaurants: 1, max_tables: 120 },
    loading: false,
    canAddProduct: () => true,
  }),
}))
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../../lib/supabase', () => {
  function chain() {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'limit', 'in']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (
      onFulfilled: (v: { data: unknown[]; count: number; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], count: 0, error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: vi.fn(() => chain()), rpc: vi.fn() } }
})
vi.mock('../../lib/ai', () => ({ isPlatformAdmin: async () => false }))
vi.mock('../../lib/founder', () => ({
  exitFounderView: vi.fn(),
  clearFounderView: vi.fn(),
  getFounderViewOrigin: () => null,
}))
vi.mock('../../lib/pendingCountry', () => ({ retryPendingCountry: async () => 'noop' }))
vi.mock('../../components/HelpButton', () => ({ HelpButton: () => null }))
vi.mock('../../components/SignOutButton', () => ({ SignOutButton: () => null }))
vi.mock('../../components/AiChatbot', () => ({ default: () => null }))
vi.mock('../../components/ReportsTab', () => ({ default: () => null }))
vi.mock('../../components/_dashboard/HomeTab', async () => {
  const { createElement } = await import('react')
  return {
    default: (p: { upsell: unknown }) => {
      homeProps.upsell = p.upsell
      return createElement('div', null, 'stub-acasa')
    },
  }
})

import DashboardPage from '../DashboardPage'
import { featuresFor } from '../../lib/__tests__/planSurfaceFixtures'
import type { DbPlan } from '../../lib/__tests__/planFeatureMatrix.fixture'

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

const FISCAL = /\bTVA\b|bon(ul|uri)? fiscal|cas[aă] de marcat|Bridge fiscal|Încasări|Facturi/i

async function renderDashboard(plan: DbPlan | null) {
  state.features = plan == null ? null : featuresFor(plan)
  const view = render(
    <DashboardPage
      onViewMenu={vi.fn()}
      onViewWaiter={vi.fn()}
      onViewKitchen={vi.fn()}
      onPricing={vi.fn()}
      onSignOut={vi.fn(async () => {})}
      restaurants={[makeRestaurant()]}
      restaurantsLoading={false}
      updateRestaurant={vi.fn(async () => ({ error: null }))}
    />,
  )
  // Ancora: Acasă s-a montat (lazy), deci bara laterală e cea finală.
  expect(await screen.findByText('stub-acasa')).toBeInTheDocument()
  return view
}

const nav = () => screen.getByRole('navigation')

beforeEach(() => {
  homeProps.upsell = undefined
})

describe('DashboardPage — bara laterală pe planul restaurantului', () => {
  it('DS1: Planul 1 — fără ospătar, fără banda de upsell, fără Comenzi/Rapoarte, nimic fiscal', async () => {
    const { container } = await renderDashboard('starter')
    expect(screen.queryByRole('button', { name: /Vezi ca ospătar/ })).toBeNull()
    expect(container.querySelector('[title="Vezi ca ospătar"]')).toBeNull()
    expect(screen.queryByText(/Vezi planurile/)).toBeNull()
    expect(within(nav()).queryByRole('button', { name: /Comenzi/ })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: /Rapoarte/ })).toBeNull()
    expect(nav().textContent ?? '').not.toMatch(FISCAL)
    // Control: grupurile planului sunt acolo.
    expect(within(nav()).getByRole('button', { name: /Meniu/ })).toBeInTheDocument()
  })

  it('DS2: Planul 2 — ospătar da; fila casei e „Imprimantă bucătărie", fără TVA/Încasări/Facturi', async () => {
    await renderDashboard('growth')
    expect(screen.getByRole('button', { name: /Vezi ca ospătar/ })).toBeInTheDocument()
    await userEvent.setup().click(within(nav()).getByRole('button', { name: /Rapoarte/ }))
    expect(await screen.findByRole('button', { name: 'Imprimantă bucătărie' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Casă & tichete' })).toBeNull()
    for (const name of ['TVA', 'Încasări', 'Facturi']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('DS3: control pozitiv — pe Planul 3 casa, TVA, Încasări și Facturi apar', async () => {
    await renderDashboard('pro')
    expect(screen.getByRole('button', { name: /Vezi ca ospătar/ })).toBeInTheDocument()
    await userEvent.setup().click(within(nav()).getByRole('button', { name: /Rapoarte/ }))
    expect(await screen.findByRole('button', { name: 'Casă & tichete' })).toBeInTheDocument()
    for (const name of ['TVA', 'Încasări', 'Facturi']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Imprimantă bucătărie' })).toBeNull()
  })

  it('DS4: plan necunoscut — fără „Vezi ca ospătar"', async () => {
    const { container } = await renderDashboard(null)
    expect(screen.queryByRole('button', { name: /Vezi ca ospătar/ })).toBeNull()
    expect(container.querySelector('[title="Vezi ca ospătar"]')).toBeNull()
  })

  it('DS5: ținta upsell-ului trimisă Acasei urmează planul', async () => {
    const cases: [DbPlan | null, unknown][] = [
      ['starter', 'ordering'],
      ['growth', 'payments'],
      ['pro', null],
      [null, null],
    ]
    for (const [plan, want] of cases) {
      const { unmount } = await renderDashboard(plan)
      expect(homeProps.upsell, String(plan)).toBe(want)
      unmount()
    }
  })
})
