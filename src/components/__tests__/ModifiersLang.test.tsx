// Fila Meniu → Opțiuni în limba personalului (lotul L5b): ModifiersTab (lista
// grupurilor, dialogul „Grup nou / Editează grup” cu traducerile, „Alege
// produsele”, confirmările) citește namespace-ul `modifiers` (+ „Anulează”/
// „Salvează”/„Șterge”/„Editează”/„Reîncearcă” din `common`, numele limbilor
// MENIULUI din `translations`). Comportamentul (legăturile, confirmarea
// ultimei opțiuni) rămâne în ModifiersTabLinks.test.tsx, NESCHIMBAT. Partea
// pură (refuzurile cu hint-uri) e în src/lib/__tests__/modifierMessages.test.ts
// (MG7–MG9).
// (Prefixul MG: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   MG0  control POZITIV al verificării „fără text românesc”: lista randată în
//        română, comparată cu dicționarul englez, ARE resturi.
//   MG1  fără provider (azi, mereu româna): textele de dinainte ale cardului —
//        „Selecție unică”, „ · max 2 opțiuni”, „Obligatoriu”, „Folosit de 2
//        produse”, „Inclus”, „+3 lei”, „−1,5 lei”, numele accesibile. Mutația
//        care pică: `card_max` cu „de” sau `price_minus` cu „-” în loc de „−”.
//   MG2  lista în engleză, fără resturi românești (inclusiv `aria-label`/
//        `title`/`placeholder`). Mutația care pică: `aria-label={'Nume opțiune
//        nouă pentru grupul ' + g.name}` readus.
//   MG3  dialogul de grup în germană: etichetele, indiciile, validarea numelui
//        (ținută ca DATĂ), câmpurile de traducere cu numele limbii din
//        `translations` („Englisch”, nu „English”). Mutația care pică:
//        `meta?.label` readus în placeholder/aria-label sau
//        `setError('Numele e obligatoriu')`.
//   MG4  confirmările în franceză: ștergerea grupului (titlul cu numele,
//        descrierea cu pluralul, „Supprimer”/„Annuler” EXPLICITE — implicitul
//        urmează <html lang>) și ultima opțiune a unui grup obligatoriu.
//        Mutația care pică: `cancelLabel` scos sau titlul românesc readus.
//   MG5  refuzul la „Alege produsele” cu hint (`group_not_found`, mig 319): în
//        română EXACT `toUserMessage(err, rezerva)` de dinainte; în engleză
//        textul hint-ului, fără mesajul românesc al serverului; schimbarea
//        limbii cu eroarea pe ecran (ACEEAȘI rădăcină) o retraduce în germană.
//        Mutația care pică: `setError(toUserMessage(e, …))` readus.
//   MG6  refuzul la adăugarea unei opțiuni, cu mesaj românesc FĂRĂ hint: în
//        franceză clasa erorii din `common` (`err_generic`), nu textul
//        serverului; în română textul serverului, ca înainte.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type DbError = { message: string; code?: string; hint?: string }

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  insertError: null as DbError | null,
  pickError: null as Error | null,
  confirm: vi.fn(async () => false),
}))

vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    let op = 'select'
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b
    for (const m of ['insert', 'update', 'delete'])
      b[m] = () => {
        op = m
        return b
      }
    b.then = (resolve: (v: { data: unknown[] | null; error: DbError | null }) => unknown) =>
      Promise.resolve(
        op === 'insert' && h.insertError
          ? { data: null, error: h.insertError }
          : { data: op === 'select' ? (h.tables[table] ?? []) : [{ id: 'x' }], error: null },
      ).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../lib/modifierLinks', () => ({
  fetchModifierGroupLinks: async () => h.tables.product_modifier_groups ?? [],
  fetchLinkableProducts: async () => h.tables.products ?? [],
  setModifierGroupProducts: async () => {
    if (h.pickError) throw h.pickError
  },
}))
vi.mock('../ui/confirm', () => ({ confirm: h.confirm }))

import ModifiersTab from '../ModifiersTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { modifiersNs } from '../../i18n/ns/modifiers'
import { commonNs } from '../../i18n/ns/common'
import { translationsNs } from '../../i18n/ns/translations'
import modifiersRo from '../../i18n/ns/modifiers/ro'
import modifiersEn from '../../i18n/ns/modifiers/en'
import modifiersFr from '../../i18n/ns/modifiers/fr'
import modifiersDe from '../../i18n/ns/modifiers/de'
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
      preloadNamespace(modifiersNs, l),
      preloadNamespace(commonNs, l),
      preloadNamespace(translationsNs, l),
    ]),
  )
})

beforeEach(() => {
  h.tables.modifier_groups = [
    { id: 'g-blat', name: 'Blat', selection_type: 'single', is_required: true, min_select: 1, max_select: null, display_order: 0 },
    { id: 'g-top', name: 'Topping', selection_type: 'multiple', is_required: false, min_select: 0, max_select: 2, display_order: 1 },
  ]
  h.tables.modifier_options = [
    { id: 'o-sub', modifier_group_id: 'g-blat', name: 'Subțire', price_delta: 0, is_available: true, display_order: 0 },
    { id: 'o-ext', modifier_group_id: 'g-top', name: 'Extra brânză', price_delta: 3, is_available: true, display_order: 0 },
    { id: 'o-fara', modifier_group_id: 'g-top', name: 'Fără ceapă', price_delta: -1.5, is_available: true, display_order: 1 },
  ]
  h.tables.products = [
    { id: 'p-dia', name: 'Diavola' },
    { id: 'p-mar', name: 'Margherita' },
  ]
  h.tables.product_modifier_groups = [
    { product_id: 'p-mar', modifier_group_id: 'g-blat', display_order: 0 },
    { product_id: 'p-dia', modifier_group_id: 'g-blat', display_order: 0 },
  ]
  h.insertError = null
  h.pickError = null
  h.confirm.mockClear()
  h.confirm.mockResolvedValue(false)
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))
const tab = (menuLanguages: string[] = []) => <ModifiersTab restaurantId="r1" menuLanguages={menuLanguages} />

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [modifiersEn as Dict, commonEn as Dict],
  fr: [modifiersFr as Dict, commonFr as Dict],
  de: [modifiersDe as Dict, commonDe as Dict],
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

/** Fragmentele românești ale lui `modifiers` + `common` rămase în text (fără
 *  cele identice în limba țintă). Un text cu locuri `{x}` se verifică pe
 *  bucățile lui fixe de cel puțin 6 caractere, ca cuvinte întregi. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [modifiersRo as Dict, commonRo as Dict]
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

/** Textul vizibil + numele accesibile/indiciile (aria-label, title,
 *  placeholder) — un rest românesc poate sta și într-un atribut. */
function visibleText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [nodeText(root), ...attrs].join('\n')
}

function card(name: string, newOptionLabel: (g: string) => string, pickLabel: string): HTMLElement {
  let el: HTMLElement | null = screen.getByLabelText(newOptionLabel(name))
  while (el && !within(el).queryByRole('button', { name: pickLabel })) el = el.parentElement
  if (!el) throw new Error(`card ${name} negăsit`)
  return el
}

describe('lista grupurilor de opțiuni în limba personalului', () => {
  it('MG0: control pozitiv — lista românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('Folosit de 2 produse')
    const left = romanianLeftovers(visibleText(container), 'en')
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('card_pick:'))).toBe(true)
    expect(left.some((l) => l.startsWith('opt_nameAria:'))).toBe(true)
  })

  it('MG1: fără provider, româna de dinainte', async () => {
    const { container } = inLang(null, tab())
    expect(await screen.findByText('Folosit de 2 produse')).toBeInTheDocument()
    expect(screen.getByText('Nu e folosit de niciun produs — clienții nu îl văd')).toBeInTheDocument()
    expect(screen.getByText('Grupuri de opțiuni (ex: Extra sos, Mărime)')).toBeInTheDocument()
    expect(container.textContent).toContain('Selecție unicăObligatoriu')
    expect(container.textContent).toContain('Selecție multiplă · max 2 opțiuni')
    expect(screen.getByText('Inclus')).toBeInTheDocument()
    expect(screen.getByText('+3 lei')).toBeInTheDocument()
    expect(screen.getByText('−1,5 lei')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Alege produsele' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Șterge grup' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Marchează indisponibil' })).toHaveLength(3)
    expect(screen.getByLabelText('Nume opțiune nouă pentru grupul Blat')).toHaveAttribute('placeholder', 'Nume opțiune')
    expect(screen.getByLabelText('Preț suplimentar pentru opțiunea nouă din grupul Blat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grup nou' })).toBeInTheDocument()
  })

  it('MG2: lista în engleză, fără resturi românești (și în atribute)', async () => {
    const { container } = inLang('en', tab())
    expect(await screen.findByText('Used by 2 products')).toBeInTheDocument()
    expect(screen.getByText('Not used by any product — guests don’t see it')).toBeInTheDocument()
    expect(container.textContent).toContain('Single choiceRequired')
    expect(container.textContent).toContain('Multiple choice · max 2 options')
    expect(screen.getByText('Included')).toBeInTheDocument()
    expect(screen.getByText('+3 lei')).toBeInTheDocument()
    expect(screen.getByText('−1,5 lei')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Choose products' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete group' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Mark unavailable' })).toHaveLength(3)
    expect(screen.getAllByTitle('Available')).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Delete option' })).toHaveLength(3)
    expect(screen.getByLabelText('New option name for the group Blat')).toHaveAttribute('placeholder', 'Option name')
    expect(romanianLeftovers(visibleText(container), 'en')).toEqual([])
  })
})

describe('dialogurile în limba personalului', () => {
  it('MG3: dialogul de grup în germană, cu traducerile și validarea', async () => {
    const user = userEvent.setup()
    inLang('de', tab(['en']))
    await screen.findByText('Von 2 Produkten verwendet')
    await user.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]!)
    const dlg = await screen.findByRole('dialog', { name: 'Gruppe bearbeiten' })
    expect(within(dlg).getByText('Auswahlart')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Eine Option' })).toBeInTheDocument()
    expect(within(dlg).getByText(modifiersDe.type_singleHint)).toBeInTheDocument()
    expect(within(dlg).getByText('Muss der Gast wählen?')).toBeInTheDocument()
    expect(within(dlg).getByText(modifiersDe.req_yesHint)).toBeInTheDocument()
    expect(within(dlg).getByText('Übersetzungen')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Blat — Englisch')).toHaveAttribute('placeholder', '🇬🇧 Englisch')
    expect(within(dlg).getByLabelText('Subțire — Englisch')).toBeInTheDocument()

    await user.clear(within(dlg).getByPlaceholderText('Extra-Topping'))
    expect(within(dlg).getByLabelText('Gruppe — Englisch')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Speichern' }))
    expect(within(dlg).getByText('Der Name ist erforderlich')).toBeInTheDocument()
    expect(romanianLeftovers(visibleText(dlg), 'de')).toEqual([])
    expect(visibleText(dlg)).not.toContain('English')
  })

  it('MG4: confirmările în franceză, cu butoanele explicite', async () => {
    const user = userEvent.setup()
    inLang('fr', tab())
    await screen.findByText('Utilisé par 2 produits')
    await user.click(screen.getAllByRole('button', { name: 'Supprimer le groupe' })[1]!)
    expect(h.confirm).toHaveBeenCalledWith({
      title: 'Supprimer le groupe « Topping » ?',
      description: 'Ses 2 options seront aussi supprimées définitivement.',
      confirmLabel: commonFr.delete,
      cancelLabel: commonFr.cancel,
      destructive: true,
    })

    const blat = card('Blat', (g) => `Nom de la nouvelle option du groupe ${g}`, 'Choisir les produits')
    await user.click(within(blat).getByRole('button', { name: 'Marquer indisponible' }))
    expect(h.confirm).toHaveBeenLastCalledWith({
      title: 'Aucune option disponible dans « Blat » ?',
      description: modifiersFr.lastOff_desc.other.replace('{n}', '2'),
      confirmLabel: 'Marquer indisponible',
      cancelLabel: commonFr.cancel,
      destructive: true,
    })
  })

  it('MG4b: confirmarea în română păstrează textele de dinainte', async () => {
    const user = userEvent.setup()
    inLang(null, tab())
    await screen.findByText('Folosit de 2 produse')
    await user.click(screen.getAllByRole('button', { name: 'Șterge grup' })[1]!)
    expect(h.confirm).toHaveBeenCalledWith({
      title: 'Ștergi grupul „Topping"?',
      description: 'Se șterg definitiv și cele 2 opțiuni ale lui.',
      confirmLabel: 'Șterge',
      cancelLabel: 'Anulează',
      destructive: true,
    })
    const blat = card('Blat', (g) => `Nume opțiune nouă pentru grupul ${g}`, 'Alege produsele')
    await user.click(within(blat).getByRole('button', { name: 'Marchează indisponibil' }))
    expect(h.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Nicio opțiune disponibilă în „Blat”?',
        description:
          'Grupul e obligatoriu: cele 2 produse care îl folosesc nu se vor mai putea comanda până marchezi din nou o opțiune disponibilă.',
        confirmLabel: 'Marchează indisponibil',
      }),
    )
  })

  it('MG5: refuzul cu hint la „Alege produsele” — româna de dinainte, engleza tradusă, retradus în germană', async () => {
    const serverRo = 'Grupul nu există'
    h.pickError = Object.assign(new Error(serverRo), { code: 'P0002', hint: 'group_not_found' })
    const user = userEvent.setup()

    const roView = inLang(null, tab())
    await screen.findByText('Folosit de 2 produse')
    await user.click(screen.getAllByRole('button', { name: 'Alege produsele' })[0]!)
    let dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Salvează' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(
      toUserMessage(h.pickError, 'Nu am putut salva produsele grupului.'),
    )
    roView.unmount()

    const node = tab()
    const { rerender } = render(tree('en', node))
    await screen.findByText('Used by 2 products')
    await user.click(screen.getAllByRole('button', { name: 'Choose products' })[0]!)
    dlg = await screen.findByRole('dialog', { name: 'Products with “Blat”' })
    expect(within(dlg).getByText('2 products selected')).toBeInTheDocument()
    expect(within(dlg).getByPlaceholderText('Search product')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Save' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(modifiersEn.hint_groupNotFound)
    expect(document.body.textContent).not.toContain(serverRo)
    expect(romanianLeftovers(visibleText(dlg), 'en')).toEqual([])

    // ACEEAȘI rădăcină: dialogul și eroarea rămân, textul se recompune.
    rerender(tree('de', node))
    dlg = await screen.findByRole('dialog', { name: 'Produkte mit „Blat“' })
    expect(within(dlg).getByRole('alert')).toHaveTextContent(modifiersDe.hint_groupNotFound)
    expect(within(dlg).getByText('2 Produkte ausgewählt')).toBeInTheDocument()
  })

  it('MG6: refuz fără hint la adăugarea unei opțiuni — franceza fără textul serverului', async () => {
    const serverRo = 'Opțiunea nu a putut fi adăugată în acest grup.'
    h.insertError = { message: serverRo, code: 'P0001' }
    const user = userEvent.setup()

    const roView = inLang(null, tab())
    await screen.findByText('Folosit de 2 produse')
    await user.type(screen.getByLabelText('Nume opțiune nouă pentru grupul Blat'), 'Pufos')
    await user.click(within(card('Blat', (g) => `Nume opțiune nouă pentru grupul ${g}`, 'Alege produsele')).getByRole('button', { name: 'Adaugă' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(toUserMessage(h.insertError))
    roView.unmount()

    inLang('fr', tab())
    await screen.findByText('Utilisé par 2 produits')
    await user.type(screen.getByLabelText('Nom de la nouvelle option du groupe Blat'), 'Moelleux')
    const blat = card('Blat', (g) => `Nom de la nouvelle option du groupe ${g}`, 'Choisir les produits')
    await user.click(within(blat).getByRole('button', { name: 'Ajouter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(commonFr.err_generic)
    expect(document.body.textContent).not.toContain(serverRo)
  })
})
