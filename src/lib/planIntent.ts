// ─────────────────────────────────────────────────────────────
// planIntent.ts — planul-țintă ales pe pricing/landing, păstrat între
// pricing → /auth → (confirmarea emailului) → checkout.
//
// Defectul reparat (PR 5, „drumul spre primul leu"): intenția stătea în
// `sessionStorage`, iar linkul de confirmare din email se deschide într-un tab
// NOU — adică într-o sesiune de storage nouă, fără intenție. Restaurantul nou
// confirma contul și ateriza pe /dashboard, nu pe checkout: funelul se rupea
// exact între „Începe" și primul leu.
//
// Acum intenția stă în `localStorage` (vizibilă din orice tab) cu un TTL de
// 24 h — o intenție expirată e IGNORATĂ și ștearsă, ca un click vechi de o
// săptămână să nu arunce pe cineva în Stripe la următorul login. Linkul de
// confirmare poartă în plus `?plan=` (`authRedirectUrl`), deci funcționează și
// pe ALT dispozitiv, unde storage-ul local nu ajută deloc.
//
// Storage-ul poate ARUNCA (Safari cu „Block All Cookies", unele webview-uri —
// clasa RESID-15): fiecare acces e în try/catch și cade FAIL-OPEN pe „fără
// intenție", niciodată pe o excepție care ar urca la ErrorBoundary.
// ─────────────────────────────────────────────────────────────

const PLAN_INTENT_KEY = 'menuvia.plan_intent'

/** Cât rămâne valabilă intenția: destul pentru un email confirmat a doua zi. */
export const PLAN_INTENT_TTL_MS = 24 * 60 * 60 * 1000

export type PlanIntentId = 'starter' | 'growth' | 'pro'

export function isPlanIntentId(v: unknown): v is PlanIntentId {
  return v === 'starter' || v === 'growth' || v === 'pro'
}

interface StoredIntent {
  plan: PlanIntentId
  at: number
}

function parseStored(raw: string | null): StoredIntent | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const rec = parsed as Record<string, unknown>
    if (!isPlanIntentId(rec.plan)) return null
    if (typeof rec.at !== 'number' || !Number.isFinite(rec.at)) return null
    return { plan: rec.plan, at: rec.at }
  } catch {
    // JSON stricat sau valoarea brută din versiunea pe sessionStorage.
    return null
  }
}

/**
 * Intenția validă (neexpirată), sau null. O intenție expirată sau stricată se
 * ȘTERGE la citire.
 *
 * Compatibilitate: un tab deschis înainte de deploy are intenția în
 * `sessionStorage`, ca text simplu — o citim încă, ca omul aflat chiar atunci
 * în mijlocul funelului să nu o piardă.
 */
export function readPlanIntent(now: number = Date.now()): PlanIntentId | null {
  try {
    const raw = localStorage.getItem(PLAN_INTENT_KEY)
    if (raw !== null) {
      const stored = parseStored(raw)
      // Data din viitor (ceas dat înapoi) e tratată tot ca expirată: altfel
      // intenția ar putea trăi oricât.
      if (stored && now - stored.at >= 0 && now - stored.at < PLAN_INTENT_TTL_MS) {
        return stored.plan
      }
      localStorage.removeItem(PLAN_INTENT_KEY)
    }
  } catch {
    /* storage indisponibil — încercăm calea veche, apoi „fără intenție" */
  }
  try {
    const legacy = sessionStorage.getItem(PLAN_INTENT_KEY)
    if (isPlanIntentId(legacy)) return legacy
  } catch {
    /* ignore */
  }
  return null
}

export function clearPlanIntent(): void {
  try {
    localStorage.removeItem(PLAN_INTENT_KEY)
  } catch {
    /* ignore (private mode) */
  }
  try {
    sessionStorage.removeItem(PLAN_INTENT_KEY)
  } catch {
    /* ignore (private mode) */
  }
}

export function writePlanIntent(plan: string, now: number = Date.now()): void {
  // Doar planurile cunoscute: o valoare oarecare dintr-un URL nu are ce căuta
  // în drumul spre checkout.
  if (!isPlanIntentId(plan)) return
  const value: StoredIntent = { plan, at: now }
  try {
    localStorage.setItem(PLAN_INTENT_KEY, JSON.stringify(value))
  } catch {
    /* ignore (private mode) — `?plan=` din URL rămâne plasa */
  }
}

/** Planul din `?plan=` al unui query string, dacă e unul cunoscut. */
export function planFromSearch(search: string): PlanIntentId | null {
  try {
    const p = new URLSearchParams(search).get('plan')
    return isPlanIntentId(p) ? p : null
  } catch {
    return null
  }
}

/**
 * Modul inițial al formularului de pe /auth. `/auth?plan=…` vine din „Începe"
 * pe un plan — adică de la cineva care NU are încă cont; a-l pune pe
 * „Autentificare" îl obliga să găsească singur comutatorul. Intenția păstrată
 * în storage NU contează aici: un om care revine să se logheze are deja cont.
 */
export function initialAuthMode(search: string): 'login' | 'signup' {
  return planFromSearch(search) ? 'signup' : 'login'
}

/**
 * URL-ul din linkul de confirmare a contului. Poartă `?plan=` când există o
 * intenție, ca funelul să supraviețuiască și unui click pe ALT dispozitiv.
 */
export function authRedirectUrl(origin: string, plan: PlanIntentId | null): string {
  const base = origin.replace(/\/+$/, '') + '/auth'
  return plan ? base + '?plan=' + encodeURIComponent(plan) : base
}
