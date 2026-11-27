// src/lib/happyHour.ts — RPC + CRUD pentru reguli Happy Hour
import { supabase } from './supabase'

export interface HappyHourRule {
  id: string
  restaurant_id: string
  name: string
  is_active: boolean
  starts_at: string // 'HH:MM:SS'
  ends_at: string
  days_of_week: number[] // [] = all, else [1..7] (1=duminică)
  scope: 'all' | 'category' | 'product'
  category_id: string | null
  product_id: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  max_discount: number | null
  created_at: string
  updated_at: string
}

export interface ActiveRule {
  id: string
  name: string
  scope: 'all' | 'category' | 'product'
  category_id: string | null
  product_id: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  max_discount: number | null
}

export interface HappyHourSuggestion {
  rule_id: string
  rule_name: string
  discount_type: 'percent' | 'amount'
  discount_value: number
  applicable_subtotal: number
  computed_discount: number
}

export const DAY_LABELS = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'] as const // index 0..6 → matches DOW 1..7

// ── CRUD ──────────────────────────────────────────────────────
export async function fetchHappyHourRules(restaurantId: string): Promise<HappyHourRule[]> {
  const { data, error } = await supabase
    .from('happy_hour_rules')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as HappyHourRule[]
}

// `signal` (opțional) ANULEAZĂ cererea, nu doar o ignoră (recenzia lotului
// C4a): supabase-js nu are timeout, iar editorul Happy Hour își mărginește
// salvarea în timp (HappyHourTab) — fără anulare, o cerere abandonată ar fi
// putut ajunge la server și DUPĂ ce omul a primit „nu s-a putut confirma”. (Una
// ajunsă deja acolo poate fi comisă oricum; de aceea mesajul cere verificarea.)
// Pe o cerere anulată, supabase-js întoarce eroarea (`AbortError`), deci
// funcțiile aruncă, ca la orice refuz.
export async function createHappyHourRule(
  restaurantId: string,
  fields: Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>,
  signal?: AbortSignal,
): Promise<HappyHourRule> {
  const query = supabase
    .from('happy_hour_rules')
    .insert({ restaurant_id: restaurantId, ...fields })
    .select()
  const { data, error } = await (signal ? query.abortSignal(signal) : query).single()
  if (error) throw error
  return data as HappyHourRule
}

export async function updateHappyHourRule(
  id: string,
  fields: Partial<HappyHourRule>,
  signal?: AbortSignal,
): Promise<void> {
  const query = supabase.from('happy_hour_rules').update(fields).eq('id', id)
  const { error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
}

export async function deleteHappyHourRule(id: string): Promise<void> {
  const { error } = await supabase.from('happy_hour_rules').delete().eq('id', id)
  if (error) throw error
}

// ── RPC: evaluate now ────────────────────────────────────────
export async function evaluateHappyHourForNow(restaurantId: string): Promise<ActiveRule[]> {
  const { data, error } = await supabase.rpc('evaluate_happy_hour_for_now', {
    p_restaurant_id: restaurantId,
  })
  if (error) throw error
  return (data ?? []) as ActiveRule[]
}

// ── RPC: suggest for order ───────────────────────────────────
export async function suggestHappyHourForOrder(
  orderId: string,
): Promise<HappyHourSuggestion | null> {
  const { data, error } = await supabase.rpc('suggest_happy_hour_discount_for_order', {
    p_order_id: orderId,
  })
  if (error) throw error
  return data as HappyHourSuggestion | null
}
