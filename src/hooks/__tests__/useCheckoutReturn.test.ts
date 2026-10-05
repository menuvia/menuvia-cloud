// Teste pe întoarcerea din Stripe (PR 5). Formele exacte ale URL-urilor vin din
// `netlify/functions/stripe-checkout.js` (SR1 le îngheață acolo): success →
// /dashboard?checkout=success&checkout_plan=<plan>, cancel → /pricing?checkout=cancelled.
// CR13/CR14 (recenzie pe #284): „activ" = profilul are planul CUMPĂRAT, nu
// „orice plan ≠ free" — un cont cu plan manual îl are pe cel vechi înaintea webhook-ului. Până la acest hook niciun cod din
// `src/` nu citea parametrul.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  CHECKOUT_POLL_INTERVAL_MS,
  CHECKOUT_POLL_MAX_MS,
  useCheckoutReturn,
  type CheckoutReturnInput,
} from '../useCheckoutReturn'
import {
  checkoutActivated,
  readCheckoutPlanParam,
  readCheckoutReturnParam,
  stripCheckoutParam,
} from '../../lib/checkoutReturn'
import { readPlanIntent, writePlanIntent } from '../../lib/planIntent'

function at(path: string): void {
  window.history.replaceState(null, '', path)
}

function setup(initial: CheckoutReturnInput) {
  return renderHook((props: CheckoutReturnInput) => useCheckoutReturn(props), {
    initialProps: initial,
  })
}

describe('useCheckoutReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    at('/')
  })

  it('CR1 success + plan care se SCHIMBĂ → reîmprospătare la 2 s, apoi „activ" și oprirea buclei', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result, rerender } = setup({ hasUser: true, plan: 'free', refreshProfile })
    expect(result.current.status).toBe('activating')
    expect(refreshProfile).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_INTERVAL_MS)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_INTERVAL_MS)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(2)

    // Webhook-ul a scris planul; profilul reîncărcat îl aduce.
    rerender({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('active')

    // Bucla s-a oprit: niciun apel nou, nici după plafon.
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('active')
  })

  it('CR2 success FĂRĂ schimbare de plan → oprire la 30 s cu „slow", nu buclă infinită', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'free', refreshProfile })

    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS - 1)
    })
    expect(result.current.status).toBe('activating')
    const callsBefore = refreshProfile.mock.calls.length
    expect(callsBefore).toBe(Math.floor((CHECKOUT_POLL_MAX_MS - 1) / CHECKOUT_POLL_INTERVAL_MS))

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.status).toBe('slow')
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    // Controlul: după „slow" nu mai pleacă nicio cerere.
    expect(refreshProfile.mock.calls.length).toBeLessThanOrEqual(callsBefore + 1)
    const settled = refreshProfile.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(settled)
  })

  it('CR3 planul CUMPĂRAT e DEJA vizibil la întoarcere (webhook-ul a câștigat cursa) → „activ" imediat', () => {
    at('/dashboard?checkout=success&checkout_plan=starter')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'starter', refreshProfile })
    expect(result.current.status).toBe('active')
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).not.toHaveBeenCalled()
  })

  it('CR13 plan MANUAL vechi vizibil la întoarcere ≠ planul cumpărat → NU „activ" până scrie webhook-ul', () => {
    // Cont pe Meniu + Comenzi dat manual (fără abonament Stripe) cumpără Fiscalizare.
    at('/dashboard?checkout=success&checkout_plan=pro')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result, rerender } = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('activating')
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_INTERVAL_MS)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(1)
    // Un alt plan decât cel cumpărat tot nu e dovada.
    rerender({ hasUser: true, plan: 'starter', refreshProfile })
    expect(result.current.status).toBe('activating')
    // Control pozitiv: webhook-ul scrie planul cumpărat → activ.
    rerender({ hasUser: true, plan: 'pro', refreshProfile })
    expect(result.current.status).toBe('active')
  })

  it('CR14 plan manual, webhook-ul nu ajunge în 30 s → „slow", nu un fals „activ"', () => {
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'starter', refreshProfile })
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(result.current.status).toBe('slow')
  })

  it('CR15 fără `checkout_plan` (funcție veche): un plan plătit deja vizibil NU e dovada, doar o schimbare', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result, rerender } = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('activating')
    rerender({ hasUser: true, plan: 'pro', refreshProfile })
    expect(result.current.status).toBe('active')
  })

  it('CR4 fără sesiune nu se reîmprospătează nimic, dar plafonul de 30 s tot dă un mesaj', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: false, plan: null, refreshProfile })
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).not.toHaveBeenCalled()
    expect(result.current.status).toBe('slow')
  })

  it('CR5 cancelled → mesaj de anulare, fără nicio reîmprospătare', () => {
    at('/pricing?checkout=cancelled')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'free', refreshProfile })
    expect(result.current.status).toBe('cancelled')
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).not.toHaveBeenCalled()
    expect(result.current.status).toBe('cancelled')
  })

  it('CR6 parametrul se ȘTERGE din URL (restul rămâne) și intenția de plan se consumă', () => {
    writePlanIntent('growth')
    at('/pricing?lang=ro&checkout=cancelled#faq')
    setup({ hasUser: true, plan: 'free', refreshProfile: () => Promise.resolve() })
    expect(window.location.pathname).toBe('/pricing')
    expect(window.location.search).toBe('?lang=ro')
    expect(window.location.hash).toBe('#faq')
    // O intenție rămasă ar fi trimis omul înapoi în Stripe la următorul login.
    expect(readPlanIntent(null)).toBeNull()
  })

  it('CR7 fără parametru → idle, URL-ul și intenția NEATINSE (control pozitiv)', () => {
    writePlanIntent('growth')
    at('/dashboard?tab=home')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'free', refreshProfile })
    expect(result.current.status).toBe('idle')
    expect(window.location.search).toBe('?tab=home')
    expect(readPlanIntent(null)).toBe('growth')
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).not.toHaveBeenCalled()
  })

  it('CR8 demontarea oprește bucla și plafonul (cleanup)', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { unmount } = setup({ hasUser: true, plan: 'free', refreshProfile })
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_INTERVAL_MS)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    expect(refreshProfile).toHaveBeenCalledTimes(1)
  })

  it('CR9 dismiss → idle și oprirea buclei', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'free', refreshProfile })
    act(() => result.current.dismiss())
    expect(result.current.status).toBe('idle')
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(refreshProfile).not.toHaveBeenCalled()
  })

  it('CR10 un refreshProfile care RESPINGE nu oprește bucla și nu scapă ca unhandled rejection', () => {
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.reject(new Error('rețea')))
    const { result } = setup({ hasUser: true, plan: 'free', refreshProfile })
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_INTERVAL_MS * 2)
    })
    expect(refreshProfile).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('activating')
  })
})

describe('checkoutReturn — helperi puri', () => {
  it('CR11 doar success/cancelled sunt recunoscute', () => {
    expect(readCheckoutReturnParam('?checkout=success')).toBe('success')
    expect(readCheckoutReturnParam('?a=1&checkout=cancelled')).toBe('cancelled')
    expect(readCheckoutReturnParam('?checkout=canceled')).toBeNull()
    expect(readCheckoutReturnParam('')).toBeNull()
  })

  it('CR12 stripCheckoutParam păstrează calea, ceilalți parametri și hash-ul', () => {
    expect(stripCheckoutParam('https://x.ro/dashboard?checkout=success')).toBe('/dashboard')
    expect(
      stripCheckoutParam('https://x.ro/dashboard?checkout=success&checkout_plan=growth&tab=home'),
    ).toBe('/dashboard?tab=home')
    expect(stripCheckoutParam('https://x.ro/pricing?checkout=cancelled&lang=en#top')).toBe(
      '/pricing?lang=en#top',
    )
  })
})

describe('checkoutReturn — planul cumpărat', () => {
  it('CR16 checkout_plan: doar planurile cumpărabile; `plan=` (intenția de pe /auth) NU contează', () => {
    expect(readCheckoutPlanParam('?checkout=success&checkout_plan=growth')).toBe('growth')
    expect(readCheckoutPlanParam('?checkout_plan=enterprise')).toBe('enterprise')
    expect(readCheckoutPlanParam('?checkout_plan=free')).toBeNull()
    expect(readCheckoutPlanParam('?checkout=success&plan=growth')).toBeNull()
  })

  it('CR17 checkoutActivated: cu plan cumpărat, DOAR egalitatea; fără, doar schimbarea', () => {
    expect(checkoutActivated('pro', 'growth', 'growth')).toBe(false)
    expect(checkoutActivated('pro', 'growth', 'starter')).toBe(false)
    expect(checkoutActivated('pro', 'growth', 'pro')).toBe(true)
    expect(checkoutActivated('growth', 'growth', 'growth')).toBe(true)
    expect(checkoutActivated(null, 'growth', 'growth')).toBe(false)
    expect(checkoutActivated(null, 'free', 'growth')).toBe(true)
    expect(checkoutActivated(null, null, 'growth')).toBe(false)
  })
})
