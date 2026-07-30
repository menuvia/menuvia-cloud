// ─────────────────────────────────────────────────────────────
// loyalty.ts — clientul pentru Loyalty v1 (mig 226).
// Identitate = hibrid A+B (docs/LOYALTY.md): un card anonim per browser
// (anon_id în localStorage) + telefon OPȚIONAL care upgrade-ază wallet-ul
// server-side. Telefonul nu părăsește clientul decât spre RPC (unde e
// stocat DOAR ca md5); local îl ținem ca să-l retrimitem la comenzile
// următoare fără să-l mai ceară.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

const ANON_KEY = 'menuvia_loyalty_anon_id'
const PHONE_KEY = 'menuvia_loyalty_phone'

// ID anonim persistent per browser (cardul digital). Generat o singură dată;
// respectă regexul server-side ^[A-Za-z0-9_-]{8,64}$.
export function getLoyaltyAnonId(): string | null {
  try {
    let id = localStorage.getItem(ANON_KEY)
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = crypto.randomUUID().replace(/-/g, '')
      localStorage.setItem(ANON_KEY, id)
    }
    return id
  } catch {
    // Private mode: fără persistență → cardul nu poate exista pe device.
    return null
  }
}

export function getStoredLoyaltyPhone(): string {
  try {
    return localStorage.getItem(PHONE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function storeLoyaltyPhone(phone: string): void {
  try {
    if (phone.trim()) localStorage.setItem(PHONE_KEY, phone.trim())
    else localStorage.removeItem(PHONE_KEY)
  } catch {
    /* private mode — merge și fără */
  }
}

export interface LoyaltyState {
  enabled: boolean
  points_per_leu?: number
  reward_threshold?: number
  reward_description?: string
  points?: number
  short_code?: string | null
  reward_available?: boolean
}

// Starea cardului pentru meniul QR. `null` = eroare de rețea/RPC nedeployat
// (UI-ul ascunde secțiunea, fără zgomot) — distinct de {enabled:false}.
export async function fetchLoyaltyState(qrTokenId: string): Promise<LoyaltyState | null> {
  const { data, error } = await supabase.rpc('get_loyalty_state', {
    p_qr_token_id: qrTokenId,
    p_anon_id: getLoyaltyAnonId(),
    p_phone: getStoredLoyaltyPhone() || null,
  })
  if (error) {
    console.warn('[loyalty] fetchLoyaltyState:', error.code, error.message)
    return null
  }
  return data as LoyaltyState
}

// Leagă o comandă proaspăt creată de wallet (creează/upgrade-ază wallet-ul).
// Best-effort: eșecul nu are voie să afecteze fluxul de comandă.
export async function attachOrderToLoyalty(
  orderId: string,
  qrTokenId: string,
  phone?: string,
): Promise<{ ok: boolean; points?: number; short_code?: string }> {
  const { data, error } = await supabase.rpc('loyalty_attach_order', {
    p_order_id: orderId,
    p_qr_token_id: qrTokenId,
    p_anon_id: getLoyaltyAnonId(),
    p_phone: phone?.trim() || getStoredLoyaltyPhone() || null,
  })
  if (error) {
    console.warn('[loyalty] attachOrder:', error.code, error.message)
    return { ok: false }
  }
  return data as { ok: boolean; points?: number; short_code?: string }
}

// Staff-only: răscumpără recompensa pe codul scurt al cardului clientului.
export async function redeemLoyaltyReward(
  restaurantId: string,
  code: string,
): Promise<{ ok: boolean; reason?: string; reward_description?: string; points_left?: number; points?: number; threshold?: number }> {
  const { data, error } = await supabase.rpc('redeem_loyalty_reward', {
    p_restaurant_id: restaurantId,
    p_code: code.trim(),
  })
  if (error) throw new Error(error.message)
  return data as {
    ok: boolean
    reason?: string
    reward_description?: string
    points_left?: number
    points?: number
    threshold?: number
  }
}
