// „Toate locațiile" (lotul A, mig 314) — partea pură din lib/locations.ts.
//
//   LC1  `fetchLocationsSummary` pe PGRST202 (RPC nedeployat) → `null`
//        („indisponibil"), NU listă goală. Mutația care pică: `return []` pe
//        eroare, sau fallback-ul scos (aruncă).
//   LC2  orice altă eroare → `Error` REAL cu mesaj românesc și `code` păstrat;
//        o formă neașteptată (nu array, rând fără id, număr negativ) → aruncă.
//        Mutația care pică: obiectul Supabase brut aruncat mai departe, sau
//        rândurile invalide filtrate tăcut.
//   LC3  maparea rândurilor: `revenue_today` NULL rămâne `null` (nu 0), cifrele
//        venite ca șir (numeric din PostgREST) devin numere. Mutația care
//        pică: `Number(r.revenue_today ?? 0)`.
//   LC4  `hasMultipleLocations`: doar owner/manager, fiecare local o dată,
//        fără membership-ul sintetic al vizitei de fondator. Mutația care
//        pică: numărarea oricărui rol, sau a lui `founderViewId`.
//   LC5  `formatLastOrder` în ziua ROMÂNIEI: 21:30Z pe 4 sept = „azi, 00:30"
//        pe 5 sept (prefixul UTC ar spune „ieri"); ieri / altă zi / null.
//        Mutația care pică: comparația pe prefixul șirului ISO.
//   LC6  `describeCreateLocationError`: hint `upgrade_plan` /
//        `plan_upgrade_required` → mesajul de limită în română; o eroare
//        englezească fără hint → rezerva românească (nu textul serverului).
//        Mutația care pică: hint-ul ignorat (mesajul serverului afișat ca atare).
//   LC7  `canAddLocation` (recenzia #344): DOAR cu limita CUNOSCUTĂ și peste
//        localurile deținute — limită 1 cu 1 local → nu; 2 cu 1 → da; limită
//        sau număr necunoscut → nu. Mutația care pică: `ownedCount <= max`
//        (limita 1 cu 1 local ar arăta cardul pe Planurile 1–2).
//   LC8  `isAmbiguousCreateFailure`: rețea / eroare fără cod / formă ciudată →
//        ambiguu; refuz cu cod Postgres → clar. Mutația care pică: orice eroare
//        tratată drept clară (reîncercare oarbă după un răspuns pierdut).
//   LC9  `findCreatedLocation` citește restaurantele DEȚINUTE cu numele exact,
//        sare id-urile cunoscute și rândurile create înaintea trimiterii
//        (peste toleranța de ceas), întoarce rândul nou; pe eroare ARUNCĂ (nu
//        „negăsit"). Mutația care pică: eroarea de citire colapsată la `null`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  result: { data: [] as unknown, error: null as unknown },
  filters: [] as [string, unknown][],
}))
interface Chain {
  select: () => Chain
  eq: (col: string, val: unknown) => Chain
  order: () => Promise<{ data: unknown; error: unknown }>
}
vi.mock('../supabase', () => {
  const chain: Chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      m.filters.push([col, val])
      return chain
    },
    order: () => Promise.resolve(m.result),
  }
  return { supabase: { rpc: m.rpc, from: () => chain } }
})

import {
  MSG_LOCATION_LIMIT,
  describeCreateLocationError,
  fetchLocationsSummary,
  formatLastOrder,
  hasMultipleLocations,
  adminLocationCount,
  canAddLocation,
  findCreatedLocation,
  isAmbiguousCreateFailure,
} from '../locations'

const ROW = {
  id: 'r1',
  name: 'Bistro',
  slug: 'bistro',
  orders_today: 3,
  open_orders: 2,
  revenue_today: 50,
  last_order_at: '2026-11-03T10:00:00+00:00',
}

beforeEach(() => {
  m.rpc.mockReset()
  m.result = { data: [], error: null }
  m.filters = []
})

describe('fetchLocationsSummary', () => {
  it('LC1: PGRST202 → null (indisponibil), nu listă goală', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    await expect(fetchLocationsSummary()).resolves.toBeNull()
    expect(m.rpc).toHaveBeenCalledWith('get_locations_summary')
    // Control: un răspuns valid gol rămâne listă goală (distinct de null).
    m.rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchLocationsSummary()).resolves.toEqual([])
  })

  it('LC2: altă eroare → Error real cu code; forma neașteptată → aruncă', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    const err = await fetchLocationsSummary().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Nu am putut încărca/)
    expect((err as Error & { code?: string }).code).toBe('42501')

    for (const data of [{ not: 'array' }, [{ ...ROW, id: 7 }], [{ ...ROW, open_orders: -1 }]]) {
      m.rpc.mockResolvedValue({ data, error: null })
      await expect(fetchLocationsSummary()).rejects.toThrow(/formă neașteptată/)
    }
  })

  it('LC3: revenue NULL rămâne null; numerele venite ca șir devin numere', async () => {
    m.rpc.mockResolvedValue({
      data: [
        ROW,
        { ...ROW, id: 'r2', revenue_today: null, last_order_at: null },
        { ...ROW, id: 'r3', orders_today: '4', revenue_today: '12.50' },
      ],
      error: null,
    })
    const rows = await fetchLocationsSummary()
    expect(rows).toEqual([
      {
        id: 'r1',
        name: 'Bistro',
        slug: 'bistro',
        ordersToday: 3,
        openOrders: 2,
        revenueToday: 50,
        lastOrderAt: '2026-11-03T10:00:00+00:00',
      },
      expect.objectContaining({ id: 'r2', revenueToday: null, lastOrderAt: null }),
      expect.objectContaining({ id: 'r3', ordersToday: 4, revenueToday: 12.5 }),
    ])
  })
})

describe('hasMultipleLocations', () => {
  const mem = (restaurant_id: string, role: string) => ({ restaurant_id, role })

  it('LC4: doar owner/manager, fără vizita de fondator', () => {
    expect(hasMultipleLocations([mem('a', 'owner'), mem('b', 'manager')], null)).toBe(true)
    expect(hasMultipleLocations([mem('a', 'owner'), mem('b', 'waiter')], null)).toBe(false)
    expect(hasMultipleLocations([mem('a', 'owner'), mem('b', 'kitchen')], null)).toBe(false)
    expect(hasMultipleLocations([mem('a', 'owner'), mem('b', 'partner')], null)).toBe(false)
    expect(hasMultipleLocations([mem('a', 'owner')], null)).toBe(false)
    // Membership-ul sintetic al vizitei (fondator = manager virtual) nu contează.
    expect(hasMultipleLocations([mem('a', 'owner'), mem('b', 'manager')], 'b')).toBe(false)
    // Același local de două ori se numără o dată.
    expect(adminLocationCount([mem('a', 'owner'), mem('a', 'manager')], null)).toBe(1)
  })
})

describe('formatLastOrder', () => {
  it('LC5: ziua și ora României', () => {
    const now = new Date('2026-09-05T08:00:00Z') // 11:00 în București, 5 sept
    // 21:30Z pe 4 sept = 00:30 pe 5 sept la București → „azi".
    expect(formatLastOrder('2026-09-04T21:30:00Z', now)).toBe('azi, 00:30')
    expect(formatLastOrder('2026-09-04T10:00:00Z', now)).toBe('ieri, 13:00')
    expect(formatLastOrder('2026-09-01T09:05:00Z', now)).toBe('01.09.2026, 12:05')
    expect(formatLastOrder(null, now)).toBe('Nicio comandă încă')
    expect(formatLastOrder('nu-e-data', now)).toBe('—')
  })
})

describe('describeCreateLocationError', () => {
  it('LC6: limita planului în română; eroare englezească → rezerva românească', () => {
    const limit = {
      code: 'P0001',
      hint: 'upgrade_plan',
      message: 'Limită restaurante atinsă: maxim 1 pe planul curent.',
    }
    expect(describeCreateLocationError(limit)).toBe(MSG_LOCATION_LIMIT)
    expect(describeCreateLocationError({ ...limit, hint: 'plan_upgrade_required' })).toBe(
      MSG_LOCATION_LIMIT,
    )
    const english = { code: '23514', message: 'name is required' }
    const msg = describeCreateLocationError(english)
    expect(msg).not.toMatch(/name is required/)
    expect(msg).toBe('Locația nu a putut fi creată. Reîncearcă.')
  })
})

describe('„Adaugă o locație" — vizibilitate și eșec ambiguu', () => {
  it('LC7: cardul doar cu limita cunoscută și loc liber', () => {
    expect(canAddLocation(1, 1)).toBe(false)
    expect(canAddLocation(2, 1)).toBe(true)
    expect(canAddLocation(2, 2)).toBe(false)
    expect(canAddLocation(1_000_000_000, 7)).toBe(true)
    expect(canAddLocation(null, 1)).toBe(false)
    expect(canAddLocation(2, null)).toBe(false)
    expect(canAddLocation(Number.NaN, 0)).toBe(false)
  })

  it('LC8: ambiguu vs. refuz clar', () => {
    expect(isAmbiguousCreateFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isAmbiguousCreateFailure({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true)
    expect(isAmbiguousCreateFailure(new Error('Invalid create_restaurant response'))).toBe(true)
    expect(isAmbiguousCreateFailure(null)).toBe(true)
    expect(isAmbiguousCreateFailure({ code: 'P0001', hint: 'upgrade_plan', message: 'x' })).toBe(false)
    expect(isAmbiguousCreateFailure({ code: '23514', message: 'name is required' })).toBe(false)
  })

  it('LC9: găsește doar locația NOUĂ, cu numele exact; pe eroare aruncă', async () => {
    const sentAt = Date.parse('2026-11-03T10:00:00Z')
    m.result = {
      data: [
        { id: 'known', name: 'Bistro', created_at: '2026-11-03T10:00:05Z' },
        { id: 'other-name', name: 'Bistro 2', created_at: '2026-11-03T10:00:05Z' },
        { id: 'new', name: 'Bistro', created_at: '2026-11-03T09:59:30Z' },
        { id: 'old', name: 'Bistro', created_at: '2026-10-01T10:00:00Z' },
      ],
      error: null,
    }
    const found = await findCreatedLocation({
      ownerId: 'owner-1',
      name: 'Bistro',
      sentAt,
      knownIds: new Set(['known']),
    })
    // 09:59:30 e în toleranța de ceas (2 min) față de 10:00:00.
    expect(found).toBe('new')
    expect(m.filters).toEqual([
      ['owner_id', 'owner-1'],
      ['name', 'Bistro'],
    ])
    // Doar rânduri vechi / cunoscute → null.
    m.result = { data: [{ id: 'old', name: 'Bistro', created_at: '2026-10-01T10:00:00Z' }], error: null }
    await expect(
      findCreatedLocation({ ownerId: 'owner-1', name: 'Bistro', sentAt, knownIds: new Set() }),
    ).resolves.toBeNull()
    // Citirea eșuată → aruncă (nu „negăsit").
    m.result = { data: null, error: { code: '57014', message: 'timeout' } }
    await expect(
      findCreatedLocation({ ownerId: 'owner-1', name: 'Bistro', sentAt, knownIds: new Set() }),
    ).rejects.toThrow(/Nu am putut verifica/)
  })
})
