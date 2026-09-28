// src/lib/__tests__/dates.test.ts
// Granițele de zi în fusul României (lib/dates.ts) — până acum fără niciun test,
// deși ReportsTab, HomeTab, VatReportTab, StocksTab și BridgeTab depind de el.
// Ancora e aceeași ca la mig 269 / OM1: 2026-09-04T21:30Z = 00:30 EEST pe 5 sept.
// DST 2026: ora de vară începe duminică 29 martie la 01:00Z și se termină
// duminică 25 octombrie la 01:00Z (ultimele duminici din lună).
import { describe, it, expect } from 'vitest'
import { isoToRomaniaYMD, romaniaDayBoundaryISO, toRomaniaYMD } from '../dates'

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

describe('romaniaDayBoundaryISO', () => {
  // Helperul își calculează offset-ul parsând două șiruri în fusul GAZDEI:
  // corect pe UTC (CI) și Europe/Bucharest (orice client real); pe o gazdă cu
  // propria tranziție DST în fereastra 00:00–03:00 (Europe/London) cazurile de
  // 29 mar / 25 oct pică — defect REAL al helperului, consemnat, nu flake.
  const cases: [string, string, string, number][] = [
    ['2026-09-05', '2026-09-04T21:00:00.000Z', '2026-09-05T20:59:59.999Z', 24],
    ['2026-01-16', '2026-01-15T22:00:00.000Z', '2026-01-16T21:59:59.999Z', 24],
    ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T20:59:59.999Z', 23],
    ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T21:59:59.999Z', 25],
  ]
  it.each(cases)('D9 %s: [%s, %s], %i ore', (day, start, end, hours) => {
    expect(romaniaDayBoundaryISO(day, false)).toBe(start)
    expect(romaniaDayBoundaryISO(day, true)).toBe(end)
    expect(Date.parse(end) - Date.parse(start) + 1).toBe(hours * 3_600_000)
  })
  it.each(cases)('D10 %s: granițele cad pe aceeași zi, 1 ms în afară pe zilele vecine', (day, start, end) => {
    expect(isoToRomaniaYMD(start)).toBe(day)
    expect(isoToRomaniaYMD(end)).toBe(day)
    expect(isoToRomaniaYMD(new Date(Date.parse(start) - 1).toISOString())).not.toBe(day)
    expect(isoToRomaniaYMD(new Date(Date.parse(end) + 1).toISOString())).not.toBe(day)
  })
})
