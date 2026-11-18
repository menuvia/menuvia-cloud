// ─────────────────────────────────────────────────────────────
// billing — deschide Portalul de facturare Stripe pentru userul curent.
// ─────────────────────────────────────────────────────────────
// Destinația reală a CTA-urilor din emailurile de facturare (payment_failed,
// payment_recovered, trial_ending, invoice_ready) care trimit la
// /dashboard?tab=billing. Portalul Stripe permite actualizarea cardului,
// schimbarea planului și descărcarea facturilor — fără UI propriu de reconstruit.
import { supabase } from './supabase'
import { fnUrl } from './fn'
import type { StaffLang } from '../i18n/langs'

export interface BillingError extends Error {
  code?: string
}

// Cere o sesiune de portal și redirecționează. La succes NU se întoarce
// (schimbă window.location). La eșec aruncă un BillingError cu `code` pentru
// ca apelantul să diferențieze (`no_customer` → trimite spre /pricing) și să
// traducă (lotul L8d: fiecare răspuns de eroare al funcției are `code`).
// `uiLang` = limba panoului: portalul Stripe se deschide în ea (serverul o
// validează pe ro/en/fr/de; lipsă → Stripe „auto”, ca înainte).
export async function openBillingPortal(uiLang?: StaffLang): Promise<never> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const res = await fetch(fnUrl('stripe-portal'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (session?.access_token || ''),
    },
    body: JSON.stringify(uiLang ? { ui_lang: uiLang } : {}),
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
