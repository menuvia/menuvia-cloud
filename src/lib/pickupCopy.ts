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
//
// Stilul meniului (`flipbook`, PY1): pe layout-ul EFECTIV flipbook
// (`resolveEffectiveMenuLayout` din lib/themes — flipbook FĂRĂ pagini cade pe
// 'list', deci acolo comanda rămâne) pagina publică NU randează carduri, coș
// sau ridicare (PublicMenuPage, `isFlipbook`). Atunci niciun text nu promite
// comenzi, nici pe planul care le include: spune de ce (stilul Flipbook, fără
// coș) și ce face owner-ul (alt stil din „Meniu & aspect”). Pe planul fără
// ridicare sau necunoscut flipbook-ul nu schimbă nimic — acolo nu se promite
// oricum, iar motivul de plan e cel care contează.
//
// Modul „doar ridicare” (PY3): `pickupOnlyMode` din lib/pickupAvailability —
// pe planul CUNOSCUT fără ridicare e 'suspended' (panoul arată mesele și
// rezervările), iar textele spun asta în loc de „nu ai nevoie de mese”.
// ─────────────────────────────────────────────────────────────
import { hasFeature, type RestaurantFeatures } from './features'
import { PLAN_LABELS } from './constants'
import { PICKUP_MIN_PLAN, type PickupToggleState } from './pickupAvailability'

/** Numele COMERCIAL al planului care deblochează ridicarea (din `PLAN_LABELS`). */
export function pickupPlanName(): string {
  return PLAN_LABELS[PICKUP_MIN_PLAN]
}

// De ce nu se poate comanda pe flipbook și ce face owner-ul — aceeași frază în
// Setări și în Mese (PY1), ca motivul să nu fie formulat în două feluri.
const FLIPBOOK_NO_ORDERS =
  'pe stilul Flipbook pagina publică arată meniul ca pe o carte, fără coș, deci clienții ' +
  'nu pot comanda pentru ridicare. Pentru comenzi, alege alt stil din Setări → Meniu & aspect.'

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
export function pickupCardDescription(
  feature: boolean | null,
  flipbook: boolean,
): { lead: string; tail: string } {
  const lead = 'Comenzi cu ridicare de la restaurant, de pe pagina ta publică'
  if (feature === true && flipbook) {
    // Planul include ridicarea, dar stilul ales n-are coș: fără promisiune,
    // cu motivul și ieșirea (PY1). SettingsTab trimite stilul din formularul
    // NESALVAT (consecința se vede înainte de salvare).
    return { lead, tail: `. Atenție: ${FLIPBOOK_NO_ORDERS}` }
  }
  if (feature === true) {
    return {
      lead: 'Cu ridicarea pornită, clienții pot comanda de pe pagina ta publică',
      tail: ' fără să scaneze QR și ridică direct de la restaurant. Plata cash la ridicare.',
    }
  }
  return { lead, tail: '.' }
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

/**
 * Textul cardului „QR meniu general” (Mese), după „Duce la /m/slug — ”. Pe
 * flipbook (stilul EFECTIV salvat) nu promite comenzi, ci spune de ce (PY1).
 */
export function generalMenuQrText(feature: boolean | null, flipbook: boolean): string {
  const tail = 'Bun pentru vitrină, flyere sau tejghea.'
  if (feature === true && flipbook) return `clienții văd meniul; ${FLIPBOOK_NO_ORDERS} ${tail}`
  return feature === true
    ? `clienții văd meniul; cu comenzile pentru ridicare active pot și comanda. ${tail}`
    : `clienții văd meniul. ${tail}`
}

/**
 * Empty state-ul modului „doar ridicare” (Mese, fără nicio masă). Se randează
 * DOAR cu modul STOCAT pornit (`pickupOnlyMode` ≠ 'off': ridicarea ȘI „doar
 * ridicare” pornite), deci `feature === false` ⇔ modul e 'suspended': planul
 * cunoscut nu include ridicarea, panoul arată mesele și rezervările (PY3), iar
 * textul NU mai spune „nu ai nevoie de mese”. „Clienții comandă” DOAR cu
 * feature-ul cunoscut activ și NU pe flipbook (PY1).
 */
export function pickupOnlyEmptyStateText(feature: boolean | null, flipbook: boolean): string {
  const tail = 'Poți adăuga mese oricând, dacă situația se schimbă.'
  if (feature === false) {
    return (
      `Mod „doar ridicare" suspendat: planul tău nu include comenzile pentru ridicare, deci ` +
      `panoul îți arată mesele și rezervările. Prin QR-ul general de mai sus, clienții văd ` +
      `meniul, fără comanda pentru ridicare. Setarea rămâne salvată și revine la trecerea pe ` +
      `planul ${pickupPlanName()}.`
    )
  }
  const head = 'Mod „doar ridicare" activ — nu ai nevoie de mese.'
  if (feature === true && flipbook) {
    return `${head} Printează QR-ul general de mai sus. Atenție: ${FLIPBOOK_NO_ORDERS} ${tail}`
  }
  if (feature === true) {
    return `${head} Printează QR-ul general de mai sus; clienții comandă și ridică de la tejghea. ${tail}`
  }
  return `${head} Printează QR-ul general de mai sus. ${tail}`
}

/**
 * Descrierea comutatorului „Mod doar ridicare” din Setări (vizibil doar cu
 * ridicarea pornită în formular). Pe planul CUNOSCUT fără ridicare (`locked_on`)
 * modul e suspendat (`pickupOnlyMode`): descrierea obișnuită („ascunde Harta
 * sălii și Rezervările”) ar fi falsă, iar nota `locked_on` de sub comutatorul
 * principal vorbește doar despre pagina publică, nu și despre panou (PY3).
 */
export function pickupOnlyToggleDescription(feature: boolean | null): string {
  if (feature === false) {
    return (
      'Pe planul tău modul nu se aplică: fără comenzi pentru ridicare, panoul îți arată ' +
      `mesele și rezervările. Setarea rămâne salvată și revine la trecerea pe planul ${pickupPlanName()}.`
    )
  }
  return (
    'Pentru food truck / tejghea: ascunde Harta sălii și Rezervările din dashboard. ' +
    'QR-ul general din tab-ul Mese devine QR-ul tău principal.'
  )
}
