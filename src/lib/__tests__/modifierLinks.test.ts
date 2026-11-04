// Citirea legăturilor produs ↔ grup pentru Meniu → Opțiuni (recenzia O1b).
//
//   MLK1  peste o pagină de legături (PostgREST taie la max_rows fără eroare)
//         se întorc TOATE, pe pagini. [PICĂ: o singură cerere fără `.range` —
//         fake-ul taie la 1000 ca serverul, deci 1200 → 1000]
//   MLK2  filtrul e pe GRUPURI, în loturi de cel mult 100 de id-uri (lista de
//         produse în URL dădea 414 la ~200 de produse). [PICĂ: `.in('product_id', …)`]
//   MLK3  produsele pentru „Alege produsele” vin tot pe pagini, toate.
//   MLK4  o eroare pe oricare pagină aruncă un `Error` real (tab-ul arată
//         „Nu am putut încărca”, nu o listă incompletă salvabilă).
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Call {
  table: string
  filters: Array<[string, string, unknown]>
  range: [number, number] | null
}

const { state } = vi.hoisted(() => ({
  state: {
    rows: {} as Record<string, Array<Record<string, unknown>>>,
    calls: [] as Call[],
    failOnPage: null as number | null,
  },
}))

vi.mock('../supabase', () => {
  const MAX_ROWS = 1000
  function builder(table: string) {
    const call: Call = { table, filters: [], range: null }
    state.calls.push(call)
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.order = () => b
    b.eq = (col: string, v: unknown) => {
      call.filters.push(['eq', col, v])
      return b
    }
    b.in = (col: string, v: unknown[]) => {
      call.filters.push(['in', col, v])
      return b
    }
    b.range = (from: number, to: number) => {
      call.range = [from, to]
      return b
    }
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const pageIndex = call.range ? call.range[0] / (call.range[1] - call.range[0] + 1) : 0
      if (state.failOnPage !== null && pageIndex === state.failOnPage) {
        return Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } }).then(resolve, reject)
      }
      let rows = state.rows[table] ?? []
      for (const [op, col, v] of call.filters) {
        rows = rows.filter((r) => (op === 'eq' ? r[col] === v : (v as unknown[]).includes(r[col])))
      }
      const [from, to] = call.range ?? [0, rows.length - 1]
      // Ca PostgREST: niciodată mai mult de max_rows, fără eroare.
      const data = rows.slice(from, Math.min(to + 1, from + MAX_ROWS))
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    }
    return b
  }
  return { supabase: { from: (t: string) => builder(t), rpc: vi.fn() } }
})

import { fetchLinkableProducts, fetchModifierGroupLinks, LINK_PAGE_SIZE } from '../modifierLinks'

function links(groups: number, productsPerGroup: number) {
  const out: Array<Record<string, unknown>> = []
  for (let g = 0; g < groups; g++) {
    for (let p = 0; p < productsPerGroup; p++) {
      out.push({ product_id: `p${p}`, modifier_group_id: `g${g}`, display_order: g })
    }
  }
  return out
}

beforeEach(() => {
  state.rows = {}
  state.calls = []
  state.failOnPage = null
})

describe('fetchModifierGroupLinks — toate legăturile, pe grupuri', () => {
  it('MLK1 1200 de legături (peste plafonul de 1000) se întorc toate', async () => {
    state.rows.product_modifier_groups = links(4, 300)
    const got = await fetchModifierGroupLinks(['g0', 'g1', 'g2', 'g3'])
    expect(got).toHaveLength(1200)
    expect(new Set(got.map((l) => `${l.product_id}|${l.modifier_group_id}`)).size).toBe(1200)
    // Pe pagini sub plafon: 500 + 500 + 200.
    expect(state.calls.map((c) => c.range)).toEqual([
      [0, LINK_PAGE_SIZE - 1],
      [LINK_PAGE_SIZE, 2 * LINK_PAGE_SIZE - 1],
      [2 * LINK_PAGE_SIZE, 3 * LINK_PAGE_SIZE - 1],
    ])
  })

  it('MLK2 filtrul e pe grupuri, în loturi de cel mult 100 de id-uri', async () => {
    state.rows.product_modifier_groups = links(250, 1)
    const ids = Array.from({ length: 250 }, (_, i) => `g${i}`)
    const got = await fetchModifierGroupLinks(ids)
    expect(got).toHaveLength(250)
    const inFilters = state.calls.map((c) => c.filters.find((f) => f[0] === 'in'))
    for (const f of inFilters) {
      expect(f?.[1]).toBe('modifier_group_id')
      expect((f?.[2] as unknown[]).length).toBeLessThanOrEqual(100)
    }
    expect(inFilters).toHaveLength(3)
    // Fără grupuri nu pleacă nicio cerere.
    state.calls = []
    expect(await fetchModifierGroupLinks([])).toEqual([])
    expect(state.calls).toHaveLength(0)
  })

  it('MLK4 o pagină picată aruncă, nu întoarce o listă incompletă', async () => {
    state.rows.product_modifier_groups = links(4, 300)
    state.failOnPage = 1
    await expect(fetchModifierGroupLinks(['g0', 'g1', 'g2', 'g3'])).rejects.toThrow('boom')
  })
})

describe('fetchLinkableProducts — toate produsele restaurantului', () => {
  it('MLK3 1100 de produse vin toate, doar ale restaurantului', async () => {
    state.rows.products = [
      ...Array.from({ length: 1100 }, (_, i) => ({ id: `p${i}`, name: `P ${i}`, restaurant_id: 'r1' })),
      { id: 'x', name: 'Al altuia', restaurant_id: 'r2' },
    ]
    const got = await fetchLinkableProducts('r1')
    expect(got).toHaveLength(1100)
    expect(got.some((p) => p.id === 'x')).toBe(false)
    expect(state.calls.every((c) => c.filters.some((f) => f[0] === 'eq' && f[1] === 'restaurant_id'))).toBe(true)
  })
})
