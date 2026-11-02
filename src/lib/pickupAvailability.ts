// Comenzile pentru ridicare (click-and-collect) pe planul restaurantului.
//
// Istoric (înainte de #318): comutatorul din Setări → Comenzi pornea ridicarea
// pe ORICE plan, deși `pickup_orders` e activ în `plan_features` doar de la
// Meniu + Comenzi (growth, pro, enterprise — fixtura
// `planFeatureMatrix.fixture.ts`). Pe Planul 1 oaspeții vedeau atunci
// formularul de ridicare pe /m/:slug, iar serverul respingea FIECARE comandă
// (`enforce_ordering_enabled`, mig 083 → 290: source='pickup' cere
// `pickup_orders`): un patron care „a activat ridicarea" pierdea comenzile fără
// să afle de ce.
//
// Azi sunt trei straturi, fiecare cu rolul lui: comutatorul de aici nu mai
// PORNEȘTE ridicarea pe un plan fără ea (iar onboarding-ul food truck nici el,
// din #319); pagina publică n-o mai ARATĂ fără `pickup_orders` (mig 309, gate
// la citire în `get_restaurant_by_slug` — setarea stocată rămâne neatinsă);
// `create_order` o REFUZĂ în continuare (290), pentru fereastra dintre
// încărcarea paginii și trimitere. Ce i se SPUNE owner-ului e în
// `lib/pickupCopy.ts`.
//
// Stările comutatorului:
//   'available' — planul include ridicarea: pornit / oprit liber;
//   'locked'    — planul nu o include și e oprită: nu se poate porni;
//   'locked_on' — planul nu o include, dar e pornită (rămasă după un downgrade
//                 sau scrisă înainte de #318/#319): se poate DOAR opri, cu
//                 avertisment. Oaspeții n-o văd pe pagina publică (309), iar
//                 setarea revine la re-urcarea pe planul care o include;
//   'unknown'   — planul NU e cunoscut (features încă în încărcare sau RPC
//                 picat): comutatorul e blocat în ambele sensuri și NU spune
//                 nimic despre plan. DashboardPage cade pe 'free' cât timp nu
//                 știe planul, deci fără starea asta un local pe Meniu +
//                 Comenzi ar fi văzut avertismentul de plan la fiecare
//                 încărcare — și și-ar fi putut opri singur ridicarea.
//
// Planul vine din `useFeatures(restaurantId)` prin DashboardPage (regula 3 din
// CLAUDE.md: planul e al restaurantului, nu `profile.plan`). `null`/`undefined`
// = necunoscut; un șir nerecunoscut cade pe tier 1 (cel mai restrictiv).
import { planTier, type PlanTier } from './features'

/**
 * Planul intern minim care include `pickup_orders` (growth = Meniu + Comenzi).
 * Sursa UNICĂ a pragului: tier-ul de mai jos și numele comercial din
 * `lib/pickupCopy.ts` se derivă de aici. Legat de matricea reală din DB prin
 * PA1 și PK4 (`planFeatureMatrix.fixture`).
 */
export const PICKUP_MIN_PLAN = 'growth'

/** Tier-ul comercial minim cu ridicare, derivat din `PICKUP_MIN_PLAN`. */
export const PICKUP_MIN_TIER: PlanTier = planTier(PICKUP_MIN_PLAN)

export type PickupToggleState = 'available' | 'locked' | 'locked_on' | 'unknown'

export function pickupToggleState(
  plan: string | null | undefined,
  enabled: boolean,
): PickupToggleState {
  if (plan == null) return 'unknown'
  if (planTier(plan) >= PICKUP_MIN_TIER) return 'available'
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

// ── Modul „doar ridicare” (food truck, E3) pe planul restaurantului ──
//
// `pickup_settings.pickup_only` e un mod de AFIȘARE al panoului: ascunde Harta
// sălii și Rezervările din nav (DashboardPage), scoate pasul cu mesele din
// checklist-ul de pe Acasă (HomeTab) și pune empty state-ul „nu ai nevoie de
// mese” în Mese (TablesManager). Are sens DOAR dacă localul chiar primește
// comenzi pentru ridicare. După un DOWNGRADE (sau pe rândurile scrise înainte
// de #318/#319) ambele flag-uri rămân stocate, dar din mig 309 pagina publică
// nu arată ridicarea, iar `create_order` o refuză (290): un panou care ar
// ascunde mesele și rezervările ar lua localului exact uneltele de care are
// nevoie fără ridicare.
//
//   'off'       — ridicarea sau modul oprite în setare: nicio schimbare de nav;
//   'on'        — ambele pornite, iar planul include ridicarea SAU nu e încă
//                 cunoscut (features în încărcare / RPC picat): se păstrează
//                 comportamentul stocat, ca nav-ul să nu pâlpâie la fiecare
//                 încărcare;
//   'suspended' — ambele pornite, dar planul e CUNOSCUT fără `pickup_orders`:
//                 panoul se poartă ca fără mod (nav complet, mesele în
//                 checklist), iar Mese spune de ce. Rândul stocat NU se
//                 rescrie: re-urcarea pe planul cu ridicare găsește setarea.
//
// `pickupFeature` e tristate-ul din `lib/pickupCopy.ts` (`pickupFeatureState`
// din features, sau `pickupFeatureFromToggle` din Setări): true/false =
// cunoscut, null = necunoscut.
export type PickupOnlyMode = 'off' | 'on' | 'suspended'

export function pickupOnlyMode(
  settings: { enabled?: boolean | null; pickup_only?: boolean | null } | null | undefined,
  pickupFeature: boolean | null,
): PickupOnlyMode {
  if (settings?.enabled !== true || settings.pickup_only !== true) return 'off'
  return pickupFeature === false ? 'suspended' : 'on'
}
