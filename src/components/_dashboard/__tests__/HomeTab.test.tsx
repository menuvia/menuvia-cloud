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
//        Mutația care pică: `(categoriesCount ?? 0) > 0`.
//   HT5  control pozitiv pentru HT1: tier 1 CUNOSCUT → upsell-ul apare
//   HC1  magazinul Codvia în pauză (`false`) sau necunoscut (`null`) → fără
//        acțiunea „Suporturi QR fizice" (ux-owner-codvia-quick-action, D4)
//        Mutația care pică: acțiunea randată necondiționat (codul vechi).
//   HC2  control pozitiv: `true` → acțiunea apare și deschide magazinul
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

const { failing, counts, codvia } = vi.hoisted(() => ({
  failing: new Set<string>(),
  counts: {} as Record<string, number>,
  codvia: { open: null as boolean | null },
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
}))
vi.mock('../../../hooks/useBridgeConnected', () => ({
  useBridgeConnected: () => ({ status: null, loading: false, reload: vi.fn() }),
}))
vi.mock('../AgentCard', () => ({ AgentCard: () => null }))
vi.mock('../SubscriptionCard', () => ({ SubscriptionCard: () => null }))
vi.mock('../../../hooks/useCodviaOrdersOpen', () => ({
  useCodviaOrdersOpen: () => codvia.open,
}))

import HomeTab from '../HomeTab'

type Props = ComponentProps<typeof HomeTab>

function renderHome(over: Partial<Props> = {}) {
  const props: Props = {
    restaurantId: 'r1',
    restaurantName: 'Bistro Test',
    tier: 1,
    isAdmin: true,
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

const UPSELL = 'Vrei să primești comenzi direct de la masă?'

beforeEach(() => {
  codvia.open = null
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
    renderHome({ tier: null })
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(metric('Setup')).toHaveTextContent('…')
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
    expect(screen.queryByText(UPSELL)).toBeNull()
    expect(screen.queryByText('Setup restaurant')).toBeNull()
    // Nici cifrele de comenzi (Plan 2+) nu se pretind cunoscute.
    expect(screen.queryByText('Comenzi azi')).toBeNull()
  })

  it('HT2: control pozitiv — plan 2 cunoscut, totul făcut → „totul e gata ✓"', async () => {
    renderHome({ tier: 2 })
    await waitFor(() => expect(screen.getByText('totul e gata ✓')).toBeInTheDocument())
    expect(metric('Setup')).toHaveTextContent('6/6')
    expect(screen.queryByText('Setup restaurant')).toBeNull()
    expect(screen.queryByText(UPSELL)).toBeNull()
  })

  it('HT3: numărul de produse necunoscut nu devine 0 și nici pas „de făcut"', async () => {
    renderHome({ tier: 2, productCount: null })
    await waitFor(() => expect(metric('QR-uri active')).toHaveTextContent('4'))
    expect(metric('Produse active')).toHaveTextContent('…')
    expect(
      await screen.findByRole('button', { name: 'Adaugă produse (stare necunoscută)' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
  })

  it('HT4: citirea categoriilor eșuează → pas „stare necunoscută", nu nebifat', async () => {
    failing.add('categories')
    renderHome({ tier: 2 })
    expect(
      await screen.findByRole('button', { name: 'Creează categorii (stare necunoscută)' }),
    ).toBeInTheDocument()
    // Pașii cunoscuți rămân bifați corect lângă el.
    expect(screen.getByRole('button', { name: 'Adaugă produse (completat)' })).toBeInTheDocument()
    expect(screen.queryByText('totul e gata ✓')).toBeNull()
  })

  it('HT5: control pozitiv — tier 1 CUNOSCUT → upsell-ul apare', async () => {
    renderHome({ tier: 1 })
    expect(await screen.findByText(UPSELL)).toBeInTheDocument()
  })
})

describe('HomeTab — „Suporturi QR fizice" doar cât magazinul primește comenzi', () => {
  it('HC1: în pauză sau necunoscut → fără acțiune', async () => {
    for (const open of [false, null]) {
      codvia.open = open
      const { unmount } = renderHome({ tier: 2 })
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
    renderHome({ tier: 2, onOrderQrStands })
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Suporturi QR fizice' }))
    expect(onOrderQrStands).toHaveBeenCalledTimes(1)
  })
})
