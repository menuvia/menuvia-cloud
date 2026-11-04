// Produsele fără categorie nu mai dispar tăcut din meniu (lotul O1a, audit nov
// 2026 MENU-01 / MENU-04). Meniul public și comanda ospătarului grupează
// produsele DOAR sub categorii, deci un produs cu category_id NULL nu apare
// nicăieri — iar fișa unui produs nou pornea mereu pe „Fără categorie".
//
//   PC1  produs nou: categoria propusă e cea filtrată acum, altfel prima;
//        salvarea o trimite. [PICĂ: `category_id: defaultCategoryId` scos din
//        formularul inițial → create primește category_id undefined]
//   PC2  „Fără categorie" după o categorie → `null`, nu '' (un '' ajungea la
//        Postgres ca uuid invalid și salvarea pica mereu); nota „nu apare în
//        meniul clienților" apare. [PICĂ: `v === '' ? null : v` scos]
//   PC3  lista: produsul fără categorie are insigna „nu apare în meniu", iar
//        filtrul „Fără categorie (1)" le arată doar pe ele. Control: produsul cu
//        categorie arată numele categoriei, fără insignă.
//   PC4  după ce ultimul produs fără categorie primește una, filtrul revine pe
//        „Toate” (altfel lista goală spunea „Niciun produs încă”). [PICĂ:
//        `activeCat` derivat scos — filtrul rămâne pe chip-ul ascuns]
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product, Category } from '../../hooks/useData'

const { data, calls } = vi.hoisted(() => ({
  data: { products: [] as Product[], categories: [] as Category[] },
  calls: { create: [] as Partial<Product>[], update: [] as [string, Partial<Product>][] },
}))

vi.mock('../ui/confirm', () => ({ confirm: async () => true }))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: data.products,
    loading: false,
    error: null,
    create: async (f: Partial<Product>) => {
      calls.create.push(f)
      return { data: null, error: null }
    },
    update: async (id: string, f: Partial<Product>) => {
      calls.update.push([id, f])
      return { data: null, error: null }
    },
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
// Fișa unui produs EXISTENT pe growth își încarcă extra-urile și asocierile
// (supabase.from…): un mock `{}` ar arunca într-un async nesupravegheat, iar
// vitest pică rularea pe respingerea nefinalizată (recenzia #346).
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

function tab() {
  return (
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
    />
  )
}

function renderTab() {
  return render(tab())
}

beforeEach(() => {
  data.categories = [category('cat-a', 'Ciorbe', 0), category('cat-b', 'Deserturi', 1)]
  data.products = [product({ id: 'p1', name: 'Supă de roșii', category_id: 'cat-a' })]
  calls.create = []
  calls.update = []
})

describe('ProductsTab — produsele fără categorie nu mai dispar tăcut', () => {
  it('PC1 produs nou: categoria filtrată acum, altfel prima', async () => {
    const user = userEvent.setup()
    renderTab()
    // Filtru „Toate" → prima categorie.
    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    let dlg = await screen.findByRole('dialog', { name: 'Adaugă produs' })
    expect(within(dlg).getByRole('combobox', { name: 'Categorie' })).toHaveValue('cat-a')
    await user.type(within(dlg).getByRole('textbox', { name: 'Nume' }), 'Ciorbă de burtă')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(calls.create).toHaveLength(1)
    expect(calls.create[0].category_id).toBe('cat-a')

    // Filtru pe „Deserturi" → produsul nou pornește în Deserturi.
    await user.click(screen.getByRole('button', { name: /Deserturi/ }))
    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    dlg = await screen.findByRole('dialog', { name: 'Adaugă produs' })
    expect(within(dlg).getByRole('combobox', { name: 'Categorie' })).toHaveValue('cat-b')
    await user.type(within(dlg).getByRole('textbox', { name: 'Nume' }), 'Clătite')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(calls.create[1].category_id).toBe('cat-b')
  })

  it('PC2 „Fără categorie" trimite null, nu "", și avertizează', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getAllByRole('button', { name: 'Editează produsul' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Editează produs' })
    const sel = within(dlg).getByRole('combobox', { name: 'Categorie' })
    expect(sel).toHaveValue('cat-a')
    expect(within(dlg).queryByText(/nu apare în meniul clienților/)).toBeNull()
    await user.selectOptions(sel, '')
    expect(within(dlg).getByText(/nu apare în meniul clienților/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(calls.update).toHaveLength(1)
    expect(calls.update[0][1].category_id).toBeNull()
  })

  it('PC3 insigna „nu apare în meniu" și filtrul „Fără categorie"', async () => {
    data.products = [
      product({ id: 'p1', name: 'Supă de roșii', category_id: 'cat-a' }),
      product({ id: 'p2', name: 'Limonadă', category_id: null }),
    ]
    const user = userEvent.setup()
    renderTab()
    expect(screen.getAllByText('Fără categorie · nu apare în meniu').length).toBeGreaterThan(0)
    const chip = screen.getByRole('button', { name: 'Fără categorie (1)' })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Limonadă').length).toBeGreaterThan(0)
    expect(screen.queryByText('Supă de roșii')).toBeNull()
  })

  it('PC4 filtrul „Fără categorie” revine pe „Toate” când nu mai are produse', async () => {
    data.products = [
      product({ id: 'p1', name: 'Supă de roșii', category_id: 'cat-a' }),
      product({ id: 'p2', name: 'Limonadă', category_id: null }),
    ]
    const user = userEvent.setup()
    const { rerender } = renderTab()
    await user.click(screen.getByRole('button', { name: 'Fără categorie (1)' }))
    // Ultimul produs fără categorie primește una: chip-ul dispare.
    data.products = [
      product({ id: 'p1', name: 'Supă de roșii', category_id: 'cat-a' }),
      product({ id: 'p2', name: 'Limonadă', category_id: 'cat-b' }),
    ]
    rerender(tab())
    expect(screen.queryByRole('button', { name: /Fără categorie \(/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Toate' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Supă de roșii').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Limonadă').length).toBeGreaterThan(0)
  })

  it('PC3b control: fără produse necategorisite, fără filtru și fără insignă', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: /Fără categorie \(/ })).toBeNull()
    expect(screen.queryByText('Fără categorie · nu apare în meniu')).toBeNull()
  })
})
