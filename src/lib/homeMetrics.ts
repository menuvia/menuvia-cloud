// Cifrele zilei de pe Acasă (lotul D) — calcule pure, testabile fără
// componentă. Sursele sunt aceleași ca în restul panoului, ca cifrele să se
// potrivească între ecrane:
//   - mesele ocupate = mesele cu comenzi DESCHISE, derivat pe `table_id`
//     (ca „Stadiu mese", TableStatusBoard — acoperă uniform QR și ospătar);
//   - încasările = `get_daily_payments_by_method` (mig 268), aceeași sursă ca
//     Rapoartele; gate-ul fiscal vine din date, nu de aici;
//   - bacșișul = `orders.tips_amount`, care din mig 262 NU intră niciodată în
//     încasări — de aceea e o cifră separată, informativă.

/** Stările „deschise" ale unei comenzi (paritate cu fetchWaiterOrders). */
export const OPEN_ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'ready', 'served'] as const

/** Numărul de mese DISTINCTE cu cel puțin o comandă deschisă. */
export function countOccupiedTables(rows: ReadonlyArray<{ table_id: string | null }>): number {
  const ids = new Set<string>()
  for (const r of rows) if (r.table_id) ids.add(r.table_id)
  return ids.size
}

function cents(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Suma pe cenți (PostgREST întoarce `numeric` ca șir sau număr). */
export function sumAmounts<K extends string>(
  rows: ReadonlyArray<Partial<Record<K, unknown>>>,
  key: K,
): number {
  let total = 0
  for (const r of rows) total += cents(r[key])
  return total / 100
}
