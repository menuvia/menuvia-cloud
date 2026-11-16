// Pastila „Deschis / Închis" de pe /m/:slug în fusul LOCALULUI (lotul G2c,
// lib/openHours.ts — mutat din lib/qr.ts). Momentul e PARAMETRU (`nowMs`),
// fusul e PARAMETRU: fusul procesului de test nu contează.
//
//   OH1 control RO: pe programe IDENTICE în toate zilele (09:00–17:00,
//       18:00–02:00, 00:00–00:00), rezultatul e egal cu algoritmul VECHI
//       (copiat verbatim mai jos, cu `now` explicit) pe 7 × 96 de instante.
//       Oracolul e codul vechi, nu cel nou — altfel testul ar fi vacuu.
//   OH2 New York, 10:00 luni → deschis; același instant pe București (17:00) → închis.
//   OH3 Auckland, luni 01:30 (duminică 14:30 la București): luni închis → închis.
//   OH4 Kolkata, ofsetul pe jumătate de oră.
//   OH5 ziua de SERVICIU: vineri 18:00–02:00 + sâmbătă închis → sâmbătă 01:00
//       deschis, 03:00 închis; joi închis → vineri 01:00 închis.
//   OH6 fus invalid → evaluat pe București (pastila nu dispare).
//   OH7 fără ore → null; programul de azi e pe ziua LOCALĂ.
//   OH8 structural: `wallTimeInZone` (h23), fără `hour12`; lib/qr.ts nu mai are
//       pastila, iar PublicMenuPage o importă din lib/openHours.
// Mutațiile care pică: fus fix (OH2/OH3); ziua de serviciu scoasă (OH5); ziua
// dispozitivului (OH3 pe o gazdă UTC); `catch → null` readus (OH6).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { computeIsOpen, todayHoursLabel } from '../openHours'
import type { HoursStructured, WeekDay } from '../qr'

const BUC = 'Europe/Bucharest'
const DAYS: WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function uniform(open: string, close: string): HoursStructured {
  const h: HoursStructured = {}
  for (const d of DAYS) h[d] = { open, close, closed: false }
  return h
}

// ── Algoritmul VECHI din lib/qr.ts, verbatim, cu `now` explicit ─────────────
function oldNowInTimezone(timezone: string, now: number): { day: WeekDay; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now))
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  const map: Record<string, WeekDay> = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  }
  return { day: map[weekdayShort] ?? 'mon', minutes: hour * 60 + minute }
}
function oldParseHHMM(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}
function oldComputeIsOpen(hours: HoursStructured, timezone: string, nowMs: number): boolean | null {
  if (!hours || Object.keys(hours).length === 0) return null
  const now = oldNowInTimezone(timezone || BUC, nowMs)
  const today = hours[now.day]
  if (!today || today.closed) return false
  const open = oldParseHHMM(today.open)
  const close = oldParseHHMM(today.close)
  if (close <= open) return now.minutes >= open || now.minutes < close
  return now.minutes >= open && now.minutes < close
}

describe('lib/openHours — pastila pe fusul localului', () => {
  it('OH1 control RO: identic cu algoritmul vechi pe programe uniforme', () => {
    // Luni 16 nov 2026, 00:00 la București (EET, +2) = 15 nov 22:00Z; 7 zile × 96 sferturi.
    const start = Date.parse('2026-11-15T22:00:00Z')
    const programs: HoursStructured[] = [uniform('09:00', '17:00'), uniform('18:00', '02:00'), uniform('00:00', '00:00')]
    let opens = 0
    for (const h of programs) {
      for (let i = 0; i < 7 * 96; i++) {
        const t = start + i * 15 * 60_000
        const now = computeIsOpen(h, BUC, t)
        expect(now, `${JSON.stringify(h.mon)} @ ${new Date(t).toISOString()}`).toBe(oldComputeIsOpen(h, BUC, t))
        if (now) opens++
      }
    }
    // Anti-vacuitate: și deschis, și închis apar.
    expect(opens).toBeGreaterThan(0)
    expect(opens).toBeLessThan(3 * 7 * 96)
  })

  it('OH2 New York: 10:00 luni e deschis acolo; același instant pe București e închis', () => {
    const t = Date.parse('2026-11-16T15:00:00Z')
    expect(computeIsOpen(uniform('09:00', '17:00'), 'America/New_York', t)).toBe(true)
    expect(computeIsOpen(uniform('09:00', '17:00'), BUC, t)).toBe(false)
  })

  it('OH3 Auckland: luni 01:30 (luni închis) e închis; pe București (duminică 14:30) ar fi deschis', () => {
    const h: HoursStructured = {
      sun: { open: '10:00', close: '22:00', closed: false },
      mon: { open: '10:00', close: '22:00', closed: true },
    }
    const t = Date.parse('2026-11-15T12:30:00Z')
    expect(computeIsOpen(h, 'Pacific/Auckland', t)).toBe(false)
    expect(computeIsOpen(h, BUC, t)).toBe(true)
  })

  it('OH4 Kolkata: ofsetul +5:30', () => {
    const h = uniform('09:00', '17:00')
    expect(computeIsOpen(h, 'Asia/Kolkata', Date.parse('2026-11-16T03:45:00Z'))).toBe(true) // 09:15
    expect(computeIsOpen(h, 'Asia/Kolkata', Date.parse('2026-11-16T03:15:00Z'))).toBe(false) // 08:45
  })

  it('OH5 ziua de serviciu pe programul peste miezul nopții', () => {
    const h: HoursStructured = {
      thu: { open: '18:00', close: '02:00', closed: true },
      fri: { open: '18:00', close: '02:00', closed: false },
      sat: { open: '18:00', close: '02:00', closed: true },
    }
    // București, EET (+2): sâmbătă 21 nov 01:00 = vineri 20 nov 23:00Z.
    expect(computeIsOpen(h, BUC, Date.parse('2026-11-20T23:00:00Z'))).toBe(true)
    // Sâmbătă 03:00: banda vinerii s-a încheiat, sâmbăta e închisă.
    expect(computeIsOpen(h, BUC, Date.parse('2026-11-21T01:00:00Z'))).toBe(false)
    // Vineri 01:00 aparține serviciului de JOI, care e închis (vechiul cod zicea „deschis").
    expect(computeIsOpen(h, BUC, Date.parse('2026-11-19T23:00:00Z'))).toBe(false)
    expect(oldComputeIsOpen(h, BUC, Date.parse('2026-11-19T23:00:00Z'))).toBe(true)
    // Vineri 19:00: deschis.
    expect(computeIsOpen(h, BUC, Date.parse('2026-11-20T17:00:00Z'))).toBe(true)
  })

  it('OH6 fus invalid → evaluat pe București, nu pastilă ascunsă', () => {
    const h = uniform('09:00', '17:00')
    for (const t of ['2026-11-16T08:00:00Z', '2026-11-16T16:00:00Z']) {
      const ms = Date.parse(t)
      expect(computeIsOpen(h, 'Mars/Olympus', ms)).toBe(computeIsOpen(h, BUC, ms))
      expect(computeIsOpen(h, null, ms)).toBe(computeIsOpen(h, BUC, ms))
    }
    expect(computeIsOpen(h, 'Mars/Olympus', Date.parse('2026-11-16T08:00:00Z'))).toBe(true)
  })

  it('OH7 fără ore → null; programul de azi e pe ziua LOCALĂ', () => {
    expect(computeIsOpen(null, BUC)).toBeNull()
    expect(computeIsOpen({}, BUC)).toBeNull()
    expect(todayHoursLabel(null, BUC)).toBeNull()
    const h: HoursStructured = {
      sun: { open: '10:00', close: '22:00', closed: false },
      mon: { open: '10:00', close: '22:00', closed: true },
    }
    const t = Date.parse('2026-11-15T12:30:00Z')
    expect(todayHoursLabel(h, 'Pacific/Auckland', t)).toBeNull() // luni, închis
    expect(todayHoursLabel(h, BUC, t)).toBe('10:00–22:00') // duminică
  })

  it('OH8 structural: h23 prin wallTimeInZone; pastila nu mai e în lib/qr', () => {
    const read = (f: string): string => readFileSync(resolve(process.cwd(), f), 'utf8')
    const oh = read('src/lib/openHours.ts')
    expect(oh).toMatch(/wallTimeInZone\(/)
    expect(oh.includes('hour12')).toBe(false)
    const qr = read('src/lib/qr.ts')
    expect(qr).not.toMatch(/export function computeIsOpen|export function todayHoursLabel/)
    expect(read('src/pages/PublicMenuPage.tsx')).toMatch(
      /import \{ computeIsOpen, todayHoursLabel \} from '\.\.\/lib\/openHours'/,
    )
  })
})
