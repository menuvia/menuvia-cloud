// src/lib/reports.ts — RPC wrappers pentru rapoartele extinse (migration 033)
import { supabase } from './supabase'

export interface WaiterSalesRow {
  waiter_id: string | null
  waiter_name: string
  order_count: number
  total_revenue: number
  avg_ticket: number
  discount_total: number
}

export interface HourlySalesRow {
  hour: number // 0-23
  order_count: number
  total_revenue: number
}

export interface CategorySalesRow {
  category_id: string | null
  category_name: string
  category_emoji: string | null
  item_count: number
  total_revenue: number
  percent_total: number
}

export async function fetchWaiterSales(
  restaurantId: string,
  fromISO: string,
  toISO: string,
): Promise<WaiterSalesRow[]> {
  const { data, error } = await supabase.rpc('report_by_waiter', {
    p_restaurant_id: restaurantId,
    p_from: fromISO,
    p_to: toISO,
  })
  if (error) throw error
  return (data ?? []) as WaiterSalesRow[]
}

export async function fetchHourlySales(
  restaurantId: string,
  fromISO: string,
  toISO: string,
): Promise<HourlySalesRow[]> {
  const { data, error } = await supabase.rpc('report_by_hour', {
    p_restaurant_id: restaurantId,
    p_from: fromISO,
    p_to: toISO,
  })
  if (error) throw error
  return (data ?? []) as HourlySalesRow[]
}

export async function fetchCategorySales(
  restaurantId: string,
  fromISO: string,
  toISO: string,
): Promise<CategorySalesRow[]> {
  const { data, error } = await supabase.rpc('report_by_category', {
    p_restaurant_id: restaurantId,
    p_from: fromISO,
    p_to: toISO,
  })
  if (error) throw error
  return (data ?? []) as CategorySalesRow[]
}

// ── CSV utility ───────────────────────────────────────────────
/** Dialectul unui CSV: separatorul de coloane și semnul zecimal. Excel îl ia
 *  din setările REGIONALE ale calculatorului: în română/franceză/germană lista
 *  se separă cu „;” și zecimalele cu „,” — un fișier cu „,” punea tot rândul în
 *  coloana A, iar „3.10” putea deveni o dată (lotul C6a). */
export interface CsvDialect {
  sep: ',' | ';'
  decimal: '.' | ','
}

export interface CsvOptions extends Partial<CsvDialect> {
  /** BOM UTF-8 în față (implicit da). Excel recunoaște UTF-8 DOAR după un BOM
   *  la octetul 0 — un fișier compus din mai multe tabele cere UN singur BOM,
   *  la început, deci secțiunile se construiesc cu `bom: false`. */
  bom?: boolean
}

/** O celulă CSV: un număr cu semnul zecimal al dialectului; un text
 *  neutralizat contra injecției de formulă și încadrat în ghilimele când
 *  conține separatorul, ghilimele sau un rând nou (RFC 4180). */
export function csvCell(v: unknown, opts: Partial<CsvDialect> = {}): string {
  const sep = opts.sep ?? ','
  const decimal = opts.decimal ?? '.'
  if (v == null) return ''
  // Numerele nu sunt injecție de formulă.
  if (typeof v === 'number') return decimal === '.' ? v.toString() : v.toString().replace('.', decimal)
  let s = String(v)
  // Anti formula-injection: o celulă care începe cu = + - @ (sau tab/CR) e
  // interpretată ca formulă de Excel/Sheets (ex. un produs numit „=HYPERLINK(...)").
  // O neutralizăm prefixând cu un apostrof, înainte de quoting-ul standard.
  // Excepția: o sumă negativă deja formatată („-3,50”) e un NUMĂR, nu o
  // formulă — cu apostrof, Excel o lua drept text și n-o mai aduna.
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(?:[.,]\d+)?%?$/.test(s)) s = `'${s}`
  if (s.includes(sep) || /["\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Build a CSV string from an array of objects.
 * Headers: keys of first row. Values RFC4180-quoted if they contain the
 * separator, " or a newline. Default dialect: ',' + '.', with a UTF-8 BOM in
 * front (Excel opens RO chars correctly only with the BOM at byte 0).
 */
export function toCsv<T extends Record<string, unknown>>(rows: T[], opts: CsvOptions = {}): string {
  if (rows.length === 0) return ''
  const dialect: CsvDialect = { sep: opts.sep ?? ',', decimal: opts.decimal ?? '.' }
  const headers = Object.keys(rows[0]!)
  const lines = [
    headers.map((h) => csvCell(h, dialect)).join(dialect.sep),
    ...rows.map((r) =>
      headers.map((h) => csvCell((r as Record<string, unknown>)[h], dialect)).join(dialect.sep),
    ),
  ]
  return (opts.bom === false ? '' : '\uFEFF') + lines.join('\n')
}

/**
 * Trigger a CSV download in the browser. Safe in client-side React.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
