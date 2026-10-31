// Citirea faptelor pentru destinația de după login (S1): `loadPostLoginDestination`.
//
//   PL6  citește rolurile din restaurant_memberships ȘI rândul de afiliat al
//        utilizatorului (profile_id = id), nimic altceva
//   PL7  fără restaurant + afiliat activ → /afiliat; cu restaurant → /dashboard
//   PL8  eroarea la citirea ROLURILOR → /dashboard, chiar cu afiliat activ (nu
//        trimitem un patron pe panoul de agent din cauza unui blip)
//   PL9  eroarea la citirea afilierii = „nu e afiliat"
//   PL10 o excepție oriunde → /dashboard (funcția nu aruncă niciodată)
//   RQ5  cu intenție de plan (`loadPlanIntentDestination`): fără restaurant →
//        /dashboard (onboarding), cu restaurant deținut → /pricing; rolurile
//        NECUNOSCUTE (eroare/excepție) → /dashboard, niciodată Stripe. Mutația
//        care pică: un loader care întoarce /pricing pe eroare sau fără roluri.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import { loadPlanIntentDestination, loadPostLoginDestination } from '../postLogin'

interface Result {
  data: unknown
  error: unknown
}

// Lanț minimal: select().eq() se poate `await`-a (memberships), iar
// select().eq().maybeSingle() întoarce rândul (affiliates).
interface Chain {
  select: () => Chain
  eq: (...args: unknown[]) => Chain
  maybeSingle: () => Promise<Result>
  then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>
}

function table(result: Result) {
  const eq = vi.fn()
  const chain: Chain = {
    select: () => chain,
    eq: (...args: unknown[]) => {
      eq(...args)
      return chain
    },
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return { chain, eq }
}

function setup(memberships: Result, affiliate: Result) {
  const m = table(memberships)
  const a = table(affiliate)
  fromMock.mockImplementation((name: string) => {
    if (name === 'restaurant_memberships') return m.chain
    if (name === 'affiliates') return a.chain
    throw new Error('tabelă neașteptată: ' + name)
  })
  return { m, a }
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('loadPostLoginDestination', () => {
  it('PL6 citește rolurile și afilierea utilizatorului', async () => {
    const { m, a } = setup(
      { data: [], error: null },
      { data: { status: 'active' }, error: null },
    )
    await loadPostLoginDestination('u-1')
    expect(m.eq).toHaveBeenCalledWith('user_id', 'u-1')
    expect(a.eq).toHaveBeenCalledWith('profile_id', 'u-1')
  })

  it('PL7 agent fără restaurant → /afiliat; cu restaurant → /dashboard', async () => {
    setup({ data: [], error: null }, { data: { status: 'active' }, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/afiliat')
    setup({ data: [], error: null }, { data: { status: 'pending' }, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/afiliat')
    setup({ data: [{ role: 'owner' }], error: null }, { data: { status: 'active' }, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/dashboard')
    setup({ data: [{ role: 'kitchen' }], error: null }, { data: null, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/kitchen')
    setup({ data: [{ role: 'waiter' }], error: null }, { data: null, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/waiter')
    // afiliat închis/respins + fără restaurant → patron nou
    setup({ data: [], error: null }, { data: { status: 'closed' }, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/dashboard')
  })

  it('PL8 eroare la roluri → /dashboard, chiar cu afiliat activ', async () => {
    setup({ data: null, error: { message: 'boom' } }, { data: { status: 'active' }, error: null })
    expect(await loadPostLoginDestination('u-1')).toBe('/dashboard')
  })

  it('PL9 eroare la afiliere = „nu e afiliat" (eroarea se verifică ÎNAINTEA rândului)', async () => {
    // Rând „activ" întors ÎMPREUNĂ cu o eroare: un loader care ignoră `error` ar
    // trimite omul pe /afiliat.
    setup({ data: [], error: null }, { data: { status: 'active' }, error: { message: 'boom' } })
    expect(await loadPostLoginDestination('u-1')).toBe('/dashboard')
  })

  it('PL10 o excepție → /dashboard, nu aruncă', async () => {
    fromMock.mockImplementation(() => {
      throw new Error('network down')
    })
    expect(await loadPostLoginDestination('u-1')).toBe('/dashboard')
  })
})

describe('loadPlanIntentDestination', () => {
  it('RQ5 întâi restaurantul: fără restaurant → onboarding; necunoscut → niciodată Stripe', async () => {
    const { m } = setup({ data: [], error: null }, { data: null, error: null })
    expect(await loadPlanIntentDestination('u-1')).toBe('/dashboard')
    expect(m.eq).toHaveBeenCalledWith('user_id', 'u-1')
    setup({ data: [{ role: 'owner' }], error: null }, { data: null, error: null })
    expect(await loadPlanIntentDestination('u-1')).toBe('/pricing')
    setup({ data: null, error: { message: 'boom' } }, { data: null, error: null })
    expect(await loadPlanIntentDestination('u-1')).toBe('/dashboard')
    fromMock.mockImplementation(() => {
      throw new Error('network down')
    })
    expect(await loadPlanIntentDestination('u-1')).toBe('/dashboard')
  })
})
