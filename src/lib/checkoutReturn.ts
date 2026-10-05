// ─────────────────────────────────────────────────────────────
// checkoutReturn.ts — întoarcerea din Stripe Checkout.
//
// `stripe-checkout.js` trimite omul înapoi pe exact două URL-uri:
//   success_url = <app>/dashboard?checkout=success
//   cancel_url  = <app>/pricing?checkout=cancelled
// Până acum NIMIC din `src/` nu citea parametrul: după plată omul vedea
// dashboard-ul pe planul vechi (webhook-ul ajunge în câteva secunde, profilul
// era deja încărcat) și nu avea niciun semn că a plătit. Aici stau doar
// helperii puri; bucla de reîmprospătare e în `hooks/useCheckoutReturn.ts`.
// ─────────────────────────────────────────────────────────────

export type CheckoutReturnParam = 'success' | 'cancelled'

export const CHECKOUT_PARAM = 'checkout'

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
 * Același URL fără `checkout=` (restul parametrilor și hash-ul rămân). Un
 * refresh sau un link copiat nu are voie să re-declanșeze „Activăm planul…".
 */
export function stripCheckoutParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(CHECKOUT_PARAM)
  const qs = url.searchParams.toString()
  return url.pathname + (qs ? '?' + qs : '') + url.hash
}
