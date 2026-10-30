// Helperii puri de interfață ai meniurilor oaspetelui (src/lib/menuUi.ts).
//
//   BL1  bara de coș goală → doar eticheta de bază (nimic inventat).
//   BL2  bara cu produse → numărul, pluralul și totalul intră în numele
//        accesibil, în limba oaspetelui (ux-guest-12: aria-label-ul era FIX
//        „Comanda mea", deci cititorul de ecran nu afla nimic din coș).
//   BL3  ținta de derulare la schimbarea categoriei (ux-guest-6): lista deja
//        vizibilă → nu mișcăm; lista urcată sub bară → exact sub bară.
//   BL4  prefetch-ul chunk-urilor după primul paint (perf-guest-5): rulează pe
//        fallback-ul setTimeout, NU rulează pe Save-Data, anularea îl oprește.
//   BL5  un chunk care pică nu oprește restul și nu scapă ca respingere neprinsă.
//
// Mutații care pică: cartBarLabel care întoarce mereu baza → BL2; fără ramura
// `listTop >= stickyBottom` → BL3; fără gardă pe saveData → BL4; fără `.catch`
// pe import → BL5 (respingere neprinsă).
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  cartBarLabel,
  listScrollTarget,
  prefetchOnIdle,
  CATEGORY_TABS_HEIGHT,
  PREFETCH_FALLBACK_DELAY_MS,
} from '../menuUi'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'connection')
})

describe('cartBarLabel', () => {
  it('BL1 coș gol → doar eticheta de bază', () => {
    expect(cartBarLabel('ro', 'my_order', 0, '0,00 lei')).toBe('Comanda mea')
    expect(cartBarLabel('de', 'my_list', 0, '0,00 lei')).toBe('Meine Liste')
  })

  it('BL2 cu produse → număr, plural și total, în limba oaspetelui', () => {
    expect(cartBarLabel('ro', 'my_order', 1, '12,00 lei')).toBe('Comanda mea · 1 produs · 12,00 lei')
    expect(cartBarLabel('ro', 'my_order', 3, '36,00 lei')).toBe(
      'Comanda mea · 3 produse · 36,00 lei',
    )
    expect(cartBarLabel('en', 'my_list', 2, '€9.00')).toBe('My list · 2 items · €9.00')
  })
})

describe('listScrollTarget', () => {
  it('BL3 lista vizibilă → null; lista urcată → exact sub bara de categorii', () => {
    // Oaspetele e sus: lista începe la 400px, sub bară → nu mișcăm pagina.
    expect(listScrollTarget(400, 0, 56)).toBeNull()
    // Derulat 1200px, lista a urcat la -800px → ținta o aduce la 56px de sus.
    expect(listScrollTarget(-800, 1200, 56)).toBe(1200 - 800 - 56)
    // Fallback-ul pe constanta barei și podeaua la 0.
    expect(listScrollTarget(10, 20)).toBe(Math.max(0, 20 + 10 - CATEGORY_TABS_HEIGHT))
    expect(listScrollTarget(Number.NaN, 0)).toBeNull()
  })
})

describe('prefetchOnIdle', () => {
  it('BL4 rulează pe fallback-ul setTimeout; nu pe Save-Data; anularea îl oprește', () => {
    vi.useFakeTimers()
    // jsdom n-are requestIdleCallback; îl fixăm explicit ca testul să nu depindă de versiune.
    vi.stubGlobal('requestIdleCallback', undefined)

    const a = vi.fn(() => Promise.resolve())
    prefetchOnIdle([a])
    expect(a).not.toHaveBeenCalled() // nu în primul paint
    vi.advanceTimersByTime(PREFETCH_FALLBACK_DELAY_MS)
    expect(a).toHaveBeenCalledTimes(1)

    const b = vi.fn(() => Promise.resolve())
    const cancel = prefetchOnIdle([b])
    cancel()
    vi.advanceTimersByTime(PREFETCH_FALLBACK_DELAY_MS * 2)
    expect(b).not.toHaveBeenCalled()

    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true })
    const c = vi.fn(() => Promise.resolve())
    prefetchOnIdle([c])
    vi.advanceTimersByTime(PREFETCH_FALLBACK_DELAY_MS * 2)
    expect(c).not.toHaveBeenCalled()
  })

  it('BL5 un chunk care pică nu oprește restul și nu scapă neprins', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const failing = vi.fn(() => Promise.reject(new Error('ChunkLoadError')))
    const throwing = vi.fn((): Promise<unknown> => {
      throw new Error('sync')
    })
    const ok = vi.fn(() => Promise.resolve())
    prefetchOnIdle([failing, throwing, ok])
    vi.advanceTimersByTime(PREFETCH_FALLBACK_DELAY_MS)
    expect(failing).toHaveBeenCalledTimes(1)
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
    // O respingere neprinsă ar fi raportată de vitest ca „Unhandled Rejection"
    // și ar pica rularea — lăsăm microtask-urile să se termine aici.
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 0))
  })
})
