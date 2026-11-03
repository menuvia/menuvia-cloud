import type { Order, OrderStatus } from './orders'
import { isScheduledPickupAhead, urgencyAnchor } from './pickupOrders'

// Vârsta unei comenzi pe ecranele de staff (lotul G) — o singură regulă pentru
// Bucătărie și Ospătar. Pragurile sunt cele din `urgencyColor` (lib/utils):
// 10 minute → atenție, 20 → întârziată. Un pickup programat în viitor nu
// întârzie încă, iar după ora promisă vârsta se măsoară față de ea, nu față de
// plasare (lib/pickupOrders).

export type AgeLevel = 'calm' | 'warn' | 'late'

export const ORDER_WARN_MINUTES = 10
export const ORDER_LATE_MINUTES = 20

/** Comenzile pe care bucătăria încă le are de făcut. */
export const KITCHEN_PENDING_STATUSES: readonly OrderStatus[] = ['new', 'confirmed', 'preparing']

type AgedOrder = Pick<Order, 'id' | 'status' | 'created_at' | 'source' | 'pickup_time'>

export function ageLevel(order: AgedOrder, now: number = Date.now()): AgeLevel {
  if (isScheduledPickupAhead(order, now)) return 'calm'
  const t = Date.parse(urgencyAnchor(order))
  if (Number.isNaN(t)) return 'calm'
  const min = Math.floor((now - t) / 60_000)
  if (min >= ORDER_LATE_MINUTES) return 'late'
  if (min >= ORDER_WARN_MINUTES) return 'warn'
  return 'calm'
}

/** Comenzile încă nepregătite care au trecut de pragul de întârziere. */
export function lateKitchenOrderIds(
  orders: ReadonlyArray<AgedOrder>,
  now: number = Date.now(),
): string[] {
  return orders
    .filter((o) => KITCHEN_PENDING_STATUSES.includes(o.status) && ageLevel(o, now) === 'late')
    .map((o) => o.id)
}

/**
 * Alerta sonoră: comenzile care AU DEVENIT întârziate de la ultima verificare.
 * `alerted` ține minte comenzile pentru care s-a sunat deja, deci fiecare comandă
 * sună O SINGURĂ dată. Întoarce lista nouă de alertate (fără comenzile care au
 * ieșit din bucătărie, ca setul să nu crească la nesfârșit) și id-urile noi.
 */
export function takeNewlyLate(
  orders: ReadonlyArray<AgedOrder>,
  alerted: ReadonlySet<string>,
  now: number = Date.now(),
): { alerted: Set<string>; fresh: string[] } {
  const late = lateKitchenOrderIds(orders, now)
  const fresh = late.filter((id) => !alerted.has(id))
  const pending = new Set(
    orders.filter((o) => KITCHEN_PENDING_STATUSES.includes(o.status)).map((o) => o.id),
  )
  const next = new Set([...alerted].filter((id) => pending.has(id)))
  for (const id of late) next.add(id)
  return { alerted: next, fresh }
}
