// src/lib/__tests__/pickupSlots.test.ts
// Sloturile de ridicare (pickup) — inclusiv programul peste miezul nopții
// (doctrina mig 201: end <= start → fereastra [start,24:00) ∪ [00:00,end)).
import { describe, it, expect } from 'vitest'
import { buildPickupSlots, MAX_PICKUP_SLOTS } from '../pickupSlots'

// `now` e ora LOCALĂ a mașinii de test (helper-ul folosește setHours local,
// exact ca browserul clientului) — construim datele local, nu din ISO UTC.
function at(h: number, m: number): Date {
  const d = new Date(2026, 6, 20) // 20 iul 2026, 00:00 local
  d.setHours(h, m, 0, 0)
  return d
}

function localHM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
    const slots = buildPickupSlots(daySettings, at(12, 7))
    // 12:07 + 30 min = 12:37 → aliniat în sus la :45
    expect(localHM(slots[0])).toBe('12:45')
    expect(localHM(slots[1])).toBe('13:00')
    expect(slots.length).toBe(MAX_PICKUP_SLOTS)
  })

  it('nu oferă sloturi înainte de deschidere', () => {
    const slots = buildPickupSlots(daySettings, at(8, 0))
    expect(localHM(slots[0])).toBe('10:00')
  })

  it('gol după închidere', () => {
    expect(buildPickupSlots(daySettings, at(22, 30))).toEqual([])
  })

  it('ultimul slot nu depășește închiderea', () => {
    const slots = buildPickupSlots(daySettings, at(21, 0))
    expect(slots.length).toBeGreaterThan(0)
    expect(localHM(slots[slots.length - 1])).toBe('22:00')
  })
})

describe('buildPickupSlots — program peste miezul nopții (end <= start)', () => {
  it('seara: sloturile curg dincolo de miezul nopții, până la închidere', () => {
    // 20 iul, 23:00 + 30 lead = 23:30 → sloturi 23:30, 00:00, ..., 02:00 (mâine)
    const slots = buildPickupSlots(nightSettings, at(23, 0))
    expect(localHM(slots[0])).toBe('23:30')
    expect(slots.map(localHM)).toContain('00:00')
    expect(localHM(slots[slots.length - 1])).toBe('02:00')
    // 00:00/00:30/... sunt în ziua URMĂTOARE calendaristic
    const last = new Date(slots[slots.length - 1])
    expect(last.getDate()).toBe(21)
  })

  it('după miezul nopții: încă deschis până la close (deschiderea a fost IERI)', () => {
    // 01:00 → earliest 01:30 → sloturi 01:30, 02:00 (regresia veche: gol)
    const slots = buildPickupSlots(nightSettings, at(1, 0))
    expect(slots.map(localHM)).toEqual(['01:30', '02:00'])
  })

  it('dimineața/după-amiaza (înainte de deschidere) pornește de la open — pre-comandă pentru diseară, ca la programul de zi', () => {
    expect(localHM(buildPickupSlots(nightSettings, at(9, 0))[0])).toBe('18:00')
    expect(localHM(buildPickupSlots(nightSettings, at(16, 0))[0])).toBe('18:00')
  })
})

describe('buildPickupSlots — intrări invalide (fail-closed)', () => {
  it('setări lipsă → gol', () => {
    expect(buildPickupSlots(null)).toEqual([])
    expect(buildPickupSlots(undefined)).toEqual([])
  })

  it('interval 0/negativ → gol (fără buclă blocată)', () => {
    expect(
      buildPickupSlots({ ...daySettings, slot_interval_minutes: 0 }, at(12, 0)),
    ).toEqual([])
    expect(
      buildPickupSlots({ ...daySettings, slot_interval_minutes: -5 }, at(12, 0)),
    ).toEqual([])
  })

  it('ore neparsabile → gol', () => {
    expect(
      buildPickupSlots(
        { ...daySettings, open_hours: { start: 'zece', end: '22:00' } },
        at(12, 0),
      ),
    ).toEqual([])
  })
})
