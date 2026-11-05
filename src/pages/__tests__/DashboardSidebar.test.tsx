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
//   DS17 „Adaugă o locație" (SettingsTab primește `addLocation`): ambele
//        liste se recitesc ÎNAINTE de `setActive(id)`, apoi Acasă. Recitirile
//        se rezolvă abia când testul le eliberează (promisiune controlată), iar
//        `setActive` trebuie să vină DUPĂ încheierea AMBELOR — nu doar după
//        pornirea lor. Mutația care pică: apelurile fără `await` (setActive
//        imediat după pornire).
//
// Recenzia adversarială pe #344:
//   DS18 „Deschide" pe un id NECUNOSCUT contextului (locație creată pe alt
//        dispozitiv): membership-urile se recitesc ÎNTÂI; dacă tot lipsește,
//        fără `setActive` și cu eroarea respinsă spre ecran; control pozitiv:
//        după o recitire care îl conține, `setActive` pe el. Mutația care pică:
//        `setActive` direct (rol null pe localul necunoscut).
//   DS19 locația creată NU apare în lista de restaurante recitită (useData.load
//        doar setează `error`) → reîncărcare completă, nu panoul lăsat pe
//        `restaurants[0]`. Mutația care pică: verificarea listei recitite scoasă.
//   DS20 cardul „Adaugă o locație" DOAR cu limita cunoscută și loc liber: limita
//        1 cu 1 local deținut → lipsește; limita 2 → apare; `plan_limits` în
//        încărcare sau planul necunoscut → lipsește. Mutația care pică:
//        `addLocation` trimis necondiționat pentru proprietar (codul din 3dacdbd).
//
// Lotul O7a (harta sălii, mig 322):
//   DS21 harta salvată prin editor (`onSaved`) intră în lista de restaurante
//        (`patchRestaurantLocal`), deci după o schimbare de tab editorul
//        REMONTAT pornește de la harta nouă, nu de la copia de la boot.
//        Control pozitiv: prima montare primește harta veche. Mutația care
//        pică: DashboardPage nu mai trimite `onSaved`, sau îl leagă de un no-op
//        ori de `refetchRestaurants` (lista recitită nu are harta nouă).
//
// Lotul O7a (selectorul de restaurant cu Setări nesalvate):
//   DS22 Setări modificate + alt restaurant din selectorul barei laterale →
//        întâi confirmarea (cu numele localului nou), fără `setActive`;
//        select-ul rămâne pe localul curent și Setările montate; la „Rămân
//        aici" nimic, la „Schimbă fără să salvezi" `setActive` o singură dată.
//        Mutații care pică: `onChange={(e) => setActive(e.target.value)}`
//        (comutare imediată, fără dialog — formularul era rescris tăcut cu
//        datele localului nou) și `setActive` chemat indiferent de răspuns.
//   DS22b control pozitiv: Setări deschise dar NEmodificate, și pe Acasă →
//        comutare imediată, fără dialog. Mutații care pică: garda doar pe tab
//        (fără `settingsDirtyRef`) pică (i); un selector care întreabă mereu
//        pică (i) și (ii) — fără control, DS22 ar trece și pe el.
//   DS23 „Adaugă o locație" cu Setări modificate → întrebarea vine ÎNAINTE de
//        creare (nicio recitire, niciun `setActive`); la refuz nimic, la acord
//        recitirile, apoi `setActive`, apoi Acasă FĂRĂ a treia întrebare.
//        Mutații care pică: `confirmBeforeOpen` netrimis (recitirea de după
//        creare rescrie formularul înaintea oricărei întrebări) și
//        `settingsDirtyRef.current = false` scos din handleLocationCreated
//        (`setTab('home')` deschide un al treilea dialog, titlul rămâne pe Setări).
import { cloneElement, useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'
import type { RestaurantFeatures } from '../../lib/features'

const { state, homeProps, ctx, limits } = vi.hoisted(() => ({
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
    // Ce întorc recitirile (null = membership-urile curente / id-urile lor).
    reloadRows: null as
      | { restaurant_id: string; role: string; restaurant: { id: string; name: string; slug: string } }[]
      | null,
    listIds: null as string[] | null,
    // Promisiune controlată: recitirile se termină abia la `release()`.
    hold: null as Promise<void> | null,
    openErrors: [] as string[],
    // Fiecare MONTARE a editorului hărții (DS21): harta inițială + callback-ul.
    floorMounts: [] as { initialLayout: unknown; onSaved: (layout: unknown) => void }[],
  },
  // Limitele planului (usePlanLimits): plafonul de restaurante + încărcarea.
  limits: { maxRestaurants: 1, loading: false },
}))
// Confirmarea ieșirii din Setări: răspunsul îl decide testul (`dialog.resolve`).
type DialogCopy = {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
}
const { dialog } = vi.hoisted(() => ({
  dialog: {
    calls: 0,
    resolve: null as ((ok: boolean) => void) | null,
    // Textul ultimului dialog cerut (DS22: numele localului nou).
    last: null as DialogCopy | null,
  },
}))
vi.mock('../../components/ui/confirm', () => ({
  confirm: (opts: DialogCopy) => {
    dialog.calls += 1
    dialog.last = opts
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
      if (ctx.hold) await ctx.hold
      ctx.calls.push('reloadMemberships:done')
      return ctx.reloadRows ?? ctx.memberships
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
    limits: {
      plan: 'starter',
      max_products: 300,
      max_restaurants: limits.maxRestaurants,
      max_tables: 120,
    },
    loading: limits.loading,
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
      addLocation?: {
        onCreated: (id: string) => Promise<void>
        confirmBeforeOpen?: () => Promise<boolean>
      }
    }) =>
      createElement(
        'div',
        null,
        `stub-setari-${p.section}`,
        // Simulează o modificare nesalvată în formular.
        createElement('button', { onClick: () => p.onDirtyChange?.(true) }, 'stub-modifica'),
        // Simulează o locație nou creată din „Adaugă o locație" (lotul A),
        // cu întrebarea dinaintea dialogului (contractul AddLocationCard, AL9).
        p.addLocation
          ? createElement(
              'button',
              {
                onClick: () =>
                  void (async () => {
                    const loc = p.addLocation
                    if (!loc) return
                    if (loc.confirmBeforeOpen && !(await loc.confirmBeforeOpen())) return
                    await loc.onCreated('rest-new')
                  })(),
              },
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
    default: (p: { onOpen: (id: string) => Promise<void> }) => {
      const open = (id: string) =>
        p.onOpen(id).catch((e: unknown) => {
          ctx.openErrors.push(e instanceof Error ? e.message : String(e))
        })
      return createElement(
        'div',
        null,
        'stub-locatii',
        createElement('button', { onClick: () => void open('rest-2') }, 'stub-deschide'),
        createElement('button', { onClick: () => void open('rest-3') }, 'stub-deschide-necunoscut'),
      )
    },
  }
})
// Editorul hărții: stub care notează fiecare MONTARE (inițializatorul useState
// rulează o singură dată per montare, nu la fiecare randare).
vi.mock('../../components/FloorPlanEditor', async () => {
  const { createElement, useState: useStateReact } = await import('react')
  function FloorEditorStub(p: { initialLayout?: unknown; onSaved: (layout: unknown) => void }) {
    useStateReact(() => {
      ctx.floorMounts.push({ initialLayout: p.initialLayout, onSaved: p.onSaved })
      return null
    })
    return createElement('div', null, 'stub-harta')
  }
  return { default: FloorEditorStub }
})
// Reîncărcarea completă a paginii (jsdom nu navighează): o notăm.
vi.mock('../../lib/locations', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/locations')),
  hardReloadTo: (path: string) => {
    ctx.calls.push(`hardReload:${path}`)
  },
}))
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

function makeRestaurant(id = 'rest-1', name = 'Bistro Test'): Restaurant {
  return {
    id,
    owner_id: 'owner-1',
    name,
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
  opts: { url?: string; anchor?: boolean; restaurantIds?: string[] } = {},
) {
  state.features = plan == null ? null : featuresFor(plan)
  const initialIds = opts.restaurantIds ?? ['rest-1']
  window.history.replaceState({}, '', opts.url ?? '/dashboard')
  const ui = (
    <DashboardPage
      onViewMenu={vi.fn()}
      onViewWaiter={vi.fn()}
      onViewKitchen={vi.fn()}
      onPricing={vi.fn()}
      onSignOut={vi.fn(async () => {})}
      restaurants={initialIds.map((id) =>
        makeRestaurant(id, id === 'rest-1' ? 'Bistro Test' : `Bistro ${id}`),
      )}
      restaurantsLoading={false}
      updateRestaurant={
        vi.fn(async () => ({ error: null })) as unknown as ComponentProps<
          typeof DashboardPage
        >['updateRestaurant']
      }
      refetchRestaurants={async () => {
        ctx.calls.push('refetchRestaurants')
        if (ctx.hold) await ctx.hold
        ctx.calls.push('refetchRestaurants:done')
        const ids = ctx.listIds ?? (ctx.reloadRows ?? ctx.memberships).map((m) => m.restaurant_id)
        return ids.map((id) => makeRestaurant(id))
      }}
      patchRestaurantLocal={vi.fn()}
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
  ctx.reloadRows = null
  ctx.listIds = null
  ctx.hold = null
  ctx.openErrors = []
  ctx.floorMounts = []
  limits.maxRestaurants = 1
  limits.loading = false
  state.loadError = false
  dialog.calls = 0
  dialog.resolve = null
  dialog.last = null
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
    await waitFor(() => expect(ctx.calls).toContain('setActive:rest-2'))
    // rest-2 e deja în context: fără recitirea membership-urilor.
    expect(ctx.calls).not.toContain('reloadMemberships')
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

  it('DS17: locație nouă → setActive abia DUPĂ ce ambele recitiri s-au terminat, apoi Acasă', async () => {
    limits.maxRestaurants = 2
    ctx.reloadRows = [membership('rest-1', 'owner'), membership('rest-new', 'owner')]
    const gate = { release: () => {} }
    ctx.hold = new Promise<void>((r) => {
      gate.release = () => r()
    })
    await renderDashboard('growth', { url: '/dashboard?tab=settings-account', anchor: false })
    expect(await screen.findByText('stub-setari-account')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-locatie-creata' }))
    await waitFor(() => expect(ctx.calls).toContain('refetchRestaurants'))
    expect(ctx.calls).toContain('reloadMemberships')
    // Recitirile sunt încă în zbor: nicio comutare.
    expect(ctx.calls).not.toContain('setActive:rest-new')
    await act(async () => {
      gate.release()
    })
    await waitFor(() => expect(ctx.calls).toContain('setActive:rest-new'))
    const at = ctx.calls.indexOf('setActive:rest-new')
    expect(ctx.calls.indexOf('reloadMemberships:done')).toBeGreaterThanOrEqual(0)
    expect(ctx.calls.indexOf('reloadMemberships:done')).toBeLessThan(at)
    expect(ctx.calls.indexOf('refetchRestaurants:done')).toBeGreaterThanOrEqual(0)
    expect(ctx.calls.indexOf('refetchRestaurants:done')).toBeLessThan(at)
    expect(ctx.calls.some((c) => c.startsWith('hardReload'))).toBe(false)
    await waitFor(() => expect(title()).toHaveTextContent('Acasă'))
  })

  it('DS18: „Deschide" pe un id necunoscut → întâi recitire; dacă lipsește, eroare fără comutare', async () => {
    ctx.memberships = [membership('rest-1', 'owner'), membership('rest-2', 'manager')]
    await renderDashboard('growth', { url: '/dashboard?tab=locatii', anchor: false })
    expect(await screen.findByText('stub-locatii')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-deschide-necunoscut' }))
    await waitFor(() => expect(ctx.openErrors).toHaveLength(1))
    expect(ctx.calls).toContain('reloadMemberships')
    expect(ctx.calls.some((c) => c.startsWith('setActive'))).toBe(false)
    expect(ctx.openErrors[0]).toMatch(/Locația nu apare/)
    expect(title()).toHaveTextContent('Toate locațiile')
    // Control: o recitire care îl conține → comutare.
    ctx.reloadRows = [...ctx.memberships, membership('rest-3', 'manager')]
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-deschide-necunoscut' }))
    await waitFor(() => expect(ctx.calls).toContain('setActive:rest-3'))
    expect(ctx.openErrors).toHaveLength(1)
  })

  it('DS19: locația creată lipsește din lista recitită → reîncărcare completă', async () => {
    limits.maxRestaurants = 2
    ctx.reloadRows = [membership('rest-1', 'owner'), membership('rest-new', 'owner')]
    ctx.listIds = ['rest-1']
    await renderDashboard('growth', { url: '/dashboard?tab=settings-account', anchor: false })
    expect(await screen.findByText('stub-setari-account')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-locatie-creata' }))
    await waitFor(() => expect(ctx.calls).toContain('hardReload:/dashboard'))
    expect(ctx.calls).toContain('setActive:rest-new')
    expect(title()).not.toHaveTextContent('Acasă')
  })

  it('DS20: „Adaugă o locație" doar cu limita cunoscută și loc liber', async () => {
    const card = () => screen.queryByRole('button', { name: 'stub-locatie-creata' })
    const at = async (plan: DbPlan | null) => {
      const view = await renderDashboard(plan, { url: '/dashboard?tab=settings-account', anchor: false })
      expect(await screen.findByText('stub-setari-account')).toBeInTheDocument()
      return view
    }
    // Limita 1, un local deținut (Planurile 1–2) → lipsește.
    limits.maxRestaurants = 1
    let v = await at('growth')
    expect(card()).toBeNull()
    v.unmount()
    // Limita 2 → apare (control pozitiv).
    limits.maxRestaurants = 2
    v = await at('pro')
    expect(card()).toBeInTheDocument()
    v.unmount()
    // `plan_limits` încă în încărcare → necunoscut → lipsește.
    limits.loading = true
    v = await at('pro')
    expect(card()).toBeNull()
    v.unmount()
    // Planul necunoscut (features neîncărcate) → lipsește.
    limits.loading = false
    await at(null)
    expect(card()).toBeNull()
  })
})

describe('DashboardPage — harta sălii după salvare (lotul O7a, mig 322)', () => {
  const OLD_LAYOUT = { floors: [{ id: 'OLD' }], version: 1, savedAt: '2026-10-01T10:00:00Z' }
  const NEW_LAYOUT = { floors: [{ id: 'NEW' }], version: 1, savedAt: '2026-11-04T10:00:00Z' }

  // Lista de restaurante ținută în state, ca în AppRouter (useRestaurants).
  function StatefulDashboard() {
    const [list, setList] = useState<Restaurant[]>(() => [
      { ...makeRestaurant(), floor_layout: OLD_LAYOUT },
    ])
    return (
      <DashboardPage
        onViewMenu={vi.fn()}
        onViewWaiter={vi.fn()}
        onViewKitchen={vi.fn()}
        onPricing={vi.fn()}
        onSignOut={vi.fn(async () => {})}
        restaurants={list}
        restaurantsLoading={false}
        updateRestaurant={
          vi.fn(async () => ({ error: null })) as unknown as ComponentProps<
            typeof DashboardPage
          >['updateRestaurant']
        }
        // Lista recitită NU are harta nouă (ca o recitire care pică pe un blip).
        refetchRestaurants={async () => [makeRestaurant()]}
        patchRestaurantLocal={(id, patch) =>
          setList((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)))
        }
        navigate={urls.navigate}
        replaceUrl={urls.replaceUrl}
      />
    )
  }

  const goTo = (url: string) =>
    act(() => {
      window.history.pushState({}, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

  it('DS21: după salvare și o schimbare de tab, editorul remontat primește harta nouă', async () => {
    state.features = featuresFor('pro')
    window.history.replaceState({}, '', '/dashboard?tab=arhitectura')
    render(<StatefulDashboard />)
    expect(await screen.findByText('stub-harta')).toBeInTheDocument()
    // Control pozitiv: prima montare pornește de la harta din listă (cea veche).
    expect(ctx.floorMounts).toHaveLength(1)
    expect(ctx.floorMounts[0].initialLayout).toEqual(OLD_LAYOUT)

    // Editorul raportează o salvare reușită.
    act(() => {
      ctx.floorMounts[0].onSaved(NEW_LAYOUT)
    })

    goTo('/dashboard')
    expect(await screen.findByText('stub-acasa')).toBeInTheDocument()
    expect(screen.queryByText('stub-harta')).toBeNull()

    goTo('/dashboard?tab=arhitectura')
    expect(await screen.findByText('stub-harta')).toBeInTheDocument()
    expect(ctx.floorMounts).toHaveLength(2)
    expect(ctx.floorMounts[1].initialLayout).toEqual(NEW_LAYOUT)
  })
})

describe('DashboardPage — selectorul de restaurant cu Setări nesalvate (lotul O7a)', () => {
  const switcher = () => screen.getByRole('combobox', { name: 'Alege restaurantul' })
  const setActiveCalls = (id: string) => ctx.calls.filter((c) => c === `setActive:${id}`).length
  // Un macrotask: lanțul de promisiuni de după răspunsul la dialog s-a încheiat,
  // deci o verificare NEGATIVĂ („fără setActive") nu trece din grabă.
  const settle = () =>
    act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0))
    })

  it('DS22: Setări modificate + alt restaurant → întâi confirmarea; la refuz rămâi, la acord comuți o dată', async () => {
    await renderDashboard('pro', { restaurantIds: ['rest-1', 'rest-2'] })
    const user = userEvent.setup()
    await openGroup(/Setări/)
    expect(await screen.findByText('stub-setari-restaurant')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'stub-modifica' }))

    await user.selectOptions(switcher(), 'rest-2')
    expect(dialog.calls).toBe(1)
    expect(setActiveCalls('rest-2')).toBe(0)
    // Select-ul controlat rămâne pe localul curent, Setările rămân montate.
    expect(switcher()).toHaveValue('rest-1')
    expect(screen.getByText('stub-setari-restaurant')).toBeInTheDocument()
    expect(dialog.last?.confirmLabel).toBe('Schimbă fără să salvezi')
    expect(dialog.last?.cancelLabel).toBe('Rămân aici')
    expect(dialog.last?.description).toContain('Bistro rest-2')
    expect(dialog.last?.description).toContain('Bistro Test')

    // „Rămân aici": nicio comutare.
    await act(async () => dialog.resolve?.(false))
    await settle()
    expect(setActiveCalls('rest-2')).toBe(0)
    expect(switcher()).toHaveValue('rest-1')
    expect(title()).toHaveTextContent('Restaurant')

    // A doua încercare, cu „Schimbă fără să salvezi".
    await user.selectOptions(switcher(), 'rest-2')
    expect(dialog.calls).toBe(2)
    await act(async () => dialog.resolve?.(true))
    await waitFor(() => expect(setActiveCalls('rest-2')).toBe(1))
    await settle()
    expect(setActiveCalls('rest-2')).toBe(1)
  })

  it('DS22b: control — fără modificări (Setări deschise sau Acasă) comutarea e imediată, fără dialog', async () => {
    const first = await renderDashboard('pro', { restaurantIds: ['rest-1', 'rest-2'] })
    const user = userEvent.setup()
    // (i) Setări deschise, formularul NEmodificat.
    await openGroup(/Setări/)
    expect(await screen.findByText('stub-setari-restaurant')).toBeInTheDocument()
    await user.selectOptions(switcher(), 'rest-2')
    expect(setActiveCalls('rest-2')).toBe(1)
    expect(dialog.calls).toBe(0)
    first.unmount()

    // (ii) Pe Acasă (tab-ul implicit).
    ctx.calls = []
    await renderDashboard('pro', { restaurantIds: ['rest-1', 'rest-2'] })
    await user.selectOptions(switcher(), 'rest-2')
    expect(setActiveCalls('rest-2')).toBe(1)
    expect(dialog.calls).toBe(0)
  })

  it('DS23: „Adaugă o locație" cu Setări modificate → întrebarea vine înainte de creare și de recitiri', async () => {
    limits.maxRestaurants = 2
    ctx.reloadRows = [membership('rest-1', 'owner'), membership('rest-new', 'owner')]
    await renderDashboard('pro', { url: '/dashboard?tab=settings-account', anchor: false })
    expect(await screen.findByText('stub-setari-account')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'stub-modifica' }))

    await user.click(screen.getByRole('button', { name: 'stub-locatie-creata' }))
    await waitFor(() => expect(dialog.calls).toBe(1))
    // Nicio recitire și nicio comutare înaintea răspunsului.
    expect(ctx.calls).toEqual([])
    expect(dialog.last?.confirmLabel).toBe('Continuă fără să salvezi')

    // Refuz: nimic nu se întâmplă, Setările rămân.
    await act(async () => dialog.resolve?.(false))
    await settle()
    expect(ctx.calls).toEqual([])
    expect(screen.getByText('stub-setari-account')).toBeInTheDocument()

    // Acord: recitirile, apoi `setActive`, apoi Acasă — fără o a treia întrebare.
    await user.click(screen.getByRole('button', { name: 'stub-locatie-creata' }))
    await waitFor(() => expect(dialog.calls).toBe(2))
    await act(async () => dialog.resolve?.(true))
    await waitFor(() => expect(ctx.calls).toContain('setActive:rest-new'))
    const at = ctx.calls.indexOf('setActive:rest-new')
    expect(ctx.calls.indexOf('refetchRestaurants:done')).toBeGreaterThanOrEqual(0)
    expect(ctx.calls.indexOf('refetchRestaurants:done')).toBeLessThan(at)
    expect(ctx.calls.indexOf('reloadMemberships:done')).toBeGreaterThanOrEqual(0)
    expect(ctx.calls.indexOf('reloadMemberships:done')).toBeLessThan(at)
    await waitFor(() => expect(title()).toHaveTextContent('Acasă'))
    await settle()
    expect(dialog.calls).toBe(2)
  })
})
