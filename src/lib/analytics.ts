// src/lib/analytics.ts
// ─────────────────────────────────────────────────────────────────
// PostHog Analytics — cu consent gating GDPR
//
// Inițializare cu consent:
//   - Tracking pornește DOAR după ce utilizatorul a dat consimțământ
//     pentru categoria "performance" în Cookie Banner
//   - Dacă revocă consimțământul, tracking-ul se oprește și se șterge identitatea
//
// Folosire:
//   import { initAnalytics, track, identifyUser, resetAnalytics } from './lib/analytics'
//   initAnalytics() // în main.tsx, după ce App-ul s-a montat
//   track('order_placed', { restaurant_id, amount })
//   identifyUser(userId, { email, plan })
//   resetAnalytics() // la logout
// ─────────────────────────────────────────────────────────────────
import posthog from 'posthog-js'

// Eventuri standardizate pe care le emite app-ul.
// Avantaj: TypeScript te ghidează la auto-complete în loc să introduci string-uri.
export type AppEvent =
  | 'app_loaded'
  | 'signup_started'
  | 'signup_completed'
  | 'login_completed'
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'product_created'
  | 'product_imported_ai'
  | 'order_placed'
  | 'order_status_changed'
  | 'shift_opened'
  | 'shift_closed'
  | 'invoice_generated'
  | 'subscription_started'
  | 'subscription_cancelled'
  | 'feature_blocked_by_plan'
  | 'support_link_clicked'
  | 'export_data_requested'
  | 'account_deletion_requested'

let isInitialized = false

// ─────────────────────────────────────────────────────────────────
// Helper — citește consent din localStorage (setat de CookieBanner)
// ─────────────────────────────────────────────────────────────────
function hasPerformanceConsent(): boolean {
  try {
    const raw = localStorage.getItem('menuvia_cookie_consent')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { performance?: boolean }
    return !!parsed.performance
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────
// initAnalytics — apelează o singură dată la pornirea app-ului
// ─────────────────────────────────────────────────────────────────
export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined
  const host =
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com'

  if (!key) {
    console.warn('[analytics] VITE_POSTHOG_KEY missing — analytics disabled')
    return
  }

  // Verifică consent înainte de orice init
  if (!hasPerformanceConsent()) {
    console.info('[analytics] No performance consent — analytics disabled')
    // Setup listener pentru când utilizatorul acceptă ulterior
    window.addEventListener('consent-updated', handleConsentUpdate, { once: false })
    return
  }

  doInit(key, host)
}

function doInit(key: string, host: string) {
  if (isInitialized) return
  isInitialized = true

  posthog.init(key, {
    api_host: host,
    // GDPR-friendly settings:
    person_profiles: 'identified_only', // nu creează profiluri pentru anonymous
    disable_session_recording: true, // OFF inițial, decizie produs ulterior
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // dezactivează capturarea automată clicks (mai puțin zgomot)
    persistence: 'localStorage', // în loc de cookies (mai curat pentru GDPR)
    ip: false, // nu trimite IP (poate fi reactivat la nivel de proiect PostHog)
    respect_dnt: true, // respectă Do Not Track header

    // Loader async pentru a nu bloca app-ul
    loaded: (ph) => {
      if (import.meta.env.DEV) {
        ph.debug()
      }
      // Emite imediat un event pentru a confirma loading
      ph.capture('app_loaded')
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// Handler pentru schimbarea consent-ului
// ─────────────────────────────────────────────────────────────────
function handleConsentUpdate(event: Event) {
  const detail = (event as CustomEvent).detail as { performance?: boolean } | undefined

  if (detail?.performance && !isInitialized) {
    // Utilizatorul tocmai a acceptat — pornim tracking-ul
    const key = import.meta.env.VITE_POSTHOG_KEY as string
    const host =
      (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com'
    if (key) doInit(key, host)
  } else if (!detail?.performance && isInitialized) {
    // Utilizatorul a revocat — oprim tracking-ul și ștergem identity
    posthog.opt_out_capturing()
    posthog.reset()
    isInitialized = false
  }
}

// ─────────────────────────────────────────────────────────────────
// track — emite un event (no-op silent dacă tracking-ul nu e activ)
// ─────────────────────────────────────────────────────────────────
export function track(event: AppEvent, properties?: Record<string, unknown>): void {
  if (!isInitialized) return
  try {
    posthog.capture(event, properties)
  } catch (err) {
    // Niciodată nu lăsa analytics să facă să pice app-ul
    console.warn('[analytics] track failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────────
// identifyUser — leagă eventurile de un utilizator logat
// Apelează după login/signup. NU trimite PII sensibile (parole, CNP etc.)
// ─────────────────────────────────────────────────────────────────
export function identifyUser(
  userId: string,
  properties?: {
    email?: string
    plan?: string
    role?: string
    restaurant_id?: string
    [key: string]: unknown
  },
): void {
  if (!isInitialized) return
  try {
    posthog.identify(userId, properties)
  } catch (err) {
    console.warn('[analytics] identify failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────────
// resetAnalytics — apelează la logout pentru a separa session-urile
// ─────────────────────────────────────────────────────────────────
export function resetAnalytics(): void {
  if (!isInitialized) return
  try {
    posthog.reset()
  } catch (err) {
    console.warn('[analytics] reset failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────────
// Helper pentru tracking de page views manuale (route changes în SPA)
// ─────────────────────────────────────────────────────────────────
export function trackPageView(path: string): void {
  if (!isInitialized) return
  try {
    posthog.capture('$pageview', { $current_url: window.location.origin + path })
  } catch {
    /* silent */
  }
}

// ─────────────────────────────────────────────────────────────────
// Feature flags — folosit pentru A/B testing și gradual rollout
// Exemplu: dacă vrei să arăți buton nou doar pentru 50% utilizatori
//   if (isFeatureEnabled('new-dashboard-layout')) { ... }
// ─────────────────────────────────────────────────────────────────
export function isFeatureEnabled(flag: string): boolean {
  if (!isInitialized) return false
  try {
    return !!posthog.isFeatureEnabled(flag)
  } catch {
    return false
  }
}
