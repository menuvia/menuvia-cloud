// src/lib/healthLang.ts — textele calculate ale Scorului de sănătate în limba
// personalului (lotul L7). Traducătorul se primește ca parametru; din
// namespace se importă doar TIPUL (SK4), ca modulul să poată fi folosit și de
// cardul „Scor meniu” de pe Acasă fără să tragă dicționarele în graful static.
//
// În română ieșirea e EXACT cea de dinainte:
//   - `trendLabelT` / `scoreLabelT` / `getActionableSuggestionsT` = variantele
//     traduse ale lui `trendLabel` / `scoreLabel` / `getActionableSuggestions`
//     din lib/health.ts, care rămân NEATINSE și sunt oracolul (HQ8 compară pe
//     toate ramurile) — din L7 nici HomeTab nu le mai cheamă (antetul cardului
//     „Scor meniu” folosește variantele de aici), deci nu mai au apelanți în
//     producție;
//   - `formatTimeAgoT` / `scoreNarrativeT` = funcțiile mutate din
//     HealthScoreTab, cu pluralele FALSE de azi („acum 1 minute”).
// Logica (praguri, ramuri, ordinea sugestiilor) e copiată 1:1 din lib/health.ts;
// o schimbare acolo se face și aici — HQ8 pică altfel.
import type { Translator } from '../i18n/core'
import type healthRo from '../i18n/ns/health/ro'
import { SCORE_MAX, type HealthScope, type HealthScore, type HealthTrend } from './health'

export type HealthTranslator = Pick<Translator<typeof healthRo>, 't' | 'tp' | 'lang'>

export interface HealthSuggestion {
  component: string
  current: number
  max: number
  suggestion: string
}

const TREND_KEY = {
  rising: 'trend_rising',
  stable: 'trend_stable',
  declining: 'trend_declining',
  critical: 'trend_critical',
} as const satisfies Record<HealthTrend, string>

export function trendLabelT(trend: HealthTrend, tr: HealthTranslator): string {
  return tr.t(TREND_KEY[trend])
}

export function scoreLabelT(score: number, tr: HealthTranslator): string {
  if (score >= 80) return tr.t('label_excellent')
  if (score >= 60) return tr.t('label_good')
  if (score >= 40) return tr.t('label_average')
  if (score >= 20) return tr.t('label_weak')
  return tr.t('label_critical')
}

/** „Ultima recalculare: …” — vârsta scorului. `now` doar pentru teste. */
export function formatTimeAgoT(iso: string, tr: HealthTranslator, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return tr.t('ago_seconds')
  if (mins < 60) return tr.tp('ago_minutes', mins)
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return tr.tp('ago_hours', hrs)
  const days = Math.floor(hrs / 24)
  return tr.tp('ago_days', days)
}

/** Narațiunea de sub scor (pe scorul AFIȘAT și tendința pe care o poate
 *  afirma planul — `planHealthTrend`). */
export function scoreNarrativeT(score: number, trend: HealthTrend, tr: HealthTranslator): string {
  if (trend === 'critical') return tr.t('narr_critical')
  if (score >= 80) return tr.t('narr_excellent')
  if (score >= 60) return tr.t('narr_good')
  if (score >= 40) return tr.t('narr_average')
  return tr.t('narr_low')
}

/** Sugestiile acționabile pe ce are planul — `getActionableSuggestions`, în
 *  limba personalului. `now` doar pentru teste (zilele de la ultimul login). */
export function getActionableSuggestionsT(
  score: HealthScore,
  scope: HealthScope,
  tr: HealthTranslator,
  now: number = Date.now(),
): HealthSuggestion[] {
  const out: HealthSuggestion[] = []

  if (score.score_login < SCORE_MAX.login) {
    const days = score.details.last_login
      ? Math.floor((now - new Date(score.details.last_login).getTime()) / 86400000)
      : null
    out.push({
      component: tr.t('sc_login'),
      current: score.score_login,
      max: SCORE_MAX.login,
      suggestion:
        days === null
          ? tr.t('sg_loginNever')
          : days > 7
            ? tr.tp('sg_loginDays', days)
            : tr.t('sg_loginDaily'),
    })
  }

  if (score.score_orders < SCORE_MAX.orders) {
    const wk = score.details.orders_this_week ?? 0
    const prev = score.details.orders_prev_week ?? 0
    out.push({
      component: tr.t('sc_orders'),
      current: score.score_orders,
      max: SCORE_MAX.orders,
      suggestion:
        wk === 0
          ? tr.t('sg_ordersZero')
          : wk < prev * 0.7
            ? tr.t('sg_ordersDown', { wk, prev })
            : tr.t('sg_ordersGrow'),
    })
  }

  if (score.score_team < SCORE_MAX.team) {
    const team = score.details.team_size ?? 1
    out.push({
      component: tr.t('sc_team'),
      current: score.score_team,
      max: SCORE_MAX.team,
      suggestion:
        team <= 1 ? tr.t('sg_teamSolo') : tr.tp('sg_teamMore', team, { more: Math.max(3 - team, 1) }),
    })
  }

  if (scope.fiscal && score.score_tickets < SCORE_MAX.tickets) {
    const alerts = score.details.open_alerts ?? 0
    out.push({
      component: tr.t('sc_tickets'),
      current: score.score_tickets,
      max: SCORE_MAX.tickets,
      suggestion: alerts > 0 ? tr.tp('sg_ticketsAlerts', alerts) : tr.t('sg_ticketsOk'),
    })
  }

  if (score.score_engagement < SCORE_MAX.engagement) {
    out.push({
      component: tr.t('sc_engagement'),
      current: score.score_engagement,
      max: SCORE_MAX.engagement,
      suggestion: scope.fiscal ? tr.t('sg_engagementFiscal') : tr.t('sg_engagement'),
    })
  }

  return out
}
