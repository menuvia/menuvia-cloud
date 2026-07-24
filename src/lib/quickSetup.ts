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

// ── VAT preset definitions ───────────────────────────────────
export type VatPreset = 'simple_19' | 'food_9' | 'tourism_5'

export interface VatPresetPreview {
  id: VatPreset
  label: string
  description: string
  rates: { group: number; rate: number; label: string }[]
  recommended?: BusinessType[]
}

export const VAT_PRESETS: VatPresetPreview[] = [
  {
    id: 'simple_19',
    label: 'Simplu — 19%',
    description:
      'O singură cotă aplicată pe tot. Cel mai ușor de gestionat. Bun pentru baruri și unele cafenele.',
    rates: [{ group: 1, rate: 19, label: 'Cotă standard 19%' }],
    recommended: ['bar', 'cocktail_bar'],
  },
  {
    id: 'food_9',
    label: 'Mâncare 9% + Alcool 19%',
    description:
      'Cea mai întâlnită combinație în HoReCa: 9% pentru consum în local (mâncare, băuturi nealcoolice), 19% pentru alcool.',
    rates: [
      { group: 1, rate: 9, label: 'Cotă redusă 9% — mâncare' },
      { group: 2, rate: 19, label: 'Cotă standard 19% — alcool' },
    ],
    recommended: ['cafenea', 'restaurant', 'pizzerie'],
  },
  {
    id: 'tourism_5',
    label: 'Turism — 5% + 9% + 19%',
    description: 'Pentru hoteluri/pensiuni cu restaurant: 5% cazare, 9% restaurant, 19% alcool.',
    rates: [
      { group: 1, rate: 9, label: 'Cotă restaurant 9%' },
      { group: 2, rate: 19, label: 'Cotă standard 19%' },
      { group: 3, rate: 5, label: 'Cotă turism 5%' },
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
  if (error) throw error
  return data as VatPresetResult
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
