// Ecranul Meniu → Traduceri și traducerile din fișa produsului în limba
// personalului (lotul L5a, partea 2): TranslationsTab, TranslationRow,
// ProductTranslations (+ insigna AiReviewMark) și ExtraTranslations citesc
// namespace-ul `translations` (+ „Salvează”/„Reîncearcă” din `common`).
// Testele de comportament (filtrele, salvarea, „Confirmă”, lotul AI, ciornele,
// „complet” doar pe date întregi, „Tradu automat” fill-only-gaps) rămân în
// TranslationsTab.test.tsx și ProductTranslations.test.tsx, NESCHIMBATE — aici
// e doar limba. Partea pură (numele limbilor, pluralele, refuzurile, clichetul
// structural) e în src/lib/__tests__/translationMessages.test.ts (LX7–LX10).
// (Prefixul LX: verificat cu grep în src/, tests/ și supabase/tests.)
//   LX0  control POZITIV al verificării „fără text românesc”: ecranul randat în
//        română, comparat cu dicționarul englez, ARE resturi. Fără el, LX2–LX6
//        ar trece și cu o verificare stricată.
//   LX1  fără provider (azi, mereu româna): textele de dinainte — introducerea
//        cu „🇷🇴 Română”, pastilele cu numele limbii în limba EI („English”,
//        „Deutsch”), eticheta câmpului „Nume (English)”, grupurile accesibile,
//        căutarea. Mutația care pică: o cheie `tab_*`/`field*` cu textul
//        românesc schimbat.
//   LX2  ecranul în franceză: numele limbilor MENIULUI în limba personalului
//        („Anglais” la începutul pastilei, „en anglais” în propoziție),
//        filtrele, progresul cu pluralul francez, felul rândului — și NICIUN
//        rest românesc. Mutația care pică: `{meta?.label}` readus în pastilă
//        sau `KIND_LABEL` cu textele românești.
//   LX3  refuzul la salvarea unui rând (`not_found` din saveRowTranslations,
//        cu mesajul românesc): în română mesajul ca înainte (control); în
//        engleză textul lui, iar mesajul românesc NU e pe ecran; schimbarea
//        limbii îl retraduce (eroarea e ținută ca DATĂ). Mutația care pică:
//        `toUserMessage(e, …)` readus în `setRowErrors`.
//   LX4  eroarea pe opțiuni în germană, cu „Erneut versuchen” din `common`.
//        Mutația care pică: textul calculat la `catch` și ținut în stare.
//   LX5  ProductTranslations în germană: secțiunea, antetul limbii, etichetele,
//        insigna AI, „Als geprüft markieren”; refuzul AI pe cotă în germană fără mesajul
//        românesc al serverului (control: în română, mesajul serverului).
//        Mutația care pică: `toUserMessage(e, …)` readus în `autoTranslate`.
//   LX6  ExtraTranslations în engleză: comutatorul, nota, numele accesibil,
//        butonul „Save translations” — același text cu cel pomenit de
//        `products.extraTr_desc` în en/fr/de — și toast-ul de succes.
import { Suspense, useState, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, Product } from '../../hooks/useData'
import type { Translations } from '../../lib/i18nMenu'

const h = vi.hoisted(() => ({
  products: [] as unknown[],
  categories: [] as unknown[],
  load: vi.fn(),
  save: vi.fn(),
  translate: vi.fn(),
}))

vi.mock('../../hooks/useData', () => ({
  useProducts: () => ({ products: h.products, loading: false, error: null, refetch: vi.fn(async () => {}) }),
  useCategories: () => ({ categories: h.categories, loading: false, error: null, refetch: vi.fn(async () => {}) }),
}))
vi.mock('../../lib/menuTranslationsData', () => ({
  loadTranslationOptions: h.load,
  saveRowTranslations: h.save,
}))
vi.mock('../AiBulkGenerate', () => ({ default: () => null }))
vi.mock('../../lib/ai', () => ({
  aiTranslateBatch: h.translate,
  isAiConfigError: () => false,
  isAiQuotaError: () => false,
  generateNutrition: vi.fn(),
  generateProductImage: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import TranslationsTab from '../TranslationsTab'
import { ProductTranslations } from '../_dashboard/ProductTranslations'
import { ExtraTranslations } from '../_dashboard/ExtraTranslations'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { translationsNs } from '../../i18n/ns/translations'
import { commonNs } from '../../i18n/ns/common'
import trRo from '../../i18n/ns/translations/ro'
import trEn from '../../i18n/ns/translations/en'
import trFr from '../../i18n/ns/translations/fr'
import trDe from '../../i18n/ns/translations/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import productsEn from '../../i18n/ns/products/en'
import productsFr from '../../i18n/ns/products/fr'
import productsDe from '../../i18n/ns/products/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(translationsNs, l), preloadNamespace(commonNs, l)]))
})

function category(id: string, name: string, translations: Translations | null = null): Category {
  return { id, restaurant_id: 'r1', name, emoji: '🍽️', display_order: id === 'c1' ? 0 : 1, meta_text: null, translations }
}
function product(id: string, over: Partial<Product>): Product {
  return {
    id,
    restaurant_id: 'r1',
    category_id: 'c1',
    name: id,
    description: null,
    price: 10,
    emoji: '🍽️',
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
    translations: null,
    ...over,
  }
}

const NOT_IN_MENU_RO = 'Elementul nu mai e în meniu.'
const QUOTA_RO = 'Ai atins limita lunară a asistentului AI.'

beforeEach(() => {
  h.categories = [category('c1', 'Ciorbe', { en: { name: 'Soups' } }), category('c2', 'Băuturi')]
  h.products = [
    product('p1', {
      name: 'Ciorbă de burtă',
      description: 'Cu smântână',
      translations: { en: { name: 'Tripe soup', description: 'With sour cream', ai_fields: ['description'] } },
    }),
    product('p2', { name: 'Limonadă', category_id: 'c2' }),
  ]
  h.load.mockReset()
  h.load.mockResolvedValue({ groups: [], options: [], extras: [], links: [] })
  h.save.mockReset()
  h.save.mockImplementation(async (_t: string, _id: string, mutate: (t: Translations) => Translations) => mutate({}))
  h.translate.mockReset()
})

let seq = 0
function tab(over: Partial<Parameters<typeof TranslationsTab>[0]> = {}, id?: string) {
  seq += 1
  return (
    <TranslationsTab
      restaurantId={id ?? `rl-${seq}`}
      slug="la-bunica"
      menuLanguages={['en', 'de']}
      baseLang="ro"
      canTranslateAi={false}
      showOptions={false}
      isFlipbook={false}
      {...over}
    />
  )
}

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Pe CUVINTE ÎNTREGI (capcana (b) din L5a2): „Categorie” e subșir în englezescul
// „Categories”, deci un `includes` simplu raporta un rest românesc fals.
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)

/** Fragmentele românești ale namespace-urilor `translations` + `common`
 *  rămase în text (fără cele identice în limba țintă). Un text cu locuri
 *  `{x}` se verifică pe bucățile lui fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, targets: readonly [Dict, Dict]): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [trRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = targets[i]
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v)) {
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
      }
    }
  })
  return out
}
const EN: readonly [Dict, Dict] = [trEn as Dict, commonEn as Dict]
const FR: readonly [Dict, Dict] = [trFr as Dict, commonFr as Dict]
const DE: readonly [Dict, Dict] = [trDe as Dict, commonDe as Dict]

const rowOf = (label: string): HTMLElement => {
  const form = screen.getByLabelText(label).closest('form')
  if (!form) throw new Error(`rândul pentru ${label} lipsește`)
  return form
}

describe('ecranul Traduceri în limba personalului', () => {
  it('LX0: control pozitiv — ecranul românesc are resturi față de engleză', () => {
    const { container } = inLang(null, tab())
    const left = romanianLeftovers(container.textContent ?? '', EN)
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('tab_intro:'))).toBe(true)
  })

  it('LX1: fără provider, româna de dinainte', () => {
    inLang(null, tab())
    expect(
      screen.getByText(
        'Meniul e scris în 🇷🇴 Română (limba de bază). Aici completezi și verifici traducerile pentru limbile oferite clienților.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Limba traducerii' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Ce rânduri arăt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /English · 2 lipsă · 1 de verificat$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deutsch · 5 lipsă$/ })).toBeInTheDocument()
    expect(screen.getByText('3 din 5 texte traduse (60%)')).toBeInTheDocument()
    expect(screen.getAllByText('Nume (English)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Categorie').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Categorii (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previzualizează în English' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Caută…')).toBeInTheDocument()
    expect(screen.getByLabelText('Caută în original și în traducere')).toBeInTheDocument()
  })

  it('LX2: ecranul în franceză, cu numele limbilor în limba personalului', async () => {
    const { container } = inLang('fr', tab())
    expect(
      screen.getByText(
        'Le menu est rédigé en 🇷🇴 roumain (langue de base). Ici, vous complétez et vérifiez les traductions pour les langues proposées aux clients.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anglais · 2 manquants · 1 à vérifier$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Allemand · 5 manquants$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manquants (2)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'À vérifier (1)' })).toBeInTheDocument()
    expect(screen.getByText('3 sur 5 textes traduits (60 %)')).toBeInTheDocument()
    expect(screen.getByLabelText('Nom en anglais pour « Băuturi »')).toBeInTheDocument()
    expect(screen.getAllByText('Nom (anglais)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Catégorie').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Catégories (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prévisualiser en anglais' })).toBeInTheDocument()
    expect(screen.getByText('Les clients voient le menu en anglais')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Langue de la traduction' })).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', FR)).toEqual([])

    // Germana n-are încă nicio traducere: pastila trece pe ea, nota spune de ce.
    await userEvent.click(screen.getByRole('button', { name: /Allemand · 5 manquants$/ }))
    expect(screen.getByRole('button', { name: 'Prévisualiser en allemand' })).toBeDisabled()
    expect(
      screen.getByText('Elle apparaît aux clients après la première traduction d’une catégorie ou d’un produit.'),
    ).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', FR)).toEqual([])
  })

  it('LX3: refuzul la salvare — în română mesajul de dinainte, în engleză tradus, retradus la schimbarea limbii', async () => {
    const refusal = () => Object.assign(new Error(NOT_IN_MENU_RO), { code: 'not_found' })

    // Control: în română, mesajul de dinainte.
    h.save.mockRejectedValueOnce(refusal())
    const first = inLang(null, tab())
    await userEvent.type(screen.getByLabelText('Nume în English pentru «Băuturi»'), 'Drinks')
    await userEvent.click(within(rowOf('Nume în English pentru «Băuturi»')).getByRole('button', { name: 'Salvează' }))
    expect(await within(rowOf('Nume în English pentru «Băuturi»')).findByRole('alert')).toHaveTextContent(
      NOT_IN_MENU_RO,
    )
    first.unmount()

    h.save.mockRejectedValueOnce(refusal())
    const { container, rerender } = inLang('en', tab({}, 'rl-switch'))
    await userEvent.type(screen.getByLabelText('Name in English for “Băuturi”'), 'Drinks')
    await userEvent.click(within(rowOf('Name in English for “Băuturi”')).getByRole('button', { name: 'Save' }))
    expect(await within(rowOf('Name in English for “Băuturi”')).findByRole('alert')).toHaveTextContent(
      'This item is no longer on the menu.',
    )
    expect(container.textContent).not.toContain(NOT_IN_MENU_RO)
    expect(romanianLeftovers(container.textContent ?? '', EN)).toEqual([])

    // Aceeași stare, altă limbă: eroarea e o DATĂ, deci se retraduce.
    rerender(tree('de', tab({}, 'rl-switch')))
    expect(await within(rowOf('Name auf Englisch für „Băuturi“')).findByRole('alert')).toHaveTextContent(
      'Dieses Element ist nicht mehr auf der Speisekarte.',
    )
    expect(screen.getByLabelText('Name auf Englisch für „Băuturi“')).toHaveValue('Drinks')
  })

  it('LX4: eroarea pe opțiuni în germană', async () => {
    h.load.mockRejectedValue(new Error('boom'))
    const { container } = inLang('de', tab({ showOptions: true }))
    expect(
      await screen.findByText('Optionen und Extras: Die Optionen und Extras konnten nicht gelesen werden.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', DE)).toEqual([])
  })
})

const toast = vi.fn()
function ProductHarness({ initial }: { initial: Translations | null }) {
  const [tr, setTr] = useState<Translations | null | undefined>(initial)
  return (
    <ProductTranslations
      restaurantId="r1"
      name="Supă"
      description="Caldă"
      translations={tr}
      onChange={(update) => setTr((prev) => update(prev))}
      langs={['en']}
      baseLang="ro"
      canTranslateAi
      onToast={toast}
    />
  )
}

// Părintele ține ciornele, ca fișa produsului.
function ExtraHarness() {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const [tr, setTr] = useState<Translations>({ en: { name: 'Bacon EN' } })
  return (
    <ExtraTranslations
      extra={{ id: 'e1', name: 'Bacon', translations: tr }}
      langs={['en', 'de']}
      baseLang="ro"
      drafts={drafts}
      onDraftsChange={(_id, update) => setDrafts(update)}
      onSaved={(_id, t) => setTr(t)}
      onToast={toast}
    />
  )
}

describe('traducerile din fișa produsului în limba personalului', () => {
  beforeEach(() => toast.mockReset())

  it('LX5: ProductTranslations în germană; refuzul AI fără mesajul românesc', async () => {
    const quota = () => Object.assign(new Error(QUOTA_RO), { code: 'quota_exceeded', status: 429 })

    // Control: în română, mesajul serverului, ca înainte.
    h.translate.mockRejectedValueOnce(quota())
    const first = inLang(null, <ProductHarness initial={null} />)
    await userEvent.click(screen.getByRole('button', { name: /Traduceri \(opțional\)/ }))
    await userEvent.click(screen.getByRole('button', { name: '✨ Tradu automat' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(QUOTA_RO, 'error'))
    first.unmount()
    toast.mockReset()

    h.translate.mockRejectedValueOnce(quota())
    const { container } = inLang('de', <ProductHarness initial={{ en: { name: 'Soup', ai_fields: ['name'] } }} />)
    await userEvent.click(screen.getByRole('button', { name: /Übersetzungen \(optional\)/ }))
    expect(screen.getByText('🇬🇧 Englisch')).toBeInTheDocument()
    expect(screen.getByLabelText('Name (Englisch)')).toHaveValue('Soup')
    expect(screen.getByLabelText('Beschreibung (Englisch)')).toHaveAttribute('placeholder', 'Caldă')
    expect(screen.getByText('✨ automatisch übersetzt — bitte prüfen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Als geprüft markieren' })).toBeInTheDocument()
    expect(screen.getByText(/Das Original oben \(Rumänisch\) bleibt die Grundlage/)).toBeInTheDocument()
    expect(romanianLeftovers(container.textContent ?? '', DE)).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '✨ Automatisch übersetzen' }))
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    const [msg, kind] = toast.mock.calls[0] as [string, string]
    expect(kind).toBe('error')
    expect(msg).toBe(trDe.err_aiQuota)
    expect(msg).not.toContain('limita lunară')
  })

  it('LX6: ExtraTranslations în engleză, cu butonul pomenit de fișă', async () => {
    const { container } = inLang('en', <ExtraHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Translations 1/2' }))
    expect(screen.getByText('Saved straight away, separately from “Save”.')).toBeInTheDocument()
    expect(screen.getByText('🇩🇪 German')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Name in German for “Bacon”'), 'Speck')
    await userEvent.click(screen.getByRole('button', { name: 'Save translations' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('The extra’s translations have been saved.'))
    expect(romanianLeftovers(container.textContent ?? '', EN)).toEqual([])

    // Dialogul de închidere a fișei numește ACELAȘI buton, în fiecare limbă.
    expect(productsEn.extraTr_desc).toContain(`“${trEn.ex_save}”`)
    expect(productsFr.extraTr_desc).toContain(`« ${trFr.ex_save} »`)
    expect(productsDe.extraTr_desc).toContain(`„${trDe.ex_save}“`)
  })
})
