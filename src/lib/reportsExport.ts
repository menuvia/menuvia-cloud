// src/lib/reportsExport.ts — textele fila Vânzări care nu sunt JSX (lotul L7):
// eticheta perioadei, ziua de pe graficul de venituri și cele două exporturi
// (CSV, PDF). Pur: primește traducătorul namespace-ului `reports` ca
// parametru și importă din `i18n/ns` doar TIPUL (SK4).
// În română ieșirea e BYTE-identică cu exportul de dinainte (antetele CSV,
// titlurile secțiunilor, liniile PDF, numele fișierelor) — reportsLang.test.ts
// o compară cu o copie VERBATIM a codului vechi din ReportsTab (oracol).
// Ce NU se traduce (date): numele produselor/ospătarilor/categoriilor, sumele
// (`toFixed` + „lei”, în orice limbă — formatul de azi; un CSV cu virgulă
// zecimală ar schimba coloanele numerice), procentele, ora („14:00”).
import type { Translator } from '../i18n/core'
import type reportsRo from '../i18n/ns/reports/ro'
import { toCsv, type CategorySalesRow, type HourlySalesRow, type WaiterSalesRow } from './reports'

export type ReportsT = Translator<typeof reportsRo>
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

/** Eticheta perioadei (antetul filei, titlul CSV, linia a doua din PDF).
 *  `locale` = `staffLocale(limbă)` — în română „ro-RO”, ca înainte. */
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
  if (from === to)
    return new Date(from).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  return tr.t('period_range', {
    from: new Date(from).toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
    to: new Date(to).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
  })
}

// Ziua de pe axa graficului (în română „15.11”, ca înainte). Fusul rămâne
// Europe/Bucharest în orice limbă (fusul e lotul G2). Un formatter per limbă,
// construit o singură dată (OPT-R2: nu per comandă în buclă).
const dayFormatters = new Map<string, Intl.DateTimeFormat>()
export function chartDayLabel(locale: string, iso: string): string {
  let f = dayFormatters.get(locale)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Bucharest' })
    dayFormatters.set(locale, f)
  }
  return f.format(new Date(iso))
}

export interface ReportExportData {
  metrics: ReportMetrics
  topProducts: readonly ReportTopProduct[]
  waiterSales: readonly WaiterSalesRow[]
  categorySales: readonly CategorySalesRow[]
  hourlySales: readonly HourlySalesRow[]
}

/** Exportul CSV: numele fișierului + conținutul (secțiuni separate de un rând
 *  gol, fiecare tabel prin `toCsv`, ca înainte). */
export function buildReportCsv(
  tr: ReportsT,
  label: string,
  d: ReportExportData,
): { filename: string; content: string } {
  const m = d.metrics
  const safe = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const sections: string[] = []

  sections.push(tr.t('csv_title', { label }))
  sections.push('')

  sections.push(tr.t('csv_summary'))
  sections.push(
    toCsv([
      {
        [tr.t('csvh_orders')]: m.totalOrders,
        [tr.t('csvh_revenue')]: m.revenue.toFixed(2),
        [tr.t('csvh_avgTicket')]: m.avgTicket.toFixed(2),
        [tr.t('csvh_cash')]: m.cashRev.toFixed(2),
        [tr.t('csvh_card')]: m.cardRev.toFixed(2),
        [tr.t('csvh_voucher')]: m.voucherRev.toFixed(2),
        [tr.t('csvh_online')]: m.onlineRev.toFixed(2),
        [tr.t('csvh_other')]: m.otherRev.toFixed(2),
        [tr.t('csvh_qrOrders')]: m.qrOrders,
        [tr.t('csvh_waiterOrders')]: m.waiterOrders,
      },
    ]),
  )
  sections.push('')

  if (d.topProducts.length > 0) {
    sections.push(tr.t('csv_top'))
    sections.push(
      toCsv(
        d.topProducts.map((p, i) => ({
          '#': i + 1,
          [tr.t('csvh_product')]: p.name,
          [tr.t('csvh_quantity')]: p.qty,
          [tr.t('csvh_revenue')]: p.revenue.toFixed(2),
          [tr.t('csvh_avgPrice')]: (p.revenue / p.qty).toFixed(2),
        })),
      ),
    )
    sections.push('')
  }

  if (d.waiterSales.length > 0) {
    sections.push(tr.t('csv_waiters'))
    sections.push(
      toCsv(
        d.waiterSales.map((w) => ({
          [tr.t('csvh_waiter')]: w.waiter_name,
          [tr.t('csvh_orders')]: w.order_count,
          [tr.t('csvh_revenue')]: w.total_revenue.toFixed(2),
          [tr.t('csvh_avgTicket')]: w.avg_ticket.toFixed(2),
          [tr.t('csvh_discounts')]: w.discount_total.toFixed(2),
        })),
      ),
    )
    sections.push('')
  }

  if (d.categorySales.length > 0) {
    sections.push(tr.t('csv_categories'))
    sections.push(
      toCsv(
        d.categorySales.map((c) => ({
          [tr.t('csvh_category')]: c.category_name,
          [tr.t('csvh_itemsSold')]: c.item_count,
          [tr.t('csvh_revenue')]: c.total_revenue.toFixed(2),
          [tr.t('csvh_pctTotal')]: c.percent_total.toFixed(1) + '%',
        })),
      ),
    )
    sections.push('')
  }

  if (d.hourlySales.some((h) => h.order_count > 0)) {
    sections.push(tr.t('csv_hourly'))
    sections.push(
      toCsv(
        d.hourlySales.map((h) => ({
          [tr.t('csvh_hour')]: `${String(h.hour).padStart(2, '0')}:00`,
          [tr.t('csvh_orders')]: h.order_count,
          [tr.t('csvh_revenue')]: h.total_revenue.toFixed(2),
        })),
      ),
    )
  }

  return { filename: tr.t('csv_file', { slug: safe }), content: sections.join('\n') }
}

/** Numele fișierului PDF: intervalul în AAAA-LL-ZZ (o singură zi = o dată). */
export function reportPdfFilename(tr: ReportsT, from: string, to: string): string {
  return tr.t('pdf_file', { range: `${from}${from !== to ? '-' + to : ''}` })
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
