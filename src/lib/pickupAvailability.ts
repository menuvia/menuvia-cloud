// Comenzile pentru ridicare (click-and-collect) pe planul restaurantului.
//
// Comutatorul din Setări → Comenzi pornea ridicarea pe ORICE plan, deși
// `pickup_orders` e activ în `plan_features` doar de la Meniu + Comenzi
// (growth, pro, enterprise — fixtura `planFeatureMatrix.fixture.ts`). Pe
// Planul 1 oaspeții vedeau formularul de ridicare pe /m/:slug, iar serverul
// respingea FIECARE comandă (`enforce_ordering_enabled`, mig 083 → 290:
// source='pickup' cere `pickup_orders`): un patron care „a activat ridicarea"
// pierdea comenzile fără să afle de ce.
//
// Stările comutatorului:
//   'available' — planul include ridicarea: pornit / oprit liber;
//   'locked'    — planul nu o include și e oprită: nu se poate porni;
//   'locked_on' — planul nu o include, dar e pornită (setată înainte de un
//                 downgrade): se poate DOAR opri, cu avertisment;
//   'unknown'   — planul NU e cunoscut (features încă în încărcare sau RPC
//                 picat): comutatorul e blocat în ambele sensuri și NU spune
//                 nimic despre plan. DashboardPage cade pe 'free' cât timp nu
//                 știe planul, deci fără starea asta un local pe Meniu +
//                 Comenzi ar fi văzut „comenzile sunt respinse" la fiecare
//                 încărcare — și și-ar fi putut opri singur ridicarea.
//
// Planul vine din `useFeatures(restaurantId)` prin DashboardPage (regula 3 din
// CLAUDE.md: planul e al restaurantului, nu `profile.plan`). `null`/`undefined`
// = necunoscut; un șir nerecunoscut cade pe tier 1 (cel mai restrictiv).
import { planTier } from './features'

export type PickupToggleState = 'available' | 'locked' | 'locked_on' | 'unknown'

export function pickupToggleState(
  plan: string | null | undefined,
  enabled: boolean,
): PickupToggleState {
  if (plan == null) return 'unknown'
  if (planTier(plan) >= 2) return 'available'
  return enabled ? 'locked_on' : 'locked'
}

/**
 * Poate comutatorul trece în valoarea cerută? Pe un plan cunoscut oprirea e
 * mereu permisă; pe unul necunoscut nimic nu se schimbă.
 */
export function canSetPickupEnabled(state: PickupToggleState, next: boolean): boolean {
  if (state === 'unknown') return false
  return !next || state === 'available'
}
