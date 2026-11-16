// Teste pe `useZonedTodayRange` — intervalul „azi" al ospătarului, în fusul
// LOCALULUI (lotul G2c; fostul `useRomaniaTodayRange`).
//
// Defectul vechi: WaiterPage memoiza intervalul cu `useMemo(..., [])`, deci o
// tabletă lăsată deschisă peste noapte rămânea pe ziua de IERI. Aici ziua se
// reevaluează la miezul nopții (poll) și la revenirea în prim-plan.
// H1–H4 = controlul românesc: aceleași valori ca hook-ul vechi, cu fusul
// Bucureștiului dat ca PARAMETRU. H5–H7 = fusul e chiar folosit.
//
// Ancora de fus: 2026-09-04T21:00:00Z = 00:00 EEST pe 5 septembrie (UTC+3 vara).
//   H5  New York: la 2026-07-21T02:00:00Z (22:00 EDT pe 20 iulie) intervalul e
//       ziua de 20 iulie a NY. [PICĂ: parametrul ignorat (ziua Bucureștiului)]
//   H6  schimbarea fusului: intervalul NOULUI fus apare în ACEEAȘI randare (nicio
//       randare nu întoarce ziua veche pe fusul nou), iar trecerea miezului
//       nopții în NOUL fus e prinsă de poll. [PICĂ: starea doar cu `ymd`
//       (randare cu interval amestecat); efectul cu deps `[]` (poll-ul rămâne
//       pe fusul vechi)]
//   H7  fus invalid → București, fără excepție.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useZonedTodayRange, TODAY_RANGE_POLL_MS } from '../useZonedTodayRange'
import { zonedDayRange } from '../../lib/dates'

const BUC = 'Europe/Bucharest'
const NY = 'America/New_York'
const DAY_4 = { from: '2026-09-03T21:00:00.000Z', to: '2026-09-04T20:59:59.999Z' }
const DAY_5 = { from: '2026-09-04T21:00:00.000Z', to: '2026-09-05T20:59:59.999Z' }

describe('useZonedTodayRange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('H1 la 23:59:30 ora României intervalul e ziua 4; după miezul nopții trece pe ziua 5 (poll)', () => {
    vi.setSystemTime(new Date('2026-09-04T20:59:30Z'))
    const { result } = renderHook(() => useZonedTodayRange(BUC))
    expect(result.current).toEqual(DAY_4)

    // 60 s mai târziu e 00:00:30 pe 5 septembrie
    act(() => {
      vi.advanceTimersByTime(TODAY_RANGE_POLL_MS)
    })
    expect(result.current).toEqual(DAY_5)
  })

  it('H2 identitatea obiectului e STABILĂ în aceeași zi (altfel useReservations ar re-fetch-ui la fiecare poll)', () => {
    vi.setSystemTime(new Date('2026-09-04T10:00:00Z'))
    const { result } = renderHook(() => useZonedTodayRange(BUC))
    const first = result.current
    act(() => {
      vi.advanceTimersByTime(TODAY_RANGE_POLL_MS * 5)
    })
    expect(result.current).toBe(first)
  })

  it('H3 tableta adormită peste noapte: la revenirea în prim-plan (visibilitychange) ziua se actualizează FĂRĂ să fi rulat poll-ul', () => {
    vi.setSystemTime(new Date('2026-09-04T18:00:00Z'))
    const { result } = renderHook(() => useZonedTodayRange(BUC))
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
    const { unmount } = renderHook(() => useZonedTodayRange(BUC))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('H5 fusul localului: la 22:00 EDT intervalul e ziua NY, nu ziua Bucureștiului', () => {
    vi.setSystemTime(new Date('2026-07-21T02:00:00Z'))
    const { result } = renderHook(() => useZonedTodayRange(NY))
    expect(result.current).toEqual({
      from: '2026-07-20T04:00:00.000Z',
      to: '2026-07-21T03:59:59.999Z',
    })
    // Control: pe București, același instant e deja 21 iulie.
    expect(zonedDayRange('2026-07-21', BUC)).not.toEqual(result.current)
  })

  it('H6 la schimbarea fusului: intervalul nou în ACEEAȘI randare, iar poll-ul urmează fusul nou', () => {
    vi.setSystemTime(new Date('2026-07-21T02:00:00Z')) // 05:00 la București, 22:00 pe 20 la NY
    const seen: Array<{ tz: string; range: { from: string; to: string } }> = []
    const { result, rerender } = renderHook(
      ({ tz }: { tz: string }) => {
        const range = useZonedTodayRange(tz)
        seen.push({ tz, range })
        return range
      },
      { initialProps: { tz: BUC } },
    )
    expect(result.current).toEqual(zonedDayRange('2026-07-21', BUC))

    rerender({ tz: NY })
    const nyDay20 = zonedDayRange('2026-07-20', NY)
    const mixed = zonedDayRange('2026-07-21', NY) // ziua Bucureștiului pe fusul NY
    expect(result.current).toEqual(nyDay20)
    // NICIO randare pe fusul nou n-a întors intervalul amestecat.
    expect(seen.filter((s) => s.tz === NY).map((s) => s.range)).not.toContainEqual(mixed)

    // Identitatea e stabilă după schimbare (fără fetch-uri degeaba)…
    const afterSwitch = result.current
    act(() => {
      vi.advanceTimersByTime(TODAY_RANGE_POLL_MS * 3)
    })
    expect(result.current).toBe(afterSwitch)

    // …iar miezul nopții NY (04:00Z) e prins de poll, deși la București ziua
    // NU se schimbă (07:30, tot 21 iulie) — un efect rămas pe fusul vechi nu l-ar vedea.
    act(() => {
      vi.advanceTimersByTime(TODAY_RANGE_POLL_MS * 150)
    })
    expect(result.current).toEqual(zonedDayRange('2026-07-21', NY))
  })

  it('H7 fus invalid → București, fără excepție', () => {
    vi.setSystemTime(new Date('2026-09-04T20:59:30Z'))
    const { result } = renderHook(() => useZonedTodayRange('Mars/Olympus'))
    expect(result.current).toEqual(DAY_4)
  })
})
