// Starea codului de agent de pe formularul de înscriere (mig 301).
//
//   UA1  pe „Autentificare" (enabled=false) nu se citește cookie-ul și nu se
//        cheamă serverul — patronii care doar se loghează nu sunt atinși
//   UA2  fără cod în cookie → fără banner, nimic de trimis
//   UA3  cod din cookie VERIFICAT de server → banner (verifiedLinkCode) și codul
//        canonic pleacă la înscriere
//   UA4  cod din cookie pe care serverul îl declară inexistent → fără banner și
//        NU pleacă (un cookie vechi/stricat nu strică înscrierea)
//   UA5  verificare eșuată (rețea / DB fără 295) → fără banner, dar codul din
//        cookie PLEACĂ — serverul rămâne autoritatea; atribuirea nu se pierde
//        tăcut pe un blip
//   UA6  „Nu e agentul meu" → codul din link nu mai pleacă
//   UA8  cod tastat ÎNAINTE ca verificarea link-ului să se întoarcă `valid`:
//        câmpul se demontează (apare bannerul) și valoarea ascunsă NU bate codul
//        verificat din link, nici nu lasă un mesaj de problemă în câmpul ascuns;
//        după „Nu e agentul meu" câmpul reapare și tastatul contează iar
//   UA7  cod TASTAT (după dismiss, câmp vizibil): bate link-ul; formă proastă → problem 'shape', fără apel;
//        „nu există" → problem 'unknown'; schimbarea textului șterge mesajul
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { rpcMock, storedMock, pendingMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  storedMock: vi.fn(),
  pendingMock: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('../../lib/affiliate', () => ({
  getStoredReferral: () => storedMock(),
  resolvePendingReferral: () => pendingMock(),
}))

import { useSignupAgentCode } from '../useSignupAgentCode'
import type { SubmitAgentCode } from '../../lib/agentCode'

// Lasă promisiunile și macrotask-ul curent să se termine (lookup → setState).
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// resolveForSubmit actualizează state (problem) → îl rulăm în act.
async function submit(
  hook: { current: { resolveForSubmit: () => Promise<SubmitAgentCode> } },
): Promise<SubmitAgentCode | null> {
  let res: SubmitAgentCode | null = null
  await act(async () => {
    res = await hook.current.resolveForSubmit()
  })
  return res
}

function serverKnows(map: Record<string, string | null>) {
  rpcMock.mockImplementation((_fn: string, args: { p_code: string }) =>
    Promise.resolve({
      data: { referral_code: Object.prototype.hasOwnProperty.call(map, args.p_code) ? map[args.p_code] : null },
      error: null,
    }),
  )
}

beforeEach(() => {
  rpcMock.mockReset()
  storedMock.mockReset().mockReturnValue(null)
  pendingMock.mockReset().mockResolvedValue(undefined)
})

describe('useSignupAgentCode', () => {
  it('UA1 pe login (enabled=false) nu citește cookie-ul și nu cheamă serverul', async () => {
    storedMock.mockReturnValue('k7m2xq9')
    const { result } = renderHook(() => useSignupAgentCode(false))
    await flush()
    expect(storedMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(result.current.verifiedLinkCode).toBeNull()
    expect(await submit(result)).toEqual({ ok: true, code: null })
  })

  it('UA2 fără cod în cookie → fără banner, nimic de trimis', async () => {
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(pendingMock).toHaveBeenCalled())
    expect(result.current.verifiedLinkCode).toBeNull()
    expect(await submit(result)).toEqual({ ok: true, code: null })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('UA3 cod verificat → banner și codul pleacă', async () => {
    storedMock.mockReturnValue('k7m2xq9')
    serverKnows({ k7m2xq9: 'k7m2xq9' })
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(result.current.verifiedLinkCode).toBe('k7m2xq9'))
    expect(await submit(result)).toEqual({ ok: true, code: 'k7m2xq9' })
  })

  it('UA4 cod din cookie inexistent pe server → fără banner, nu pleacă', async () => {
    storedMock.mockReturnValue('vechi123')
    serverKnows({})
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    await flush()
    expect(result.current.verifiedLinkCode).toBeNull()
    expect(await submit(result)).toEqual({ ok: true, code: null })
  })

  it('UA5 verificare eșuată → fără banner, dar codul din cookie pleacă', async () => {
    storedMock.mockReturnValue('k7m2xq9')
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network' } })
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    await flush()
    expect(result.current.verifiedLinkCode).toBeNull()
    expect(await submit(result)).toEqual({ ok: true, code: 'k7m2xq9' })
  })

  it('UA6 „Nu e agentul meu" → codul din link nu mai pleacă', async () => {
    storedMock.mockReturnValue('k7m2xq9')
    serverKnows({ k7m2xq9: 'k7m2xq9' })
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(result.current.verifiedLinkCode).toBe('k7m2xq9'))
    act(() => result.current.dismissLink())
    expect(result.current.dismissed).toBe(true)
    expect(await submit(result)).toEqual({ ok: true, code: null })
  })

  it('UA7 codul tastat: bate link-ul; formă proastă / inexistent opresc formularul', async () => {
    storedMock.mockReturnValue('k7m2xq9')
    serverKnows({ k7m2xq9: 'k7m2xq9', 'ion-pop': 'p4q8rt2' })
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(result.current.verifiedLinkCode).toBe('k7m2xq9'))

    act(() => result.current.openField())
    expect(result.current.fieldOpen).toBe(true)

    // Cât bannerul e afișat, câmpul tastat e ascuns (AuthPage) -> ce e in state nu
    // bate codul verificat din link (UA8 acoperă cazul detaliat).
    act(() => result.current.setTyped('  Ion-Pop '))
    expect(await submit(result)).toEqual({ ok: true, code: 'k7m2xq9' })

    // Dupa dismiss (Nu e agentul meu) câmpul e vizibil din nou; vanity tastat ->
    // codul canonic al LUI, în locul celui din link.
    act(() => result.current.dismissLink())
    expect(await submit(result)).toEqual({ ok: true, code: 'p4q8rt2' })

    // formă proastă → fără apel suplimentar, mesaj
    rpcMock.mockClear()
    act(() => result.current.setTyped("a'b"))
    expect(await submit(result)).toEqual({ ok: false, problem: 'shape' })
    expect(result.current.problem).toBe('shape')
    expect(rpcMock).not.toHaveBeenCalled()

    // inexistent → mesaj
    act(() => result.current.setTyped('nuexista'))
    expect(await submit(result)).toEqual({ ok: false, problem: 'unknown' })
    expect(result.current.problem).toBe('unknown')

    // schimbarea textului șterge mesajul
    act(() => result.current.setTyped('nuexista2'))
    expect(result.current.problem).toBeNull()
  })

  it('UA8 tastat înainte de verificarea link-ului: codul verificat din link câștigă, fără mesaj ascuns', async () => {
    storedMock.mockReturnValue('k7m2xq9')
    let release: (v: { data: unknown; error: null }) => void = () => undefined
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const { result } = renderHook(() => useSignupAgentCode(true))
    await waitFor(() => expect(rpcMock).toHaveBeenCalled())

    // Verificarea link-ului încă nu s-a întors: câmpul e vizibil, omul tastează
    // un cod cu formă proastă și încearcă să trimită → mesaj în câmp.
    act(() => result.current.openField())
    act(() => result.current.setTyped("a'b"))
    expect(await submit(result)).toEqual({ ok: false, problem: 'shape' })
    expect(result.current.problem).toBe('shape')

    // Acum link-ul se verifică: apare bannerul, câmpul se demontează.
    await act(async () => {
      release({ data: { referral_code: 'k7m2xq9' }, error: null })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.verifiedLinkCode).toBe('k7m2xq9'))
    expect(result.current.problem).toBeNull()

    // Valoarea ascunsă nu suprascrie codul verificat și nu oprește formularul.
    expect(await submit(result)).toEqual({ ok: true, code: 'k7m2xq9' })
    expect(result.current.problem).toBeNull()

    // „Nu e agentul meu": câmpul reapare, iar ce e tastat contează din nou.
    act(() => result.current.dismissLink())
    expect(await submit(result)).toEqual({ ok: false, problem: 'shape' })
  })
})
