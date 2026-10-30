// ─────────────────────────────────────────────────────────────
// pwaGate.ts — unde au voie să apară cardurile PWA (instalare / actualizare).
//
// Cardurile sunt `role="dialog"` fixate jos, peste conținut. Defectele
// (ux-owner-pwa-card-funnel, perf-guest-7 partea A):
//   - „Instalează Menuvia” apărea la 30 s în MIJLOCUL înscrierii (/auth) sau al
//     onboarding-ului, exact peste butoanele „Continuă” / „Creează mese”;
//   - pe meniul oaspetelui (/q, /m, /rezervare) apăreau carduri despre aplicația
//     de staff, doar în română, iar chunk-ul lor se descărca la fiecare scanare.
// Onboarding-ul nu e o rută (se randează pe /dashboard cât contul n-are
// restaurant), deci se suprimă explicit, cât e montat (`useSuppressPwaPrompts`).
//
// Modul trage doar React și `routeEvents` (fără importuri): stă în entry, iar
// pe rutele oaspetelui chunk-ul PWAPrompt nici nu se mai cere.
// ─────────────────────────────────────────────────────────────
import { useEffect, useSyncExternalStore } from 'react'
import { ROUTE_CHANGE_EVENT } from './routeEvents'

/** Fluxul oaspetelui (paritate cu parsePath din App.tsx). */
const GUEST_PREFIXES = ['/q/', '/m/', '/rezervare/']
/** Drumul de înscriere / acceptare: un card peste formular rupe pasul. */
const FUNNEL_EXACT = ['/auth', '/reset-password', '/sef-vanzari', '/echipa']
const FUNNEL_PREFIXES = ['/invite/', '/sef-vanzari/', '/echipa/']

/** Cardurile PWA au voie pe această rută? (dashboard, bucătărie, ospătar: da) */
export function pwaPromptAllowedOnPath(pathname: string): boolean {
  if (GUEST_PREFIXES.some((p) => pathname.startsWith(p))) return false
  if (FUNNEL_EXACT.includes(pathname)) return false
  if (FUNNEL_PREFIXES.some((p) => pathname.startsWith(p))) return false
  return true
}

let suppressions = 0
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

/**
 * Ascunde cardurile până la apelul funcției întoarse (idempotentă). Suprimările
 * se cumulează: cardurile revin abia când toate au fost eliberate.
 */
export function suppressPwaPrompts(): () => void {
  suppressions++
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    suppressions--
    notify()
  }
}

function readPath(): string {
  try {
    return window.location.pathname
  } catch {
    return '/'
  }
}

/**
 * Starea CURENTĂ, citită la apel (nu memorată): o rută schimbată prin
 * `replaceState` fără anunț e văzută la următoarea randare a cardului.
 */
export function pwaPromptAllowedNow(): boolean {
  return suppressions === 0 && pwaPromptAllowedOnPath(readPath())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  window.addEventListener(ROUTE_CHANGE_EVENT, onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(ROUTE_CHANGE_EVENT, onChange)
  }
}

/** Hook: re-randează la navigare și la suprimare / eliberare. */
export function usePwaPromptAllowed(): boolean {
  return useSyncExternalStore(subscribe, pwaPromptAllowedNow, () => false)
}

/** Ascunde cardurile PWA cât e montată componenta (onboarding-ul). */
export function useSuppressPwaPrompts(): void {
  useEffect(() => suppressPwaPrompts(), [])
}
