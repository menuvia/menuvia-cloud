// Scorul de sănătate pe ce ARE planul (lotul P, nov 2026). Componenta
// „tickets" = bonurile în eroare ale Bridge-ului FISCAL; pe un plan fără bon
// (Planurile 1–2) nu există nimic de stabilizat acolo.
//
//   HS1  fără bon: sugestiile NU pomenesc Bridge fiscal / ture de casă / bonuri,
//        nici componenta „Erori Bridge fiscal". Mutația care pică: garda
//        `scope.fiscal &&` scoasă de pe componenta tickets, sau textul vechi de
//        engagement („deschide ture de casă … conectează Bridge fiscal").
//   HS2  control pozitiv pe Planul 3: componenta Bridge și textul complet rămân.
//   HS3  scorul normalizat fără bon: componenta tickets iese din sumă și restul
//        se rescalează la 100 (80/80 → 100, 40/80 → 50, tickets ignorat).
//        Mutația care pică: `planHealthScore` care întoarce `score.score` brut.
//   HS4  pe Planul 3 scorul e exact cel din server (nimic nu se schimbă).
//   HS5  recenzia #334 / CodeRabbit: fără bon tendința brută a serverului (cu
//        Bridge fiscal) nu descrie scorul afișat → `stable` neutru, oricare ar
//        fi tendința serverului. Mutația care pică: `planHealthTrend` care
//        întoarce `score.trend` și fără bon.
//   HS6  pe Planul 3 tendința e exact cea din server.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import {
  getActionableSuggestions,
  planHealthScore,
  planHealthTrend,
  type HealthScore,
} from '../health'

function score(over: Partial<HealthScore> = {}): HealthScore {
  return {
    score: 50,
    previous_score: null,
    trend: 'stable',
    score_login: 10,
    score_orders: 15,
    score_team: 5,
    score_tickets: 10,
    score_engagement: 5,
    computed_at: '2026-11-01T10:00:00Z',
    details: { last_login: '2026-11-01T09:00:00Z', orders_this_week: 3, orders_prev_week: 3, team_size: 2, open_alerts: 2 },
    ...over,
  }
}

const FISCAL_WORDS = /Bridge fiscal|ture de casă|bonuri|casa de marcat|fiscal/i

describe('health — sugestiile pe ce are planul', () => {
  it('HS1: fără bon — nimic despre Bridge fiscal, ture de casă sau bonuri', () => {
    const s = getActionableSuggestions(score(), { fiscal: false })
    // Ancora: sugestiile există (login, comenzi, echipă, engagement sub maxim).
    expect(s.length).toBeGreaterThanOrEqual(3)
    expect(s.map((x) => x.component)).not.toContain('Erori Bridge fiscal')
    for (const x of s) {
      expect(x.component, x.component).not.toMatch(FISCAL_WORDS)
      expect(x.suggestion, x.component).not.toMatch(FISCAL_WORDS)
    }
  })

  it('HS2: control pozitiv — pe Planul 3 componenta Bridge și textul complet rămân', () => {
    const s = getActionableSuggestions(score(), { fiscal: true })
    expect(s.map((x) => x.component)).toContain('Erori Bridge fiscal')
    expect(s.find((x) => x.component === 'Utilizare features')?.suggestion).toMatch(/Bridge fiscal/)
  })
})

describe('health — scorul normalizat', () => {
  it('HS3: fără bon, componenta tickets iese din sumă și restul se rescalează', () => {
    const full = score({ score_login: 20, score_orders: 30, score_team: 15, score_engagement: 15, score_tickets: 0 })
    expect(planHealthScore(full, { fiscal: false })).toBe(100)
    const half = score({ score_login: 10, score_orders: 15, score_team: 7.5, score_engagement: 7.5, score_tickets: 20 })
    expect(planHealthScore(half, { fiscal: false })).toBe(50)
  })

  it('HS4: pe Planul 3 scorul e exact cel din server', () => {
    expect(planHealthScore(score({ score: 73 }), { fiscal: true })).toBe(73)
  })
})

describe('health — tendința pe scorul afișat', () => {
  it('HS5: fără bon, tendința serverului nu se afirmă — mereu `stable`', () => {
    for (const trend of ['critical', 'declining', 'rising', 'stable'] as const) {
      expect(planHealthTrend(score({ score: 35, trend }), { fiscal: false }), trend).toBe('stable')
    }
  })

  it('HS6: pe Planul 3 tendința e exact cea din server', () => {
    expect(planHealthTrend(score({ score: 35, trend: 'critical' }), { fiscal: true })).toBe('critical')
    expect(planHealthTrend(score({ trend: 'declining' }), { fiscal: true })).toBe('declining')
  })
})
