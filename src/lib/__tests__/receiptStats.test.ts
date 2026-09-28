// src/lib/__tests__/receiptStats.test.ts
// Contoarele „azi" din BridgeTab (lib/receiptStats.ts), fără randare. Fiecare
// caz de fus conține un bon care PICĂ pe codul vechi (ziua RO vs prefixul UTC)
// și unul care pică pe „reparația" inversă (ambele părți în UTC).
import { describe, it, expect } from 'vitest'
import { receiptStatsForRomaniaDay, type ReceiptStatus } from '../receiptStats'

const r = (status: ReceiptStatus, created_at: string) => ({ status, created_at })

describe('receiptStatsForRomaniaDay', () => {
  it('BS1 vara (EEST): bonul de la 00:30 e AZI, cel de la 23:30 de aseară nu', () => {
    const now = new Date('2026-09-04T21:45:00Z') // 00:45, 5 septembrie
    const s = receiptStatsForRomaniaDay(
      [
        r('success', '2026-09-04T21:30:00+00:00'), // 00:30, 5 sept — prefix „04"
        r('success', '2026-09-04T20:30:00+00:00'), // 23:30, 4 sept — ieri
      ],
      now,
    )
    expect(s).toEqual({ pending: 0, success: 1, errors: 0 })
  })
  it('BS2 iarna (EET): fereastra afectată e 00:00–02:00', () => {
    const now = new Date('2026-01-15T22:30:00Z') // 00:30, 16 ianuarie
    const s = receiptStatsForRomaniaDay(
      [r('error', '2026-01-15T22:10:00Z'), r('error', '2026-01-15T21:59:59Z')],
      now,
    )
    expect(s).toEqual({ pending: 0, success: 0, errors: 1 })
  })
  it('BS3 ziua în care se termină ora de vară (25 oct, 25 de ore)', () => {
    const now = new Date('2026-10-25T21:45:00Z') // 23:45 EET, 25 octombrie
    const s = receiptStatsForRomaniaDay(
      [
        r('success', '2026-10-24T21:30:00+00:00'), // 00:30 EEST, 25 oct — azi
        r('success', '2026-10-25T21:30:00+00:00'), // 23:30 EET, 25 oct — azi
        r('success', '2026-10-24T20:30:00+00:00'), // 23:30 EEST, 24 oct — ieri
      ],
      now,
    )
    expect(s.success).toBe(2)
  })
  it('BS4 ziua în care începe ora de vară (29 mar, 23 de ore)', () => {
    const now = new Date('2026-03-29T20:45:00Z') // 23:45 EEST, 29 martie
    const s = receiptStatsForRomaniaDay(
      [
        r('success', '2026-03-28T22:30:00+00:00'), // 00:30 EET, 29 mar — azi
        r('success', '2026-03-29T20:30:00+00:00'), // 23:30 EEST, 29 mar — azi
        r('success', '2026-03-28T21:30:00+00:00'), // 23:30 EET, 28 mar — ieri
      ],
      now,
    )
    expect(s.success).toBe(2)
  })
  it('BS5 găleți neschimbate: pending+sent → în așteptare; cancelled nu se numără', () => {
    const now = new Date('2026-09-05T12:00:00Z')
    const s = receiptStatsForRomaniaDay(
      [
        r('pending', '2026-09-05T08:00:00+00:00'),
        r('sent', '2026-09-05T08:01:00+00:00'),
        r('success', '2026-09-05T08:02:00+00:00'),
        r('error', '2026-09-05T08:03:00+00:00'),
        r('cancelled', '2026-09-05T08:04:00+00:00'),
      ],
      now,
    )
    expect(s).toEqual({ pending: 2, success: 1, errors: 1 })
  })
  it('BS6 formatul serverului e indiferent; un created_at neparsabil se sare, nu aruncă', () => {
    const now = new Date('2026-09-04T21:45:00Z')
    const rows = [
      r('success', '2026-09-04T21:30:00+00:00'),
      r('success', '2026-09-04T21:30:00Z'),
      r('success', '2026-09-04T21:30:00.123456+00:00'),
      r('success', 'nu-e-o-data'),
      r('success', ''),
    ]
    expect(() => receiptStatsForRomaniaDay(rows, now)).not.toThrow()
    expect(receiptStatsForRomaniaDay(rows, now).success).toBe(3)
  })
})
