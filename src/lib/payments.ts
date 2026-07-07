// ─────────────────────────────────────────────────────────────
// payments.ts — plata online la masă (Etapa 1, docs/ONLINE_PAYMENT.md)
// ─────────────────────────────────────────────────────────────
// Client-side pentru fluxul QR „Plătește masa": funcția Netlify
// /table-payment creează PaymentIntent-ul pe contul CONECTAT al
// restaurantului (suma se calculează EXCLUSIV server-side), iar aici doar
// confirmăm cu Stripe Payment Element.
//
// Stripe.js se încarcă din js.stripe.com/v3 prin script tag dinamic —
// pachetul npm @stripe/stripe-js e doar un loader pentru ACELAȘI script,
// deci evităm o dependență nouă (npm e blocat în sandbox; regula PCI a
// Stripe oricum cere scriptul servit de ei, nu bundle-uit).
import { supabase } from './supabase'

// ── Tipuri minimale pentru Stripe.js (fără `any`) ─────────────
export interface StripePaymentElement {
  mount(domElement: HTMLElement): void
  unmount(): void
}

export interface StripeElements {
  create(type: 'payment'): StripePaymentElement
}

export interface StripeConfirmResult {
  error?: { message?: string; type?: string }
  paymentIntent?: { id: string; status: string }
}

export interface StripeClient {
  elements(options: {
    clientSecret: string
    appearance?: { theme?: 'stripe' | 'night' | 'flat'; variables?: Record<string, string> }
  }): StripeElements
  confirmPayment(options: {
    elements: StripeElements
    confirmParams?: { return_url?: string }
    redirect?: 'if_required'
  }): Promise<StripeConfirmResult>
}

export type StripeConstructor = (
  publishableKey: string,
  options?: { stripeAccount?: string },
) => StripeClient

declare global {
  interface Window {
    Stripe?: StripeConstructor
  }
}

let stripeJsPromise: Promise<StripeConstructor> | null = null

/** Încarcă js.stripe.com/v3 o singură dată; eșecul resetează cache-ul (retry posibil). */
export function loadStripeJs(): Promise<StripeConstructor> {
  if (window.Stripe) return Promise.resolve(window.Stripe)
  if (stripeJsPromise) return stripeJsPromise
  stripeJsPromise = new Promise<StripeConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3/'
    script.async = true
    script.onload = () => {
      if (window.Stripe) resolve(window.Stripe)
      else reject(new Error('Stripe.js s-a încărcat dar window.Stripe lipsește'))
    }
    script.onerror = () => {
      stripeJsPromise = null
      reject(new Error('Nu s-a putut încărca Stripe.js — verifică conexiunea.'))
    }
    document.head.appendChild(script)
  })
  return stripeJsPromise
}

// ── API-ul funcției Netlify ───────────────────────────────────
export interface TablePaymentIntent {
  payment_id: string
  client_secret: string
  publishable_key: string
  stripe_account_id: string
  amount: number
  currency: string
}

/**
 * Cere serverului să inițieze plata mesei. Aruncă Error REAL (nu răspuns
 * brut) — hint-urile de business (module_disabled / not_connected /
 * nothing_to_pay...) ajung în `hint` ca UI-ul să poată explica curat.
 */
export async function createTablePayment(
  token: string,
  sessionId: string,
): Promise<TablePaymentIntent> {
  const res = await fetch('/.netlify/functions/table-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, session_id: sessionId }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<TablePaymentIntent> & {
    error?: string
    hint?: string
  }
  if (!res.ok) {
    const err = new Error(body.error || 'Plata nu a putut fi inițiată.') as Error & {
      hint?: string
    }
    err.hint = body.hint ?? undefined
    throw err
  }
  if (!body.client_secret || !body.publishable_key || !body.stripe_account_id) {
    throw new Error('Răspuns incomplet de la server.')
  }
  return body as TablePaymentIntent
}

/**
 * Opt-out-ul clientului („plătesc la ospătar"): anulează intent-ul Stripe ca
 * să nu rămână confirmabil. Întoarce statusul final; 'succeeded' înseamnă că
 * plata apucase să treacă — UI-ul arată starea de plătit, nu de anulat.
 */
export async function cancelTablePayment(
  paymentId: string,
  token: string,
  sessionId: string,
): Promise<'canceled' | 'succeeded'> {
  const res = await fetch('/.netlify/functions/table-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', payment_id: paymentId, token, session_id: sessionId }),
  })
  const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string }
  if (body.status === 'succeeded') return 'succeeded'
  if (res.ok) return 'canceled'
  throw new Error(body.error || 'Anularea nu a reușit.')
}

/**
 * Modulul de plăți online e activ pentru restaurant? (anon-callable, mig 086)
 * Folosit DOAR pentru afișarea condiționată a butonului — gate-urile reale
 * (plan + modul + cont) stau server-side în begin_table_payment.
 */
export async function fetchOnlinePaymentEnabled(restaurantId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_module_enabled', {
    p_restaurant_id: restaurantId,
    p_module_key: 'online_payments',
  })
  if (error) return false
  return data === true
}
