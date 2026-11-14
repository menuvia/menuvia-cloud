// Editorul hărții sălii în limba personalului (lotul L6a): FloorPlanEditor
// (antetul cu cifrele sălii, comutatorul Live/Editare, anularea, salvarea și
// bannerul de eroare; bara de unelte; etichetele desenate pe canvas; panoul
// de proprietăți; ajutorul; subsolul) citește namespace-ul `floorplan`
// (+ „Salvează”/„Șterge” din `common`). FE1–FE2 (FloorPlanEditor.save.test)
// rămân neschimbate: fără provider, româna de dinainte.
// (Prefixul HM: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   HM0  control POZITIV al verificării „fără text românesc”: editorul randat în
//        română, comparat cu dicționarul englez, ARE resturi.
//   HM1  fără provider (azi, mereu româna): textele de dinainte — pluralele
//        false „1 mese · 4 locuri”, „4 loc.” pe canvas, „Mese: 1” în subsol,
//        ajutorul (textContent identic, cu tasta în <span> separat), panoul
//        mesei selectate („Masă #T7”, „Rotație: 0°”, „Auto (după nume: T7)”).
//        Mutația care pică: `stats_tables: { one: '{n} masă' }` în ro sau
//        `help_live` fără `{live}` (fillNodes).
//   HM2  editarea și apoi modul Live în engleză: eticheta de status desenată pe
//        masă („Free”), contoarele din subsol, aria-label/title ale
//        comutatorului, fără resturi românești în ambele stări. Mutația care
//        pică: `{st.label}` / `STATUS_META.label` românesc readus pe canvas.
//   HM3  panoul de proprietăți în germană (masa, apoi un decor nou), formele
//        din <select>, legătura cu POS, ștergerea mesei → starea goală.
//        Mutația care pică: `{v.label}` românesc readus în <option>.
//   HM4  salvarea refuzată în franceză (fără mesajul serverului), apoi
//        ACEEAȘI rădăcină `UiLangScope` trecută pe germană și pe română:
//        bannerul se retraduce (eroarea e ținută ca CLASĂ), în română exact
//        textul FE2. Mutația care pică: `setSaveError(<text>)` compus la
//        salvare.
//   HM5  ajutorul pe mobil, în franceză (pliat, apoi deschis): gesturile,
//        „Murs : …” cu spațiu francez, „Le mode Direct …”.
//   HM6  numele IMPLICITE ale elementelor noi (etaj, etaj adăugat, zonă) sunt
//        DATE: pleacă în harta salvată (zonele le vede și oaspetele, pe harta
//        publică), deci rămân în română în ORICE limbă a personalului — exact
//        cele de dinainte („Parter”, „Etaj 1”, „Zonă”); doar uneltele care le
//        creează („▢ Area”, „+ Floor”) se traduc. Mutația care pică: un nume
//        implicit trecut prin traducător (`ft.t(…)`) în locul constantei din
//        lib/floorPlan.ts.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FloorLayout } from '../../lib/floorPlan'

const h = vi.hoisted(() => ({
  rpc: [] as Array<[string, unknown]>,
  rpcError: null as { message: string } | null,
  realTables: [] as { id: string; name: string }[],
  mobile: false,
}))

vi.mock('../../lib/supabase', () => {
  // Interogările de mese / status live: lanț „thenable” (mesele reale doar pe
  // `tables`, restul gol).
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'neq', 'not', 'in', 'gte', 'lte', 'order']) b[k] = () => b
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({ data: table === 'tables' ? h.realTables : [], error: null }).then(
        onFulfilled,
        onRejected,
      )
    return b
  }
  return {
    supabase: {
      from: (t: string) => chain(t),
      rpc: async (name: string, args: unknown) => {
        h.rpc.push([name, args])
        return { data: null, error: h.rpcError }
      },
    },
  }
})
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => h.mobile }))
vi.mock('../../hooks/usePollWhileVisible', () => ({ startPollingWhileVisible: () => () => {} }))

import FloorPlanEditor from '../FloorPlanEditor'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { floorplanNs } from '../../i18n/ns/floorplan'
import { commonNs } from '../../i18n/ns/common'
import fpRo from '../../i18n/ns/floorplan/ro'
import fpEn from '../../i18n/ns/floorplan/en'
import fpFr from '../../i18n/ns/floorplan/fr'
import fpDe from '../../i18n/ns/floorplan/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(floorplanNs, l), preloadNamespace(commonNs, l)]))
})

const LAYOUT: FloorLayout = {
  floors: [
    {
      id: 'f1',
      name: 'Sala 1',
      tables: [
        { id: 't1', x: 100, y: 100, w: 80, h: 80, shape: 'round', label: 'T7', seats: 4, rotation: 0, status: 'free' },
      ],
      walls: [],
      decos: [],
      zones: [],
    },
  ],
  version: 1,
  savedAt: '2026-11-01T10:00:00.000Z',
}

beforeEach(() => {
  h.rpc = []
  h.rpcError = null
  h.realTables = []
  h.mobile = false
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))
const editor = (layout: FloorLayout | null = LAYOUT, onSaved: (l: FloorLayout) => void = () => {}) => (
  <FloorPlanEditor restaurantId="r1" initialLayout={layout} onSaved={onSaved} />
)

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [fpEn as Dict, commonEn as Dict],
  fr: [fpFr as Dict, commonFr as Dict],
  de: [fpDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI, despărțite prin „\n” (capcana (b) din L5a2).
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}

/** Fragmentele românești ale lui `floorplan` + `common` rămase în text (fără
 *  cele identice în limba țintă), pe bucățile fixe de cel puțin 6 caractere,
 *  ca cuvinte întregi. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [fpRo as Dict, commonRo as Dict]
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

function visibleText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  )
  const options = [...root.querySelectorAll('option')].map((o) => o.textContent ?? '')
  return [nodeText(root), ...attrs, ...options].join('\n')
}

/** Paragrafele ajutorului (textContent normalizat: tasta/gestul stă în <span>). */
const paragraphs = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('p')].map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())

const selectTable = (label: string) => fireEvent.mouseDown(screen.getByText(label))

describe('editorul hărții în limba personalului', () => {
  it('HM0: control pozitiv — editorul românesc are resturi față de engleză', () => {
    const { container } = inLang(null, editor())
    selectTable('T7')
    const left = romanianLeftovers(visibleText(container), 'en')
    expect(left.length).toBeGreaterThan(5)
    expect(left.some((l) => l.startsWith('empty_hint:') || l.startsWith('prop_posHint:'))).toBe(true)
    expect(left.some((l) => l.startsWith('mode_editAria:'))).toBe(true)
  })

  it('HM1: fără provider, româna de dinainte', async () => {
    h.realTables = [{ id: 'pos-7', name: 'T7' }]
    const { container } = inLang(null, editor())
    expect(screen.getByText('1 mese · 4 locuri')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Mod editare activ — comută pe vizualizare live' })
    expect(toggle).toHaveAttribute('title', 'Comută pe Vizualizare live')
    expect(toggle).toHaveTextContent('Editare')
    expect(screen.getByRole('button', { name: 'Anulează ultima acțiune' })).toHaveAttribute('title', 'Anulează (Ctrl+Z)')
    expect(screen.getByRole('button', { name: 'Salvează' })).toBeInTheDocument()
    for (const s of ['Instrumente', 'Mese', 'Structură', 'Decoruri', 'Etaje', 'Grilă', 'Rotundă', 'Perete', 'Plantă'])
      expect(screen.getByText(s)).toBeInTheDocument()
    expect(screen.getAllByText('Locuri:')).toHaveLength(2) // bara de unelte + subsolul
    expect(screen.getByRole('button', { name: '↖ Selectează' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '▢ Zonă' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Etaj' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 locuri' })).toBeInTheDocument()
    expect(screen.getByText('4 loc.')).toBeInTheDocument()
    expect(screen.getByText('Mese:')).toBeInTheDocument()
    expect(screen.getByText('Pereți:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cum funcționează' })).toBeInTheDocument()
    expect(paragraphs(container)).toEqual(
      expect.arrayContaining([
        'Click — plasează element',
        'Drag — mută masa',
        'R — rotește',
        'Del — șterge',
        'Ctrl+Z — undo',
        'Pereți: click & drag',
        'Mod Live arată status mese în timp real',
      ]),
    )
    expect(screen.getByText('Live').tagName).toBe('SPAN')

    selectTable('T7')
    expect(screen.getByText('Masă #T7')).toBeInTheDocument()
    expect(screen.getByLabelText('Etichetă masă')).toHaveValue('T7')
    expect(screen.getByText('Rotație: 0°')).toBeInTheDocument()
    expect(screen.getByLabelText('Lățime masă (px)')).toHaveAttribute('placeholder', 'L')
    expect(screen.getByLabelText('Înălțime masă (px)')).toHaveAttribute('placeholder', 'Î')
    expect(within(screen.getByLabelText('Formă masă')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Rotundă',
      'Pătrată',
      'Dreptunghi',
      'Bar',
    ])
    expect(
      await screen.findByRole('option', { name: 'Auto (după nume: T7)' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Leagă masa de POS ca să vezi în Live comenzile și rezervările ei.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotește' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Șterge masa' })).toHaveTextContent('Șterge')
  })

  it('HM2: editarea și modul Live în engleză, fără resturi românești', async () => {
    const user = userEvent.setup()
    const { container } = inLang('en', editor())
    expect(screen.getByText('1 table · 4 seats')).toBeInTheDocument()
    for (const s of ['Tools', 'Tables', 'Structure', 'Decor', 'Floors', 'Grid', 'Round', 'Wall', 'Plant'])
      expect(screen.getByText(s)).toBeInTheDocument()
    expect(screen.getAllByText('Seats:')).toHaveLength(2) // bara de unelte + subsolul
    expect(screen.getByText('4 seats')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(paragraphs(container)).toEqual(
      expect.arrayContaining(['Click — place an element', 'Del — delete', 'Live mode shows the table status in real time']),
    )
    expect(romanianLeftovers(visibleText(container), 'en')).toEqual([])

    const toggle = screen.getByRole('button', { name: 'Editing on — switch to live view' })
    expect(toggle).toHaveAttribute('title', 'Switch to Live view')
    await user.click(toggle)
    const live = screen.getByRole('button', { name: 'Live view on — switch to editing' })
    expect(live).toHaveAttribute('title', 'Switch to Edit')
    expect(await screen.findByText('Free')).toBeInTheDocument()
    expect(screen.getByText('● 1 free')).toBeInTheDocument()
    expect(screen.getByText('● 0 occupied')).toBeInTheDocument()
    expect(screen.getByText('● 0 reserved')).toBeInTheDocument()
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
    expect(romanianLeftovers(visibleText(container), 'en')).toEqual([])
    expect(container.textContent).not.toMatch(/Liberă|libere|ocupate|loc\./)
  })

  it('HM3: panoul de proprietăți în germană, apoi ștergerea și un decor nou', async () => {
    h.realTables = [{ id: 'pos-7', name: 'T7' }]
    const user = userEvent.setup()
    const { container } = inLang('de', editor())
    selectTable('T7')
    expect(screen.getByText('Tisch #T7')).toBeInTheDocument()
    expect(screen.getByText('Bezeichnung')).toBeInTheDocument()
    expect(screen.getByLabelText('Tischbezeichnung')).toHaveValue('T7')
    expect(screen.getByText('Drehung: 0°')).toBeInTheDocument()
    expect(screen.getByLabelText('Tischbreite (px)')).toHaveAttribute('placeholder', 'B')
    expect(within(screen.getByLabelText('Tischform')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Rund',
      'Quadratisch',
      'Rechteckig',
      'Bar',
    ])
    expect(await screen.findByRole('option', { name: 'Automatisch (nach Name: T7)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drehen' })).toBeInTheDocument()
    expect(romanianLeftovers(visibleText(container), 'de')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Tisch löschen' }))
    expect(screen.getByText('Werkzeug wählen und auf den Plan klicken')).toBeInTheDocument()
    expect(screen.getByText('Wände · Tische · Bereiche · Deko')).toBeInTheDocument()
    expect(screen.getByText('0 Tische · 0 Plätze')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '🌿 Pflanze' }))
    fireEvent.mouseDown(screen.getByText('Werkzeug wählen und auf den Plan klicken'), { clientX: 200, clientY: 200 })
    expect(screen.getAllByText('Deko')).toHaveLength(2) // secțiunea + titlul panoului
    expect(paragraphs(container)).toContain('🌿 Pflanze')
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    expect(romanianLeftovers(visibleText(container), 'de')).toEqual([])
  })

  it('HM4: salvarea refuzată — franceza fără mesajul serverului, retradusă pe aceeași rădăcină', async () => {
    const serverRo = 'Funcția „floor_plan” cere un plan superior'
    h.rpcError = { message: serverRo }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const node = editor()
    const { rerender, container } = render(tree('fr', node))
    expect(paragraphs(container)).toEqual(expect.arrayContaining(['Suppr — supprimer', 'Ctrl+Z — annuler']))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      fpFr.err_plan,
    )
    expect(container.textContent).not.toContain(serverRo)
    expect(romanianLeftovers(visibleText(container), 'fr')).toEqual([])

    rerender(tree('de', node))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Der Tischplan ist im Tarif Fiscalizare verfügbar.'),
    )
    rerender(tree('ro', node))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Harta sălii e disponibilă pe planul Fiscalizare.'),
    )
    expect(h.rpc).toHaveLength(1)
    errSpy.mockRestore()
  })

  it('HM5: ajutorul pe mobil, în franceză', async () => {
    h.mobile = true
    const user = userEvent.setup()
    const { container } = inLang('fr', editor())
    const help = screen.getByRole('button', { name: /Mode d’emploi/ })
    expect(help).toHaveAttribute('aria-expanded', 'false')
    await user.click(help)
    expect(paragraphs(container)).toEqual(
      expect.arrayContaining([
        'Touchez — placer / sélectionner',
        'Faites glisser — déplacer la table',
        'Pivoter / Supprimer — depuis le panneau des propriétés',
        'Murs : touchez et faites glisser',
        'Le mode Direct affiche l’état des tables en temps réel',
      ]),
    )
    expect(romanianLeftovers(visibleText(container), 'fr')).toEqual([])
  })

  it('HM6: numele implicite ale elementelor noi rămân în română, în orice limbă (en, ro)', async () => {
    const user = userEvent.setup()
    const drawZone = async (toolName: string, emptyText: string) => {
      await user.click(screen.getByRole('button', { name: toolName }))
      const target = screen.getByText(emptyText)
      fireEvent.mouseDown(target, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(target, { clientX: 220, clientY: 220 })
      fireEvent.mouseUp(target)
    }

    const savedEn: FloorLayout[] = []
    const en = inLang('en', editor(null, (l) => savedEn.push(l)))
    expect(screen.getByRole('button', { name: 'Parter' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ground floor' })).not.toBeInTheDocument()
    await drawZone('▢ Area', 'Pick a tool and click on the plan')
    expect(screen.getAllByText('Zonă')).toHaveLength(1) // eticheta zonei de pe canvas
    await user.click(screen.getByRole('button', { name: '+ Floor' }))
    expect(screen.getByRole('button', { name: 'Etaj 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedEn).toHaveLength(1))
    expect(savedEn[0]!.floors.map((f) => f.name)).toEqual(['Parter', 'Etaj 1'])
    expect(savedEn[0]!.floors[0]!.zones.map((z) => z.label)).toEqual(['Zonă'])
    en.unmount()

    const savedRo: FloorLayout[] = []
    inLang(null, editor(null, (l) => savedRo.push(l)))
    expect(screen.getByRole('button', { name: 'Parter' })).toBeInTheDocument()
    await drawZone('▢ Zonă', 'Selectează un instrument și dă click pe plan')
    await user.click(screen.getByRole('button', { name: '+ Etaj' }))
    expect(screen.getByRole('button', { name: 'Etaj 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvează' }))
    await waitFor(() => expect(savedRo).toHaveLength(1))
    expect(savedRo[0]!.floors.map((f) => f.name)).toEqual(['Parter', 'Etaj 1'])
    expect(savedRo[0]!.floors[0]!.zones.map((z) => z.label)).toEqual(['Zonă'])
  })
})
