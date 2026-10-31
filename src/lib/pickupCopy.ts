// ─────────────────────────────────────────────────────────────
// pickupCopy.ts — ce îi spune dashboard-ul OWNER-ului despre ridicare.
//
// Din mig 309, pagina publică /m/:slug arată ridicarea DOAR când restaurantul
// are feature-ul `pickup_orders` (gate la CITIRE în `get_restaurant_by_slug`);
// setarea stocată `pickup_settings.enabled` rămâne neatinsă, ca o re-urcare să
// găsească ridicarea exact cum a lăsat-o owner-ul. Pe un plan fără ridicare UI-ul
// nu o mai pornește (comutatorul din Setări, #318 — `lib/pickupAvailability.ts`;
// onboarding-ul food truck, #319), deci starea „stocat pornit, plan fără
// ridicare” apare după un DOWNGRADE de pe un plan cu ridicare sau pe rândurile
// scrise înainte de #318/#319. Atunci owner-ul vede „pornit”, iar oaspeții lui
// nu mai pot comanda pentru ridicare — iar după 309 nici refuzul de la
// `create_order` nu-l mai anunță, fiindcă oaspetele nu mai ajunge la formular.
// Textele de aici sunt singurul loc unde i se spune.
//
// Textele NU spun că pagina publică arată „doar meniul”: pe orice plan, cu
// modulul Rezervări pornit (permis pe orice plan, mig 086), /m/:slug are și
// „Rezervă o masă” (PublicMenuPage, `reservationsModuleEnabled`). Singurul lucru
// adevărat pe orice plan fără `pickup_orders` e că oaspeții NU pot comanda
// pentru ridicare de pe pagina publică (PK3).
//
// Două intrări, UN singur adevăr (PK7):
//   • Setări — starea comutatorului (`PickupToggleState`, din planul primit de
//     la DashboardPage, care îl citește prin `useFeatures(restaurantId)`):
//     `pickupToggleNotice` + `pickupFeatureFromToggle`. SettingsTab NU cheamă
//     `useFeatures` a doua oară.
//   • Mese — feature-ul citit direct (`pickupFeatureState`), fiindcă
//     TablesManager are deja `useFeatures(restaurant.id)` pentru `max_tables`.
// Ambele ajung la același tristate (`true`/`false`/`null`) și la aceleași texte.
//
// Tristate (tiparul `paymentsEnabled`): `null` = planul NU e cunoscut (features
// neîncărcate / RPC picat) → nici promisiunea „clienții pot comanda”, nici
// avertismentul de plan. Planul e al RESTAURANTULUI (regula 3), nu
// `profile.plan`. Numele planului vine din `PLAN_LABELS` (sursa unică), pentru
// planul intern `PICKUP_MIN_PLAN` — același prag pe care îl folosește
// comutatorul.
// ─────────────────────────────────────────────────────────────
import { hasFeature, type RestaurantFeatures } from './features'
import { PLAN_LABELS } from './constants'
import { PICKUP_MIN_PLAN, type PickupToggleState } from './pickupAvailability'

/** Numele COMERCIAL al planului care deblochează ridicarea (din `PLAN_LABELS`). */
export function pickupPlanName(): string {
  return PLAN_LABELS[PICKUP_MIN_PLAN]
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
 * Același tristate, derivat din starea comutatorului din Setări: planul include
 * ridicarea (`available`) → `true`; nu o include (`locked`, `locked_on`) →
 * `false`; plan necunoscut → `null`.
 */
export function pickupFeatureFromToggle(state: PickupToggleState): boolean | null {
  if (state === 'available') return true
  if (state === 'unknown') return null
  return false
}

/**
 * Descrierea cardului „Comenzi pentru ridicare” din Setări, în jurul linkului
 * paginii publice (`lead` + link + `tail`). Promisiunea de comenzi DOAR pe
 * feature CUNOSCUT activ — și chiar atunci CONDIȚIONATĂ de comutator, în text
 * („Cu ridicarea pornită, …”): descrierea stă lângă comutator în AMBELE stări,
 * iar cu el oprit pagina publică nu arată ridicarea (PublicMenuPage cade pe
 * „Lista mea”). Varianta veche („Activează pagina ta publică. Clienții pot
 * comanda …”) afirma la prezent un lucru fals cât timp comutatorul era oprit
 * (recenzie CodeRabbit pe #324, PK2).
 */
export function pickupCardDescription(feature: boolean | null): { lead: string; tail: string } {
  if (feature === true) {
    return {
      lead: 'Cu ridicarea pornită, clienții pot comanda de pe pagina ta publică',
      tail: ' fără să scaneze QR și ridică direct de la restaurant. Plata cash la ridicare.',
    }
  }
  return {
    lead: 'Comenzi cu ridicare de la restaurant, de pe pagina ta publică',
    tail: '.',
  }
}

/**
 * Nota de sub comutatorul de ridicare din Setări — UNA singură, pe starea
 * comutatorului. `available` → nimic. `unknown` → doar „se verifică”, fără
 * verdict despre plan (e și starea de încărcare NORMALĂ: DashboardPage nu
 * așteaptă features înainte să randeze fila, deci un „nu am putut verifica” ar
 * fi o alarmă falsă la fiecare deschidere). `locked` → de la ce plan e
 * disponibilă. `locked_on` → ce se întâmplă ACUM cu ridicarea pornită: pagina
 * publică n-o arată (mig 309), setarea rămâne salvată pentru re-urcare.
 */
export function pickupToggleNotice(state: PickupToggleState): string | null {
  if (state === 'available') return null
  if (state === 'unknown') {
    return (
      'Se verifică planul restaurantului; până atunci ridicarea nu se poate schimba. ' +
      'Dacă mesajul nu dispare, reîncarcă pagina.'
    )
  }
  const plan = pickupPlanName()
  if (state === 'locked_on') {
    return (
      `Planul tău nu include comenzile pentru ridicare: oaspeții nu văd ridicarea pe pagina ` +
      `publică, deci nu pot comanda pentru ridicare. Setarea rămâne salvată și revine la ` +
      `trecerea pe planul ${plan}. Poți opri opțiunea sau poți trece pe acest plan.`
    )
  }
  return `Disponibil de la planul ${plan}. Pe planul tău, comenzile pentru ridicare nu pot fi primite.`
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
      `prin QR-ul general de mai sus, clienții văd meniul, fără comanda pentru ridicare. ${tail}`
    )
  }
  if (feature === true && enabled) {
    return `${head} Printează QR-ul general de mai sus; clienții comandă și ridică de la tejghea. ${tail}`
  }
  return `${head} Printează QR-ul general de mai sus. ${tail}`
}
