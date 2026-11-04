// useProducts / useCategories — o scriere refuzată de RLS NU dă eroare
// (PostgREST: 200, zero rânduri). Scrierile numără rândurile, deci refuzul
// ajunge la om ca „Nu ai drepturi…", nu ca „Șters" sau ca PGRST116 în engleză.
//
//   ZD1  remove pe produs și pe categorie, 0 rânduri → eroare de drepturi; un
//        rând → fără eroare (control). Mutația care pică: `.delete().eq(...)`
//        fără `.select('id')` și fără numărare (codul vechi întorcea `error: null`).
//   ZD2  toggleSoldOut / toggleActive / toggleDailySpecial, 0 rânduri → eroare
//        de drepturi (cod 42501), NU PGRST116; cu un rând, rândul se întoarce
//        (control). Mutația care pică: `.single()` readus pe oricare dintre ele
//        (mock-ul nu-l are — ar arunca), sau `return r` fără zeroRowsAsDenied.
//        toggleSoldOut trece aici pe UPDATE-ul direct fiindcă RPC-ul din mig
//        313 răspunde PGRST202 (bază fără migrație — fallback-ul de deploy).
//   ZD3  toggleSoldOut pe o bază CU mig 313: cheamă `set_product_sold_out` cu
//        starea inversă, contopește sursa întoarsă în rând (fără UPDATE direct)
//        și dă refuzul serverului (42501) ca eroare de drepturi. Mutația care
//        pică: toggleSoldOut readus pe `toggleProductFlag` direct (rpc nechemat,
//        sursa lipsă din rând), sau fallback-ul pe UPDATE luat pe ORICE eroare
//        (refuzul 42501 ar deveni un UPDATE direct, interzis ospătarului).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const m = vi.hoisted(() => ({
  rows: [] as unknown[],
  list: [] as unknown[],
  rpc: vi.fn(),
  updates: 0,
}))

interface ListQuery {
  order: () => ListQuery
  then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise<unknown>
}

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/founder', () => ({ getFounderView: () => null }))
vi.mock('../../lib/supabase', () => {
  function listQuery(): ListQuery {
    const q: ListQuery = {
      order: () => q,
      then: (resolve) => Promise.resolve({ data: m.list, error: null }).then(resolve),
    }
    return q
  }
  // Fiecare scriere se termină în `.select(...)` (fără `.single()`).
  const write = () => ({
    eq: () => ({ select: () => Promise.resolve({ data: m.rows, error: null }) }),
  })
  const update = () => {
    m.updates += 1
    return write()
  }
  return {
    supabase: {
      from: () => ({
        // Citirea listei: `.order(...)` se înlănțuie (produsele se ordonează pe
        // poziție, apoi pe nume — lotul O5b), iar capătul e thenable.
        select: () => ({ eq: () => listQuery() }),
        delete: write,
        update,
      }),
      rpc: m.rpc,
    },
  }
})

import { useCategories, useProducts } from '../useData'
import { toUserMessage, MSG_NO_PERMISSION } from '../../lib/userMessages'

const ROW = { id: 'p1', name: 'Supă', display_order: 0, is_sold_out: true }

beforeEach(() => {
  m.rows = []
  m.list = []
  m.updates = 0
  // Implicit: bază fără mig 313 — RPC-ul lipsește, toggleSoldOut cade pe UPDATE.
  m.rpc.mockReset()
  m.rpc.mockResolvedValue({ data: null, error: { message: 'not found', code: 'PGRST202' } })
})

describe('useData — scrierile refuzate de RLS', () => {
  it('ZD1 remove: 0 rânduri = refuz; un rând = ok', async () => {
    const products = renderHook(() => useProducts('r1'))
    const categories = renderHook(() => useCategories('r1'))
    await waitFor(() => expect(products.result.current.loading).toBe(false))
    await waitFor(() => expect(categories.result.current.loading).toBe(false))

    let res: { error: unknown } = { error: null }
    await act(async () => {
      res = await products.result.current.remove('p1')
    })
    expect(toUserMessage(res.error)).toBe(MSG_NO_PERMISSION)
    await act(async () => {
      res = await categories.result.current.remove('c1')
    })
    expect(toUserMessage(res.error)).toBe(MSG_NO_PERMISSION)

    m.rows = [{ id: 'p1' }]
    await act(async () => {
      res = await products.result.current.remove('p1')
    })
    expect(res.error).toBeNull()
  })

  it('ZD2 toggle-urile: 0 rânduri = 42501, nu PGRST116; un rând se întoarce', async () => {
    const { result } = renderHook(() => useProducts('r1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    for (const toggle of ['toggleSoldOut', 'toggleActive', 'toggleDailySpecial'] as const) {
      let res: { data: unknown; error: { code: string } | null } = { data: null, error: null }
      m.rows = []
      await act(async () => {
        res = await result.current[toggle]('p1', false)
      })
      expect(res.error?.code, toggle).toBe('42501')
      expect(toUserMessage(res.error), toggle).toBe(MSG_NO_PERMISSION)

      m.rows = [ROW]
      await act(async () => {
        res = await result.current[toggle]('p1', false)
      })
      expect(res.error, toggle).toBeNull()
      expect(res.data, toggle).toEqual(ROW)
    }
  })

  it('ZD3 toggleSoldOut pe RPC: sursa contopită, refuzul serverului = 42501', async () => {
    m.list = [{ ...ROW, is_sold_out: false }]
    const { result } = renderHook(() => useProducts('r1'))
    await waitFor(() => expect(result.current.products).toHaveLength(1))

    m.rpc.mockResolvedValue({
      data: { ok: true, product_id: 'p1', is_sold_out: true, sold_out_source: 'manual' },
      error: null,
    })
    m.updates = 0
    let res: { data: { is_sold_out?: boolean; sold_out_source?: unknown } | null; error: unknown } =
      { data: null, error: null }
    await act(async () => {
      res = await result.current.toggleSoldOut('p1', false)
    })
    expect(m.rpc).toHaveBeenCalledWith('set_product_sold_out', {
      p_product_id: 'p1',
      p_sold_out: true,
    })
    expect(m.updates).toBe(0)
    expect(res.error).toBeNull()
    expect(res.data?.is_sold_out).toBe(true)
    expect(res.data?.sold_out_source).toBe('manual')

    m.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Nu ai acces la acest produs.', code: '42501', hint: 'not_member' },
    })
    await act(async () => {
      res = await result.current.toggleSoldOut('p1', true)
    })
    expect(m.updates).toBe(0)
    expect(toUserMessage(res.error)).toBe(MSG_NO_PERMISSION)
  })
})
