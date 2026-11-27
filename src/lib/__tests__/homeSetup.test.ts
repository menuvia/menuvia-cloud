// Pașii de configurare de pe Acasă (lotul C1): ce numără „Produse în meniu" și
// cache-ul citirilor de setup (lib/homeSetup.ts). Supabase e un FAKE care chiar
// APLICĂ filtrele cerute (eq / not … is null) peste rânduri în memorie — un
// filtru scos din interogare schimbă cifra, deci testul o vede.
//
//   HV1  3 produse active, fără ciornă, dar „Fără categorie" → 0: oaspetele nu
//        le vede (get_menu_for_restaurant pornește din categorii, mig 321), deci
//        pasul „Adaugă produse" NU se bifează. Control pozitiv: cu unul într-o
//        categorie cifra devine 1. Mutația care pică: interogarea veche (toate
//        produsele, fără `.not('category_id', 'is', null)`) dă 3.
//   HV2  pe un amestec (inactive, ciorne, fără categorie, alt restaurant)
//        cifra = `isGuestVisibleProduct` pe rândurile restaurantului: aceeași
//        definiție ca ecranul de traduceri. Mutațiile care pică: fără filtrul
//        `is_active`, fără `is_draft`, fără `restaurant_id`. Anti-vacuitate:
//        fixtura are și rânduri vizibile, și ascunse.
//   HV3  eroarea serverului și o excepție dau `null` (necunoscut), nu 0 — altfel
//        pasul ar deveni „de făcut" la un meniu plin. Mutația care pică:
//        `return count ?? 0` fără verificarea `error`.
//   HV4  cache-ul: necunoscut → toate `null`; valorile se îmbină pe restaurant,
//        nu se scurg la alt restaurant; golirea uită tot. Mutația care pică:
//        `set(id, patch)` fără îmbinare (a doua citire șterge prima).
//   HV5  `everOrdered` din două citiri care se întrec (recenzia lotului C1): o
//        citire pornită ÎNAINTEA unei observații primite nu o rescrie, oricând
//        ar sosi; una pornită DUPĂ se aplică, și cu „nu" (calea inițială, fără
//        observație mai nouă, rămâne); marca e per restaurant; golirea o uită.
//        Mutațiile care pică: fără verificarea mărcii (răspunsul vechi „nu"
//        câștigă), marca globală în loc de per restaurant, golirea care păstrează
//        marcile.
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>

const { productRows, fake } = vi.hoisted(() => ({
  productRows: [] as Row[],
  fake: { error: null as unknown, throws: false },
}))

vi.mock('../supabase', () => {
  type Result = { count: number | null; error: unknown }
  interface Query {
    select: () => Query
    eq: (col: string, value: unknown) => Query
    not: (col: string, op: string, value: unknown) => Query
    then: (onOk: (v: Result) => unknown, onErr?: (e: unknown) => unknown) => Promise<unknown>
  }
  function from(table: string): Query {
    if (fake.throws) throw new Error('network down')
    let current: Row[] = table === 'products' ? [...productRows] : []
    const b: Query = {
      select: () => b,
      eq: (col: string, value: unknown) => {
        current = current.filter((r) => r[col] === value)
        return b
      },
      not: (col: string, op: string, value: unknown) => {
        // Singura formă cerută: `not(col, 'is', null)`. Orice altceva e o
        // interogare pe care fake-ul nu o înțelege → eroare, nu „trecut tăcut".
        if (op !== 'is' || value !== null) throw new Error(`filtru necunoscut: not ${col} ${op}`)
        current = current.filter((r) => r[col] != null)
        return b
      },
      then: (onOk: (v: Result) => unknown, onErr?: (e: unknown) => unknown) => {
        const result: Result = fake.error
          ? { count: null, error: fake.error }
          : { count: current.length, error: null }
        return Promise.resolve(result).then(onOk, onErr)
      },
    }
    return b
  }
  return { supabase: { from } }
})

import {
  beginOrderRead,
  clearHomeSetupCache,
  countMenuProducts,
  readHomeSetup,
  rememberHomeSetup,
  rememberOrderObservation,
} from '../homeSetup'
import { isGuestVisibleProduct } from '../menuTranslations'

function product(over: Partial<{ restaurant_id: string; is_active: boolean; is_draft: boolean; category_id: string | null }> = {}): Row {
  return { restaurant_id: 'r1', is_active: true, is_draft: false, category_id: 'c1', ...over }
}

beforeEach(() => {
  productRows.length = 0
  fake.error = null
  fake.throws = false
  clearHomeSetupCache()
})

describe('countMenuProducts — ce vede oaspetele', () => {
  it('HV1 trei produse „Fără categorie" → 0; unul într-o categorie → 1', async () => {
    productRows.push(
      product({ category_id: null }),
      product({ category_id: null }),
      product({ category_id: null }),
    )
    expect(await countMenuProducts('r1')).toBe(0)
    productRows.push(product({ category_id: 'c1' }))
    expect(await countMenuProducts('r1')).toBe(1)
  })

  it('HV2 aceeași definiție ca isGuestVisibleProduct, doar pe restaurantul cerut', async () => {
    productRows.push(
      product(),
      product({ category_id: 'c2' }),
      product({ is_active: false }),
      product({ is_draft: true }),
      product({ category_id: null }),
      product({ restaurant_id: 'r2' }),
      product({ restaurant_id: 'r2', category_id: null }),
    )
    const own = productRows.filter((r) => r.restaurant_id === 'r1')
    const expected = own.filter((r) =>
      isGuestVisibleProduct({
        is_active: r.is_active === true,
        is_draft: r.is_draft === true,
        category_id: typeof r.category_id === 'string' ? r.category_id : null,
      }),
    ).length
    // Anti-vacuitate: și vizibile, și ascunse în fixtură.
    expect(expected).toBe(2)
    expect(own.length).toBeGreaterThan(expected)
    expect(await countMenuProducts('r1')).toBe(expected)
  })

  it('HV3 eroare sau excepție → null (necunoscut), nu 0', async () => {
    productRows.push(product())
    fake.error = { message: 'boom', code: '500' }
    expect(await countMenuProducts('r1')).toBeNull()
    fake.error = null
    fake.throws = true
    expect(await countMenuProducts('r1')).toBeNull()
    // Control pozitiv: fără eroare, cifra reală.
    fake.throws = false
    expect(await countMenuProducts('r1')).toBe(1)
  })
})

describe('cache-ul citirilor de setup', () => {
  it('HV4 necunoscut → null; îmbinare per restaurant; golirea uită tot', () => {
    expect(readHomeSetup('r1')).toEqual({
      tablesCount: null,
      categoriesCount: null,
      teamCount: null,
      everOrdered: null,
    })
    rememberHomeSetup('r1', { tablesCount: 4 })
    rememberHomeSetup('r1', { categoriesCount: 2 })
    expect(rememberOrderObservation('r1', beginOrderRead(), true)).toBe(true)
    expect(readHomeSetup('r1')).toEqual({
      tablesCount: 4,
      categoriesCount: 2,
      teamCount: null,
      everOrdered: true,
    })
    // Alt restaurant nu vede cifrele lui r1.
    expect(readHomeSetup('r2').tablesCount).toBeNull()
    clearHomeSetupCache()
    expect(readHomeSetup('r1').tablesCount).toBeNull()
  })

  it('HV5 câștigă citirea pornită ultima, nu cea sosită ultima', () => {
    // Existența pleacă la montare, „Comenzi azi" după ea.
    const existence = beginOrderRead()
    const today = beginOrderRead()
    expect(rememberOrderObservation('r1', today, true)).toBe(true)
    // Existența sosește târziu cu „încă nicio comandă": informație mai veche.
    expect(rememberOrderObservation('r1', existence, false)).toBe(false)
    expect(readHomeSetup('r1').everOrdered).toBe(true)
    // O citire pornită DUPĂ observație se aplică, și cu „nu".
    expect(rememberOrderObservation('r1', beginOrderRead(), false)).toBe(true)
    expect(readHomeSetup('r1').everOrdered).toBe(false)
    // Alt restaurant nu e blocat de marca lui r1 (calea inițială rămâne).
    expect(rememberOrderObservation('r2', existence, false)).toBe(true)
    expect(readHomeSetup('r2').everOrdered).toBe(false)
    // Golirea uită și marcile.
    clearHomeSetupCache()
    expect(rememberOrderObservation('r1', existence, false)).toBe(true)
    expect(readHomeSetup('r1').everOrdered).toBe(false)
  })
})
