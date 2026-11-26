// src/lib/reportsExport.ts — textele fila Vânzări care nu sunt JSX (lotul L7):
// eticheta perioadei și cele două exporturi (CSV, PDF). Pur: primește
// traducătorul namespace-ului `reports` ca parametru și importă din `i18n/ns`
// doar TIPUL (SK4).
// În română TEXTELE sunt cele de dinainte (antetele CSV, titlurile secțiunilor,
// liniile PDF) — reportsLang.test.ts le compară cu o copie VERBATIM a codului
// vechi din ReportsTab (oracol). Lotul C6a a schimbat DELIBERAT forma CSV-ului
// (nu textele): un singur BOM, la octetul 0 (înainte unul în fața FIECĂREI
// secțiuni și niciunul la început → diacriticele ieșeau stricate în Excel),
// separatorul și semnul zecimal ale limbii (`reportCsvDialect`) și intervalul
// de zile în numele fișierului (înainte „raport-menuvia-azi.csv” în fiecare zi).
// Ce NU se traduce (date): numele produselor/ospătarilor/categoriilor, sumele
// (`toFixed` + „lei” în PDF), procentele, ora („14:00”).
import type { Translator } from '../i18n/core'
import type { StaffLang } from '../i18n/langs'
import type reportsRo from '../i18n/ns/reports/ro'
import {
  csvCell,
  toCsv,
  type CategorySalesRow,
  type CsvDialect,
  type HourlySalesRow,
  type WaiterSalesRow,
} from './reports'
import { addDaysYmd, formatYmd, toZonedYMD } from './dates'

export type ReportsT = Translator<typeof reportsRo>

// ── Rândurile-santinelă ale rapoartelor pe ospătar și pe categorie ──
// `report_by_waiter`/`report_by_category` (mig 122) scriu ÎN SQL trei texte
// românești pe rândurile fără nume: comenzile QR (fără ospătar), un ospătar
// fără nume în profil și produsele fără categorie. În română se afișează
// textul serverului, neschimbat; în celelalte limbi rândul se recunoaște după
// ID (null) — nu după text, cu excepția ospătarului fără nume, pentru care
// serverul nu lasă alt semn — și primește eticheta tradusă.
const SERVER_UNKNOWN_WAITER = 'Necunoscut'

export function waiterRowLabel(w: Pick<WaiterSalesRow, 'waiter_id' | 'waiter_name'>, tr: ReportsT): string {
  if (tr.lang === 'ro') return w.waiter_name
  if (w.waiter_id == null) return tr.t('row_waiterQr')
  if (w.waiter_name === SERVER_UNKNOWN_WAITER) return tr.t('row_waiterUnknown')
  return w.waiter_name
}

export function categoryRowLabel(c: Pick<CategorySalesRow, 'category_id' | 'category_name'>, tr: ReportsT): string {
  if (tr.lang === 'ro' || c.category_id != null) return c.category_name
  return tr.t('row_noCategory')
}
export type ReportPeriod = 'today' | 'week' | 'month' | 'custom'

export interface ReportMetrics {
  totalOrders: number
  revenue: number
  cashRev: number
  cardRev: number
  voucherRev: number
  onlineRev: number
  otherRev: number
  qrOrders: number
  waiterOrders: number
  avgTicket: number
}

export interface ReportTopProduct {
  name: string
  qty: number
  revenue: number
  emoji: string
}

/**
 * Intervalul de zile (YYYY-MM-DD, capete incluse) al unei perioade, în fusul
 * zilei de raportare (`reportTimeZone`, lotul G2b): azi, ultimele 7 zile,
 * ultimele 30 de zile sau intervalul ales. Aritmetica e pe ȘIR (`addDaysYmd`),
 * nu `setDate` pe fusul browserului — acela amesteca ziua telefonului cu ziua
 * localului lângă miezul nopții și peste schimbarea orei.
 */
export function reportPeriodRange(
  p: ReportPeriod,
  custom: { from: string; to: string },
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = toZonedYMD(now, timeZone)
  if (p === 'today') return { from: today, to: today }
  if (p === 'week') return { from: addDaysYmd(today, -6), to: today }
  if (p === 'month') return { from: addDaysYmd(today, -29), to: today }
  return custom
}

/** Eticheta perioadei (antetul filei, titlul CSV, linia a doua din PDF).
 *  `locale` = `staffLocale(limbă)` — în română „ro-RO”, ca înainte. Capetele
 *  sunt DATE fără oră: `formatYmd`, nu `new Date(șir)` formatat pe fusul
 *  gazdei (care arăta ziua de dinainte pe un browser la vest de UTC). */
export function periodLabelT(
  tr: ReportsT,
  locale: string,
  p: ReportPeriod,
  from: string,
  to: string,
): string {
  if (p === 'today') return tr.t('period_today')
  if (p === 'week') return tr.t('period_week')
  if (p === 'month') return tr.t('period_month')
  if (from === to) return formatYmd(from, locale, { day: '2-digit', month: 'long', year: 'numeric' })
  return tr.t('period_range', {
    from: formatYmd(from, locale, { day: '2-digit', month: 'short' }),
    to: formatYmd(to, locale, { day: '2-digit', month: 'short', year: 'numeric' }),
  })
}

// Ziua de pe axa graficului: din lotul C6a, graficul are FIECARE zi a
// intervalului (`chartSeries`, lib/dailySeries.ts), cu cheia YYYY-MM-DD deja în
// fusul zilei de raportare (`reportDayTotals`), iar eticheta e acea DATĂ
// formatată (`seriesPointLabel`) — fără instantul „primei comenzi din zi” pe
// care îl formata înainte `chartDayLabel`.

/** Dialectul CSV-ului după limba UTILIZATORULUI (formatul, ca `staffLocale` —
 *  nu limba dicționarului servit): „;” și virgula zecimală în română, franceză
 *  și germană, unde Excel-ul regional desparte lista cu „;”; „,” și punctul în
 *  engleză. */
export function reportCsvDialect(lang: StaffLang): CsvDialect {
  return lang === 'en' ? { sep: ',', decimal: '.' } : { sep: ';', decimal: ',' }
}

export interface ReportExportData {
  metrics: ReportMetrics
  topProducts: readonly ReportTopProduct[]
  waiterSales: readonly WaiterSalesRow[]
  categorySales: readonly CategorySalesRow[]
  hourlySales: readonly HourlySalesRow[]
}

/** Exportul CSV: numele fișierului + conținutul. Secțiunile (titlul, apoi un
 *  tabel per secțiune prin `toCsv`) sunt separate de un rând gol, ca înainte;
 *  din lotul C6a fișierul are UN singur BOM UTF-8, la octetul 0 (Excel
 *  recunoaște UTF-8 doar așa — tabelele se construiesc fără BOM), iar tabelele
 *  sunt în `dialect` (`reportCsvDialect(limba utilizatorului)`): separatorul de
 *  coloane și semnul zecimal al sumelor. Numele fișierului poartă intervalul,
 *  ca PDF-ul. */
export function buildReportCsv(
  tr: ReportsT,
  label: string,
  range: { from: string; to: string },
  d: ReportExportData,
  dialect: CsvDialect,
): { filename: string; content: string } {
  const m = d.metrics
  const opts = { ...dialect, bom: false }
  // Sumele: `toFixed` ca înainte, cu semnul zecimal al dialectului (în
  // română „845,50”, pe care Excel-ul românesc îl citește ca număr).
  const num = (n: number, digits = 2): string => n.toFixed(digits).replace('.', dialect.decimal)
  // Rândurile de text (titlul, „# Sumar”…) trec prin aceeași celulă CSV: un
  // separator în etichetă nu poate rupe rândul în coloane.
  const line = (text: string): string => csvCell(text, dialect)
  const sections: string[] = []

  sections.push(line(tr.t('csv_title', { label })))
  sections.push('')

  sections.push(line(tr.t('csv_summary')))
  sections.push(
    toCsv(
      [
        {
          [tr.t('csvh_orders')]: m.totalOrders,
          [tr.t('csvh_revenue')]: num(m.revenue),
          [tr.t('csvh_avgTicket')]: num(m.avgTicket),
          [tr.t('csvh_cash')]: num(m.cashRev),
          [tr.t('csvh_card')]: num(m.cardRev),
          [tr.t('csvh_voucher')]: num(m.voucherRev),
          [tr.t('csvh_online')]: num(m.onlineRev),
          [tr.t('csvh_other')]: num(m.otherRev),
          [tr.t('csvh_qrOrders')]: m.qrOrders,
          [tr.t('csvh_waiterOrders')]: m.waiterOrders,
        },
      ],
      opts,
    ),
  )
  sections.push('')

  if (d.topProducts.length > 0) {
    sections.push(line(tr.t('csv_top')))
    sections.push(
      toCsv(
        d.topProducts.map((p, i) => ({
          '#': i + 1,
          [tr.t('csvh_product')]: p.name,
          [tr.t('csvh_quantity')]: p.qty,
          [tr.t('csvh_revenue')]: num(p.revenue),
          [tr.t('csvh_avgPrice')]: num(p.revenue / p.qty),
        })),
        opts,
      ),
    )
    sections.push('')
  }

  if (d.waiterSales.length > 0) {
    sections.push(line(tr.t('csv_waiters')))
    sections.push(
      toCsv(
        d.waiterSales.map((w) => ({
          [tr.t('csvh_waiter')]: waiterRowLabel(w, tr),
          [tr.t('csvh_orders')]: w.order_count,
          [tr.t('csvh_revenue')]: num(w.total_revenue),
          [tr.t('csvh_avgTicket')]: num(w.avg_ticket),
          [tr.t('csvh_discounts')]: num(w.discount_total),
        })),
        opts,
      ),
    )
    sections.push('')
  }

  if (d.categorySales.length > 0) {
    sections.push(line(tr.t('csv_categories')))
    sections.push(
      toCsv(
        d.categorySales.map((c) => ({
          [tr.t('csvh_category')]: categoryRowLabel(c, tr),
          [tr.t('csvh_itemsSold')]: c.item_count,
          [tr.t('csvh_revenue')]: num(c.total_revenue),
          [tr.t('csvh_pctTotal')]: num(c.percent_total, 1) + '%',
        })),
        opts,
      ),
    )
    sections.push('')
  }

  if (d.hourlySales.some((h) => h.order_count > 0)) {
    sections.push(line(tr.t('csv_hourly')))
    sections.push(
      toCsv(
        d.hourlySales.map((h) => ({
          [tr.t('csvh_hour')]: `${String(h.hour).padStart(2, '0')}:00`,
          [tr.t('csvh_orders')]: h.order_count,
          [tr.t('csvh_revenue')]: num(h.total_revenue),
        })),
        opts,
      ),
    )
  }

  return { filename: reportCsvFilename(tr, range.from, range.to), content: '\uFEFF' + sections.join('\n') }
}

// Intervalul din numele fișierelor: AAAA-LL-ZZ, sau AAAA-LL-ZZ-AAAA-LL-ZZ.
const rangeSlug = (from: string, to: string): string => `${from}${from !== to ? '-' + to : ''}`

/** Numele fișierului CSV: intervalul, ca la PDF (înainte eticheta perioadei —
 *  „raport-menuvia-azi.csv” era ACELAȘI în fiecare zi). */
export function reportCsvFilename(tr: ReportsT, from: string, to: string): string {
  return tr.t('csv_file', { range: rangeSlug(from, to) })
}

/** Numele fișierului PDF: intervalul în AAAA-LL-ZZ (o singură zi = o dată). */
export function reportPdfFilename(tr: ReportsT, from: string, to: string): string {
  return tr.t('pdf_file', { range: rangeSlug(from, to) })
}

/** Liniile de text ale PDF-ului, în ordinea în care le scrie ReportsTab. */
export interface ReportPdfText {
  title: string
  summary: string
  totalOrders: string
  revenueLine: string
  methodsLine: string
  sourcesLine: string
  topTitle: string
  colProduct: string
  colQty: string
  colRevenue: string
  disclaimer: string
}

export function reportPdfText(tr: ReportsT, m: ReportMetrics): ReportPdfText {
  return {
    title: tr.t('pdf_title'),
    summary: tr.t('pdf_summary'),
    totalOrders: tr.t('pdf_totalOrders', { n: m.totalOrders }),
    revenueLine: tr.t('pdf_revenueLine', {
      revenue: m.revenue.toFixed(2),
      avg: m.avgTicket.toFixed(2),
    }),
    methodsLine: tr.t('pdf_methodsLine', {
      cash: m.cashRev.toFixed(2),
      card: m.cardRev.toFixed(2),
      voucher: m.voucherRev.toFixed(2),
      online: m.onlineRev.toFixed(2),
      other: m.otherRev.toFixed(2),
    }),
    sourcesLine: tr.t('pdf_sourcesLine', {
      qr: tr.tp('pdf_orders', m.qrOrders),
      waiter: tr.tp('pdf_orders', m.waiterOrders),
    }),
    topTitle: tr.t('pdf_top'),
    colProduct: tr.t('pdf_colProduct'),
    colQty: tr.t('pdf_colQty'),
    colRevenue: tr.t('pdf_colRevenue'),
    disclaimer: tr.t('pdf_disclaimer'),
  }
}
