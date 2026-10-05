// Fixtură ÎNGHEȚATĂ: starea FINALĂ a lui `plan_features` + `plan_limits` după
// replay-ul complet al lanțului (285 de migrații, 5 oct 2026). Ultimele scrieri
// per (plan, feature) vin din mig 028, 062, 083, 086, 089, 094, 150, 176, 203,
// 226, 227, 228. Regenerare (pe un replay `KEEP=1`):
//
//   select feature, plan, enabled, limit_value from plan_features;
//   select plan, max_products, max_restaurants, max_tables from plan_limits;
//
// Un rând LIPSĂ din `plan_features` = feature dezactivat (`restaurant_has_feature`
// întoarce false), deci aici e `false`. Fixtura e consumată de `planCopy.test.ts`:
// orice rând de pe pagina de prețuri pentru starter/growth trebuie să fie legat
// de un feature activ AICI. Când o migrație schimbă matricea, se actualizează
// fixtura ÎN ACELAȘI PR — iar testul spune ce promisiune a rămas fără acoperire.

export type DbPlan = 'free' | 'starter' | 'growth' | 'pro' | 'enterprise'

export const DB_PLANS: readonly DbPlan[] = ['free', 'starter', 'growth', 'pro', 'enterprise']

type Row = Readonly<Record<DbPlan, boolean>>
const row = (free: boolean, starter: boolean, growth: boolean, pro: boolean): Row => ({
  free,
  starter,
  growth,
  pro,
  enterprise: true,
})

/** `plan_features.enabled` (fără limite numerice). */
export const PLAN_FEATURE_MATRIX = {
  menu_qr: row(true, true, true, true),
  themes: row(false, true, true, true),
  order_qr: row(false, false, true, true),
  kitchen_dashboard: row(false, false, true, true),
  kitchen_tickets: row(false, false, true, true),
  waiter_manual: row(false, false, true, true),
  pickup_orders: row(false, false, true, true),
  table_lifecycle: row(false, false, true, true),
  loyalty: row(false, false, true, true),
  extras_pairings: row(false, false, true, true),
  modifiers: row(false, false, true, true),
  stocks: row(false, false, true, true),
  recipes: row(false, false, true, true),
  profitability: row(false, false, true, true),
  remove_branding: row(false, false, true, true),
  reports_pdf: row(false, false, true, true),
  reservations_revenue: row(false, false, true, true),
  // `sms_notifications` e ACTIV de pe starter (plafon 100/300/500/1000), dar
  // worker-ul e pe Netlify — de aceea NU se promite pe pagină, deși DB îl dă.
  sms_notifications: row(false, true, true, true),
  // `ai_import` (pro+) nu mai e citit de nimeni: cota reală e
  // `ai_quota.included_tokens` (50.000, egală pe toate planurile, mig 168).
  ai_import: row(false, false, false, true),
  analytics_advanced: row(false, false, false, true),
  fiscal_receipt: row(false, false, false, true),
  floor_plan: row(false, false, false, true),
  online_payments: row(false, false, false, true),
  reports_vat: row(false, false, false, true),
  shifts: row(false, false, false, true),
  split_bill: row(false, false, false, true),
} as const satisfies Record<string, Row>

export type DbFeature = keyof typeof PLAN_FEATURE_MATRIX

/** Limitele numerice (`plan_features.limit_value` + `plan_limits`). null = nelimitat. */
export const PLAN_LIMIT_MATRIX: Readonly<
  Record<
    'max_products' | 'max_tables' | 'max_team_members' | 'max_restaurants',
    Readonly<Record<DbPlan, number | null>>
  >
> = {
  max_products: { free: 15, starter: 300, growth: 1000, pro: 2000, enterprise: null },
  max_tables: { free: 3, starter: 120, growth: 300, pro: 500, enterprise: null },
  max_team_members: { free: 1, starter: 1, growth: 10, pro: 1000, enterprise: null },
  // plan_limits.max_restaurants — planul e pe CONT (owner); enterprise = 1e9.
  max_restaurants: { free: 1, starter: 1, growth: 1, pro: 2, enterprise: null },
}
