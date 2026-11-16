// memberships — forma restaurantului din RestaurantContext (lotul G2c).
//
// O SINGURĂ listă de coloane servește și membership-urile reale, și vizita
// sintetică a fondatorului/partenerului: dacă ar fi două, vizita ar putea pierde
// fusul (sau țara) pe care membership-urile îl au, iar ospătarul vizitat de
// fondator ar vedea orele pe București.
//
// Fișierul e în INTRARE (îl importă RestaurantContext, montat pe orice rută,
// inclusiv pe meniul QR), deci nu importă `lib/dates`: fiecare scanare QR i-ar
// evalua formatter-ele. Paginile de personal (leneșe) își calculează singure
// fusul din `restaurant.timezone` (clichetul ZT8 din dayZoneScope.test.ts).
import type { MemberRole } from './constants'
import type { UiRole } from './partnerAccess'

/** Coloanele restaurantului din context. `country` cere mig 296, `timezone` 049. */
export const RESTAURANT_CTX_COLUMNS = 'id, name, slug, timezone, country'

/** Select-ul membership-urilor, cu restaurantul încorporat pe ACEEAȘI listă. */
export const MEMBERSHIP_SELECT = `restaurant_id, role, restaurant:restaurants(${RESTAURANT_CTX_COLUMNS})`

export interface MembershipRestaurant {
  id: string
  name: string
  slug: string
  // Opționale: mock-urile din teste și tipurile inline nu le au; lipsă = București
  // (`restaurantTimeZone`) / țară necunoscută (`reportTimeZone`).
  timezone?: string | null
  country?: string | null
}

export interface MembershipRow {
  restaurant_id: string
  // MemberRole din DB + „partner" (vizită de afiliat, mig 286 — doar în UI).
  role: UiRole
  restaurant: MembershipRestaurant
}

interface RawRestaurant {
  id: string
  name: string
  slug: string
  timezone?: string | null
  country?: string | null
}

function toRestaurant(r: RawRestaurant | null | undefined): MembershipRestaurant {
  if (!r) return { id: '', name: '', slug: '', timezone: null, country: null }
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    timezone: r.timezone ?? null,
    country: r.country ?? null,
  }
}

/** Rândul restaurantului citit direct (vizita fondatorului/partenerului). */
export function mapRestaurantRow(r: unknown): MembershipRestaurant {
  return toRestaurant(r as RawRestaurant | null)
}

// Rândurile `restaurant_memberships` (cu restaurantul încorporat) → forma din
// context. Folosită de încărcarea inițială ȘI de `reloadMemberships`. PostgREST
// poate întoarce relația ca obiect sau ca array, deci le acceptăm pe amândouă.
export function mapMembershipRows(data: unknown[] | null): MembershipRow[] {
  return (data ?? []).map((m) => {
    const raw = m as {
      restaurant_id: string
      role: string
      restaurant: RawRestaurant | RawRestaurant[] | null
    }
    const rest = Array.isArray(raw.restaurant) ? raw.restaurant[0] : raw.restaurant
    return {
      restaurant_id: raw.restaurant_id,
      role: raw.role as MemberRole,
      restaurant: toRestaurant(rest),
    }
  })
}
