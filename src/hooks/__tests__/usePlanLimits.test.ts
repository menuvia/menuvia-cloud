// usePlanLimits (code-health-plan-limits-fallback-unpinned): fallback-ul offline
// era o a treia copie scrisă de mână a limitelor, nelegată de nimic, iar
// rezultatul hook-ului ținea de răspunsul care sosea ULTIMUL, nu de planul cerut.
// Aici: citirea tabelei EȘUEAZĂ mereu (cache-ul de modul rămâne gol), deci se
// vede fallback-ul. Cursa și rândurile din DB sunt în usePlanLimits.race.test.ts
// (fișier separat = modul proaspăt, fără vi.resetModules peste React).
//
//   PLT1  fallback-ul == fixtura înghețată PLAN_LIMIT_MATRIX, pe TOATE cele 5
//         planuri (aceeași fixtură pe care PD5 o compară cu DB-ul)
//         Mutația care pică: orice valoare schimbată în fallback (ex. free 15→50,
//         sau starter scris de mână și rămas în urma lui plans.ts).
//   PLT2  plan necunoscut → limitele lui free (cel mai restrictiv)
//         Mutația care pică: fallback pe un plan plătit pentru id necunoscut.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { DB_PLANS, PLAN_LIMIT_MATRIX } from '../../lib/__tests__/planFeatureMatrix.fixture'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: fromMock } }))

import { usePlanLimits } from '../usePlanLimits'

beforeEach(() => {
  fromMock.mockReset()
  fromMock.mockImplementation(() => ({
    select: () => Promise.resolve({ data: null, error: { message: 'offline' } }),
  }))
})

describe('usePlanLimits — fallback-ul e legat de fixtura limitelor din DB', () => {
  it('PLT1: fallback-ul == PLAN_LIMIT_MATRIX pe toate planurile', async () => {
    for (const plan of DB_PLANS) {
      const { result, unmount } = renderHook(() => usePlanLimits(plan))
      await waitFor(() => expect(result.current.loading).toBe(false))
      const l = result.current.limits
      const expectLimit = (actual: number, fixture: number | null, what: string) => {
        if (fixture === null) expect(actual, `${plan} ${what}`).toBeGreaterThanOrEqual(1e9)
        else expect(actual, `${plan} ${what}`).toBe(fixture)
      }
      expectLimit(l.max_products, PLAN_LIMIT_MATRIX.max_products[plan], 'produse')
      expectLimit(l.max_tables, PLAN_LIMIT_MATRIX.max_tables[plan], 'mese')
      expectLimit(l.max_restaurants, PLAN_LIMIT_MATRIX.max_restaurants[plan], 'locații')
      unmount()
    }
    // Anti-vacuitate: citirea chiar a fost încercată (și a eșuat).
    expect(fromMock).toHaveBeenCalled()
  })

  it('PLT2: plan necunoscut → limitele lui free', async () => {
    const { result } = renderHook(() => usePlanLimits('business'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.limits.max_products).toBe(PLAN_LIMIT_MATRIX.max_products.free)
    expect(result.current.canAddProduct(14)).toBe(true)
    expect(result.current.canAddProduct(15)).toBe(false)
  })
})
