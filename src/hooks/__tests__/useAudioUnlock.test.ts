// ux-staff-audio-unlock: beep-ul pentru comandă nouă era MUT pe o tabletă KDS
// proaspăt deschisă. Contextul audio se crea abia la primul beep — dintr-un
// eveniment realtime, nu dintr-un gest — deci pornea `suspended`; pe iPad
// (Safari cere `resume()` CHIAR în handler-ul gestului) rămânea mut pentru
// totdeauna. Acum primul gest de pe pagină îl deblochează, iar pagina știe
// cât timp e blocat. jsdom n-are Web Audio: contextul de mai jos e un fals
// cu exact suprafața folosită.
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, fireEvent } from '@testing-library/react'
import { useAudioUnlock } from '../useAudioUnlock'
import { createStaffAudio } from '../../lib/staffAudio'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static initialState: AudioContextState = 'suspended'
  state: AudioContextState = FakeAudioContext.initialState
  currentTime = 0
  destination = {}
  resumeCalls = 0
  oscillators = 0
  private listeners = new Set<() => void>()
  constructor() {
    FakeAudioContext.instances.push(this)
  }
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener)
  }
  // Ca browserul: `resume()` acceptat → starea devine `running` și se emite
  // `statechange`.
  resume(): Promise<void> {
    this.resumeCalls += 1
    this.state = 'running'
    for (const l of this.listeners) l()
    return Promise.resolve()
  }
  createBuffer() {
    return {}
  }
  createBufferSource() {
    return { buffer: null as unknown, connect: vi.fn(), start: vi.fn() }
  }
  createOscillator() {
    this.oscillators += 1
    return { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
}

function freshAudio(initial: AudioContextState = 'suspended') {
  FakeAudioContext.instances = []
  FakeAudioContext.initialState = initial
  return createStaffAudio(() => FakeAudioContext as unknown as new () => AudioContext)
}

describe('useAudioUnlock', () => {
  it('AU1 primul gest de pe pagină deblochează sunetul — resume() rulează ÎN gest', () => {
    // Mutație: fără ascultătorul de gest (comportamentul vechi), resume() se
    // chema doar din beep-ul realtime → AU1 pică pe `resumeCalls`.
    const audio = freshAudio()
    const { result } = renderHook(() => useAudioUnlock(audio))
    expect(result.current.locked).toBe(true)
    const ctx = FakeAudioContext.instances[0]
    expect(ctx.resumeCalls).toBe(0)

    act(() => {
      fireEvent.pointerDown(document.body)
    })
    // Sincron, în handler-ul gestului — exact cerința Safari/iOS.
    expect(ctx.resumeCalls).toBe(1)
    expect(result.current.locked).toBe(false)
  })

  it('AU2 după deblocare beep-ul chiar cântă (oscilator pornit)', () => {
    const audio = freshAudio()
    renderHook(() => useAudioUnlock(audio))
    act(() => {
      fireEvent.click(document.body)
    })
    audio.beep(880, 200)
    expect(FakeAudioContext.instances[0].oscillators).toBe(1)
  })

  it('AU3 context deja pornit (pagina primise un gest, ex. navigare din dashboard) → nu e blocat', () => {
    const audio = freshAudio('running')
    const { result } = renderHook(() => useAudioUnlock(audio))
    expect(result.current.locked).toBe(false)
  })

  it('AU4 browser fără Web Audio → nu e „blocat" (fără banner fals) și beep-ul nu aruncă', () => {
    const audio = createStaffAudio(() => undefined)
    const { result } = renderHook(() => useAudioUnlock(audio))
    expect(result.current.locked).toBe(false)
    expect(() => audio.beep(880, 200)).not.toThrow()
  })

  it('AU5 butonul explicit („Pornește sunetul") deblochează la fel', () => {
    const audio = freshAudio()
    const { result } = renderHook(() => useAudioUnlock(audio))
    act(() => {
      result.current.unlock()
    })
    expect(FakeAudioContext.instances[0].resumeCalls).toBe(1)
    expect(result.current.locked).toBe(false)
  })
})
