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
//   DS6  recenzia #334, `fiscalMarket` prin PAGINĂ: Planul 2 pe un restaurant din
//        afara RO, sau pe site-ul .com → Acasa NU primește oferta „Plata la masă"
//        (bonul și plata la masă există doar în RO, iar .com vinde doar
//        Planurile 1–2); Planul 1 primește tot „Meniu + Comenzi". Mutația care
//        pică: `fiscalMarket: true` fix în DashboardPage.
//
// Lotul R2 (nov 2026, reorganizarea panoului — structura în lib/dashboardNav.ts):
// fila casei a trecut din Rapoarte în Setări (eticheta pe plan rămâne), iar
// „Încasări" a devenit Comenzi → „Ture de casă". DS2/DS3 au fost rescrise ONEST
// pe noile locuri (aceleași aserțiuni de plan, alt grup). Pe Planul 1 grupul
// Comenzi are doar Rezervările și poartă numele lor (DS1).
//   DS7  `?tab=` se restaurează la montare: `/dashboard?tab=tva` pe Planul 3
//        deschide TVA, cu titlul „TVA". Mutația care pică: tab-ul inițial
//        fix pe Acasă (URL-ul ignorat).
//   DS8  `?tab=` NECUNOSCUT (inclusiv `constructor`, cheie de pe prototip) →
//        Acasă. Mutația care pică: validarea id-ului scoasă din tabFromSearch.
//   DS9  `?tab=` NEPERMIS pe plan (TVA pe Planul 1) → Acasă, cu URL-ul corectat
//        prin replace. Control pozitiv: DS7 (același parametru pe Planul 3).
//        DS9b: cât planul NU e cunoscut, tab-ul cerut NU e aruncat pe Acasă (nici
//        URL-ul atins) — un refresh pe „TVA" nu pierde locul. Mutația care pică:
//        poarta `planKnown` scoasă din efectul de corecție.
//   DS10 click pe grup / chip → `navigate('/dashboard?tab=…')` + titlul nou;
//        Back (`popstate`) readuce tab-ul din URL. Mutația care pică: tab-ul ținut
//        doar în state (fără push) sau fără ascultătorul de popstate.
//   DS11 titlul paginii = eticheta sub-tab-ului din NAV, pe fiecare chip din
//        Setări (Planul 3). Mutația care pică: titlul randat din numele
//        grupului (rândul vechi de deasupra chip-urilor).
//   DS12 `?tab=billing` (CTA-urile emailurilor de facturare) → Setări → Abonament
//        & cont, cu scroll pe `#billing-card`. Mutația care pică: aliasul scos
//        (billing ar cădea pe Acasă, unde cardul nu mai e).
//
// Recenzia adversarială pe #335:
//   DS13 Back (`popstate`) cu formularul Setărilor MODIFICAT cere confirmare;
//        la refuz rămâi pe Setări, iar URL-ul e refăcut pe secțiunea curentă;
//        la „Pleacă" ajungi unde a cerut Back-ul. Control: fără modificări,
//        Back-ul navighează direct, fără dialog. Mutația care pică: `onPop`
//        care montează direct tab-ul nou (prima variantă a lotului).
//   DS14 clicuri repetate cât confirmarea e deschisă → UN singur dialog.
//        Mutația care pică: `confirmPendingRef` scos.
//   DS9c citirea planului EȘUEAZĂ, `?tab=tva`: se afișează Acasă, dar URL-ul
//        NU se rescrie; după un „Reîncearcă" reușit (plan cunoscut) TVA revine.
//        Mutația care pică: corecția URL-ului pe `loadError` (fosta poartă
//        `navReady = planKnown || loadError` în efect).
//
// Lotul A („Toate locațiile", mig 314):
//   DS15 proprietar la un local + MANAGER la altul → grupul „Locații" apare;
//        click → titlul „Toate locațiile" și ecranul montat; „Deschide" din
//        ecran → `setActive(id)` + Acasă. Mutația care pică: `multiLocation`
//        netrimis la visibleNavGroups (grupul nu apare), sau `onOpen` fără
//        setActive.
//   DS16 un singur local de admin (al doilea e doar ca OSPĂTAR) și vizita de
//        fondator (membership sintetic) → grupul NU apare. Mutația care pică:
//        numărarea oricărei membership-uri / a celei sintetice.
//   DS17 „Adaugă o locație" (SettingsTab primește `onLocationCreated`): ambele
//        liste se recitesc ÎNAINTE de `setActive(id)`, apoi Acasă. Mutația care
//        pică: `setActive` înaintea recitirii membership-urilor.
import { cloneElement, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { RestaurantFeatures } from '../../lib/features'

const { state, homeProps, ctx } = vi.hoisted(() => ({
  state: {
    features: null as RestaurantFeatures | null,
    country: 'RO' as string | null,
    site: 'ro' as 'ro' | 'com',
    loadError: false,
  },
  homeProps: { upsell: undefined as unknown },
  // RestaurantContext: membership-urile (lotul A) + ordinea apelurilor.
  ctx: {
    memberships: [] as { restaurant_id: string; role: string; restaurant: { id: string; name: string; slug: string } }[],
    founderViewId: null as string | null,
    calls: [] as string[],
  },
}))
// Confirmarea ieșirii din Setări: răspunsul îl decide testul (`dialog.resolve`).
const { dialog } = vi.hoisted(() => ({
  dialog: {
    calls: 0,
    resolve: null as ((ok: boolean) => void) | null,
  },
}))
vi.mock('../../components/ui/confirm', () => ({
  confirm: () => {
    dialog.calls += 1
    return new Promise<boolean>((resolve) => {
      dialog.resolve = resolve
    })
  },
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }))
vi.mock('../../contexts/RestaurantContext', () => ({
  useRestaurantCtx: () => ({
    activeId: 'rest-1',
    activeRole: 'owner',
    setActive: (id: string) => {
      ctx.calls.push(`setActive:${id}`)
    },
    founderViewId: ctx.founderViewId,
    memberships: ctx.memberships,
    reloadMemberships: async () => {
      ctx.calls.push('reloadMemberships')
      return true
    },
  }),
}))
vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({
    features: state.features,
    loading: false,
    loadError: state.loadError,
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
// Site-ul (.ro / .com) — restul modulului rămâne real.
vi.mock('../../lib/domain', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/domain')),
  browserSite: () => state.site,
}))
vi.mock('../../lib/founder', () => ({
  exitFounderView: vi.fn(),
  clearFounderView: vi.fn(),
  getFounderViewOrigin: () => null,
}))
vi.mock('../../lib/pendingCountry', () => ({ retryPendingCountry: async () => 'noop' }))
vi.mock('../../components/HelpButton', () => ({ HelpButton: () => null }))
vi.mock('../../components/SignOutButton', () => ({ SignOutButton: () => null }))
vi.mock('../../components/AiChatbot', () => ({ default: () => null }))
// Ecranele lazy: stub-uri cu un text recognoscibil (fără rețea).
vi.mock('../../components/ReportsTab', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-vanzari') }
})
vi.mock('../../components/VatReportTab', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', null, 'stub-tva') }
})
vi.mock('../../components/SettingsTab', async () => {
  const { createElement } = await import('react')
  return {
    default: (p: {
      section: string
      isOwner?: boolean
      onDirtyChange?: (d: boolean) => void
      onLocationCreated?: (id: string) => Promise<void>
    }) =>
      createElement(
        'div',
        null,
        `stub-setari-${p.section}`,
        // Simulează o modificare nesalvată în formular.
        createElement('button', { onClick: () => p.onDirtyChange?.(true) }, 'stub-modifica'),
        // Simulează o locație nou creată din „Adaugă o locație" (lotul A).
        p.onLocationCreated
          ? createElement(
              'button',
              { onClick: () => void p.onLocationCreated?.('rest-new') },
              'stub-locatie-creata',
            )
          : null,
        p.section === 'account' && p.isOwner === true
          ? createElement('div', { id: 'billing-card' }, 'stub-abonament')
          : null,
      ),
  }
})
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
vi.mock('../../components/HappyHourTab', () => ({ default: () => null }))
vi.mock('../../components/StocksTab', () => ({ default: () => null }))
vi.mock('../../components/TablesManager', () => ({ default: () => null }))
vi.mock('../../components/LocationsTab', async () => {
  const { createElement } = await import('react')
  return {
    default: (p: { onOpen: (id: string) => void }) =>
      createElement(
        'div',
        null,
        'stub-locatii',
        createElement('button', { onClick: () => p.onOpen('rest-2') }, 'stub-deschide'),
      ),
  }
})
vi.mock('../../components/FloorPlanEditor', () => ({ default: () => null }))
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
    country: state.country,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  }
}

function membership(id: string, role: string) {
  return { restaurant_id: id, role, restaurant: { id, name: `Local ${id}`, slug: id } }
}

const FISCAL = /\bTVA\b|bon(ul|uri)? fiscal|cas[aă] de marcat|Bridge fiscal|Încasări|Facturi/i

// Navigarea din App, emulată: push/replace pe istoricul jsdom.
const urls = {
  navigate: vi.fn((path: string) => window.history.pushState({}, '', path)),
  replaceUrl: vi.fn((path: string) => window.history.replaceState({}, '', path)),
}

async function renderDashboard(
  plan: DbPlan | null,
  opts: { url?: string; anchor?: boolean } = {},
) {
  state.features = plan == null ? null : featuresFor(plan)
  window.history.replaceState({}, '', opts.url ?? '/dashboard')
  const ui = (
    <DashboardPage
      onViewMenu={vi.fn()}
      onViewWaiter={vi.fn()}
      onViewKitchen={vi.fn()}
      onPricing={vi.fn()}
      onSignOut={vi.fn(async () => {})}
      restaurants={[makeRestaurant()]}
      restaurantsLoading={false}
      updateRestaurant={
        vi.fn(async () => ({ error: null })) as unknown as ComponentProps<
          typeof DashboardPage
        >['updateRestaurant']
      }
      refetchRestaurants={async () => {
        ctx.calls.push('refetchRestaurants')
      }}
      navigate={urls.navigate}
      replaceUrl={urls.replaceUrl}
    />
  )
  const view = render(ui)
  // Ancora: Acasă s-a montat (lazy), deci bara laterală e cea finală.
  if (opts.anchor !== false) expect(await screen.findByText('stub-acasa')).toBeInTheDocument()
  // `ui` = elementul randat; pentru `rerender` se clonează (vezi DS9c).
  return { ...view, ui }
}

const nav = () => screen.getByRole('navigation')
const title = () => screen.getByRole('heading', { level: 1 })
const openGroup = async (name: RegExp) =>
  userEvent.setup().click(within(nav()).getByRole('button', { name }))

beforeEach(() => {
  homeProps.upsell = undefined
  ctx.memberships = [membership('rest-1', 'owner')]
  ctx.founderViewId = null
  ctx.calls = []
  state.loadError = false
  dialog.calls = 0
  dialog.resolve = null
  state.country = 'RO'
  state.site = 'ro'
  urls.navigate.mockClear()
  urls.replaceUrl.mockClear()
  // jsdom nu implementează Element.scrollTo / scrollIntoView; DashboardPage
  // readuce conținutul sus la fiecare schimbare de tab și centrează cardul de
  // facturare pe `?tab=billing`.
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView']
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
    // Control: grupurile planului sunt acolo — inclusiv Rezervările (pe orice
    // plan, mig 086), sub numele lor: grupul Comenzi are doar acest sub-tab.
    expect(within(nav()).getByRole('button', { name: /Meniu/ })).toBeInTheDocument()
    expect(within(nav()).getByRole('button', { name: /Rezervări/ })).toBeInTheDocument()
  })

  it('DS2: Planul 2 — ospătar da; fila casei (Setări) e „Imprimantă bucătărie", fără TVA/Ture/Facturi', async () => {
    await renderDashboard('growth')
    expect(screen.getByRole('button', { name: /Vezi ca ospătar/ })).toBeInTheDocument()
    await openGroup(/Setări/)
    expect(await screen.findByRole('button', { name: 'Imprimantă bucătărie' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Casă & tichete' })).toBeNull()
    await openGroup(/Rapoarte/)
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
    for (const name of ['TVA', 'Facturi', 'Statistici']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    await openGroup(/Comenzi/)
    expect(await screen.findByRole('button', { name: 'Rezervări' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ture de casă' })).toBeNull()
  })

  it('DS3: control pozitiv — pe Planul 3 casa, TVA, Ture de casă și Facturi apar', async () => {
    await renderDashboard('pro')
    expect(screen.getByRole('button', { name: /Vezi ca ospătar/ })).toBeInTheDocument()
    await openGroup(/Setări/)
    expect(await screen.findByRole('button', { name: 'Casă & tichete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimantă bucătărie' })).toBeNull()
    await openGroup(/Rapoarte/)
    for (const name of ['Vânzări', 'Statistici', 'TVA', 'Facturi']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
    await openGroup(/Comenzi/)
    expect(await screen.findByRole('button', { name: 'Ture de casă' })).toBeInTheDocument()
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

  it('DS6: în afara pieței fiscale (non-RO sau .com) Planul 2 nu primește „Plata la masă"', async () => {
    for (const setup of [
      () => {
        state.country = 'DE'
      },
      () => {
        state.site = 'com'
      },
    ]) {
      state.country = 'RO'
      state.site = 'ro'
      setup()
      const growth = await renderDashboard('growth')
      expect(homeProps.upsell).toBeNull()
      growth.unmount()
      // Planul 1 primește tot „Meniu + Comenzi" (se vinde și pe .com).
      const starter = await renderDashboard('starter')
      expect(homeProps.upsell).toBe('ordering')
      starter.unmount()
    }
  })
})

describe('DashboardPage — tab-ul în URL și titlul paginii (lotul R2)', () => {
  it('DS7: `?tab=tva` pe Planul 3 se restaurează la montare', async () => {
    await renderDashboard('pro', { url: '/dashboard?tab=tva', anchor: false })
    expect(await screen.findByText('stub-tva')).toBeInTheDocument()
    expect(title()).toHaveTextContent('TVA')
    expect(urls.replaceUrl).not.toHaveBeenCalled()
  })

  it('DS8: `?tab=` necunoscut → Acasă', async () => {
    for (const url of ['/dashboard?tab=nu-exista', '/dashboard?tab=constructor']) {
      const { unmount } = await renderDashboard('pro', { url })
      expect(title()).toHaveTextContent('Acasă')
      unmount()
    }
  })

  it('DS9: `?tab=` nepermis pe plan → Acasă, cu URL-ul corectat', async () => {
    await renderDashboard('starter', { url: '/dashboard?tab=tva' })
    expect(title()).toHaveTextContent('Acasă')
    expect(screen.queryByText('stub-tva')).toBeNull()
    await waitFor(() => expect(urls.replaceUrl).toHaveBeenCalledWith('/dashboard'))
    expect(window.location.search).toBe('')
  })

  it('DS9b: cât planul nu e cunoscut, tab-ul cerut nu e aruncat pe Acasă', async () => {
    await renderDashboard(null, { url: '/dashboard?tab=tva', anchor: false })
    expect(await screen.findByText('Se încarcă...')).toBeInTheDocument()
    expect(screen.queryByText('stub-acasa')).toBeNull()
    expect(urls.replaceUrl).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?tab=tva')
  })

  it('DS10: click → URL nou + titlul nou; Back (popstate) readuce tab-ul din URL', async () => {
    await renderDashboard('pro')
    await openGroup(/Rapoarte/)
    expect(urls.navigate).toHaveBeenLastCalledWith('/dashboard?tab=raport')
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
    expect(title()).toHaveTextContent('Vânzări')
    await userEvent.setup().click(screen.getByRole('button', { name: 'TVA' }))
    expect(urls.navigate).toHaveBeenLastCalledWith('/dashboard?tab=tva')
    expect(await screen.findByText('stub-tva')).toBeInTheDocument()
    expect(title()).toHaveTextContent('TVA')
    // Back: browserul schimbă URL-ul și emite popstate.
    act(() => {
      window.history.replaceState({}, '', '/dashboard?tab=raport')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
    expect(title()).toHaveTextContent('Vânzări')
  })

  it('DS11: titlul paginii = eticheta chip-ului, pe fiecare sub-tab din Setări', async () => {
    await renderDashboard('pro')
    await openGroup(/Setări/)
    const chips = within(await screen.findByLabelText('Secțiuni Setări')).getAllByRole('button')
    const labels = chips.map((c) => c.textContent ?? '')
    // Control: Setările au toate cele opt secțiuni pe Planul 3.
    expect(labels).toEqual([
      'Restaurant',
      'Aspect meniu',
      'Comenzi & plăți',
      'Echipă',
      'Program echipă',
      'Casă & tichete',
      'Asistent AI',
      'Abonament & cont',
    ])
    const user = userEvent.setup()
    for (const label of labels) {
      await user.click(within(screen.getByLabelText('Secțiuni Setări')).getByRole('button', { name: label }))
      await waitFor(() => expect(title()).toHaveTextContent(label))
      // Numele GRUPULUI nu mai e un rând separat deasupra chip-urilor.
      expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(1)
    }
  })

  it('DS12: `?tab=billing` → Setări → Abonament & cont, cu scroll pe cardul de facturare', async () => {
    await renderDashboard('growth', { url: '/dashboard?tab=billing', anchor: false })
    expect(await screen.findByText('stub-setari-account')).toBeInTheDocument()
    expect(title()).toHaveTextContent('Abonament & cont')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled(), {
      timeout: 2000,
    })
  })
})

describe('DashboardPage — recenzia #335', () => {
  const back = (url: string) =>
    act(() => {
      window.history.replaceState({}, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

  it('DS13: Back cu formularul modificat cere confirmare; la refuz rămâi pe Setări', async () => {
    await renderDashboard('pro')
    await openGroup(/Setări/)
    expect(await screen.findByText('stub-setari-restaurant')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-modifica' }))
    back('/dashboard')
    expect(dialog.calls).toBe(1)
    // Setările rămân montate, iar URL-ul e refăcut pe secțiunea curentă.
    expect(screen.getByText('stub-setari-restaurant')).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=settings')
    await act(async () => dialog.resolve?.(false))
    expect(screen.getByText('stub-setari-restaurant')).toBeInTheDocument()
    expect(title()).toHaveTextContent('Restaurant')
    // Al doilea Back, de data asta cu „Pleacă" → ajungi unde a cerut Back-ul.
    back('/dashboard?tab=raport')
    expect(dialog.calls).toBe(2)
    await act(async () => dialog.resolve?.(true))
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=raport')
  })

  it('DS13b: control — fără modificări, Back-ul navighează direct', async () => {
    await renderDashboard('pro')
    await openGroup(/Setări/)
    expect(await screen.findByText('stub-setari-restaurant')).toBeInTheDocument()
    back('/dashboard?tab=raport')
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
    expect(dialog.calls).toBe(0)
  })

  it('DS14: clicuri repetate cât confirmarea e deschisă → un singur dialog', async () => {
    await renderDashboard('pro')
    const user = userEvent.setup()
    await openGroup(/Setări/)
    expect(await screen.findByText('stub-setari-restaurant')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'stub-modifica' }))
    await user.click(within(nav()).getByRole('button', { name: /Rapoarte/ }))
    await user.click(within(nav()).getByRole('button', { name: /Rapoarte/ }))
    await user.click(within(nav()).getByRole('button', { name: /Meniu/ }))
    expect(dialog.calls).toBe(1)
    await act(async () => dialog.resolve?.(true))
    expect(await screen.findByText('stub-vanzari')).toBeInTheDocument()
  })

  it('DS9c: plan necitit + `?tab=tva` → Acasă fără rescrierea URL-ului; „Reîncearcă" readuce TVA', async () => {
    state.loadError = true
    const view = await renderDashboard(null, { url: '/dashboard?tab=tva' })
    expect(title()).toHaveTextContent('Acasă')
    expect(urls.replaceUrl).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?tab=tva')
    // „Reîncearcă" reușit: planul devine cunoscut.
    state.loadError = false
    state.features = featuresFor('pro')
    // Element NOU: cu aceeași referință React sare peste re-randare (bailout),
    // iar DashboardPage n-ar mai citi starea nouă din `useFeatures`.
    view.rerender(cloneElement(view.ui))
    expect(await screen.findByText('stub-tva')).toBeInTheDocument()
    expect(title()).toHaveTextContent('TVA')
    expect(urls.replaceUrl).not.toHaveBeenCalled()
  })
})

describe('DashboardPage — „Toate locațiile" (lotul A)', () => {
  it('DS15: proprietar + manager la două localuri → „Locații" apare; „Deschide" face localul activ', async () => {
    ctx.memberships = [membership('rest-1', 'owner'), membership('rest-2', 'manager')]
    await renderDashboard('growth')
    await openGroup(/Locații/)
    expect(await screen.findByText('stub-locatii')).toBeInTheDocument()
    expect(title()).toHaveTextContent('Toate locațiile')
    expect(urls.navigate).toHaveBeenLastCalledWith('/dashboard?tab=locatii')
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-deschide' }))
    expect(ctx.calls).toContain('setActive:rest-2')
    await waitFor(() => expect(title()).toHaveTextContent('Acasă'))
  })

  it('DS16: un singur local de admin (al doilea doar ca ospătar) sau vizita de fondator → fără „Locații"', async () => {
    ctx.memberships = [membership('rest-1', 'owner'), membership('rest-2', 'waiter')]
    const first = await renderDashboard('growth')
    expect(within(nav()).queryByRole('button', { name: /Locații/ })).toBeNull()
    first.unmount()
    // Membership-ul SINTETIC al vizitei de fondator nu e un local al omului.
    ctx.memberships = [membership('rest-1', 'owner'), membership('rest-9', 'manager')]
    ctx.founderViewId = 'rest-9'
    await renderDashboard('growth')
    expect(within(nav()).queryByRole('button', { name: /Locații/ })).toBeNull()
    // Control: grupul Meniu e acolo (bara laterală e cea finală).
    expect(within(nav()).getByRole('button', { name: /Meniu/ })).toBeInTheDocument()
  })

  it('DS17: locație nouă → listele se recitesc ÎNAINTE de setActive, apoi Acasă', async () => {
    await renderDashboard('growth', { url: '/dashboard?tab=settings-account', anchor: false })
    expect(await screen.findByText('stub-setari-account')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-locatie-creata' }))
    await waitFor(() => expect(ctx.calls).toContain('setActive:rest-new'))
    const at = ctx.calls.indexOf('setActive:rest-new')
    expect(ctx.calls.indexOf('reloadMemberships')).toBeGreaterThanOrEqual(0)
    expect(ctx.calls.indexOf('reloadMemberships')).toBeLessThan(at)
    expect(ctx.calls.indexOf('refetchRestaurants')).toBeGreaterThanOrEqual(0)
    expect(ctx.calls.indexOf('refetchRestaurants')).toBeLessThan(at)
    await waitFor(() => expect(title()).toHaveTextContent('Acasă'))
  })
})
