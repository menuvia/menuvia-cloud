// ─────────────────────────────────────────────────────────────
// vat.ts — Cote TVA configurabile per restaurant
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export interface VatRate {
  restaurant_id: string
  vat_group: number // 1-4
  rate_percent: number // ex: 9, 19, 5, 0
  label: string // ex: "Mâncare", "Alcool"
  description: string | null
  is_active: boolean
  updated_at: string
}

export async function fetchVatRates(restaurantId: string): Promise<VatRate[]> {
  const { data, error } = await supabase
    .from('vat_rates')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('vat_group')
  if (error) throw error
  return (data ?? []) as VatRate[]
}

export async function updateVatRate(
  restaurantId: string,
  vatGroup: number,
  fields: Partial<Pick<VatRate, 'rate_percent' | 'label' | 'description' | 'is_active'>>,
): Promise<void> {
  const { error } = await supabase
    .from('vat_rates')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('restaurant_id', restaurantId)
    .eq('vat_group', vatGroup)
  if (error) throw error
}

// Get readable label for vat_group from rates list
export function getVatLabel(rates: VatRate[], vatGroup: number): string {
  const r = rates.find((r) => r.vat_group === vatGroup)
  return r ? `${r.rate_percent}% (${r.label})` : `Grupa ${vatGroup}`
}

// Get rate percent for vat_group from rates list
export function getVatRate(rates: VatRate[], vatGroup: number): number {
  const r = rates.find((r) => r.vat_group === vatGroup)
  return r ? r.rate_percent : 0
}
