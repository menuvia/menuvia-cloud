// ─────────────────────────────────────────────────────────────
// pickupOrders — cum văd Bucătăria și Ospătarul o comandă de RIDICARE.
//
// O comandă pickup are o oră de ridicare (`pickup_time`) aleasă de client,
// adesea ORE după ce a fost plasată (pre-comandă la prânz pentru seară).
// Înainte, cardurile nu afișau nici ora, nici numele, nici telefonul, erau
// ordonate după `created_at`, iar timer-ul de urgență pornea de la plasare —
// o pre-comandă pentru 19:00 stătea ROȘIE în Bucătărie de la 12:20, adică
// exact semnalul pe care bucătarul învață să-l ignore.
//
// Helperi PURI (primesc `now`) — testabili determinist.
// ─────────────────────────────────────────────────────────────
import type { Order } from './orders'
import { DEFAULT_RESTAURANT_TZ, formatTimeInZone } from './dates'

type PickupFields = Pick<Order, 'source' | 'pickup_time' | 'created_at'>

// Instantul (ms) al orei de ridicare, sau null dacă nu e o comandă pickup cu
// oră validă. Un `pickup_time` pe o comandă non-pickup e ignorat.
export function pickupInstant(order: PickupFields): number | null {
  if (order.source !== 'pickup' || !order.pickup_time) return null
  const t = Date.parse(order.pickup_time)
  return Number.isNaN(t) ? null : t
}

// Pickup programat ÎN VIITOR: încă nu e întârziat, deci fără timer roșu.
export function isScheduledPickupAhead(order: PickupFields, now: number = Date.now()): boolean {
  const t = pickupInstant(order)
  return t != null && t > now
}

// Ancora de urgență: pentru pickup e ora de RIDICARE (întârzierea se măsoară
// față de ora promisă clientului), pentru restul — momentul plasării.
export function urgencyAnchor(order: PickupFields): string {
  const t = pickupInstant(order)
  return t != null ? new Date(t).toISOString() : order.created_at
}

// Cheia de sortare: „când trebuie să fie gata". Pickup → ora de ridicare;
// restul → momentul plasării (FIFO, ca înainte). Sortare STABILĂ la egalitate.
export function staffOrderDueKey(order: PickupFields): number {
  const t = pickupInstant(order)
  if (t != null) return t
  const c = Date.parse(order.created_at)
  return Number.isNaN(c) ? 0 : c
}

export function sortByDue<T extends PickupFields>(orders: readonly T[]): T[] {
  return orders
    .map((o, i) => ({ o, i, k: staffOrderDueKey(o) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.o)
}

// „HH:mm" al orei de ridicare în fusul restaurantului (deocamdată implicit
// Europe/Bucharest — paginile de staff nu citesc încă `restaurants.timezone`).
export function pickupTimeLabel(
  order: PickupFields,
  timeZone: string = DEFAULT_RESTAURANT_TZ,
): string | null {
  const t = pickupInstant(order)
  return t == null ? null : formatTimeInZone(new Date(t).toISOString(), timeZone)
}
