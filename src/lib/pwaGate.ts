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
//
// Tot AICI se prinde `beforeinstallprompt` (mai jos), nu în lib/pwa.ts: acela
// intră doar în chunk-ul PWAPrompt, care pe rutele fără carduri nu se mai
// încarcă deloc. Cu ascultătorul acolo, o încărcare directă pe /q, /m sau /auth
// nu-l mai înregistra: fără `preventDefault`, Chrome pe Android își arăta singur
// mini-infobar-ul de instalare (aplicația de staff, peste meniul oaspetelui), iar
// evenimentul (emis o singură dată pe încărcarea paginii) se pierdea — după
// /auth → /dashboard cardul „Instalează” nu mai apărea în sesiunea aceea, exact
// la primul login pe tableta nouă a bucătăriei.
// ─────────────────────────────────────────────────────────────
import { useEffect, useSyncExternalStore } from 'react'
import { ROUTE_CHANGE_EVENT } from './routeEvents'

/** Evenimentul de instalare din Chromium (nu e în tipurile DOM standard). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/** Anunțate către `usePWAInstall` (lib/pwa.ts) când promptul apare / dispare. */
export const PWA_INSTALLABLE_EVENT = 'pwa-installable'
export const PWA_INSTALLED_EVENT = 'pwa-installed'

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstallPrompt = e as BeforeInstallPromptEvent
    window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT))
  })
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    window.dispatchEvent(new CustomEvent(PWA_INSTALLED_EVENT))
  })
}

/** Promptul de instalare păstrat (null = browserul nu l-a oferit sau a fost folosit). */
export function deferredInstallPromptEvent(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt
}

/** Promptul s-a folosit (`prompt()` merge o singură dată pe eveniment). */
export function clearDeferredInstallPrompt(): void {
  deferredInstallPrompt = null
}

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
