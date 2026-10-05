// Teste pe intenția de plan (PR 5, „drumul spre primul leu").
//
// Defectul: intenția stătea în `sessionStorage`, iar linkul de confirmare din
// email se deschide în ALT tab — sesiune de storage nouă, fără intenție. Contul
// nou ateriza pe /dashboard, nu pe checkout. Acum: `localStorage` cu TTL 24 h,
// `?plan=` în linkul de confirmare, /auth?plan= pornește pe „Cont nou".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  PLAN_INTENT_TTL_MS,
  authRedirectUrl,
  clearPlanIntent,
  initialAuthMode,
  planFromSearch,
  planIntentDestination,
  readPlanIntent,
  writePlanIntent,
} from '../planIntent'

const KEY = 'menuvia.plan_intent'
const T0 = 1_760_000_000_000

function breakStorage(): void {
  for (const m of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(Storage.prototype, m).mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
  }
}

describe('planIntent — localStorage cu TTL', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PI1 intenția scrisă stă în localStorage (vizibilă din ALT tab), nu în sessionStorage', () => {
    writePlanIntent('growth', T0)
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(KEY)).not.toBeNull()
    // Un tab nou = sessionStorage gol; localStorage e comun originii.
    sessionStorage.clear()
    expect(readPlanIntent(T0 + 1000)).toBe('growth')
  })

  it('PI2 intenție validă chiar sub TTL → întoarsă', () => {
    writePlanIntent('starter', T0)
    expect(readPlanIntent(T0 + PLAN_INTENT_TTL_MS - 1)).toBe('starter')
  })

  it('PI3 intenție EXPIRATĂ → ignorată ȘI ștearsă', () => {
    writePlanIntent('growth', T0)
    expect(readPlanIntent(T0 + PLAN_INTENT_TTL_MS)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
    // Controlul: nici la o citire „din trecut" nu mai reapare.
    expect(readPlanIntent(T0 + 1)).toBeNull()
  })

  it('PI4 dată din viitor (ceas dat înapoi) → tratată ca expirată', () => {
    writePlanIntent('growth', T0 + 10_000)
    expect(readPlanIntent(T0)).toBeNull()
  })

  it('PI5 valoare stricată / plan necunoscut → null, fără excepție', () => {
    localStorage.setItem(KEY, '{nu-e-json')
    expect(readPlanIntent(T0)).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ plan: 'enterprise', at: T0 }))
    expect(readPlanIntent(T0)).toBeNull()
    writePlanIntent('business', T0)
    expect(readPlanIntent(T0)).toBeNull()
  })

  it('PI6 compatibilitate: intenția veche din sessionStorage (tab dinainte de deploy) e citită', () => {
    sessionStorage.setItem(KEY, 'growth')
    expect(readPlanIntent(T0)).toBe('growth')
    clearPlanIntent()
    expect(readPlanIntent(T0)).toBeNull()
  })

  it('PI7 storage care ARUNCĂ (RESID-15) → fail-open: nicio excepție, „fără intenție"', () => {
    breakStorage()
    expect(() => writePlanIntent('growth', T0)).not.toThrow()
    expect(() => clearPlanIntent()).not.toThrow()
    expect(readPlanIntent(T0)).toBeNull()
    expect(planIntentDestination(T0)).toBeNull()
  })
})

describe('planIntent — redirect, link de confirmare, modul formularului', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('PI8 cu intenție validă, sesiunea nouă duce la /pricing (checkout automat); fără, la destinația pe roluri', () => {
    expect(planIntentDestination(T0)).toBeNull()
    writePlanIntent('growth', T0)
    expect(planIntentDestination(T0 + 60_000)).toBe('/pricing')
    // Expirată → înapoi pe destinația obișnuită.
    expect(planIntentDestination(T0 + PLAN_INTENT_TTL_MS)).toBeNull()
  })

  it('PI9 linkul de confirmare poartă ?plan= (alt dispozitiv), fără el doar /auth', () => {
    expect(authRedirectUrl('https://menuvia.ro', 'growth')).toBe('https://menuvia.ro/auth?plan=growth')
    expect(authRedirectUrl('https://menuvia.ro/', 'starter')).toBe(
      'https://menuvia.ro/auth?plan=starter',
    )
    expect(authRedirectUrl('https://menuvia.ro', null)).toBe('https://menuvia.ro/auth')
    // Și înapoi: /auth?plan= din link e recunoscut.
    expect(planFromSearch('?plan=growth&code=abc')).toBe('growth')
  })

  it('PI10 /auth?plan=… pornește pe „Cont nou"; fără plan (sau plan necunoscut) pe „Autentificare"', () => {
    expect(initialAuthMode('?plan=growth&lang=ro')).toBe('signup')
    expect(initialAuthMode('?lang=ro&plan=starter')).toBe('signup')
    expect(initialAuthMode('?lang=ro')).toBe('login')
    expect(initialAuthMode('')).toBe('login')
    expect(initialAuthMode('?plan=hacker')).toBe('login')
  })

  it('PI11 intenția din storage NU schimbă modul (omul care revine are deja cont)', () => {
    writePlanIntent('growth')
    expect(initialAuthMode('')).toBe('login')
  })
})
