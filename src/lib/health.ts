// =============================================================
// Menuvia — src/lib/health.ts
// Customer Health Score: fetch + recompute helpers.
// =============================================================
import { supabase } from './supabase'

export type HealthTrend = 'rising' | 'stable' | 'declining' | 'critical'

export interface HealthScore {
  score: number // 0-100
  previous_score: number | null
  trend: HealthTrend
  score_login: number // 0-20
  score_orders: number // 0-30
  score_team: number // 0-15
  score_tickets: number // 0-20
  score_engagement: number // 0-15
  computed_at: string
  details: {
    last_login?: string | null
    orders_this_week?: number
    orders_prev_week?: number
    team_size?: number
    open_alerts?: number
  }
}

export const SCORE_MAX = {
  login: 20,
  orders: 30,
  team: 15,
  tickets: 20,
  engagement: 15,
} as const

/** Read cached score for current restaurant (admin only).
 *  Aruncă excepție pe eroare reală RPC (rețea, permisiuni, DB jos) — funcția
 *  SQL `get_health_score` întoarce 0 rânduri (nu eroare) atât când scorul nu
 *  a fost încă calculat, cât și când `is_admin` respinge apelantul, deci
 *  `data` gol e mereu cazul legitim „fără scor", nu o eroare de mascat. */
export async function fetchHealthScore(restaurantId: string): Promise<HealthScore | null> {
  const { data, error } = await supabase.rpc('get_health_score', { p_restaurant_id: restaurantId })

  if (error) {
    console.error('[health] fetch failed:', error.message)
    throw new Error(`Nu s-a putut încărca scorul: ${error.message}`)
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null
  const row = Array.isArray(data) ? data[0] : data
  return row as HealthScore
}

/** Force recompute (admin, 5-min cooldown).
 *  Throws human-readable error if cooldown active. */
export async function recomputeHealthScore(restaurantId: string): Promise<HealthScore> {
  const { error } = await supabase.rpc('recompute_health_for_restaurant', {
    p_restaurant_id: restaurantId,
  })

  if (error) {
    // Surface cooldown message cleanly
    if (error.message.includes('cooldown') || error.message.includes('recent')) {
      throw new Error(error.message)
    }
    throw new Error(`Recalculare eșuată: ${error.message}`)
  }

  const fresh = await fetchHealthScore(restaurantId)
  if (!fresh) throw new Error('Scor lipsă după recalculare')
  return fresh
}

// ── Display helpers ────────────────────────────────────────────

export function trendLabel(trend: HealthTrend): string {
  switch (trend) {
    case 'rising':
      return 'În creștere'
    case 'stable':
      return 'Stabil'
    case 'declining':
      return 'În scădere'
    case 'critical':
      return 'Critic — necesită atenție'
  }
}

export function trendColor(
  trend: HealthTrend,
  defaults: { green: string; gold: string; orange: string; red: string },
): string {
  switch (trend) {
    case 'rising':
      return defaults.green
    case 'stable':
      return defaults.gold
    case 'declining':
      return defaults.orange
    case 'critical':
      return defaults.red
  }
}

export function scoreColor(
  score: number,
  defaults: { green: string; gold: string; orange: string; red: string },
): string {
  if (score >= 80) return defaults.green
  if (score >= 60) return defaults.gold
  if (score >= 40) return defaults.orange
  return defaults.red
}

export function scoreLabel(score: number): string {
  if (score >= 80) return 'Excelent'
  if (score >= 60) return 'Bun'
  if (score >= 40) return 'Mediu'
  if (score >= 20) return 'Slab'
  return 'Critic'
}

/** Actionable suggestions for each component below max. */
export function getActionableSuggestions(score: HealthScore): Array<{
  component: string
  current: number
  max: number
  suggestion: string
}> {
  const suggestions: Array<{
    component: string
    current: number
    max: number
    suggestion: string
  }> = []

  if (score.score_login < SCORE_MAX.login) {
    const days = score.details.last_login
      ? Math.floor((Date.now() - new Date(score.details.last_login).getTime()) / 86400000)
      : null
    suggestions.push({
      component: 'Frecvență login',
      current: score.score_login,
      max: SCORE_MAX.login,
      suggestion:
        days === null
          ? 'Nu te-ai logat niciodată — accesează dashboardul măcar o dată pe zi pentru a vedea comenzile live.'
          : days > 7
            ? `Ultimul login: acum ${days} zile. Conectează-te cel puțin de 2-3 ori pe săptămână.`
            : 'Conectează-te zilnic pentru scor maxim.',
    })
  }

  if (score.score_orders < SCORE_MAX.orders) {
    const wk = score.details.orders_this_week ?? 0
    const prev = score.details.orders_prev_week ?? 0
    suggestions.push({
      component: 'Volum comenzi',
      current: score.score_orders,
      max: SCORE_MAX.orders,
      suggestion:
        wk === 0
          ? 'Zero comenzi săptămâna asta. Verifică că meniul QR e accesibil clienților și că ospătarii înregistrează comenzile.'
          : wk < prev * 0.7
            ? `Comenzi în scădere (${wk} vs ${prev} săpt. trecută). Verifică promoțiile, programul, traficul.`
            : 'Continuă să crești volumul — Happy Hour, comenzi rapide QR, fidelizare clienți.',
    })
  }

  if (score.score_team < SCORE_MAX.team) {
    const team = score.details.team_size ?? 1
    suggestions.push({
      component: 'Mărime echipă',
      current: score.score_team,
      max: SCORE_MAX.team,
      suggestion:
        team <= 1
          ? 'Doar tu ești în cont. Invită ospătarii și bucătăria — productivitatea crește cu specializare pe role.'
          : `${team} membri. Invită încă ${Math.max(3 - team, 1)} pentru scor maxim.`,
    })
  }

  if (score.score_tickets < SCORE_MAX.tickets) {
    const alerts = score.details.open_alerts ?? 0
    suggestions.push({
      component: 'Erori Bridge fiscal',
      current: score.score_tickets,
      max: SCORE_MAX.tickets,
      suggestion:
        alerts > 0
          ? `${alerts} bonuri în eroare în ultimele 7 zile. Verifică tab-ul Bridge — casa de marcat, hârtie, conexiune.`
          : 'Sistem fiscal stabil. Continuă.',
    })
  }

  if (score.score_engagement < SCORE_MAX.engagement) {
    suggestions.push({
      component: 'Utilizare features',
      current: score.score_engagement,
      max: SCORE_MAX.engagement,
      suggestion:
        'Activează mai multe module: deschide ture de casă, configurează Happy Hour, adaugă rețete pentru gestiune stocuri, conectează Bridge fiscal.',
    })
  }

  return suggestions
}
