// Antetul filei Produse (audit UX oct 2026): înainte 4 butoane de adăugare în
// antet („AI", „Poză", „CSV", „+ Adaugă") + încă 2 în starea goală. Ce păzesc:
//   PB1  antetul are TREI controale, cu o singură acțiune principală; importurile
//        stau sub „Importă" (mutația: butoanele separate „Import din poză" /
//        „Import CSV" înapoi în antet).
//   PB2  „Importă" e un disclosure: aria-expanded, opțiunile apar la click, o
//        alegere cheamă acțiunea și închide meniul.
//   PB3  Escape închide meniul și întoarce focusul pe „Importă"; click în afară
//        îl închide (mutația: fără handler → meniul rămâne deschis peste listă).
//   PB4  la plafonul planului, butonul principal duce la upgrade, nu la formular.
//   PB5  ProductsTab: pe un catalog GOL antetul nu are butoane, iar starea goală
//        are cele trei acțiuni o singură dată (pică pe codul vechi: „+ Adaugă
//        produs", „Import din poză", „Import CSV" erau și în antet).
//   PB6  ProductsTab cu produse: antetul cu „Importă" apare, starea goală nu.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product } from '../../../hooks/useData'
import { ProductsToolbar } from '../ProductsToolbar'

function handlers() {
  return {
    onAdd: vi.fn(),
    onUpgrade: vi.fn(),
    onImportPhoto: vi.fn(),
    onImportCsv: vi.fn(),
    onBulkAi: vi.fn(),
  }
}

describe('ProductsToolbar', () => {
  it('PB1: trei controale, importurile sub „Importă"', () => {
    render(<ProductsToolbar mobile={false} canAdd {...handlers()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(screen.getByRole('button', { name: '+ Adaugă produs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Importă/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: /Generează AI/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /din poză/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /CSV/ })).not.toBeInTheDocument()
  })

  it('PB2: disclosure-ul arată opțiunile și cheamă acțiunea aleasă', async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(<ProductsToolbar mobile={false} canAdd {...h} />)
    const trigger = screen.getByRole('button', { name: /Importă/ })

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
    expect(menu).not.toBeNull()
    // Ancorat la stânga butonului: pe telefon bara stă lipită de marginea
    // stângă și un meniu aliniat la dreapta „Importă" ieșea ~40 px în afara
    // containerului cu scroll (mutația `right: 0` pică aici). jsdom n-are
    // layout, deci verificarea e pe ancoră, nu pe poziția calculată.
    expect(menu?.style.left).toBe('0px')
    expect(menu?.style.right).toBe('')
    await user.click(within(menu as HTMLElement).getByRole('button', { name: 'Din fișier CSV' }))

    expect(h.onImportCsv).toHaveBeenCalledTimes(1)
    expect(h.onImportPhoto).not.toHaveBeenCalled()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Din fișier CSV' })).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Din poză (AI)' }))
    expect(h.onImportPhoto).toHaveBeenCalledTimes(1)
  })

  it('PB3: Escape închide și întoarce focusul; click în afară închide', async () => {
    const user = userEvent.setup()
    render(
      <>
        <p>în afară</p>
        <ProductsToolbar mobile canAdd {...handlers()} />
      </>,
    )
    const trigger = screen.getByRole('button', { name: /Importă/ })
    await user.click(trigger)
    // Focusul pe o opțiune, apoi Escape.
    screen.getByRole('button', { name: 'Din poză (AI)' }).focus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByText('în afară'))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('PB4: la plafon, acțiunea principală duce la upgrade', async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(<ProductsToolbar mobile={false} canAdd={false} {...h} />)
    await user.click(screen.getByRole('button', { name: /Limită atinsă/ }))
    expect(h.onUpgrade).toHaveBeenCalledTimes(1)
    expect(h.onAdd).not.toHaveBeenCalled()
  })
})

// ── ProductsTab: antetul vs. starea goală ──
const data = vi.hoisted(() => ({ products: [] as Product[] }))

vi.mock('../../../hooks/useData', () => ({
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
  useCategories: () => ({
    categories: [],
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
  }),
}))
vi.mock('../../../hooks/usePlanLimits', () => ({
  usePlanLimits: () => ({
    limits: { plan: 'free', max_products: 15, max_restaurants: 1, max_tables: 3 },
    loading: false,
    canAddProduct: () => true,
  }),
}))
vi.mock('../../../lib/vat', () => ({ fetchVatRates: async () => [] }))
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../lib/ai', () => ({ generateNutrition: vi.fn(), generateProductImage: vi.fn() }))
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }))
vi.mock('../../../lib/stocks', () => ({
  fetchIngredients: vi.fn(),
  fetchRecipesForProduct: vi.fn(),
  setRecipeItem: vi.fn(),
  removeRecipeItem: vi.fn(),
}))

import ProductsTab from '../../ProductsTab'

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

function renderTab() {
  render(<ProductsTab restaurantId="rest-1" plan="free" onUpgrade={() => {}} userId="u1" />)
}

describe('ProductsTab — antet și stare goală', () => {
  beforeEach(() => {
    data.products = []
  })

  it('PB5: catalog gol — acțiunile o singură dată, în starea goală', () => {
    renderTab()
    expect(screen.getAllByRole('button', { name: /din poză/i })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Importă din poză' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă manual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importă din CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Adaugă produs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generează AI/ })).not.toBeInTheDocument()
  })

  it('PB6: cu produse — antetul cu „Importă", fără starea goală', () => {
    data.products = [product()]
    renderTab()
    expect(screen.getByRole('button', { name: '+ Adaugă produs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Importă/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adaugă manual' })).not.toBeInTheDocument()
    expect(screen.queryByText('Niciun produs încă')).not.toBeInTheDocument()
  })
})
