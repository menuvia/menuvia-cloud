// useCodviaOrdersOpen — starea magazinului Codvia, TRISTATE, din serverul de
// comenzi (codvia-order.js, GET {open}); sursa scurtăturii de pe Acasă.
//
//   CQ1  rețea căzută / răspuns fără formă → null (necunoscut), NU `true`;
//        un necunoscut NU se memorează (montarea următoare reîncearcă)
//        Mutația care pică: `body.open !== false` (orice formă = deschis).
//   CQ2  `{open:false}` → false, cerut pe GET la codvia-order
//   CQ3  un răspuns cunoscut se memorează: Acasă remontată nu re-cere
// Un singur test, în ordine: cache-ul e la nivel de modul (fără vi.resetModules
// peste React).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCodviaOrdersOpen } from '../useCodviaOrdersOpen'

afterEach(() => {
  vi.unstubAllGlobals()
})

// Montează hook-ul, așteaptă cererea și lasă lanțul ei să se încheie (un
// macrotask după ce fetch-ul a fost chemat) — un rezultat `null` nu schimbă
// starea, deci nu există altceva de așteptat.
async function settledWith(fetchMock: unknown): Promise<boolean | null> {
  const { result, unmount } = renderHook(() => useCodviaOrdersOpen())
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const v = result.current
  unmount()
  return v
}

describe('useCodviaOrdersOpen', () => {
  it('CQ1–CQ3: necunoscut nu e „deschis", iar doar răspunsul cunoscut se memorează', async () => {
    // CQ1a: rețea căzută.
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', down)
    expect(await settledWith(down)).toBeNull()
    expect(down).toHaveBeenCalledTimes(1)

    // CQ1b: răspuns fără formă (funcție veche) — tot necunoscut, și se reîncearcă.
    const shapeless = vi.fn(async () => ({ ok: true, json: async () => ({ open: 'yes' }) }))
    vi.stubGlobal('fetch', shapeless)
    expect(await settledWith(shapeless)).toBeNull()
    expect(shapeless).toHaveBeenCalledTimes(1)

    // CQ2: în pauză.
    const paused = vi.fn(async () => ({ ok: true, json: async () => ({ open: false }) }))
    vi.stubGlobal('fetch', paused)
    const { result } = renderHook(() => useCodviaOrdersOpen())
    await waitFor(() => expect(result.current).toBe(false))
    expect(paused).toHaveBeenCalledWith(expect.stringContaining('codvia-order'), {
      method: 'GET',
    })

    // CQ3: memorat — o nouă montare nu re-cere.
    const again = renderHook(() => useCodviaOrdersOpen())
    await waitFor(() => expect(again.result.current).toBe(false))
    expect(paused).toHaveBeenCalledTimes(1)
  })
})
