// Fișa produsului: secțiunea „Opțiuni” leagă grupurile de produs (lotul O1b,
// audit nov 2026 MENU-02). Fără ea grupurile din Meniu → Opțiuni nu ajungeau
// la niciun produs.
//
//   PG1  pe un produs existent, grupurile restaurantului apar bifate după
//        legăturile lui; o bifă salvează IMEDIAT lista nouă, în ordinea din
//        Opțiuni. [PICĂ: lista trimisă în ordinea bifării / fără grupul deja
//        legat — dezlegare tăcută]
//   PG2  salvarea refuzată revine la bifele de dinainte și spune de ce.
//   PG3  pe planul fără comenzi secțiunea nu apare (opțiunile se aleg doar la
//        comandă); pe un produs nou cere salvarea întâi.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product, Category } from '../../hooks/useData'
import type { DbPlan } from '../../lib/__tests__/planFeatureMatrix.fixture'

const { data, calls, linkState } = vi.hoisted(() => ({
  data: { products: [] as Product[], categories: [] as Category[] },
  calls: { setGroups: [] as [string, string[]][] },
  linkState: { linked: [] as string[], fail: false },
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
  const rows: Record<string, unknown[]> = {
    modifier_groups: [
      { id: 'g-blat', name: 'Blat', is_required: true, display_order: 0 },
      { id: 'g-sos', name: 'Sos', is_required: false, display_order: 1 },
      { id: 'g-top', name: 'Toppinguri', is_required: false, display_order: 2 },
    ],
  }
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'order']) b[m] = () => b
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../lib/modifierLinks', () => ({
  fetchProductGroupIds: async () => [...linkState.linked],
  setProductModifierGroups: async (pid: string, gids: string[]) => {
    calls.setGroups.push([pid, gids])
    if (linkState.fail) {
      throw Object.assign(new Error('Nu ai drepturi să modifici opțiunile acestui produs'), {
        code: '42501',
      })
    }
  },
}))
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

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    restaurant_id: 'rest-1',
    category_id: 'cat-a',
    name: 'Pizza',
    description: null,
    price: 30,
    emoji: '🍕',
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

function renderTab(plan: DbPlan = 'growth') {
  render(
    <ProductsTab
      restaurantId="rest-1"
      plan={plan}
      onUpgrade={() => {}}
      userId="u1"
      canUseAi={false}
      canUseAiMenu={false}
      canManageRecipes={false}
      menuLanguages={[]}
      surface={surfaceFor(plan)}
    />,
  )
}

beforeEach(() => {
  data.categories = [{ id: 'cat-a', restaurant_id: 'rest-1', name: 'Pizza', emoji: '🍕', display_order: 0, meta_text: null }]
  data.products = [product()]
  calls.setGroups = []
  linkState.linked = ['g-top']
  linkState.fail = false
})

async function openEdit() {
  const user = userEvent.setup()
  renderTab()
  await user.click(screen.getAllByRole('button', { name: 'Editează produsul' })[0])
  const dlg = await screen.findByRole('dialog', { name: 'Editează produs' })
  const section = await within(dlg).findByRole('region', { name: 'Opțiuni' })
  return { user, section }
}

describe('ProductsTab — opțiunile produsului', () => {
  it('PG1 bifele pornesc din legături și se salvează în ordinea din Opțiuni', async () => {
    const { user, section } = await openEdit()
    const top = await within(section).findByRole('checkbox', { name: /Toppinguri/ })
    expect(top).toBeChecked()
    expect(within(section).getByRole('checkbox', { name: /Blat/ })).not.toBeChecked()
    await user.click(within(section).getByRole('checkbox', { name: /Blat/ }))
    expect(calls.setGroups).toEqual([['p1', ['g-blat', 'g-top']]])
    expect(within(section).getByRole('checkbox', { name: /Blat/ })).toBeChecked()
  })

  it('PG2 salvarea refuzată revine la bifele de dinainte și spune de ce', async () => {
    linkState.fail = true
    const { user, section } = await openEdit()
    const sos = await within(section).findByRole('checkbox', { name: /Sos/ })
    await user.click(sos)
    expect(calls.setGroups).toHaveLength(1)
    expect(sos).not.toBeChecked()
    expect(await screen.findByText(/drepturi/i)).toBeInTheDocument()
  })

  it('PG3 fără comenzi pe plan, secțiunea nu apare', async () => {
    const user = userEvent.setup()
    renderTab('starter')
    await user.click(screen.getAllByRole('button', { name: 'Editează produsul' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Editează produs' })
    expect(within(dlg).queryByRole('region', { name: 'Opțiuni' })).toBeNull()
  })
})
