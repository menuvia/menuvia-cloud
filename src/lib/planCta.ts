// ─────────────────────────────────────────────────────────────
// planCta.ts — ce poate face butonul unui plan: checkout self-serve sau
// „Cere ofertă".
//
// Regula de aur (CLAUDE.md): bani + bon fiscal = Plan 3 (`pro`/`enterprise`,
// „Fiscalizare"). Planul 3 NU se vinde self-serve: cere o casă de marcat
// conectată, iar un client care îl plătește fără ea ar încasa fără bon. De
// aceea butonul lui NU pornește niciodată Stripe (decizia D4,
// docs/dosar/04-fisa-decizii-D1-D15.md) — duce la o cerere de ofertă pe email.
// Înainte, când WhatsApp era oprit (VITE_WHATSAPP_NUMBER lipsă), CTA-ul cădea
// pe `onCheckout('pro')`, adică pe checkout-ul Stripe.
//
// Oglinda de pe server: `QUOTE_ONLY_PLANS` din netlify/functions/stripe-checkout.js
// (refuză cu 403 `plan_requires_quote`). Ambele liste se schimbă împreună.
// ─────────────────────────────────────────────────────────────
import { CONTACT_EMAIL } from './domain'

/** Planurile care se cer prin ofertă, nu se cumpără singur. */
export const QUOTE_ONLY_PLAN_IDS: readonly string[] = ['pro', 'enterprise']

/** Textul butonului unui plan cu ofertă. */
export const QUOTE_CTA_LABEL = 'Cere ofertă'

/** True pentru un plan care NU are voie să ajungă la checkout. */
export function isQuoteOnlyPlan(planId: string): boolean {
  return QUOTE_ONLY_PLAN_IDS.includes(planId.trim().toLowerCase())
}

/**
 * Linkul „Cere ofertă": un email către adresa de contact, cu subiectul și
 * un schelet de mesaj completate (numele localului, telefonul și casa de
 * marcat sunt ce ne trebuie ca să revenim cu o ofertă).
 */
export function quoteMailto(planName: string): string {
  const subject = `Cerere de ofertă — ${planName}`
  const body = [
    'Bună ziua,',
    '',
    `Aș dori o ofertă pentru planul ${planName}.`,
    '',
    'Numele localului:',
    'Orașul:',
    'Telefon de contact:',
    'Casa de marcat (marcă / model):',
    '',
    'Mulțumesc!',
  ].join('\n')
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
