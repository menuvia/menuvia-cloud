// src/lib/siteMarket.ts
// ─────────────────────────────────────────────────────────────
// Ce se VINDE pe fiecare site (decizie de fondator, oct 2026):
//   menuvia.ro  → toate cele 3 planuri, RON, checkout deschis (NESCHIMBAT).
//   hostul .com → DOAR Planurile 1–2. Plan 3 (Fiscalizare) e românesc prin
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
import { PLAN_LABELS } from './constants'

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
      'Online sign-up is coming soon on this site (EUR pricing is not live yet). Write to us and we will set up your restaurant.',
    action: 'contact',
  }
}

// ── Copy de pe pagina de prețuri care NU se vinde pe .com ────
// Review #288: pe .com FAQ-ul recomanda Fiscalizarea, iar extra-urile cu plată
// unică afișau prețuri în lei. Pe 'ro' ambele funcții întorc lista INTACTĂ
// (aceleași obiecte, aceeași ordine — clichet SM4/SM5).

// Orice mențiune a Planului 3 / fiscalizării. Numele comercial vine din
// PLAN_LABELS (sursa unică); restul sunt termenii fiscali din copy. NU „bon"
// singur: e subșir în „abonament" (ar scoate FAQ-ul de facturare).
const FISCAL_MENTION = new RegExp(
  [PLAN_LABELS.pro, 'Plan 3', 'fiscal', 'casă de marcat', 'casa de marcat', 'case de marcat']
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'i',
)
// Preț în moneda .ro („300 lei", „99 RON").
const RON_PRICE = /\blei\b|\bRON\b/i

/** FAQ-ul pentru site: pe 'com' fără întrebările care vând/explică Planul 3. */
export function faqForSite<T extends { q: string; a: string }>(site: Site, items: readonly T[]): T[] {
  if (site === 'ro') return [...items]
  return items.filter((it) => !FISCAL_MENTION.test(`${it.q} ${it.a}`))
}

/**
 * Extra-urile (servicii cu plată) pentru site: pe 'com' fără cele cu preț în
 * lei — nu există prețuri EUR, iar un preț în lei pe .com e un preț inventat
 * pentru piața greșită.
 */
export function extrasForSite<T extends { price: string }>(site: Site, items: readonly T[]): T[] {
  if (site === 'ro') return [...items]
  return items.filter((it) => !RON_PRICE.test(it.price))
}
