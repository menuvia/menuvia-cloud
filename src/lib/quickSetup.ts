// src/lib/quickSetup.ts — Setup Asistent (migration 034)
import { supabase } from './supabase'
import { fnUrl } from './fn'

// ── Business type definitions (UI metadata) ──────────────────
// Aceleași prețuri folosite în SQL; ținute aici DOAR pentru preview UI
// (utilizator vede ce se va crea înainte să apese OK).
export type BusinessType = 'cafenea' | 'bar' | 'restaurant' | 'pizzerie' | 'cocktail_bar' | 'altul'

export interface BusinessTypePreview {
  id: BusinessType
  label: string
  emoji: string
  description: string
  categoriesCount: number
  productsCount: number
  sampleCategories: { emoji: string; name: string }[]
}

export const BUSINESS_TYPES: BusinessTypePreview[] = [
  {
    id: 'cafenea',
    label: 'Cafenea',
    emoji: '☕',
    description: 'Cafele specialty, ceaiuri, prăjituri, brunch ușor',
    categoriesCount: 4,
    productsCount: 15,
    sampleCategories: [
      { emoji: '☕', name: 'Cafele' },
      { emoji: '🍵', name: 'Ceaiuri' },
      { emoji: '🥤', name: 'Băuturi reci' },
      { emoji: '🍰', name: 'Prăjituri' },
    ],
  },
  {
    id: 'bar',
    label: 'Bar / Pub',
    emoji: '🍺',
    description: 'Bere, vin, tării, cocktailuri clasice',
    categoriesCount: 5,
    productsCount: 14,
    sampleCategories: [
      { emoji: '🍺', name: 'Bere' },
      { emoji: '🥃', name: 'Tării' },
      { emoji: '🍷', name: 'Vin' },
      { emoji: '🍹', name: 'Cocktailuri' },
    ],
  },
  {
    id: 'restaurant',
    label: 'Restaurant',
    emoji: '🍽️',
    description: 'Aperitive, fel principal, desert, vinuri',
    categoriesCount: 4,
    productsCount: 12,
    sampleCategories: [
      { emoji: '🥗', name: 'Aperitive' },
      { emoji: '🍝', name: 'Fel principal' },
      { emoji: '🍰', name: 'Desert' },
      { emoji: '🥤', name: 'Băuturi' },
    ],
  },
  {
    id: 'pizzerie',
    label: 'Pizzerie',
    emoji: '🍕',
    description: 'Pizza la cuptor, paste, salate, băuturi',
    categoriesCount: 4,
    productsCount: 12,
    sampleCategories: [
      { emoji: '🍕', name: 'Pizza' },
      { emoji: '🍝', name: 'Paste' },
      { emoji: '🥗', name: 'Salate' },
      { emoji: '🥤', name: 'Băuturi' },
    ],
  },
  {
    id: 'cocktail_bar',
    label: 'Cocktail Bar',
    emoji: '🍸',
    description: 'Signature cocktails, spirits premium, vinuri',
    categoriesCount: 4,
    productsCount: 11,
    sampleCategories: [
      { emoji: '🍸', name: 'Signature' },
      { emoji: '🥃', name: 'Spirits' },
      { emoji: '🍷', name: 'Vin' },
      { emoji: '🍫', name: 'Bites' },
    ],
  },
  {
    id: 'altul',
    label: 'Altul',
    emoji: '🏪',
    description: 'Setup minim (1 categorie + 1 produs) — configurezi tu tot',
    categoriesCount: 1,
    productsCount: 1,
    sampleCategories: [{ emoji: '🍽️', name: 'Produse' }],
  },
]

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
    // obiectul PostgREST brut nu e `instanceof Error`, iar QuickSetupTab
    // afișa „Eroare” generic în loc de motivul refuzului.
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

export interface BulkTablesResult {
  status: 'success'
  inserted: number
  skipped: number
}

export async function bulkCreateTables(
  restaurantId: string,
  zones: string[], // []  → fără zone, "Masa N"
  perZone: number,
): Promise<BulkTablesResult> {
  const { data, error } = await supabase.rpc('bulk_create_tables', {
    p_restaurant_id: restaurantId,
    p_zones: zones,
    p_per_zone: perZone,
  })
  if (error) throw error
  return data as BulkTablesResult
}

// ── Bulk invite via existing Netlify function ────────────────
export interface InviteResult {
  email: string
  ok: boolean
  error?: string
}

export async function sendInvite(
  // Rolurile acceptate de send-invite.js — 'admin' e respins server-side (400),
  // deci nu-l mai oferim din tip (audit săpt. 10).
  email: string,
  role: 'manager' | 'waiter' | 'kitchen',
  restaurantId: string,
  restaurantName: string,
  invitedByName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // send-invite.js cere Authorization: Bearer <jwt> (getUser pe token) —
    // fără el răspundea 401 la fiecare invitație (funcționalitate moartă).
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { ok: false, error: 'Sesiune expirată — reautentifică-te.' }
    }
    const res = await fetch(fnUrl('send-invite'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email,
        role,
        restaurant_id: restaurantId,
        restaurant_name: restaurantName,
        invited_by_name: invitedByName,
      }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, error: txt || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
