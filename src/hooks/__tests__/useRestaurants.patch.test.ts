// useRestaurants — harta sălii nu mai trece prin `update()` (mig 322).
// Harta se scrie DOAR prin RPC-ul `save_floor_layout`; editorul o aplică apoi
// local prin `patchLocal`, iar salvarea din Setări (rândul întreg, încărcat la
// montare) nu mai cară `floor_layout` în PATCH.
//
//   UP1  patchLocal aplică patch-ul DOAR pe restaurantul cerut: harta lui r-a
//        devine cea nouă, r-b rămâne ACELAȘI obiect (`toBe`). Control pozitiv:
//        înainte de patch, r-a are harta veche. Mutația care pică: patchLocal
//        no-op, sau un merge care înlocuiește rândul cu patch-ul (pierde
//        restul câmpurilor — `name` dispare).
//   UP2  update() cu un rând VECHI din Setări (harta veche + wifi nou): PATCH-ul
//        trimis are wifi_password (control) și NU are cheia floor_layout; după
//        merge, rândul local e cel întors de server (harta NOUĂ, nu cea veche).
//        Mutația care pică: 'floor_layout' readus în RESTAURANT_UPDATE_FIELDS
//        (PATCH-ul cară harta veche, iar serverul o scrie peste cea nouă).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Restaurant } from '../useData'

const OLD: Record<string, unknown> = { floors: [{ id: 'OLD' }], version: 1 }
const NEW: Record<string, unknown> = { floors: [{ id: 'NEW' }], version: 1 }

const m = vi.hoisted(() => ({
  // Obiect STABIL: `load` depinde de `user`; un obiect nou la fiecare randare
  // ar re-porni încărcarea la nesfârșit și ar rescrie lista peste patch.
  user: { id: 'u1' },
  owned: [] as Array<Record<string, unknown>>,
  // Rândul din bază la momentul PATCH-ului (harta salvată între timp prin RPC).
  serverRow: {} as Record<string, unknown>,
  payloads: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: m.user }) }))
vi.mock('../../lib/founder', () => ({ getFounderView: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === 'restaurants'
            ? { order: () => Promise.resolve({ data: m.owned, error: null }) }
            : { neq: () => Promise.resolve({ data: [], error: null }) },
      }),
      // PostgREST scrie exact cheile din corp: rândul întors = baza + payload.
      update: (payload: Record<string, unknown>) => {
        m.payloads.push(payload)
        return {
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { ...m.serverRow, ...payload }, error: null }),
            }),
          }),
        }
      },
    }),
  },
}))

import { useRestaurants } from '../useData'

beforeEach(() => {
  m.owned = [
    { id: 'r-a', name: 'Local A', owner_id: 'u1', floor_layout: OLD, wifi_password: 'vechi' },
    { id: 'r-b', name: 'Local B', owner_id: 'u1', floor_layout: null, wifi_password: null },
  ]
  m.serverRow = { id: 'r-a', name: 'Local A', owner_id: 'u1', floor_layout: NEW, wifi_password: 'vechi' }
  m.payloads = []
})

describe('useRestaurants — harta sălii (mig 322)', () => {
  it('UP1: patchLocal aplică harta salvată doar pe restaurantul cerut', async () => {
    const { result } = renderHook(() => useRestaurants())
    await waitFor(() => expect(result.current.restaurants).toHaveLength(2))
    const before = result.current.restaurants
    // Control pozitiv: lista încărcată are harta veche.
    expect(before[0].floor_layout).toEqual(OLD)

    act(() => {
      result.current.patchLocal('r-a', { floor_layout: NEW })
    })

    const after = result.current.restaurants
    expect(after[0].floor_layout).toEqual(NEW)
    // Restul câmpurilor rămân (merge, nu înlocuire).
    expect(after[0].name).toBe('Local A')
    expect(after[0].wifi_password).toBe('vechi')
    // Celălalt restaurant e neatins — același obiect.
    expect(after[1]).toBe(before[1])
  })

  it('UP2: salvarea din Setări nu mai trimite harta, iar rândul local devine cel al serverului', async () => {
    const { result } = renderHook(() => useRestaurants())
    await waitFor(() => expect(result.current.restaurants).toHaveLength(2))

    // Formularul din Setări: rândul de la montare (harta VECHE) + wifi nou.
    const staleForm: Partial<Restaurant> = {
      ...(m.owned[0] as unknown as Partial<Restaurant>),
      wifi_password: 'nou',
    }
    await act(async () => {
      await result.current.update('r-a', staleForm)
    })

    expect(m.payloads).toHaveLength(1)
    const payload = m.payloads[0]
    expect(payload.wifi_password).toBe('nou')
    expect(Object.prototype.hasOwnProperty.call(payload, 'floor_layout')).toBe(false)
    const local = result.current.restaurants.find((r) => r.id === 'r-a')
    expect(local?.floor_layout).toEqual(NEW)
    expect(local?.wifi_password).toBe('nou')
  })
})
