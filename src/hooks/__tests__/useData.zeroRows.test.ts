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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const m = vi.hoisted(() => ({ rows: [] as unknown[] }))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/founder', () => ({ getFounderView: () => null }))
vi.mock('../../lib/supabase', () => {
  // Fiecare scriere se termină în `.select(...)` (fără `.single()`).
  const write = () => ({
    eq: () => ({ select: () => Promise.resolve({ data: m.rows, error: null }) }),
  })
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        }),
        delete: write,
        update: write,
      }),
    },
  }
})

import { useCategories, useProducts } from '../useData'
import { toUserMessage, MSG_NO_PERMISSION } from '../../lib/userMessages'

const ROW = { id: 'p1', name: 'Supă', display_order: 0, is_sold_out: true }

beforeEach(() => {
  m.rows = []
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
})
