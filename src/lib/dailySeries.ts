// src/lib/dailySeries.ts — seria de pe graficele zilnice ale rapoartelor
// (Vânzări și Statistici, lotul C6a). Pur: fără React, fără rețea.
// Înainte, fiecare grafic avea un punct DOAR pentru zilele cu comenzi: o zi
// închisă dispărea, linia „Venit pe zi” trecea peste ea ca peste o zi
// obișnuită, iar o zi cu încasări dar fără comenzi create (comanda de ieri,
// plătită azi) se adăuga la COADA listei, după toate celelalte. Acum seria are
// FIECARE zi a intervalului, în ordine, cu 0 pe zilele fără vânzări.
// Zilele sunt șiruri YYYY-MM-DD în fusul zilei de raportare (lotul G2b) și se
// numără pe ȘIR (`addDaysYmd`), nu pe fusul browserului.
import { addDaysYmd, formatYmd, isValidYmd, isoToZonedYMD, weekStartYmd } from './dates'

export interface DayTotals {
  orders: number
  revenue: number
}

export interface SeriesPoint extends DayTotals {
  /** Prima zi a punctului (YYYY-MM-DD): ziua însăși, sau prima zi din interval
   *  a săptămânii, pe săptămâni. */
  from: string
  /** Ultima zi a punctului (= `from` pe zile). */
  to: string
}

export type SeriesGranularity = 'day' | 'week'

export interface ChartSeries {
  granularity: SeriesGranularity
  points: SeriesPoint[]
}

/** Peste atâtea zile, graficul trece pe săptămâni calendaristice (o bară pe zi
 *  ar fi ilizibilă pe un interval personalizat de câteva luni). */
export const WEEKLY_AFTER_DAYS = 62

/** Plafon de siguranță (~10 ani): un interval absurd nu blochează randarea.
 *  Se taie de la CAPĂTUL VECHI — un „de la 2015 până azi” păstrează ultimii
 *  ~10 ani, adică vânzările reale; tăiat de la început, graficul ar fi arătat
 *  doar bare de 0 pe 2015–2025 sub cardurile cu totalurile adevărate. */
export const MAX_SERIES_DAYS = 3700

/** Toate zilele din [from, to], capete incluse, în ordine (cel mult ultimele
 *  `MAX_SERIES_DAYS`, terminate în `to`). Dată invalidă sau `from` > `to` →
 *  nicio zi (nu o buclă fără sfârșit pe un șir stricat). */
export function daysInRange(from: string, to: string): string[] {
  if (!isValidYmd(from) || !isValidYmd(to) || from > to) return []
  // Șirurile YYYY-MM-DD se compară corect lexicografic. Podeaua e validată:
  // sub anul 1000 `addDaysYmd` n-ar mai da patru cifre.
  const floor = addDaysYmd(to, 1 - MAX_SERIES_DAYS)
  const start = isValidYmd(floor) && from < floor ? floor : from
  const out: string[] = []
  // Plafonul rămâne și în buclă: o centură, nu calea normală.
  for (let d = start; d <= to && out.length < MAX_SERIES_DAYS; d = addDaysYmd(d, 1)) out.push(d)
  return out
}

/**
 * Seria graficului pe intervalul [from, to]: un punct pe zi (zilele fără date
 * = 0), sau, peste `WEEKLY_AFTER_DAYS` zile, un punct pe săptămână (luni–
 * duminică; prima și ultima săptămână pot fi parțiale). Zilele din `totals` din
 * AFARA intervalului nu apar — serverul filtrează pe același interval.
 */
export function chartSeries(from: string, to: string, totals: ReadonlyMap<string, DayTotals>): ChartSeries {
  const days = daysInRange(from, to)
  const granularity: SeriesGranularity = days.length > WEEKLY_AFTER_DAYS ? 'week' : 'day'
  const points: SeriesPoint[] = []
  const byKey = new Map<string, SeriesPoint>()
  for (const day of days) {
    const key = granularity === 'week' ? weekStartYmd(day) : day
    let p = byKey.get(key)
    if (!p) {
      p = { from: day, to: day, orders: 0, revenue: 0 }
      byKey.set(key, p)
      points.push(p)
    }
    p.to = day
    const t = totals.get(day)
    if (t) {
      p.orders += t.orders
      p.revenue += t.revenue
    }
  }
  return { granularity, points }
}

/** Eticheta de pe axă: ziua („15.11” în română), pe săptămâni prima ei zi;
 *  cu anul când seria trece peste un an calendaristic (altfel „02.03” ar
 *  numi două săptămâni diferite). Formatul urmează `locale` (limba
 *  utilizatorului), data nu trece prin niciun fus (`formatYmd`). */
export function seriesPointLabel(point: SeriesPoint, locale: string, withYear = false): string {
  return formatYmd(
    point.from,
    locale,
    withYear ? { day: '2-digit', month: '2-digit', year: '2-digit' } : { day: '2-digit', month: '2-digit' },
  )
}

/** Seria trece peste un an calendaristic (prima zi și ultima au ani diferiți). */
export function seriesSpansYears(series: ChartSeries): boolean {
  const first = series.points[0]
  const last = series.points[series.points.length - 1]
  if (!first || !last) return false
  return first.from.split('-')[0] !== last.to.split('-')[0]
}

function addTo(map: Map<string, DayTotals>, day: string, orders: number, revenue: number): void {
  const prev = map.get(day)
  if (prev) {
    prev.orders += orders
    prev.revenue += revenue
  } else {
    map.set(day, { orders, revenue })
  }
}

/**
 * Totalurile pe zi ale filei Vânzări: comenzile pe ziua CREĂRII, venitul pe
 * ziua ÎNCASĂRII (`paid_amount`, altfel `total` — aceeași regulă ca venitul
 * din carduri), ambele în fusul zilei de raportare. Un timestamp neparsabil
 * nu are zi și se sare (înainte devenea o bară cu cheie-gunoi).
 */
export function reportDayTotals(
  orders: ReadonlyArray<{ created_at?: unknown }>,
  paid: ReadonlyArray<{ paid_at?: unknown; paid_amount?: unknown; total?: unknown }>,
  timeZone: string,
): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>()
  for (const o of orders) {
    const day = typeof o.created_at === 'string' ? isoToZonedYMD(o.created_at, timeZone) : null
    if (day) addTo(map, day, 1, 0)
  }
  for (const o of paid) {
    const day = typeof o.paid_at === 'string' ? isoToZonedYMD(o.paid_at, timeZone) : null
    if (day) addTo(map, day, 0, Number(o.paid_amount ?? o.total ?? 0))
  }
  return map
}

/** Totalurile pe zi din rândurile unui view zilnic (`v_daily_orders`: `day`
 *  e deja o dată YYYY-MM-DD). Un rând fără dată validă se sare. */
export function viewDayTotals(
  rows: ReadonlyArray<Record<string, unknown>>,
  ordersCol: string,
  revenueCol: string,
): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>()
  for (const r of rows) {
    const day = r.day
    if (isValidYmd(day)) addTo(map, day, Number(r[ordersCol] || 0), Number(r[revenueCol] || 0))
  }
  return map
}
