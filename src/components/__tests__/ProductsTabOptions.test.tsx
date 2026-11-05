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
//   PG4  (lotul O5a, MENU-07) prețul tastat cu virgulă („12,5”) rămâne pe ecran
//        și pleacă 12.5; un preț fără formă de număr e refuzat cu mesaj, nu
//        salvat 0. [PICĂ: `type="number"` + parseFloat la fiecare tastă]
//   PG5  (recenzia O5a, MENU-12) o pereche al cărei produs lipsește din listă
//        apare „scoasă din meniu” DOAR când lista produselor a fost citită;
//        o citire picată nu marchează perechile reale (iar „Scoate” le-ar fi
//        șters). [PICĂ: filtrul fără `allProductsComplete`]
//   PG6  (recenzia CodeRabbit pe #352) „Anulează” din fișă întreabă ca fundalul:
//        cu modificări, „Rămân” lasă fișa deschisă, „Renunță” o închide; fără
//        modificări se închide direct. [PICĂ: `onClick={onClose}`]
//   PG7  (recenzia CodeRabbit pe #352) o reîmprospătare picată cu fișa deschisă
//        nu o demontează și nu pierde ce s-a tastat. [PICĂ: ecranul de eroare
//        întors înaintea fișei]
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product, Category } from '../../hooks/useData'
import type { DbPlan } from '../../lib/__tests__/planFeatureMatrix.fixture'

const { data, calls, linkState, supa, dlg } = vi.hoisted(() => ({
  data: { products: [] as Product[], categories: [] as Category[] },
  calls: { setGroups: [] as [string, string[]][], updates: [] as Partial<Product>[] },
  linkState: { linked: [] as string[], fail: false },
  // Rândurile tabelelor citite direct de fișă și tabelele a căror citire pică.
  supa: { rows: {} as Record<string, unknown[]>, fail: new Set<string>() },
  // Răspunsul la „Renunți la modificări?” și câte întrebări s-au pus (PG6);
  // eroarea listei de produse (PG7).
  dlg: { calls: 0, answer: true, productsError: null as string | null },
}))

vi.mock('../ui/confirm', () => ({
  confirm: async () => {
    dlg.calls += 1
    return dlg.answer
  },
}))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: data.products,
    loading: false,
    error: dlg.productsError,
    create: async () => ({ data: null, error: null }),
    update: async (_id: string, f: Partial<Product>) => {
      calls.updates.push(f)
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
vi.mock('../../lib/supabase', () => {
  const base: Record<string, unknown[]> = {
    modifier_groups: [
      { id: 'g-blat', name: 'Blat', is_required: true, display_order: 0 },
      { id: 'g-sos', name: 'Sos', is_required: false, display_order: 1 },
      { id: 'g-top', name: 'Toppinguri', is_required: false, display_order: 2 },
    ],
  }
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'order']) b[m] = () => b
    b.then = (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown) =>
      Promise.resolve(
        supa.fail.has(table)
          ? { data: null, error: { message: 'boom' } }
          : { data: supa.rows[table] ?? base[table] ?? [], error: null },
      ).then(resolve)
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

function tabUi(plan: DbPlan = 'growth') {
  return (
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
    />
  )
}

function renderTab(plan: DbPlan = 'growth') {
  return render(tabUi(plan))
}

beforeEach(() => {
  data.categories = [{ id: 'cat-a', restaurant_id: 'rest-1', name: 'Pizza', emoji: '🍕', display_order: 0, meta_text: null }]
  data.products = [product()]
  calls.setGroups = []
  calls.updates = []
  linkState.linked = ['g-top']
  linkState.fail = false
  supa.rows = {}
  supa.fail.clear()
  dlg.calls = 0
  dlg.answer = true
  dlg.productsError = null
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

describe('ProductsTab — prețul se tastează ca preț (lotul O5a)', () => {
  it('PG4 „12.5.3” e refuzat; „12,5” pleacă 12.5', async () => {
    const { user } = await openEdit()
    const dlg = screen.getByRole('dialog', { name: 'Editează produs' })
    const price = within(dlg).getByRole('textbox', { name: 'Preț (lei)' })
    // Întâi forma invalidă: refuz cu mesaj, nimic salvat, fișa rămâne.
    await user.clear(price)
    await user.type(price, '12.5.3')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(calls.updates).toEqual([])
    expect(within(dlg).getByRole('alert')).toHaveTextContent(/nu e un număr valid/)
    // Apoi virgula: rămâne pe ecran și pleacă 12.5.
    await user.clear(price)
    await user.type(price, '12,5')
    expect(price).toHaveValue('12,5')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(calls.updates[calls.updates.length - 1]?.price).toBe(12.5)
  })
})

describe('ProductsTab — perechile cu produse scoase din meniu', () => {
  async function openUpsell() {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getAllByRole('button', { name: 'Editează produsul' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Editează produs' })
    await user.click(within(dlg).getByRole('button', { name: /Extras & Pereche/ }))
    await within(dlg).findByText(/Pereche \(sugestii/)
    return dlg
  }

  it('PG5 lista citită: perechea fără produs e „scoasă din meniu”', async () => {
    supa.rows.product_pairings = [{ id: 'pr1', paired_product_id: 'p-gone', display_order: 0 }]
    supa.rows.products = [{ id: 'p2', name: 'Vin', emoji: '🍷', price: 20 }]
    const dlg = await openUpsell()
    expect(within(dlg).getByText('Produs scos din meniu (ocupă un loc)')).toBeInTheDocument()
  })

  it('PG5b lista de produse picată: nicio pereche nu e marcată „scoasă”', async () => {
    supa.rows.product_pairings = [{ id: 'pr1', paired_product_id: 'p2', display_order: 0 }]
    supa.fail.add('products')
    const dlg = await openUpsell()
    expect(within(dlg).queryByText('Produs scos din meniu (ocupă un loc)')).toBeNull()
  })
})

describe('ProductsTab — fișa nu pierde munca (recenzia CodeRabbit pe #352)', () => {
  it('PG6 „Anulează” cere confirmarea doar cu modificări nesalvate', async () => {
    const { user } = await openEdit()
    let fisa = screen.getByRole('dialog', { name: 'Editează produs' })
    // Control: fără modificări, se închide direct.
    await user.click(within(fisa).getByRole('button', { name: 'Anulează' }))
    expect(dlg.calls).toBe(0)
    expect(screen.queryByRole('dialog', { name: 'Editează produs' })).toBeNull()
    // Cu modificări: întrebarea; „Rămân” → fișa rămâne, cu textul tastat.
    await user.click(screen.getAllByRole('button', { name: 'Editează produsul' })[0])
    fisa = await screen.findByRole('dialog', { name: 'Editează produs' })
    const price = within(fisa).getByRole('textbox', { name: 'Preț (lei)' })
    await user.clear(price)
    await user.type(price, '33')
    dlg.answer = false
    await user.click(within(fisa).getByRole('button', { name: 'Anulează' }))
    expect(dlg.calls).toBe(1)
    expect(screen.getByRole('dialog', { name: 'Editează produs' })).toBeInTheDocument()
    expect(price).toHaveValue('33')
    // „Renunță” → abia acum se închide.
    dlg.answer = true
    await user.click(within(fisa).getByRole('button', { name: 'Anulează' }))
    expect(dlg.calls).toBe(2)
    expect(screen.queryByRole('dialog', { name: 'Editează produs' })).toBeNull()
  })

  it('PG7 eroarea listei cu fișa deschisă nu demontează fișa', async () => {
    const user = userEvent.setup()
    const view = renderTab()
    await user.click(screen.getAllByRole('button', { name: 'Editează produsul' })[0])
    const fisa = await screen.findByRole('dialog', { name: 'Editează produs' })
    const price = within(fisa).getByRole('textbox', { name: 'Preț (lei)' })
    await user.clear(price)
    await user.type(price, '41')
    dlg.productsError = 'Fără conexiune. Verifică internetul și reîncearcă.'
    view.rerender(tabUi())
    expect(screen.getByRole('dialog', { name: 'Editează produs' })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'Editează produs' })).getByRole('textbox', { name: 'Preț (lei)' })).toHaveValue('41')
    // Control: fără fișă deschisă, eroarea apare ca de obicei.
    dlg.answer = true
    await user.click(within(screen.getByRole('dialog', { name: 'Editează produs' })).getByRole('button', { name: 'Anulează' }))
    expect(await screen.findByText('Fără conexiune. Verifică internetul și reîncearcă.')).toBeInTheDocument()
  })
})
