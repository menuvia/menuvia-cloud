// Forma restaurantului din RestaurantContext (lotul G2c, lib/memberships.ts).
//   MS1 o SINGURĂ listă de coloane: select-ul membership-urilor încorporează
//       EXACT `RESTAURANT_CTX_COLUMNS`, iar lista are fusul și țara.
//   MS2 maparea păstrează `timezone`/`country` pe relația-obiect și pe
//       relația-array; rândul lipsă / câmpurile lipsă → null (nu undefined).
//   MS3 structural: vizita fondatorului/partenerului citește ACEEAȘI listă
//       (`RESTAURANT_CTX_COLUMNS`), nu un literal de coloane propriu.
// Mutațiile care pică: `country` scos din listă (MS1); select-ul vizitei cu
// listă proprie (MS3); `timezone` uitat în mapare (MS2).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  MEMBERSHIP_SELECT,
  RESTAURANT_CTX_COLUMNS,
  mapMembershipRows,
  mapRestaurantRow,
} from '../memberships'

describe('lib/memberships', () => {
  it('MS1 select-ul membership-urilor încorporează lista unică, cu fus și țară', () => {
    expect(MEMBERSHIP_SELECT).toContain(`restaurant:restaurants(${RESTAURANT_CTX_COLUMNS})`)
    const cols = RESTAURANT_CTX_COLUMNS.split(',').map((c) => c.trim())
    expect(cols).toEqual(expect.arrayContaining(['id', 'name', 'slug', 'timezone', 'country']))
  })

  it('MS2 maparea păstrează fusul și țara; lipsa → null', () => {
    const r = { id: 'r1', name: 'Bistro', slug: 'bistro', timezone: 'America/New_York', country: 'US' }
    const [asObj, asArr, missing, partial] = mapMembershipRows([
      { restaurant_id: 'r1', role: 'waiter', restaurant: r },
      { restaurant_id: 'r1', role: 'owner', restaurant: [r] },
      { restaurant_id: 'r2', role: 'kitchen', restaurant: null },
      { restaurant_id: 'r3', role: 'manager', restaurant: { id: 'r3', name: 'X', slug: 'x' } },
    ])
    expect(asObj?.restaurant).toEqual(r)
    expect(asArr?.restaurant).toEqual(r)
    expect(asObj?.role).toBe('waiter')
    expect(missing?.restaurant).toEqual({ id: '', name: '', slug: '', timezone: null, country: null })
    expect(partial?.restaurant.timezone).toBeNull()
    expect(partial?.restaurant.country).toBeNull()
    expect(mapMembershipRows(null)).toEqual([])
    expect(mapRestaurantRow(r)).toEqual(r)
  })

  it('MS3 vizita fondatorului/partenerului citește aceeași listă de coloane', () => {
    const ctx = readFileSync(resolve(process.cwd(), 'src/contexts/RestaurantContext.tsx'), 'utf8')
    expect(ctx).toMatch(/\.from\('restaurants'\)\s*\.select\(RESTAURANT_CTX_COLUMNS\)/)
    expect(ctx).toMatch(/\.select\(MEMBERSHIP_SELECT\)/)
    // Niciun literal de coloane pe `restaurants` în context.
    expect(ctx).not.toMatch(/\.select\('id, name/)
    expect(ctx).toMatch(/activeRestaurant: active\?\.restaurant \?\? null/)
  })
})
