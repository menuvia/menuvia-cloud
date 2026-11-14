// Fila Produse în limba personalului (lotul L5a, partea 1): ProductsTab (lista,
// filtrele, fișa produsului, ștergerea), ProductsToolbar și ProductOrderModal
// citesc namespace-ul `products` (+ „Anulează”/„Salvează”/„Șterge”/
// „Editează”/„Reîncearcă” din `common`). Testele de comportament (categoria
// propusă, „Renunți la modificări?”, prețul cu . sau ,, ordinea, gate-urile
// de plan) rămân în ProductsTab*.test.tsx / ProductOrderModal.test.tsx /
// ProductsToolbar.test.tsx, NESCHIMBATE — aici e doar limba. Partea pură
// (refuzurile, pluralele, oglinzile românești, clichetul structural) e în
// src/lib/__tests__/productMessages.test.ts (LV7–LV10).
// (Prefixul LV: verificat cu grep în src/, tests/ și supabase/tests,
// nefolosit înainte.)
//   LV0  control POZITIV al verificării „fără text românesc”: lista randată în
//        română, comparată cu dicționarul englez, ARE resturi. Fără el,
//        LV2/LV3/LV5/LV6 ar trece și cu o verificare stricată.
//   LV1  fără provider (azi, mereu româna): textele de dinainte ale listei —
//        „2 total · 2 active”, antetul tabelului, insignele „EPUIZAT · DIN
//        STOC” / „DEBLOCAT MANUAL” / „⭐ SPECIAL” / „Fără categorie · nu apare
//        în meniu”, chip-urile, „TVA” absent pe growth, butoanele antetului.
//        Mutația care pică: o cheie `list_*` / `toolbar_*` cu textul românesc
//        schimbat (ex. „EPUIZAT · Din stoc”).
//   LV2  lista în engleză: antetul, insignele, chip-urile, numele accesibile
//        ale butoanelor de rând — și NICIUN rest românesc. Mutația care pică:
//        un literal românesc lăsat în listă (ex. `'Toate'` la primul chip, sau
//        antetul tabelului `['Produs', …]` readus).
//   LV3  fișa produsului în germană: titlul, etichetele câmpurilor, statusul,
//        alergenii (din dicționar, nu din lib/constants), „Weitere Angaben”
//        cu contorul, validarea numelui (eroarea ținută ca DATE, tradusă la
//        randare), opțiunile — fără resturi românești în dialog. Mutația care
//        pică: `{a.label}` readus la alergeni sau `setFormError('Numele…')`.
//   LV4  refuzul serverului la creare (`product_limit`, mig 290): în română
//        MESAJUL serverului, ca înainte (control); în franceză textul hint-ului,
//        iar mesajul românesc al serverului NU ajunge pe ecran. Mutația care
//        pică: `toUserMessage(e)` readus în `handleSave`.
//   LV5  ProductsToolbar în franceză și ProductOrderModal în engleză (titlul cu
//        numele categoriei, butoanele ↑/↓ cu numele produsului, „Cancel” din
//        `common`). Mutația care pică: `aria-label={`Mută „${p.name}” mai sus`}`.
//   LV6  ștergerea în engleză: titlul, întrebarea cu numele produsului în
//        <strong> (fillNodes — ordinea cuvintelor e a limbii), „Cancel”/
//        „Delete”. Mutația care pică: „Ești sigur că vrei să ștergi” lăsat în cod.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product, Category } from '../../hooks/useData'

type CreateResult = { data: null; error: { message: string; code?: string; hint?: string } | null }

const { data, calls } = vi.hoisted(() => ({
  data: {
    products: [] as Product[],
    categories: [] as Category[],
    createResult: { data: null, error: null } as CreateResult,
  },
  calls: { create: 0 },
}))

vi.mock('../ui/confirm', () => ({ confirm: async () => true }))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({
    products: data.products,
    loading: false,
    error: null,
    create: async () => {
      calls.create += 1
      return data.createResult
    },
    update: async () => ({ data: null, error: null }),
    remove: vi.fn(async () => ({ error: null })),
    toggleActive: vi.fn(),
    toggleSoldOut: vi.fn(),
    toggleDailySpecial: vi.fn(),
    reorder: vi.fn(),
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
// Fișa unui produs EXISTENT pe growth își încarcă extra-urile, asocierile și
// grupurile de opțiuni (supabase.from…) — un builder care întoarce liste goale.
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
import { ProductsToolbar } from '../_dashboard/ProductsToolbar'
import { ProductOrderModal } from '../_dashboard/ProductOrderModal'
import { surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { productsNs } from '../../i18n/ns/products'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'
import productsRo from '../../i18n/ns/products/ro'
import productsEn from '../../i18n/ns/products/en'
import productsFr from '../../i18n/ns/products/fr'
import productsDe from '../../i18n/ns/products/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  // `translations` e cerut SUS de ProductsTab (traducerile din fișă, partea 2).
  await Promise.all(
    langs.flatMap((l) => [
      preloadNamespace(productsNs, l),
      preloadNamespace(commonNs, l),
      preloadNamespace(translationsNs, l),
    ]),
  )
})

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

const LIMIT_RO = 'Limită produse atinsă: maxim 15 pe planul curent. Pentru mai multe e nevoie de un plan superior.'

beforeEach(() => {
  data.categories = [category('cat-a', 'Ciorbe', 0)]
  data.products = [
    product({
      id: 'p1',
      name: 'Supă de roșii',
      category_id: 'cat-a',
      is_sold_out: true,
      sold_out_source: 'stock',
      is_daily_special: true,
      allergens: ['arahide'],
    }),
    product({ id: 'p2', name: 'Limonadă', price: 9.5, category_id: null, sold_out_source: 'manual' }),
  ]
  data.createResult = { data: null, error: null }
  calls.create = 0
})

function inLang(lang: StaffLang | null, node: ReactNode) {
  const tree = <Suspense fallback={null}>{node}</Suspense>
  return render(lang ? <UiLangScope lang={lang}>{tree}</UiLangScope> : tree)
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

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Pe CUVINTE ÎNTREGI (capcana (b) din L5a2): „Categorie” e subșir în englezescul
// „Categories”, deci un `includes` simplu raporta un rest românesc fals. Granița
// de cuvânt cere textul pe NODURI (`nodeText`): `textContent` lipește textele
// elementelor vecine („…produse+ Adaugă produs…”), iar un fragment lipit de
// litera vecinului n-ar mai fi găsit — controlul pozitiv ar cădea la zero.
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}

/** Fragmentele românești ale namespace-ului `products` rămase în text (fără
 *  cele identice în limba țintă: „Signature”, „⭐ SPECIAL”…). Un text cu
 *  locuri `{x}` se verifică pe bucățile lui fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, target: Dict): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(productsRo as Dict)) {
    const own = typeof target[k] === 'string' ? (target[k] as string) : ''
    const forms = typeof v === 'string' ? [v] : Object.values(v)
    for (const form of forms) {
      for (const piece of form.split(/\{\w+\}/)) {
        const p = piece.trim()
        if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
      }
    }
  }
  return out
}

describe('lista de produse în limba personalului', () => {
  it('LV0: control pozitiv — lista românească are resturi față de engleză', () => {
    const { container } = inLang(null, tab())
    const left = romanianLeftovers(nodeText(container), productsEn as Dict)
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('toolbar_add:'))).toBe(true)
  })

  it('LV1: fără provider, româna de dinainte', () => {
    inLang(null, tab())
    expect(screen.getByText('2 total · 2 active')).toBeInTheDocument()
    for (const h of ['Produs', 'Categorie', 'Preț', 'Status', 'Acțiuni']) expect(screen.getByText(h)).toBeInTheDocument()
    expect(screen.getByText('EPUIZAT · DIN STOC')).toBeInTheDocument()
    expect(screen.getByText('DEBLOCAT MANUAL')).toBeInTheDocument()
    expect(screen.getByText('⭐ SPECIAL')).toBeInTheDocument()
    expect(screen.getByText('Fără categorie · nu apare în meniu')).toBeInTheDocument()
    expect(screen.getByText('9.50 lei')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toate' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Fără categorie (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Adaugă produs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Importă/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Editează produsul' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Marchează disponibil' })).toHaveLength(1)
    expect(screen.getByPlaceholderText('Caută...')).toBeInTheDocument()
    expect(screen.queryByText(/\bTVA\b/)).toBeNull()
  })

  it('LV2: lista în engleză, fără resturi românești', () => {
    const { container } = inLang('en', tab())
    expect(screen.getByText('2 total · 2 active')).toBeInTheDocument()
    for (const h of ['Product', 'Category', 'Price', 'Status', 'Actions']) expect(screen.getByText(h)).toBeInTheDocument()
    expect(screen.getByText('SOLD OUT · BASED ON STOCK')).toBeInTheDocument()
    expect(screen.getByText('UNBLOCKED MANUALLY')).toBeInTheDocument()
    expect(screen.getByText('No category · not on the menu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'No category (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add product' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit product' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete product' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Mark available' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Mark as special' })).toHaveLength(1)
    expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), productsEn as Dict)).toEqual([])
    expect(container.textContent).not.toMatch(/Toate|Acțiuni|EPUIZAT|Adaugă/)
  })
})

describe('fișa produsului în limba personalului', () => {
  it('LV3: fișa în germană, cu validarea numelui tradusă', async () => {
    const user = userEvent.setup()
    inLang('de', tab())
    await user.click(screen.getAllByRole('button', { name: 'Produkt bearbeiten' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Produkt bearbeiten' })
    expect(within(dlg).getByText('Name *')).toBeInTheDocument()
    expect(within(dlg).getByRole('textbox', { name: 'Preis (lei)' })).toHaveValue('18')
    expect(within(dlg).getByRole('combobox', { name: 'Kategorie' })).toHaveValue('cat-a')
    expect(within(dlg).getByText('Ernährungshinweise')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: /Erdnüsse/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dlg).getByText(/⚠️ Enthält: Erdnüsse/)).toBeInTheDocument()
    expect(within(dlg).getByText('0 von 6 ausgefüllt')).toBeInTheDocument()
    expect(await within(dlg).findByText(/Sie haben noch keine Optionsgruppen/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: /Weitere Angaben/ }))
    expect(within(dlg).getByText('Zubereitungszeit')).toBeInTheDocument()

    await user.clear(within(dlg).getByRole('textbox', { name: 'Name' }))
    await user.click(within(dlg).getByRole('button', { name: 'Speichern' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Der Produktname ist erforderlich')
    expect(romanianLeftovers(nodeText(dlg), productsDe as Dict)).toEqual([])
  })

  it('LV4: refuzul `product_limit` — mesajul serverului în română, hint-ul tradus în franceză', async () => {
    data.createResult = { data: null, error: { message: LIMIT_RO, code: 'P0001', hint: 'product_limit' } }
    const user = userEvent.setup()

    // Control: în română, textul serverului, ca înainte.
    const roView = inLang(null, tab())
    await user.click(screen.getByRole('button', { name: '+ Adaugă produs' }))
    let dlg = await screen.findByRole('dialog', { name: 'Adaugă produs' })
    await user.type(within(dlg).getByRole('textbox', { name: 'Nume' }), 'Ciorbă')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(await within(dlg).findByText(LIMIT_RO)).toBeInTheDocument()
    expect(calls.create).toBe(1)
    roView.unmount()

    inLang('fr', tab())
    await user.click(screen.getByRole('button', { name: '+ Ajouter un produit' }))
    dlg = await screen.findByRole('dialog', { name: 'Ajouter un produit' })
    await user.type(within(dlg).getByRole('textbox', { name: 'Nom' }), 'Soupe')
    await user.click(within(dlg).getByRole('button', { name: 'Enregistrer' }))
    expect(await within(dlg).findByText(productsFr.hint_productLimit)).toBeInTheDocument()
    expect(calls.create).toBe(2)
    expect(document.body.textContent).not.toContain('Limită produse')
    expect(romanianLeftovers(nodeText(dlg), productsFr as Dict)).toEqual([])
  })
})

describe('antetul, ordinea și ștergerea în limba personalului', () => {
  it('LV5: ProductsToolbar în franceză, ProductOrderModal în engleză', async () => {
    const user = userEvent.setup()
    const bar = inLang(
      'fr',
      <ProductsToolbar
        mobile={false}
        canAdd={false}
        onAdd={vi.fn()}
        onUpgrade={vi.fn()}
        onImportPhoto={vi.fn()}
        onImportCsv={vi.fn()}
        onBulkAi={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Générer avec l’IA pour tout le menu (images et valeurs nutritionnelles)' }),
    ).toHaveTextContent('Générer avec l’IA')
    expect(screen.getByRole('button', { name: 'Limite atteinte — Changer de formule' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Importer/ }))
    expect(screen.getByRole('button', { name: 'Depuis une photo (IA)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Depuis un fichier CSV' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(bar.container), productsFr as Dict)).toEqual([])
    bar.unmount()

    inLang(
      'en',
      <ProductOrderModal
        categoryName="Supe"
        products={[
          { id: 'a', name: 'Ciorbă' },
          { id: 'b', name: 'Borș' },
        ]}
        onSave={vi.fn(async () => true)}
        onClose={vi.fn()}
      />,
    )
    const dlg = screen.getByRole('dialog', { name: 'Sort order of products in “Supe”' })
    expect(within(dlg).getByRole('button', { name: 'Move “Borș” up' })).toBeEnabled()
    expect(within(dlg).getByRole('button', { name: 'Move “Ciorbă” down' })).toBeEnabled()
    expect(within(dlg).getByRole('button', { name: 'Save sort order' })).toBeDisabled()
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), productsEn as Dict)).toEqual([])
  })

  it('LV6: ștergerea în engleză', async () => {
    const user = userEvent.setup()
    inLang('en', tab())
    await user.click(screen.getAllByRole('button', { name: 'Delete product' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Delete product' })
    expect(dlg).toHaveTextContent('Are you sure you want to delete Supă de roșii?')
    expect(within(dlg).getByText('Supă de roșii').tagName).toBe('STRONG')
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(dlg.textContent).not.toMatch(/Ești sigur/)
  })
})
