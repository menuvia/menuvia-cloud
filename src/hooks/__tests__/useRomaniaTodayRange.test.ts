// Teste pe `useRomaniaTodayRange` — intervalul „azi" al ospătarului.
//
// Defectul: WaiterPage memoiza intervalul cu `useMemo(..., [])`, deci o tabletă
// lăsată deschisă peste noapte rămânea pe ziua de IERI. Aici ziua ROMÂNEASCĂ se
// reevaluează la miezul nopții (poll) și la revenirea în prim-plan.
//
// Ancora de fus: 2026-09-04T21:00:00Z = 00:00 EEST pe 5 septembrie (UTC+3 vara).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRomaniaTodayRange, TODAY_RANGE_POLL_MS } from '../useRomaniaTodayRange'

const DAY_4 = { from: '2026-09-03T21:00:00.000Z', to: '2026-09-04T20:59:59.999Z' }
const DAY_5 = { from: '2026-09-04T21:00:00.000Z', to: '2026-09-05T20:59:59.999Z' }

describe('useRomaniaTodayRange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('H1 la 23:59:30 ora României intervalul e ziua 4; după miezul nopții trece pe ziua 5 (poll)', () => {
    vi.setSystemTime(new Date('2026-09-04T20:59:30Z'))
    const { result } = renderHook(() => useRomaniaTodayRange())
    expect(result.current).toEqual(DAY_4)

    // 60 s mai târziu e 00:00:30 pe 5 septembrie
    act(() => {
      vi.advanceTimersByTime(TODAY_RANGE_POLL_MS)
    })
    expect(result.current).toEqual(DAY_5)
  })

  it('H2 identitatea obiectului e STABILĂ în aceeași zi (altfel useReservations ar re-fetch-ui la fiecare poll)', () => {
    vi.setSystemTime(new Date('2026-09-04T10:00:00Z'))
    const { result } = renderHook(() => useRomaniaTodayRange())
    const first = result.current
    act(() => {
      vi.advanceTimersByTime(TODAY_RANGE_POLL_MS * 5)
    })
    expect(result.current).toBe(first)
  })

  it('H3 tableta adormită peste noapte: la revenirea în prim-plan (visibilitychange) ziua se actualizează FĂRĂ să fi rulat poll-ul', () => {
    vi.setSystemTime(new Date('2026-09-04T18:00:00Z'))
    const { result } = renderHook(() => useRomaniaTodayRange())
    expect(result.current).toEqual(DAY_4)

    // ceasul sare peste noapte, fără ca timerele să fi rulat (dispozitiv adormit)
    vi.setSystemTime(new Date('2026-09-05T05:00:00Z'))
    // jsdom raportează „prerender" fără pretendToBeVisual — fixăm explicit.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toEqual(DAY_5)
  })

  it('H4 la unmount nu rămân timere/listenere (fără setState pe componentă demontată)', () => {
    vi.setSystemTime(new Date('2026-09-04T20:59:30Z'))
    const { unmount } = renderHook(() => useRomaniaTodayRange())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
