// src/lib/__tests__/pickupSlots.test.ts
// Sloturile de ridicare (pickup) — inclusiv programul peste miezul nopții
// (doctrina mig 201: end <= start → fereastra [start,24:00) ∪ [00:00,end)).
//
// Toate instantele sunt FIXE (ISO cu Z) și orele se citesc în fusul
// RESTAURANTULUI (Europe/Bucharest implicit). Fusul procesului de test NU
// contează — iar în vitest nici nu se poate schimba la runtime, deci un test
// care ar depinde de el ar fi trecut doar pe mașina pe care a fost scris.
// Varianta veche construia `now` cu ora LOCALĂ a mașinii (exact ca defectul:
// `setHours` în fusul browserului).
// DST 2026: ora de vară începe pe 29 martie la 01:00Z, se termină pe 25 oct la 01:00Z.
import { describe, it, expect } from 'vitest'
import { buildPickupSlots, MAX_PICKUP_SLOTS } from '../pickupSlots'
import { formatTimeInZone } from '../dates'

const hm = (iso: string | undefined): string => formatTimeInZone(iso ?? '')
const at = (iso: string): Date => new Date(iso)

const daySettings = {
  min_lead_time_minutes: 30,
  slot_interval_minutes: 15,
  open_hours: { start: '10:00', end: '22:00' },
}

const nightSettings = {
  min_lead_time_minutes: 30,
  slot_interval_minutes: 30,
  open_hours: { start: '18:00', end: '02:00' },
}

describe('buildPickupSlots — program normal (start < end)', () => {
  it('oferă sloturi aliniate la interval, de la now + lead', () => {
    // 09:07Z = 12:07 EEST; + 30 min = 12:37 → aliniat în sus la :45
    const slots = buildPickupSlots(daySettings, at('2026-07-20T09:07:00Z'))
    expect(slots[0]).toBe('2026-07-20T09:45:00.000Z')
    expect(hm(slots[0])).toBe('12:45')
    expect(hm(slots[1])).toBe('13:00')
    expect(slots.length).toBe(MAX_PICKUP_SLOTS)
  })

  it('nu oferă sloturi înainte de deschidere', () => {
    const slots = buildPickupSlots(daySettings, at('2026-07-20T05:00:00Z')) // 08:00 local
    expect(slots[0]).toBe('2026-07-20T07:00:00.000Z')
    expect(hm(slots[0])).toBe('10:00')
  })

  it('gol după închidere', () => {
    expect(buildPickupSlots(daySettings, at('2026-07-20T19:30:00Z'))).toEqual([]) // 22:30
  })

  it('ultimul slot nu depășește închiderea', () => {
    const slots = buildPickupSlots(daySettings, at('2026-07-20T18:00:00Z')) // 21:00
    expect(slots.length).toBeGreaterThan(0)
    expect(hm(slots[slots.length - 1])).toBe('22:00')
  })
})

describe('buildPickupSlots — program peste miezul nopții (end <= start)', () => {
  it('seara: sloturile curg dincolo de miezul nopții, până la închidere', () => {
    // 20:00Z = 23:00 local; + 30 lead = 23:30 → 23:30, 00:00, …, 02:00 (mâine)
    const slots = buildPickupSlots(nightSettings, at('2026-07-20T20:00:00Z'))
    expect(slots.map(hm)).toEqual(['23:30', '00:00', '00:30', '01:00', '01:30', '02:00'])
    expect(slots[slots.length - 1]).toBe('2026-07-20T23:00:00.000Z') // 02:00 EEST pe 21
  })

  it('după miezul nopții: încă deschis până la close (deschiderea a fost IERI)', () => {
    // 22:00Z = 01:00 local pe 21 iul → 01:30, 02:00 (regresia veche: gol)
    const slots = buildPickupSlots(nightSettings, at('2026-07-20T22:00:00Z'))
    expect(slots.map(hm)).toEqual(['01:30', '02:00'])
  })

  it('dimineața/după-amiaza (înainte de deschidere) pornește de la open — pre-comandă pentru diseară', () => {
    expect(hm(buildPickupSlots(nightSettings, at('2026-07-20T06:00:00Z'))[0])).toBe('18:00')
    expect(hm(buildPickupSlots(nightSettings, at('2026-07-20T13:00:00Z'))[0])).toBe('18:00')
  })
})

describe('buildPickupSlots — fusul restaurantului, nu al dispozitivului', () => {
  it('Z1 același program, alt fus → alt instant (ora de perete e a localului)', () => {
    const now = at('2026-07-20T05:00:00Z')
    const buc = buildPickupSlots(daySettings, now)
    const ny = buildPickupSlots(daySettings, now, 'America/New_York')
    expect(buc[0]).toBe('2026-07-20T07:00:00.000Z') // 10:00 EEST
    expect(ny[0]).toBe('2026-07-20T14:00:00.000Z') // 10:00 EDT
    expect(formatTimeInZone(ny[0], 'America/New_York')).toBe('10:00')
  })

  it('Z2 DST de primăvară: 10:00 pe 29 martie e 07:00Z (EEST), cu o zi înainte 08:00Z (EET)', () => {
    expect(buildPickupSlots(daySettings, at('2026-03-29T05:00:00Z'))[0]).toBe('2026-03-29T07:00:00.000Z')
    expect(buildPickupSlots(daySettings, at('2026-03-28T06:00:00Z'))[0]).toBe('2026-03-28T08:00:00.000Z')
  })

  it('Z3 DST de toamnă: 10:00 pe 25 oct e 08:00Z (EET); program de noapte peste tranziție', () => {
    expect(buildPickupSlots(daySettings, at('2026-10-25T06:00:00Z'))[0]).toBe('2026-10-25T08:00:00.000Z')
    // 24 oct 23:00 EEST (20:00Z): 02:00 pe 25 oct e încă EEST (tranziția e la 04:00) → 23:00Z
    const night = buildPickupSlots(nightSettings, at('2026-10-24T20:00:00Z'))
    expect(night[night.length - 1]).toBe('2026-10-24T23:00:00.000Z')
    expect(night.map(hm)).toEqual(['23:30', '00:00', '00:30', '01:00', '01:30', '02:00'])
  })

  it('Z4 noaptea dinaintea orei de vară: închiderea 02:00 e încă EET (00:00Z)', () => {
    const slots = buildPickupSlots(nightSettings, at('2026-03-28T21:00:00Z')) // 23:00 EET
    expect(slots[slots.length - 1]).toBe('2026-03-29T00:00:00.000Z')
  })

  it('Z5 alinierea se face pe minutul de PERETE (fus cu offset de :30)', () => {
    // 05:52Z + 30 = 06:22Z = 11:52 IST (+05:30). Interval 20 pe minutul de
    // PERETE: 52 → 12:00 IST (06:30Z). Pe minutul UTC ar fi ieșit 22 → 06:40Z
    // = 12:10 IST, un slot care nu e pe grila afișată de local.
    const s = buildPickupSlots(
      { ...daySettings, slot_interval_minutes: 20 },
      at('2026-07-20T05:52:00Z'),
      'Asia/Kolkata',
    )
    expect(s[0]).toBe('2026-07-20T06:30:00.000Z')
    expect(formatTimeInZone(s[0], 'Asia/Kolkata')).toBe('12:00')
  })

  it('Z6 fus invalid → Europe/Bucharest (fail-safe, nu RangeError într-o randare)', () => {
    const now = at('2026-07-20T09:07:00Z')
    expect(buildPickupSlots(daySettings, now, 'Not/AZone')).toEqual(buildPickupSlots(daySettings, now))
    expect(buildPickupSlots(daySettings, now, null)).toEqual(buildPickupSlots(daySettings, now))
  })
})

describe('formatTimeInZone', () => {
  it('ora României, nu a gazdei: 21:30Z pe 4 sept e 00:30', () => {
    expect(formatTimeInZone('2026-09-04T21:30:00Z')).toBe('00:30')
    expect(formatTimeInZone('2026-01-15T10:05:00Z')).toBe('12:05') // iarna, +2
  })
  it('șir neparsabil / gol → șir gol, fără excepție', () => {
    expect(formatTimeInZone('nu-e-dată')).toBe('')
    expect(formatTimeInZone(null)).toBe('')
  })
})

describe('buildPickupSlots — intrări invalide (fail-closed)', () => {
  it('setări lipsă → gol', () => {
    expect(buildPickupSlots(null)).toEqual([])
    expect(buildPickupSlots(undefined)).toEqual([])
  })

  it('interval 0/negativ → gol (fără buclă blocată)', () => {
    const now = at('2026-07-20T09:00:00Z')
    expect(buildPickupSlots({ ...daySettings, slot_interval_minutes: 0 }, now)).toEqual([])
    expect(buildPickupSlots({ ...daySettings, slot_interval_minutes: -5 }, now)).toEqual([])
  })

  it('ore neparsabile → gol', () => {
    expect(
      buildPickupSlots(
        { ...daySettings, open_hours: { start: 'zece', end: '22:00' } },
        at('2026-07-20T09:00:00Z'),
      ),
    ).toEqual([])
  })
})
