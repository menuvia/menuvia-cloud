// „Toate locațiile” și „Adaugă o locație” în limba personalului (lotul L6b):
// LocationsTab citește namespace-ul `locations`, AddLocationCard textele lui
// din `settingsCards` (+ „Anulează”/„Închide”/„Reîncearcă” din `common`).
// Testele de comportament (LocationsTab.test.tsx LT1–LT6, AddLocationCard.test
// AL1–AL8) rămân NESCHIMBATE — aici e doar limba. Partea pură („Ultima
// comandă”, refuzul de limită) e în src/lib/__tests__/settingsCardsLang.test.ts
// (LN8–LN9).
// (Prefixul LN: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   LN0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi. Fără el, LN2–LN6
//        ar trece și cu o verificare stricată.
//   LN1  fără provider (azi, mereu româna): textele de dinainte, numele
//        accesibil „Deschide Bistro Gară”, „Nicio comandă încă”.
//   LN2  fila în engleză: cifrele, etichetele, „Currently selected”, „Open Bistro Gară”,
//        „No orders yet”, suma rămâne în lei (bani, ca azi), fără resturi
//        românești. Mutația care pică: un literal românesc readus (ex.
//        `label="Comenzi azi"`).
//   LN3  refuzul serverului la încărcare: în română EXACT textul serverului (ca
//        `toUserMessage`); în engleză rezerva tradusă, FĂRĂ mesajul brut; pe
//        aceeași rădăcină `UiLangScope`, trecut în germană, se retraduce —
//        eroarea e ținută ca DATĂ. Mutația care pică:
//        `setState({ status: 'error', text: toUserMessage(…) })` readus.
//   LN4  cardul „Adaugă o locație” și dialogul în franceză; validarea numelui
//        se retraduce în germană la schimbarea limbii (aceeași rădăcină).
//        Mutația care pică: `setError(tr.t('loc_err_nameRequired'))`.
//   LN5  refuzul de LIMITĂ (hint `upgrade_plan`) în engleză are text propriu,
//        fără textul românesc al serverului; în română rămâne
//        `MSG_LOCATION_LIMIT`. Mutația care pică: `describeCreateLocationError`
//        (doar română) readus în componentă.
//   LN6  eșecul AMBIGUU + lista necitibilă în germană: „Wir wissen nicht
//        sicher…” + „Neu laden” / „Schließen”, fără „Standort anlegen”.
//        Mutația care pică: `{MSG_CREATE_UNCERTAIN}` readus.
import { Suspense, type ReactNode } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LocationSummary } from '../../lib/locations'

const m = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), find: vi.fn(), reload: vi.fn() }))
vi.mock('../../lib/restaurants', () => ({ createRestaurant: m.create }))
vi.mock('../../lib/locations', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/locations')),
  fetchLocationsSummary: m.fetch,
  findCreatedLocation: m.find,
  hardReloadTo: m.reload,
}))

import LocationsTab from '../LocationsTab'
import AddLocationCard from '../AddLocationCard'
import { MSG_LOCATION_LIMIT } from '../../lib/locations'
import { toUserMessage } from '../../lib/userMessages'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { locationsNs } from '../../i18n/ns/locations'
import { settingsCardsNs } from '../../i18n/ns/settingsCards'
import { commonNs } from '../../i18n/ns/common'
import locRo from '../../i18n/ns/locations/ro'
import locEn from '../../i18n/ns/locations/en'
import locFr from '../../i18n/ns/locations/fr'
import locDe from '../../i18n/ns/locations/de'
import cardsRo from '../../i18n/ns/settingsCards/ro'
import cardsEn from '../../i18n/ns/settingsCards/en'
import cardsFr from '../../i18n/ns/settingsCards/fr'
import cardsDe from '../../i18n/ns/settingsCards/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

// Ceasul înghețat DOAR pe `Date` (recenzie CodeRabbit pe #374): „Ultima
// comandă” compară momentul fixturii cu „acum” în fusul României, deci o rulare
// care trece de miezul nopții între încărcarea modulului și randare ar fi dat
// „yesterday”. `setTimeout`/`setInterval` rămân reale, ca `findBy*` să aștepte
// normal. 08:32Z = 10:32 în România.
const NOW = new Date('2026-11-15T08:32:00Z')
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => {
  vi.useRealTimers()
})

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [
      preloadNamespace(locationsNs, l),
      preloadNamespace(settingsCardsNs, l),
      preloadNamespace(commonNs, l),
    ]),
  )
})

const A: LocationSummary = {
  id: 'r1',
  name: 'Bistro Centru',
  slug: 'bistro-centru',
  ordersToday: 12,
  openOrders: 3,
  revenueToday: 845.5,
  lastOrderAt: NOW.toISOString(),
}
const B: LocationSummary = {
  id: 'r2',
  name: 'Bistro Gară',
  slug: 'bistro-gara',
  ordersToday: 4,
  openOrders: 1,
  revenueToday: null,
  lastOrderAt: null,
}

beforeEach(() => {
  m.fetch.mockReset()
  m.create.mockReset()
  m.find.mockReset()
  m.reload.mockReset()
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = () => <LocationsTab activeId="r1" onOpen={vi.fn(async () => {})} />
const addCard = () => (
  <AddLocationCard
    onCreated={vi.fn(async () => {})}
    ownerId="owner-1"
    knownRestaurantIds={['r1']}
  />
)
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const TARGETS: Record<'en' | 'fr' | 'de', readonly Dict[]> = {
  en: [locEn as Dict, cardsEn as Dict, commonEn as Dict],
  fr: [locFr as Dict, cardsFr as Dict, commonFr as Dict],
  de: [locDe as Dict, cardsDe as Dict, commonDe as Dict],
}
const SOURCES: readonly Dict[] = [locRo as Dict, cardsRo as Dict, commonRo as Dict]
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI (capcana (b) din L5a2): `textContent` lipește textele
// elementelor vecine, iar granița de cuvânt n-ar mai găsi fragmentul.
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
function attrText(root: Element): string {
  const out: string[] = []
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  return out.join('\n')
}
const visible = (root: Element): string => `${nodeText(root)}\n${attrText(root)}`

function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  SOURCES.forEach((src, i) => {
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

describe('Toate locațiile în limba personalului', () => {
  it('LN0: control pozitiv — fila românească are resturi față de engleză', async () => {
    m.fetch.mockResolvedValue([A, B])
    const { container } = inLang(null, tab())
    await screen.findByRole('heading', { name: 'Bistro Gară' })
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.some((l) => l.startsWith('intro:'))).toBe(true)
    expect(left.some((l) => l.startsWith('stat_ordersToday:'))).toBe(true)
    expect(left.some((l) => l.startsWith('last_none:'))).toBe(true)
  })

  it('LN1: fără provider, româna de dinainte', async () => {
    m.fetch.mockResolvedValue([A, B])
    inLang(null, tab())
    expect(await screen.findByRole('button', { name: 'Deschide Bistro Gară' })).toHaveTextContent(
      'Deschide',
    )
    expect(
      screen.getByText(/^Ziua de azi în fiecare locație pe care o administrezi\./),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Comenzi azi')).toHaveLength(2)
    expect(screen.getAllByText('Deschise acum')).toHaveLength(2)
    expect(screen.getByText('Încasări azi')).toBeInTheDocument()
    expect(screen.getByText('Deschisă acum')).toBeInTheDocument()
    expect(screen.getByText('Nicio comandă încă')).toBeInTheDocument()
  })

  it('LN2: fila în engleză, fără resturi românești', async () => {
    m.fetch.mockResolvedValue([A, B])
    const { container } = inLang('en', tab())
    const open = await screen.findByRole('button', { name: 'Open Bistro Gară' })
    expect(open).toHaveTextContent('Open')
    expect(screen.getByText(/^Today in every location you manage\./)).toBeInTheDocument()
    expect(screen.getAllByText('Orders today')).toHaveLength(2)
    expect(screen.getAllByText('Open orders')).toHaveLength(2)
    expect(screen.getByText('Takings today')).toBeInTheDocument()
    expect(screen.getByText('Currently selected')).toBeInTheDocument()
    expect(screen.getByText('No orders yet')).toBeInTheDocument()
    expect(screen.getByText('today, 10:32')).toBeInTheDocument()
    // Banii rămân ca azi (lei), indiferent de limba personalului.
    expect(screen.getByText('845.50 lei')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    // Numele locației „Bistro Gară” e DATĂ — scos înainte de verificarea literelor.
    expect(nodeText(container).split('Bistro Gară').join('')).not.toMatch(/[ăĂșȘțȚ]/)
  })

  it('LN3: refuzul serverului — în română mesajul lui, în engleză/germană fără el', async () => {
    // Cu diacritice: `isRomanianText` (lib/userMessages) clasează un text FĂRĂ
    // diacritice după cuvinte, iar „a” numără ca engleză — prima variantă a
    // fixturii („Rezumatul a fost refuzat…”) ieșea „necunoscut” și trecea pe
    // rezervă, deci aserțiunea nu exersa ramura „mesajul serverului”.
    const SERVER = 'Rezumatul locațiilor a fost refuzat de politica restaurantului.'
    m.fetch.mockRejectedValue(new Error(SERVER))
    // Oracolul: exact ce dădea `toUserMessage` înainte de L6b, și chiar textul serverului.
    expect(toUserMessage(new Error(SERVER), 'Nu am putut încărca locațiile. Reîncearcă.')).toBe(SERVER)
    const ro = inLang(null, tab())
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER)
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    ro.unmount()

    const r = inLang('en', tab())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t load the locations. Try again.',
    )
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()

    r.rerender(tree('de', tab()))
    expect(
      await screen.findByText('Wir konnten die Standorte nicht laden. Bitte erneut versuchen.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('We couldn’t load the locations. Try again.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
  })
})

describe('Adaugă o locație în limba personalului', () => {
  it('LN4: cardul și dialogul în franceză; validarea se retraduce în germană', async () => {
    const user = userEvent.setup()
    const { container, rerender } = inLang('fr', addCard())
    expect(screen.getByRole('heading', { name: 'Établissements' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'fr')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Ajouter un établissement' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un établissement' })
    expect(within(dialog).getByLabelText('Nom de l’établissement')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’établissement' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Saisissez le nom de l’établissement.',
    )
    expect(romanianLeftovers(visible(dialog), 'fr')).toEqual([])
    expect(m.create).not.toHaveBeenCalled()

    rerender(tree('de', addCard()))
    const de = screen.getByRole('dialog', { name: 'Standort hinzufügen' })
    expect(within(de).getByRole('alert')).toHaveTextContent(
      'Geben Sie den Namen des Standorts ein.',
    )
    expect(within(de).queryByText('Saisissez le nom de l’établissement.')).not.toBeInTheDocument()
    expect(within(de).getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
  })

  it('LN5: refuzul de limită — text propriu în engleză; în română MSG_LOCATION_LIMIT', async () => {
    const SERVER = 'Limita de restaurante a planului a fost atinsă'
    m.create.mockRejectedValue({ hint: 'upgrade_plan', code: 'P0001', message: SERVER })
    const user = userEvent.setup()
    const en = inLang('en', addCard())
    await user.click(screen.getByRole('button', { name: 'Add a location' }))
    await user.type(screen.getByLabelText('Location name'), 'Bistro Port')
    await user.click(screen.getByRole('button', { name: 'Create location' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The current plan doesn’t allow another location. More locations need a higher plan.',
    )
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
    expect(romanianLeftovers(visible(screen.getByRole('dialog')), 'en')).toEqual([])
    en.unmount()

    inLang(null, addCard())
    await user.click(screen.getByRole('button', { name: 'Adaugă o locație' }))
    await user.type(screen.getByLabelText('Numele locației'), 'Bistro Port')
    await user.click(screen.getByRole('button', { name: 'Creează locația' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_LOCATION_LIMIT)
  })

  it('LN6: eșec ambiguu + lista necitibilă în germană', async () => {
    m.create.mockRejectedValue(new TypeError('Failed to fetch'))
    m.find.mockRejectedValue(new Error('Nu am putut verifica lista locațiilor.'))
    const user = userEvent.setup()
    inLang('de', addCard())
    await user.click(screen.getByRole('button', { name: 'Standort hinzufügen' }))
    await user.type(screen.getByLabelText('Name des Standorts'), 'Bistro Port')
    await user.click(screen.getByRole('button', { name: 'Standort anlegen' }))
    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText(
        'Wir wissen nicht sicher, ob der Standort angelegt wurde — laden Sie die Seite neu und prüfen Sie die Liste.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Standort anlegen' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Schließen' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Neu laden' }))
    expect(m.reload).toHaveBeenCalledWith('/dashboard')
    expect(romanianLeftovers(visible(dialog), 'de')).toEqual([])
  })
})
