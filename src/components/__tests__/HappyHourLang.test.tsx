// Fila Promoții (Happy Hour) în limba personalului (lotul L5b): HappyHourTab
// (lista regulilor, bannerul „ACTIVĂ ACUM”, editorul de regulă, confirmarea
// ștergerii) citește namespace-ul `promotions` (+ „Anulează”/„Șterge”/
// „Editează” din `common`); zilele vin din `lib/happyHourDays.ts` (partea pură
// e în src/lib/__tests__/happyHourDays.test.ts, HP7–HP9).
// (Prefixul HP: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   HP0  control POZITIV al verificării „fără text românesc”: lista randată în
//        română, comparată cu dicționarul englez, ARE resturi.
//   HP1  fără provider (azi, mereu româna): cardul regulii — „ACTIVĂ”/„OPRITĂ”,
//        zilele „Du Lu Vi” (1 = duminică), „Toate zilele”, „−20% (max 30
//        lei)”, „−15 lei”, „Pe tot”, bannerul „ACTIVĂ ACUM” cu „Happy · 20%”.
//        Mutația care pică: `day_1: 'Lu'` (zilele decalate) sau `activeNow`
//        cu `one: 'ACTIVE ACUM (1)'`.
//   HP2  lista în engleză: aceleași, zilele „Su Mo Fr”, fără resturi
//        românești. Mutația care pică: `DAY_LABELS[d - 1]` readus în RuleCard.
//   HP3  editorul în germană: titlul, etichetele, zilele în ordinea de
//        dinainte (duminica prima), validarea ținută ca DATE (numele, apoi
//        valoarea). Mutația care pică: `setErr('Numele e obligatoriu')` sau
//        `DAY_LABELS.map` readus în editor.
//   HP4  confirmarea ștergerii în franceză: întrebarea cu numele în <strong>
//        (fillNodes — ordinea cuvintelor e a limbii), „Annuler”/„Supprimer”.
//        Mutația care pică: „Vrei să ștergi” lăsat în cod.
//   HP5  refuzul serverului la salvare: în română EXACT `toUserMessage(err,
//        'Eroare la salvare')` de dinainte; în engleză clasa erorii, fără
//        mesajul românesc al serverului; schimbarea limbii cu eroarea pe ecran
//        (ACEEAȘI rădăcină) o retraduce în germană. Mutația care pică:
//        `setErr(toUserMessage(e, …))` (text compus la salvare).
//   HP6  încărcarea refuzată, în franceză: bannerul cu clasa erorii și butonul
//        „Fermer l’erreur”, fără mesajul românesc.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HappyHourRule, ActiveRule } from '../../lib/happyHour'

const h = vi.hoisted(() => ({
  rules: [] as HappyHourRule[],
  active: [] as ActiveRule[],
  fetchError: null as unknown,
  saveError: null as unknown,
}))

vi.mock('../../lib/happyHour', () => ({
  fetchHappyHourRules: async () => {
    if (h.fetchError) throw h.fetchError
    return h.rules
  },
  evaluateHappyHourForNow: async () => h.active,
  createHappyHourRule: async () => {
    if (h.saveError) throw h.saveError
    return h.rules[0]
  },
  updateHappyHourRule: async () => {
    if (h.saveError) throw h.saveError
  },
  deleteHappyHourRule: async () => {},
}))
vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order']) b[m] = () => b
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data: table === 'categories' ? [{ id: 'c1', name: 'Cocktailuri', emoji: '🍹' }] : [],
        error: null,
      }).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../hooks/usePollWhileVisible', () => ({ usePollWhileVisible: () => {} }))
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import HappyHourTab from '../HappyHourTab'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { promotionsNs } from '../../i18n/ns/promotions'
import { commonNs } from '../../i18n/ns/common'
import promotionsRo from '../../i18n/ns/promotions/ro'
import promotionsEn from '../../i18n/ns/promotions/en'
import promotionsFr from '../../i18n/ns/promotions/fr'
import promotionsDe from '../../i18n/ns/promotions/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'
import { toUserMessage } from '../../lib/userMessages'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(promotionsNs, l), preloadNamespace(commonNs, l)]))
})

function rule(over: Partial<HappyHourRule>): HappyHourRule {
  return {
    id: 'r1',
    restaurant_id: 'rest-1',
    name: 'Happy',
    is_active: true,
    starts_at: '17:00:00',
    ends_at: '19:00:00',
    days_of_week: [1, 2, 6],
    scope: 'all',
    category_id: null,
    product_id: null,
    discount_type: 'percent',
    discount_value: 20,
    max_discount: 30,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  h.rules = [
    rule({}),
    rule({
      id: 'r2',
      name: 'Weekend',
      is_active: false,
      days_of_week: [],
      scope: 'category',
      category_id: 'c1',
      discount_type: 'amount',
      discount_value: 15,
      max_discount: null,
    }),
  ]
  h.active = [
    {
      id: 'r1',
      name: 'Happy',
      scope: 'all',
      category_id: null,
      product_id: null,
      discount_type: 'percent',
      discount_value: 20,
      max_discount: 30,
    },
  ]
  h.fetchError = null
  h.saveError = null
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))
const tab = (payAtTable = false) => <HappyHourTab restaurantId="rest-1" payAtTable={payAtTable} />

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [promotionsEn as Dict, commonEn as Dict],
  fr: [promotionsFr as Dict, commonFr as Dict],
  de: [promotionsDe as Dict, commonDe as Dict],
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

/** Fragmentele românești ale lui `promotions` + `common` rămase în text (fără
 *  cele identice în limba țintă). Un text cu locuri `{x}` se verifică pe
 *  bucățile lui fixe de cel puțin 6 caractere, ca cuvinte întregi. Zilele
 *  („Du”, „Sâ”) sunt prea scurte pentru verificare — le acoperă HP2/HP3. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [promotionsRo as Dict, commonRo as Dict]
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

/** Textul vizibil + numele accesibile/indiciile. */
function visibleText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [nodeText(root), ...attrs].join('\n')
}

const dayButtons = (labels: readonly string[]): string[] =>
  screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => labels.includes(t))

describe('lista regulilor în limba personalului', () => {
  it('HP0: control pozitiv — lista românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('Weekend')
    const left = romanianLeftovers(visibleText(container), 'en')
    expect(left.length).toBeGreaterThan(3)
    expect(left.some((l) => l.startsWith('days_all:'))).toBe(true)
    expect(left.some((l) => l.startsWith('deleteAria:'))).toBe(true)
  })

  it('HP1: fără provider, româna de dinainte', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('Weekend')
    const text = container.textContent ?? ''
    expect(screen.getByText('ACTIVĂ ACUM')).toBeInTheDocument()
    expect(text).toContain('Happy · 20%')
    expect(screen.getByText('ACTIVĂ')).toBeInTheDocument()
    expect(screen.getByText('OPRITĂ')).toBeInTheDocument()
    expect(text).toContain('17:00–19:00')
    expect(text).toContain('Du Lu Vi')
    expect(text).toContain('Toate zilele')
    expect(text).toContain('Pe tot')
    expect(text).toContain('🍹 Cocktailuri')
    expect(text).toContain('−20% (max 30 lei)')
    expect(text).toContain('−15 lei')
    expect(screen.getByRole('button', { name: 'Oprește' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pornește' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Editează' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Șterge regula Happy' })).toBeInTheDocument()
    expect(text).toContain(promotionsRo.intro_auto)
  })

  it('HP1b: două reguli active acum — „ACTIVE ACUM (2)”, ca înainte', async () => {
    h.active = [...h.active, { ...h.active[0]!, id: 'r3', name: 'Seara' }]
    inLang(null, tab(true))
    expect(await screen.findByText('ACTIVE ACUM (2)')).toBeInTheDocument()
    expect(screen.getByText(promotionsRo.intro_payAtTable)).toBeInTheDocument()
  })

  it('HP2: lista în engleză, fără resturi românești', async () => {
    const { container } = inLang('en', tab())
    await screen.findByText('Weekend')
    const text = container.textContent ?? ''
    expect(screen.getByText('ACTIVE NOW')).toBeInTheDocument()
    expect(text).toContain('Happy · 20%')
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByText('OFF')).toBeInTheDocument()
    expect(text).toContain('Su Mo Fr')
    expect(text).toContain('Every day')
    expect(text).toContain('Everything')
    expect(text).toContain('−20% (max 30 lei)')
    expect(text).toContain('−15 lei')
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Delete the rule Happy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New rule' })).toBeInTheDocument()
    expect(romanianLeftovers(visibleText(container), 'en')).toEqual([])
    expect(text).not.toMatch(/Du Lu|ACTIVĂ|OPRITĂ/)
  })

  it('HP2b: fără reguli, în franceză', async () => {
    h.rules = []
    h.active = []
    const { container } = inLang('fr', tab(true))
    expect(await screen.findByText('Aucune règle pour l’instant')).toBeInTheDocument()
    expect(screen.getByText(promotionsFr.empty_payAtTable)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Première règle' })).toBeInTheDocument()
    expect(romanianLeftovers(visibleText(container), 'fr')).toEqual([])
  })
})

describe('editorul și ștergerea în limba personalului', () => {
  it('HP3: editorul în germană, cu zilele în ordinea de dinainte și validarea', async () => {
    const user = userEvent.setup()
    const { container } = inLang('de', tab())
    await screen.findByText('Weekend')
    await user.click(screen.getByRole('button', { name: 'Neue Regel' }))
    expect(screen.getByRole('heading', { name: 'Neue Regel' })).toBeInTheDocument()
    expect(screen.getByText('Wochentage (leer = alle)')).toBeInTheDocument()
    expect(screen.getByText('Gilt für')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prozent (%)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fester Betrag (lei)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Höchstbetrag in lei, optional')).toBeInTheDocument()
    expect(screen.getByText('Regel sofort aktiv')).toBeInTheDocument()
    expect(dayButtons(['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'])).toEqual(['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'])

    await user.click(screen.getByRole('button', { name: 'Regel anlegen' }))
    expect(screen.getByText('Der Name ist erforderlich')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('z. B. Happy Hour 17–19 Uhr'), 'Abend')
    await user.clear(screen.getByLabelText('Rabattwert'))
    await user.type(screen.getByLabelText('Rabattwert'), '0')
    await user.click(screen.getByRole('button', { name: 'Regel anlegen' }))
    expect(screen.getByText('Der Rabattwert muss positiv sein')).toBeInTheDocument()
    expect(screen.queryByText('Der Name ist erforderlich')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kategorie' }))
    expect(screen.getByRole('option', { name: '— Kategorie auswählen —' })).toBeInTheDocument()
    expect(romanianLeftovers(visibleText(container), 'de')).toEqual([])
    expect(document.body.textContent).not.toMatch(/Zilele|Aplicare|Reducere|Lu Ma/)
  })

  it('HP3b: în română, zilele editorului sunt exact cele de dinainte', async () => {
    const user = userEvent.setup()
    inLang(null, tab())
    await screen.findByText('Weekend')
    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    expect(screen.getByRole('heading', { name: 'Regulă nouă' })).toBeInTheDocument()
    const ro = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ']
    expect(dayButtons(ro)).toEqual(ro)
    await user.click(screen.getByRole('button', { name: 'Creează regulă' }))
    expect(screen.getByText('Numele e obligatoriu')).toBeInTheDocument()
  })

  it('HP4: confirmarea ștergerii în franceză', async () => {
    const user = userEvent.setup()
    inLang('fr', tab())
    await screen.findByText('Weekend')
    await user.click(screen.getByRole('button', { name: 'Supprimer la règle Happy' }))
    const title = screen.getByRole('heading', { name: 'Supprimer la règle ?' })
    const box = title.parentElement as HTMLElement
    expect(box.textContent).toContain('Voulez-vous supprimer Happy ? Cette action est irréversible.')
    expect(box.querySelector('strong')?.textContent).toBe('Happy')
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(box), 'fr')).toEqual([])
  })

  it('HP5: refuzul la salvare — româna de dinainte, engleza fără mesajul serverului, retradus la schimbarea limbii', async () => {
    const serverRo = 'Nu ai voie să modifici regulile acestui restaurant.'
    h.saveError = { message: serverRo, code: '42501' }
    const user = userEvent.setup()

    const roView = inLang(null, tab())
    await screen.findByText('Weekend')
    await user.click(screen.getAllByRole('button', { name: 'Editează' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Salvează modificări' }))
    expect(await screen.findByText(toUserMessage(h.saveError, 'Eroare la salvare'))).toBeInTheDocument()
    roView.unmount()

    const node = tab()
    const { rerender } = render(tree('en', node))
    await screen.findByText('Weekend')
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    expect(screen.getByRole('heading', { name: 'Edit rule' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(commonEn.err_permission)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(serverRo)

    // ACEEAȘI rădăcină: editorul și eroarea rămân, textul se recompune.
    rerender(tree('de', node))
    expect(await screen.findByText(commonDe.err_permission)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Regel bearbeiten' })).toBeInTheDocument()
  })

  it('HP6: încărcarea refuzată, în franceză', async () => {
    const serverRo = 'Regulile nu au putut fi citite.'
    h.fetchError = { message: serverRo, code: 'P0001' }
    inLang('fr', tab())
    expect(await screen.findByRole('button', { name: 'Fermer l’erreur' })).toBeInTheDocument()
    expect(document.body.textContent).toContain(commonFr.err_generic)
    expect(document.body.textContent).not.toContain(serverRo)
  })
})
