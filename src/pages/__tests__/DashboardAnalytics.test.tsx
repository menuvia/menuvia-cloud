// Contextul de analytics al panoului și evenimentul de tab (PostHog, PR #385,
// recenziile CodeRabbit CR-m15 / CR-m16). Harness-ul e cel din
// DashboardSidebar.test.tsx, cu două diferențe: localul activ se poate COMUTA
// (`ctx.activeId`), iar `useFeatures` imită întârzierea hook-ului real — după
// comutare, PRIMA randare încă întoarce planul localului vechi (hook-ul real își
// resetează starea abia în efect).
//
//   DA1  comutarea pe un local de alt plan: contextul publicat nu poartă NICIODATĂ
//        planul localului vechi lângă noul `restaurant_id`; ultimul e planul
//        localului nou. Control pozitiv: înainte de comutare, Planul 3 pe rest-1.
//        Mutația care pică: `analyticsTier = planKnown ? tier : null` (fără
//        legarea rezultatului de restaurantul pentru care a fost citit).
//   DA2  `?tab=tva` cât planul NU e cunoscut (spinner, conținut nemontat) → niciun
//        eveniment de tab; după ce planul devine cunoscut și TVA chiar se
//        afișează → exact unul. Mutații care pică: evenimentul pe `[tab]` fără
//        condiția de randare (unul la montare, cu tab-ul nevăzut) și condiția
//        pusă în efect, dar NU în dependențe (zero după ce TVA apare).
//   DA3  `?tab=tva` NEPERMIS pe Planul 1 → doar Acasă se numără (corecția vine
//        după commit). Mutația care pică: aceeași cu DA2 (TVA numărat, deși
//        nerandat).
//   DA4  control pozitiv: Planul 3, `?tab=tva` → un eveniment pentru TVA, iar o
//        schimbare de tab îl adaugă pe al doilea.
import { cloneElement, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { RestaurantFeatures } from '../../lib/features'

const { feat, ctx, spies } = vi.hoisted(() => ({
  // Planul fiecărui local, citit de `useFeatures` (null = încă necunoscut).
  feat: { byRid: {} as Record<string, RestaurantFeatures | null> },
  ctx: {
    activeId: 'rest-1',
    memberships: ['rest-1', 'rest-2'].map((id) => ({
      restaurant_id: id,
      role: 'owner',
      restaurant: { id, name: `Local ${id}`, slug: id },
    })),
  },
  spies: {
    setAnalyticsContext: [] as unknown[],
    track: [] as unknown[][],
  },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../contexts/RestaurantContext', () => ({
  useRestaurantCtx: () => ({
    activeId: ctx.activeId,
    activeRole: 'owner',
    setActive: vi.fn(),
    founderViewId: null,
    // Referință STABILĂ (ca în DashboardSidebar): un tablou nou la fiecare
    // apel ar re-declanșa efectele care depind de membership-uri.
    memberships: ctx.memberships,
    reloadMemberships: async () => [],
  }),
}))
// Ca hook-ul real (hooks/useFeatures.ts): rezultatul aparține restaurantului
// pentru care a rulat ULTIMUL efect, deci la comutare prima randare e încă a
// localului vechi. Obiectele vin din `feat.byRid` (identitate stabilă).
vi.mock('../../hooks/useFeatures', async () => {
  const { useEffect, useState } = await import('react')
  function useFeaturesStub(rid: string | null) {
    const [boundRid, setBoundRid] = useState(rid)
    useEffect(() => {
      setBoundRid(rid)
    }, [rid])
    const features = boundRid ? (feat.byRid[boundRid] ?? null) : null
    return {
      features,
      loading: features == null,
      loadError: false,
      has: (n: string) => features?.features[n]?.enabled ?? false,
      limit: () => null,
      within: () => true,
      reload: async () => {},
    }
  }
  return { useFeatures: useFeaturesStub }
})
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
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'limit', 'in', 'not']) {
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
vi.mock('../../lib/domain', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/domain')),
  browserSite: () => 'ro',
}))
// Doar cele trei puncte de contact ale panoului sunt observate; restul
// modulului rămâne real (alte componente din arbore îl pot importa).
vi.mock('../../lib/analytics', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/analytics')),
  setAnalyticsContext: (c: unknown) => {
    spies.setAnalyticsContext.push(c)
  },
  track: (...args: unknown[]) => {
    spies.track.push(args)
  },
  markAnalyticsInternalUser: () => {},
}))
vi.mock('../../lib/founder', () => ({
  exitFounderView: vi.fn(),
  clearFounderView: vi.fn(),
  getFounderViewOrigin: () => null,
}))
vi.mock('../../lib/pendingCountry', () => ({
  retryPendingCountry: async () => 'noop',
  retryPendingRegional: async () => 'noop',
  storePendingRegional: () => {},
  clearPendingRegional: () => {},
}))
vi.mock('../../components/HelpButton', () => ({ HelpButton: () => null }))
vi.mock('../../components/SignOutButton', () => ({ SignOutButton: () => null }))
vi.mock('../../components/AiChatbot', () => ({ default: () => null }))
vi.mock('../../components/_dashboard/HomeTab', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-acasa') }
})
vi.mock('../../components/VatReportTab', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-tva') }
})
vi.mock('../../components/ReportsTab', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-vanzari') }
})
vi.mock('../../components/SettingsTab', () => ({ default: () => null }))
vi.mock('../../components/TeamManager', () => ({ default: () => null }))
vi.mock('../../components/WaiterAssignments', () => ({ default: () => null }))
vi.mock('../../components/BridgeTab', () => ({ default: () => null }))
vi.mock('../../components/AiSettingsTab', () => ({ default: () => null }))
vi.mock('../../components/AnalyticsTab', () => ({ default: () => null }))
vi.mock('../../components/InvoicesTab', () => ({ default: () => null }))
vi.mock('../../components/CashRegisterTab', () => ({ default: () => null }))
vi.mock('../../components/ReservationsTab', () => ({ default: () => null }))
vi.mock('../../components/ProductsTab', () => ({ default: () => null }))
vi.mock('../../components/CategoriesTab', () => ({ default: () => null }))
vi.mock('../../components/ModifiersTab', () => ({ default: () => null }))
vi.mock('../../components/TranslationsTab', () => ({ default: () => null }))
vi.mock('../../components/HappyHourTab', () => ({ default: () => null }))
vi.mock('../../components/StocksTab', () => ({ default: () => null }))
vi.mock('../../components/TablesManager', () => ({ default: () => null }))
vi.mock('../../components/LocationsTab', () => ({ default: () => null }))
vi.mock('../../components/FloorPlanEditor', () => ({ default: () => null }))

import DashboardPage from '../DashboardPage'
import { featuresFor } from '../../lib/__tests__/planSurfaceFixtures'

function makeRestaurant(id: string): Restaurant {
  return {
    id,
    owner_id: 'owner-1',
    name: `Bistro ${id}`,
    tagline: null,
    city: 'Sibiu',
    slug: id,
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
    language: 'ro',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  }
}

const urls = {
  navigate: vi.fn((path: string) => window.history.pushState({}, '', path)),
  replaceUrl: vi.fn((path: string) => window.history.replaceState({}, '', path)),
}

function renderDashboard(url = '/dashboard') {
  window.history.replaceState({}, '', url)
  const ui = (
    <DashboardPage
      onViewMenu={vi.fn()}
      onViewWaiter={vi.fn()}
      onViewKitchen={vi.fn()}
      onPricing={vi.fn()}
      onSignOut={vi.fn(async () => {})}
      restaurants={[makeRestaurant('rest-1'), makeRestaurant('rest-2')]}
      restaurantsLoading={false}
      updateRestaurant={
        vi.fn(async () => ({ error: null })) as unknown as ComponentProps<
          typeof DashboardPage
        >['updateRestaurant']
      }
      refetchRestaurants={async () => [makeRestaurant('rest-1'), makeRestaurant('rest-2')]}
      patchRestaurantLocal={vi.fn()}
      navigate={urls.navigate}
      replaceUrl={urls.replaceUrl}
    />
  )
  return { ...render(ui), ui }
}

const TVA_VIEWED = ['dashboard_tab_viewed', { tab: 'tva' }]

/** Ultimul context publicat (lib-ul TS e ES2020, fără `Array.prototype.at`). */
function lastContext(): unknown {
  return spies.setAnalyticsContext[spies.setAnalyticsContext.length - 1]
}

/** Doar evenimentele de tab (alte evenimente din arbore nu contează aici). */
function tabEvents(): unknown[][] {
  return spies.track.filter((c) => c[0] === 'dashboard_tab_viewed')
}

beforeEach(() => {
  feat.byRid = {}
  ctx.activeId = 'rest-1'
  spies.setAnalyticsContext.length = 0
  spies.track.length = 0
  urls.navigate.mockClear()
  urls.replaceUrl.mockClear()
  // jsdom nu implementează Element.scrollTo / scrollIntoView (vezi DashboardSidebar).
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView']
})

describe('DashboardPage — contextul de analytics urmează restaurantul planului', () => {
  it('DA1: la comutare, planul localului vechi nu se publică lângă noul local', async () => {
    feat.byRid['rest-1'] = featuresFor('pro')
    feat.byRid['rest-2'] = featuresFor('starter')
    const view = renderDashboard()
    expect(await screen.findByText('stub-acasa')).toBeInTheDocument()
    // Control pozitiv: localul de pornire, cu planul lui (Planul 3).
    expect(lastContext()).toEqual({
      restaurant_id: 'rest-1',
      plan_tier: 3,
      staff_role: 'owner',
    })

    spies.setAnalyticsContext.length = 0
    ctx.activeId = 'rest-2'
    // Element NOU: cu aceeași referință React sare peste re-randare (bailout).
    view.rerender(cloneElement(view.ui))
    await waitFor(() =>
      expect(lastContext()).toEqual({
        restaurant_id: 'rest-2',
        plan_tier: 1,
        staff_role: 'owner',
      }),
    )
    // Anti-vacuitate: comutarea chiar a publicat context nou (cel puțin cel final).
    expect(spies.setAnalyticsContext.length).toBeGreaterThan(0)
    const leaked = spies.setAnalyticsContext.filter(
      (c) =>
        c != null &&
        (c as { restaurant_id: string }).restaurant_id === 'rest-2' &&
        (c as { plan_tier: number | null }).plan_tier === 3,
    )
    expect(leaked).toEqual([])
  })
})

describe('DashboardPage — evenimentul de tab doar pentru tab-ul randat', () => {
  it('DA2: tab cerut cât planul se încarcă → zero; după ce se afișează → exact unul', async () => {
    feat.byRid['rest-1'] = null
    const view = renderDashboard('/dashboard?tab=tva')
    expect(await screen.findByText('Se încarcă...')).toBeInTheDocument()
    expect(screen.queryByText('stub-tva')).toBeNull()
    expect(tabEvents()).toEqual([])

    feat.byRid['rest-1'] = featuresFor('pro')
    view.rerender(cloneElement(view.ui))
    expect(await screen.findByText('stub-tva')).toBeInTheDocument()
    await waitFor(() => expect(tabEvents()).toEqual([TVA_VIEWED]))
  })

  it('DA3: tab nepermis pe Planul 1 → se numără doar Acasă', async () => {
    feat.byRid['rest-1'] = featuresFor('starter')
    renderDashboard('/dashboard?tab=tva')
    expect(await screen.findByText('stub-acasa')).toBeInTheDocument()
    await waitFor(() => expect(urls.replaceUrl).toHaveBeenCalledWith('/dashboard'))
    expect(screen.queryByText('stub-tva')).toBeNull()
    expect(tabEvents()).toEqual([['dashboard_tab_viewed', { tab: 'home' }]])
  })

  it('DA4: control — Planul 3: TVA se numără, iar o schimbare de tab adaugă al doilea', async () => {
    feat.byRid['rest-1'] = featuresFor('pro')
    renderDashboard('/dashboard?tab=tva')
    expect(await screen.findByText('stub-tva')).toBeInTheDocument()
    await waitFor(() => expect(tabEvents()).toEqual([TVA_VIEWED]))

    const reports = within(screen.getByRole('navigation')).getByRole('button', { name: /Rapoarte/ })
    await userEvent.setup().click(reports)
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
    await waitFor(() =>
      expect(tabEvents()).toEqual([TVA_VIEWED, ['dashboard_tab_viewed', { tab: 'raport' }]]),
    )
  })
})
