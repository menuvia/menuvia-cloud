// src/lib/quickSetup.ts — Setup Asistent (migration 034)
import { supabase } from './supabase'

// Tipul de local pentru presetul demo (apply_business_type_preset, mig 034) —
// consumatorul e onboarding-ul. Catalogul de previzualizare (BUSINESS_TYPES)
// trăia doar în „asistentul detaliat" de pe Acasă, scos fiindcă dubla
// checklist-ul (ux-owner-quicksetup-duplicate).
export type BusinessType = 'cafenea' | 'bar' | 'restaurant' | 'pizzerie' | 'cocktail_bar' | 'altul'

// ── VAT preset (mig 034 → 285) ───────────────────────────────
// Legea 141/2025 (în vigoare din 1 aug 2025) a lăsat o SINGURĂ cotă redusă
// (11%) și standardul la 21%; 5% și 9% au dispărut (mig 102). Cu o singură
// cotă redusă, tabela grupă → cotă e UNICĂ, deci există un singur preset —
// identic cu cotele pe care le primește orice restaurant nou (mig 109).
// Sursa server-side e `vat_rate_defaults_ro()` (mig 285); QS3 citește migrația
// și cere ca preview-ul de aici să fie EXACT ce scrie serverul.
// Id-urile vechi ('simple_19' | 'food_9' | 'tourism_5') sunt RESPINSE de server
// cu hint `vat_preset_retired` — nu le reintroduce.
export type VatPreset = 'ro_l141_2025'

export interface VatPresetPreview {
  id: VatPreset
  label: string
  description: string
  rates: { group: number; rate: number; label: string }[]
}

export const VAT_PRESETS: VatPresetPreview[] = [
  {
    id: 'ro_l141_2025',
    label: 'Cotele legale — 11% + 21% (L.141/2025)',
    description:
      '11% pentru mâncare, apă plată, cafea, ceai; 21% pentru alcool și răcoritoarele cu zahăr (CN 2202, ≥10g/100g). Aceleași cote pe care le primește orice local nou.',
    rates: [
      { group: 1, rate: 11, label: 'Mâncare' },
      { group: 2, rate: 21, label: 'Alcool' },
      { group: 3, rate: 11, label: 'Special' },
      { group: 4, rate: 0, label: 'Scutit' },
    ],
  },
]

// ── RPC wrappers ──────────────────────────────────────────────

export interface BusinessPresetResult {
  status: 'success' | 'skipped'
  business_type?: BusinessType
  categories_added?: number
  products_added?: number
  reason?: string
  existing_categories?: number
}

export async function applyBusinessTypePreset(
  restaurantId: string,
  businessType: BusinessType,
  force: boolean = false,
): Promise<BusinessPresetResult> {
  const { data, error } = await supabase.rpc('apply_business_type_preset', {
    p_restaurant_id: restaurantId,
    p_business_type: businessType,
    p_force: force,
  })
  if (error) throw error
  return data as BusinessPresetResult
}

export interface VatPresetResult {
  status: 'success'
  preset: VatPreset
  rates_applied: number
}

export async function applyVatPreset(
  restaurantId: string,
  preset: VatPreset,
): Promise<VatPresetResult> {
  const { data, error } = await supabase.rpc('apply_vat_preset', {
    p_restaurant_id: restaurantId,
    p_preset: preset,
  })
  if (error) {
    // Error REAL cu hint/code (contractul createOrder / advanceOrderStatus):
    // obiectul PostgREST brut nu e `instanceof Error`, iar UI-ul afișa
    // „Eroare” generic în loc de motivul refuzului.
    const err = new Error(error.message || 'Cotele TVA nu au putut fi aplicate') as Error & {
      hint?: string
      code?: string
    }
    err.hint = error.hint ?? undefined
    err.code = error.code ?? undefined
    throw err
  }
  return data as VatPresetResult
}

/**
 * Textul RO pentru refuzurile lui `apply_vat_preset`. Mesajele serverului
 * pentru rol și id sunt ENGLEZEȘTI (interne, mig 034/285), deci se ÎNLOCUIESC.
 * „Invalid preset” e reachable doar pe skew: client nou + bază fără mig 285.
 */
export function describeVatPresetError(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  if (/not admin/i.test(message)) {
    return 'Doar proprietarul sau managerul poate schimba cotele TVA.'
  }
  if (/invalid preset/i.test(message)) {
    return 'Serverul nu are încă cotele L.141/2025 (actualizare în curs). Le poți seta manual din Setări → Comenzi & plăți → Cote TVA.'
  }
  return 'Cotele TVA nu au putut fi aplicate. Reîncearcă.'
}
