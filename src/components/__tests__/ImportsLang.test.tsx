// Importurile meniului în limba personalului (lotul L5a2): AiMenuImport,
// AiBulkGenerate și ProductsCsvImport citesc namespace-ul `imports` (+
// „Închide”/„Înapoi”/„Anulează” din `common`). Testele de comportament
// (draftul, plafonul, gărzile retry-ului CSV, lotul AI) rămân în
// AiMenuImport.test.tsx, AiBulkGenerate.test.tsx și ProductsCsvImport.test.tsx,
// NESCHIMBATE — aici e doar limba. Partea pură (antetele, șabloanele, erorile,
// clichetul de suspendare) e în src/lib/__tests__/importMessages.test.ts
// (IY1–IY12); importul din poze în ONBOARDING (FunnelLangProvider) e în
// src/pages/__tests__/OnboardingImportLang.test.tsx (IM5–IM6).
// (Prefixele IM, IK, IZ: verificate cu grep în src/, tests/ și supabase/tests.)
//   IM0  control POZITIV al verificării „fără text românesc”: ecranul românesc,
//        comparat cu dicționarul englez, ARE resturi. Fără el, IM1–IM4 ar
//        trece și cu o verificare stricată.
//   IM1  importul din poze în engleză: titlul, introducerea cu {max} = 4,
//        butonul, „Close” — fără rest românesc. Mutația care pică: titlul
//        lăsat literal în JSX.
//   IM2  revizuirea în germană: reluarea draftului (plural), mesajul de plafon
//        cu două plurale, „Erste … behalten”, placeholder-ele, „Ohne
//        Kategorie”, secțiunea nouă „(neu)”, butonul de salvare.
//   IM3  refuzul asistentului AI (cotă, cu mesaj românesc; furnizorul cu text
//        englezesc brut): în franceză textul codului, fără mesajul brut, plus
//        ieșirile spre CSV/manual; control: în română mesajul serverului.
//        Mutația care pică: `toUserMessage(e, …)` readus în `handleFiles`.
//   IM4  ecranul final cu probleme, în engleză, apoi retradus în germană
//        (problemele sunt DATE). Mutația care pică: textul compus la `catch`
//        și ținut în stare.
//   IK0  control pozitiv pentru lotul AI.
//   IK1  lotul AI în engleză: titlul implicit, bifele cu numere, nota de
//        traducere, butonul cu plural.
//   IK2  lotul AI în germană după rulare: furnizorul fără imagini cu textul
//        lui (nu mesajul românesc), eroarea de rând, rezumatul — fără rest.
//   IK3  doar traduceri în franceză, cota epuizată: titlul, rezumatul,
//        „Achetez des crédits…”.
//   IZ0  control pozitiv pentru CSV.
//   IZ1  CSV în engleză: exemplul și placeholder-ul cu antete englezești, un
//        CSV cu antete GERMANE acceptat, numărătoarea, previzualizarea cu
//        antetele tabelului, eroarea de rând tradusă, valorile neatinse.
//   IZ2  CSV în germană: plafonul planului (două plurale) peste un CSV cu
//        antete ROMÂNEȘTI; eșecul importului tradus; schimbarea limbii în
//        română îl arată cu textul de dinainte (eroarea e ținută ca DATĂ).
//   IZ3  șablonul descărcat: în franceză cu antetele franceze (se re-importă
//        fără erori, numele fișierului tradus); în română BYTE-identic cu cel
//        de dinainte, inclusiv BOM-ul.
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, Product } from '../../hooks/useData'

interface Reply {
  data: unknown
  error: { message: string; code?: string; hint?: string } | null
}

const h = vi.hoisted(() => ({
  aiMenuImport: vi.fn(),
  genImage: vi.fn(),
  genNutrition: vi.fn(),
  translate: vi.fn(),
  createMany: vi.fn(),
  createOne: vi.fn(),
  createCategory: vi.fn(),
  confirm: vi.fn(async () => true),
  log: [] as { table: string; op: string }[],
  // (tabelă, operație, a câta oară) → răspuns; rescris de teste.
  db: { fn: ((): Reply => ({ data: [], error: null })) as (table: string, op: string, nth: number) => Reply },
}))

vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))
vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({ createMany: h.createMany, create: h.createOne }),
  useCategories: () => ({ categories: [], create: h.createCategory }),
}))
vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    let op = 'select'
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'range', 'single', 'maybeSingle', 'order']) b[m] = () => b
    b.insert = () => {
      op = 'insert'
      return b
    }
    b.update = () => {
      op = 'update'
      return b
    }
    b.then = (ok: (v: Reply) => unknown, ko?: (e: unknown) => unknown) => {
      const n = h.log.filter((c) => c.table === table && c.op === op).length
      h.log.push({ table, op })
      return Promise.resolve(h.db.fn(table, op, n)).then(ok, ko)
    }
    return b
  }
  return {
    supabase: {
      from: (t: string) => chain(t),
      auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
      rpc: vi.fn(),
    },
  }
})
// Doar apelurile de rețea sunt false; clasificarea erorilor e cea REALĂ.
vi.mock('../../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai')>()
  return {
    ...actual,
    aiMenuImport: h.aiMenuImport,
    generateProductImage: h.genImage,
    generateNutrition: h.genNutrition,
    aiTranslateBatch: h.translate,
  }
})

import AiMenuImport from '../AiMenuImport'
import AiBulkGenerate from '../AiBulkGenerate'
import ProductsCsvImport from '../ProductsCsvImport'
import { saveImportDraft, type ImportDraftProduct } from '../../lib/aiImportDraft'
import { csvTemplate } from '../../lib/importMessages'
import { parseProductsCsv } from '../../lib/productsCsv'
import { makeTranslator, preloadNamespace, type Dict } from '../../i18n/core'
import { importsNs } from '../../i18n/ns/imports'
import { commonNs } from '../../i18n/ns/common'
import importsRo from '../../i18n/ns/imports/ro'
import importsEn from '../../i18n/ns/imports/en'
import importsFr from '../../i18n/ns/imports/fr'
import importsDe from '../../i18n/ns/imports/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(importsNs, l), preloadNamespace(commonNs, l)]))
})

beforeEach(() => {
  sessionStorage.clear()
  h.log.length = 0
  h.db.fn = () => ({ data: [], error: null })
  h.aiMenuImport.mockReset()
  h.genImage.mockReset()
  h.genNutrition.mockReset()
  h.translate.mockReset()
  h.createMany.mockReset().mockResolvedValue({ data: [{}], error: null })
  h.createOne.mockReset().mockResolvedValue({ data: {}, error: null })
  h.createCategory.mockReset().mockResolvedValue({ data: { id: 'c-new' }, error: null })
  h.confirm.mockClear()
})

const spies: Array<{ mockRestore: () => void }> = []
afterEach(() => {
  vi.unstubAllGlobals()
  while (spies.length) spies.pop()?.mockRestore()
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [importsEn as Dict, commonEn as Dict],
  fr: [importsFr as Dict, commonFr as Dict],
  de: [importsDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI, despărțite prin „\n”: `textContent` lipește textele
// elementelor vecine („…produse+ Adaugă produs…”), iar granița de cuvânt din
// `containsWhole` n-ar mai găsi un fragment lipit de litera vecinului — un
// control pozitiv ar cădea la zero, iar un rest real ar trece neobservat.
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}

/** Fragmentele românești ale lui `imports` + `common` rămase în text (fără
 *  cele identice în limba țintă). Un text cu locuri `{x}` se verifică pe
 *  bucățile lui fixe de cel puțin 6 caractere, ca cuvinte întregi. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [importsRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

function aiErr(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status })
}

// ── AiMenuImport ─────────────────────────────────────────────

const RID = 'r1'
function draft(over: Partial<ImportDraftProduct> = {}): ImportDraftProduct {
  return { name: 'Pizza', description: '', price: 32, emoji: '🍕', category_id: '', category_name: '', include: true, ...over }
}
function menuImport(props: Partial<Parameters<typeof AiMenuImport>[0]> = {}) {
  return <AiMenuImport restaurantId={RID} onClose={vi.fn()} {...props} />
}
async function uploadPhoto(container: HTMLElement): Promise<void> {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('input-ul de poze lipsește')
  await userEvent.upload(input, new File(['x'], 'meniu.png', { type: 'image/png' }))
}

const QUOTA_RO = 'Ai atins limita lunară a asistentului AI.'

describe('AiMenuImport în limba personalului', () => {
  it('IM0: control pozitiv — ecranul românesc are resturi față de engleză', () => {
    const { container } = inLang(null, menuImport())
    const left = romanianLeftovers(nodeText(container), 'en')
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('ai_uploadIntro:'))).toBe(true)
  })

  it('IM1: ecranul de încărcare în engleză', () => {
    const { container } = inLang('en', menuImport())
    expect(screen.getByText('📸 Import the menu from photos')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Take or upload up to 4 clear photos of the menu (its pages). The AI extracts the products and the sections, then you check and correct them before saving.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Choose photos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])
  })

  it('IM2: revizuirea în germană, cu plafonul planului', async () => {
    saveImportDraft(RID, [
      draft({ category_id: 'new:Getränke', category_name: 'Getränke' }),
      draft({ name: 'Pasta', price: 28 }),
      draft({ name: 'Supă', price: 18 }),
    ])
    const { container } = inLang('de', menuImport({ remainingSlots: 1 }))
    expect(await screen.findByTestId('resume-import')).toHaveTextContent(
      'Sie haben einen begonnenen Import: 3 erkannte Produkte, noch nicht gespeichert. Setzen Sie ihn fort oder verwerfen Sie ihn.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Import fortsetzen' }))
    expect(await screen.findByText('3 Produkte gefunden. Stimmt alles?')).toBeInTheDocument()
    expect(screen.getByText(/Mit ➕ markierte Rubriken werden beim Speichern automatisch angelegt\.$/)).toBeInTheDocument()
    expect(screen.getByTestId('plan-limit')).toHaveTextContent(
      'Ihr Tarif erlaubt noch 1 Produkt, Sie haben 3 ausgewählt. Entfernen Sie die Häkchen bei 2 Produkten oder wechseln Sie zu einem höheren Tarif. Es wurde noch nichts gespeichert.',
    )
    expect(screen.getAllByPlaceholderText('Produktname')).toHaveLength(3)
    expect(screen.getAllByPlaceholderText('Beschreibung (optional)')).toHaveLength(3)
    expect(screen.getAllByRole('option', { name: 'Ohne Kategorie' })).toHaveLength(3)
    expect(screen.getAllByRole('option', { name: '➕ Getränke (neu)' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: '3 Produkte speichern' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'de')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Erstes Produkt behalten, der Rest bleibt im Entwurf' }))
    expect(screen.queryByTestId('plan-limit')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 Produkt speichern' })).toBeEnabled()
  })

  it('IM3: refuzul asistentului AI în franceză, fără mesajul brut; în română ca înainte', async () => {
    h.aiMenuImport.mockRejectedValueOnce(aiErr('quota_exceeded', 429, QUOTA_RO))
    const fr = inLang('fr', menuImport({ onFallbackCsv: vi.fn(), onFallbackManual: vi.fn() }))
    await uploadPhoto(fr.container)
    expect(await screen.findByText(importsFr.err_aiQuota)).toBeInTheDocument()
    expect(screen.queryByText(QUOTA_RO)).not.toBeInTheDocument()
    expect(screen.getByText('Vous pouvez aussi continuer sans l’IA :')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importer depuis un CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajouter les produits à la main' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(fr.container), 'fr')).toEqual([])

    // Textul englezesc brut al furnizorului nu ajunge pe ecran.
    h.aiMenuImport.mockRejectedValueOnce(aiErr('provider_failed', 502, 'Upstream provider returned 502 Bad Gateway'))
    await uploadPhoto(fr.container)
    expect(await screen.findByText(importsFr.err_aiBusy)).toBeInTheDocument()
    expect(screen.queryByText(/Upstream/)).not.toBeInTheDocument()
    fr.unmount()

    // Control: în română, mesajul serverului, ca înainte.
    h.aiMenuImport.mockRejectedValueOnce(aiErr('quota_exceeded', 429, QUOTA_RO))
    const ro = inLang(null, menuImport())
    await uploadPhoto(ro.container)
    expect(await screen.findByText(QUOTA_RO)).toBeInTheDocument()
  })

  it('IM4: ecranul final cu probleme, în engleză și retradus în germană', async () => {
    saveImportDraft(RID, [
      draft({ category_id: 'new:Desserts', category_name: 'Desserts' }),
      draft({ name: 'Pasta', price: 28 }),
    ])
    h.createCategory.mockResolvedValue({ data: null, error: { message: 'boom' } })
    h.createMany.mockResolvedValue({ data: null, error: { message: 'network blip' } })
    h.createOne
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const node = menuImport()
    const { container, rerender } = render(tree('en', node))
    await userEvent.click(await screen.findByRole('button', { name: 'Resume import' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save 2 products' }))
    expect(await screen.findByText('1 product saved, 2 problems')).toBeInTheDocument()
    expect(
      screen.getByText('• category “Desserts”: couldn’t be created (its products are added without a category)'),
    ).toBeInTheDocument()
    expect(screen.getByText('• Pasta: couldn’t be saved')).toBeInTheDocument()
    expect(screen.getByTestId('left-in-draft')).toHaveTextContent(
      '1 product is still in the draft, not saved. Reopen the import and press “Resume import”.',
    )
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])

    rerender(tree('de', node))
    expect(screen.getByText('1 Produkt gespeichert, 2 Probleme')).toBeInTheDocument()
    expect(
      screen.getByText('• Kategorie „Desserts“: konnte nicht angelegt werden (ihre Produkte kommen ohne Kategorie hinzu)'),
    ).toBeInTheDocument()
    expect(screen.getByText('• Pasta: konnte nicht gespeichert werden')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'de')).toEqual([])
  })
})

// ── AiBulkGenerate ───────────────────────────────────────────

function product(id: string, name: string, over: Partial<Product> = {}): Product {
  return {
    id,
    restaurant_id: 'r1',
    category_id: null,
    name,
    description: null,
    image_url: null,
    calories: null,
    ai_generated_fields: [],
    translations: null,
    ...over,
  } as unknown as Product
}
const NO_IMAGES =
  'Generarea de imagini merge doar cu OpenAI sau Gemini. Schimbă furnizorul în Setări → Asistent AI.'

function bulk(products: Product[], over: Partial<Parameters<typeof AiBulkGenerate>[0]> = {}) {
  const categories: Category[] = []
  return (
    <AiBulkGenerate restaurantId="r1" products={products} categories={categories} onClose={vi.fn()} onDone={vi.fn()} {...over} />
  )
}

describe('AiBulkGenerate în limba personalului', () => {
  const MENU = [product('a', 'Ciorbă'), product('b', 'Pizza', { image_url: 'https://x/p.webp' })]

  it('IK0: control pozitiv — lotul românesc are resturi față de engleză', () => {
    const { container } = inLang(null, bulk(MENU, { menuLanguages: ['en'] }))
    const left = romanianLeftovers(nodeText(container), 'en')
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('bulk_intro:'))).toBe(true)
  })

  it('IK1: lotul AI în engleză, înainte de rulare', () => {
    const { container } = inLang('en', bulk(MENU, { menuLanguages: ['en'] }))
    expect(screen.getByText('✨ Generate with AI for the menu')).toBeInTheDocument()
    expect(screen.getByText('Images (1 without an image)')).toBeInTheDocument()
    expect(screen.getByText('Nutrition values (2 without values)')).toBeInTheDocument()
    expect(screen.getByText('Translations into 1 language (2 to translate)')).toBeInTheDocument()
    expect(screen.getByText(importsEn.bulk_trNoteNames)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate for 2 products' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])
  })

  it('IK2: după rulare, în germană — erorile cu textul lor, fără mesajul românesc', async () => {
    h.genImage.mockRejectedValue(aiErr('provider_no_images', 400, NO_IMAGES))
    h.genNutrition
      .mockResolvedValueOnce({ calories: 300, protein_g: 10, carbs_g: 20, fat_g: 5 })
      .mockRejectedValueOnce(aiErr('nutrition_failed', 502, 'Upstream boom'))
    const products = [product('a', 'Ciorbă'), product('b', 'Pizza')]
    const { container } = inLang('de', bulk(products))
    await userEvent.click(screen.getByRole('button', { name: 'Für 2 Produkte erstellen' }))
    expect(await screen.findByText('Fertig!')).toBeInTheDocument()
    expect(
      screen.getByText(`Bilderstellung abgebrochen: ${importsDe.bulk_errNoImages} Die übrigen Produkte wurden übersprungen.`),
    ).toBeInTheDocument()
    expect(screen.getByText('Pizza (Nährwerte): Fehler beim Erstellen.')).toBeInTheDocument()
    expect(screen.getByText(/^1 Satz Nährwerte · 0 Bilder erstellt\.$/)).toBeInTheDocument()
    expect(screen.getByText(importsDe.bulk_reviewAll)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(escapeRe(NO_IMAGES)))).not.toBeInTheDocument()
    expect(screen.queryByText(/Upstream/)).not.toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'de')).toEqual([])
  })

  it('IK3: doar traduceri, în franceză, cu cota epuizată', async () => {
    h.translate.mockRejectedValue(aiErr('quota_exceeded', 429, QUOTA_RO))
    const { container } = inLang('fr', bulk(MENU, { menuLanguages: ['en'], translateOnly: true }))
    expect(screen.queryByText(/^Images \(/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Générer les traductions' }))
    expect(await screen.findByText('Quota IA épuisé')).toBeInTheDocument()
    expect(
      screen.getByText(/^Traductions : 0 produit\. Achetez des crédits dans Paramètres → Assistant IA pour continuer\.$/),
    ).toBeInTheDocument()
    expect(screen.queryByText(QUOTA_RO)).not.toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'fr')).toEqual([])
  })
})

// ── ProductsCsvImport ────────────────────────────────────────

function csv(over: Partial<Parameters<typeof ProductsCsvImport>[0]> = {}) {
  return (
    <ProductsCsvImport restaurantId="r1" existingCategories={[]} onClose={vi.fn()} onDone={vi.fn()} showVat {...over} />
  )
}
function paste(text: string): void {
  const area = document.querySelector('textarea')
  if (!area) throw new Error('zona de lipire lipsește')
  fireEvent.change(area, { target: { value: text } })
}

describe('ProductsCsvImport în limba personalului', () => {
  it('IZ0: control pozitiv — ecranul românesc are resturi față de engleză', () => {
    const { container } = inLang(null, csv())
    const left = romanianLeftovers(nodeText(container), 'en')
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('csv_subtitle:'))).toBe(true)
  })

  it('IZ1: în engleză, cu un CSV cu antete GERMANE', async () => {
    const { container } = inLang('en', csv())
    expect(screen.getByRole('heading', { name: '📥 Import products from CSV' })).toBeInTheDocument()
    expect(container.querySelector('pre')?.textContent).toBe(
      'name,category,price,emoji,description,vat\nEspresso,Coffee,8.00,☕,,1\nLatte,Coffee,14.00,🥛,With milk,1',
    )
    expect(screen.getByPlaceholderText('name,category,price,emoji,description,vat...')).toBeInTheDocument()
    expect(container.textContent).toContain(
      'Columns: name, category and price are required. Missing categories are created automatically. VAT = 1-4 (default 1).',
    )
    expect(screen.getByText('Columns:').tagName).toBe('STRONG')
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])

    paste('Name,Kategorie,Preis,MwSt\nSchnitzel,Hauptgerichte,18.50,1\nSuppe,Hauptgerichte,abc,1\n')
    expect(container.textContent).toContain('Detected 2 rows: 1 valid, 1 with errors')
    await userEvent.click(screen.getByRole('button', { name: 'Preview →' }))
    expect(container.textContent).toContain('1 product will be created. 1 new category will also be created: hauptgerichte')
    expect(screen.getByText('⚠ 1 row will be skipped (it has errors).')).toBeInTheDocument()
    for (const head of ['Status', 'Name', 'Category', 'Price', 'VAT'])
      expect(screen.getByRole('columnheader', { name: head })).toBeInTheDocument()
    expect(screen.getByText('✕ unreadable price (“abc”)')).toBeInTheDocument()
    expect(screen.getByText('18.50 lei')).toBeInTheDocument()
    // Valorile din celule NU se traduc.
    expect(container.textContent).toContain('Schnitzel')
    expect(screen.getAllByText('Hauptgerichte')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Import 1 product →' })).toBeEnabled()
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])
  })

  it('IZ2: în germană, plafonul și eșecul importului; în română textul de dinainte', async () => {
    // Baseline-ul (numele existente) nu se poate citi → importul nu pornește.
    h.db.fn = (t, o) =>
      t === 'products' && o === 'select' ? { data: null, error: { message: 'network' } } : { data: [], error: null }
    const node = csv({ remainingSlots: 1 })
    const { container, rerender } = render(tree('de', node))
    paste('nume,categorie,pret\nA,X,1\nB,X,2\nC,X,3\n')
    await userEvent.click(screen.getByRole('button', { name: 'Vorschau →' }))
    expect(container.textContent).toContain(
      'Ihr Tarif hat noch Platz für 1 Produkt — dieses wird importiert, 2 Zeilen bleiben außen vor.',
    )
    await userEvent.click(screen.getByRole('button', { name: '1 Produkt importieren →' }))
    expect(await screen.findByText(importsDe.csv_errBaseline)).toBeInTheDocument()
    expect(screen.queryByText(importsRo.csv_errBaseline)).not.toBeInTheDocument()
    expect(romanianLeftovers(nodeText(container), 'de')).toEqual([])

    // Aceeași rădăcină (UiLangScope) — `tree(null, …)` ar schimba tipul
    // rădăcinii, React ar remonta subarborele și starea (eroarea, pasul
    // `preview`) s-ar pierde. Româna e sincronă, deci nu suspendă.
    rerender(tree('ro', node))
    // Control pozitiv: starea a supraviețuit (suntem încă pe previzualizare).
    expect(screen.getByRole('button', { name: 'Importă 1 produse →' })).toBeInTheDocument()
    expect(screen.getByText(importsRo.csv_errBaseline)).toBeInTheDocument()
    expect(container.textContent).toContain(
      'Planul tău mai are loc pentru 1 produs — se importă primele 1, iar 2 rânduri rămân pe dinafară.',
    )
  })

  it('IZ3: șablonul descărcat — antete franceze; în română byte-identic', async () => {
    const parts: unknown[][] = []
    const OrigBlob = Blob
    class CapturingBlob extends OrigBlob {
      constructor(p?: BlobPart[], o?: BlobPropertyBag) {
        super(p, o)
        parts.push(p ?? [])
      }
    }
    vi.stubGlobal('Blob', CapturingBlob)
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:tpl'), revokeObjectURL: vi.fn() })
    const names: string[] = []
    spies.push(
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download)
      }),
    )

    const fr = inLang('fr', csv())
    await userEvent.click(screen.getByRole('button', { name: '📄 Télécharger le modèle CSV' }))
    const frText = String(parts[0]?.[0])
    expect(frText.startsWith('\uFEFFnom,catégorie,prix,emoji,description,tva\n')).toBe(true)
    expect(frText).toBe('\uFEFF' + csvTemplate(makeTranslator(importsFr, 'fr'), true))
    const rows = parseProductsCsv(frText, true)
    expect(rows).toHaveLength(5)
    expect(rows.filter((r) => r.errors.length > 0)).toEqual([])
    expect(names).toEqual(['modele-produits-menuvia.csv'])
    fr.unmount()

    inLang(null, csv({ showVat: false }))
    await userEvent.click(screen.getByRole('button', { name: '📄 Descarcă template CSV' }))
    await waitFor(() => expect(parts).toHaveLength(2))
    expect(parts[1]).toEqual([
      '\uFEFFnume,categorie,pret,emoji,descriere\nEspresso,Cafele,8.00,☕,Cafea italiană pură\nCappuccino,Cafele,14.00,☕,Cu spumă de lapte\nLatte Macchiato,Cafele,16.00,🥛,\nLimonadă,Băuturi reci,14.00,🍋,Cu mentă proaspătă\nCheesecake,Prăjituri,16.00,🍰,Cu fructe de pădure\n',
    ])
    expect(names[1]).toBe('template-produse-menuvia.csv')
  })
})
