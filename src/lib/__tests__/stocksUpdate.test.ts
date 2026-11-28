// `updateIngredient` (lib/stocks.ts, lotul C4a).
// (Prefixul STK: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte. Randarea e în
// src/components/__tests__/StocksTabEdit.test.tsx, STK3–STK7.)
//   STK1 un UPDATE refuzat de RLS (200 cu ZERO rânduri, fără eroare) e o EROARE
//        de drepturi (42501), nu un succes — fișa nu se mai închide ca și cum
//        s-ar fi salvat. Control pozitiv: un rând întors = succes. Mutația care
//        pică: `.select('id')` / `zeroRowsAsDenied` scoase.
//   STK2 `current_stock` NU pleacă niciodată prin `updateIngredient`, chiar dacă
//        apelantul îl trimite: stocul unui ingredient existent se schimbă doar
//        prin `adjust_stock_manual` (auditat în stock_movements). Restul
//        câmpurilor pleacă. Mutația care pică: `current_stock` adăugat în
//        `INGREDIENT_UPDATE_FIELDS` (scrierea ar ocoli istoricul mișcărilor).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  patches: [] as Record<string, unknown>[],
  selects: [] as string[],
  rows: [{ id: 'i1' }] as unknown[],
}))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  builder.update = (patch: Record<string, unknown>) => {
    h.patches.push(patch)
    return builder
  }
  builder.eq = () => builder
  builder.select = (cols: string) => {
    h.selects.push(cols)
    return builder
  }
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: h.rows, error: null }).then(resolve)
  return { supabase: { from: () => builder } }
})

import { INGREDIENT_UPDATE_FIELDS, updateIngredient } from '../stocks'
import { MSG_NO_PERMISSION } from '../userMessages'

beforeEach(() => {
  h.patches = []
  h.selects = []
  h.rows = [{ id: 'i1' }]
})

describe('updateIngredient', () => {
  it('STK1 zero rânduri = refuz de drepturi; un rând = succes', async () => {
    await expect(updateIngredient('i1', { name: 'Făină' })).resolves.toBeUndefined()
    expect(h.selects).toEqual(['id'])

    h.rows = []
    const err: unknown = await updateIngredient('i1', { name: 'Făină' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(MSG_NO_PERMISSION)
    expect((err as { code?: string }).code).toBe('42501')
  })

  it('STK2 stocul nu pleacă pe calea de editare', async () => {
    await updateIngredient('i1', { name: 'Lapte', cost_per_unit: 4.5, min_stock_alert: null, current_stock: 99 })
    expect(h.patches).toHaveLength(1)
    const patch = h.patches[0]!
    expect(patch).not.toHaveProperty('current_stock')
    expect(patch).toMatchObject({ name: 'Lapte', cost_per_unit: 4.5, min_stock_alert: null })
    expect(typeof patch.updated_at).toBe('string')
    expect(INGREDIENT_UPDATE_FIELDS as readonly string[]).not.toContain('current_stock')
  })
})
