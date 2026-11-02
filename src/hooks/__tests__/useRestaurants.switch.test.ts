// useRestaurants — lista aparține contului curent, din PRIMA randare
// (recenzie CodeRabbit pe #331). La o schimbare directă de cont (A → B, fără
// delogare între ele), resetul din `load` rulează abia în efect, deci fără
// mascare prima randare cu B întorcea încă restaurantele lui A, iar AppRouter
// le putea randa în panoul lui B.
//
//   RW1  nicio randare cu userul B nu conține restaurantul lui A, iar până
//        la încărcarea lui B starea e „se încarcă”, nu „listă goală”
//        (mutație: ieșirea nemascată → pică pe prima randare cu B)
//   RW2  control: după încărcare, B își vede restaurantul
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  owned: {
    'user-a': [{ id: 'r-a', name: 'Restaurantul lui A', owner_id: 'user-a' }],
    'user-b': [{ id: 'r-b', name: 'Restaurantul lui B', owner_id: 'user-b' }],
  } as Record<string, Array<{ id: string; name: string; owner_id: string }>>,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: m.user }),
}))
vi.mock('../../lib/founder', () => ({ getFounderView: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, uid: string) =>
          table === 'restaurants'
            ? { order: () => Promise.resolve({ data: m.owned[uid] ?? [], error: null }) }
            : { neq: () => Promise.resolve({ data: [], error: null }) },
      }),
    }),
  },
}))

import { useRestaurants } from '../useData'

describe('useRestaurants — schimbare directă de cont', () => {
  it('RW1–RW2: lista lui A nu ajunge niciodată în randările lui B', async () => {
    const renders: Array<{ uid: string | null; ids: string[]; loading: boolean }> = []
    const { result, rerender } = renderHook(() => {
      const r = useRestaurants()
      renders.push({
        uid: m.user?.id ?? null,
        ids: r.restaurants.map((x) => x.id),
        loading: r.loading,
      })
      return r
    })
    await waitFor(() => expect(result.current.restaurants.map((r) => r.id)).toEqual(['r-a']))

    m.user = { id: 'user-b' }
    rerender()
    await waitFor(() => expect(result.current.restaurants.map((r) => r.id)).toEqual(['r-b']))

    const asB = renders.filter((r) => r.uid === 'user-b')
    expect(asB.length).toBeGreaterThan(0)
    for (const r of asB) expect(r.ids, 'randare cu B').not.toContain('r-a')
    // Prima randare cu B: se încarcă, fără listă — nu „zero restaurante”.
    expect(asB[0]).toEqual({ uid: 'user-b', ids: [], loading: true })
    expect(result.current.loading).toBe(false)
  })
})
