// src/lib/reportChoice.ts — perioada aleasă pe Vânzări (ReportsTab) și pe
// Statistici (AnalyticsTab), păstrată în `sessionStorage` prin
// `useSessionChoice` (lotul C6a): cheile (una per ecran) și VALIDAREA a ce se
// citește înapoi. Pur. O valoare care nu trece validarea dă implicitul
// ecranului, nu o perioadă imposibilă (un interval care se termină „mâine”, o
// dată stricată, un număr de zile pe care ecranul nu-l oferă).
import { isValidYmd } from './dates'
import type { ReportPeriod } from './reportsExport'

export const REPORTS_CHOICE_KEY = 'menuvia:reports:period'
export const ANALYTICS_DAYS_KEY = 'menuvia:analytics:days'

const REPORT_PERIODS: readonly ReportPeriod[] = ['today', 'week', 'month', 'custom']

export interface ReportsChoice {
  period: ReportPeriod
  custom: { from: string; to: string }
}

/** Implicitul filei Vânzări: „Azi”, cu intervalul personalizat pe ziua de azi. */
export function defaultReportsChoice(todayYmd: string): ReportsChoice {
  return { period: 'today', custom: { from: todayYmd, to: todayYmd } }
}

/**
 * Alegerea citită din stocare, validată pe ziua de azi în fusul zilei de
 * raportare: perioada în enum, intervalul personalizat două date REALE cu
 * `from` ≤ `to` ≤ azi. Un interval invalid pe o perioadă fixă („7 zile”)
 * păstrează perioada și resetează intervalul pe azi; pe „Alt interval”
 * invalidează tot (null → implicitul).
 */
export function parseReportsChoice(raw: unknown, todayYmd: string): ReportsChoice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const period = REPORT_PERIODS.find((p) => p === r.period)
  if (!period) return null
  const c = r.custom && typeof r.custom === 'object' ? (r.custom as Record<string, unknown>) : {}
  const from = c.from
  const to = c.to
  if (isValidYmd(from) && isValidYmd(to) && from <= to && to <= todayYmd) return { period, custom: { from, to } }
  return period === 'custom' ? null : { period, custom: { from: todayYmd, to: todayYmd } }
}

/** Intervalele oferite de Statistici (zile). */
export const ANALYTICS_DAY_OPTIONS: readonly number[] = [7, 14, 30]
export const ANALYTICS_DEFAULT_DAYS = 30

/** Numărul de zile citit din stocare: doar unul dintre butoanele ecranului. */
export function parseAnalyticsDays(raw: unknown): number | null {
  return typeof raw === 'number' && ANALYTICS_DAY_OPTIONS.includes(raw) ? raw : null
}
