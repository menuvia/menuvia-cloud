// Fila Meniu → Categorii în limba personalului (lotul L5b): CategoriesTab
// (lista, modalul de categorie cu editorul manual de traduceri, ștergerea cu
// mutarea produselor) citește namespace-ul `categories` (+ „Anulează”/
// „Salvează”/„Șterge”/„Reîncearcă” din `common`, numele limbilor MENIULUI din
// `translations`). Testele de comportament (traducerile salvate, limbile
// neactive păstrate, ordinea) rămân în CategoriesTab.test.tsx, NESCHIMBATE —
// aici e doar limba.
// (Prefixul CG: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   CG0  control POZITIV al verificării „fără text românesc”: lista randată în
//        română, comparată cu dicționarul englez, ARE resturi. Fără el,
//        CG2–CG5 ar trece și cu o verificare stricată.
//   CG1  fără provider (azi, mereu româna): pluralele false de dinainte („2
//        categorii”, „1 produs”, „0 produse”), butoanele și numele accesibile.
//        Mutația care pică: `count` cu `one: '{n} categorie'` sau
//        `productsCount` cu „de” la `other`.
//   CG2  lista în engleză: contorul, pluralele, numele accesibile ale
//        săgeților/editării/ștergerii, fără resturi românești. Mutația care
//        pică: un literal românesc lăsat în listă (ex. `aria-label="Mută mai
//        sus"` readus).
//   CG3  modalul în franceză, cu traducerile: eticheta fiecărei limbi a
//        meniului vine din `translations` („Nom (anglais)”), nota numește
//        limba de BAZĂ („… le nom en roumain.”), „Annuler”/„Enregistrer” din
//        `common`. Mutația care pică: `MENU_LANGS[].label` readus în etichetă.
//   CG4  ștergerea în germană: întrebarea la singular, opțiunea „fără
//        categorie” și avertismentul ei. Mutația care pică: ternarul
//        `delCount === 1 ? 'Mută produsul…' : …` readus.
//   CG5  refuzul serverului la salvare: în română EXACT textul de dinainte (cu
//        mesajul românesc al serverului); în engleză clasa erorii, fără
//        mesajul românesc; schimbarea limbii cu eroarea pe ecran (ACEEAȘI
//        rădăcină `UiLangScope`) o retraduce în germană — eroarea e ținută ca
//        DATĂ. Mutația care pică: `setSaveError(toUserMessage(…))` (text
//        compus la salvare) sau `toUserMessage` readus în `handleSave`.
//   CG6  citirea produselor refuzată: QueryError cu clasa erorii în franceză
//        și butonul „Réessayer”. Mutația care pică: `setProdError(
//        toUserMessage(pe))` readus.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category } from '../../hooks/useData'

type DbError = { message: string; code?: string; hint?: string }

const h = vi.hoisted(() => ({
  categories: [] as Category[],
  update: vi.fn(),
  create: vi.fn(),
  prodRows: [] as { id: string; category_id: string | null }[],
  prodError: null as DbError | null,
}))

vi.mock('../../hooks/useData', () => ({
  useCategories: () => ({
    categories: h.categories,
    loading: false,
    error: null,
    create: h.create,
    update: h.update,
    remove: vi.fn(async () => ({ error: null })),
    reorder: vi.fn(async () => ({ error: null })),
    refetch: vi.fn(),
  }),
}))

// Numărătoarea de produse: .from('products').select().eq()… → thenable.
vi.mock('../../lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update']) builder[m] = () => builder
  builder.then = (resolve: (v: { data: unknown[] | null; error: DbError | null }) => unknown) =>
    Promise.resolve(
      h.prodError ? { data: null, error: h.prodError } : { data: h.prodRows, error: null },
    ).then(resolve)
  return { supabase: { from: () => builder } }
})

import CategoriesTab from '../CategoriesTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { categoriesNs } from '../../i18n/ns/categories'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'
import categoriesRo from '../../i18n/ns/categories/ro'
import categoriesEn from '../../i18n/ns/categories/en'
import categoriesFr from '../../i18n/ns/categories/fr'
import categoriesDe from '../../i18n/ns/categories/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
import { toUserMessage } from '../../lib/userMessages'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [
      preloadNamespace(categoriesNs, l),
      preloadNamespace(commonNs, l),
      preloadNamespace(translationsNs, l),
    ]),
  )
})

function category(id: string, name: string, order: number): Category {
  return { id, restaurant_id: 'rest-1', name, emoji: '🍲', display_order: order, meta_text: null }
}

beforeEach(() => {
  h.categories = [category('cat-1', 'Ciorbe', 0), category('cat-2', 'Deserturi', 1)]
  h.prodRows = [{ id: 'p1', category_id: 'cat-1' }]
  h.prodError = null
  h.update.mockReset()
  h.create.mockReset()
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

function tab(props: { menuLanguages?: string[]; baseLang?: string } = {}) {
  return <CategoriesTab restaurantId="rest-1" menuLanguages={props.menuLanguages ?? []} baseLang={props.baseLang} />
}

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [categoriesEn as Dict, commonEn as Dict],
  fr: [categoriesFr as Dict, commonFr as Dict],
  de: [categoriesDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/** Fragmentele românești ale lui `categories` + `common` rămase în text (fără
 *  cele identice în limba țintă). Un text cu locuri `{x}` se verifică pe
 *  bucățile lui fixe de cel puțin 6 caractere, ca cuvinte întregi. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [categoriesRo as Dict, commonRo as Dict]
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

describe('lista de categorii în limba personalului', () => {
  it('CG0: control pozitiv — lista românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('1 produs')
    const left = romanianLeftovers(nodeText(container), 'en')
    expect(left.length).toBeGreaterThan(1)
    expect(left.some((l) => l.startsWith('add:'))).toBe(true)
  })

  it('CG1: fără provider, româna de dinainte (cu pluralele false)', async () => {
    inLang(null, tab())
    expect(await screen.findByText('1 produs')).toBeInTheDocument()
    expect(screen.getByText('0 produse')).toBeInTheDocument()
    expect(screen.getByText('2 categorii')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă categorie' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Mută mai sus' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Mută mai jos' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Editează categorie' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Șterge categorie' })).toHaveLength(2)
  })

  it('CG1b: fără provider, un singur element — tot „1 categorii”, ca înainte', async () => {
    h.categories = [category('cat-1', 'Ciorbe', 0)]
    inLang(null, tab())
    expect(await screen.findByText('1 categorii')).toBeInTheDocument()
  })

  it('CG2: lista în engleză, fără resturi românești', async () => {
    const { container } = inLang('en', tab())
    expect(await screen.findByText('1 product')).toBeInTheDocument()
    expect(screen.getByText('0 products')).toBeInTheDocument()
    expect(screen.getByText('2 categories')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Move up' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Move down' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Edit category' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete category' })).toHaveLength(2)
    expect(romanianLeftovers(nodeText(container), 'en')).toEqual([])
    expect(container.textContent).not.toMatch(/categorii|produs\b|Adaugă/)
  })

  it('CG2b: lista goală în germană', async () => {
    h.categories = []
    const { container } = inLang('de', tab())
    expect(await screen.findByText('Keine Kategorien')).toBeInTheDocument()
    expect(screen.getByText(categoriesDe.empty_desc)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Kategorie hinzufügen' })).toHaveLength(2)
    expect(romanianLeftovers(nodeText(container), 'de')).toEqual([])
  })
})

describe('modalul și ștergerea în limba personalului', () => {
  it('CG3: modalul în franceză, cu numele limbilor meniului din `translations`', async () => {
    const user = userEvent.setup()
    inLang('fr', tab({ menuLanguages: ['ro', 'en', 'de'], baseLang: 'ro' }))
    await user.click((await screen.findAllByRole('button', { name: 'Modifier la catégorie' }))[0]!)
    const dlg = await screen.findByRole('dialog', { name: 'Modifier la catégorie' })
    expect(within(dlg).getByText('Nom *')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Nom (anglais)')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Nom (allemand)')).toBeInTheDocument()
    expect(within(dlg).queryByLabelText(/roumain/)).not.toBeInTheDocument()
    expect(within(dlg).getByText(/affichent automatiquement le nom en roumain\.$/)).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Texte en italique sous le titre')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), 'fr')).toEqual([])
    expect(dlg.textContent).not.toMatch(/English|Deutsch|Română/)
  })

  it('CG4: ștergerea în germană (un produs de mutat)', async () => {
    const user = userEvent.setup()
    inLang('de', tab())
    await user.click((await screen.findAllByRole('button', { name: 'Kategorie löschen' }))[0]!)
    const dlg = await screen.findByRole('dialog', { name: 'Kategorie löschen' })
    expect(await within(dlg).findByText('Das Produkt dieser Kategorie verschieben nach:')).toBeInTheDocument()
    const sel = within(dlg).getByRole('combobox', { name: 'Produkte verschieben nach' })
    expect(within(sel).getByRole('option', { name: categoriesDe.del_none })).toBeInTheDocument()
    await user.selectOptions(sel, '')
    expect(within(dlg).getByRole('note')).toHaveTextContent(categoriesDe.del_noneNote)
    expect(within(dlg).getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), 'de')).toEqual([])
  })

  it('CG5: refuzul la salvare — româna de dinainte, engleza fără mesajul serverului, retradus la schimbarea limbii', async () => {
    const serverRo = 'Numele categoriei e deja folosit în acest meniu.'
    const err = { message: serverRo, code: 'P0001' }
    h.update.mockResolvedValue({ data: null, error: err })
    const user = userEvent.setup()

    // Control: în română, exact textul de dinainte (mesajul serverului).
    const roView = inLang(null, tab())
    await user.click((await screen.findAllByRole('button', { name: 'Editează categorie' }))[0]!)
    await user.click(screen.getByRole('button', { name: 'Salvează' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Nu s-a putut salva categoria: ${toUserMessage(err, 'Categoria nu a putut fi salvată.')}`,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(serverRo)
    roView.unmount()

    const node = tab()
    const { rerender } = render(tree('en', node))
    await user.click((await screen.findAllByRole('button', { name: 'Edit category' }))[0]!)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`The category couldn’t be saved: ${commonEn.err_generic}`)
    expect(document.body.textContent).not.toContain(serverRo)

    // ACEEAȘI rădăcină: modalul și eroarea rămân, textul se recompune.
    rerender(tree('de', node))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Die Kategorie konnte nicht gespeichert werden: ${commonDe.err_generic}`,
    )
    expect(screen.getByRole('dialog', { name: 'Kategorie bearbeiten' })).toBeInTheDocument()
  })

  it('CG6: citirea produselor refuzată — clasa erorii în franceză', async () => {
    h.prodError = { message: 'permission denied for table products', code: '42501' }
    inLang('fr', tab())
    expect(await screen.findByText(commonFr.err_permission)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: commonFr.retry })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('permission denied')
    expect(document.body.textContent).not.toContain(commonRo.err_permission)
  })
})
