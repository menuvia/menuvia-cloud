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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product } from '../../hooks/useData'

const { data, vat } = vi.hoisted(() => ({
  data: { products: [] as Product[] },
  vat: { calls: 0 },
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

function product(): Product {
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
  }
}

async function openNewProduct(surface: PlanSurface | null) {
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
