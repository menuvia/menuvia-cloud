// ─────────────────────────────────────────────────────────────
// checkoutReturn.ts — întoarcerea din Stripe Checkout.
//
// `stripe-checkout.js` trimite omul înapoi pe exact două URL-uri:
//   success_url = <app>/dashboard?checkout=success&checkout_plan=<plan cumpărat>
//   cancel_url  = <app>/pricing?checkout=cancelled
// `checkout_plan` (nu `plan`): `?plan=` e deja intenția de plan de pe /auth
// (`planIntent.ts`) — un al doilea sens pe același nume ar putea porni un
// checkout dintr-un URL de întoarcere.
// Până acum NIMIC din `src/` nu citea parametrul: după plată omul vedea
// dashboard-ul pe planul vechi (webhook-ul ajunge în câteva secunde, profilul
// era deja încărcat) și nu avea niciun semn că a plătit. Aici stau doar
// helperii puri; bucla de reîmprospătare e în `hooks/useCheckoutReturn.ts`.
// ─────────────────────────────────────────────────────────────

export type CheckoutReturnParam = 'success' | 'cancelled'

export const CHECKOUT_PARAM = 'checkout'
export const CHECKOUT_PLAN_PARAM = 'checkout_plan'

/** Planurile care se pot cumpăra prin Stripe Checkout (`PRICE_IDS` din funcție). */
export type PurchasablePlan = 'starter' | 'growth' | 'pro' | 'enterprise'

/** Planul cumpărat din `checkout_plan=`; necunoscut/absent = null. */
export function readCheckoutPlanParam(search: string): PurchasablePlan | null {
  try {
    const v = new URLSearchParams(search).get(CHECKOUT_PLAN_PARAM)
    return v === 'starter' || v === 'growth' || v === 'pro' || v === 'enterprise' ? v : null
  } catch {
    return null
  }
}

/**
 * E activ planul cumpărat? (decizia bannerului „Planul tău e activ")
 *
 * Cu planul cumpărat CUNOSCUT: DOAR când `profiles.plan` e exact acel plan. Un
 * plan plătit oarecare NU e dovada: un cont cu plan MANUAL (FounderPage,
 * `admin_set_restaurant_plan`) nu are abonament Stripe, deci poate cumpăra, iar
 * planul lui vechi e vizibil ÎNAINTE ca webhook-ul să scrie planul nou —
 * regula veche „orice plan ≠ free = activ" anunța activarea pe planul vechi.
 *
 * Fără el (URL de la o versiune veche a funcției): doar o SCHIMBARE față de
 * primul plan văzut la întoarcere; altfel bannerul rămâne pe „activăm" și
 * plafonul de 30 s dă mesajul onest de întârziere.
 */
export function checkoutActivated(
  purchased: PurchasablePlan | null,
  baseline: string | null,
  plan: string,
): boolean {
  if (purchased != null) return plan === purchased
  return baseline != null && plan !== baseline
}

/** `success` / `cancelled` din query string; orice altă valoare = null. */
export function readCheckoutReturnParam(search: string): CheckoutReturnParam | null {
  try {
    const v = new URLSearchParams(search).get(CHECKOUT_PARAM)
    return v === 'success' || v === 'cancelled' ? v : null
  } catch {
    return null
  }
}

/**
 * Același URL fără `checkout=`/`checkout_plan=` (restul parametrilor și hash-ul rămân). Un
 * refresh sau un link copiat nu are voie să re-declanșeze „Activăm planul…".
 */
export function stripCheckoutParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(CHECKOUT_PARAM)
  url.searchParams.delete(CHECKOUT_PLAN_PARAM)
  const qs = url.searchParams.toString()
  return url.pathname + (qs ? '?' + qs : '') + url.hash
}
