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
//   PR1  fără handlere AI (fondatorul în vizită: ai-proxy nu-i dă nicio funcție
//        AI — n-are nici membership, nici acces de agent): fără „Generează AI",
//        iar „Importă" are DOAR CSV-ul.
//        Mutația care pică: butoanele randate necondiționat (codul vechi).
//   PR2  ProductsTab fără niciun AI (`canUseAi` și `canUseAiMenu` false — fondatorul
//        în vizită), catalog gol: fără „Importă din poză";
//        „Adaugă manual" și CSV rămân (control).
//   PR3  ProductsTab cu `canUseAi={false}` și `canManageRecipes={false}`:
//        antetul fără „Generează AI"; în fișa produsului fără „Generează imagine"
//        și fără secțiunea „Rețetă". Mutația care pică: prop-urile ignorate în
//        ProductModal (secțiunile randate necondiționat).
//   PR4  control pozitiv pentru PR3: owner/manager (`true`) văd ambele.
//   PR5  AGENTUL de vânzări (`canUseAi={false}`, `canUseAiMenu`): ai-proxy îi
//        permite `menu_import` + `translate` (AGENT_FEATURES, PR #307) — deci
//        importul din poză RĂMÂNE (starea goală + „Importă"), iar lotul AI se
//        deschide DOAR cu traduceri (fără bifele de imagini/macronutrienți);
//        în fișa produsului fără „Generează imagine" și fără rețetă.
//        Mutația care pică: un singur flag (`canUseAi`) pentru tot AI-ul —
//        varianta dinainte a acestui PR, care îi lua agentului importul.
//   PR6  agentul FĂRĂ limbi extra: lotul AI n-ar avea ce face → fără „Generează AI".
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
vi.mock('../../../lib/ai', () => ({
  generateNutrition: vi.fn(),
  generateProductImage: vi.fn(),
  // Lotul AI (AiBulkGenerate, PR5b) le importă; nu se cheamă în teste.
  aiTranslateBatch: vi.fn(),
  isAiConfigError: () => false,
  isAiQuotaError: () => false,
}))
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }))
vi.mock('../../../lib/stocks', () => ({
  fetchIngredients: vi.fn(),
  fetchRecipesForProduct: vi.fn(),
  setRecipeItem: vi.fn(),
  removeRecipeItem: vi.fn(),
}))

import ProductsTab from '../../ProductsTab'
import { surfaceFor } from '../../../lib/__tests__/planSurfaceFixtures'
import type { PlanSurface } from '../../../lib/planSurface'

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

function renderTab(
  canUseAi = true,
  canManageRecipes = true,
  canUseAiMenu = canUseAi,
  menuLanguages: string[] = [],
  // Lotul P: fișa produsului arată Rețeta doar pe un plan cu stocuri. Testele
  // de aici păzesc ROLURILE (AI, partener), deci rulează pe Planul 3, unde
  // planul nu ascunde nimic — planurile inferioare au suita lor
  // (ProductsTabPlan.test.tsx).
  surface: PlanSurface | null = surfaceFor('pro'),
) {
  render(
    <ProductsTab
      restaurantId="rest-1"
      plan="free"
      onUpgrade={() => {}}
      userId="u1"
      canUseAi={canUseAi}
      canUseAiMenu={canUseAiMenu}
      canManageRecipes={canManageRecipes}
      menuLanguages={menuLanguages}
      surface={surface}
    />,
  )
}

describe('ProductsToolbar — fără AI', () => {
  it('PR1: fără handlere AI, doar „Importă" (CSV) și „+ Adaugă produs"', async () => {
    const user = userEvent.setup()
    render(
      <ProductsToolbar
        mobile={false}
        canAdd
        onAdd={vi.fn()}
        onUpgrade={vi.fn()}
        onImportCsv={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Generează AI/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Importă/ }))
    expect(screen.getByRole('button', { name: 'Din fișier CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Din poză (AI)' })).not.toBeInTheDocument()
  })
})

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

describe('ProductsTab — fără niciun AI (fondatorul în vizită) și fără rețete', () => {
  beforeEach(() => {
    data.products = []
  })

  it('PR2: catalog gol fără AI — fără „Importă din poză", restul rămâne', () => {
    renderTab(false, false)
    expect(screen.queryByRole('button', { name: 'Importă din poză' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă manual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importă din CSV' })).toBeInTheDocument()
  })

  it('PR3: fără AI și fără rețete — antetul și fișa produsului', async () => {
    const user = userEvent.setup()
    data.products = [product()]
    renderTab(false, false)
    expect(screen.queryByRole('button', { name: /Generează AI/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    // Fișa e deschisă (control) — dar fără generare AI și fără rețetă.
    expect(await screen.findByRole('button', { name: 'Salvează' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generează imagine/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Rețetă (ingrediente consumate)')).not.toBeInTheDocument()
  })

  it('PR4: control pozitiv — owner/manager văd generarea AI și rețeta', async () => {
    const user = userEvent.setup()
    data.products = [product()]
    renderTab(true, true)
    expect(screen.getByRole('button', { name: /Generează AI/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    expect(await screen.findByRole('button', { name: /Generează imagine/ })).toBeInTheDocument()
    expect(screen.getByText('Rețetă (ingrediente consumate)')).toBeInTheDocument()
  })
})

describe('ProductsTab — agentul păstrează importul și traducerea AI', () => {
  beforeEach(() => {
    data.products = []
  })

  it('PR5: import din poză + lot doar cu traduceri; fără imagine/nutriție/rețetă', () => {
    renderTab(false, false, true, ['ro', 'en'])
    // Catalog gol: importul din poză rămâne acțiunea principală.
    expect(screen.getByRole('button', { name: 'Importă din poză' })).toBeInTheDocument()
  })

  it('PR5b: cu produse — „Din poză (AI)" și lotul doar de traduceri', async () => {
    const user = userEvent.setup()
    data.products = [product()]
    renderTab(false, false, true, ['ro', 'en'])
    await user.click(screen.getByRole('button', { name: /^Importă/ }))
    expect(screen.getByRole('button', { name: 'Din poză (AI)' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /Generează AI/ }))
    expect(await screen.findByText(/Traduceri în 1 limbă/)).toBeInTheDocument()
    expect(screen.queryByText(/Imagini \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Macronutrienți/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Închide' }))

    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    expect(await screen.findByRole('button', { name: 'Salvează' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generează imagine/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Rețetă (ingrediente consumate)')).not.toBeInTheDocument()
  })

  it('PR6: agentul fără limbi extra — fără lotul AI, importul rămâne', async () => {
    const user = userEvent.setup()
    data.products = [product()]
    renderTab(false, false, true, ['ro'])
    expect(screen.queryByRole('button', { name: /Generează AI/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Importă/ }))
    expect(screen.getByRole('button', { name: 'Din poză (AI)' })).toBeInTheDocument()
  })
})
