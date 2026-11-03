// HomeTab („Acasă") nu afirmă nimic despre plan când NU îl știe (perf-staff-3)
// și nu transformă un număr necunoscut în „0" sau în pas „de făcut"
// (code-health-error-ignored-guards).
//
//   HT1  plan NECUNOSCUT (tier null), pașii de tier 1 toți făcuți: fără
//        „totul e gata ✓", fără upsell, fără checklist; cifra Setup e „…"
//        Mutația care pică: codul vechi (tier 1 implicit) — „4/4 totul e gata ✓"
//        și cardul „Vrei să primești comenzi…" pentru un plătitor.
//   HT2  control pozitiv: plan 2 CUNOSCUT, toți pașii făcuți → „totul e gata ✓"
//   HT3  productCount necunoscut (null): „Produse active" = „…", pasul „Adaugă
//        produse" e „stare necunoscută" (nu „de făcut"), iar setup-ul NU e gata
//        Mutația care pică: `done: productCount > 0` (null → pas „de făcut").
//   HT4  citirea categoriilor EȘUEAZĂ → pasul e „stare necunoscută", nu nebifat
//        Mutația care pică: `(categoriesCount ?? 0) > 0`, și `setCategoriesCount(0)`
//        pe eroare (verificarea vine DUPĂ ce lotul de citiri s-a așezat).
//   HT5  control pozitiv pentru HT1: tier 1 CUNOSCUT → upsell-ul apare
//   HT6  checklist-ul e SINGURA cale de setup: fără „asistentul detaliat"
//        (QuickSetupTab dubla pașii și le ocolea gate-urile de plan), iar fiecare
//        pas duce în tab-ul lui (ux-owner-quicksetup-duplicate)
//        Mutația care pică: cardul expandabil cu asistentul readus.
//   HC1  magazinul Codvia în pauză (`false`) sau necunoscut (`null`) → fără
//        acțiunea „Suporturi QR fizice" (ux-owner-codvia-quick-action, D4)
//        Mutația care pică: acțiunea randată necondiționat (codul vechi).
//   HC2  control pozitiv: `true` → acțiunea apare și deschide magazinul
//   HR1  MANAGERUL (admin, nu proprietar): fără cardul „Abonament & facturare"
//        și fără upsell — abonamentul e pe contul proprietarului, deci cardul îi
//        dădea doar „gestionat de contul proprietarului" (fundătură).
//        Mutația care pică: `{isAdmin && (` înapoi pe card / pe upsell.
//   HR2  control pozitiv: PROPRIETARUL vede cardul și upsell-ul (tier 1).
//   HR3  personalul NE-admin: fără acțiunile de editare („Adaugă produs",
//        „Generează QR-uri", „Suporturi QR fizice"); „Vezi meniul public"
//        rămâne (control). Mutația care pică: acțiunile randate necondiționat.
//
// Lotul P (nov 2026): HomeTab primește `surface` (planSurface) + `upsell`
// (planUpsellTarget) în loc de `tier`, iar upsell-ul vechi („Vrei să primești
// comenzi direct de la masă?", doar tier 1) e înlocuit de PlanUpsellCard, UNIC,
// în zona de abonament. Testele vechi rulează pe aceleași planuri (tier 1 =
// starter, tier 2 = growth) prin fixtura matricei reale (planSurfaceFixtures).
// HT2 s-a schimbat ONEST: pe Planul 2 proprietarul vede acum upsell-ul „Plata
// la masă" (înainte niciunul); testul cere că NU vede cel vechi, de Planul 1.
//
//   HU1  Planul 1 (proprietar): upsell-ul „Meniu + Comenzi" cu cele 3 beneficii
//        (comenzi de la masă, ecran de bucătărie, ridicare); „Vezi planul" duce
//        la planuri. Mutația care pică: cardul scos din HomeTab.
//   HU2  Planul 2 (proprietar): upsell-ul „Plata la masă" (plata din telefon,
//        bonul automat, raportarea), NU cel de Planul 1. Mutația care pică: o
//        singură ofertă pentru orice plan.
//   HU3  Planul 3 și planul necunoscut → niciun upsell. Mutația care pică:
//        `{upsell != null && …}` înlocuit cu randare necondiționată.
//   HU4  MANAGERUL (nu proprietar), cu țintă → niciun upsell (n-are ce cumpăra).
//        Mutația care pică: cardul scos de sub `isOwner`.
//   HF1  Planurile 1 și 2 (manager — fără upsell): pe Acasă nu apare NIMIC
//        fiscal (TVA / bon fiscal / casă de marcat / Bridge fiscal), nici cu
//        Bridge-ul „deconectat". Mutația care pică: `isFiscal` derivat din
//        `ordering` (Planul 2 ar cere starea casei și ar arăta banner-ul).
//   HF2  Planul 2 (proprietar): termenii fiscali apar DOAR în interiorul
//        upsell-ului — nicăieri altundeva pe pagină.
//   HF3  control pozitiv pe Planul 3: cu casa deconectată banner-ul fiscal apare.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

const { failing, counts, codvia, bridge } = vi.hoisted(() => ({
  failing: new Set<string>(),
  counts: {} as Record<string, number>,
  codvia: { open: null as boolean | null },
  // Starea casei pe care ar întoarce-o RPC-ul; hook-ul o dă DOAR când HomeTab
  // o cere (`enabled`) — exact gate-ul pe care îl păzește HF1.
  bridge: {
    status: null as { registered: boolean; connected: boolean; last_seen_at: string | null } | null,
  },
}))

// Builder thenable: `await from(t).select(...).eq(...)…` dă {count, data, error}.
vi.mock('../../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'gte', 'limit', 'order']) {
      b[m] = vi.fn(() => b)
    }
    b.then = (
      onFulfilled: (v: { data: unknown[] | null; count: number | null; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) =>
      Promise.resolve(
        failing.has(table)
          ? { data: null, count: null, error: { message: 'boom', code: '500' } }
          : {
              data: (counts[table] ?? 0) > 0 ? [{ id: 'x' }] : [],
              count: counts[table] ?? 0,
              error: null,
            },
      ).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc: vi.fn() } }
})
vi.mock('../../../lib/health', () => ({
  fetchHealthScore: () => new Promise(() => {}),
  scoreLabel: () => '',
  scoreColor: () => '#888',
  getActionableSuggestions: () => [],
  planHealthScore: () => 0,
}))
vi.mock('../../../hooks/useBridgeConnected', () => ({
  useBridgeConnected: (_id: string | null, enabled: boolean) => ({
    status: enabled ? bridge.status : null,
    loading: false,
    reload: vi.fn(),
  }),
}))
vi.mock('../AgentCard', () => ({ AgentCard: () => null }))
vi.mock('../SubscriptionCard', async () => {
  const { createElement } = await import('react')
  return { SubscriptionCard: () => createElement('div', null, 'card-abonament') }
})
vi.mock('../../../hooks/useCodviaOrdersOpen', () => ({
  useCodviaOrdersOpen: () => codvia.open,
}))

import HomeTab from '../HomeTab'
import { surfaceFor } from '../../../lib/__tests__/planSurfaceFixtures'
import { planUpsellTarget, type PlanSurface } from '../../../lib/planSurface'

type Props = ComponentProps<typeof HomeTab>

// Planul, ca în DashboardPage: suprafața + ținta upsell-ului pe o piață fiscală.
function plan(p: 'starter' | 'growth' | 'pro' | null): Pick<Props, 'surface' | 'upsell'> {
  const surface: PlanSurface | null = p == null ? null : surfaceFor(p)
  return { surface, upsell: planUpsellTarget(surface, { fiscalMarket: true }) }
}

function renderHome(over: Partial<Props> = {}) {
  const props: Props = {
    restaurantId: 'r1',
    restaurantName: 'Bistro Test',
    ...plan('starter'),
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
  return render(<HomeTab {...props} />)
}

// Valoarea unei metrici = elementul de după eticheta ei (MetricCard).
function metric(label: string): HTMLElement {
  const el = screen.getByText(label).nextElementSibling
  if (!(el instanceof HTMLElement)) throw new Error(`metrica ${label} lipsește`)
  return el
}

// Upsell-ul vechi (scos în lotul P) — nu are voie să revină.
const OLD_UPSELL = 'Vrei să primești comenzi direct de la masă?'
// PlanUpsellCard e un <section aria-label="Ofertă: …"> → rol „region".
const upsellRegion = () => screen.queryByRole('region', { name: /^Ofertă:/ })
const FISCAL = /\bTVA\b|bon(ul|uri)? fiscal|cas[aă] de marcat|Bridge fiscal|Fiscalizare activ/i

beforeEach(() => {
  codvia.open = null
  bridge.status = null
  failing.clear()
  for (const k of Object.keys(counts)) delete counts[k]
  Object.assign(counts, {
    tables: 4,
    categories: 2,
    orders: 3,
    restaurant_memberships: 3,
  })
  // „Verifică meniul public" e singurul pas fără DB (localStorage per restaurant).
  localStorage.setItem('menuvia.menu_checked.r1', '1')
})

describe('HomeTab — planul necunoscut și citirile eșuate', () => {
  it('HT1: plan necunoscut → fără „totul e gata", fără upsell, fără checklist', async () => {
    renderHome(plan(null))
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(metric('Setup')).toHaveTextContent('…')
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
    expect(upsellRegion()).toBeNull()
    expect(screen.queryByText('Setup restaurant')).toBeNull()
    // Nici cifrele de comenzi (Plan 2+) nu se pretind cunoscute.
    expect(screen.queryByText('Comenzi azi')).toBeNull()
  })

  it('HT2: control pozitiv — plan 2 cunoscut, totul făcut → „totul e gata ✓"', async () => {
    renderHome(plan('growth'))
    await waitFor(() => expect(screen.getByText('totul e gata ✓')).toBeInTheDocument())
    expect(metric('Setup')).toHaveTextContent('6/6')
    expect(screen.queryByText('Setup restaurant')).toBeNull()
    // Lotul P: pe Planul 2 upsell-ul e „Plata la masă", nu cel de Planul 1.
    expect(screen.queryByText(OLD_UPSELL)).toBeNull()
    expect(upsellRegion()).toHaveAccessibleName('Ofertă: Plata la masă')
  })

  it('HT3: numărul de produse necunoscut nu devine 0 și nici pas „de făcut"', async () => {
    renderHome({ ...plan('growth'), productCount: null })
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(metric('Produse active')).toHaveTextContent('…')
    expect(
      await screen.findByRole('button', { name: 'Adaugă produse (stare necunoscută)' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
  })

  it('HT4: citirea categoriilor eșuează → pas „stare necunoscută", nu nebifat', async () => {
    failing.add('categories')
    renderHome(plan('growth'))
    // Întâi citirea-soră (mesele, același lot) s-a așezat — deci și cea eșuată a
    // categoriilor. Fără așteptare, pasul era „necunoscut" doar fiindcă nimic nu
    // sosise încă, iar mutația „eroare → 0" trecea testul.
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(
      screen.getByRole('button', { name: 'Creează categorii (stare necunoscută)' }),
    ).toBeInTheDocument()
    // Pașii cunoscuți rămân bifați corect lângă el.
    expect(screen.getByRole('button', { name: 'Adaugă produse (completat)' })).toBeInTheDocument()
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
  })

  it('HT5: control pozitiv — tier 1 CUNOSCUT → upsell-ul apare', async () => {
    renderHome(plan('starter'))
    expect(await screen.findByRole('region', { name: /^Ofertă:/ })).toBeInTheDocument()
    expect(screen.queryByText(OLD_UPSELL)).toBeNull()
  })
})

describe('HomeTab — checklist-ul e singura cale de setup', () => {
  it('HT6: fără „asistentul detaliat"; pasul de mese duce în tab-ul Mese', async () => {
    counts.tables = 0
    const onNavigate = vi.fn()
    renderHome({ ...plan('starter'), onNavigate })
    const step = await screen.findByRole('button', { name: 'Generează QR-uri pentru mese' })
    expect(screen.getByText('Setup restaurant')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /asistentul detaliat/i })).toBeNull()
    expect(screen.queryByText(/Setup Asistent/i)).toBeNull()
    await userEvent.setup().click(step)
    expect(onNavigate).toHaveBeenCalledWith('mese')
  })
})

describe('HomeTab — „Suporturi QR fizice" doar cât magazinul primește comenzi', () => {
  it('HC1: în pauză sau necunoscut → fără acțiune', async () => {
    for (const open of [false, null]) {
      codvia.open = open
      const { unmount } = renderHome(plan('growth'))
      expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
      // Control: celelalte acțiuni sunt acolo.
      expect(screen.getByRole('button', { name: 'Adaugă produs' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Suporturi QR fizice' })).toBeNull()
      unmount()
    }
  })

  it('HC2: deschis → acțiunea apare și deschide magazinul', async () => {
    codvia.open = true
    const onOrderQrStands = vi.fn()
    renderHome({ ...plan('growth'), onOrderQrStands })
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Suporturi QR fizice' }))
    expect(onOrderQrStands).toHaveBeenCalledTimes(1)
  })
})

describe('HomeTab — fiecare rol vede doar ce poate face', () => {
  it('HR1: managerul nu vede abonamentul și nici upsell-ul', async () => {
    renderHome({ ...plan('starter'), isOwner: false })
    expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
    expect(screen.queryByText('card-abonament')).toBeNull()
    expect(upsellRegion()).toBeNull()
    // Editarea rămâne a lui (control): e admin.
    expect(screen.getByRole('button', { name: 'Adaugă produs' })).toBeInTheDocument()
  })

  it('HR2: control pozitiv — proprietarul vede cardul și upsell-ul', async () => {
    renderHome({ ...plan('starter'), isOwner: true })
    expect(await screen.findByText('card-abonament')).toBeInTheDocument()
    expect(upsellRegion()).toBeInTheDocument()
  })

  it('HR3: personalul ne-admin nu primește acțiuni de editare', async () => {
    codvia.open = true
    renderHome({ ...plan('growth'), isAdmin: false, isOwner: false })
    expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vezi meniul public' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă produs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Generează QR-uri' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Suporturi QR fizice' })).toBeNull()
    expect(screen.queryByText('card-abonament')).toBeNull()
  })
})

describe('HomeTab — upsell-ul unic (lotul P)', () => {
  it('HU1: Planul 1 → „Meniu + Comenzi", cu cele trei beneficii, „Vezi planul" duce la planuri', async () => {
    const onPricing = vi.fn()
    renderHome({ ...plan('starter'), onPricing })
    const card = await screen.findByRole('region', { name: /^Ofertă:/ })
    expect(card).toHaveAccessibleName(/Meniu \+ Comenzi/)
    expect(within(card).getByText('Comenzi de la masă, prin QR')).toBeInTheDocument()
    expect(within(card).getByText('Ecran de bucătărie pentru comenzile noi')).toBeInTheDocument()
    expect(within(card).getByText('Comenzi pentru ridicare')).toBeInTheDocument()
    expect(within(card).getAllByRole('listitem')).toHaveLength(3)
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Vezi planul' }))
    expect(onPricing).toHaveBeenCalledTimes(1)
    // UN singur upsell pe pagină.
    expect(screen.getAllByRole('region', { name: /^Ofertă:/ })).toHaveLength(1)
  })

  it('HU2: Planul 2 → „Plata la masă", nu oferta de Planul 1', async () => {
    renderHome(plan('growth'))
    const card = await screen.findByRole('region', { name: /^Ofertă:/ })
    expect(card).toHaveAccessibleName('Ofertă: Plata la masă')
    expect(within(card).getByText('Oaspetele plătește din telefon')).toBeInTheDocument()
    expect(within(card).getByText('Bonul fiscal se emite automat')).toBeInTheDocument()
    expect(within(card).getByText('Încasările și TVA-ul se raportează singure')).toBeInTheDocument()
    expect(screen.queryByText('Comenzi de la masă, prin QR')).toBeNull()
  })

  it('HU3: Planul 3 și planul necunoscut → niciun upsell', async () => {
    for (const p of ['pro', null] as const) {
      const { unmount } = renderHome(plan(p))
      expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
      // Control: zona de abonament e acolo (proprietar), doar oferta lipsește.
      expect(screen.getByText('card-abonament')).toBeInTheDocument()
      expect(upsellRegion()).toBeNull()
      unmount()
    }
  })

  it('HU4: managerul nu vede nicio ofertă, nici pe Planul 1, nici pe Planul 2', async () => {
    for (const p of ['starter', 'growth'] as const) {
      const { unmount } = renderHome({ ...plan(p), isOwner: false })
      expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
      expect(upsellRegion()).toBeNull()
      unmount()
    }
  })
})

describe('HomeTab — nimic fiscal sub Planul 3 (lotul P)', () => {
  it('HF1: Planurile 1 și 2 (manager) — niciun termen fiscal, nici cu casa „deconectată"', async () => {
    bridge.status = { registered: true, connected: false, last_seen_at: null }
    for (const p of ['starter', 'growth'] as const) {
      const { container, unmount } = renderHome({ ...plan(p), isOwner: false })
      expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(container.textContent ?? '').not.toMatch(FISCAL)
      unmount()
    }
  })

  it('HF2: Planul 2 (proprietar) — termenii fiscali doar în interiorul ofertei', async () => {
    const { container } = renderHome(plan('growth'))
    const card = await screen.findByRole('region', { name: /^Ofertă:/ })
    expect(card.textContent ?? '').toMatch(FISCAL)
    const outside = (container.textContent ?? '').replace(card.textContent ?? '', '')
    expect(outside).not.toMatch(FISCAL)
  })

  it('HF3: control pozitiv — pe Planul 3, cu casa deconectată, banner-ul fiscal apare', async () => {
    bridge.status = { registered: true, connected: false, last_seen_at: null }
    renderHome(plan('pro'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Fiscalizare activă/)
  })
})
