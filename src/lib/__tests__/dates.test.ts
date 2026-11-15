// src/lib/__tests__/dates.test.ts
// Granițele de zi în fusul României (lib/dates.ts) — până acum fără niciun test,
// deși ReportsTab, HomeTab, VatReportTab, StocksTab și BridgeTab depind de el.
// Ancora e aceeași ca la mig 269 / OM1: 2026-09-04T21:30Z = 00:30 EEST pe 5 sept.
// DST 2026: ora de vară începe duminică 29 martie la 01:00Z și se termină
// duminică 25 octombrie la 01:00Z (ultimele duminici din lună).
//
// Lotul G2b — variantele GENERICE (fusul ca parametru), DZ1–DZ10:
//   DZ1  `toZonedYMD`/`isoToZonedYMD` pe București = `toRomaniaYMD`/
//        `isoToRomaniaYMD` pe instantele D1–D7 (controlul RO).
//   DZ2  `zonedDayRange(ymd, 'Europe/Bucharest')` = `romaniaDayRange(ymd)` pe
//        TOATE cele 7 cazuri D9, inclusiv zilele de 23 h și 25 h — comutarea
//        ecranelor românești pe varianta generică e byte-identică.
//   DZ3  literale pe zile obișnuite: New York, Auckland, Kolkata (ofset cu
//        jumătate de oră). Mutația care pică: fusul ignorat (ziua Bucureștiului).
//   DZ4  PROPRIETATE pe zile de tranziție (NY 8 mar / 1 nov, Auckland 5 apr /
//        27 sep, America/Havana 8 mar = tranziția LA miezul nopții, 1 nov =
//        miezul nopții de două ori): `from` e în zi, `from − 1 ms` nu, `to` e în
//        zi, `to + 1 ms` = `from`-ul zilei următoare, durata ∈ {23, 24, 25} h.
//        Pe proprietate, nu pe instant literal: independent de versiunea
//        tzdata/ICU. Mutația care pică: `zonedWallToInstant(y, m, d, 0, 0)`
//        într-un pas (Havana: `from` = 7 mar 23:00 local).
//   DZ5  `addDaysYmd` peste lună, an și 29 februarie; șir invalid → neschimbat.
//   DZ6  fus invalid / gol → rezultatul pe București, fără excepție.
//   DZ7  `reportTimeZone`: RO + Londra → București; țară lipsă / restaurant
//        lipsă → București; US + NY → NY; US + fus invalid / lipsă → București.
//        Mutația care pică: regula pe țară scoasă (RO + Londra → Londra).
//   DZ8  `restaurantTimeZone`: RO + Londra → Londra (operaționalul nu se uită
//        la țară); fus lipsă/invalid → București.
//   DZ9  `formatYmd`: „01.11.2026” / „1 Nov 2026”, independent de fusul gazdei
//        (UTC); șir care nu e o dată → ''.
//   DZ10 STRUCTURAL (tiparul D11 — un test „pe alt fus de gazdă” e vacuu în
//        vitest): `formatYmd` formatează cu `timeZone: 'UTC'` din `Date.UTC(`,
//        fără `new Date(ymd`; `zonedDayStartMs` NU e un singur apel
//        `zonedWallToInstant`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  addDaysYmd,
  formatYmd,
  isoToRomaniaYMD,
  isoToZonedYMD,
  reportTimeZone,
  restaurantTimeZone,
  romaniaDayBoundaryISO,
  romaniaDayRange,
  toRomaniaYMD,
  toZonedYMD,
  zonedDayRange,
  zonedDayStartMs,
} from '../dates'

const ymd = (iso: string) => toRomaniaYMD(new Date(iso))

describe('toRomaniaYMD', () => {
  it('D1 21:30Z pe 4 sept e 5 sept în România — prefixul UTC ar spune 4', () => {
    const iso = '2026-09-04T21:30:00Z'
    expect(ymd(iso)).toBe('2026-09-05')
    expect(iso.slice(0, 10)).toBe('2026-09-04') // defectul, consemnat
  })
  it('D2 vara (UTC+3): miezul nopții e la 21:00Z', () => {
    expect(ymd('2026-09-04T20:59:59.999Z')).toBe('2026-09-04')
    expect(ymd('2026-09-04T21:00:00.000Z')).toBe('2026-09-05')
  })
  it('D3 iarna (UTC+2): miezul nopții e la 22:00Z', () => {
    expect(ymd('2026-01-15T21:59:59.999Z')).toBe('2026-01-15')
    expect(ymd('2026-01-15T22:00:00.000Z')).toBe('2026-01-16')
  })
  it('D4 începutul orei de vară (29 martie 2026)', () => {
    expect(ymd('2026-03-28T21:59:59Z')).toBe('2026-03-28') // încă EET
    expect(ymd('2026-03-28T22:00:00Z')).toBe('2026-03-29')
    expect(ymd('2026-03-29T20:59:59Z')).toBe('2026-03-29') // deja EEST
    expect(ymd('2026-03-29T21:00:00Z')).toBe('2026-03-30')
  })
  it('D5 sfârșitul orei de vară (25 octombrie 2026)', () => {
    expect(ymd('2026-10-24T20:59:59Z')).toBe('2026-10-24') // încă EEST
    expect(ymd('2026-10-24T21:00:00Z')).toBe('2026-10-25')
    // seara lui 25 e deja EET: 21:30Z = 23:30, tot 25 — un +03:00 fix l-ar muta pe 26
    expect(ymd('2026-10-25T21:30:00Z')).toBe('2026-10-25')
    expect(ymd('2026-10-25T21:59:59Z')).toBe('2026-10-25')
    expect(ymd('2026-10-25T22:00:00Z')).toBe('2026-10-26')
  })
  it('D6 trecerea dintre ani', () => {
    expect(ymd('2026-12-31T21:59:59Z')).toBe('2026-12-31')
    expect(ymd('2026-12-31T22:30:00Z')).toBe('2027-01-01')
  })
})

describe('isoToRomaniaYMD', () => {
  it('D7 formatul PostgREST (+00:00), Z și microsecundele dau aceeași zi', () => {
    expect(isoToRomaniaYMD('2026-09-04T21:30:00+00:00')).toBe('2026-09-05')
    expect(isoToRomaniaYMD('2026-09-04T21:30:00Z')).toBe('2026-09-05')
    expect(isoToRomaniaYMD('2026-09-04T21:30:00.123456+00:00')).toBe('2026-09-05')
  })
  it('D8 un șir neparsabil dă null, nu aruncă (apelantul e o randare)', () => {
    expect(isoToRomaniaYMD('nu-e-o-data')).toBeNull()
    expect(isoToRomaniaYMD('')).toBeNull()
  })
})

const D9_CASES: [string, string, string, number][] = [
  ['2026-09-05', '2026-09-04T21:00:00.000Z', '2026-09-05T20:59:59.999Z', 24],
  ['2026-01-16', '2026-01-15T22:00:00.000Z', '2026-01-16T21:59:59.999Z', 24],
  ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T20:59:59.999Z', 23],
  ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T21:59:59.999Z', 25],
  // zilele de DUPĂ tranziții + DST 2027 (ultima duminică din martie = 28)
  ['2026-03-30', '2026-03-29T21:00:00.000Z', '2026-03-30T20:59:59.999Z', 24],
  ['2026-10-26', '2026-10-25T22:00:00.000Z', '2026-10-26T21:59:59.999Z', 24],
  ['2027-03-28', '2027-03-27T22:00:00.000Z', '2027-03-28T20:59:59.999Z', 23],
]

describe('romaniaDayBoundaryISO', () => {
  // Helperul NU mai trece prin fusul GAZDEI (recenzie CodeRabbit pe #276):
  // varianta cu `new Date(toLocaleString(...))` dădea pe Europe/London
  // 29 mar → 23:00Z și 25 oct → 20:00Z. Un test „rulează pe London" nu se
  // poate scrie aici — schimbarea lui process.env.TZ la runtime NU are efect
  // într-un worker thread (verificat), deci ar trece vacuu; de aceea D11 e un
  // clichet STRUCTURAL pe sursă, iar dovada pe 7 fusuri de gazdă e în PR.
  it.each(D9_CASES)('D9 %s: [%s, %s], %i ore', (day, start, end, hours) => {
    expect(romaniaDayBoundaryISO(day, false)).toBe(start)
    expect(romaniaDayBoundaryISO(day, true)).toBe(end)
    expect(Date.parse(end) - Date.parse(start) + 1).toBe(hours * 3_600_000)
  })
  it.each(D9_CASES)('D10 %s: granițele cad pe aceeași zi, 1 ms în afară pe zilele vecine', (day, start, end) => {
    expect(isoToRomaniaYMD(start)).toBe(day)
    expect(isoToRomaniaYMD(end)).toBe(day)
    expect(isoToRomaniaYMD(new Date(Date.parse(start) - 1).toISOString())).not.toBe(day)
    expect(isoToRomaniaYMD(new Date(Date.parse(end) + 1).toISOString())).not.toBe(day)
  })
  it('D11 granițele nu se calculează prin fusul gazdei (fără parsare de șir local)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/dates.ts'), 'utf8')
    const start = src.indexOf('export function romaniaDayBoundaryISO')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}\n', start))
    expect(body).not.toMatch(/toLocale(String|DateString|TimeString)/)
    expect(body).toMatch(/bucharestOffsetMs\(/)
  })
})

describe('romaniaDayRange', () => {
  it('D12 vara (UTC+3): ziua 4 sept = [3 sept 21:00Z, 4 sept 20:59:59.999Z]', () => {
    expect(romaniaDayRange('2026-09-04')).toEqual({
      from: '2026-09-03T21:00:00.000Z',
      to: '2026-09-04T20:59:59.999Z',
    })
  })
  it('D13 iarna (UTC+2) și zilele cu schimbarea orei (23 h / 25 h) au capete corecte', () => {
    expect(romaniaDayRange('2026-01-15')).toEqual({
      from: '2026-01-14T22:00:00.000Z',
      to: '2026-01-15T21:59:59.999Z',
    })
    // 29 martie: ziua are 23 de ore (EET → EEST la 01:00Z)
    expect(romaniaDayRange('2026-03-29')).toEqual({
      from: '2026-03-28T22:00:00.000Z',
      to: '2026-03-29T20:59:59.999Z',
    })
    // 25 octombrie: ziua are 25 de ore (EEST → EET la 01:00Z)
    expect(romaniaDayRange('2026-10-25')).toEqual({
      from: '2026-10-24T21:00:00.000Z',
      to: '2026-10-25T21:59:59.999Z',
    })
  })
  it('D14 zile consecutive nu se suprapun și nu lasă gol (to + 1 ms = from-ul zilei următoare)', () => {
    const a = romaniaDayRange('2026-09-04')
    const b = romaniaDayRange('2026-09-05')
    expect(Date.parse(a.to) + 1).toBe(Date.parse(b.from))
  })
})

// ─────────────────────────────────────────────────────────────
// Lotul G2b — variantele generice (fusul ca parametru)
// ─────────────────────────────────────────────────────────────
const BUC = 'Europe/Bucharest'

describe('ziua într-un fus arbitrar', () => {
  it('DZ1 pe București = variantele românești (D1–D7)', () => {
    const instants = [
      '2026-09-04T21:30:00Z', '2026-09-04T20:59:59.999Z', '2026-09-04T21:00:00.000Z',
      '2026-01-15T21:59:59.999Z', '2026-01-15T22:00:00.000Z', '2026-03-28T21:59:59Z',
      '2026-03-28T22:00:00Z', '2026-03-29T20:59:59Z', '2026-03-29T21:00:00Z',
      '2026-10-24T20:59:59Z', '2026-10-24T21:00:00Z', '2026-10-25T21:30:00Z',
      '2026-10-25T22:00:00Z', '2026-12-31T21:59:59Z', '2026-12-31T22:30:00Z',
      '2026-09-04T21:30:00+00:00', '2026-09-04T21:30:00.123456+00:00',
    ]
    for (const iso of instants) {
      expect(toZonedYMD(new Date(iso), BUC), iso).toBe(toRomaniaYMD(new Date(iso)))
      expect(isoToZonedYMD(iso, BUC), iso).toBe(isoToRomaniaYMD(iso))
    }
    expect(isoToZonedYMD('nu-e-o-data', BUC)).toBeNull()
  })

  it.each(D9_CASES)('DZ2 %s: zonedDayRange pe București = romaniaDayRange', (day) => {
    expect(zonedDayRange(day, BUC)).toEqual(romaniaDayRange(day))
  })

  it('DZ3 zile obișnuite în alte fusuri (literale)', () => {
    expect(zonedDayRange('2026-11-12', 'America/New_York')).toEqual({
      from: '2026-11-12T05:00:00.000Z',
      to: '2026-11-13T04:59:59.999Z',
    })
    expect(zonedDayRange('2026-11-13', 'Pacific/Auckland')).toEqual({
      from: '2026-11-12T11:00:00.000Z',
      to: '2026-11-13T10:59:59.999Z',
    })
    expect(zonedDayRange('2026-11-13', 'Asia/Kolkata')).toEqual({
      from: '2026-11-12T18:30:00.000Z',
      to: '2026-11-13T18:29:59.999Z',
    })
    // Instantul convertit, nu prefixul: 03:30Z pe 13 nov = 22:30 pe 12 la New York.
    expect(isoToZonedYMD('2026-11-13T03:30:00Z', 'America/New_York')).toBe('2026-11-12')
    expect(toZonedYMD(new Date('2026-11-12T11:30:00Z'), 'Pacific/Auckland')).toBe('2026-11-13')
  })

  const transitions: [string, string][] = [
    ['America/New_York', '2026-03-08'],
    ['America/New_York', '2026-11-01'],
    ['Pacific/Auckland', '2026-04-05'],
    ['Pacific/Auckland', '2026-09-27'],
    ['America/Havana', '2026-03-08'],
    ['America/Havana', '2026-11-01'],
    ['America/Santiago', '2026-04-05'],
    ['Asia/Beirut', '2026-03-29'],
    [BUC, '2026-03-29'],
    [BUC, '2026-10-25'],
  ]
  it.each(transitions)('DZ4 %s %s: începutul și sfârșitul zilei, pe proprietate', (tz, day) => {
    const { from, to } = zonedDayRange(day, tz)
    const fromMs = Date.parse(from)
    const toMs = Date.parse(to)
    expect(fromMs).toBe(zonedDayStartMs(day, tz))
    expect(isoToZonedYMD(from, tz)).toBe(day)
    expect(isoToZonedYMD(new Date(fromMs - 1).toISOString(), tz)).toBe(addDaysYmd(day, -1))
    expect(isoToZonedYMD(to, tz)).toBe(day)
    expect(toMs + 1).toBe(Date.parse(zonedDayRange(addDaysYmd(day, 1), tz).from))
    expect([23, 24, 25].map((h) => h * 3_600_000)).toContain(toMs - fromMs + 1)
  })

  it('DZ5 addDaysYmd pe șir: lună, an, 29 februarie, invalid', () => {
    expect(addDaysYmd('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysYmd('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysYmd('2026-11-15', -29)).toBe('2026-10-17')
    expect(addDaysYmd('nu-e-data', 1)).toBe('nu-e-data')
  })

  it('DZ6 fus invalid sau gol → București, fără excepție', () => {
    const iso = '2026-09-04T21:30:00Z'
    for (const tz of ['Mars/Olympus', '', 'Not/Zone']) {
      expect(toZonedYMD(new Date(iso), tz), tz).toBe('2026-09-05')
      expect(isoToZonedYMD(iso, tz), tz).toBe('2026-09-05')
      expect(zonedDayRange('2026-09-05', tz), tz).toEqual(romaniaDayRange('2026-09-05'))
    }
  })
})

describe('cele două reguli de fus', () => {
  it('DZ7 reportTimeZone: România (sau țara necunoscută) → București, altfel fusul', () => {
    expect(reportTimeZone({ country: 'RO', timezone: 'Europe/London' })).toBe(BUC)
    expect(reportTimeZone({ country: 'RO', timezone: BUC })).toBe(BUC)
    expect(reportTimeZone({ country: null, timezone: 'America/New_York' })).toBe(BUC)
    expect(reportTimeZone({ timezone: 'America/New_York' })).toBe(BUC)
    expect(reportTimeZone(null)).toBe(BUC)
    expect(reportTimeZone(undefined)).toBe(BUC)
    expect(reportTimeZone({ country: 'US', timezone: 'America/New_York' })).toBe('America/New_York')
    expect(reportTimeZone({ country: 'US', timezone: 'Mars/Olympus' })).toBe(BUC)
    expect(reportTimeZone({ country: 'US', timezone: null })).toBe(BUC)
  })

  it('DZ8 restaurantTimeZone: fusul localului, oricare ar fi țara', () => {
    expect(restaurantTimeZone({ country: 'RO', timezone: 'Europe/London' })).toBe('Europe/London')
    expect(restaurantTimeZone({ country: 'US', timezone: 'America/New_York' })).toBe('America/New_York')
    expect(restaurantTimeZone({ country: 'US', timezone: 'Mars/Olympus' })).toBe(BUC)
    expect(restaurantTimeZone({ timezone: null })).toBe(BUC)
    expect(restaurantTimeZone(null)).toBe(BUC)
  })
})

describe('formatYmd', () => {
  it('DZ9 o dată fără oră se formatează ca dată, nu ca instant', () => {
    expect(formatYmd('2026-11-01', 'ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('01.11.2026')
    expect(formatYmd('2026-11-01', 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })).toBe('01 Nov 2026')
    expect(formatYmd('2026-03-02', 'ro-RO', { day: '2-digit', month: '2-digit' })).toBe('02.03')
    expect(formatYmd('2026-11-01T12:00:00Z', 'ro-RO', { day: '2-digit' })).toBe('')
    expect(formatYmd('', 'ro-RO', { day: '2-digit' })).toBe('')
  })

  it('DZ10 structural: fără fusul gazdei; începutul zilei nu e un pas de zonedWallToInstant', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/dates.ts'), 'utf8')
    const body = (name: string): string => {
      const start = src.indexOf(`export function ${name}(`)
      expect(start, name).toBeGreaterThan(-1)
      return src.slice(start, src.indexOf('\n}\n', start))
    }
    const fmt = body('formatYmd')
    expect(fmt).toContain("timeZone: 'UTC'")
    expect(fmt).toContain('Date.UTC(')
    expect(fmt).not.toMatch(/new Date\(ymd/)
    expect(fmt).not.toMatch(/toLocale(String|DateString|TimeString)/)
    const start = body('zonedDayStartMs')
    expect(start).not.toMatch(/zonedWallToInstant\(/)
    expect(start).toMatch(/candidates/)
  })
})
