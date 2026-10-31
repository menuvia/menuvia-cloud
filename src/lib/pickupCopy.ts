// ─────────────────────────────────────────────────────────────
// pickupCopy.ts — ce îi spune dashboard-ul OWNER-ului despre ridicare.
//
// Din mig 309, pagina publică /m/:slug arată ridicarea DOAR când restaurantul
// are feature-ul `pickup_orders` (gate la CITIRE în `get_restaurant_by_slug`).
// Setarea stocată `pickup_settings.enabled` NU are niciun gate: comutatorul din
// Setări apare pe orice plan, iar butonul „Nu am mese — doar ridicare” din
// onboarding o pornește INTENȚIONAT pe Planul 1. Înainte de 309, refuzul de la
// `create_order` era singurul semnal că ridicarea cere alt plan; după 309,
// fără textele de aici, owner-ul vedea „pornit” în dashboard (Setări, Mese),
// punea QR-ul general pe tejghea, iar oaspeții lui vedeau doar meniul — tăcut.
//
// Tristate pe feature (tiparul `paymentsEnabled`): `null` = planul NU e
// cunoscut (features neîncărcate / RPC picat) → nici promisiunea „clienții pot
// comanda”, nici avertismentul de plan. Feature-ul se citește din planul
// RESTAURANTULUI (`useFeatures(restaurant.id)`), nu din `profile.plan`.
// ─────────────────────────────────────────────────────────────
import { hasFeature, planNameForTier, type PlanTier, type RestaurantFeatures } from './features'

/**
 * Tier-ul minim care include `pickup_orders` (growth = Meniu + Comenzi).
 * Legat de matricea reală din DB prin testul PK4 (`planFeatureMatrix.fixture`).
 */
export const PICKUP_MIN_TIER: PlanTier = 2

/** Numele COMERCIAL al planului care deblochează ridicarea (din `PLAN_LABELS`). */
export function pickupPlanName(): string {
  return planNameForTier(PICKUP_MIN_TIER)
}

/**
 * `pickup_orders` al restaurantului, tristate: `true`/`false` = CUNOSCUT,
 * `null` = features neîncărcate sau eroare de citire.
 */
export function pickupFeatureState(features: RestaurantFeatures | null): boolean | null {
  if (!features) return null
  return hasFeature(features, 'pickup_orders')
}

/**
 * Descrierea cardului „Comenzi pentru ridicare” din Setări, în jurul linkului
 * paginii publice (`lead` + link + `tail`). Promisiunea de comenzi DOAR pe
 * feature CUNOSCUT activ.
 */
export function pickupCardDescription(feature: boolean | null): { lead: string; tail: string } {
  if (feature === true) {
    return {
      lead: 'Activează pagina ta publică',
      tail:
        '. Clienții pot comanda fără să scaneze QR și ridică direct de la restaurant. Plata cash la ridicare.',
    }
  }
  return {
    lead: 'Comenzi cu ridicare de la restaurant, de pe pagina ta publică',
    tail: '.',
  }
}

/**
 * Avertismentul de plan din cardul de ridicare — DOAR pe feature CUNOSCUT
 * absent. Cu ridicarea pornită spune explicit ce vede oaspetele; comutatorul
 * rămâne activ (setarea se păstrează pentru re-urcare).
 */
export function pickupPlanWarning(enabled: boolean, feature: boolean | null): string | null {
  if (feature !== false) return null
  const plan = pickupPlanName()
  if (enabled) {
    return (
      `Ridicarea e pornită, dar planul curent nu o include: pe pagina publică clienții văd ` +
      `doar meniul și nu pot comanda. Comenzile pentru ridicare necesită planul ${plan} — ` +
      `setarea rămâne salvată și se aplică la trecerea pe acest plan.`
    )
  }
  return `Comenzile pentru ridicare necesită planul ${plan} — pe planul curent pagina publică arată doar meniul.`
}

/** Textul cardului „QR meniu general” (Mese), după „Duce la /m/slug — ”. */
export function generalMenuQrText(feature: boolean | null): string {
  return feature === true
    ? 'clienții văd meniul; cu comenzile pentru ridicare active pot și comanda. Bun pentru vitrină, flyere sau tejghea.'
    : 'clienții văd meniul. Bun pentru vitrină, flyere sau tejghea.'
}

/**
 * Empty state-ul modului „doar ridicare” (Mese, fără nicio masă). „Clienții
 * comandă” DOAR cu ridicarea pornită ȘI feature-ul cunoscut activ.
 */
export function pickupOnlyEmptyStateText(enabled: boolean, feature: boolean | null): string {
  const head = 'Mod „doar ridicare" activ — nu ai nevoie de mese.'
  const tail = 'Poți adăuga mese oricând, dacă situația se schimbă.'
  if (feature === false) {
    return (
      `${head} Comenzile pentru ridicare necesită planul ${pickupPlanName()}: pe planul curent, ` +
      `prin QR-ul general de mai sus, clienții văd doar meniul. ${tail}`
    )
  }
  if (feature === true && enabled) {
    return `${head} Printează QR-ul general de mai sus; clienții comandă și ridică de la tejghea. ${tail}`
  }
  return `${head} Printează QR-ul general de mai sus. ${tail}`
}
