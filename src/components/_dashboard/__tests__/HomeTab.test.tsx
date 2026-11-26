// HomeTab („Acasă") nu afirmă nimic despre plan când NU îl știe (perf-staff-3)
// și nu transformă un număr necunoscut în „0" sau în pas „de făcut"
// (code-health-error-ignored-guards).
//
//   HT1  plan NECUNOSCUT (tier null), pașii de tier 1 toți făcuți: fără
//        upsell, fără checklist și (lotul C1) fără metrica „Configurare”.
//        Mutația care pică: codul vechi (tier 1 implicit) — cardul „Vrei să
//        primești comenzi…" pentru un plătitor.
//   HT2  control pozitiv: plan 2 CUNOSCUT, toți pașii făcuți → cardul de
//        configurare lipsește, iar acțiunile rapide ale pașilor sunt toate pe
//        pagină (lotul C1: „totul e gata ✓” era metrica scoasă).
//   HT3  productCount necunoscut (null): „Produse în meniu" = „…", pasul „Adaugă
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
//   HR1  MANAGERUL (admin, nu proprietar): fără upsell — n-are ce cumpăra.
//        Mutația care pică: `{isAdmin && (` înapoi pe upsell.
//   HR2  control pozitiv: PROPRIETARUL vede upsell-ul (tier 1). Lotul R2: cardul
//        „Abonament & facturare" s-a MUTAT în Setări → Abonament & cont (ținut
//        acolo de SettingsTabPlan SA1/SA2), deci pe Acasă nu mai apare pentru
//        nimeni — HR2 cere acum ABSENȚA lui (o a doua copie ar fi exact
//        dublura pe care lotul o scoate). Mutația care pică: cardul readus pe Acasă.
//   HR3  personalul NE-admin: fără acțiunile de editare („Adaugă produse",
//        „Generează QR-uri…", „Suporturi QR fizice"); „Vezi meniul public"
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

const { failing, counts, codvia, bridge, rows, rpcState, gteCalls, held } = vi.hoisted(() => ({
  failing: new Set<string>(),
  counts: {} as Record<string, number>,
  // Lotul D: rândurile întoarse pe `${tabel}:${coloane}` (ex. „orders:table_id"),
  // ca cele patru citiri din `orders` să se poată distinge.
  rows: {} as Record<string, unknown[]>,
  // Lotul O7c: fiecare `.gte(col, valoare)`, ca testul să vadă granița de „azi"
  // cu care a plecat FIECARE citire (HO3), și numărul lor (HO5).
  gteCalls: [] as Array<{ table: string; col: string; value: unknown }>,
  // Ține rezultatul citirii `${tabel}:${coloane}` până se rezolvă `gate` — ca
  // testul să vadă ecranul cât o reîmprospătare e ÎN ZBOR (HO5). Implicit oprit.
  // `all` ține TOATE citirile (lotul C1, HK6–HK8: o vizită pe Acasă cu rețea lentă).
  held: { key: '', gate: null as Promise<void> | null, all: null as Promise<void> | null },
  rpcState: { calls: 0, results: [] as Array<{ data: unknown; error: unknown }> },
  codvia: { open: null as boolean | null },
  // Starea casei pe care ar întoarce-o RPC-ul; hook-ul o dă DOAR când HomeTab
  // o cere (`enabled`) — exact gate-ul pe care îl păzește HF1.
  bridge: {
    status: null as { registered: boolean; connected: boolean; last_seen_at: string | null } | null,
  },
}))

// Builder thenable: `await from(t).select(...).eq(...)…` dă {count, data, error}.
vi.mock('../../../lib/supabase', () => {
  type MockResult = { data: unknown[] | null; count: number | null; error: unknown }
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    let cols = ''
    for (const m of ['eq', 'neq', 'gte', 'gt', 'in', 'not', 'limit', 'order']) {
      b[m] = vi.fn(() => b)
    }
    b.gte = vi.fn((col: string, value: unknown) => {
      gteCalls.push({ table, col, value })
      return b
    })
    b.select = vi.fn((c: string) => {
      cols = c
      return b
    })
    b.then = (onFulfilled: (v: MockResult) => unknown, onRejected?: (e: unknown) => unknown) => {
      const result: MockResult =
        failing.has(table) || failing.has(`${table}:${cols}`)
          ? { data: null, count: null, error: { message: 'boom', code: '500' } }
          : rows[`${table}:${cols}`]
            ? { data: rows[`${table}:${cols}`], count: rows[`${table}:${cols}`].length, error: null }
            : {
              data: (counts[table] ?? 0) > 0 ? [{ id: 'x' }] : [],
              count: counts[table] ?? 0,
              error: null,
            }
      const gate = held.all ?? (held.gate && held.key === `${table}:${cols}` ? held.gate : null)
      return (gate ? gate.then(() => result) : Promise.resolve(result)).then(onFulfilled, onRejected)
    }
    return b
  }
  // `rpc` întoarce, pe rând, rezultatele din `rpcState.results` (ultimul se
  // repetă); implicit o zi fără încasări.
  const rpc = vi.fn(() => {
    const r = rpcState.results[Math.min(rpcState.calls, rpcState.results.length - 1)] ?? {
      data: [],
      error: null,
    }
    rpcState.calls++
    return Promise.resolve(r)
  })
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
import { supabase } from '../../../lib/supabase'
import { clearHomeSetupCache } from '../../../lib/homeSetup'
import { surfaceFor } from '../../../lib/__tests__/planSurfaceFixtures'
import { planUpsellTarget, type PlanSurface } from '../../../lib/planSurface'

type Props = ComponentProps<typeof HomeTab>

// Planul, ca în DashboardPage: suprafața + ținta upsell-ului pe o piață fiscală.
function plan(p: 'starter' | 'growth' | 'pro' | null): Pick<Props, 'surface' | 'upsell'> {
  const surface: PlanSurface | null = p == null ? null : surfaceFor(p)
  return { surface, upsell: planUpsellTarget(surface, { fiscalMarket: true }) }
}

function homeProps(over: Partial<Props> = {}): Props {
  return {
    restaurantId: 'r1',
    restaurantName: 'Bistro Test',
    ...plan('starter'),
    isAdmin: true,
    isOwner: true,
    productCount: 12,
    pickupOnly: false,
    onNavigate: vi.fn(),
    onViewMenu: vi.fn(),
    onViewOrders: vi.fn(),
    onPricing: vi.fn(),
    onOrderQrStands: vi.fn(),
    ...over,
  }
}

function renderHome(over: Partial<Props> = {}) {
  return render(<HomeTab {...homeProps(over)} />)
}

// Valoarea unei metrici = elementul de după eticheta ei (MetricCard).
function metric(label: string): HTMLElement {
  const el = screen.getByText(label).nextElementSibling
  if (!(el instanceof HTMLElement)) throw new Error(`metrica ${label} lipsește`)
  return el
}

// Revenirea în pagină (ca în HD8): fiecare test care o folosește o declară
// singur — `visibilityState` e redefinit global, deci nu depindem de ordinea testelor.
function returnToPage(): void {
  act(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

// Granițele „de azi" cu care au plecat citirile „Comenzi azi", în ordine.
function createdAtBounds(): unknown[] {
  return gteCalls.filter((c) => c.table === 'orders' && c.col === 'created_at').map((c) => c.value)
}
// Granițele bacșișului de azi (`paid_at`), în ordine.
function paidAtBounds(): unknown[] {
  return gteCalls.filter((c) => c.table === 'orders' && c.col === 'paid_at').map((c) => c.value)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void = () => undefined
  const promise = new Promise<void>((r) => {
    release = () => r()
  })
  return { promise, resolve: () => release() }
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
  for (const k of Object.keys(rows)) delete rows[k]
  rpcState.calls = 0
  rpcState.results = []
  gteCalls.length = 0
  held.key = ''
  held.gate = null
  held.all = null
  // Lotul C1: cache-ul citirilor de setup e la nivel de MODUL, iar toate testele
  // folosesc restaurantul `r1` — fără golire, un test ar porni din cifrele altuia.
  clearHomeSetupCache()
  for (const k of Object.keys(counts)) delete counts[k]
  Object.assign(counts, {
    tables: 4,
    categories: 2,
    orders: 3,
    restaurant_memberships: 3,
  })
  // „Vezi meniul public" e singurul pas fără DB (localStorage per restaurant).
  localStorage.setItem('menuvia.menu_checked.r1', '1')
})

// Acțiunile rapide care repetă un pas (lotul C1): apar abia când pasul e făcut.
// Toate patru pe pagină = setup-ul s-a așezat și e complet.
const STEP_QUICK_ACTIONS = [
  'Adaugă produse',
  'Generează QR-uri pentru mese',
  'Vezi meniul public',
  'Invită echipa',
] as const

describe('HomeTab — planul necunoscut și citirile eșuate', () => {
  it('HT1: plan necunoscut → fără upsell, fără checklist, fără metrica „Configurare"', async () => {
    renderHome(plan(null))
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(screen.queryByText('Configurare')).toBeNull()
    expect(upsellRegion()).toBeNull()
    expect(screen.queryByText('Configurare restaurant')).toBeNull()
    // Nici cifrele de comenzi (Plan 2+) nu se pretind cunoscute.
    expect(screen.queryByText('Comenzi azi')).toBeNull()
  })

  it('HT2: control pozitiv — plan 2 cunoscut, totul făcut → fără card, toate acțiunile', async () => {
    renderHome(plan('growth'))
    for (const name of STEP_QUICK_ACTIONS) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByText('Configurare restaurant')).toBeNull()
    expect(screen.queryByText('Configurare')).toBeNull()
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
    // Lotul P: pe Planul 2 upsell-ul e „Plata la masă", nu cel de Planul 1.
    expect(screen.queryByText(OLD_UPSELL)).toBeNull()
    expect(upsellRegion()).toHaveAccessibleName('Ofertă: Plata la masă')
  })

  it('HT3: numărul de produse necunoscut nu devine 0 și nici pas „de făcut"', async () => {
    renderHome({ ...plan('growth'), productCount: null })
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(metric('Produse în meniu')).toHaveTextContent('…')
    expect(
      await screen.findByRole('button', { name: 'Adaugă produse (stare necunoscută)' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Configurare restaurant')).toBeInTheDocument()
  })

  it('HT4: citirea categoriilor eșuează → pas „stare necunoscută", nu nebifat', async () => {
    failing.add('categories')
    renderHome(plan('growth'))
    // Întâi citirea-soră (mesele, același lot) s-a așezat — deci și cea eșuată a
    // categoriilor. Fără așteptare, pasul era „necunoscut" doar fiindcă nimic nu
    // sosise încă, iar mutația „eroare → 0" trecea testul. Lotul C1: un pas
    // necunoscut DUPĂ o citire eșuată nu mai e „în zbor", deci cardul apare.
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(
      await screen.findByRole('button', { name: 'Creează categorii (stare necunoscută)' }),
    ).toBeInTheDocument()
    // Pașii cunoscuți rămân bifați corect lângă el.
    expect(screen.getByRole('button', { name: 'Adaugă produse (completat)' })).toBeInTheDocument()
    expect(screen.getByText('Configurare restaurant')).toBeInTheDocument()
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
    expect(screen.getByText('Configurare restaurant')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /asistentul detaliat/i })).toBeNull()
    expect(screen.queryByText(/Setup Asistent|Asistentul de configurare/i)).toBeNull()
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
      expect(screen.getByRole('button', { name: 'Adaugă produse' })).toBeInTheDocument()
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
  it('HR1: managerul nu vede upsell-ul', async () => {
    renderHome({ ...plan('starter'), isOwner: false })
    expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
    expect(screen.queryByText('card-abonament')).toBeNull()
    expect(upsellRegion()).toBeNull()
    // Editarea rămâne a lui (control): e admin.
    expect(screen.getByRole('button', { name: 'Adaugă produse' })).toBeInTheDocument()
  })

  it('HR2: control pozitiv — proprietarul vede upsell-ul; abonamentul e în Setări', async () => {
    renderHome({ ...plan('starter'), isOwner: true })
    expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
    expect(upsellRegion()).toBeInTheDocument()
    expect(screen.queryByText('card-abonament')).toBeNull()
    expect(document.getElementById('billing-card')).toBeNull()
  })

  it('HR3: personalul ne-admin nu primește acțiuni de editare', async () => {
    codvia.open = true
    renderHome({ ...plan('growth'), isAdmin: false, isOwner: false })
    expect(await screen.findByText('Acțiuni rapide')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vezi meniul public' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă produse' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Generează QR-uri/ })).toBeNull()
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
      // Cardul de abonament s-a mutat în Setări → Abonament & cont (lotul R2,
      // #335); controlul pozitiv al ofertei pe același drum de randare e HU1.
      expect(screen.queryByText('card-abonament')).toBeNull()
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

// ─── Lotul D: cifrele de acum/azi ──────────────────────────────────────────
//   HD1  Planul 2: „Mese ocupate acum" = mese DISTINCTE cu comenzi deschise,
//        din totalul de mese; fără bani. Mutația care pică: numărarea
//        rândurilor în loc de mese distincte (3/4 în loc de 2/4).
//   HD2  Planul 3 (admin): „Încasări azi" din get_daily_payments_by_method
//        (aceeași sursă ca Rapoartele) și „Bacșiș azi" din tips_amount, pe
//        cenți. Mutația care pică: bacșișul adunat în încasări.
//   HD3  Planul 3, personal NE-admin, și Planul 1: fără cifrele de bani /
//        de mese. Mutația care pică: `showMoney` fără `isAdmin`.
//   HD4  citire eșuată → „—" + „Reîncearcă" (nu „…" la nesfârșit, nu „0");
//        reîncercarea reface citirea. Mutația care pică: eroarea tratată ca 0.
//   HD5  modul „doar ridicare": fără „Mese ocupate acum".
//   HD6  citirea meselor active (numitorul) eșuează → „—" + „Reîncearcă", nu
//        „…" la nesfârșit. Mutația care pică: numitorul luat din `tablesCount`.
//   HD7  peste plafonul de rânduri cifra e necunoscută („—"), nu parțială.
//        Mutația care pică: `.limit(1000)` fără detectarea depășirii.
//   HD8  revenirea în pagină reface citirile (zi nouă, comenzi noi), fără să
//        golească cifrele între timp. Mutația care pică: fără `visibilitychange`.
describe('HomeTab — cifrele zilei (lotul D)', () => {
  it('HD1 Planul 2: mese ocupate distincte, fără bani', async () => {
    rows['tables:id'] = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    // t9 e o masă DEZACTIVATĂ cu o comandă rămasă deschisă: nu se numără
    // (recenzie #342 — altfel numărătorul putea depăși numitorul).
    rows['orders:table_id'] = [{ table_id: 't1' }, { table_id: 't1' }, { table_id: 't2' }, { table_id: 't9' }]
    renderHome({ ...plan('growth'), isOwner: false })
    await waitFor(() => expect(metric('Mese ocupate acum')).toHaveTextContent('2/4'))
    expect(screen.queryByText('Încasări azi')).toBeNull()
    expect(screen.queryByText('Bacșiș azi')).toBeNull()
  })

  it('HD2 Planul 3 (admin): încasări și bacșiș azi, separat', async () => {
    rpcState.results = [{ data: [{ day: '2026-11-03', total_revenue: '150.50' }], error: null }]
    rows['orders:tips_amount'] = [{ tips_amount: '5.10' }, { tips_amount: 2 }]
    renderHome(plan('pro'))
    await waitFor(() => expect(metric('Încasări azi')).toHaveTextContent('150.50 lei'))
    await waitFor(() => expect(metric('Bacșiș azi')).toHaveTextContent('7.10 lei'))
  })

  it('HD3 personalul ne-admin pe Planul 3 și Planul 1 nu văd cifrele noi', async () => {
    const { unmount } = renderHome({ ...plan('pro'), isAdmin: false, isOwner: false })
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(screen.queryByText('Încasări azi')).toBeNull()
    expect(screen.queryByText('Bacșiș azi')).toBeNull()
    unmount()
    renderHome(plan('starter'))
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(screen.queryByText('Mese ocupate acum')).toBeNull()
    expect(screen.queryByText('Încasări azi')).toBeNull()
  })

  it('HD4 citirea eșuată arată „—" și se poate reîncerca', async () => {
    const user = userEvent.setup()
    rpcState.results = [
      { data: null, error: { message: 'boom', code: '500' } },
      { data: [{ total_revenue: 42 }], error: null },
    ]
    renderHome(plan('pro'))
    await waitFor(() => expect(metric('Încasări azi')).toHaveTextContent('—'))
    expect(metric('Încasări azi')).not.toHaveTextContent('0')
    await user.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    await waitFor(() => expect(metric('Încasări azi')).toHaveTextContent('42.00 lei'))
    expect(screen.queryByRole('button', { name: 'Reîncearcă' })).toBeNull()
  })

  it('HD5 „doar ridicare": fără mese ocupate', async () => {
    renderHome({ ...plan('growth'), pickupOnly: true })
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('1'))
    expect(screen.queryByText('Mese ocupate acum')).toBeNull()
  })

  it('HD6 numitorul eșuat: „—" și „Reîncearcă"', async () => {
    failing.add('tables:id')
    renderHome({ ...plan('growth'), isOwner: false })
    await waitFor(() => expect(metric('Mese ocupate acum')).toHaveTextContent('—'))
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
  })

  it('HD7 peste plafonul de rânduri: necunoscut, nu parțial', async () => {
    rows['tables:id'] = [{ id: 't1' }]
    rows['orders:table_id'] = Array.from({ length: 501 }, () => ({ table_id: 't1' }))
    rows['orders:tips_amount'] = Array.from({ length: 501 }, () => ({ tips_amount: 1 }))
    renderHome(plan('pro'))
    await waitFor(() => expect(metric('Mese ocupate acum')).toHaveTextContent('—'))
    await waitFor(() => expect(metric('Bacșiș azi')).toHaveTextContent('—'))
  })

  it('HD8 revenirea în pagină reface citirile', async () => {
    rpcState.results = [
      { data: [{ total_revenue: 10 }], error: null },
      { data: [{ total_revenue: 25 }], error: null },
    ]
    renderHome(plan('pro'))
    await waitFor(() => expect(metric('Încasări azi')).toHaveTextContent('10.00 lei'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(metric('Încasări azi')).toHaveTextContent('25.00 lei'))
  })
})

// ─── Lotul O7c: „Comenzi azi" se reîmprospătează ca restul cifrelor ─────────
// Cifra era citită O SINGURĂ dată, la montare (efectul de setup, fără
// `reloadKey`): cu Acasă lăsată deschisă rămânea înghețată, după miezul nopții
// arăta ziua de ieri, iar o citire eșuată rămânea „…" fără „Reîncearcă".
//   HO1  Planul 2: revenirea în pagină aduce cifra nouă (3 → 7). Control
//        pozitiv: întâi 3, citit din mock. Mutația care pică: citirea lăsată în
//        efectul `[restaurantId, hasOrdering, isAdmin]` (rămâne 3).
//   HO2  Planul 2 „doar ridicare" (fără mese ocupate, fără bani): cifra apare și
//        se reîmprospătează. Mutațiile care pică: gate-ul efectului de citire
//        lăsat pe `!showOccupancy && !showMoney` (rămâne „…"), și gate-ul
//        ascultătorului lăsat așa (fără reîmprospătare, rămâne 3).
//   HO3  după miezul nopții (ora României) citirea pleacă cu granița ZILEI NOI.
//        Mutațiile care pică: codul vechi (nicio a doua citire) și `todayStart`
//        calculat o dată, la montare (a doua citire poartă granița de ieri).
//   HO4  citirea eșuată → „—" + „nu s-a putut încărca" + „Reîncearcă", care o
//        reface. Mutațiile care pică: eroarea fără `fail('orders')` („…", fără
//        banner), eroarea tratată ca 0, și „Reîncearcă" pe o cheie de care
//        citirea nu depinde (rămâne „—").
//   HO5  cât reîmprospătarea e ÎN ZBOR, cifra veche rămâne și cardul de
//        configurare NU reapare la un local configurat. Mutațiile care pică:
//        fix-ul naiv (`reloadKey` adăugat efectului de setup, care golește
//        pașii la „…") și `setOrdersToday(null)` la începutul efectului de citire.
//        (Remontarea — fiecare revenire pe Acasă — e acoperită de HK6–HK8.)
//   HO6  prima comandă de azi, sosită cu Acasă deschisă, bifează și pasul „Prima
//        comandă de test" (recenzia O7c): `everOrdered` e citit o singură dată,
//        dar „Comenzi azi" se reîmprospătează — fără derivare ecranul arăta
//        „Comenzi azi: 7" lângă pasul încă de făcut. Echipa rămâne nefăcută, ca
//        să rămână cardul (la 6/6 dispare). Control pozitiv: întâi „0" și pasul
//        nebifat (4/6, din progresul cardului — lotul C1 a scos metrica
//        „Configurare"). Mutația care pică: pasul lăsat pe `done: everOrdered`.
//   HO7  lotul G2b: cu `timeZone` = America/New_York, „azi” e ziua LOCALULUI —
//        la 4 nov 03:30Z (22:30 pe 3 la New York) granița e 3 nov 05:00Z, iar
//        după miezul nopții de acolo (4 nov 05:10Z) trece pe 4 nov 05:00Z.
//        Mutația care pică: `timeZone` ignorat (ar da 3 nov 22:00Z, ziua
//        Bucureștiului). HO3 rămâne controlul RO, prin implicit.
//   HO8  ecranul MIXT are UN singur „azi”: pe Planul 3 (admin) cu fusul New
//        York (combinație imposibilă în producție — banii sunt doar pe un local
//        românesc, deci pe București —, aleasă DELIBERAT: pe București testul
//        ar trece și cu bug-ul), încasările cer `p_from = p_to = '2026-11-04'`
//        și granițele `created_at`/`paid_at` sunt AMBELE 4 nov 05:00Z. Mutația
//        care pică: banii lăsați pe ziua României (`'2026-11-05'`).
describe('HomeTab — «Comenzi azi» se reîmprospătează', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('HO1 Planul 2: revenirea în pagină aduce cifra nouă', async () => {
    renderHome({ ...plan('growth'), isOwner: false })
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^3$/))
    counts.orders = 7
    returnToPage()
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^7$/))
  })

  it('HO2 „doar ridicare": cifra apare și se reîmprospătează', async () => {
    renderHome({ ...plan('growth'), pickupOnly: true })
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^3$/))
    // Modul fără mese: niciuna dintre celelalte cifre reîmprospătate nu e pe pagină.
    expect(screen.queryByText('Mese ocupate acum')).toBeNull()
    expect(screen.queryByText('Încasări azi')).toBeNull()
    counts.orders = 7
    returnToPage()
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^7$/))
  })

  it('HO3 după miezul nopții citirea pleacă cu granița zilei noi', async () => {
    // Doar Date e fals: waitFor are nevoie de setTimeout real (ca BridgeTab.test).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-04T21:50:00Z')) // 23:50 EET, 4 noiembrie
    renderHome({ ...plan('growth'), isOwner: false })
    await waitFor(() => expect(createdAtBounds()[0]).toBe('2026-11-03T22:00:00.000Z'))
    vi.setSystemTime(new Date('2026-11-04T22:10:00Z')) // 00:10 EET, 5 noiembrie
    returnToPage()
    await waitFor(() =>
      expect(createdAtBounds().slice(-1)[0]).toBe('2026-11-04T22:00:00.000Z'),
    )
  })

  it('HO7 fusul zilei de raportare: granița e miezul nopții LOCALULUI', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-04T03:30:00Z')) // 22:30 pe 3 nov la New York
    renderHome({ ...plan('growth'), isOwner: false, timeZone: 'America/New_York' })
    await waitFor(() => expect(createdAtBounds()[0]).toBe('2026-11-03T05:00:00.000Z'))
    vi.setSystemTime(new Date('2026-11-04T05:10:00Z')) // 00:10 pe 4 nov la New York
    returnToPage()
    await waitFor(() =>
      expect(createdAtBounds().slice(-1)[0]).toBe('2026-11-04T05:00:00.000Z'),
    )
  })

  it('HO8 ecranul mixt: comenzile, încasările și bacșișul pe aceeași zi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T03:30:00Z')) // 22:30 pe 4 nov la New York
    vi.mocked(supabase.rpc).mockClear()
    const rpcCalls = (): unknown[][] => vi.mocked(supabase.rpc).mock.calls as unknown[][]
    renderHome({ ...plan('pro'), timeZone: 'America/New_York' })
    await waitFor(() => expect(rpcCalls().length).toBeGreaterThan(0))
    const call = rpcCalls().find((c) => c[0] === 'get_daily_payments_by_method')
    expect(call?.[1]).toEqual({ p_restaurant_id: 'r1', p_from: '2026-11-04', p_to: '2026-11-04' })
    await waitFor(() => expect(paidAtBounds()[0]).toBe('2026-11-04T05:00:00.000Z'))
    expect(createdAtBounds()[0]).toBe('2026-11-04T05:00:00.000Z')
  })

  it('HO4 citirea eșuată arată „—" și se poate reîncerca', async () => {
    const user = userEvent.setup()
    failing.add('orders:id')
    renderHome({ ...plan('growth'), isOwner: false })
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent('—'))
    expect(metric('Comenzi azi')).not.toHaveTextContent('0')
    expect(screen.getByText('nu s-a putut încărca')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    failing.delete('orders:id')
    await user.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^3$/))
    expect(screen.queryByRole('button', { name: 'Reîncearcă' })).toBeNull()
  })

  it('HO5 în timpul reîmprospătării: cifra veche rămâne, configurarea nu reapare', async () => {
    renderHome(plan('growth'))
    // Lotul C1: „setup complet" = acțiunea rapidă a ultimului pas e pe pagină
    // (apare doar cu pasul făcut), fostul „totul e gata ✓" fiind metrica scoasă.
    expect(await screen.findByRole('button', { name: 'Invită echipa' })).toBeInTheDocument()
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^3$/))
    const d = deferred()
    held.key = 'orders:id'
    held.gate = d.promise
    counts.orders = 7
    const n = createdAtBounds().length
    returnToPage()
    // Citirea de reîmprospătare a plecat și e ținută în zbor.
    await waitFor(() => expect(createdAtBounds().length).toBe(n + 1))
    expect(metric('Comenzi azi')).toHaveTextContent(/^3$/)
    expect(screen.getByRole('button', { name: 'Invită echipa' })).toBeInTheDocument()
    expect(screen.queryByText('Configurare restaurant')).toBeNull()
    d.resolve()
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^7$/))
  })

  it('HO6 prima comandă sosită cu Acasă deschisă bifează pasul de test', async () => {
    const STEP = 'Prima comandă de test — deschide QR-ul unei mese și comandă'
    counts.orders = 0
    counts.restaurant_memberships = 1
    renderHome(plan('growth'))
    // Control pozitiv: zero comenzi → pasul e „de făcut" (nu „necunoscut").
    expect(await screen.findByRole('button', { name: STEP })).toBeInTheDocument()
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^0$/))
    // Progresul se citește din card (lotul C1: metrica „Configurare" a ieșit).
    expect(screen.getByText('4/6 pași completați')).toBeInTheDocument()
    counts.orders = 7
    returnToPage()
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^7$/))
    expect(await screen.findByRole('button', { name: `${STEP} (completat)` })).toBeInTheDocument()
    expect(screen.getByText('5/6 pași completați')).toBeInTheDocument()
    expect(screen.getByText('Configurare restaurant')).toBeInTheDocument()
  })
})

// ─── Lotul C1: pași adevărați și o singură listă ───────────────────────────
//   HK1  categoriile sunt PRIMUL pas, înaintea produselor (un produs fără
//        categorie nu apare oaspeților), iar cu 0 produse în meniu — ce dă
//        `countMenuProducts` pentru 3 produse „Fără categorie" (HV1) — pasul
//        „Adaugă produse" rămâne de făcut și NU se repetă ca acțiune rapidă.
//        Mutațiile care pică: ordinea veche (produse, apoi categorii) și
//        acțiunea rapidă randată fără `!stepOnCard('products')` (două butoane).
//   HK2  „Vezi comenzile" și cifra „Comenzi azi" (acum buton) deschid DIRECT
//        comenzile (`onViewOrders`), nu fila-hub `comenzi`. Mutațiile care pică:
//        `onNavigate(LIVE_ORDERS_TAB)` readus; cifra lăsată ne-buton.
//   HK3  gate-ul e `planSurface.staff`, ca butonul din bara laterală, nu
//        `ordering`: pe o suprafață cu comenzi dar fără echipă, nici acțiunea,
//        nici cifra-buton. Mutația care pică: gate-ul vechi `hasOrdering`.
//        Control pozitiv: HK2.
//   HK4  o singură listă: cât cardul e pe pagină, pașii NEFĂCUȚI nu se repetă
//        în „Acțiuni rapide", cei făcuți rămân, cu ACELEAȘI cuvinte; fără
//        metrica „Configurare" și fără vechiul „Invită ospătar". Mutațiile care
//        pică: acțiunile randate necondiționat; metrica readusă.
//   HK5  „doar ridicare": pasul „Prima comandă de test — deschide meniul public…"
//        deschide meniul public, nu fila Mese; acțiunea rapidă a QR-urilor e
//        „Generează QR-uri" (fără „pentru mese"). Mutația care pică: pasul cu
//        `target: 'mese'` (codul vechi).
//   HK6  un local CONFIGURAT, cu citirile ținute în zbor: cardul de configurare
//        NU apare nicio clipă (MutationObserver: un nod adăugat rămâne în
//        înregistrare chiar dacă e scos imediat). Mutația care pică: cardul
//        randat pe `!setupComplete` fără `!setupWaiting` (codul vechi — clipea
//        la fiecare revenire pe Acasă).
//   HK7  control pozitiv pentru HK6: cu un pas de făcut, cardul apare după ce
//        citirile se așază, iar observatorul îl vede (HK6 nu e vacuu).
//   HK8  a doua vizită în sesiune pornește din cache: cu citirile noi ținute în
//        zbor, acțiunile pașilor făcuți și „QR-uri active" sunt deja pe ecran,
//        fără card. Mutația care pică: stările pornite de la `null` (fără
//        `readHomeSetup`).
//   HK9  numărul de produse ÎN ZBOR (`productCountLoading`) ține cardul ascuns;
//        sosit, nu-l mai aprinde. Mutația care pică: `loading` al pasului de
//        produse fixat pe `false` (cardul apare cu „stare necunoscută"). HT3 e
//        controlul pozitiv: null DUPĂ citire (eșuată) = pasul „necunoscut".

// Ține minte dacă textul cardului a intrat VREODATĂ în DOM: înregistrarea unui
// MutationObserver păstrează nodul adăugat chiar dacă React îl scoate imediat.
function watchSetupCard(): { seen: () => boolean; stop: () => void } {
  let seen = false
  const check = (n: Node): void => {
    if (!seen && (n.textContent ?? '').includes('Configurare restaurant')) seen = true
  }
  const observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(check)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return {
    seen: () => {
      for (const r of observer.takeRecords()) r.addedNodes.forEach(check)
      return seen
    },
    stop: () => observer.disconnect(),
  }
}

// Lasă să ruleze efectele și microtask-urile (citirile ținute rămân în zbor).
async function settleTicks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('HomeTab — pași adevărați și o singură listă (lotul C1)', () => {
  it('HK1 categoriile primele; 0 produse în meniu → „Adaugă produse" de făcut, o singură dată', async () => {
    renderHome({ ...plan('growth'), productCount: 0 })
    const products = await screen.findByRole('button', { name: 'Adaugă produse' })
    const categories = screen.getByRole('button', { name: 'Creează categorii (completat)' })
    expect(categories.compareDocumentPosition(products) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Adaugă produse' })).toHaveLength(1)
    expect(metric('Produse în meniu')).toHaveTextContent(/^0$/)
  })

  it('HK2 „Vezi comenzile" și cifra „Comenzi azi" deschid direct comenzile', async () => {
    const user = userEvent.setup()
    const onViewOrders = vi.fn()
    const onNavigate = vi.fn()
    renderHome({ ...plan('growth'), onViewOrders, onNavigate })
    await user.click(await screen.findByRole('button', { name: 'Vezi comenzile' }))
    expect(onViewOrders).toHaveBeenCalledTimes(1)
    await user.click(await screen.findByRole('button', { name: 'Comenzi azi: 3. Vezi comenzile' }))
    expect(onViewOrders).toHaveBeenCalledTimes(2)
    expect(onNavigate).not.toHaveBeenCalledWith('comenzi')
  })

  it('HK3 fără echipă pe plan (staff false): nici acțiunea, nici cifra-buton', async () => {
    const noStaff: PlanSurface = { ...surfaceFor('growth'), staff: false }
    renderHome({ surface: noStaff, upsell: null })
    await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^3$/))
    expect(screen.queryByRole('button', { name: 'Vezi comenzile' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Comenzi azi/ })).toBeNull()
  })

  it('HK4 o singură listă: pașii nefăcuți nu se repetă în „Acțiuni rapide"', async () => {
    counts.tables = 0
    counts.restaurant_memberships = 1
    renderHome(plan('growth'))
    expect(await screen.findByText('Configurare restaurant')).toBeInTheDocument()
    // Nefăcute: doar rândul de pe card (același nume, un singur buton).
    expect(screen.getAllByRole('button', { name: 'Generează QR-uri pentru mese' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Invită echipa' })).toHaveLength(1)
    // Făcute: rândul bifat pe card + acțiunea rapidă, cu aceleași cuvinte.
    expect(screen.getByRole('button', { name: 'Adaugă produse (completat)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă produse' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vezi meniul public (completat)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vezi meniul public' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invită ospătar' })).toBeNull()
    expect(screen.queryByText('Configurare')).toBeNull()
  })

  it('HK5 „doar ridicare": comanda de test deschide meniul public, nu fila Mese', async () => {
    counts.orders = 0
    const onNavigate = vi.fn()
    const onViewMenu = vi.fn()
    renderHome({ ...plan('growth'), pickupOnly: true, onNavigate, onViewMenu })
    await userEvent
      .setup()
      .click(
        await screen.findByRole('button', {
          name: 'Prima comandă de test — deschide meniul public și comandă',
        }),
      )
    expect(onViewMenu).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Generează QR-uri' })).toBeInTheDocument()
  })

  it('HK6 local configurat, citiri lente: cardul de configurare nu apare deloc', async () => {
    const d = deferred()
    held.all = d.promise
    const card = watchSetupCard()
    try {
      renderHome(plan('growth'))
      await settleTicks()
      expect(screen.queryByText('Configurare restaurant')).toBeNull()
      d.resolve()
      for (const name of STEP_QUICK_ACTIONS) {
        expect(await screen.findByRole('button', { name })).toBeInTheDocument()
      }
      expect(card.seen()).toBe(false)
    } finally {
      card.stop()
    }
  })

  it('HK7 control pozitiv: cu un pas de făcut, cardul apare după citiri', async () => {
    counts.tables = 0
    const d = deferred()
    held.all = d.promise
    const card = watchSetupCard()
    try {
      renderHome(plan('growth'))
      await settleTicks()
      // Și aici cardul așteaptă citirile (nu apare cu cercuri punctate).
      expect(screen.queryByText('Configurare restaurant')).toBeNull()
      d.resolve()
      expect(await screen.findByText('Configurare restaurant')).toBeInTheDocument()
      expect(card.seen()).toBe(true)
    } finally {
      card.stop()
    }
  })

  it('HK8 a doua vizită pornește din cache: fără așteptare, fără card', async () => {
    const first = renderHome(plan('growth'))
    for (const name of STEP_QUICK_ACTIONS) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
    first.unmount()
    const d = deferred()
    held.all = d.promise
    const card = watchSetupCard()
    try {
      renderHome(plan('growth'))
      // Citirile noi sunt ținute în zbor: ce e pe ecran vine din vizita anterioară.
      for (const name of STEP_QUICK_ACTIONS) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
      expect(metric('QR-uri active')).toHaveTextContent(/^4$/)
      d.resolve()
      await waitFor(() => expect(metric('Comenzi azi')).toHaveTextContent(/^3$/))
      expect(card.seen()).toBe(false)
    } finally {
      card.stop()
    }
  })

  it('HK9 numărul de produse în zbor ține cardul ascuns; sosit, nu-l aprinde', async () => {
    const card = watchSetupCard()
    try {
      const { rerender } = renderHome({
        ...plan('growth'),
        productCount: null,
        productCountLoading: true,
      })
      // Restul citirilor s-au așezat: acțiunile pașilor lor făcuți sunt pe pagină.
      for (const name of ['Generează QR-uri pentru mese', 'Vezi meniul public', 'Invită echipa']) {
        expect(await screen.findByRole('button', { name })).toBeInTheDocument()
      }
      expect(screen.queryByText('Configurare restaurant')).toBeNull()
      rerender(
        <HomeTab {...homeProps({ ...plan('growth'), productCount: 12, productCountLoading: false })} />,
      )
      expect(await screen.findByRole('button', { name: 'Adaugă produse' })).toBeInTheDocument()
      expect(card.seen()).toBe(false)
    } finally {
      card.stop()
    }
  })
})
