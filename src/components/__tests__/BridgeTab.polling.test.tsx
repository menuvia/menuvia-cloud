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
//   BP5  revenirea în filă CHIAR în timpul încărcării inițiale: citirea live o
//        înlocuiește (guard de secvență), dar maparea TVA nu se pierde — modalul
//        arată grupele, nu „Nu ai cote TVA configurate încă"
//        Mutația care pică: cotele cerute doar pe `opts.withConfig === true`
//        (răspunsul încărcării inițiale e aruncat, iar cea live nu le cere).
//   BP6  citirea cotelor eșuează la montare → următoarea reîmprospătare le
//        recitește (o singură dată), modalul arată grupele
//        Mutația care pică: aceeași — eroarea lăsa `vatRates` gol până la remontare.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

interface Read {
  table: string
  columns: string
}

interface Reply {
  data: unknown[] | null
  error: { message: string } | null
}

const { calls, rows, failOnce, gate } = vi.hoisted(() => ({
  calls: [] as Read[],
  // Rândurile întoarse per tabelă (implicit []).
  rows: {} as Record<string, unknown[]>,
  // Tabelele a căror URMĂTOARE citire eșuează (o singură dată).
  failOnce: new Set<string>(),
  // Cât `held` nu e null, răspunsurile rămân în zbor până le eliberează testul.
  gate: { held: null as Array<() => void> | null },
}))

// Builder thenable minimal care ÎNREGISTREAZĂ tabela și coloanele cerute.
vi.mock('../../lib/supabase', () => {
  function chain(table: string) {
    // Poarta se citește la CONSTRUIREA cererii (sincron, în load()), nu în
    // `.then` — pe acela Promise.all îl cheamă abia într-un microtask.
    const held = gate.held
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'order', 'limit', 'delete', 'update', 'insert']) {
      b[m] = vi.fn(() => b)
    }
    b.select = vi.fn((columns: string) => {
      calls.push({ table, columns })
      return b
    })
    b.then = (onFulfilled: (v: Reply) => unknown, onRejected?: (e: unknown) => unknown) => {
      const fail = failOnce.has(table)
      if (fail) failOnce.delete(table)
      const reply = (): Reply =>
        fail ? { data: null, error: { message: 'boom' } } : { data: rows[table] ?? [], error: null }
      const p = held
        ? new Promise<Reply>((resolve) => {
            held.push(() => resolve(reply()))
          })
        : Promise.resolve(reply())
      return p.then(onFulfilled, onRejected)
    }
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

const VAT_ROWS = [
  { vat_group: 1, rate_percent: 21, label: 'Standard', fiscalnet_group: 1 },
  { vat_group: 2, rate_percent: 11, label: 'Redusă', fiscalnet_group: 2 },
]

// Deschide „Mapare TVA" și verifică faptul că modalul arată grupele reale.
function expectVatMapShowsGroups(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Mapare TVA' }))
  expect(screen.getByText('Mapare grupe TVA → FiscalNet')).toBeInTheDocument()
  expect(screen.queryByText(/Nu ai cote TVA configurate/)).toBeNull()
  expect(screen.getAllByRole('combobox')).toHaveLength(VAT_ROWS.length)
}

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(rows)) delete rows[k]
  failOnce.clear()
  gate.held = null
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

  it('BP5: revenirea în filă în timpul încărcării inițiale nu pierde maparea TVA', async () => {
    rows.vat_rates = VAT_ROWS
    // Încărcarea inițială (cu cotele) rămâne în zbor…
    const held: Array<() => void> = []
    gate.held = held
    render(<BridgeTab restaurantId="r1" fiscalEnabled />)
    expect(readsOf('vat_rates')).toBe(1)

    // …iar fila revine în prim-plan: citirea live o înlocuiește (guard de secvență).
    act(() => {
      setVisibility('hidden')
      setVisibility('visible')
    })
    expect(readsOf('bridge_devices')).toBe(2)
    // Răspunsul încărcării inițiale va fi aruncat → cea live TREBUIE să ceară cotele.
    expect(readsOf('vat_rates')).toBe(2)

    gate.held = null
    // Promise.all cheamă `.then` al fiecărei cereri abia într-un microtask:
    // golim coada (macrotask real) ca TOATE să intre în poartă, apoi le eliberăm.
    await flush()
    // Anti-vacuitate: ambele încărcări (4 + 4 cereri) erau încă în zbor.
    expect(held).toHaveLength(8)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    await act(async () => {
      for (const release of held) release()
    })
    await screen.findByRole('heading', { level: 1, name: 'Casă de marcat & tichete' })
    expectVatMapShowsGroups()
  })

  it('BP6: cotele care n-au putut fi citite la montare se recitesc o dată', async () => {
    rows.vat_rates = VAT_ROWS
    failOnce.add('vat_rates')
    await mounted(true)
    expect(readsOf('vat_rates')).toBe(1)

    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(15_000)
      })
      await flush()
    }
    // Recitite la prima reîmprospătare, apoi nu mai sunt cerute.
    expect(readsOf('vat_rates')).toBe(2)
    expect(readsOf('bridge_devices')).toBe(3)
    expectVatMapShowsGroups()
  })
})
