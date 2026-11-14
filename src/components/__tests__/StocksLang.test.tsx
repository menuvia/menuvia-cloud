// Fila Stocuri în limba personalului (lotul L5b): StocksTab (sumarul de sus,
// ghidul de bun venit, ingredientele cu alerta de stoc minim, fișa
// ingredientului, ajustarea, furnizorii, NIR-urile cu fișa de creare,
// profitabilitatea) citește namespace-ul `stocks` (+ „Anulează”/„Salvează”/
// „Șterge”/„Editează”/„Reîncearcă” din `common`). Gate-urile de plan (TVA doar
// pe Planul 3) rămân în StocksTabPlan.test.tsx, NESCHIMBATE — aici e doar
// limba. Partea pură (unitățile, eticheta cotei, refuzurile, pluralele,
// clichetul structural) e în src/lib/__tests__/stocksLang.test.ts (KS9–KS14).
// (Prefixul KS: alocat lotului, verificat cu grep în src/, tests/ și
// supabase/tests, nefolosit înainte.)
//   KS0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi. Fără el,
//        KS2–KS7 ar trece și cu o verificare stricată.
//   KS1  fără provider (azi, mereu româna): textele de dinainte — intro-ul,
//        „1 sub prag”, „70 lei”, „1 ingredient sub prag”, „10 buc”, „/ min 20
//        buc”, „4.00 lei / buc”, „TVA 11% (Mâncare)” și rezerva „TVA Grupa 2”,
//        „1.50 L”, „2 ingrediente active”, butoanele. Mutația care pică: o cheie
//        cu textul românesc schimbat (ex. `ing_min: '/ minim {amount}'`).
//   KS2  ingredientele în engleză (unitățile traduse: „pcs”; rezerva „Group 2”)
//        și fișa ingredientului cu validarea numelui ținută ca DATE: schimbarea
//        limbii pe ACEEAȘI rădăcină (en → de) o retraduce, cu fișa deschisă.
//        Mutația care pică: `setError('Numele e obligatoriu')` readus, sau
//        `{u}` brut în opțiunile unității.
//   KS3  furnizorii în germană: pluralul real („1 Tag” / „30 Tage”), CUI-ul cu
//        eticheta tradusă, fișa „Neuer Lieferant”, „Abbrechen”/„Speichern” din
//        `common`. Mutația care pică: `Termen plată: {s.payment_terms_days} zile`
//        readus în cod.
//   KS4  NIR-urile în franceză: glosarul („Réception”, nicăieri „NIR”),
//        statusurile din DB traduse doar la afișare, confirmarea recepției cu
//        `cancelLabel` EXPLICIT (implicitul urmează <html lang>, adică `ro`),
//        fișa de creare cu unitatea tradusă și validarea traduse. Mutația care
//        pică: `cancelLabel` scos (ar rămâne „Anulează”) sau `NIR #${…}` readus.
//   KS5  refuzurile serverului: în română MESAJUL românesc al serverului, ca
//        înainte (control), iar în engleză textul de rezervă din `common` —
//        mesajul românesc NU ajunge pe ecran; un hint al RPC-ului NIR (mig 066)
//        are textul limbii în germană, dar în română rămâne `toUserMessage`.
//        Mutația care pică: `toUserMessage(err)` readus în `save()`.
//   KS6  profitabilitatea în engleză: contoarele, „Price:”, „margin”, lista
//        trunchiată cu pluralul („and 1 more product”). Mutația care pică:
//        `` ` și încă ${n} produse` `` readus.
//   KS7  ghidul de bun venit în germană (fila goală): pașii cu titlul în
//        <strong> (fillNodes), butonul de pornire. Mutația care pică: textul
//        pasului readus în JSX.
//   KS8  confirmarea ștergerii și ajustarea în limba personalului: titlul cu
//        numele (dată), „Delete”/„Cancel” EXPLICITE în engleză, „Șterge”/
//        „Anulează” în română; ajustarea în franceză cu „pce” și validarea.
//        Mutația care pică: `confirmLabel: 'Șterge'` readus.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ingredient, ProductProfitability, PurchaseOrder, Supplier } from '../../lib/stocks'
import type { VatRate } from '../../lib/vat'
import type { ConfirmOptions } from '../ui/confirm'

const { data, calls } = vi.hoisted(() => ({
  data: {
    ingredients: [] as Ingredient[],
    suppliers: [] as Supplier[],
    pos: [] as PurchaseOrder[],
    profit: [] as ProductProfitability[],
    vatRates: [] as VatRate[],
    ingredientError: null as unknown,
    poError: null as unknown,
  },
  calls: { confirm: [] as ConfirmOptions[] },
}))

vi.mock('../ui/confirm', () => ({
  // Răspunsul e „nu”: testele verifică doar ce vede omul în dialog.
  confirm: async (o: ConfirmOptions) => {
    calls.confirm.push(o)
    return false
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/stocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/stocks')>()
  return {
    ...real,
    fetchIngredients: async () => data.ingredients,
    fetchSuppliers: async () => data.suppliers,
    fetchPurchaseOrders: async () => data.pos,
    fetchProductProfitability: async () => data.profit,
    createIngredient: async () => {
      if (data.ingredientError) throw data.ingredientError
      return data.ingredients[0]
    },
    updateIngredient: async () => {
      if (data.ingredientError) throw data.ingredientError
    },
    deleteIngredient: vi.fn(),
    adjustStockManual: vi.fn(),
    createSupplier: vi.fn(),
    receivePurchaseOrder: vi.fn(),
    createPurchaseOrder: async () => {
      if (data.poError) throw data.poError
      return 'po-new'
    },
  }
})
vi.mock('../../lib/vat', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/vat')>()
  return { ...real, fetchVatRates: async () => data.vatRates }
})

import StocksTab from '../StocksTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { stocksNs } from '../../i18n/ns/stocks'
import { commonNs } from '../../i18n/ns/common'
import stocksRo from '../../i18n/ns/stocks/ro'
import stocksEn from '../../i18n/ns/stocks/en'
import stocksFr from '../../i18n/ns/stocks/fr'
import stocksDe from '../../i18n/ns/stocks/de'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(stocksNs, l), preloadNamespace(commonNs, l)]))
})

function ingredient(over: Partial<Ingredient>): Ingredient {
  return {
    id: 'i1',
    restaurant_id: 'r1',
    name: 'Făină',
    unit: 'buc',
    current_stock: 10,
    min_stock_alert: 20,
    cost_per_unit: 4,
    vat_group: 1,
    emoji: null,
    category: null,
    is_active: true,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

function supplier(over: Partial<Supplier>): Supplier {
  return {
    id: 's1',
    restaurant_id: 'r1',
    name: 'Lactate SRL',
    vat_id: null,
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    payment_terms_days: 0,
    is_active: true,
    notes: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

function po(over: Partial<PurchaseOrder>): PurchaseOrder {
  return {
    id: 'abcdef12-3456-7890',
    restaurant_id: 'r1',
    supplier_id: 's1',
    invoice_number: null,
    invoice_date: null,
    status: 'draft',
    subtotal: 0,
    vat_total: 0,
    total: 120.5,
    notes: null,
    created_at: '2026-10-01T10:00:00Z',
    received_at: null,
    paid_at: null,
    ...over,
  }
}

function profit(name: string, cost: number, sell: number, margin: number): ProductProfitability {
  return {
    product_id: `p-${name}`,
    restaurant_id: 'r1',
    name,
    sell_price: sell,
    cost_price: cost,
    profit_amount: sell - cost,
    margin_percent: margin,
  }
}

beforeEach(() => {
  data.ingredients = [
    ingredient({}),
    ingredient({ id: 'i2', name: 'Lapte', unit: 'ml', current_stock: 1500, min_stock_alert: null, cost_per_unit: 0.02, vat_group: 2 }),
  ]
  data.suppliers = [
    supplier({ vat_id: 'RO123', payment_terms_days: 1 }),
    supplier({ id: 's2', name: 'Carmangerie Ion', payment_terms_days: 30 }),
  ]
  data.pos = [po({}), po({ id: 'po2-xxxxxxxx', invoice_number: 'F-77', status: 'received', total: 50 })]
  data.profit = [
    profit('Pizza', 10, 25, 60),
    ...['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((n) => profit(n, 0, 20, 100)),
  ]
  data.vatRates = [
    { restaurant_id: 'r1', vat_group: 1, rate_percent: 11, label: 'Mâncare', description: null, is_active: true, updated_at: '' },
  ]
  data.ingredientError = null
  data.poError = null
  calls.confirm = []
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = () => <StocksTab restaurantId="r1" showVat />

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Pe CUVINTE ÎNTREGI (capcana (b) din L5a2): un fragment românesc care e subșir
// al unui cuvânt străin („Categorie” în „Categories”) nu e un rest.
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI, despărțite prin „\n”: `textContent` lipește textele
// elementelor vecine („…produse+ Adaugă produs…”), iar granița de cuvânt din
// `containsWhole` n-ar mai găsi un fragment lipit de litera vecinului — un
// control pozitiv ar cădea la zero, iar un rest real ar trece neobservat
// (dovedit în CI pe L5a: LV0, capcana (b) din bullet-ul L5a2).
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}

/** Fragmentele românești ale namespace-ului `stocks` rămase în text (fără cele
 *  identice în limba țintă: „Draft”, „RO12345678”…). Un text cu locuri `{x}`
 *  se verifică pe bucățile lui fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, target: Dict): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(stocksRo as Dict)) {
    const t = target[k]
    const own = typeof t === 'string' ? t : t ? Object.values(t).join(' ') : ''
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
const COMMON_RO = /Anulează|Salvează|Șterge|Editează|Reîncearcă/

describe('ingredientele în limba personalului', () => {
  it('KS0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const { container } = render(tree(null, tab()))
    expect(await screen.findByText('Făină')).toBeInTheDocument()
    const left = romanianLeftovers(nodeText(container), stocksEn as Dict)
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('ing_add:'))).toBe(true)
  })

  it('KS1: fără provider, româna de dinainte', async () => {
    render(tree(null, tab()))
    expect(await screen.findByText('Făină')).toBeInTheDocument()
    expect(screen.getByText('Stocuri, rețete, furnizori, profitabilitate.')).toBeInTheDocument()
    expect(await screen.findByText('1 sub prag')).toBeInTheDocument()
    expect(screen.getByText('70 lei')).toBeInTheDocument()
    expect(screen.getByText('în așteptare')).toBeInTheDocument()
    expect(screen.getByText('1 ingredient sub prag')).toBeInTheDocument()
    expect(screen.getByText('10 buc')).toBeInTheDocument()
    expect(screen.getByText('/ min 20 buc')).toBeInTheDocument()
    expect(screen.getByText('4.00 lei / buc')).toBeInTheDocument()
    expect(screen.getByText('1.50 L')).toBeInTheDocument()
    expect(await screen.findByText('TVA 11% (Mâncare)')).toBeInTheDocument()
    expect(screen.getByText('TVA Grupa 2')).toBeInTheDocument()
    expect(screen.getByText('2 ingrediente active')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Ajustează stoc' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Editează' })).toHaveLength(2)
    for (const n of ['Ingrediente', 'Furnizori', 'NIR', 'Profitabilitate'])
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă ingredient' })).toBeInTheDocument()
  })

  it('KS2: lista și fișa în engleză; validarea retradusă la schimbarea limbii', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(tree('en', tab()))
    expect(await screen.findByText('Făină')).toBeInTheDocument()
    expect(screen.getByText('Stock, recipes, suppliers, profitability.')).toBeInTheDocument()
    expect(await screen.findByText('1 below minimum')).toBeInTheDocument()
    expect(screen.getByText('70 lei')).toBeInTheDocument()
    expect(screen.getByText('1 ingredient below minimum')).toBeInTheDocument()
    expect(screen.getByText('10 pcs')).toBeInTheDocument()
    expect(screen.getByText('/ min 20 pcs')).toBeInTheDocument()
    expect(screen.getByText('4.00 lei / pcs')).toBeInTheDocument()
    expect(await screen.findByText('VAT 11% (Mâncare)')).toBeInTheDocument()
    expect(screen.getByText('VAT Group 2')).toBeInTheDocument()
    expect(screen.getByText('2 active ingredients')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Adjust stock' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Goods receipts' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), stocksEn as Dict)).toEqual([])
    expect(container.textContent).not.toMatch(COMMON_RO)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    let dlg = screen.getByRole('dialog', { name: 'Edit ingredient' })
    expect(within(dlg).getByLabelText('Name *')).toHaveValue('Făină')
    expect(within(dlg).getByRole('option', { name: 'pcs' })).toBeInTheDocument()
    expect(within(dlg).getByRole('option', { name: 'pk' })).toBeInTheDocument()
    expect(within(dlg).getByText('Current stock (pcs)')).toBeInTheDocument()
    expect(within(dlg).getByText('Cost per pcs (lei)')).toBeInTheDocument()
    expect(within(dlg).getByText('VAT rate')).toBeInTheDocument()
    await user.clear(within(dlg).getByLabelText('Name *'))
    await user.click(within(dlg).getByRole('button', { name: commonEn.save }))
    expect(within(dlg).getByText('The name is required')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), stocksEn as Dict)).toEqual([])

    // Aceeași rădăcină (UiLangScope): fișa rămâne deschisă, eroarea se retraduce.
    rerender(tree('de', tab()))
    dlg = screen.getByRole('dialog', { name: 'Zutat bearbeiten' })
    expect(within(dlg).getByText('Der Name ist erforderlich')).toBeInTheDocument()
    expect(within(dlg).queryByText('The name is required')).toBeNull()
    expect(within(dlg).getByRole('option', { name: 'Stk.' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), stocksDe as Dict)).toEqual([])
  })
})

describe('furnizorii, NIR-urile și profitabilitatea în limba personalului', () => {
  it('KS3: furnizorii în germană', async () => {
    const user = userEvent.setup()
    const { container } = render(tree('de', tab()))
    await user.click(await screen.findByRole('button', { name: 'Lieferanten' }))
    expect(await screen.findByText('Lactate SRL')).toBeInTheDocument()
    expect(screen.getByText('2 Lieferanten')).toBeInTheDocument()
    expect(screen.getByText('Steuernummer: RO123')).toBeInTheDocument()
    expect(screen.getByText('Zahlungsziel: 1 Tag')).toBeInTheDocument()
    expect(screen.getByText('Zahlungsziel: 30 Tage')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lieferant hinzufügen' }))
    const dlg = screen.getByRole('dialog', { name: 'Neuer Lieferant' })
    expect(within(dlg).getByLabelText('Firmenname *')).toHaveAttribute('placeholder', 'z. B. Frischmolkerei GmbH')
    expect(within(dlg).getByLabelText('Steuernummer (CUI / CIF)')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: commonDe.cancel })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: commonDe.save })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), stocksDe as Dict)).toEqual([])
    expect(container.textContent).not.toMatch(COMMON_RO)
  })

  it('KS4: NIR-urile în franceză, cu confirmarea și fișa de creare', async () => {
    const user = userEvent.setup()
    const { container } = render(tree('fr', tab()))
    await user.click(await screen.findByRole('button', { name: 'Réceptions' }))
    expect(await screen.findByText('Réception #abcdef12')).toBeInTheDocument()
    expect(screen.getByText('F-77')).toBeInTheDocument()
    expect(screen.getByText('2 réceptions au total')).toBeInTheDocument()
    expect(screen.getByText('Brouillon')).toBeInTheDocument()
    expect(screen.getByText('Réceptionnée')).toBeInTheDocument()
    expect(screen.getByText('120.50 lei')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\bNIR\b/)
    expect(romanianLeftovers(nodeText(container), stocksFr as Dict)).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Réceptionner' }))
    await waitFor(() => expect(calls.confirm).toHaveLength(1))
    expect(calls.confirm[0]).toMatchObject({
      title: 'Confirmer la réception ?',
      description: 'Le stock augmentera automatiquement.',
      confirmLabel: 'Réceptionner',
      cancelLabel: commonFr.cancel,
    })

    await user.click(screen.getByRole('button', { name: 'Nouvelle réception' }))
    const dlg = screen.getByRole('dialog', { name: 'Nouvelle réception' })
    expect(within(dlg).getByRole('option', { name: '🥬 Făină (pce)' })).toBeInTheDocument()
    expect(within(dlg).getByText('Sous-total (HT)')).toBeInTheDocument()
    expect(within(dlg).getByText('Total ligne (TTC)')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Supprimer la ligne' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Enregistrer et réceptionner' }))
    expect(within(dlg).getByText('Ajoutez au moins un ingrédient avec une quantité valide')).toBeInTheDocument()
    expect(dlg.textContent).not.toMatch(/\bNIR\b/)
    expect(romanianLeftovers(nodeText(dlg), stocksFr as Dict)).toEqual([])
    expect(dlg.textContent).not.toMatch(COMMON_RO)
  })

  it('KS5: refuzurile serverului — mesajul românesc doar în română, hint-ul tradus', async () => {
    const user = userEvent.setup()
    const RO_MSG = 'Ingredientul nu poate fi salvat acum.'
    data.ingredientError = { message: RO_MSG, code: 'P0001' }

    // Control: în română, textul serverului, ca înainte.
    const roView = render(tree(null, tab()))
    await user.click(await screen.findByRole('button', { name: 'Adaugă ingredient' }))
    let dlg = screen.getByRole('dialog', { name: 'Ingredient nou' })
    await user.type(within(dlg).getByLabelText('Nume *'), 'Zahăr')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(await within(dlg).findByText(RO_MSG)).toBeInTheDocument()
    roView.unmount()

    const enView = render(tree('en', tab()))
    await user.click(await screen.findByRole('button', { name: 'Add ingredient' }))
    dlg = screen.getByRole('dialog', { name: 'New ingredient' })
    await user.type(within(dlg).getByLabelText('Name *'), 'Sugar')
    await user.click(within(dlg).getByRole('button', { name: commonEn.save }))
    expect(await within(dlg).findByText(commonEn.err_generic)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Ingredientul')
    enView.unmount()

    // Hint-ul RPC-ului NIR (create_purchase_order_atomic, mig 066).
    data.poError = { message: 'VAT rate out of range (got 140)', code: 'P0001', hint: 'invalid_vat' }
    const fill = async (newLabel: string, saveLabel: string) => {
      await user.click(await screen.findByRole('button', { name: newLabel }))
      const d = screen.getByRole('dialog', { name: newLabel })
      await user.selectOptions(within(d).getAllByRole('combobox')[0], 'i1')
      await user.type(within(d).getAllByRole('spinbutton')[0], '2')
      await user.click(within(d).getByRole('button', { name: saveLabel }))
      return d
    }
    const roNir = render(tree(null, tab()))
    await user.click(await screen.findByRole('button', { name: 'NIR' }))
    dlg = await fill('NIR nou', 'Salvează & recepționează')
    // În română hint-ul NU se aplică: exact `toUserMessage` (mesaj englezesc → generic).
    expect(await within(dlg).findByText('Acțiunea nu a putut fi finalizată. Reîncearcă.')).toBeInTheDocument()
    expect(within(dlg).queryByText(stocksRo.hint_invalidVat)).toBeNull()
    roNir.unmount()

    render(tree('de', tab()))
    await user.click(await screen.findByRole('button', { name: 'Wareneingang' }))
    dlg = await fill('Neuer Wareneingang', 'Speichern & einbuchen')
    expect(await within(dlg).findByText(stocksDe.hint_invalidVat)).toBeInTheDocument()
    expect(dlg.textContent).not.toContain('VAT rate out of range')
  })

  it('KS6: profitabilitatea în engleză', async () => {
    const user = userEvent.setup()
    const { container } = render(tree('en', tab()))
    await user.click(await screen.findByRole('button', { name: 'Profitability' }))
    expect(await screen.findByText('With a recipe (1)')).toBeInTheDocument()
    expect(screen.getByText('Cost: 10.00 lei')).toBeInTheDocument()
    expect(screen.getByText('Price: 25.00 lei')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('margin')).toBeInTheDocument()
    expect(screen.getByText('No recipe (6) — profit can’t be calculated')).toBeInTheDocument()
    expect(screen.getByText('P1, P2, P3, P4, P5 and 1 more product')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), stocksEn as Dict)).toEqual([])
  })

  it('KS7: ghidul de bun venit în germană', async () => {
    data.ingredients = []
    data.suppliers = []
    const { container } = render(tree('de', tab()))
    expect(await screen.findByText('Willkommen im Bestand')).toBeInTheDocument()
    const strong = screen.getByText('Zutaten hinzufügen')
    expect(strong.tagName).toBe('STRONG')
    expect(strong.parentElement?.textContent).toBe(
      'Zutaten hinzufügen — Mehl, Öl, Käse, Mozzarella. Geben Sie die aktuelle Menge und die Kosten pro Einheit ein.',
    )
    expect(screen.getByRole('button', { name: 'Mit der ersten Zutat beginnen →' })).toBeInTheDocument()
    expect(await screen.findByText('Noch keine Zutaten eingerichtet')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), stocksDe as Dict)).toEqual([])
  })

  it('KS8: confirmarea ștergerii (en, ro) și ajustarea (fr)', async () => {
    const user = userEvent.setup()
    const enView = render(tree('en', tab()))
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])
    let dlg = screen.getByRole('dialog', { name: 'Edit ingredient' })
    await user.click(within(dlg).getByRole('button', { name: commonEn.delete }))
    await waitFor(() => expect(calls.confirm).toHaveLength(1))
    expect(calls.confirm[0]).toMatchObject({
      title: 'Delete Făină?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    enView.unmount()

    const roView = render(tree(null, tab()))
    await user.click((await screen.findAllByRole('button', { name: 'Editează' }))[0])
    dlg = screen.getByRole('dialog', { name: 'Editează ingredient' })
    await user.click(within(dlg).getByRole('button', { name: 'Șterge' }))
    await waitFor(() => expect(calls.confirm).toHaveLength(2))
    expect(calls.confirm[1]).toMatchObject({ title: 'Șterge Făină?', confirmLabel: 'Șterge', cancelLabel: 'Anulează' })
    roView.unmount()

    render(tree('fr', tab()))
    await user.click((await screen.findAllByRole('button', { name: 'Ajuster le stock' }))[0])
    dlg = screen.getByRole('dialog', { name: 'Ajuster le stock' })
    expect(within(dlg).getByText('Stock actuel : 10 pce')).toBeInTheDocument()
    const amount = within(dlg).getByLabelText('Stock actuel : 10 pce')
    await user.clear(amount)
    await user.type(amount, '-1')
    await user.click(within(dlg).getByRole('button', { name: commonFr.save }))
    expect(within(dlg).getByText('Quantité invalide')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), stocksFr as Dict)).toEqual([])
  })
})
