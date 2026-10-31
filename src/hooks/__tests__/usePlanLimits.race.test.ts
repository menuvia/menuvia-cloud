// usePlanLimits — rezultatul e legat de planul CERUT, nu de răspunsul sosit
// ultimul (code-health-plan-limits-fallback-unpinned). Fișier separat de
// usePlanLimits.test.ts: cache-ul de modul se umple aici, deci are nevoie de un
// modul proaspăt (izolarea per fișier a vitest), fără vi.resetModules.
//
//   PLT4  planul se schimbă (free → pro → enterprise → pro) cât citirea e în
//         zbor, iar răspunsurile sosesc în ordine INVERSĂ: limitele sunt ale
//         planului curent (pro), din DB
//         Mutația care pică: limitele ținute în state și setate de fiecare
//         citire pornită la schimbarea planului (codul vechi) — răspunsul
//         întârziat pentru free câștigă.
//   PLT5  o singură citire a tabelei, oricâte schimbări de plan
//         Mutația care pică: efectul dependent de `plan` (o citire per plan).
//   PLT3  rândul din DB câștigă peste fallback; un plan LIPSĂ din DB cade pe
//         fallback-ul lui (nu pe free, nu pe al altui plan)
//         Mutația care pică: `fromDb?.[plan] ?? PLAN_LIMITS_FALLBACK.free`.
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { PLAN_LIMIT_MATRIX } from '../../lib/__tests__/planFeatureMatrix.fixture'

interface LimitsRow {
  plan: string
  max_products: number
  max_restaurants: number
  max_tables: number
}
interface Reply {
  data: LimitsRow[] | null
  error: { message: string } | null
}

const { fromMock, pending } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  pending: [] as Array<(r: Reply) => void>,
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from: fromMock } }))

import { usePlanLimits } from '../usePlanLimits'

describe('usePlanLimits — legat de planul cerut', () => {
  it('PLT3–PLT5: cursa de la încărcarea panoului + rândurile din DB', async () => {
    // Fiecare citire rămâne în zbor până o rezolvă testul.
    fromMock.mockImplementation(() => ({
      select: () =>
        new Promise<Reply>((resolve) => {
          pending.push(resolve)
        }),
    }))
    const { result, rerender } = renderHook(({ plan }: { plan: string }) => usePlanLimits(plan), {
      initialProps: { plan: 'free' },
    })
    // Panoul: planul trece din „necunoscut" (free) în cel real.
    rerender({ plan: 'pro' })
    rerender({ plan: 'enterprise' })
    rerender({ plan: 'pro' })

    const rows: LimitsRow[] = [
      { plan: 'free', max_products: 15, max_restaurants: 1, max_tables: 3 },
      { plan: 'pro', max_products: 2222, max_restaurants: 2, max_tables: 555 },
      { plan: 'enterprise', max_products: 1e9, max_restaurants: 1e9, max_tables: 1e9 },
    ]
    // Răspunsurile sosesc în ordine INVERSĂ: cel pornit primul (pentru free) ultimul.
    await act(async () => {
      for (const resolve of [...pending].reverse()) resolve({ data: rows, error: null })
    })

    // PLT4
    expect(result.current.limits.plan).toBe('pro')
    expect(result.current.limits.max_products).toBe(2222)
    // PLT5
    expect(fromMock).toHaveBeenCalledTimes(1)

    // PLT3: `growth` lipsește din DB → fallback-ul LUI (din plans.ts == fixtura).
    rerender({ plan: 'growth' })
    expect(result.current.limits.max_products).toBe(PLAN_LIMIT_MATRIX.max_products.growth)
    expect(result.current.limits.max_tables).toBe(PLAN_LIMIT_MATRIX.max_tables.growth)
    // Și înapoi pe un plan din DB, fără o citire nouă.
    rerender({ plan: 'pro' })
    expect(result.current.limits.max_tables).toBe(555)
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})
