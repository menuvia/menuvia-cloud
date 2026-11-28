// Meniu → Produse: căutarea din listă (lotul C4a). Partea pură e în
// src/lib/__tests__/staffSearch.test.ts (SRC1–SRC3); aici, cablajul din filă.
//   SRC4 „ciorba” găsește „Ciorbă de burtă”, „  DULCEATA ” găsește produsul
//        după DESCRIERE („cu dulceață de casă”), iar căutarea se combină cu
//        filtrul de categorie; câmpul are nume accesibil. Control pozitiv:
//        „pizza” arată „Niciun produs găsit”, iar câmpul golit arată din nou
//        tot. Mutația care pică: `p.name.toLowerCase().includes(q)` readus
//        (fără diacritice, fără descriere, fără `trim()`).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product, Category } from '../../hooks/useData'

const { data } = vi.hoisted(() => ({
  data: { products: [] as Product[], categories: [] as Category[] },
}))

vi.mock('../ui/confirm', () => ({ confirm: async () => true }))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: data.products,
    loading: false,
    error: null,
    create: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    remove: vi.fn(),
    toggleActive: vi.fn(),
    toggleSoldOut: vi.fn(),
    toggleDailySpecial: vi.fn(),
    refetch: vi.fn(),
  }),
  useCategories: () => ({
    categories: data.categories,
    error: null,
    refetch: vi.fn(),
    create: async () => ({ data: null, error: null }),
  }),
}))
vi.mock('../../hooks/usePlanLimits', () => ({
  usePlanLimits: () => ({
    limits: { plan: 'growth', max_products: 2000, max_restaurants: 1, max_tables: 500 },
    loading: false,
    canAddProduct: () => true,
  }),
}))
vi.mock('../../lib/vat', () => ({ fetchVatRates: async () => [] }))
vi.mock('../../lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'order']) builder[m] = () => builder
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  return { supabase: { from: () => builder } }
})
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

function category(id: string, name: string, order: number): Category {
  return { id, restaurant_id: 'rest-1', name, emoji: '🍲', display_order: order, meta_text: null }
}

function product(over: Partial<Product>): Product {
  return {
    id: 'p1',
    restaurant_id: 'rest-1',
    category_id: null,
    name: 'Produs',
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

beforeEach(() => {
  data.categories = [category('cat-a', 'Ciorbe', 0), category('cat-b', 'Deserturi', 1)]
  data.products = [
    product({ id: 'p1', name: 'Ciorbă de burtă', category_id: 'cat-a' }),
    product({ id: 'p2', name: 'Clătite', description: 'cu dulceață de casă', category_id: 'cat-b', display_order: 1 }),
    product({ id: 'p3', name: 'Supă de roșii', category_id: 'cat-a', display_order: 2 }),
  ]
})

const shown = (name: string) => screen.queryAllByText(name).length > 0

describe('ProductsTab — căutarea personalului (lotul C4a)', () => {
  it('SRC4 fără diacritice, pe descriere, cu filtrul de categorie', async () => {
    const user = userEvent.setup()
    render(
      <ProductsTab
        restaurantId="rest-1"
        plan="growth"
        onUpgrade={() => {}}
        userId="u1"
        canUseAi={false}
        canUseAiMenu={false}
        canManageRecipes={false}
        menuLanguages={[]}
        surface={surfaceFor('growth')}
      />,
    )
    const search = screen.getByRole('textbox', { name: 'Caută în produse (nume sau descriere)' })
    expect(search).toHaveAttribute('placeholder', 'Caută...')

    await user.type(search, 'ciorba')
    expect(shown('Ciorbă de burtă')).toBe(true)
    expect(shown('Clătite')).toBe(false)
    expect(shown('Supă de roșii')).toBe(false)

    await user.clear(search)
    await user.type(search, '  DULCEATA ')
    expect(shown('Clătite')).toBe(true)
    expect(shown('Ciorbă de burtă')).toBe(false)

    // Combinată cu filtrul: în „Ciorbe”, „dulceata” nu găsește nimic.
    await user.click(screen.getByRole('button', { name: /Ciorbe/ }))
    expect(screen.getByText('Niciun produs găsit')).toBeInTheDocument()

    // Control: câmpul golit → toată categoria; altă interogare fără potrivire.
    await user.clear(search)
    expect(shown('Ciorbă de burtă')).toBe(true)
    expect(shown('Supă de roșii')).toBe(true)
    await user.type(search, 'pizza')
    expect(screen.getByText('Niciun produs găsit')).toBeInTheDocument()
  })
})
