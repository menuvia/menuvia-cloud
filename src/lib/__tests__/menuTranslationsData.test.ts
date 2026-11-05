// lib/menuTranslationsData — citirile și scrierile ecranului Traduceri (lotul O6c).
//
//   MD1  opțiunile și extra-urile se citesc în loturi de 100 de id-uri, pe
//        pagini: o pagină PLINĂ cere următorul interval. Mutația care pică: o
//        singură citire fără `.range` (PostgREST taie tăcut la 1000 de rânduri)
//        sau toate id-urile într-un singur `in.(…)` (414 la ~200 de id-uri).
//   MD2  saveRowTranslations RE-CITEȘTE rândul înainte să scrie: o limbă scrisă
//        între timp (altă fișă, alt tab) supraviețuiește; întoarce ce a scris
//        serverul. Mutația care pică: `mutate` aplicat pe instantaneul din UI.
//   MD3  0 rânduri scrise → Error 42501 („nu ai drepturi”); fără `.select` după
//        update orice scriere ar ieși refuzată (MD2 pică); rândul dispărut →
//        `not_found`; o citire picată ARUNCĂ (ecranul nu arată „0 lipsă” pe date
//        parțiale).
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Query {
  table: string
  calls: [string, unknown[]][]
}
interface Reply {
  data: unknown
  error: { message: string; code?: string } | null
}

const h = vi.hoisted(() => ({
  log: [] as Query[],
  respond: (() => ({ data: [], error: null })) as (q: Query) => Reply,
}))

vi.mock('../supabase', () => {
  function from(table: string) {
    const q: Query = { table, calls: [] }
    h.log.push(q)
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'range', 'update', 'maybeSingle']) {
      b[m] = (...args: unknown[]) => {
        q.calls.push([m, args])
        return b
      }
    }
    b.then = (resolve: (v: Reply) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(h.respond(q)).then(resolve, reject)
    return b
  }
  return { supabase: { from } }
})

import { loadTranslationOptions, saveRowTranslations } from '../menuTranslationsData'
import { applyManualEdit } from '../i18nMenu'
import { toUserMessage } from '../userMessages'

const arg = (q: Query, m: string): unknown[] | undefined => q.calls.find(([name]) => name === m)?.[1]
const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`)

beforeEach(() => {
  h.log.length = 0
})

describe('loadTranslationOptions', () => {
  it('MD1 loturi de 100 de id-uri, pe pagini', async () => {
    const groupIds = ids(150, 'g')
    h.respond = (q) => {
      const range = arg(q, 'range') as [number, number] | undefined
      const inArgs = arg(q, 'in') as [string, string[]] | undefined
      if (q.table === 'modifier_groups') {
        return {
          data: range?.[0] === 0 ? groupIds.map((id, i) => ({ id, name: `G${i}`, display_order: i })) : [],
          error: null,
        }
      }
      if (q.table === 'modifier_options') {
        // Primul lot: o pagină plină de 500, apoi 3 rânduri; al doilea lot: gol.
        if (inArgs?.[1][0] !== 'g0') return { data: [], error: null }
        const n = range?.[0] === 0 ? 500 : 3
        return {
          data: Array.from({ length: n }, (_, i) => ({
            id: `o${range?.[0]}-${i}`,
            modifier_group_id: 'g0',
            name: 'Mare',
            is_available: true,
            display_order: i,
            translations: { en: { name: 'Large' } },
          })),
          error: null,
        }
      }
      if (q.table === 'product_extras') {
        return { data: [{ id: `e-${inArgs?.[1][0]}`, product_id: inArgs?.[1][0], name: 'Bacon', is_available: false, display_order: 0 }], error: null }
      }
      return { data: [], error: null }
    }
    const out = await loadTranslationOptions('r1', ids(250, 'p'))

    const opts = h.log.filter((q) => q.table === 'modifier_options')
    expect(opts.map((q) => (arg(q, 'in') as [string, string[]])[1].length)).toEqual([100, 100, 50])
    expect(opts.map((q) => arg(q, 'range'))).toEqual([
      [0, 499],
      [500, 999],
      [0, 499],
    ])
    expect(out.options).toHaveLength(503)
    expect(out.options[0]).toMatchObject({ modifier_group_id: 'g0', is_available: true, translations: { en: { name: 'Large' } } })

    const extras = h.log.filter((q) => q.table === 'product_extras')
    expect(extras.map((q) => (arg(q, 'in') as [string, string[]])[1].length)).toEqual([100, 100, 50])
    // Coloana lipsă (bază fără mig 321) = null, nu o eroare.
    expect(out.extras[0]).toMatchObject({ product_id: 'p0', is_available: false, translations: null })
    expect(out.groups).toHaveLength(150)
    expect(arg(h.log.find((q) => q.table === 'modifier_groups') as Query, 'eq')).toEqual(['restaurant_id', 'r1'])
    // Legăturile se citesc pe grupuri (lib/modifierLinks).
    expect(h.log.some((q) => q.table === 'product_modifier_groups')).toBe(true)
  })

  it('MD3 o citire picată aruncă (nu întoarce date parțiale)', async () => {
    h.respond = (q) =>
      q.table === 'product_extras' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }
    await expect(loadTranslationOptions('r1', ['p1'])).rejects.toThrow()
  })
})

describe('saveRowTranslations', () => {
  function serverWith(fresh: unknown, written: (payload: unknown) => Reply) {
    h.respond = (q) => {
      const upd = arg(q, 'update') as [{ translations: unknown }] | undefined
      if (!upd) return { data: fresh, error: null }
      // Fără `.select` după update, PostgREST nu întoarce rânduri.
      const selectedAfter = q.calls.findIndex(([m]) => m === 'select') > q.calls.findIndex(([m]) => m === 'update')
      return selectedAfter ? written(upd[0]) : { data: null, error: null }
    }
  }

  it('MD2 re-citește, aplică pe rândul proaspăt și întoarce ce a scris serverul', async () => {
    // Între timp, altcineva a scris germana.
    serverWith({ translations: { de: { name: 'Suppe' } } }, (payload) => ({
      data: [{ id: 'p1', translations: (payload as { translations: unknown }).translations }],
      error: null,
    }))
    const written = await saveRowTranslations('products', 'p1', (fresh) =>
      applyManualEdit(fresh, 'en', { name: 'Soup' }),
    )
    expect(written).toEqual({ de: { name: 'Suppe' }, en: { name: 'Soup' } })
    const [read, write] = h.log
    expect(read.table).toBe('products')
    expect(read.calls.map(([m]) => m)).toEqual(['select', 'eq', 'maybeSingle'])
    expect(arg(read, 'select')).toEqual(['translations'])
    expect(write.calls.map(([m]) => m)).toEqual(['update', 'eq', 'select'])
    expect(arg(write, 'eq')).toEqual(['id', 'p1'])
    expect(arg(write, 'update')).toEqual([{ translations: { de: { name: 'Suppe' }, en: { name: 'Soup' } } }])
  })

  it('MD3 0 rânduri → 42501; rând dispărut → not_found; citire picată → aruncă', async () => {
    serverWith({ translations: {} }, () => ({ data: [], error: null }))
    const denied = await saveRowTranslations('product_extras', 'e1', (t) => t).catch((e: unknown) => e)
    expect((denied as { code?: string }).code).toBe('42501')
    expect(toUserMessage(denied)).toBe('Nu ai drepturi pentru această acțiune.')

    h.log.length = 0
    serverWith(null, () => ({ data: [], error: null }))
    const gone = await saveRowTranslations('categories', 'c1', (t) => t).catch((e: unknown) => e)
    expect((gone as { code?: string }).code).toBe('not_found')
    expect(h.log.filter((q) => arg(q, 'update'))).toHaveLength(0)

    h.respond = () => ({ data: null, error: { message: 'boom', code: 'XX000' } })
    await expect(saveRowTranslations('modifier_groups', 'g1', (t) => t)).rejects.toThrow()
  })
})
