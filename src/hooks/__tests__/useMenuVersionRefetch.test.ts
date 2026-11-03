// useMenuVersionRefetch — meniul QR refăcut la revenirea în tab DOAR când
// versiunea s-a schimbat (mig 313, lotul B).
//
//   MV1  versiunea de bază se citește la montare; revenirea în tab cu ACEEAȘI
//        versiune NU reface meniul (fără refetch complet la fiecare revenire);
//        cu o versiune NOUĂ îl reface o dată, iar o a doua revenire pe aceeași
//        versiune nouă nu-l mai reface (baza s-a mutat). Mutația care pică:
//        `onChanged` chemat necondiționat la `visibilitychange`, sau baza
//        nemutată după refetch (refetch la fiecare revenire de acum încolo).
//   MV2  sonda picată (`null`) NU reface meniul; tab ascuns nu întreabă deloc.
//        Mutația care pică: `null` tratat ca schimbare, sau filtrul
//        `visibilityState === 'visible'` scos.
//   MV3  la demontare ascultătorul e scos (nicio sondă după unmount).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const m = vi.hoisted(() => ({ fetchVersion: vi.fn() }))

vi.mock('../../lib/menuVersion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/menuVersion')>()
  return { ...actual, fetchMenuVersion: m.fetchVersion }
})

import { useMenuVersionRefetch } from '../useMenuVersionRefetch'

let visibility: DocumentVisibilityState = 'visible'

// Un macrotask golește TOATE microtask-urile (sonda + then + finally).
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

async function returnToTab(state: DocumentVisibilityState = 'visible'): Promise<void> {
  visibility = state
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
  })
}

beforeEach(() => {
  m.fetchVersion.mockReset()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

describe('useMenuVersionRefetch', () => {
  it('MV1 aceeași versiune → nimic; versiune nouă → un singur refetch', async () => {
    const onChanged = vi.fn()
    m.fetchVersion.mockResolvedValue('v1')
    renderHook(() => useMenuVersionRefetch('r1', onChanged))
    await act(async () => {
      await flush()
    })
    expect(m.fetchVersion).toHaveBeenCalledWith('r1')

    await returnToTab()
    expect(m.fetchVersion).toHaveBeenCalledTimes(2)
    expect(onChanged).not.toHaveBeenCalled()

    m.fetchVersion.mockResolvedValue('v2')
    await returnToTab()
    expect(onChanged).toHaveBeenCalledTimes(1)

    await returnToTab()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('MV2 sonda picată nu reface; tab ascuns nu întreabă', async () => {
    const onChanged = vi.fn()
    m.fetchVersion.mockResolvedValue('v1')
    renderHook(() => useMenuVersionRefetch('r1', onChanged))
    await act(async () => {
      await flush()
    })

    m.fetchVersion.mockResolvedValue(null)
    await returnToTab()
    expect(onChanged).not.toHaveBeenCalled()

    const calls = m.fetchVersion.mock.calls.length
    await returnToTab('hidden')
    expect(m.fetchVersion).toHaveBeenCalledTimes(calls)
  })

  it('MV3 după demontare nu mai întreabă', async () => {
    m.fetchVersion.mockResolvedValue('v1')
    const { unmount } = renderHook(() => useMenuVersionRefetch('r1', vi.fn()))
    await act(async () => {
      await flush()
    })
    unmount()
    const calls = m.fetchVersion.mock.calls.length
    await returnToTab()
    expect(m.fetchVersion).toHaveBeenCalledTimes(calls)
  })
})
