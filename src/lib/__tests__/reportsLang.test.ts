// Fila Vânzări în limba personalului (lotul L7) — partea PURĂ, rulabilă fără
// DOM: eticheta perioadei, ziua de pe grafic și exporturile CSV/PDF compuse de
// lib/reportsExport.ts. Ecranul randat e în
// src/components/__tests__/ReportsLang.test.tsx (YA0–YA6). (Prefixul YA:
// verificat cu grep în src/, tests/, e2e/, supabase/tests, docs și CLAUDE.md,
// nefolosit înainte.)
//   YA7  ORACOLUL: în română, exportul CSV are EXACT celulele (și rândurile)
//        exportului produs de codul VECHI din ReportsTab, copiat verbatim mai
//        jos (`oldCsv`), pe toate cele patru perioade (inclusiv intervalul
//        personalizat și o singură zi); la fel eticheta perioadei și ziua de pe
//        grafic. Lotul C6a a schimbat DELIBERAT doar FORMA fișierului (XL1–XL3
//        de mai jos): un singur BOM, la octetul 0, „;” între coloane, virgula
//        zecimală și intervalul în numele fișierului — oracolul compară grila
//        de celule după ce citește fiecare fișier în dialectul lui (vechiul cu
//        „,” și punct). Mutația care pică: `csvh_avgPrice` fără „ (lei)” în ro,
//        `csv_title` cu „-” în loc de „—”, sau un rând scăpat de sub `toCsv`.
//   XL1  (C6a) fișierul începe cu BOM-ul UTF-8 și are EXACT unul — Excel
//        recunoaște UTF-8 doar după un BOM la octetul 0, iar unul la mijloc
//        apare ca „ï»¿” în fața antetului. Mutația care pică: secțiunile
//        construite cu BOM (`toCsv` fără `bom: false`) sau fișierul fără BOM
//        în față. Control POZITIV: exportul vechi chiar are BOM-uri la mijloc
//        și niciunul la început (exact defectul).
//   XL2  (C6a) dialectul după limba UTILIZATORULUI: ro/fr/de „;” + „,”, en
//        „,” + „.”; rândul de sumar românesc, octet cu octet. Mutația care
//        pică: `reportCsvDialect` care întoarce „,” în română.
//   XL3  (C6a) numele fișierului poartă intervalul (o zi = o dată), în toate
//        cele patru limbi. Mutația care pică: `{slug}` readus.
//   YA8  ORACOLUL PDF: în română liniile (titlu, „Sumar”, „Total comenzi: N”,
//        venituri/bon mediu, metodele, „QR: N comenzi  |  Ospătar manual: …”,
//        antetele tabelului, nota de subsol) și numele fișierului sunt EXACT
//        cele de dinainte — inclusiv pluralul fals „1 comenzi”. Mutația care
//        pică: `pdf_orders.one: '{n} comandă'` în ro, sau `pdf_methodsLine` cu
//        un singur spațiu în jurul „|”.
//   YA9  (a = CSV, b = PDF) en/fr/de: exporturile fără niciun rest românesc
//        (controlul POZITIV: aceeași verificare pe exportul românesc GĂSEȘTE
//        resturi), valorile
//        (numele produselor, ospătarilor, categoriilor, sumele) NEtraduse,
//        același număr de coloane în fiecare secțiune ca în română (un antet
//        tradus care se repetă ar înghiți o coloană), nume de fișier proprii,
//        pluralul acordat („1 order”, franceza cu „de” pe `many`), iar textele
//        PDF numai în Latin-1 (fonturile standard jsPDF). Mutația care pică:
//        `csvh_orders: 'Comenzi'` lăsat în en, sau `pdf_revenueLine` francez
//        cu apostroful tipografic.
//   YA10 eticheta perioadei și ziua de pe grafic urmează limba (en-GB „15/11”,
//        de „15.11.”), fusul rămâne Europe/Bucharest (o comandă la 23:30 UTC pe
//        14 noiembrie e ziua de 15 în orice limbă). Din lotul C6a ziua e CHEIA
//        din `reportDayTotals` (în fusul zilei de raportare), formatată ca dată
//        de `seriesPointLabel`. Mutația care pică: `reportDayTotals` fără fus
//        (ziua UTC).
//   YA12 lotul G2b: `reportPeriodRange` pe București = `periodRange` VECHI din
//        ReportsTab (copiat verbatim mai jos, cu `setDate` pe fusul gazdei —
//        UTC în CI) pe instante fixe, inclusiv 24 oct 22:30Z (01:30 pe 25 oct,
//        zi de 25 h). Excepția consemnată: 25 oct 21:30Z (23:30, ziua de 25 h),
//        unde vechiul „ultimele 7 zile” pornea pe 20 oct — 6 zile calendaristice
//        — pe orice browser al cărui fus nu e al României (UTC în CI: `setDate`
//        scădea 6 × 24 h, iar ziua de 25 h „lungea” fereastra); aritmetica pe
//        șir dă 19 oct oriunde. Valoarea VECHE din acel caz depinde de gazdă
//        (20 pe UTC, 19 pe București), deci testul aserteză doar valoarea nouă.
//        Oracolul de etichetă (`oldPeriodLabel`) formatează pe UTC: codul vechi
//        folosea fusul gazdei, la fel de dependent de gazdă (vezi oracolul).
//   YA13 New York, acum = 13 nov 04:30Z (23:30 pe 12): azi = 12, săptămâna de
//        la 6, luna de la 14 oct. Mutația care pică: ziua României (13/7/15).
//   YA14 ziua de pe grafic în fusul dat: 14 nov 23:30Z pe New York = „14.11”
//        (București, YA10, dă „15.11”; un fus invalid tot „15.11”, fără
//        RangeError — mutația care pică: `safeTimeZone` scos din
//        `toZonedYMD`); structural, `periodLabelT`
//        formatează capetele cu `formatYmd`, nu `new Date(from)` (ziua de
//        dinainte la vest de UTC).
//   YA11 clichet STRUCTURAL: ReportsTab cere SUS, înaintea primului `return`,
//        `reports` + `common` și niciun alt namespace; nu mai cheamă
//        `toUserMessage(` direct (doar prin `describeStaffError`); fila rămâne
//        `lazy` în DashboardPage; lib/reportsExport ia din `i18n/ns` doar TIPUL;
//        nota despre raportul Z rămâne în spatele gate-ului `fiscalReports`.
//        Mutația care pică: `useT(commonNs)` scos, sau un `import reportsRo`
//        (valoare) în lib/reportsExport.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeTranslator } from '../../i18n/core'
import { staffLocale } from '../../i18n/format'
import reportsRo from '../../i18n/ns/reports/ro'
import reportsEn from '../../i18n/ns/reports/en'
import reportsFr from '../../i18n/ns/reports/fr'
import reportsDe from '../../i18n/ns/reports/de'
import { toCsv } from '../reports'
import { toRomaniaYMD } from '../dates'
import { reportDayTotals, seriesPointLabel, type SeriesPoint } from '../dailySeries'
import {
  buildReportCsv,
  periodLabelT,
  reportCsvDialect,
  reportPeriodRange,
  reportPdfFilename,
  reportPdfText,
  type ReportExportData,
  type ReportMetrics,
  type ReportPeriod,
} from '../reportsExport'

const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')
const RO = makeTranslator(reportsRo, 'ro')
const TARGETS = [
  ['en', makeTranslator(reportsEn, 'en')],
  ['fr', makeTranslator(reportsFr, 'fr')],
  ['de', makeTranslator(reportsDe, 'de')],
] as const

const METRICS: ReportMetrics = {
  totalOrders: 12,
  revenue: 845.5,
  cashRev: 400,
  cardRev: 300.25,
  voucherRev: 45.25,
  onlineRev: 80,
  otherRev: 20,
  qrOrders: 1,
  waiterOrders: 11,
  avgTicket: 70.458,
}
const DATA: ReportExportData = {
  metrics: METRICS,
  topProducts: [
    { name: 'Supă de roșii', qty: 4, revenue: 60, emoji: '🍅' },
    { name: '=Ciorbă, "rădăuțeană"', qty: 3, revenue: 67.5, emoji: '🍲' },
  ],
  waiterSales: [
    { waiter_id: 'w1', waiter_name: 'Ioana Mărgărit', order_count: 7, total_revenue: 500.5, avg_ticket: 71.5, discount_total: 12 },
    { waiter_id: null, waiter_name: 'Fără ospătar', order_count: 5, total_revenue: 345, avg_ticket: 69, discount_total: 0 },
  ],
  categorySales: [
    { category_id: 'c1', category_name: 'Ciorbe', category_emoji: '🍲', item_count: 7, total_revenue: 127.5, percent_total: 62.34 },
  ],
  hourlySales: [
    { hour: 9, order_count: 0, total_revenue: 0 },
    { hour: 13, order_count: 4, total_revenue: 300 },
  ],
}

// ─── ORACOLUL: codul de dinainte din ReportsTab, copiat VERBATIM ─────────────
// (doar parametrizat: variabilele din componentă au devenit argumente).
// Singura abatere de la verbatim: `timeZone: 'UTC'`. Codul vechi formata
// `new Date('YYYY-MM-DD')` (miezul nopții UTC) pe fusul GAZDEI, deci era el
// însuși dependent de gazdă — la vest de UTC arăta ziua de DINAINTE (defectul
// reparat de `formatYmd`). Pe gazdele UTC și la est de UTC (inclusiv România)
// oracolul dă exact ce dădea codul vechi; fără fus fix YA7 pica pe o gazdă din
// America.
function oldPeriodLabel(p: ReportPeriod, from: string, to: string) {
  if (p === 'today') return 'Azi'
  if (p === 'week') return 'Ultimele 7 zile'
  if (p === 'month') return 'Ultimele 30 zile'
  if (from === to)
    return new Date(from).toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  return `${new Date(from).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', timeZone: 'UTC' })} – ${new Date(to).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
}
function oldCsv(period: ReportPeriod, range: { from: string; to: string }, d: ReportExportData) {
  const { totalOrders, revenue, avgTicket, cashRev, cardRev, voucherRev, onlineRev, otherRev, qrOrders, waiterOrders } =
    d.metrics
  const { topProducts, waiterSales, categorySales, hourlySales } = d
  const label = oldPeriodLabel(period, range.from, range.to)
  const safe = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const sections: string[] = []

  sections.push(`Raport Menuvia — ${label}`)
  sections.push('')

  sections.push('# Sumar')
  sections.push(
    toCsv([
      {
        Comenzi: totalOrders,
        'Venituri (lei)': revenue.toFixed(2),
        'Bon mediu (lei)': avgTicket.toFixed(2),
        'Cash (lei)': cashRev.toFixed(2),
        'Card (lei)': cardRev.toFixed(2),
        'Tichete de masă (lei)': voucherRev.toFixed(2),
        'Card online (lei)': onlineRev.toFixed(2),
        'Alte metode (lei)': otherRev.toFixed(2),
        'Comenzi QR': qrOrders,
        'Comenzi ospătar': waiterOrders,
      },
    ]),
  )
  sections.push('')

  if (topProducts.length > 0) {
    sections.push('# Top produse')
    sections.push(
      toCsv(
        topProducts.map((p, i) => ({
          '#': i + 1,
          Produs: p.name,
          Cantitate: p.qty,
          'Venituri (lei)': p.revenue.toFixed(2),
          'Preț mediu (lei)': (p.revenue / p.qty).toFixed(2),
        })),
      ),
    )
    sections.push('')
  }

  if (waiterSales.length > 0) {
    sections.push('# Vânzări pe ospătar')
    sections.push(
      toCsv(
        waiterSales.map((w) => ({
          Ospătar: w.waiter_name,
          Comenzi: w.order_count,
          'Venituri (lei)': w.total_revenue.toFixed(2),
          'Bon mediu (lei)': w.avg_ticket.toFixed(2),
          'Reduceri aplicate (lei)': w.discount_total.toFixed(2),
        })),
      ),
    )
    sections.push('')
  }

  if (categorySales.length > 0) {
    sections.push('# Vânzări pe categorie')
    sections.push(
      toCsv(
        categorySales.map((c) => ({
          Categorie: c.category_name,
          'Bucăți vândute': c.item_count,
          'Venituri (lei)': c.total_revenue.toFixed(2),
          '% din total': c.percent_total.toFixed(1) + '%',
        })),
      ),
    )
    sections.push('')
  }

  if (hourlySales.some((h) => h.order_count > 0)) {
    sections.push('# Vânzări pe oră')
    sections.push(
      toCsv(
        hourlySales.map((h) => ({
          Ora: `${String(h.hour).padStart(2, '0')}:00`,
          Comenzi: h.order_count,
          'Venituri (lei)': h.total_revenue.toFixed(2),
        })),
      ),
    )
  }

  return { filename: `raport-menuvia-${safe}.csv`, content: sections.join('\n') }
}
function oldPdfLines(m: ReportMetrics, range: { from: string; to: string }) {
  return {
    title: 'Raport Menuvia',
    summary: 'Sumar',
    totalOrders: `Total comenzi: ${m.totalOrders}`,
    revenueLine: `Venituri: ${m.revenue.toFixed(2)} lei  |  Bon mediu: ${m.avgTicket.toFixed(2)} lei`,
    methodsLine: `Cash: ${m.cashRev.toFixed(2)} lei  |  Card: ${m.cardRev.toFixed(2)} lei  |  Tichete: ${m.voucherRev.toFixed(2)} lei  |  Online: ${m.onlineRev.toFixed(2)} lei  |  Alte: ${m.otherRev.toFixed(2)} lei`,
    sourcesLine: `QR: ${m.qrOrders} comenzi  |  Ospătar manual: ${m.waiterOrders} comenzi`,
    topTitle: 'Top Produse',
    colProduct: 'Produs',
    colQty: 'Buc.',
    colRevenue: 'Venituri',
    disclaimer: 'Document operațional intern. Nu înlocuiește raportul Z fiscal al casei de marcat.',
    filename: `Raport-Menuvia-${range.from}${range.from !== range.to ? '-' + range.to : ''}.pdf`,
  }
}
const OLD_DAY_FMT = new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Bucharest' })
// ─────────────────────────────────────────────────────────────────────────────

const CASES: ReadonlyArray<[ReportPeriod, { from: string; to: string }]> = [
  ['today', { from: '2026-11-15', to: '2026-11-15' }],
  ['week', { from: '2026-11-09', to: '2026-11-15' }],
  ['month', { from: '2026-10-17', to: '2026-11-15' }],
  ['custom', { from: '2026-11-03', to: '2026-11-03' }],
  ['custom', { from: '2026-03-02', to: '2026-11-15' }],
]
const EMPTY: ReportExportData = { metrics: METRICS, topProducts: [], waiterSales: [], categorySales: [], hourlySales: [] }

// Valorile (date) — nu se traduc, deci se scot înainte de căutarea resturilor.
const DATA_VALUES = ['Supă de roșii', 'Ciorbă', 'rădăuțeană', 'Ioana Mărgărit', 'Fără ospătar', 'Ciorbe']
const RO_LETTERS = /[ăĂâÂîÎșȘțȚşŞţŢ]/
const RO_WORDS = /\b(?:Raport|Sumar|Comenzi|Venituri|Bon mediu|Tichete|Alte metode|Produs|Cantitate|Preț|Ospătar|Reduceri|Categorie|Bucăți|Vânzări|Ora|comenzi|din total)\b/u
function leftovers(text: string): string[] {
  let t = text
  for (const v of DATA_VALUES) t = t.split(v).join('')
  const out: string[] = []
  const w = t.match(RO_WORDS)
  if (w) out.push(`cuvânt: ${w[0]}`)
  const l = t.match(RO_LETTERS)
  if (l) out.push(`literă: ${l[0]}`)
  return out
}
// Cititor RFC 4180 minimal (ghilimele dublate, rânduri noi în ghilimele): un
// fișier → rânduri de celule, în separatorul dat.
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows
}
const BOM = '\uFEFF'
const bomCount = (s: string): number => s.split(BOM).length - 1
// Numărul de coloane al fiecărui tabel: rândul de după titlul de secțiune („# …”).
const headerCounts = (csv: string, sep: string): number[] => {
  const rows = parseCsv(csv.split(BOM).join(''), sep)
  const out: number[] = []
  rows.forEach((r, i) => {
    const next = rows[i + 1]
    if (r.length === 1 && r[0]!.startsWith('# ') && next) out.push(next.length)
  })
  return out
}
// Grila vechiului export în dialectul nou: fără BOM-uri, citită cu „,”, cu
// punctul zecimal al SUMELOR/procentelor devenit virgulă.
const oldGridInDialect = (old: string, decimal: string): string[][] =>
  parseCsv(old.split(BOM).join(''), ',').map((r) =>
    r.map((c) => (/^-?\d+\.\d+%?$/.test(c) ? c.replace('.', decimal) : c)),
  )
const fileRange = (r: { from: string; to: string }) => `${r.from}${r.from !== r.to ? '-' + r.to : ''}`
const point = (day: string): SeriesPoint => ({ from: day, to: day, orders: 0, revenue: 0 })
/** Ziua de pe grafic a unei comenzi create la `iso`: cheia zilei în fus + eticheta. */
const chartDayOf = (locale: string, iso: string, tz = 'Europe/Bucharest'): string => {
  const [day] = [...reportDayTotals([{ created_at: iso }], [], tz).keys()]
  return day ? seriesPointLabel(point(day), locale) : ''
}

describe('exportul CSV', () => {
  it('YA7: în română = celulele exportului de dinainte (oracol), pe toate perioadele', () => {
    const ro = reportCsvDialect('ro')
    for (const [p, range] of CASES) {
      const label = periodLabelT(RO, staffLocale('ro'), p, range.from, range.to)
      expect(label, p).toBe(oldPeriodLabel(p, range.from, range.to))
      for (const d of [DATA, EMPTY]) {
        const now = buildReportCsv(RO, label, range, d, ro)
        const old = oldCsv(p, range, d)
        expect(parseCsv(now.content.split(BOM).join(''), ro.sep), p).toEqual(oldGridInDialect(old.content, ro.decimal))
        // Același număr de rânduri fizice (secțiunile, rândurile goale dintre ele).
        expect(now.content.split('\n').length, p).toBe(old.content.split('\n').length)
      }
    }
    // Anti-vacuitate: oracolul chiar are toate secțiunile.
    const full = oldCsv('today', CASES[0]![1], DATA).content
    for (const h of ['# Sumar', '# Top produse', '# Vânzări pe ospătar', '# Vânzări pe categorie', '# Vânzări pe oră'])
      expect(full).toContain(h)
    // Ziua de pe grafic: cheia zilei pe București + data formatată = ziua de dinainte.
    for (const iso of ['2026-11-14T23:30:00Z', '2026-03-29T00:30:00Z', '2026-07-01T12:00:00Z'])
      expect(chartDayOf(staffLocale('ro'), iso)).toBe(OLD_DAY_FMT.format(new Date(iso)))
  })

  it('XL1: un singur BOM, la octetul 0 (controlul: exportul vechi le avea la mijloc)', () => {
    const old = oldCsv('today', CASES[0]![1], DATA).content
    expect(old.startsWith(BOM)).toBe(false)
    expect(bomCount(old)).toBeGreaterThan(1)
    const all = [['ro', RO], ...TARGETS] as const
    for (const [lang, tr] of all)
      for (const d of [DATA, EMPTY])
        for (const [, range] of CASES) {
          const { content } = buildReportCsv(tr, tr.t('period_today'), range, d, reportCsvDialect(lang))
          expect(content.startsWith(BOM), lang).toBe(true)
          expect(bomCount(content), lang).toBe(1)
        }
  })

  it('XL2: dialectul urmează limba; rândurile românești, octet cu octet', () => {
    expect(reportCsvDialect('ro')).toEqual({ sep: ';', decimal: ',' })
    expect(reportCsvDialect('fr')).toEqual({ sep: ';', decimal: ',' })
    expect(reportCsvDialect('de')).toEqual({ sep: ';', decimal: ',' })
    expect(reportCsvDialect('en')).toEqual({ sep: ',', decimal: '.' })
    const lines = buildReportCsv(RO, 'Azi', CASES[0]![1], DATA, reportCsvDialect('ro')).content.split('\n')
    expect(lines.slice(0, 5)).toEqual([
      `${BOM}Raport Menuvia — Azi`,
      '',
      '# Sumar',
      'Comenzi;Venituri (lei);Bon mediu (lei);Cash (lei);Card (lei);Tichete de masă (lei);Card online (lei);Alte metode (lei);Comenzi QR;Comenzi ospătar',
      '12;845,50;70,46;400,00;300,25;45,25;80,00;20,00;1;11',
    ])
    // Celula cu virgulă NU mai cere ghilimele sub „;”; cea cu ghilimele, da.
    expect(lines).toContain('1;Supă de roșii;4;60,00;15,00')
    expect(lines).toContain(`2;"'=Ciorbă, ""rădăuțeană""";3;67,50;22,50`)
    expect(lines).toContain('Ciorbe;7;127,50;62,3%')
    expect(lines).toContain('13:00;4;300,00')
    // În engleză: virgulă și punct, ca înainte.
    const en = buildReportCsv(TARGETS[0][1], 'Today', CASES[0]![1], DATA, reportCsvDialect('en')).content
    expect(en).toContain('Ioana Mărgărit,7,500.50,71.50,12.00')
    expect(en).toContain(`2,"'=Ciorbă, ""rădăuțeană""",3,67.50,22.50`)
  })

  it('XL3: numele fișierului poartă intervalul, în toate limbile', () => {
    const day = { from: '2026-11-15', to: '2026-11-15' }
    const span = { from: '2026-03-02', to: '2026-11-15' }
    const [en, fr, de] = [TARGETS[0][1], TARGETS[1][1], TARGETS[2][1]]
    expect(buildReportCsv(RO, 'x', day, EMPTY, reportCsvDialect('ro')).filename).toBe('raport-menuvia-2026-11-15.csv')
    expect(buildReportCsv(RO, 'x', span, EMPTY, reportCsvDialect('ro')).filename).toBe(
      'raport-menuvia-2026-03-02-2026-11-15.csv',
    )
    expect(buildReportCsv(en, 'x', day, EMPTY, reportCsvDialect('en')).filename).toBe('menuvia-report-2026-11-15.csv')
    expect(buildReportCsv(fr, 'x', span, EMPTY, reportCsvDialect('fr')).filename).toBe(
      'rapport-menuvia-2026-03-02-2026-11-15.csv',
    )
    expect(buildReportCsv(de, 'x', day, EMPTY, reportCsvDialect('de')).filename).toBe('menuvia-bericht-2026-11-15.csv')
    // Aceeași regulă de interval ca PDF-ul.
    for (const [, range] of CASES)
      expect(buildReportCsv(RO, 'x', range, EMPTY, reportCsvDialect('ro')).filename).toBe(
        `raport-menuvia-${fileRange(range)}.csv`,
      )
  })

  it('YA9a: CSV în en/fr/de — fără resturi românești, valorile netraduse, aceleași coloane', () => {
    const today = CASES[0]![1]
    const roDialect = reportCsvDialect('ro')
    const roCsv = buildReportCsv(RO, RO.t('period_today'), today, DATA, roDialect)
    // Control POZITIV: verificarea găsește resturi în exportul românesc.
    expect(leftovers(roCsv.content).length).toBeGreaterThan(0)
    const roCounts = headerCounts(roCsv.content, roDialect.sep)
    expect(roCounts).toEqual([10, 5, 5, 4, 3])
    const files: Record<string, string> = {}
    for (const [lang, tr] of TARGETS) {
      const dialect = reportCsvDialect(lang)
      const dec = (s: string) => s.replace('.', dialect.decimal)
      const csv = buildReportCsv(tr, tr.t('period_today'), today, DATA, dialect)
      files[lang] = csv.filename
      expect(leftovers(csv.content), lang).toEqual([])
      expect(csv.content, lang).not.toMatch(/\{\w+\}/)
      expect(headerCounts(csv.content, dialect.sep), lang).toEqual(roCounts)
      // Valorile rămân cum au venit (inclusiv neutralizarea formulei din toCsv).
      expect(csv.content, lang).toContain('Supă de roșii')
      expect(csv.content, lang).toContain(`"'=Ciorbă, ""rădăuțeană"""`)
      expect(csv.content, lang).toContain(
        ['Ioana Mărgărit', '7', dec('500.50'), dec('71.50'), dec('12.00')].join(dialect.sep),
      )
      expect(csv.content, lang).toContain(dec('62.3') + '%')
      expect(csv.content, lang).toContain(['13:00', '4', dec('300.00')].join(dialect.sep))
      expect(csv.filename, lang).toMatch(/^[a-z0-9-]+\.csv$/)
    }
    expect(files).toEqual({
      en: 'menuvia-report-2026-11-15.csv',
      fr: 'rapport-menuvia-2026-11-15.csv',
      de: 'menuvia-bericht-2026-11-15.csv',
    })
    expect(buildReportCsv(TARGETS[0][1], 'Today', today, DATA, reportCsvDialect('en')).content.split('\n')[0]).toBe(
      `${BOM}Menuvia report — Today`,
    )
  })
})

describe('exportul PDF', () => {
  it('YA8: în română = liniile și numele fișierului de dinainte (oracol)', () => {
    for (const m of [METRICS, { ...METRICS, qrOrders: 2, waiterOrders: 1 }, { ...METRICS, qrOrders: 21, waiterOrders: 0 }]) {
      const { filename, ...lines } = oldPdfLines(m, CASES[4]![1])
      expect(reportPdfText(RO, m)).toEqual(lines)
      expect(reportPdfFilename(RO, CASES[4]![1].from, CASES[4]![1].to)).toBe(filename)
    }
    expect(reportPdfFilename(RO, '2026-11-15', '2026-11-15')).toBe('Raport-Menuvia-2026-11-15.pdf')
    // Nota de pe ecran și cea din PDF au aceeași formulare.
    expect(reportsRo.disclaimer).toBe(reportsRo.pdf_disclaimer)
  })

  it('YA9b: PDF în en/fr/de — Latin-1, plural acordat, fără resturi, nume de fișier', () => {
    const roLines = Object.values(reportPdfText(RO, METRICS)).join('\n')
    expect(leftovers(roLines).length).toBeGreaterThan(0) // control pozitiv
    for (const [lang, tr] of TARGETS) {
      const lines = reportPdfText(tr, METRICS)
      const all = Object.values(lines).join('\n')
      expect(leftovers(all), lang).toEqual([])
      expect(all, lang).not.toMatch(/\{\w+\}/)
      // Fonturile standard jsPDF: doar Latin-1 (patchPdfDiacritics e doar pentru română).
      const outside = [...all].filter((c) => c.charCodeAt(0) > 0xff)
      expect(outside, lang).toEqual([])
      // Sumele rămân `toFixed(2)` + „lei”.
      expect(lines.revenueLine, lang).toContain('845.50 lei')
      expect(lines.revenueLine, lang).toContain('70.46 lei')
      expect(lines.methodsLine, lang).toContain('300.25 lei')
      expect(tr.lang === lang).toBe(true)
      expect(reportsEn.disclaimer).toBe(reportsEn.pdf_disclaimer)
    }
    const en = TARGETS[0][1]
    expect(reportPdfText(en, METRICS).sourcesLine).toBe('QR: 1 order  |  Waiter (manual): 11 orders')
    expect(reportPdfText(RO, METRICS).sourcesLine).toBe('QR: 1 comenzi  |  Ospătar manual: 11 comenzi')
    const fr = TARGETS[1][1]
    expect(fr.tp('pdf_orders', 1000000)).toBe('1000000 de commandes')
    expect(fr.tp('pdf_orders', 3)).toBe('3 commandes')
    expect(fr.tp('top_title', 1)).toBe('Top 1 produit')
    expect(RO.tp('top_title', 1)).toBe('Top 1 produse') // pluralul fals de azi
    expect(reportPdfFilename(en, '2026-11-01', '2026-11-15')).toBe('Menuvia-report-2026-11-01-2026-11-15.pdf')
    expect(reportPdfFilename(TARGETS[2][1], '2026-11-15', '2026-11-15')).toBe('Menuvia-Bericht-2026-11-15.pdf')
  })
})

describe('perioada și ziua de pe grafic', () => {
  it('YA10: urmează limba; fusul rămâne al României', () => {
    for (const [lang, tr] of TARGETS) {
      const loc = staffLocale(lang)
      for (const p of ['today', 'week', 'month'] as const) {
        const label = periodLabelT(tr, loc, p, '2026-11-01', '2026-11-15')
        expect(label, `${lang} ${p}`).not.toBe(oldPeriodLabel(p, '2026-11-01', '2026-11-15'))
        expect(label, lang).not.toMatch(RO_LETTERS)
      }
      const range = periodLabelT(tr, loc, 'custom', '2026-03-02', '2026-11-15')
      expect(range, lang).toContain(' – ')
      expect(range, lang).toContain('2026')
    }
    expect(periodLabelT(TARGETS[0][1], 'en-GB', 'custom', '2026-11-03', '2026-11-03')).toMatch(/November/)
    expect(periodLabelT(TARGETS[2][1], 'de-DE', 'custom', '2026-11-03', '2026-11-03')).toMatch(/November/)
    expect(periodLabelT(RO, 'ro-RO', 'custom', '2026-11-03', '2026-11-03')).toMatch(/noiembrie/)
    // 23:30 UTC pe 14 noiembrie = 01:30 pe 15 noiembrie în România, în orice limbă.
    const late = '2026-11-14T23:30:00Z'
    expect(chartDayOf('ro-RO', late)).toBe('15.11')
    expect(chartDayOf('en-GB', late)).toBe('15/11')
    expect(chartDayOf('fr-FR', late)).toBe('15/11')
    expect(chartDayOf('de-DE', late)).toBe('15.11.')
    // Mutația „ziua UTC”: pe UTC aceeași comandă ar fi pe 14.
    expect(chartDayOf('ro-RO', late, 'UTC')).toBe('14.11')
  })
})

// ORACOLUL perioadei: `addDays` + `periodRange` de dinainte din ReportsTab,
// VERBATIM (doar „azi” devenit parametru).
function oldAddDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function oldPeriodRange(p: ReportPeriod, custom: { from: string; to: string }, today: Date) {
  const todayYMD = toRomaniaYMD(today)
  if (p === 'today') return { from: todayYMD, to: todayYMD }
  if (p === 'week') return { from: toRomaniaYMD(oldAddDays(today, -6)), to: todayYMD }
  if (p === 'month') return { from: toRomaniaYMD(oldAddDays(today, -29)), to: todayYMD }
  return custom
}

describe('perioada pe fusul zilei de raportare (lotul G2b)', () => {
  const custom = { from: '2026-03-02', to: '2026-03-09' }
  it('YA12: pe București = perioada de dinainte (cu excepția consemnată)', () => {
    const instants = [
      '2026-11-15T10:00:00Z',
      '2026-11-14T22:30:00Z', // 00:30 pe 15 nov la București
      '2026-10-24T22:30:00Z', // 01:30 pe 25 oct (zi de 25 h)
      '2026-03-28T22:30:00Z', // 00:30 pe 29 mar (zi de 23 h)
      '2026-01-01T21:59:00Z',
    ]
    for (const iso of instants)
      for (const p of ['today', 'week', 'month', 'custom'] as const)
        expect(reportPeriodRange(p, custom, 'Europe/Bucharest', new Date(iso)), `${iso} ${p}`).toEqual(
          oldPeriodRange(p, custom, new Date(iso)),
        )
    // 23:30 pe 25 oct (ziua de 25 h): vechiul `setDate` pe fusul gazdei scădea,
    // pe o gazdă UTC (CI), 6 × 24 h și ajungea pe 20 oct — o săptămână de 6
    // zile; pe o gazdă din România dădea 19 oct. Valoarea veche depinde deci de
    // gazdă și NU se aserteză; cea nouă e 7 zile calendaristice pe orice gazdă.
    const late = new Date('2026-10-25T21:30:00Z')
    expect(reportPeriodRange('week', custom, 'Europe/Bucharest', late)).toEqual({ from: '2026-10-19', to: '2026-10-25' })
  })

  it('YA13: pe fusul localului (New York)', () => {
    const now = new Date('2026-11-13T04:30:00Z')
    const tz = 'America/New_York'
    expect(reportPeriodRange('today', custom, tz, now)).toEqual({ from: '2026-11-12', to: '2026-11-12' })
    expect(reportPeriodRange('week', custom, tz, now)).toEqual({ from: '2026-11-06', to: '2026-11-12' })
    expect(reportPeriodRange('month', custom, tz, now)).toEqual({ from: '2026-10-14', to: '2026-11-12' })
    expect(reportPeriodRange('custom', custom, tz, now)).toEqual(custom)
  })

  it('YA14: ziua de pe grafic în fusul dat; eticheta perioadei pe DATE', () => {
    const late = '2026-11-14T23:30:00Z'
    expect(chartDayOf('ro-RO', late, 'America/New_York')).toBe('14.11')
    expect(chartDayOf('ro-RO', late)).toBe('15.11')
    expect(chartDayOf('en-GB', late, 'America/New_York')).toBe('14/11')
    // Fus invalid → București, nu RangeError în randarea graficului.
    expect(chartDayOf('ro-RO', late, 'Mars/Olympus')).toBe('15.11')
    const helper = read('src/lib/reportsExport.ts')
    const body = helper.slice(helper.indexOf('export function periodLabelT('))
    const fn = body.slice(0, body.indexOf('\n}\n'))
    expect(fn).toContain('formatYmd(from')
    expect(fn).not.toMatch(/new Date\((from|to)\)/)
  })
})

describe('precondițiile filei', () => {
  it('YA11: namespace-urile cerute sus, fără toUserMessage direct, fila leneșă', () => {
    const src = read('src/components/ReportsTab.tsx')
    const body = src.slice(src.indexOf('export default function ReportsTab('))
    const firstReturn = body.search(/\n\s+return[\s(]/)
    expect(firstReturn).toBeGreaterThan(0)
    const head = body.slice(0, firstReturn)
    expect(head).toContain('useT(reportsNs)')
    expect(head).toContain('useT(commonNs)')
    const used = [...src.matchAll(/useT\((\w+)\)/g)].map((m) => m[1]).sort()
    expect(used).toEqual(['commonNs', 'reportsNs'])
    expect(src).not.toMatch(/toUserMessage\(/)
    expect(src).toMatch(/describeStaffError\(error\.err, tc/)
    // Nota despre raportul Z rămâne doar pe planul cu bon.
    expect(src).toMatch(/\{fiscalReports && \(\s*<div[\s\S]{0,400}?\{tr\.t\('disclaimer'\)\}/)
    // Fila e leneșă în DashboardPage (namespace-ul nu intră în graful static).
    expect(read('src/pages/DashboardPage.tsx')).toContain("const ReportsTab = lazy(() => import('../components/ReportsTab'))")
    // Helperul pur ia din i18n/ns doar TIPUL.
    const helper = read('src/lib/reportsExport.ts')
    const nsImports = helper.split('\n').filter((l) => /from '\.\.\/i18n\/ns\//.test(l))
    expect(nsImports.length).toBeGreaterThan(0)
    for (const l of nsImports) expect(l).toMatch(/^import type /)
  })
})
