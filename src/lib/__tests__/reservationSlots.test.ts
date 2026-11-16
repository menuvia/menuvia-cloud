// Sloturile rezervării publice în fusul LOCALULUI (lotul G2c, lib/reservationSlots.ts).
// Fusul e PARAMETRU, momentul e un instant ISO fix: fusul procesului de test nu
// contează (un test pe `process.env.TZ` ar fi vacuu într-un worker).
//
//   RSL1 control RO: ora de perete → instantul de dinainte (vară +3, iarnă +2);
//        oracolul = trucul VECHI din ReservationSheet, pe date fără tranziții;
//        „azi/mâine/max" pe ziua Bucureștiului.
//   RSL2 New York la 21:50 pe 14 nov (02:50Z pe 15): „azi" e 14, max 14 dec,
//        primul slot de azi e 22:00 = 03:00Z.
//   RSL3 Auckland la 01:20 pe 16 nov (12:20Z pe 15): „azi" e 16, max 16 dec.
//        RSL2 + RSL3: o gazdă coincide cu cel mult unul dintre cele două fusuri,
//        deci mutația „calendarul dispozitivului” pică pe ORICE gazdă.
//   RSL4 Kolkata (ofset pe jumătate de oră): 19:00 → 13:30Z.
//   RSL5 program peste miezul nopții (18:00–02:00): slotul „01:00" al datei D e
//        la 01:00 pe D+1; `open_days` se judecă pe ziua de SERVICIU = D (ca
//        serverul: isodow(local − 1 zi) pe banda [00:00, close)).
//   RSL6 `max_advance` pe INSTANT: pe ultima zi, doar sloturile ≤ now + 30 × 24 h.
//   RSL7 golul DST (București, 29 mar 2026): 03:00/03:30 nu se oferă; pe 25 oct
//        apar o singură dată.
//   RSL8 fus invalid → identic cu Bucureștiul, fără excepție.
//   RSL9 `min_advance` pe INSTANT: același moment dă alt prim slot pe alt fus.
//   RSL10 ziua DINAINTE în calendar (recenzia CodeRabbit pe #380): la 00:40 marți,
//        un serviciu doar-luni 18:00–02:00 mai are 01:00 și 01:30 — „azi" (marți)
//        nu oferă nimic, iar `pickerMin` = luni le face alegibile.
// Mutațiile care pică: ziua dispozitivului în loc de `toZonedYMD` (RSL2/RSL3);
// trucul `toLocaleString` readus (RSL8: UTC brut); filtrul `open_days` scos
// (RSL5); filtrul `max` scos (RSL6); garda DST scoasă (RSL7); `max = now + N
// zile` pe ziua dispozitivului (RSL2/RSL3); `pickerMin` = azi (RSL10).
import { describe, it, expect } from 'vitest'
import {
  buildReservationSlots,
  effectiveSlotYmd,
  isoDowOfYmd,
  reservationDayBounds,
  reservationSlotInstantIso,
  type ReservationSlotSettings,
} from '../reservationSlots'
import { addDaysYmd, isoToZonedYMD } from '../dates'

const BUC = 'Europe/Bucharest'
const NY = 'America/New_York'
const AKL = 'Pacific/Auckland'
const KOL = 'Asia/Kolkata'

// Program non-stop, toate zilele, fără preaviz — fiecare test schimbă doar ce verifică.
const ALL_DAY: ReservationSlotSettings = {
  open_days: [1, 2, 3, 4, 5, 6, 7],
  open_time: '00:00',
  close_time: '24:00',
  slot_interval: 30,
  min_advance_hours: 0,
  max_advance_days: 30,
}

// Trucul VECHI din ReservationSheet (verbatim, fără try/catch) — oracolul de
// identitate pe România. Depinde de fusul GAZDEI doar lângă o tranziție a
// gazdei, deci se compară numai pe date fără tranziții EU/SUA/AU.
function oldIsoForLocalDateTime(dateYmd: string, hhmm: string, timeZone: string): string {
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
  const utcWall = new Date(new Date(asUtc).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzWall = new Date(new Date(asUtc).toLocaleString('en-US', { timeZone })).getTime()
  return new Date(asUtc - (tzWall - utcWall)).toISOString()
}

describe('lib/reservationSlots — fusul localului, paritate cu serverul', () => {
  it('RSL1 control RO: instantul și zilele sunt cele de dinainte', () => {
    expect(reservationSlotInstantIso('2026-07-20', '19:00', ALL_DAY, BUC)).toBe('2026-07-20T16:00:00.000Z')
    expect(reservationSlotInstantIso('2026-01-20', '19:00', ALL_DAY, BUC)).toBe('2026-01-20T17:00:00.000Z')
    for (const day of ['2026-01-20', '2026-02-10', '2026-04-15', '2026-06-01', '2026-07-20', '2026-08-30', '2026-09-15', '2026-12-10']) {
      for (let m = 0; m < 24 * 60; m += 30) {
        const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        expect(reservationSlotInstantIso(day, label, ALL_DAY, BUC), `${day} ${label}`).toBe(
          oldIsoForLocalDateTime(day, label, BUC),
        )
      }
    }
    expect(reservationDayBounds(Date.parse('2026-11-15T10:20:00Z'), 30, BUC)).toEqual({
      today: '2026-11-15',
      tomorrow: '2026-11-16',
      pickerMin: '2026-11-14',
      max: '2026-12-15',
    })
  })

  it('RSL2 New York: „azi" e ziua NY, iar primul slot e 22:00 EST', () => {
    const now = Date.parse('2026-11-15T02:50:00Z') // 21:50 pe 14 nov la NY
    expect(reservationDayBounds(now, 30, NY)).toEqual({
      today: '2026-11-14',
      tomorrow: '2026-11-15',
      pickerMin: '2026-11-13',
      max: '2026-12-14',
    })
    expect(buildReservationSlots('2026-11-14', ALL_DAY, now, NY)[0]).toBe('22:00')
    expect(reservationSlotInstantIso('2026-11-14', '22:00', ALL_DAY, NY)).toBe('2026-11-15T03:00:00.000Z')
  })

  it('RSL3 Auckland: „azi" e deja 16 nov acolo', () => {
    const now = Date.parse('2026-11-15T12:20:00Z') // 01:20 NZDT pe 16 nov
    expect(reservationDayBounds(now, 30, AKL)).toEqual({
      today: '2026-11-16',
      tomorrow: '2026-11-17',
      pickerMin: '2026-11-15',
      max: '2026-12-16',
    })
    expect(buildReservationSlots('2026-11-16', ALL_DAY, now, AKL).slice(0, 2)).toEqual(['01:30', '02:00'])
  })

  it('RSL4 Kolkata: ofsetul pe jumătate de oră', () => {
    expect(reservationSlotInstantIso('2026-11-16', '19:00', ALL_DAY, KOL)).toBe('2026-11-16T13:30:00.000Z')
  })

  it('RSL5 peste miezul nopții: data reală e D+1, ziua de serviciu e D (open_days)', () => {
    const wrap: ReservationSlotSettings = { ...ALL_DAY, open_time: '18:00', close_time: '02:00', slot_interval: 60 }
    const d = '2026-07-20' // luni
    const now = Date.parse('2026-07-01T00:00:00Z')
    expect(isoDowOfYmd(d)).toBe(1)
    expect(effectiveSlotYmd(d, '01:00', wrap)).toBe('2026-07-21')
    expect(effectiveSlotYmd(d, '19:00', wrap)).toBe(d)
    const iso = reservationSlotInstantIso(d, '01:00', wrap, BUC)
    expect(iso).toBe('2026-07-20T22:00:00.000Z') // 01:00 EEST pe 21
    // Paritatea cu serverul: isodow(ziua locală a instantului − 1 zi) = isodow(D).
    expect(isoDowOfYmd(addDaysYmd(isoToZonedYMD(iso as string, BUC) as string, -1))).toBe(isoDowOfYmd(d))

    // Luni ÎNCHIS, marți deschis: nicio oră a serviciului de luni nu se oferă,
    // deși 01:00 cade fizic marți.
    expect(buildReservationSlots(d, { ...wrap, open_days: [2, 3, 4, 5, 6, 7] }, now, BUC)).toEqual([])
    expect(buildReservationSlots(d, wrap, now, BUC)).toEqual([
      '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00',
    ])
  })

  it('RSL6 max_advance pe INSTANT: pe ultima zi rămân doar sloturile ≤ now + 30 × 24 h', () => {
    const now = Date.parse('2026-11-15T12:20:00Z') // 01:20 NZDT pe 16 nov
    const { max } = reservationDayBounds(now, 30, AKL)
    expect(max).toBe('2026-12-16')
    expect(buildReservationSlots(max, ALL_DAY, now, AKL)).toEqual(['00:00', '00:30', '01:00'])
    // Control: ziua de după `max` nu mai are niciun slot.
    expect(buildReservationSlots(addDaysYmd(max, 1), ALL_DAY, now, AKL)).toEqual([])
  })

  it('RSL7 golul de primăvară nu se oferă; ora dublă din toamnă apare o dată', () => {
    const spring = buildReservationSlots('2026-03-29', ALL_DAY, Date.parse('2026-03-01T00:00:00Z'), BUC)
    expect(spring).not.toContain('03:00')
    expect(spring).not.toContain('03:30')
    expect(spring).toContain('02:30')
    expect(spring).toContain('04:00')
    expect(spring.length).toBe(46)
    const autumn = buildReservationSlots('2026-10-25', ALL_DAY, Date.parse('2026-10-01T00:00:00Z'), BUC)
    expect(autumn.filter((x) => x === '03:00').length).toBe(1)
    expect(autumn.filter((x) => x === '03:30').length).toBe(1)
    expect(autumn.length).toBe(48)
  })

  it('RSL8 fus invalid → identic cu Bucureștiul, fără excepție', () => {
    const now = Date.parse('2026-11-15T12:20:00Z')
    expect(reservationDayBounds(now, 30, 'Mars/Olympus')).toEqual(reservationDayBounds(now, 30, BUC))
    expect(reservationSlotInstantIso('2026-07-20', '19:00', ALL_DAY, 'Mars/Olympus')).toBe('2026-07-20T16:00:00.000Z')
    expect(buildReservationSlots('2026-11-16', ALL_DAY, now, 'Mars/Olympus')).toEqual(
      buildReservationSlots('2026-11-16', ALL_DAY, now, BUC),
    )
    expect(reservationSlotInstantIso('2026-07-20', '19:00', ALL_DAY, null)).toBe('2026-07-20T16:00:00.000Z')
  })

  it('RSL9 min_advance pe INSTANT, independent de gazdă', () => {
    const now = Date.parse('2026-07-20T10:00:00Z') // 13:00 la București, 06:00 la NY
    const s = { ...ALL_DAY, min_advance_hours: 2 }
    expect(buildReservationSlots('2026-07-20', s, now, BUC)[0]).toBe('15:00')
    expect(buildReservationSlots('2026-07-20', s, now, NY)[0]).toBe('08:00')
    // Dată lipsă / interval invalid → nimic.
    expect(buildReservationSlots('', s, now, BUC)).toEqual([])
    expect(buildReservationSlots('2026-07-20', { ...s, slot_interval: 0 }, now, BUC)).toEqual([])
    expect(reservationSlotInstantIso('nu-e-data', '19:00', s, BUC)).toBeNull()
  })

  it('RSL10 pickerMin = ieri: ultimele sloturi ale serviciului de peste miezul nopții rămân alegibile', () => {
    const MONDAY_NIGHT: ReservationSlotSettings = {
      ...ALL_DAY,
      open_days: [1],
      open_time: '18:00',
      close_time: '02:00',
    }
    const now = Date.parse('2026-11-16T22:40:00Z') // marți 17 nov, 00:40 la București
    const b = reservationDayBounds(now, 30, BUC)
    expect(b.today).toBe('2026-11-17')
    expect(b.pickerMin).toBe('2026-11-16')
    // „Azi" (marți) nu e zi de serviciu; doar luni, aleasă din calendar, mai are sloturi.
    expect(buildReservationSlots(b.today, MONDAY_NIGHT, now, BUC)).toEqual([])
    expect(buildReservationSlots(b.pickerMin, MONDAY_NIGHT, now, BUC)).toEqual(['01:00', '01:30'])
    expect(reservationSlotInstantIso(b.pickerMin, '01:00', MONDAY_NIGHT, BUC)).toBe('2026-11-16T23:00:00.000Z')
  })
})
