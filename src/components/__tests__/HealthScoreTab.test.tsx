// HealthScoreTab pe planul restaurantului (lotul P; recenzia #334 + CodeRabbit).
// Tendința din server e calculată pe scorul BRUT, care include componenta
// Bridge fiscal; pe un plan fără bon scorul afișat e normalizat, deci un brut
// 35 (server: `critical`) apare ca 44 („Mediu"). Lângă el, „Critic — necesită
// atenție" cu roșu ar fi o contradicție.
//
//   HT-S1 growth, trend `critical`, brut 35 → scorul 44 „Mediu", fără linia de
//         tendință („Critic"), fără delta, fără componenta „Stabilitate", iar
//         narațiunea nu e cea de criză. Mutația care pică: linia de tendință
//         randată necondiționat, sau `scoreNarrative(shown, score.trend)`.
//   HT-S2 control pozitiv pe pro: același rând → „Critic — necesită atenție",
//         delta și „Stabilitate" apar (Planul 3 neschimbat).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { HealthScore } from '../../lib/health'

const { row } = vi.hoisted(() => {
  const r: HealthScore = {
    score: 35,
    previous_score: 50,
    trend: 'critical',
    score_login: 10,
    score_orders: 15,
    score_team: 5,
    score_tickets: 0,
    score_engagement: 5,
    computed_at: '2026-11-02T10:00:00Z',
    details: { last_login: '2026-11-02T09:00:00Z', orders_this_week: 3, orders_prev_week: 3, team_size: 2, open_alerts: 4 },
  }
  return { row: r }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../contexts/RestaurantContext', () => ({
  useRestaurantCtx: () => ({ activeId: 'r1' }),
}))
vi.mock('../../lib/health', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../lib/health')),
  fetchHealthScore: async () => row,
  recomputeHealthScore: vi.fn(),
}))

import HealthScoreTab from '../HealthScoreTab'

const CRISIS = /semne îngrijorătoare/

describe('HealthScoreTab — tendința doar pe planul cu bon', () => {
  it('HT-S1: growth cu trend `critical` — fără „Critic", scorul normalizat „Mediu"', async () => {
    const { container } = render(<HealthScoreTab fiscal={false} />)
    expect(await screen.findByText('Mediu')).toBeInTheDocument()
    expect(screen.getByText('44')).toBeInTheDocument()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/Critic/)
    expect(text).not.toMatch(/față de scorul precedent/)
    expect(text).not.toMatch(CRISIS)
    expect(screen.queryByText('Stabilitate')).toBeNull()
  })

  it('HT-S2: control pozitiv — pe pro tendința serverului și delta apar', async () => {
    const { container } = render(<HealthScoreTab fiscal />)
    expect(await screen.findByText(/Critic — necesită atenție/)).toBeInTheDocument()
    expect(container.textContent ?? '').toMatch(/față de scorul precedent/)
    expect(container.textContent ?? '').toMatch(CRISIS)
    expect(screen.getByText('Stabilitate')).toBeInTheDocument()
  })
})
