// src/lib/__tests__/utils.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { elapsed, urgencyColor } from '../utils'
import { D } from '../constants'

describe('elapsed()', () => {
  beforeEach(() => {
    // Fix date la 2026-05-17 12:00:00 UTC pentru tests deterministe
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-17T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returnează secunde sub 60s', () => {
    const justNow = new Date('2026-05-17T11:59:30Z').toISOString()
    expect(elapsed(justNow)).toBe('30s')
  })

  it('returnează 0s pentru aceeași dată', () => {
    expect(elapsed('2026-05-17T12:00:00Z')).toBe('0s')
  })

  it('returnează minute între 60s și 1h', () => {
    const fiveMinAgo = new Date('2026-05-17T11:55:00Z').toISOString()
    expect(elapsed(fiveMinAgo)).toBe('5m')

    const fortyFiveMinAgo = new Date('2026-05-17T11:15:00Z').toISOString()
    expect(elapsed(fortyFiveMinAgo)).toBe('45m')
  })

  it('returnează ore și minute peste 1h', () => {
    const twoHoursAgo = new Date('2026-05-17T10:00:00Z').toISOString()
    expect(elapsed(twoHoursAgo)).toBe('2h 0m')

    const oneHourThirtyAgo = new Date('2026-05-17T10:30:00Z').toISOString()
    expect(elapsed(oneHourThirtyAgo)).toBe('1h 30m')
  })

  it('gestionează corect data exactă la limita 60s', () => {
    const exactlyMin = new Date('2026-05-17T11:59:00Z').toISOString()
    expect(elapsed(exactlyMin)).toBe('1m')
  })

  it('gestionează corect data exactă la limita 60m', () => {
    const exactlyHour = new Date('2026-05-17T11:00:00Z').toISOString()
    expect(elapsed(exactlyHour)).toBe('1h 0m')
  })
})

describe('urgencyColor()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-17T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returnează verde/text pentru comenzi recente (< 10 min)', () => {
    const fiveMinAgo = new Date('2026-05-17T11:55:00Z').toISOString()
    expect(urgencyColor(fiveMinAgo)).toBe(D.t3)
  })

  it('returnează ambră pentru comenzi între 10-20 min', () => {
    const fifteenMinAgo = new Date('2026-05-17T11:45:00Z').toISOString()
    expect(urgencyColor(fifteenMinAgo)).toBe(D.amber)
  })

  it('returnează roșu pentru comenzi peste 20 min', () => {
    const twentyFiveMinAgo = new Date('2026-05-17T11:35:00Z').toISOString()
    expect(urgencyColor(twentyFiveMinAgo)).toBe(D.red)
  })

  it('gestionează corect limita exactă de 10 min', () => {
    const exactlyTenMin = new Date('2026-05-17T11:50:00Z').toISOString()
    expect(urgencyColor(exactlyTenMin)).toBe(D.amber)
  })

  it('gestionează corect limita exactă de 20 min', () => {
    const exactlyTwentyMin = new Date('2026-05-17T11:40:00Z').toISOString()
    expect(urgencyColor(exactlyTwentyMin)).toBe(D.red)
  })
})
