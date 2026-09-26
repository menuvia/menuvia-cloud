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
import { PLAN_COMPARISON, getPlan, type PlanId } from './plans'

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

// RES-11: trialul pornește FĂRĂ card (`payment_method_collection:'if_required'`
// + `missing_payment_method:'cancel'` în stripe-checkout.js). Fără card la
// final, abonamentul se oprește SINGUR, fără plată — textul de mai jos nu mai
// are voie să promită că „abonamentul continuă” (PC7 îl păzește).
export const TRIAL_HEADLINE =
  `${TRIAL_DAYS} de zile gratuite pe ${trialPlanNames.join(' și ')}, fără card. ` +
  'Anulezi cu un click, fără penalizări.'

export const TRIAL_FAQ = {
  q: `Ce se întâmplă după cele ${TRIAL_DAYS} de zile gratuite?`,
  a:
    `Trialul de ${TRIAL_DAYS} de zile e pe ${trialPlanNames.join(' și ')} și se acordă o singură ` +
    'dată per cont. Nu îți cerem cardul la început. Dacă adaugi un card până la final, ' +
    'abonamentul continuă la prețul planului și atunci se face prima plată. Dacă nu adaugi, ' +
    'abonamentul se oprește singur, fără nicio plată: meniul publicat rămâne, iar contul revine ' +
    'la limitele planului gratuit. Fiscalizarea intră prin programul pilot, cu setup făcut ' +
    `împreună. Datele tale rămân disponibile pentru export ${TRIAL_DAYS} de zile după anulare.`,
}

export const PILOT_BANNER = {
  title: `Program Pilot — ${PILOT_DAYS} de zile gratis, în loc de ${TRIAL_DAYS}`,
  body:
    `Primii 10 patroni primesc setup personal cu Radu și ${PILOT_DAYS} de zile gratuite pe ` +
    'Meniu + Comenzi, în locul trialului obișnuit. Locurile sunt limitate.',
}

/**
 * Banda „Incluse în orice plan". NU pune aici promisiuni de infrastructură pe
 * care nu le putem dovedi: „Backup zilnic" a stat pe pagină luni întregi fără
 * ca vreun backup să existe. Exportul și ștergerea contului sunt REALE
 * (GdprCard + `export_user_data` / `request_account_deletion`, mig 042).
 */
export const INCLUDED_EVERYWHERE = [
  'Migrare gratuită a meniului',
  `${TRIAL_DAYS} de zile garanție`,
  'Export date + ștergere cont (GDPR)',
  'Suport WhatsApp direct',
]

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
