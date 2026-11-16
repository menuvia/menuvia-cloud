// src/lib/__tests__/reservationRanges.test.ts — intervalele filei Rezervări în
// fusul OPERAȚIONAL al localului (lotul G2b, lib/reservationRanges.ts). Instante
// ISO FIXE, fusul ca PARAMETRU: un test „pe alt fus de gazdă” ar fi vacuu în
// vitest (`process.env.TZ` schimbat la runtime nu are efect), iar varianta veche
// (`setHours` pe calendarul dispozitivului) dă în CI ziua UTC — exact ce prind
// RY2–RY4.
//   RY1  controlul RO: ziua = `romaniaDayRange`; săptămâna din 20 oct trece peste
//        25 oct (zi de 25 h) și se termină pe 27 oct 21:59:59.999Z — 8 zile
//        calendaristice, ca înainte.
//   RY2  New York, acum = 13 nov 03:30Z (22:30 pe 12 la New York) → azi = 12,
//        mâine = 13. Mutația care pică: fusul dispozitivului (UTC în CI → 13/14).
//   RY3  Auckland, 12 nov 11:30Z (00:30 pe 13) → azi = 13.
//   RY4  Kolkata, 12 nov 19:00Z (00:30 pe 13, ofset cu jumătate de oră) → azi = 13.
//   RY5  București, 24 oct 21:30Z (00:30 pe 25 oct, zi de 25 h) → mâine = 26 oct.
//        Mutația care pică: „mâine” = acum + 86 400 000 ms (dă tot 25 oct).
//   RY6  fus invalid → București.
//   RY7  `activeRangePreset` recunoaște azi / mâine / săptămâna și dă `custom`
//        pe o zi aleasă; o zi aleasă egală cu azi e „azi” (aceeași valoare).
import { describe, expect, it } from 'vitest'
import { romaniaDayRange, zonedDayRange } from '../dates'
import {
  activeRangePreset,
  reservationDayRange,
  reservationPresets,
  reservationWeekRange,
} from '../reservationRanges'

const BUC = 'Europe/Bucharest'
const NY = 'America/New_York'

describe('intervalele filei Rezervări', () => {
  it('RY1 controlul RO: ziua și săptămâna de dinainte', () => {
    for (const d of ['2026-03-29', '2026-10-25', '2026-11-15'])
      expect(reservationDayRange(d, BUC), d).toEqual(romaniaDayRange(d))
    expect(reservationWeekRange('2026-10-20', BUC)).toEqual({
      from: '2026-10-19T21:00:00.000Z',
      to: '2026-10-27T21:59:59.999Z',
    })
  })

  it('RY2 New York: azi și mâine pe ziua localului, nu a dispozitivului', () => {
    const p = reservationPresets(NY, new Date('2026-11-13T03:30:00Z'))
    expect(p.todayYmd).toBe('2026-11-12')
    expect(p.today).toEqual({ from: '2026-11-12T05:00:00.000Z', to: '2026-11-13T04:59:59.999Z' })
    expect(p.tomorrow).toEqual(zonedDayRange('2026-11-13', NY))
    expect(p.week).toEqual({ from: '2026-11-12T05:00:00.000Z', to: '2026-11-20T04:59:59.999Z' })
  })

  it('RY3 Auckland: 00:30 pe 13 e deja „azi” = 13', () => {
    expect(reservationPresets('Pacific/Auckland', new Date('2026-11-12T11:30:00Z')).todayYmd).toBe('2026-11-13')
  })

  it('RY4 Kolkata (ofset cu jumătate de oră): 00:30 pe 13 → 13', () => {
    const p = reservationPresets('Asia/Kolkata', new Date('2026-11-12T19:00:00Z'))
    expect(p.todayYmd).toBe('2026-11-13')
    expect(p.today.from).toBe('2026-11-12T18:30:00.000Z')
  })

  it('RY5 „mâine” e ziua calendaristică următoare, nu acum + 24 h (zi de 25 h)', () => {
    const p = reservationPresets(BUC, new Date('2026-10-24T21:30:00Z'))
    expect(p.todayYmd).toBe('2026-10-25')
    expect(p.tomorrow).toEqual(romaniaDayRange('2026-10-26'))
  })

  it('RY6 fus invalid → București', () => {
    const now = new Date('2026-09-04T21:30:00Z')
    expect(reservationPresets('Mars/Olympus', now)).toEqual(reservationPresets(BUC, now))
  })

  it('RY7 presetarea activă', () => {
    const now = new Date('2026-11-13T03:30:00Z')
    const p = reservationPresets(NY, now)
    expect(activeRangePreset(p.today, NY, now)).toBe('today')
    expect(activeRangePreset(p.tomorrow, NY, now)).toBe('tomorrow')
    expect(activeRangePreset(p.week, NY, now)).toBe('week')
    expect(activeRangePreset(reservationDayRange('2026-11-20', NY), NY, now)).toBe('custom')
    expect(activeRangePreset(reservationDayRange('2026-11-12', NY), NY, now)).toBe('today')
    // Aceeași zi văzută din alt fus nu e „azi” acolo.
    expect(activeRangePreset(p.today, BUC, now)).toBe('custom')
  })
})
