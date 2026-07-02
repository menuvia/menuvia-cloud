// founder.ts — client tipizat pentru RPC-urile de platform admin (mig 186)
// + mecanica „mod fondator" (intră pe contul unui restaurant).
//
// Mod fondator: FounderPage scrie id-ul restaurantului țintă în localStorage
// și navighează la /dashboard. RestaurantContext + useRestaurants detectează
// cheia și încarcă restaurantul țintă (RLS-ul lasă platform admin-ul prin
// is_member/is_admin, extinse în mig 186). Bannerul din DashboardPage arată
// clar pe ce cont ești; „Ieși" curăță cheia și revine la /founder.
import { supabase } from './supabase'

// ── Mod fondator (localStorage) ──────────────────────────────
const FOUNDER_VIEW_KEY = 'menuvia_founder_view'

export function getFounderView(): string | null {
  try {
    return localStorage.getItem(FOUNDER_VIEW_KEY)
  } catch {
    return null
  }
}

export async function enterFounderView(restaurantId: string): Promise<void> {
  try {
    localStorage.setItem(FOUNDER_VIEW_KEY, restaurantId)
  } catch {
    /* private mode — modul fondator nu poate persista */
  }
  // Vizita se înregistrează în audit (mig 187) — best-effort: o eroare de
  // rețea nu blochează intrarea (gate-ul real de acces rămâne RLS-ul).
  try {
    await supabase.rpc('log_partner_visit', { p_restaurant_id: restaurantId })
  } catch {
    /* best-effort */
  }
  window.location.href = '/dashboard'
}

// target: /founder pentru fondator, /afiliat pentru partener.
export function exitFounderView(target: string = '/founder'): void {
  try {
    localStorage.removeItem(FOUNDER_VIEW_KEY)
  } catch {
    /* ignore */
  }
  window.location.href = target
}

export function clearFounderView(): void {
  try {
    localStorage.removeItem(FOUNDER_VIEW_KEY)
  } catch {
    /* ignore */
  }
}

// ── Tipuri răspunsuri RPC ────────────────────────────────────
export interface PlatformOverview {
  restaurants_total: number
  restaurants_active: number
  restaurants_by_plan: Record<string, number>
  orders_today: number
  reservations_today: number
  emails_failed: number
  invoices_failed: number
  payouts_open: number
  health_critical: number
}

export interface AdminRestaurantRow {
  restaurant_id: string
  name: string
  slug: string
  city: string | null
  is_active: boolean
  plan: string
  owner_email: string
  health_score: number | null
  health_trend: string | null
  orders_7d: number
  created_at: string
}

export interface AdminHealthRow {
  restaurant_id: string
  restaurant_name: string
  score: number
  trend: string | null
  score_login: number
  score_orders: number
  score_team: number
  score_tickets: number
  score_engagement: number
  computed_at: string
}

export interface AdminEmailFailure {
  id: string
  recipient_email: string
  template_kind: string
  failed_attempts: number
  last_error: string | null
  scheduled_for: string
  created_at: string
}

export interface AdminInvoiceFailure {
  id: string
  restaurant_id: string
  restaurant_name: string
  customer_name: string
  total_with_vat: number
  currency: string
  failed_attempts: number
  last_error: string | null
  created_at: string
}

export interface AdminPayoutRow {
  id: string
  affiliate_id: string
  affiliate_email: string
  status: string
  gross_cents: number
  currency: string
  invoice_number: string | null
  wise_transfer_id: string | null
  failure_reason: string | null
  paid_at: string | null
  created_at: string
}

export interface AdminAffiliateRestaurant {
  restaurant_id: string
  name: string
  slug: string
  plan: string
  is_active: boolean
}

export interface AdminAffiliateRow {
  affiliate_id: string
  email: string
  full_name: string | null
  referral_code: string
  status: string
  parent_affiliate_id: string | null
  balance_ron_cents: number
  restaurants: AdminAffiliateRestaurant[]
  created_at: string
  // Comisioane (mig 188) — OPȚIONALE: frontend-ul poate ajunge în producție
  // înaintea migrației; UI afișează „—" când lipsesc.
  setup_bps?: number
  recurring_bps?: number
  cascade_bps?: number
  recurring_cap_months?: number
}

export interface AdminAuditRow {
  id: string
  actor_email: string
  actor_kind: string
  restaurant_id: string | null
  restaurant_name: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export interface AdminActionResult {
  ok: boolean
  error?: string
  old_plan?: string
  new_plan?: string
}

// ── Apeluri RPC ──────────────────────────────────────────────
async function rpcJson<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export function getPlatformOverview(): Promise<PlatformOverview> {
  return rpcJson<PlatformOverview>('admin_platform_overview')
}

export function listRestaurants(): Promise<AdminRestaurantRow[]> {
  return rpcJson<AdminRestaurantRow[]>('admin_list_restaurants')
}

export function listHealth(): Promise<AdminHealthRow[]> {
  return rpcJson<AdminHealthRow[]>('admin_list_health')
}

export function listEmailFailures(): Promise<AdminEmailFailure[]> {
  return rpcJson<AdminEmailFailure[]>('admin_list_email_failures')
}

export function retryEmail(id: string): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_retry_email', { p_id: id })
}

export function listInvoiceFailures(): Promise<AdminInvoiceFailure[]> {
  return rpcJson<AdminInvoiceFailure[]>('admin_list_invoice_failures')
}

export function retryInvoice(id: string): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_retry_invoice', { p_id: id })
}

export function listPayouts(): Promise<AdminPayoutRow[]> {
  return rpcJson<AdminPayoutRow[]>('admin_list_payouts')
}

export function markPayoutPaid(id: string, wiseTransferId?: string): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_mark_payout_paid', {
    p_id: id,
    p_wise_transfer_id: wiseTransferId ?? null,
  })
}

export function listAffiliates(): Promise<AdminAffiliateRow[]> {
  return rpcJson<AdminAffiliateRow[]>('admin_list_affiliates')
}

export function setRestaurantPlan(restaurantId: string, plan: string): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_set_restaurant_plan', {
    p_restaurant_id: restaurantId,
    p_plan: plan,
  })
}

export function toggleRestaurantActive(
  restaurantId: string,
  active: boolean,
): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_toggle_restaurant_active', {
    p_restaurant_id: restaurantId,
    p_active: active,
  })
}

export function listAuditLog(limit = 100): Promise<AdminAuditRow[]> {
  return rpcJson<AdminAuditRow[]>('admin_list_audit_log', { p_limit: limit })
}

// ── Comisioane afiliat (mig 188) ─────────────────────────────
export interface AffiliateCommissionDefaults {
  ok: boolean
  setup_bps: number
  recurring_bps: number
  cascade_bps: number
  recurring_cap_months: number
  updated_at: string | null
}

export interface CommissionInput {
  setupBps: number
  recurringBps: number
  cascadeBps: number
  capMonths: number
}

export function getAffiliateDefaults(): Promise<AffiliateCommissionDefaults> {
  return rpcJson<AffiliateCommissionDefaults>('admin_get_affiliate_defaults')
}

export function setAffiliateDefaults(v: CommissionInput): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_set_affiliate_defaults', {
    p_setup_bps: v.setupBps,
    p_recurring_bps: v.recurringBps,
    p_cascade_bps: v.cascadeBps,
    p_cap_months: v.capMonths,
  })
}

export function setAffiliateCommission(
  affiliateId: string,
  v: CommissionInput,
): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('admin_set_affiliate_commission', {
    p_affiliate_id: affiliateId,
    p_setup_bps: v.setupBps,
    p_recurring_bps: v.recurringBps,
    p_cascade_bps: v.cascadeBps,
    p_cap_months: v.capMonths,
  })
}

export function applyDefaultsToAllAffiliates(): Promise<
  AdminActionResult & { updated_count?: number }
> {
  return rpcJson<AdminActionResult & { updated_count?: number }>(
    'admin_apply_defaults_to_all_affiliates',
  )
}

// ── Acces partener (afiliați → restaurantele atribuite lor, mig 187) ──
export interface PartnerRestaurant {
  restaurant_id: string
  name: string
  slug: string
  city: string | null
  is_active: boolean
  plan: string
}

export interface PartnerAccessRow {
  attribution_id: string
  affiliate_email: string
  affiliate_name: string | null
  revoked_at: string | null
}

export function listPartnerRestaurants(): Promise<PartnerRestaurant[]> {
  return rpcJson<PartnerRestaurant[]>('list_partner_restaurants')
}

export function getPartnerAccess(restaurantId: string): Promise<PartnerAccessRow[]> {
  return rpcJson<PartnerAccessRow[]>('get_partner_access', { p_restaurant_id: restaurantId })
}

export function revokeAffiliateAccess(restaurantId: string): Promise<AdminActionResult> {
  return rpcJson<AdminActionResult>('revoke_affiliate_access', { p_restaurant_id: restaurantId })
}
