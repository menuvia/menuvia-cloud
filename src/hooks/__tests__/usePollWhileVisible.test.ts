// usePollWhileVisible (perf-staff-6): ritmul de reîmprospătare al ecranelor de
// staff se oprește cu fila ascunsă și recuperează la revenire.
//
//   PV1  fila vizibilă → o citire la fiecare interval, NICIUNA la montare
//        (citirea inițială e a consumatorului)
//   PV2  fila ascunsă → zero citiri oricât trece timpul
//        Mutația care pică: `setInterval(poll, ms)` simplu, fără vizibilitate.
//   PV3  revenirea în filă → citire IMEDIATĂ, apoi ritmul repornește de la zero
//        Mutația care pică: fără `poll()` în ramura „vizibil" (recuperarea).
//   PV4  enabled=false → nimic; trecerea pe true pornește ritmul
//   PV5  după demontare: nicio citire, nici la un `visibilitychange` ulterior
//        Mutația care pică: cleanup fără removeEventListener.
//   PV6  `poll` cu identitate nouă la randare NU reîncepe cronometrul și se
//        folosește ultima versiune
//        Mutația care pică: `poll` în lista de dependențe a efectului.
//   PV7  varianta imperativă: oprirea întoarsă curăță cronometrul ȘI ascultătorul
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePollWhileVisible, startPollingWhileVisible } from '../usePollWhileVisible'

let visibility: 'visible' | 'hidden' = 'visible'

function setVisibility(v: 'visible' | 'hidden'): void {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

afterEach(() => {
  vi.useRealTimers()
  // Proprietatea proprie umbrea getter-ul din prototip; o scoatem.
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('usePollWhileVisible', () => {
  it('PV1: fila vizibilă → o citire per interval, nimic la montare', () => {
    const poll = vi.fn()
    renderHook(() => usePollWhileVisible(poll, 15_000))
    expect(poll).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15_000)
    expect(poll).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('PV2: fila ascunsă → zero citiri', () => {
    const poll = vi.fn()
    renderHook(() => usePollWhileVisible(poll, 15_000))
    setVisibility('hidden')
    vi.advanceTimersByTime(10 * 60_000)
    expect(poll).not.toHaveBeenCalled()
  })

  it('PV2b: montat cu fila deja ascunsă → zero citiri până la revenire', () => {
    visibility = 'hidden'
    const poll = vi.fn()
    renderHook(() => usePollWhileVisible(poll, 15_000))
    vi.advanceTimersByTime(60_000)
    expect(poll).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('PV3: la revenire citește imediat, apoi ritmul repornește de la zero', () => {
    const poll = vi.fn()
    renderHook(() => usePollWhileVisible(poll, 15_000))
    vi.advanceTimersByTime(10_000)
    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    expect(poll).not.toHaveBeenCalled()

    setVisibility('visible')
    expect(poll).toHaveBeenCalledTimes(1)
    // Cronometrul vechi (pornit la 0, 10 s consumate) nu mai trage la +5 s.
    vi.advanceTimersByTime(5_000)
    expect(poll).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('PV4: enabled=false nu pornește nimic; true pornește ritmul', () => {
    const poll = vi.fn()
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => usePollWhileVisible(poll, 10_000, on),
      { initialProps: { on: false } },
    )
    vi.advanceTimersByTime(60_000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(poll).not.toHaveBeenCalled()

    rerender({ on: true })
    vi.advanceTimersByTime(10_000)
    expect(poll).toHaveBeenCalledTimes(1)

    rerender({ on: false })
    vi.advanceTimersByTime(60_000)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('PV5: după demontare nu mai citește, nici la schimbarea vizibilității', () => {
    const poll = vi.fn()
    const { unmount } = renderHook(() => usePollWhileVisible(poll, 15_000))
    unmount()
    vi.advanceTimersByTime(60_000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(poll).not.toHaveBeenCalled()
  })

  it('PV6: un poll nou la randare nu reîncepe cronometrul și e cel folosit', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ p }: { p: () => void }) => usePollWhileVisible(p, 15_000), {
      initialProps: { p: first },
    })
    vi.advanceTimersByTime(10_000)
    rerender({ p: second })
    // Dacă rerandarea ar reporni cronometrul, următoarea citire ar veni la +15 s.
    vi.advanceTimersByTime(5_000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('startPollingWhileVisible', () => {
  it('PV7: funcția întoarsă oprește cronometrul și ascultătorul', () => {
    const poll = vi.fn()
    const stop = startPollingWhileVisible(poll, 5_000)
    vi.advanceTimersByTime(5_000)
    expect(poll).toHaveBeenCalledTimes(1)
    stop()
    vi.advanceTimersByTime(60_000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(poll).toHaveBeenCalledTimes(1)
  })
})
