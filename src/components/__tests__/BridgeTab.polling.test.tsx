// BridgeTab — ce cere ecranul casei de marcat și CÂND (perf-staff-5).
//
//   BP1  nicio citire nu cere `*`, `device_secret` sau `payload` — ecranul nu
//        afișează nici secretul device-ului, nici payload-urile FiscalNet/ESC-POS
//        Mutația care pică: `select('*')` readus pe bridge_devices/pending_receipts.
//   BP2  tier 2 (fără fiscal): nu se cer nici bonurile, nici cotele TVA
//        Mutația care pică: interogările fiscale necondiționate.
//   BP3  cotele TVA (configurare) se citesc la montare, NU la fiecare 15 s
//        Mutația care pică: `vat_rates` în reîmprospătarea live.
//   BP4  cu fila ascunsă nu pleacă nicio cerere; la revenire se citește imediat
//        Mutația care pică: `setInterval` simplu în locul lui usePollWhileVisible.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

interface Read {
  table: string
  columns: string
}

const { calls } = vi.hoisted(() => ({ calls: [] as Read[] }))

// Builder thenable minimal care ÎNREGISTREAZĂ tabela și coloanele cerute.
vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'order', 'limit', 'delete', 'update', 'insert']) {
      b[m] = vi.fn(() => b)
    }
    b.select = vi.fn((columns: string) => {
      calls.push({ table, columns })
      return b
    })
    b.then = (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
    return b
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)), rpc: vi.fn() } }
})

import BridgeTab from '../BridgeTab'

let visibility: 'visible' | 'hidden' = 'visible'
function setVisibility(v: 'visible' | 'hidden'): void {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

function readsOf(table: string): number {
  return calls.filter((c: Read) => c.table === table).length
}

// Doar cronometrul periodic e fals (setInterval): findBy*/waitFor și acest
// flush au nevoie de setTimeout REAL — lasă încărcarea să se așeze în act().
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mounted(fiscal: boolean): Promise<void> {
  render(<BridgeTab restaurantId="r1" fiscalEnabled={fiscal} />)
  await screen.findByRole('heading', {
    level: 1,
    name: fiscal ? 'Casă de marcat & tichete' : 'Tichete bucătărie',
  })
}

beforeEach(() => {
  calls.length = 0
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('BridgeTab — citiri explicite și doar cu fila vizibilă', () => {
  it('BP1: nicio citire nu aduce `*`, device_secret sau payload', async () => {
    await mounted(true)
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    await flush()

    const tables = new Set(calls.map((c: Read) => c.table))
    // Anti-vacuitate: toate cele patru surse chiar au fost citite.
    expect(tables).toEqual(
      new Set(['bridge_devices', 'pending_receipts', 'vat_rates', 'kitchen_tickets']),
    )
    for (const c of calls) {
      expect(c.columns, c.table).not.toMatch(/\*/)
      expect(c.columns, c.table).not.toMatch(/device_secret|payload/)
    }
  })

  it('BP2: fără fiscal nu se cer bonurile și nici cotele TVA', async () => {
    await mounted(false)
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    await flush()
    expect(readsOf('bridge_devices')).toBe(2)
    expect(readsOf('kitchen_tickets')).toBe(2)
    expect(readsOf('pending_receipts')).toBe(0)
    expect(readsOf('vat_rates')).toBe(0)
  })

  it('BP3: cotele TVA se citesc o dată la montare, nu la fiecare reîmprospătare', async () => {
    await mounted(true)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(15_000)
      })
      await flush()
    }
    // Starea live: montare + 3 tick-uri.
    expect(readsOf('bridge_devices')).toBe(4)
    expect(readsOf('pending_receipts')).toBe(4)
    expect(readsOf('vat_rates')).toBe(1)
  })

  it('BP4: fila ascunsă = zero cereri; revenirea citește imediat', async () => {
    await mounted(true)
    expect(readsOf('bridge_devices')).toBe(1)

    act(() => setVisibility('hidden'))
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    await flush()
    expect(readsOf('bridge_devices')).toBe(1)
    expect(readsOf('pending_receipts')).toBe(1)

    act(() => setVisibility('visible'))
    await flush()
    expect(readsOf('bridge_devices')).toBe(2)
    expect(readsOf('pending_receipts')).toBe(2)
  })
})
