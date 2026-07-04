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
  if (error) {
    // Eroare de infrastructură (permission denied, network fail etc.) —
    // NU e același lucru cu „restaurantul nu are acest feature". Logăm
    // explicit ca să fie vizibilă în monitoring, distinctă de un „nu"
    // legitim de business. Valoarea de retur rămâne null (backward-compat).
    console.error(
      '[features] fetchRestaurantFeatures RPC error:',
      error.code,
      error.message,
      { restaurantId },
    )
    return null
  }
  if (!data) return null
  return data as RestaurantFeatures
}

// ── Helpers ─────────────────────────────────────────────────

export function hasFeature(features: RestaurantFeatures | null, name: FeatureName): boolean {
  if (!features) return false
  return features.features[name]?.enabled ?? false
}

export function getLimit(features: RestaurantFeatures | null, name: FeatureName): number | null {
  // Delegăm la getLimitDetailed (unica sursă a lookup-ului) și re-comprimăm
  // rezultatul discriminat la number | null (contract public neschimbat):
  //   disabled → 0, unlimited → null, limited → n.
  const d = getLimitDetailed(features, name)
  switch (d.kind) {
    case 'disabled':
      return 0
    case 'unlimited':
      return null
    case 'limited':
      return d.n
  }
}

// Rezultat discriminat pentru getLimitDetailed — distinge explicit cele
// 3 stări pe care getLimit() le comprimă în number | null:
//   - 'disabled'  → feature-ul e complet dezactivat pt acest plan (getLimit → 0)
//   - 'limited'   → feature-ul e activ, plafonat la `n` (getLimit → n)
//   - 'unlimited' → feature-ul e activ, fără plafon      (getLimit → null)
// Notă: getLimit() întoarce 0 și pt „dezactivat" ȘI pt „limitat la 0", ceea
// ce e ambiguu pentru consumatori care vor să distingă cele două cazuri.
export type LimitDetail =
  | { kind: 'disabled' }
  | { kind: 'limited'; n: number }
  | { kind: 'unlimited' }

export function getLimitDetailed(
  features: RestaurantFeatures | null,
  name: FeatureName,
): LimitDetail {
  if (!features) return { kind: 'disabled' }
  const f = features.features[name]
  if (!f?.enabled) return { kind: 'disabled' }
  if (f.limit === null || f.limit === undefined) return { kind: 'unlimited' }
  return { kind: 'limited', n: f.limit }
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

// Suggest upgrade path: from current plan, what's next.
// Notă: întoarce null atât pentru „deja la maxim" (enterprise) cât și pentru
// „plan necunoscut" (nu există în `order`) — semnătura publică rămâne
// string | null (consumatori: UpgradePrompt.tsx are deja fallback tolerant
// la null; testele din features.test.ts fixează acest contract). Pentru
// diagnostic, distingem intern cele două cazuri printr-un warn — un plan
// necunoscut e un semnal de date corupte/plan nou nemapat, nu un „normal".
export function suggestUpgrade(currentPlan: string): string | null {
  // Delegăm la varianta discriminată (unica sursă a listei `order` + logicii)
  // și re-comprimăm la string | null. Păstrăm warn-ul diagnostic pentru plan
  // necunoscut — atât 'unknown' cât și 'max' rămân null (contract neschimbat).
  const s = suggestUpgradeDetailed(currentPlan)
  if (s.kind === 'unknown') {
    console.warn('[features] suggestUpgrade: plan necunoscut', { currentPlan })
    return null
  }
  if (s.kind === 'max') return null // deja la maxim (enterprise)
  return s.plan
}

// Variantă discriminată a suggestUpgrade — pentru consumatori noi care
// vor să trateze diferit „deja la maxim" vs. „plan necunoscut" în UI
// (ex: afișează mesaje diferite), fără să schimbe contractul funcției
// existente (folosită de UpgradePrompt.tsx și de testele curente).
export type UpgradeSuggestion =
  | { kind: 'next'; plan: string }
  | { kind: 'max' }
  | { kind: 'unknown' }

export function suggestUpgradeDetailed(currentPlan: string): UpgradeSuggestion {
  const order = ['free', 'starter', 'growth', 'pro', 'enterprise']
  const idx = order.indexOf(currentPlan)
  if (idx < 0) return { kind: 'unknown' }
  if (idx === order.length - 1) return { kind: 'max' }
  return { kind: 'next', plan: order[idx + 1] }
}

// Planul intern reprezentativ pentru fiecare tier comercial (oglindește
// getPlanByInternalId din plans.ts): tier 1 → starter (Meniu Digital),
// tier 2 → growth (Meniu + Comenzi), tier 3 → pro (Fiscalizare).
const TIER_REPRESENTATIVE_PLAN: Record<PlanTier, string> = {
  1: 'starter',
  2: 'growth',
  3: 'pro',
}

// Numele COMERCIAL al tier-ului minim care deblochează un feature.
// Folosit de UpgradePrompt ca să indice planul-țintă CORECT (tier-ul
// feature-ului blocat), nu următorul pas orb de pe scara de planuri.
export function planNameForTier(tier: PlanTier): string {
  return PLAN_NAMES[TIER_REPRESENTATIVE_PLAN[tier]]
}
