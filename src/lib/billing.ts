// ─────────────────────────────────────────────────────────────
// billing — deschide Portalul de facturare Stripe pentru userul curent.
// ─────────────────────────────────────────────────────────────
// Destinația reală a CTA-urilor din emailurile de facturare (payment_failed,
// payment_recovered, trial_ending, invoice_ready) care trimit la
// /dashboard?tab=billing. Portalul Stripe permite actualizarea cardului,
// schimbarea planului și descărcarea facturilor — fără UI propriu de reconstruit.
import { supabase } from './supabase'

export interface BillingError extends Error {
  code?: string
}

// Cere o sesiune de portal și redirecționează. La succes NU se întoarce
// (schimbă window.location). La eșec aruncă un BillingError cu `code` pentru
// ca apelantul să diferențieze (`no_customer` → trimite spre /pricing).
export async function openBillingPortal(): Promise<never> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const res = await fetch('/.netlify/functions/stripe-portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (session?.access_token || ''),
    },
  })

  let d: { url?: string; error?: string; code?: string } = {}
  try {
    d = await res.json()
  } catch {
    /* corp non-JSON → tratat ca eroare mai jos */
  }

  if (res.ok && d.url) {
    window.location.href = d.url
    // Redirect în curs; oprim orice execuție ulterioară.
    await new Promise(() => {})
  }

  const err = new Error(
    d.error || 'Nu am putut deschide portalul de facturare. Reîncearcă în câteva momente.',
  ) as BillingError
  err.code = d.code
  throw err
}
