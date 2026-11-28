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
// `signal` (opțional): reîncărcarea de VERIFICARE de după o salvare fără
// răspuns (HappyHourTab) are și ea termen, iar la termen se anulează.
export async function fetchHappyHourRules(
  restaurantId: string,
  signal?: AbortSignal,
): Promise<HappyHourRule[]> {
  const query = supabase
    .from('happy_hour_rules')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
  return (data ?? []) as HappyHourRule[]
}

// `signal` (opțional; la modificare, în `opts`) ANULEAZĂ cererea, nu doar o
// ignoră (recenzia lotului C4a): supabase-js nu are timeout, iar editorul Happy Hour își mărginește
// salvarea în timp (HappyHourTab) — fără anulare, o cerere abandonată ar fi
// putut ajunge la server și DUPĂ ce omul a primit „nu s-a putut confirma”.
// Pe o cerere anulată, supabase-js întoarce eroarea (`AbortError`), deci
// funcțiile aruncă, ca la orice refuz.
//
// `id` vine din CLIENT (recenzia adversarială a lotului C4a): editorul îl
// generează o dată pe sesiune și îl retrimite la fiecare reîncercare. O cerere
// ajunsă la server poate fi comisă și după ce clientul a renunțat la ea, iar
// `happy_hour_rules` n-are altă cheie unică decât `id` (mig 036, `default
// gen_random_uuid()` — valoarea trimisă îl înlocuiește): cu același id, o
// reîncercare a unei creări deja comise e respinsă cu 23505, nu devine a doua
// regulă, iar „s-a salvat?” se află căutând rândul cu acel id, nu ghicind după
// nume. `id` și `restaurant_id` stau DUPĂ `fields`, ca un câmp în plus strecurat
// printr-un cast să nu le poată înlocui.
export async function createHappyHourRule(
  restaurantId: string,
  id: string,
  fields: Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>,
  signal?: AbortSignal,
): Promise<HappyHourRule> {
  const query = supabase
    .from('happy_hour_rules')
    .insert({ ...fields, id, restaurant_id: restaurantId })
    .select()
  const { data, error } = await (signal ? query.abortSignal(signal) : query).single()
  if (error) throw error
  return data as HappyHourRule
}

// Ce a scris o modificare: id-ul și noul `updated_at` (îl pune trigger-ul
// BEFORE UPDATE din mig 036 la ORICE modificare a rândului).
export type HappyHourRuleStamp = Pick<HappyHourRule, 'id' | 'updated_at'>

// Întoarce rândul modificat, sau `null` când modificarea n-a atins NICIUN rând
// (recenzia adversarială a lui cdcb6dd): un UPDATE care nu se potrivește cu
// nimic — regula ștearsă pe alt dispozitiv, ascunsă de RLS după o schimbare de
// rol sau, cu `ifUpdatedAt`, modificată între timp — primește tot un răspuns de
// succes, fără eroare. Fără `.select(...)` cererea trecea drept salvată.
// `ifUpdatedAt` = concurența optimistă a editorului (HappyHourTab): modificarea
// se aplică doar dacă rândul are încă `updated_at`-ul versiunii peste care s-a
// deschis editorul; altfel `null`, iar apelantul reîncarcă lista și decide.
// `signal` (opțional) anulează cererea, ca la creare.
export async function updateHappyHourRule(
  id: string,
  fields: Partial<HappyHourRule>,
  opts: { ifUpdatedAt?: string; signal?: AbortSignal } = {},
): Promise<HappyHourRuleStamp | null> {
  const byId = supabase.from('happy_hour_rules').update(fields).eq('id', id)
  const guarded = opts.ifUpdatedAt == null ? byId : byId.eq('updated_at', opts.ifUpdatedAt)
  const query = guarded.select('id, updated_at')
  const { data, error } = await (opts.signal ? query.abortSignal(opts.signal) : query)
  if (error) throw error
  const rows = (data ?? []) as HappyHourRuleStamp[]
  return rows[0] ?? null
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
