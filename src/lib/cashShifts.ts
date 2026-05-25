// src/lib/cashShifts.ts — Wrappers RPC pentru cash shifts + movements
import { supabase } from './supabase'

export type CashMovementType =
  | 'deposit' // depunere fond (+)
  | 'withdrawal' // retragere (-)
  | 'tip_payout' // plată bacșiș ospătar (-)
  | 'expense' // cheltuială (-)
  | 'safe_deposit' // depunere la seif (-)
  | 'correction' // corecție manuală (+/-)

export const MOVEMENT_LABELS: Record<
  CashMovementType,
  { label: string; emoji: string; isPositive: boolean }
> = {
  deposit: { label: 'Depunere fond', emoji: '💰', isPositive: true },
  withdrawal: { label: 'Retragere', emoji: '💸', isPositive: false },
  tip_payout: { label: 'Bacșiș ospătar', emoji: '🤝', isPositive: false },
  expense: { label: 'Cheltuială', emoji: '🧾', isPositive: false },
  safe_deposit: { label: 'Depunere la seif', emoji: '🔒', isPositive: false },
  correction: { label: 'Corecție numărare', emoji: '✏️', isPositive: true }, // poate fi orice
}

export interface CurrentShift {
  id: string
  opened_at: string
  opened_by: string
  initial_float: number
  cash_collected: number
  cash_movements_total: number
  cash_expected: number
  movement_count: number
  order_count: number
}

export interface RecentShift {
  id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  initial_float: number
  expected_cash: number | null
  counted_cash: number | null
  cash_diff: number | null
  order_count: number
}

export interface ShiftSummary {
  shift_id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  initial_float: number
  orders: {
    count: number
    gross_total: number
    discount_total: number
    net_total: number
  }
  payments_by_method: Record<string, number>
  cash_collected: number
  cash_movements: Array<{
    id: string
    amount: number
    type: CashMovementType
    reason: string
    performed_at: string
    sent_to_fiscal: boolean
  }>
  cash_movements_total: number
  cash_expected: number
  counted_cash: number | null
  cash_diff: number | null
}

// ── RPC wrappers ──────────────────────────────────────────────

export async function getCurrentShift(restaurantId: string): Promise<CurrentShift | null> {
  const { data, error } = await supabase.rpc('get_current_shift', { p_restaurant_id: restaurantId })
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) return null
  return data[0] as CurrentShift
}

export async function openShift(
  restaurantId: string,
  initialFloat: number,
  notes: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('open_shift', {
    p_restaurant_id: restaurantId,
    p_initial_float: initialFloat,
    p_notes: notes,
  })
  if (error) throw error
  return data as string
}

export async function addCashMovement(
  restaurantId: string,
  amount: number,
  type: CashMovementType,
  reason: string,
  sendToFiscal: boolean = false,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_cash_movement', {
    p_restaurant_id: restaurantId,
    p_amount: amount,
    p_type: type,
    p_reason: reason,
    p_send_to_fiscal: sendToFiscal,
  })
  if (error) throw error
  return data as string
}

export async function closeShift(
  shiftId: string,
  countedCash: number,
  notes: string | null,
  sendZ: boolean = true,
): Promise<{
  shift_id: string
  expected_cash: number
  counted_cash: number
  cash_diff: number
  z_sent: boolean
  z_receipt_id: string | null
  summary: ShiftSummary
}> {
  const { data, error } = await supabase.rpc('close_shift', {
    p_shift_id: shiftId,
    p_counted_cash: countedCash,
    p_notes: notes,
    p_send_z: sendZ,
  })
  if (error) throw error
  return data as {
    shift_id: string
    expected_cash: number
    counted_cash: number
    cash_diff: number
    z_sent: boolean
    z_receipt_id: string | null
    summary: ShiftSummary
  }
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary | null> {
  const { data, error } = await supabase.rpc('get_shift_summary', { p_shift_id: shiftId })
  if (error) throw error
  return data as ShiftSummary | null
}

export async function listRecentShifts(
  restaurantId: string,
  limit: number = 30,
): Promise<RecentShift[]> {
  const { data, error } = await supabase.rpc('list_recent_shifts', {
    p_restaurant_id: restaurantId,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as RecentShift[]
}
