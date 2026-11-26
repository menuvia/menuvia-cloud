// Fila Vânzări (ReportsTab) în limba personalului (lotul L7): textele din
// namespace-ul `reports` (+ „Reîncearcă” și clasele de erori din `common`).
// Testele de plan (ReportsTabPlan.test.tsx RP1–RP2) rămân NESCHIMBATE — aici e
// doar limba. Partea pură (eticheta perioadei, ziua de pe grafic, exporturile
// CSV/PDF comparate cu oracolul vechi) e în src/lib/__tests__/reportsLang.test.ts
// (YA7–YA11). (Prefixul YA: verificat cu grep în src/, tests/, e2e/,
// supabase/tests, docs și CLAUDE.md, nefolosit înainte.)
//   YA0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi. Fără el, YA2–YA6
//        ar trece și cu o verificare stricată.
//   YA1  fără provider (azi, mereu româna), Planul 3: textele de dinainte
//        („Venituri”, „Bon mediu”, „Tichete de masă”, „Top 2 produse”, „Vânzări
//        pe ospătar”, „50% din total”, nota despre raportul Z, „Export CSV”).
//   YA2  Planul 3 în engleză: cardurile, defalcarea pe metode, top produse,
//        secțiunile pe oră/ospătar/categorie, nota de subsol, butoanele de
//        export — fără resturi românești; sumele rămân `… lei`, numele
//        produselor/ospătarilor/categoriilor NEtraduse. Mutația care pică: un
//        literal românesc readus (ex. `label="Bon mediu"`).
//   YA3  Planul 1/2 în germană și franceză: nota „fără sume” tradusă, nicio
//        etichetă de bani, niciun „lei”, nicio notă despre raportul Z, nici
//        butoanele de export. Mutația care pică: nota Z scoasă de sub gate-ul
//        `fiscalReports`.
//   YA4  refuzul serverului la încărcare: în română EXACT `toUserMessage` cu
//        rezerva „Eroare la încărcarea raportului”; în engleză rezerva tradusă,
//        FĂRĂ mesajul brut; pe aceeași rădăcină `UiLangScope`, trecut în
//        germană, se retraduce — eroarea e ținută ca DATĂ. Mutația care pică:
//        `setError({ err: toUserMessage(…) })` / un text compus la eșec.
//   YA5  intervalul personalizat în franceză: butoanele perioadei și
//        etichetele accesibile ale câmpurilor de dată.
//   YA6  exporturile în franceză: CSV-ul descărcat are numele și antetele
//        franceze (cu valorile neatinse), PDF-ul scrie liniile franceze și se
//        salvează cu numele francez; un PDF eșuat afișează eroarea în limba
//        curentă și se retraduce în germană. Mutația care pică:
//        `downloadCsv(\`raport-menuvia-…\`)` readus în componentă. Din lotul
//        C6a fișierul poartă intervalul în nume, începe cu UN BOM și e în
//        dialectul limbii UTILIZATORULUI (franceza: „;” și virgula zecimală) —
//        mutația care pică: `reportCsvDialect(tr.lang)`/un dialect fix „,”.
// `sessionStorage` se golește înaintea fiecărui test: perioada aleasă se
// păstrează pe sesiune (C6a), deci „Autre période” din YA5 ar porni YA6 pe
// intervalul personalizat.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => {
  const now = new Date().toISOString()
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
  return {
    rows: {
      orders: [
        { id: 'o1', source: 'qr', status: 'paid', total: 30, paid_amount: 30, payment_method: 'cash', created_at: now, paid_at: now },
        { id: 'o2', source: 'waiter', status: 'paid', total: 50, paid_amount: 50, payment_method: 'card_pos', created_at: twoDaysAgo, paid_at: twoDaysAgo },
      ],
      order_items: [
        { product_name_snapshot: 'Supă de roșii', quantity: 2, unit_price_snapshot: 15, product_id: 'p1' },
        { product_name_snapshot: 'Papanași', quantity: 1, unit_price_snapshot: 20, product_id: 'p2' },
      ],
      products: [{ id: 'p1', emoji: '🍅' }],
      v_daily_payments_by_method: [
        { cash_revenue: 30, card_revenue: 20, voucher_revenue: 10, online_revenue: 15, other_revenue: 5, total_revenue: 80 },
      ],
    } as Record<string, unknown[]>,
    errors: {} as Record<string, { message: string; code: string } | undefined>,
    download: vi.fn(),
    pdfTexts: [] as string[],
    pdfSaved: [] as string[],
    pdfThrow: false,
  }
})

vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'range', 'in']) b[k] = vi.fn(() => b)
    b.then = (
      onFulfilled: (v: { data: unknown[] | null; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      const err = m.errors[table]
      return Promise.resolve(err ? { data: null, error: err } : { data: m.rows[table] ?? [], error: null }).then(
        onFulfilled,
        onRejected,
      )
    }
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc: vi.fn() } }
})
vi.mock('../../lib/reports', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/reports')),
  fetchWaiterSales: async () => [
    { waiter_id: 'w1', waiter_name: 'Ioana', order_count: 2, total_revenue: 80, avg_ticket: 40, discount_total: 5 },
  ],
  fetchHourlySales: async () => [{ hour: 13, order_count: 2, total_revenue: 80 }],
  fetchCategorySales: async () => [
    { category_id: 'c1', category_name: 'Ciorbe', category_emoji: '🍲', item_count: 3, total_revenue: 80, percent_total: 100 },
  ],
  downloadCsv: m.download,
}))
vi.mock('jspdf', () => ({
  default: class {
    constructor() {
      if (m.pdfThrow) throw new Error('jspdf indisponibil')
    }
    setFontSize() {}
    setFont() {}
    setDrawColor() {}
    setLineWidth() {}
    line() {}
    setFillColor() {}
    rect() {}
    addPage() {}
    setTextColor() {}
    text(s: string) {
      m.pdfTexts.push(s)
    }
    save(name: string) {
      m.pdfSaved.push(name)
    }
  },
}))
// recharts măsoară containerul (ResponsiveContainer) — inert în jsdom.
vi.mock('recharts', () => {
  const Box = () => null
  return { BarChart: Box, Bar: Box, XAxis: Box, YAxis: Box, Tooltip: Box, ResponsiveContainer: Box, CartesianGrid: Box, Cell: Box }
})

import ReportsTab from '../ReportsTab'
import { toUserMessage } from '../../lib/userMessages'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { reportsNs } from '../../i18n/ns/reports'
import { commonNs } from '../../i18n/ns/common'
import repRo from '../../i18n/ns/reports/ro'
import repEn from '../../i18n/ns/reports/en'
import repFr from '../../i18n/ns/reports/fr'
import repDe from '../../i18n/ns/reports/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(reportsNs, l), preloadNamespace(commonNs, l)]))
})

beforeEach(() => {
  window.sessionStorage.clear()
  m.errors = {}
  m.download.mockReset()
  m.pdfTexts = []
  m.pdfSaved = []
  m.pdfThrow = false
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = (fiscal = true) => <ReportsTab restaurantId="r1" fiscalReports={fiscal} />
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const TARGETS: Record<'en' | 'fr' | 'de', readonly Dict[]> = {
  en: [repEn as Dict, commonEn as Dict],
  fr: [repFr as Dict, commonFr as Dict],
  de: [repDe as Dict, commonDe as Dict],
}
const SOURCES: readonly Dict[] = [repRo as Dict, commonRo as Dict]
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
// Numele produselor/ospătarilor/categoriilor sunt DATE — scoase înainte de
// verificarea literelor românești.
const DATA = ['Supă de roșii', 'Papanași', 'Ioana', 'Ciorbe']
const withoutData = (t: string): string => DATA.reduce((acc, d) => acc.split(d).join(''), t)
const RO_LETTERS = /[ăĂâÂîÎșȘțȚşŞţŢ]/

describe('Vânzări în limba personalului', () => {
  it('YA0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('Supă de roșii')
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.some((l) => l.startsWith('stat_avgTicket:'))).toBe(true)
    expect(left.some((l) => l.startsWith('waiter_title:'))).toBe(true)
    expect(left.some((l) => l.startsWith('disclaimer:'))).toBe(true)
    expect(RO_LETTERS.test(withoutData(nodeText(container)))).toBe(true)
  })

  it('YA1: fără provider, româna de dinainte (Planul 3)', async () => {
    const user = userEvent.setup()
    const { container } = inLang(null, tab())
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    for (const t of ['Venituri', 'Bon mediu', 'Tichete de masă', 'Card online', 'Alte metode', 'Comenzi QR', 'Comenzi ospătar'])
      expect(screen.getAllByText(t).length, t).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('50% din total')).toHaveLength(2)
    // „Azi” = o singură zi, deci fără grafic (lotul C6a: seria are zilele
    // INTERVALULUI, nu zilele pe care le întoarce dublura, care ignoră filtrele).
    expect(screen.queryByText('Venituri zilnice')).toBeNull()
    expect(screen.getByText('după cantitate comandată')).toBeInTheDocument()
    expect(container.textContent).toContain('Top 2 produse')
    expect(screen.getByText('Vânzări pe oră')).toBeInTheDocument()
    expect(screen.getByText('Vânzări pe ospătar')).toBeInTheDocument()
    expect(screen.getByText('Vânzări pe categorie')).toBeInTheDocument()
    expect(container.textContent).toContain('· 3 buc.')
    expect(screen.getByText('Azi', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alt interval' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument()
    expect(screen.getByTitle('PDF: sumar și top produse. Pentru toate secțiunile folosește Export CSV.')).toBeInTheDocument()
    expect(
      screen.getByText('Document operațional intern. Nu înlocuiește raportul Z fiscal al casei de marcat.'),
    ).toBeInTheDocument()
    // Pe 7 zile, graficul cu titlul de dinainte.
    await user.click(screen.getByRole('button', { name: '7 zile' }))
    expect(await screen.findByText('Venituri zilnice')).toBeInTheDocument()
  })

  it('YA2: Planul 3 în engleză, fără resturi românești; sumele și datele neatinse', async () => {
    const user = userEvent.setup()
    const { container } = inLang('en', tab())
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    for (const t of ['Revenue', 'Average ticket', 'Meal vouchers', 'Online card', 'Other methods', 'QR orders', 'Waiter orders'])
      expect(screen.getAllByText(t).length, t).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('50% of total')).toHaveLength(2)
    expect(screen.queryByText('Daily revenue')).toBeNull() // „Today” = o zi, fără grafic
    expect(container.textContent).toContain('Top 2 products')
    expect(screen.getByText('by quantity ordered')).toBeInTheDocument()
    expect(screen.getByText('Sales by hour')).toBeInTheDocument()
    expect(screen.getByText('Sales by waiter')).toBeInTheDocument()
    expect(screen.getByText('Sales by category')).toBeInTheDocument()
    expect(screen.getByText('· 3 pcs')).toBeInTheDocument()
    expect(screen.getByText('Today', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom range' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeInTheDocument()
    expect(screen.getByText(/^Internal operational document\. It does not replace the fiscal Z report/)).toBeInTheDocument()
    // Banii rămân `… lei` (formatul de azi), datele neatinse.
    expect(screen.getAllByText('80 lei').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('40.00 lei').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Ioana')).toBeInTheDocument()
    expect(screen.getByText('Ciorbe')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(withoutData(nodeText(container))).not.toMatch(RO_LETTERS)
    // Pe 7 zile: graficul, tot fără resturi românești.
    await user.click(screen.getByRole('button', { name: '7 days' }))
    expect(await screen.findByText('Daily revenue')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
  })

  it('YA3: Planul 1/2 în germană și franceză — fără sume, fără nota Z, fără exporturi', async () => {
    const de = inLang('de', tab(false))
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getByText('Bestellübersicht: Mengen und Produkte, ohne Beträge.')).toBeInTheDocument()
    expect(screen.getByText('Bestellungen')).toBeInTheDocument()
    expect(screen.queryByText('Umsatz')).toBeNull()
    expect(screen.queryByText('Durchschnittspreis')).toBeNull()
    expect(de.container.textContent ?? '').not.toMatch(/\blei\b|Z-Bericht|Registrierkasse/)
    // Exporturile sunt ascunse pe Planul 1/2 (display: none), ca înainte.
    expect(screen.queryByRole('button', { name: /Als CSV exportieren/ })).toBeNull()
    expect(romanianLeftovers(visible(de.container), 'de')).toEqual([])
    de.unmount()

    const fr = inLang('fr', tab(false))
    expect(await screen.findByText('Supă de roșii')).toBeInTheDocument()
    expect(screen.getByText('Suivi des commandes : quantités et produits, sans montants.')).toBeInTheDocument()
    expect(screen.queryByText('Chiffre d’affaires')).toBeNull()
    expect(fr.container.textContent ?? '').not.toMatch(/\blei\b|rapport Z|caisse enregistreuse/)
    expect(romanianLeftovers(visible(fr.container), 'fr')).toEqual([])
    expect(withoutData(nodeText(fr.container))).not.toMatch(RO_LETTERS)
  })

  it('YA4: refuzul serverului — în română mesajul de azi, în engleză/germană fără el', async () => {
    // Cu diacritice: fără ele `isRomanianText` clasează textul după cuvinte („a”
    // = engleză) și `toUserMessage` cade pe rezervă — ramura „mesajul serverului”
    // n-ar fi exersată, iar `queryByText(ERR.message)` din engleză ar fi vacuu
    // (capcana LN3 din L6b).
    const ERR = { message: 'Raportul vânzărilor a fost refuzat de politica restaurantului', code: 'P0001' }
    expect(toUserMessage(ERR, 'Eroare la încărcarea raportului')).toBe(ERR.message)
    m.errors.orders = ERR
    const ro = inLang(null, tab())
    expect(await screen.findByText(toUserMessage(ERR, 'Eroare la încărcarea raportului'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    ro.unmount()

    const r = inLang('en', tab())
    expect(await screen.findByText('We couldn’t load the report.')).toBeInTheDocument()
    expect(screen.queryByText(ERR.message)).toBeNull()
    expect(screen.getByRole('button', { name: commonEn.retry })).toBeInTheDocument()
    expect(romanianLeftovers(visible(r.container), 'en')).toEqual([])

    r.rerender(tree('de', tab()))
    expect(await screen.findByText('Der Bericht konnte nicht geladen werden.')).toBeInTheDocument()
    expect(screen.queryByText('We couldn’t load the report.')).toBeNull()
    expect(screen.getByRole('button', { name: commonDe.retry })).toBeInTheDocument()

    // Clasa erorii (drepturi) vine din `common`, în limba curentă.
    r.unmount()
    m.errors.orders = { message: 'permission denied for table orders', code: '42501' }
    inLang('fr', tab())
    expect(await screen.findByText(commonFr.err_permission)).toBeInTheDocument()
  })

  it('YA5: intervalul personalizat în franceză', async () => {
    const user = userEvent.setup()
    inLang('fr', tab())
    await screen.findByText('Supă de roșii')
    for (const name of ['Aujourd’hui', '7 jours', '30 jours']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Autre période' }))
    expect(screen.getByLabelText('Date de début')).toBeInTheDocument()
    expect(screen.getByLabelText('Date de fin')).toBeInTheDocument()
    expect(screen.queryByLabelText('De la data')).toBeNull()
  })

  it('YA6: exporturile în franceză; eroarea PDF se retraduce', async () => {
    const user = userEvent.setup()
    const { rerender } = inLang('fr', tab())
    await screen.findByText('Supă de roșii')
    await user.click(screen.getByRole('button', { name: /Exporter en CSV/ }))
    expect(m.download).toHaveBeenCalledTimes(1)
    const [file, content] = m.download.mock.calls[0] as [string, string]
    // Numele poartă ziua (o singură zi pe „Aujourd’hui”), nu eticheta perioadei.
    expect(file).toMatch(/^rapport-menuvia-\d{4}-\d{2}-\d{2}\.csv$/)
    // Un singur BOM, la octetul 0; dialectul limbii utilizatorului („;” + „,”).
    expect(content.split('\n')[0]).toBe('\uFEFFRapport Menuvia — Aujourd’hui')
    expect(content.split('\uFEFF')).toHaveLength(2)
    expect(content.split('\n')).toContain('2;80,00;40,00;30,00;20,00;10,00;15,00;5,00;1;1')
    expect(content).toContain('# Synthèse')
    expect(content).toContain('Ticket moyen (lei)')
    expect(content).toContain('Supă de roșii')
    expect(content).not.toMatch(/Venituri|Sumar|Comenzi/)

    await user.click(screen.getByRole('button', { name: /Exporter en PDF/ }))
    await vi.waitFor(() => expect(m.pdfSaved).toHaveLength(1))
    expect(m.pdfSaved[0]).toMatch(/^Rapport-Menuvia-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(m.pdfTexts).toContain('Rapport Menuvia')
    expect(m.pdfTexts).toContain('Synthèse')
    expect(m.pdfTexts).toContain('Total des commandes : 2')
    expect(m.pdfTexts).toContain('QR : 1 commande  |  Serveur (manuel) : 1 commande')
    expect(m.pdfTexts.join('\n')).not.toMatch(/Venituri|Sumar|comenzi|Raport/)

    m.pdfThrow = true
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: /Exporter en PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nous n’avons pas pu générer le PDF. Réessayez.')
    rerender(tree('de', tab()))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das PDF konnte nicht erstellt werden. Bitte erneut versuchen.',
    )
    quiet.mockRestore()
  })
})
