// Rezervările zilei pe ecranul ospătarului (lotul C2b, lib/waiterReservations.ts).
//   WRV1 implicit: doar NESOSITELE (pending / confirmed) care încep în cel mult
//        2 ore, INCLUSIV cele întârziate, în ordinea orei; cele de mai târziu și
//        cele așezate stau sub „Toate”. [PICĂ: `due` = toată ziua (bug-ul de
//        dinainte) sau rezervările așezate păstrate implicit]
//   WRV2 marginea ferestrei: exact +120 min intră, +121 min nu.
//        [PICĂ: `<` în loc de `<=` pe orizont]
//   WRV3 „următoarea”: prima nesosită care încă n-a început — nu cea întârziată,
//        nu cea așezată; null când nu mai urmează nimic. [PICĂ: `next` = prima
//        din `due` (ar arăta ora unei rezervări deja trecute)]
//   WRV4 „Toate”: nesosite + așezate, fără stările terminale; o oră ilizibilă
//        merge la final fără să strice ordinea. Control pozitiv: aceeași listă
//        fără filtrul de status ar avea 7 rânduri.
import { describe, expect, it } from 'vitest'
import { WAITER_RESERVATION_WINDOW_MIN, isUnarrived, waiterReservationsView } from '../waiterReservations'
import type { ReservationStatus } from '../../hooks/useReservations'

const NOW = Date.parse('2026-07-20T15:00:00Z')
const at = (min: number): string => new Date(NOW + min * 60_000).toISOString()
const r = (id: string, status: ReservationStatus, startsAt: string) => ({ id, status, starts_at: startsAt })
const ids = (rows: ReadonlyArray<{ id: string }>): string[] => rows.map((x) => x.id)

describe('waiterReservationsView', () => {
  const day = [
    r('later', 'pending', at(300)),
    r('soon', 'confirmed', at(60)),
    r('seated', 'seated', at(-30)),
    r('late', 'confirmed', at(-20)),
    r('done', 'completed', at(-120)),
    r('gone', 'no_show', at(-90)),
    r('soon2', 'pending', at(15)),
  ]

  it('WRV1 implicit: nesosite din următoarele 2 ore, inclusiv cele întârziate, pe oră', () => {
    const v = waiterReservationsView(day, NOW)
    expect(ids(v.due)).toEqual(['late', 'soon2', 'soon'])
    expect(v.due.every((x) => isUnarrived(x.status))).toBe(true)
  })

  it('WRV2 marginea ferestrei de 2 ore: +120 min intră, +121 min nu', () => {
    expect(WAITER_RESERVATION_WINDOW_MIN).toBe(120)
    const v = waiterReservationsView(
      [r('edge', 'confirmed', at(120)), r('over', 'confirmed', at(121))],
      NOW,
    )
    expect(ids(v.due)).toEqual(['edge'])
  })

  it('WRV3 „următoarea” = prima nesosită care n-a început; null când nu mai urmează nimic', () => {
    expect(waiterReservationsView(day, NOW).next?.id).toBe('soon2')
    const past = [r('late', 'confirmed', at(-20)), r('seated', 'seated', at(10))]
    expect(waiterReservationsView(past, NOW).next).toBeNull()
  })

  it('WRV4 „Toate”: nesosite + așezate, fără terminale; o oră ilizibilă merge la final', () => {
    const v = waiterReservationsView([...day, r('bad', 'confirmed', 'nu-e-o-dată')], NOW)
    expect(ids(v.all)).toEqual(['seated', 'late', 'soon2', 'soon', 'later', 'bad'])
    // control: filtrul de status chiar scoate ceva (7 rânduri → 5 + cel ilizibil)
    expect(day).toHaveLength(7)
    // cel ilizibil nu intră implicit (nu știm când începe)
    expect(ids(v.due)).not.toContain('bad')
  })
})
