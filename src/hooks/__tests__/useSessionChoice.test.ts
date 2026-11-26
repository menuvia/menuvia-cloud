// Perioada aleasă pe Vânzări/Statistici supraviețuiește demontării filei (lotul
// C6a): `useSessionChoice` + validarea din lib/reportChoice.ts. (Prefixul XP:
// verificat cu grep în src/, tests/, e2e/, supabase/, docs și CLAUDE.md,
// nefolosit înainte; XP6–XP7 sunt în testele de componentă ale filelor,
// ReportsTabPlan.test.tsx și AnalyticsLang.test.tsx.)
//   XP1  `parseReportsChoice`: o alegere validă trece; perioada din afara
//        enum-ului → null; un interval care se termină după AZI, cu `from` >
//        `to` sau cu o dată imposibilă invalidează „Alt interval” (null) și,
//        pe o perioadă fixă, doar resetează intervalul pe azi. Mutația care
//        pică: fără verificarea `to ≤ azi` (un interval „din viitor” restaurat).
//   XP2  `parseAnalyticsDays`: doar 7/14/30, ca număr.
//   XP3  citirea/scrierea pe `sessionStorage` (dus-întors) și JSON stricat →
//        null, nu excepție.
//   XP4  stocarea care ARUNCĂ (Safari cu cookie-urile blocate, RESID-15):
//        citirea dă null, scrierea nu aruncă, hook-ul pornește de la implicit
//        și funcționează în memorie. Control POZITIV: fără excepție, valoarea
//        salvată chiar se citește. Mutația care pică: try/catch scos.
//   XP5  hook-ul: restaurează la montare, salvează la schimbare, o valoare
//        salvată invalidă dă implicitul. Mutația care pică: `useState(fallback)`
//        fără citirea din stocare.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { readSessionChoice, useSessionChoice, writeSessionChoice } from '../useSessionChoice'
import {
  ANALYTICS_DAYS_KEY,
  REPORTS_CHOICE_KEY,
  defaultReportsChoice,
  parseAnalyticsDays,
  parseReportsChoice,
} from '../../lib/reportChoice'

const TODAY = '2026-11-15'

beforeEach(() => {
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('validarea alegerii (C6a)', () => {
  it('XP1: parseReportsChoice', () => {
    const ok = { period: 'custom', custom: { from: '2026-11-01', to: '2026-11-15' } }
    expect(parseReportsChoice(ok, TODAY)).toEqual(ok)
    expect(parseReportsChoice({ period: 'week', custom: { from: '2026-10-01', to: '2026-10-02' } }, TODAY)).toEqual({
      period: 'week',
      custom: { from: '2026-10-01', to: '2026-10-02' },
    })
    // Perioada necunoscută / formă greșită → implicitul ecranului.
    for (const bad of [null, 'today', 7, { period: 'year' }, { period: 'TODAY' }, []])
      expect(parseReportsChoice(bad, TODAY), JSON.stringify(bad)).toBeNull()
    // Interval invalid: „Alt interval” cade, o perioadă fixă își păstrează alegerea.
    const badRanges = [
      { from: '2026-11-10', to: '2026-11-16' }, // se termină mâine
      { from: '2026-11-12', to: '2026-11-10' }, // from > to
      { from: '2026-02-30', to: '2026-03-02' }, // dată imposibilă
      { from: '', to: '2026-11-15' },
      { from: 20261110, to: '2026-11-15' },
    ]
    for (const custom of badRanges) {
      expect(parseReportsChoice({ period: 'custom', custom }, TODAY), JSON.stringify(custom)).toBeNull()
      expect(parseReportsChoice({ period: 'month', custom }, TODAY)).toEqual({
        period: 'month',
        custom: { from: TODAY, to: TODAY },
      })
    }
    expect(parseReportsChoice({ period: 'today' }, TODAY)).toEqual(defaultReportsChoice(TODAY))
    // Azi însuși e un capăt valid.
    expect(parseReportsChoice({ period: 'custom', custom: { from: TODAY, to: TODAY } }, TODAY)).not.toBeNull()
  })

  it('XP2: parseAnalyticsDays', () => {
    for (const d of [7, 14, 30]) expect(parseAnalyticsDays(d)).toBe(d)
    for (const bad of [15, 0, -7, '30', null, undefined, 30.5]) expect(parseAnalyticsDays(bad)).toBeNull()
  })
})

describe('stocarea pe sesiune (C6a)', () => {
  it('XP3: dus-întors; JSON stricat → null', () => {
    writeSessionChoice(ANALYTICS_DAYS_KEY, 14)
    expect(window.sessionStorage.getItem(ANALYTICS_DAYS_KEY)).toBe('14')
    expect(readSessionChoice(ANALYTICS_DAYS_KEY, parseAnalyticsDays)).toBe(14)
    window.sessionStorage.setItem(ANALYTICS_DAYS_KEY, '{nu e json')
    expect(readSessionChoice(ANALYTICS_DAYS_KEY, parseAnalyticsDays)).toBeNull()
    expect(readSessionChoice('menuvia:lipsa', parseAnalyticsDays)).toBeNull()
  })

  it('XP4: stocarea care aruncă — fail-open', () => {
    window.sessionStorage.setItem(ANALYTICS_DAYS_KEY, '7')
    // Control POZITIV: fără excepție, valoarea salvată se citește.
    expect(readSessionChoice(ANALYTICS_DAYS_KEY, parseAnalyticsDays)).toBe(7)
    const boom = (): never => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    expect(readSessionChoice(ANALYTICS_DAYS_KEY, parseAnalyticsDays)).toBeNull()
    expect(() => writeSessionChoice(ANALYTICS_DAYS_KEY, 14)).not.toThrow()
    const { result } = renderHook(() => useSessionChoice(ANALYTICS_DAYS_KEY, () => 30, parseAnalyticsDays))
    expect(result.current[0]).toBe(30)
    act(() => result.current[1](14))
    expect(result.current[0]).toBe(14)
  })

  it('XP5: hook-ul restaurează, salvează și respinge o valoare invalidă', () => {
    const parse = (raw: unknown) => parseReportsChoice(raw, TODAY)
    const first = renderHook(() => useSessionChoice(REPORTS_CHOICE_KEY, () => defaultReportsChoice(TODAY), parse))
    expect(first.result.current[0].period).toBe('today')
    act(() =>
      first.result.current[1]({ period: 'custom', custom: { from: '2026-11-01', to: '2026-11-10' } }),
    )
    first.unmount()
    // A doua montare (fila revenită) pornește de unde a rămas.
    const second = renderHook(() => useSessionChoice(REPORTS_CHOICE_KEY, () => defaultReportsChoice(TODAY), parse))
    expect(second.result.current[0]).toEqual({ period: 'custom', custom: { from: '2026-11-01', to: '2026-11-10' } })
    second.unmount()
    // O valoare salvată invalidă (interval din viitor) → implicitul.
    window.sessionStorage.setItem(
      REPORTS_CHOICE_KEY,
      JSON.stringify({ period: 'custom', custom: { from: '2026-11-01', to: '2026-12-01' } }),
    )
    const third = renderHook(() => useSessionChoice(REPORTS_CHOICE_KEY, () => defaultReportsChoice(TODAY), parse))
    expect(third.result.current[0]).toEqual(defaultReportsChoice(TODAY))
  })
})
