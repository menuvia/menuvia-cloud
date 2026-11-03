// =============================================================
// Menuvia — src/lib/locations.ts
// „Toate locațiile" (lotul A, mig 314): rezumatul zilei pe fiecare local al
// unui admin cu mai multe localuri + „Adaugă o locație" din Setări.
//
// Decizia fondatorului: ecranul e vizibil pentru ORICE admin (proprietar SAU
// manager) cu ≥ 2 localuri la care e admin. Sursa numărului, pe client, sunt
// membership-urile REALE din RestaurantContext (fără cel sintetic al vizitei de
// fondator); pe server, `get_locations_summary()` filtrează pe ACELAȘI criteriu
// (`my_admin_restaurant_ids()`, membership owner/manager), deci ecranul și
// lista nu se pot contrazice.
// =============================================================
import { supabase } from './supabase'
import { toUserMessage } from './userMessages'
import { formatTimeInZone, isoToRomaniaYMD, toRomaniaYMD } from './dates'

/** Pragul de la care panoul arată „Toate locațiile". */
export const MIN_LOCATIONS_FOR_OVERVIEW = 2

export interface LocationSummary {
  id: string
  name: string
  slug: string
  /** Comenzile NEanulate create azi (ziua României). */
  ordersToday: number
  /** Comenzile în new/confirmed/preparing/ready/served, indiferent de zi. */
  openOrders: number
  /**
   * Încasările de azi (ziua încasării). `null` = planul localului nu ține
   * bani (fără `fiscal_receipt`) — NU „0 lei": ecranul nu afișează câmpul.
   */
  revenueToday: number | null
  /** Ultima comandă neanulată, ISO; `null` = nicio comandă încă. */
  lastOrderAt: string | null
}

/** Rolurile cu care un local intră în „Toate locațiile" (ca în mig 314). */
const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'manager'])

/**
 * Câte localuri are omul ca ADMIN real. Membership-ul sintetic al vizitei de
 * fondator/partener (`founderViewId`) nu se numără: nu e un local al lui, iar
 * serverul nu-l întoarce (fără escape-ul `is_platform_admin`, mig 314).
 */
export function adminLocationCount(
  memberships: ReadonlyArray<{ restaurant_id: string; role: string }>,
  founderViewId: string | null,
): number {
  const ids = new Set<string>()
  for (const m of memberships) {
    if (m.restaurant_id === founderViewId) continue
    if (ADMIN_ROLES.has(m.role)) ids.add(m.restaurant_id)
  }
  return ids.size
}

export function hasMultipleLocations(
  memberships: ReadonlyArray<{ restaurant_id: string; role: string }>,
  founderViewId: string | null,
): boolean {
  return adminLocationCount(memberships, founderViewId) >= MIN_LOCATIONS_FOR_OVERVIEW
}

function toCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

function toMoney(v: unknown): number | null | undefined {
  if (v === null) return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

function parseRow(raw: unknown): LocationSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  const name = typeof r.name === 'string' ? r.name : null
  const slug = typeof r.slug === 'string' ? r.slug : null
  const ordersToday = toCount(r.orders_today)
  const openOrders = toCount(r.open_orders)
  const revenueToday = toMoney(r.revenue_today)
  const last = r.last_order_at
  const lastOrderAt = last === null ? null : typeof last === 'string' ? last : undefined
  if (
    id === null ||
    name === null ||
    slug === null ||
    ordersToday === null ||
    openOrders === null ||
    revenueToday === undefined ||
    lastOrderAt === undefined
  ) {
    return null
  }
  return { id, name, slug, ordersToday, openOrders, revenueToday, lastOrderAt }
}

/** Funcția lipsește din baza de date (frontend deployat înaintea mig 314). */
function isMissingFunction(code: unknown): boolean {
  return code === 'PGRST202' || code === '42883'
}

/**
 * Rezumatul zilei pe fiecare local al omului.
 *
 *  - `null`  = funcția NU există încă pe server (PGRST202): ecranul spune că
 *              rezumatul nu e disponibil — NU o listă goală, care ar afirma
 *              „nicio locație".
 *  - aruncă un `Error` real (cu `code` păstrat) pe orice altă eroare sau pe o
 *    formă neașteptată a răspunsului, ca apelantul să arate „Reîncearcă".
 */
export async function fetchLocationsSummary(): Promise<LocationSummary[] | null> {
  const { data, error } = await supabase.rpc('get_locations_summary')
  if (error) {
    if (isMissingFunction(error.code)) return null
    const err = new Error('Nu am putut încărca rezumatul locațiilor.')
    ;(err as Error & { code?: string }).code = error.code
    throw err
  }
  if (!Array.isArray(data)) {
    throw new Error('Rezumatul locațiilor a venit într-o formă neașteptată.')
  }
  const rows: LocationSummary[] = []
  for (const raw of data) {
    const row = parseRow(raw)
    if (!row) throw new Error('Rezumatul locațiilor a venit într-o formă neașteptată.')
    rows.push(row)
  }
  return rows
}

function previousYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`
}

/**
 * „Ultima comandă", în ziua și ora ROMÂNIEI (nu prefixul UTC al șirului):
 * „azi, 14:32" / „ieri, 23:10" / „31.10.2026, 12:05"; `null` → „Nicio comandă încă".
 */
export function formatLastOrder(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Nicio comandă încă'
  const ymd = isoToRomaniaYMD(iso)
  if (!ymd) return '—'
  const time = formatTimeInZone(iso)
  const today = toRomaniaYMD(now)
  if (ymd === today) return `azi, ${time}`
  if (ymd === previousYmd(today)) return `ieri, ${time}`
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}, ${time}`
}

/** Hint-urile cu care serverul refuză o locație peste limita planului (mig 131/290). */
const PLAN_LIMIT_HINTS: ReadonlySet<string> = new Set(['upgrade_plan', 'plan_upgrade_required'])

export const MSG_LOCATION_LIMIT =
  'Planul actual nu permite încă o locație. Pentru mai multe locații e nevoie de un plan superior.'

/** Mesajul pentru om când „Adaugă o locație" eșuează. */
export function describeCreateLocationError(err: unknown): string {
  const hint =
    typeof err === 'object' && err !== null ? (err as { hint?: unknown }).hint : undefined
  if (typeof hint === 'string' && PLAN_LIMIT_HINTS.has(hint)) return MSG_LOCATION_LIMIT
  return toUserMessage(err, 'Locația nu a putut fi creată. Reîncearcă.')
}
