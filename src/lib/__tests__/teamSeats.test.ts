// Locurile din echipă (lotul C7b) — partea pură a contorului din fila Echipă,
// oglinda verificării din send-invite.js (INV15–INV18 în tests/functions).
// (Prefixul SEAT: verificat cu grep în src/, tests/, e2e/, supabase/, docs/,
// nefolosit înainte.)
//   SEAT1 necunoscut → fără contor: plan necitit, cheie lipsă, listă încă
//         neîncărcată (`null`), limită stricată. Control POZITIV: cu planul și
//         lista cunoscute, contorul apare. Mutația care pică: `membersCount`
//         null tratat ca 0 („1 din 10” înaintea listei).
//   SEAT2 nelimitat: `limit: null` și limita „practic nelimitată” (≥ 1000, pro)
//         nu afișează contor; 999 îl afișează. Mutația care pică: pragul scos.
//   SEAT3 ocupat = membri + invitații în așteptare cu adrese DISTINCTE
//         (majuscule / spații); plin la `used >= limit`, liber cu un loc
//         rămas. Mutația care pică: `>` în loc de `>=`, rândurile numărate fără
//         deduplicare.
//   SEAT4 limita se citește BRUT, ca în trigger (care ignoră `enabled`):
//         `enabled: false, limit: 10` dă tot 10. Mutația care pică: `getLimit`
//         (care ar da 0 pe un feature oprit).
//   SEAT5 retrimiterea: adresa cu invitație în așteptare e recunoscută fără
//         diferență de majuscule/spații; adresa goală nu.
import { describe, expect, it } from 'vitest'
import { isPendingInviteEmail, teamSeats } from '../teamSeats'
import type { RestaurantFeatures } from '../features'

const plan = (limit: number | null, enabled = true): RestaurantFeatures => ({
  plan: 'growth',
  features: { max_team_members: { enabled, limit } },
})

describe('teamSeats', () => {
  it('SEAT1: necunoscut fără plan, fără cheie, fără listă sau cu limită stricată', () => {
    expect(teamSeats(null, 3, [])).toEqual({ kind: 'unknown' })
    expect(teamSeats({ plan: 'growth', features: {} }, 3, [])).toEqual({ kind: 'unknown' })
    expect(teamSeats(plan(10), null, ['a@x.ro'])).toEqual({ kind: 'unknown' })
    expect(teamSeats(plan(-1), 3, [])).toEqual({ kind: 'unknown' })
    expect(teamSeats(plan(Number.NaN), 3, [])).toEqual({ kind: 'unknown' })
    // Control pozitiv: planul și lista cunoscute.
    expect(teamSeats(plan(10), 3, [])).toEqual({ kind: 'limited', used: 3, limit: 10, full: false })
  })

  it('SEAT2: nelimitat pe null și de la 1000 în sus', () => {
    expect(teamSeats(plan(null), 40, [])).toEqual({ kind: 'unlimited' })
    expect(teamSeats(plan(1000), 40, [])).toEqual({ kind: 'unlimited' })
    expect(teamSeats(plan(999), 40, [])).toMatchObject({ kind: 'limited', limit: 999 })
  })

  it('SEAT3: membri + adrese distincte în așteptare; plin la egalitate', () => {
    const pending = [' Ana@X.ro', 'ana@x.ro', 'ion@x.ro', '']
    expect(teamSeats(plan(10), 8, pending)).toEqual({ kind: 'limited', used: 10, limit: 10, full: true })
    expect(teamSeats(plan(10), 7, pending)).toEqual({ kind: 'limited', used: 9, limit: 10, full: false })
    // Peste limită (ex. după o schimbare de plan): rămâne plin.
    expect(teamSeats(plan(1), 4, [])).toEqual({ kind: 'limited', used: 4, limit: 1, full: true })
  })

  it('SEAT4: limita brută, chiar cu `enabled: false`', () => {
    expect(teamSeats(plan(10, false), 2, [])).toEqual({ kind: 'limited', used: 2, limit: 10, full: false })
  })

  it('SEAT5: adresa cu invitație în așteptare se recunoaște', () => {
    const pending = ['Nou@Bistro.ro']
    expect(isPendingInviteEmail(pending, '  nou@bistro.RO ')).toBe(true)
    expect(isPendingInviteEmail(pending, 'alt@bistro.ro')).toBe(false)
    expect(isPendingInviteEmail(['', ' '], '')).toBe(false)
  })
})
