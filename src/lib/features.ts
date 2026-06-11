// ─────────────────────────────────────────────────────────────
// features.ts — Plan limits + feature gates
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export type FeatureName =
  | 'menu_qr'
  | 'order_qr'
  | 'kitchen_dashboard'
  | 'waiter_manual'
  | 'pickup_orders'
  | 'extras_pairings'
  | 'modifiers'
  | 'stocks'
  | 'recipes'
  | 'profitability'
  | 'ai_import'
  | 'analytics_advanced'
  | 'reports_pdf'
  | 'reports_vat'
  | 'floor_plan'
  | 'shifts'
  | 'split_bill'
  | 'themes'
  | 'remove_branding'
  | 'max_products'
  | 'max_tables'
  | 'max_team_members'

export interface FeatureLimit {
  enabled: boolean
  limit: number | null
}

export interface RestaurantFeatures {
  plan: string
  features: Record<string, FeatureLimit>
}

export async function fetchRestaurantFeatures(
  restaurantId: string,
): Promise<RestaurantFeatures | null> {
  const { data, error } = await supabase.rpc('get_restaurant_features', {
    p_restaurant_id: restaurantId,
  })
  if (error || !data) return null
  return data as RestaurantFeatures
}

// ── Helpers ─────────────────────────────────────────────────

export function hasFeature(features: RestaurantFeatures | null, name: FeatureName): boolean {
  if (!features) return false
  return features.features[name]?.enabled ?? false
}

export function getLimit(features: RestaurantFeatures | null, name: FeatureName): number | null {
  if (!features) return 0
  const f = features.features[name]
  if (!f?.enabled) return 0
  return f.limit ?? null // null = unlimited
}

export function isWithinLimit(
  features: RestaurantFeatures | null,
  name: FeatureName,
  currentCount: number,
): boolean {
  const limit = getLimit(features, name)
  if (limit === null) return true // unlimited
  return currentCount < limit
}

// ── Taxonomie comercială: 3 planuri ─────────────────────────
// Intern păstrăm free/starter/growth/pro/enterprise (DB, Stripe, gating),
// dar clientul vede DOAR 3 concepte: Meniu Digital / Meniu + Comenzi /
// Fiscalizare. Regula de aur: bani + bon = Plan 3, fără excepții.
//   tier 1 — Meniu Digital      (free = trial/demo, starter)
//   tier 2 — Meniu + Comenzi    (growth) — FĂRĂ bani: plata pe casa existentă
//   tier 3 — Fiscalizare        (pro, enterprise) — plăți, casă, TVA, facturi
export type PlanTier = 1 | 2 | 3

export function planTier(plan: string | null | undefined): PlanTier {
  switch (plan) {
    case 'pro':
    case 'enterprise':
      return 3
    case 'growth':
      return 2
    default:
      // 'free', 'starter' sau plan necunoscut → cel mai restrictiv
      return 1
  }
}

// User-friendly plan names — numele COMERCIALE (cele 3 concepte publice)
export const PLAN_NAMES: Record<string, string> = {
  free: 'Demo gratuit',
  starter: '📖 Meniu Digital',
  growth: '🛎 Meniu + Comenzi',
  pro: '🧾 Fiscalizare',
  enterprise: '🏢 Custom / Lanțuri',
}

// Suggest upgrade path: from current plan, what's next
export function suggestUpgrade(currentPlan: string): string | null {
  const order = ['free', 'starter', 'growth', 'pro', 'enterprise']
  const idx = order.indexOf(currentPlan)
  if (idx < 0 || idx === order.length - 1) return null
  return order[idx + 1]
}
