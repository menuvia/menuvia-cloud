// Meniul pentru „Comandă nouă" de pe ecranul ospătarului (perf-staff-2).
//
// WaiterEntry cerea meniul abia DUPĂ ce ospătarul alegea masa (în serie cu
// lista meselor) și re-descărca TOT arborele meniului la fiecare masă aleasă
// și la fiecare redeschidere a foii — pe 4G-ul din sală, secunde de așteptare
// pe fiecare comandă. Acum WaiterEntry îl cere la montare, în PARALEL cu
// mesele, iar arborele se refolosește un minut: o promisiune per restaurant
// (cererile simultane se unesc), ștearsă la eșec ca reîncercarea să plece
// din nou. Plafonul de 60 s ține „Epuizat" aproape de realitate; serverul
// validează oricum fiecare produs la create_order.
import { fetchMenuForRestaurant, type Category } from './qr'

export const STAFF_MENU_TTL_MS = 60_000

interface Entry {
  at: number
  promise: Promise<Category[]>
}

const cache = new Map<string, Entry>()

/** Meniul restaurantului, refolosit cel mult STAFF_MENU_TTL_MS. */
export function loadStaffMenu(restaurantId: string, now: number = Date.now()): Promise<Category[]> {
  const hit = cache.get(restaurantId)
  if (hit && now - hit.at < STAFF_MENU_TTL_MS) return hit.promise
  const entry: Entry = { at: now, promise: fetchMenuForRestaurant(restaurantId) }
  cache.set(restaurantId, entry)
  entry.promise.catch(() => {
    if (cache.get(restaurantId) === entry) cache.delete(restaurantId)
  })
  return entry.promise
}
