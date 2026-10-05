// ─────────────────────────────────────────────────────────────
// pricingCopy.ts — afirmațiile comerciale de pe pagina de prețuri care se pot
// CONTRAZICE cu produsul, ținute ca DATE ca să poată fi testate.
//
// De ce nu stau în JSX: auditul v3 a găsit patru contradicții pe același
// ecran, toate invizibile pentru orice test, fiindcă erau text în markup:
//   1. „30 de zile gratuite pe ORICE plan" lângă „Program Pilot — 60 de zile
//      gratis"; în plus Fiscalizarea nici măcar nu trece prin Stripe (CTA-ul
//      ei e WhatsApp), deci acolo nu există trial deloc;
//   2. „Backup zilnic" — afirmație pe care o știm FALSĂ (workflow-ul de
//      backup n-a produs niciodată un artefact);
//   3. plata online vândută ca „în curând / în dezvoltare", în timp ce
//      tabelul de comparație, la 30 de rânduri distanță, o listează livrată
//      pe Fiscalizare (și chiar ESTE livrată, mig 202/203);
//   4. „+99 lei/lună" pentru integrarea casei de marcat — un preț pe care
//      sistemul NU îl poate factura: există exact patru price ID-uri, unul
//      per plan, niciun addon. Aceeași clasă cu toggle-ul anual scos la
//      rangul 11 din audit.
//
// Invariantele sunt păzite permanent de `pricingCopy.test.ts` (PC1–PC5), iar
// `comparisonLabel` leagă fiecare card de rândul lui din `PLAN_COMPARISON`:
// dacă tabelul spune că o funcție e livrată pe un plan, cardul nu mai poate
// spune „în curând" fără să facă testul roșu.
// ─────────────────────────────────────────────────────────────
import { PLAN_COMPARISON, getPlan, locationsPerAccountText, type PlanId } from './plans'

/** Zile de trial acordate de `stripe-checkout` (STRIPE_TRIAL_DAYS, default 30). */
export const TRIAL_DAYS = 30

/** Oferta pilot pentru primii patroni — ÎNLOCUIEȘTE trialul, nu se adună. */
export const PILOT_DAYS = 60

/**
 * Planurile care primesc efectiv trial: cele care trec prin Stripe Checkout.
 * `pro` (Fiscalizare) NU e aici — CTA-ul lui deschide WhatsApp (pilot cu setup
 * asistat), deci o promisiune de trial pe „orice plan" ar fi falsă.
 */
export const TRIAL_PLAN_IDS: PlanId[] = ['starter', 'growth']

const trialPlanNames = TRIAL_PLAN_IDS.map((id) => getPlan(id).name)

// Anularea urmează Termenii §4.4: oricând, din aplicație, cu efect la finalul
// perioadei deja plătite; sumele achitate nu se rambursează. În perioada de
// probă nu s-a plătit nimic, deci anularea înainte de prima plată nu costă.
export const TRIAL_HEADLINE =
  `${TRIAL_DAYS} de zile gratuite pe ${trialPlanNames.join(' și ')}. ` +
  'Anulezi oricând din aplicație, fără penalizări.'

export const TRIAL_FAQ = {
  q: `Ce se întâmplă după cele ${TRIAL_DAYS} de zile gratuite?`,
  a:
    `Trialul de ${TRIAL_DAYS} de zile e pe ${trialPlanNames.join(' și ')} și se acordă o singură ` +
    'dată per cont. După el, abonamentul continuă la prețul planului ales, abia atunci se face ' +
    'prima plată. Dacă nu ești mulțumit, anulezi din aplicație înainte de prima plată și nu ' +
    'plătești nimic. Fiscalizarea intră prin programul pilot, cu setup făcut împreună. După ' +
    'încetarea abonamentului poți cere exportul datelor tale timp de 30 de zile.',
}

export const PILOT_BANNER = {
  title: `Program Pilot — ${PILOT_DAYS} de zile gratis, în loc de ${TRIAL_DAYS}`,
  body:
    `Primii 10 patroni primesc setup personal și ${PILOT_DAYS} de zile gratuite pe ` +
    'Meniu + Comenzi, în locul trialului obișnuit. Locurile sunt limitate.',
}

/**
 * Banda „Incluse în orice plan". NU pune aici promisiuni de infrastructură pe
 * care nu le putem dovedi: „Backup zilnic" a stat pe pagină luni întregi fără
 * ca vreun backup să existe. Exportul și ștergerea contului sunt REALE
 * (GdprCard + `export_user_data` / `request_account_deletion`, mig 042).
 */
//
// „30 de zile garanție" a fost SCOS (oct 2026): Termenii §4.4 spun că sumele
// achitate NU se rambursează, deci o „garanție" e o promisiune contractuală
// falsă; iar trialul nu acoperă „orice plan" (Fiscalizarea intră prin pilot),
// deci nici „30 de zile gratuite" nu are ce căuta în banda asta — trialul e
// deja în TRIAL_HEADLINE, cu planurile numite.
export const INCLUDED_EVERYWHERE = [
  'Migrare gratuită a meniului',
  'Export date + ștergere cont (GDPR)',
  'Suport WhatsApp direct',
]

/**
 * Întrebările din FAQ care au valoare CONTRACTUALĂ — date, nu JSX, ca să fie
 * încrucișate cu Termenii (`menuvia-pack/02-DRAFT-TERMENI.md`) și cu limitele
 * reale. Înainte pagina promitea „downgrade instant", „plătești per
 * restaurant" (planul e pe CONT) și „modificările de preț se aplică doar la
 * noi clienți" — toate trei contrazise de Termeni (§4.6, §15.2) sau de date.
 */
export const PLAN_CHANGE_FAQ = {
  q: 'Pot schimba planul oricând?',
  // Termenii §4.6: upgrade imediat, cu regularizare proporțională; downgrade
  // de la următoarea perioadă de facturare.
  a:
    'Da. Trecerea la un plan superior are efect imediat, iar diferența de preț se calculează ' +
    'proporțional. Trecerea la un plan inferior are efect de la următoarea perioadă de ' +
    'facturare; până atunci păstrezi planul plătit.',
}

export const BILLING_SCOPE_FAQ = {
  q: 'Plătesc per restaurant sau per cont?',
  // `plan_limits.max_restaurants` (prin `limits.maxRestaurants`): planul e al
  // contului (owner), iar locațiile intră sub același abonament.
  a:
    `Per cont: un abonament acoperă locațiile din contul tău. ${locationsPerAccountText()}. ` +
    'Pentru lanțuri cu 3+ locații, scrie-ne — facem ofertă custom.',
}

export const PRICE_GUARANTEE_FAQ = {
  q: 'Garantați prețul?',
  // Termenii §15.2: preaviz de minimum 30 de zile, efect de la următoarea
  // perioadă de facturare; §15.3: clientul poate înceta înainte.
  a:
    'Prețul nu se schimbă în timpul unei perioade deja plătite. Orice modificare de preț ți-o ' +
    'anunțăm cu cel puțin 30 de zile înainte și se aplică abia de la următoarea perioadă de ' +
    'facturare; dacă nu ești de acord, poți renunța înainte să intre în vigoare.',
}

export interface ExtraFeatureCopy {
  id: string
  /** Rândul corespunzător din `PLAN_COMPARISON` — ancora anti-contradicție. */
  comparisonLabel: string
  title: string
  /** Eticheta de preț. Un addon facturabil ar cere price ID propriu în Stripe. */
  price: string
  plans: string
  desc: string
}

/** `Inclus în <numele comercial al planului>` — derivat, ca să reziste unei redenumiri. */
export function includedPriceLabel(planId: PlanId): string {
  return `Inclus în ${getPlan(planId).name}`
}

export const EXTRA_FEATURES: ExtraFeatureCopy[] = [
  {
    id: 'online_payments',
    comparisonLabel: 'Plata online la masă (clientul plătește din telefon)',
    title: 'Plata online la masă',
    price: includedPriceLabel('pro'),
    plans: 'Doar Fiscalizare',
    desc:
      'Clientul plătește cu cardul direct din telefonul lui, cu bacșiș inclus. Se activează ' +
      'după ce îți conectezi contul Stripe, din Setări.',
  },
  {
    id: 'fiscal_bridge',
    comparisonLabel: 'Bon fiscal + casă de marcat',
    title: 'Integrare casă de marcat',
    price: includedPriceLabel('pro'),
    plans: 'Doar Fiscalizare',
    desc:
      'Conectare cu Datecs / Activa / Tremol prin bridge-ul Menuvia. În pilot instalarea o ' +
      'facem împreună, fără cost suplimentar față de abonament.',
  },
]

/** Rândul din tabelul comparativ pentru un card, sau `undefined` dacă nu există. */
export function comparisonRowFor(feature: ExtraFeatureCopy) {
  return PLAN_COMPARISON.find((r) => r.label === feature.comparisonLabel)
}
