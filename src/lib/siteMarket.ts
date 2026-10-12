// src/lib/siteMarket.ts
// ─────────────────────────────────────────────────────────────
// Ce se VINDE pe fiecare site (decizie de fondator, oct 2026):
//   menuvia.ro  → toate cele 3 planuri, RON, checkout deschis (NESCHIMBAT).
//   menuvia.com → DOAR Planurile 1–2. Plan 3 (Fiscalizare) e românesc prin
//                 construcție (casă de marcat RO, TVA RO) și nu se oferă.
//                 Nu există încă prețuri în EUR în Stripe (un singur price ID
//                 per plan, în RON) → checkout-ul e ÎNCHIS pe .com, cu mesaj
//                 explicit, NU cu prețuri inventate.
// Regula de aur e ținută în DATE (mig 296: feature-urile românești sunt false
// pentru `country <> 'RO'`); filtrele de aici sunt doar ce ARĂTĂM.
// ─────────────────────────────────────────────────────────────
import type { CheckoutFailure } from './checkout'
import type { Site } from './domain'
import type { PlanComparisonRow, PlanId } from './plans'

export const SITE_PLAN_IDS: Readonly<Record<Site, readonly PlanId[]>> = {
  ro: ['starter', 'growth', 'pro'],
  com: ['starter', 'growth'],
}

/** Planurile oferite pe site, în ordinea din sursă. Pe 'ro' = lista întreagă. */
export function plansForSite<T extends { id: PlanId }>(site: Site, plans: readonly T[]): T[] {
  const allowed = SITE_PLAN_IDS[site]
  return plans.filter((p) => allowed.includes(p.id))
}

/**
 * Rândurile tabelului comparativ care spun ceva pe coloanele vizibile: un rând
 * care e `false` pe TOATE planurile afișate (ex. „Bon fiscal + casă de marcat"
 * pe .com) ar fi doar o listă de liniuțe despre un produs care nu se vinde
 * acolo. Pe 'ro' fiecare rând are o valoare pe Plan 3, deci lista e întreagă.
 */
export function comparisonRowsForSite(
  site: Site,
  rows: readonly PlanComparisonRow[],
): PlanComparisonRow[] {
  const cols = SITE_PLAN_IDS[site]
  return rows.filter((row) => cols.some((c) => row[c] !== false))
}

/** Checkout-ul Stripe (prețuri RON) e deschis doar pe .ro. */
export function checkoutOpenOnSite(site: Site): boolean {
  return site === 'ro'
}

/**
 * Motivul afișat când cineva încearcă să activeze un plan pe un site cu
 * checkout-ul închis. În engleză: e .com (pagina de prețuri .ro nu ajunge
 * niciodată aici). Acțiunea `contact` oferă butonul de WhatsApp.
 */
export function siteCheckoutClosedFailure(): CheckoutFailure {
  return {
    code: 'site_checkout_unavailable',
    message:
      'Online sign-up on menuvia.com is coming soon (EUR pricing is not live yet). Write to us and we will set up your restaurant.',
    action: 'contact',
  }
}
