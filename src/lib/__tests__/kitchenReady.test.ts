// Coloana „Gata de servit” a Bucătăriei (lotul C3a, lib/kitchenReady.ts).
// Prefixul KG (Kitchen, Gata) — verificat cu grep, nefolosit înainte.
//   KG1  se văd întregi doar comenzile gata din ultimele
//        KITCHEN_READY_RECENT_MINUTES minute (pragul inclus); cele mai vechi
//        trec în rândul „așteaptă ospătarul”. Vârsta e din `ready_at`, NU din
//        `created_at`: o comandă plasată acum 40 de minute și gata de 2 e
//        proaspătă. Mutația care pică: împărțirea pe `created_at` (sau pe
//        `urgencyAnchor`) în loc de `ready_at`; `>` în loc de `>=` la prag.
//        Control pozitiv: comanda gata de 11 minute CHIAR ajunge în `waiting`
//        (altfel „nimic ascuns” ar trece și cu împărțirea ștearsă).
//   KG2  ordinea e pe `ready_at`, cea mai recentă sus, în AMBELE liste.
//        Mutația care pică: sortarea crescătoare (FIFO, ca celelalte coloane)
//        sau păstrarea ordinii primite.
//   KG3  `ready_at` lipsă (starea optimistă de după „Gata”) sau ilizibil →
//        comanda e cea mai recentă, nu ascunsă. Mutația care pică:
//        `Date.parse(null)` → NaN tratat ca „foarte vechi”.
//   KG4  funcția e pură: nu modifică lista primită.
import { describe, expect, it } from 'vitest'
import { KITCHEN_READY_RECENT_MINUTES, readyMoment, splitReadyColumn } from '../kitchenReady'

const NOW = Date.parse('2026-07-20T09:20:00Z')
const minAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString()

interface Row {
  id: string
  ready_at: string | null
  created_at: string
}
const row = (id: string, readyMin: number | null, createdMin = 45): Row => ({
  id,
  ready_at: readyMin == null ? null : minAgo(readyMin),
  created_at: minAgo(createdMin),
})
const ids = (xs: Row[]): string[] => xs.map((x) => x.id)

describe('splitReadyColumn', () => {
  it('KG1 fereastra de 10 minute, măsurată din ready_at (pragul inclus)', () => {
    expect(KITCHEN_READY_RECENT_MINUTES).toBe(10)
    const { recent, waiting } = splitReadyColumn(
      [row('fresh-old-order', 2, 40), row('edge', 10), row('stale', 11, 12)],
      NOW,
    )
    // Plasată acum 40 de minute, gata de 2: rămâne la vedere.
    expect(ids(recent)).toEqual(['fresh-old-order', 'edge'])
    // Control pozitiv: gata de 11 minute (plasată acum 12) chiar se strânge.
    expect(ids(waiting)).toEqual(['stale'])
  })

  it('KG2 cea mai recentă sus, în ambele liste', () => {
    const { recent, waiting } = splitReadyColumn(
      [row('r5', 5), row('w30', 30), row('r1', 1), row('w12', 12), row('r9', 9)],
      NOW,
    )
    expect(ids(recent)).toEqual(['r1', 'r5', 'r9'])
    expect(ids(waiting)).toEqual(['w12', 'w30'])
  })

  it('KG3 ready_at lipsă sau ilizibil → cea mai recentă, la vedere', () => {
    const broken: Row = { id: 'broken', ready_at: 'nu-e-o-dată', created_at: minAgo(60) }
    const { recent, waiting } = splitReadyColumn([row('r3', 3), row('optimistic', null, 60), broken], NOW)
    expect(waiting).toEqual([])
    expect(ids(recent).slice(0, 2).sort()).toEqual(['broken', 'optimistic'])
    expect(ids(recent)[2]).toBe('r3')
    expect(readyMoment({ ready_at: null }, NOW)).toBe(NOW)
  })

  it('KG4 nu modifică lista primită', () => {
    const input = [row('a', 30), row('b', 1)]
    const before = ids(input)
    splitReadyColumn(input, NOW)
    expect(ids(input)).toEqual(before)
  })
})
