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
/**
 * Build a CSV string from an array of objects.
 * Headers: keys of first row. Values RFC4180-quoted if contain , " or \n.
 * Encoding: UTF-8 with BOM (so Excel opens RO chars correctly).
 */
export function toCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0]!)
  const esc = (v: unknown): string => {
    if (v == null) return ''
    const s = typeof v === 'number' ? v.toString() : String(v)
    if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => esc((r as Record<string, unknown>)[h])).join(',')),
  ]
  return '\uFEFF' + lines.join('\n') // BOM for Excel UTF-8 detection
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
