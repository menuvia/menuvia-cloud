// Produse pe planul restaurantului (lotul P, nov 2026): un plan inferior nu vede
// nimic din cele superioare. Ce vede planul vine din `planSurface` (matricea
// reală, planSurfaceFixtures).
//
//   PT1  Planul 1: în listă fără badge-ul „TVA x%"; în fișa produsului fără
//        „Cotă TVA", fără „Extras & Pereche" și fără „Rețetă"; cotele nici nu
//        se cer (fetchVatRates nechemat). Mutația care pică: oricare dintre
//        gate-urile `showVat` / `showExtras` / `surface?.stocks` scos.
//   PT2  Planul 2: Extras & Pereche și Rețeta DA, TVA NU (nici badge, nici câmp,
//        nici cerere). Mutația care pică: `vat` derivat din `ordering`.
//   PT3  control pozitiv pe Planul 3: badge-ul TVA, câmpul „Cotă TVA", extras
//        și rețeta apar — pe Planul 3 nu se ascunde nimic.
//   PT4  plan necunoscut (`surface` null): nimic dependent de plan.
//   PT5  recenzia #334: pe Planul 3, ≥ 3 produse active TOATE pe aceeași grupă
//        TVA → o notă de o linie deasupra listei („aceeași grupă TVA (Mâncare
//        11%)…"), cu ieșire spre Setări. Mutația care pică: nota scoasă, sau
//        pragul de 3 produse ignorat.
//   PT6  grupe mixte → fără notă. Mutația care pică: `every` înlocuit cu `some`.
//   PT7  Planul 2, toate pe aceeași grupă → fără notă (nimic despre TVA sub
//        Planul 3). Mutația care pică: nota fără garda `showVat`.
//   PT8  lotul R2: citirea cotelor din fișa produsului EȘUEAZĂ → nu mai rămâne
//        „Se încarcă cotele TVA..." la nesfârșit, ci „Nu am putut încărca
//        cotele TVA." cu „Reîncearcă" (care chiar recitește și arată cotele) și
//        ieșirea „Deschide cotele TVA" spre Setări → Comenzi & plăți (închide
//        fișa). Mutația care pică: starea de eroare scoasă (spinnerul vechi
//        `vatRates.length === 0`), sau „Reîncearcă" fără recitire.
//   PT9  lista de cote e GOALĂ → mesajul „Nu există cote TVA configurate" cu
//        trimiterea la Setări → Comenzi & plăți → Cote TVA, nu spinner.
//        Control: cu cote, grila apare (PT3 + finalul lui PT8).
//   PT8c recenzia #335: fișa MODIFICATĂ + „Deschide cotele TVA" → confirmare;
//        la refuz fișa rămâne deschisă și Setările NU se deschid, la accept da.
//        Control: PT8b (fișa neatinsă) iese direct, fără dialog. Mutația care
//        pică: butonul legat direct la `onOpenVatRates`.
//   PT10 recenzia #336: eroarea de validare („Numele produsului e obligatoriu”,
//        „Prețul nu poate fi negativ”) stă ÎN dialogul `aria-modal`, ca
//        role="alert" — și SUB <ToastProvider>, unde toast-ul vechi pleca în
//        viewport-ul global, în afara modalului (VoiceOver îl ignora). Mutația
//        care pică: validarea trimisă înapoi prin `pmToast` (api.error chemat,
//        nimic în dialog), sau `useToast()` fără `local` pe fișă.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { ToastContext, type ToastApi } from '../ui/useToast'
import userEvent from '@testing-library/user-event'
import type { Product } from '../../hooks/useData'

const { dialog } = vi.hoisted(() => ({
  dialog: { calls: 0, answer: false },
}))
vi.mock('../ui/confirm', () => ({
  confirm: async () => {
    dialog.calls += 1
    return dialog.answer
  },
}))

const { data, vat } = vi.hoisted(() => ({
  data: { products: [] as Product[] },
  // `fail`: câte citiri următoare eșuează; `empty`: restaurant fără cote.
  vat: { calls: 0, fail: 0, empty: false },
}))

vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: data.products,
    loading: false,
    error: null,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    toggleActive: vi.fn(),
    toggleSoldOut: vi.fn(),
    toggleDailySpecial: vi.fn(),
    refetch: vi.fn(),
  }),
  useCategories: () => ({ categories: [], error: null, refetch: vi.fn(), create: vi.fn() }),
}))
vi.mock('../../hooks/usePlanLimits', () => ({
  usePlanLimits: () => ({
    limits: { plan: 'pro', max_products: 2000, max_restaurants: 2, max_tables: 500 },
    loading: false,
    canAddProduct: () => true,
  }),
}))
vi.mock('../../lib/vat', () => ({
  fetchVatRates: async () => {
    vat.calls += 1
    if (vat.fail > 0) {
      vat.fail -= 1
      throw new Error('boom')
    }
    if (vat.empty) return []
    return [
      {
        restaurant_id: 'rest-1',
        vat_group: 1,
        rate_percent: 11,
        label: 'Mâncare',
        description: null,
        is_active: true,
        updated_at: '2026-10-01T10:00:00Z',
      },
    ]
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/ai', () => ({
  generateNutrition: vi.fn(),
  generateProductImage: vi.fn(),
  aiTranslateBatch: vi.fn(),
  isAiConfigError: () => false,
  isAiQuotaError: () => false,
}))
vi.mock('../../lib/analytics', () => ({ track: vi.fn() }))
vi.mock('../../lib/stocks', () => ({
  fetchIngredients: vi.fn(),
  fetchRecipesForProduct: vi.fn(),
  setRecipeItem: vi.fn(),
  removeRecipeItem: vi.fn(),
}))

import ProductsTab from '../ProductsTab'
import { surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'
import type { PlanSurface } from '../../lib/planSurface'

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    restaurant_id: 'rest-1',
    category_id: null,
    name: 'Supă de roșii',
    description: null,
    price: 18,
    emoji: '🍅',
    image_url: null,
    is_active: true,
    is_daily_special: false,
    is_sold_out: false,
    is_draft: false,
    display_order: 0,
    allergens: [],
    dietary_tags: [],
    prep_time_minutes: null,
    portion_size: null,
    vat_group: 1,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    ai_generated_fields: [],
    ...over,
  }
}

function renderList(surface: PlanSurface | null, onOpenVatRates = vi.fn()) {
  render(
    <ProductsTab
      restaurantId="rest-1"
      plan="pro"
      onUpgrade={() => {}}
      userId="u1"
      canUseAi={false}
      canUseAiMenu={false}
      canManageRecipes
      menuLanguages={[]}
      surface={surface}
      onOpenVatRates={onOpenVatRates}
    />,
  )
  return onOpenVatRates
}

const three = (groups: [number, number, number]) =>
  groups.map((g, i) => product({ id: `p${i}`, name: `Produs ${i}`, vat_group: g }))

async function openNewProduct(surface: PlanSurface | null, onOpenVatRates?: () => void) {
  const user = userEvent.setup()
  render(
    <ProductsTab
      restaurantId="rest-1"
      plan="pro"
      onUpgrade={() => {}}
      userId="u1"
      canUseAi={false}
      canUseAiMenu={false}
      canManageRecipes
      menuLanguages={[]}
      surface={surface}
      onOpenVatRates={onOpenVatRates}
    />,
  )
  // Ancora: produsul e în listă (rândul există, deci absența badge-ului e reală).
  expect(screen.getByText('Supă de roșii')).toBeInTheDocument()
  // Lăsăm cererea de cote (dacă există) să se așeze înainte de a citi lista.
  await Promise.resolve()
  const listText = document.body.textContent ?? ''
  await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
  // Fișa e deschisă (control).
  expect(await screen.findByRole('button', { name: 'Salvează' })).toBeInTheDocument()
  return { listText }
}

beforeEach(() => {
  data.products = [product()]
  vat.calls = 0
  vat.fail = 0
  vat.empty = false
  dialog.calls = 0
  dialog.answer = false
})

describe('ProductsTab — fiecare plan vede doar ce are', () => {
  it('PT1: Planul 1 — fără TVA, fără Extras & Pereche, fără Rețetă', async () => {
    const { listText } = await openNewProduct(surfaceFor('starter'))
    expect(listText).not.toMatch(/\bTVA\b/)
    expect(screen.queryByText('Cotă TVA')).toBeNull()
    expect(screen.queryByText('Extras & Pereche')).toBeNull()
    expect(screen.queryByText('Rețetă (ingrediente consumate)')).toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/\bTVA\b|bon(ul)? fiscal|cas[aă] de marcat/)
    expect(vat.calls).toBe(0)
  })

  it('PT2: Planul 2 — Extras & Pereche și Rețeta da, TVA nu', async () => {
    const { listText } = await openNewProduct(surfaceFor('growth'))
    expect(listText).not.toMatch(/\bTVA\b/)
    expect(screen.queryByText('Cotă TVA')).toBeNull()
    expect(screen.getByText('Extras & Pereche')).toBeInTheDocument()
    expect(screen.getByText('Rețetă (ingrediente consumate)')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/\bTVA\b|bon(ul)? fiscal|cas[aă] de marcat/)
    expect(vat.calls).toBe(0)
  })

  it('PT3: control pozitiv — pe Planul 3 badge-ul TVA, câmpul de cotă, extras și rețeta', async () => {
    await openNewProduct(surfaceFor('pro'))
    expect(await screen.findByText('Cotă TVA')).toBeInTheDocument()
    expect((await screen.findAllByText('TVA 11%')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Extras & Pereche')).toBeInTheDocument()
    expect(screen.getByText('Rețetă (ingrediente consumate)')).toBeInTheDocument()
    expect(vat.calls).toBeGreaterThanOrEqual(1)
  })

  it('PT4: plan necunoscut — nimic dependent de plan', async () => {
    await openNewProduct(null)
    expect(screen.queryByText('Cotă TVA')).toBeNull()
    expect(screen.queryByText('Extras & Pereche')).toBeNull()
    expect(screen.queryByText('Rețetă (ingrediente consumate)')).toBeNull()
    expect(vat.calls).toBe(0)
  })
})

describe('ProductsTab — nota „toate pe aceeași grupă TVA" (recenzia #334)', () => {
  it('PT5: Planul 3, trei produse pe grupa 1 → nota cu cota și ieșirea spre Setări', async () => {
    data.products = three([1, 1, 1])
    const onOpen = renderList(surfaceFor('pro'))
    const note = await screen.findByRole('note')
    await waitFor(() => expect(note).toHaveTextContent('aceeași grupă TVA (Mâncare 11%)'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Vezi cotele TVA' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('PT5b: sub pragul de 3 produse active → fără notă', async () => {
    data.products = [...three([1, 1, 1]).slice(0, 2), product({ id: 'px', name: 'Inactiv', is_active: false })]
    renderList(surfaceFor('pro'))
    expect(await screen.findByText('Produs 0')).toBeInTheDocument()
    await waitFor(() => expect(vat.calls).toBeGreaterThanOrEqual(1))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('PT6: grupe mixte → fără notă', async () => {
    data.products = three([1, 1, 3])
    renderList(surfaceFor('pro'))
    expect(await screen.findByText('Produs 2')).toBeInTheDocument()
    await waitFor(() => expect(vat.calls).toBeGreaterThanOrEqual(1))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('PT7: Planul 2, toate pe aceeași grupă → fără notă', () => {
    data.products = three([1, 1, 1])
    renderList(surfaceFor('growth'))
    expect(screen.getByText('Produs 0')).toBeInTheDocument()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/\bTVA\b/)
  })
})

describe('ProductsTab — cotele din fișa produsului nu se mai încarcă la nesfârșit (lotul R2)', () => {
  it('PT8: citirea eșuează → eroare cu „Reîncearcă" și ieșire spre Setări', async () => {
    // Prima citire = lista (badge-ul), a doua = fișa: ambele eșuează.
    vat.fail = 2
    const onOpen = vi.fn()
    await openNewProduct(surfaceFor('pro'), onOpen)
    expect(await screen.findByText('Nu am putut încărca cotele TVA.')).toBeInTheDocument()
    expect(screen.queryByText('Se încarcă cotele TVA...')).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    // „Reîncearcă" chiar recitește: grila cotelor apare (control pozitiv).
    expect(await screen.findByText('Mâncare')).toBeInTheDocument()
    expect(screen.queryByText('Nu am putut încărca cotele TVA.')).toBeNull()
    expect(vat.calls).toBeGreaterThanOrEqual(3)
  })

  it('PT8b: ieșirea „Deschide cotele TVA" închide fișa și deschide Setările', async () => {
    vat.fail = 2
    const onOpen = vi.fn()
    await openNewProduct(surfaceFor('pro'), onOpen)
    await screen.findByText('Nu am putut încărca cotele TVA.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Deschide cotele TVA' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Salvează' })).toBeNull()
    // Fișa neatinsă: fără dialog.
    expect(dialog.calls).toBe(0)
  })

  it('PT8c: fișa modificată → confirmare înainte de a o închide', async () => {
    vat.fail = 2
    const onOpen = vi.fn()
    await openNewProduct(surfaceFor('pro'), onOpen)
    await screen.findByText('Nu am putut încărca cotele TVA.')
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Nume' }), 'Ciorbă')
    dialog.answer = false
    await user.click(screen.getByRole('button', { name: 'Deschide cotele TVA' }))
    expect(dialog.calls).toBe(1)
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Salvează' })).toBeInTheDocument()
    dialog.answer = true
    await user.click(screen.getByRole('button', { name: 'Deschide cotele TVA' }))
    expect(dialog.calls).toBe(2)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('PT9: fără cote configurate → mesaj cu trimiterea la Setări, nu spinner', async () => {
    vat.empty = true
    await openNewProduct(surfaceFor('pro'))
    expect(
      await screen.findByText(/Nu există cote TVA configurate\. Le setezi din Setări → Comenzi & plăți → Cote TVA\./),
    ).toBeInTheDocument()
    expect(screen.queryByText('Se încarcă cotele TVA...')).toBeNull()
    // Fără `onOpenVatRates` (partenerul) nu există butonul de ieșire.
    expect(screen.queryByRole('button', { name: 'Deschide cotele TVA' })).toBeNull()
  })

  it('PT10: validarea apare în dialog ca role="alert", nu în viewport-ul global', async () => {
    const user = userEvent.setup()
    const api: ToastApi = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
    }
    render(
      <ToastContext.Provider value={api}>
        <ProductsTab
          restaurantId="rest-1"
          plan="pro"
          onUpgrade={() => {}}
          userId="u1"
          canUseAi={false}
          canUseAiMenu={false}
          canManageRecipes
          menuLanguages={[]}
          surface={surfaceFor('starter')}
        />
      </ToastContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    const dlg = await screen.findByRole('dialog', { name: 'Adaugă produs' })
    // Control: înainte de salvare nu există nicio alertă.
    expect(within(dlg).queryByRole('alert')).toBeNull()

    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Numele produsului e obligatoriu')
    expect(api.error).not.toHaveBeenCalled()

    // Editarea numelui stinge alerta; un preț negativ o readuce, tot în dialog.
    await user.type(within(dlg).getByRole('textbox', { name: 'Nume' }), 'Ciorbă')
    expect(within(dlg).queryByRole('alert')).toBeNull()
    fireEvent.change(within(dlg).getByRole('spinbutton', { name: 'Preț (lei)' }), {
      target: { value: '-5' },
    })
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Prețul nu poate fi negativ')
    expect(api.error).not.toHaveBeenCalled()
  })
})
