// Teste pe întoarcerea din Stripe (PR 5). Formele exacte ale URL-urilor vin din
// `netlify/functions/stripe-checkout.js` (SR1 le îngheață acolo): success →
// /dashboard?checkout=success&checkout_plan=<plan>, cancel → /pricing?checkout=cancelled.
// CR13/CR14 (recenzie pe #284): „activ" = profilul are planul CUMPĂRAT, nu
// „orice plan ≠ free" — un cont cu plan manual îl are pe cel vechi înaintea webhook-ului. Până la acest hook niciun cod din
// `src/` nu citea parametrul.
// CR18–CR25 (CR-M1, recenzie pe #385): `subscription_started` cere, pe lângă
// potrivirea de plan, marcajul `noteCheckoutRedirect` lăsat de App.tsx în ACEST
// tab, pentru ACEST cont și plan, consumat la citire. Bannerul NU depinde de
// marcaj. `track` e singurul mock; marcajul, contul și ștergerea lui trec prin
// implementarea REALĂ din lib/analytics.ts (aceeași stare de modul). Plecarea spre
// Stripe e o navigare completă: `leaveForStripe` notează marcajul și golește
// starea modulului, sessionStorage-ul tabului rămâne. Marcajul se scrie doar cu
// acordul „Performanță” (AN36), deci blocul îl pune în localStorage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }))
vi.mock('../../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/analytics')>()
  return { ...actual, track: trackMock }
})

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
import {
  CHECKOUT_REDIRECT_KEY,
  noteCheckoutRedirect,
  resetAnalyticsForTests,
  setAnalyticsUser,
} from '../../lib/analytics'

function at(path: string): void {
  window.history.replaceState(null, '', path)
}

function setup(initial: CheckoutReturnInput) {
  return renderHook((props: CheckoutReturnInput) => useCheckoutReturn(props), {
    initialProps: initial,
  })
}

/** App.tsx chiar înainte de `window.location.href = url`, apoi pagina pleacă. */
function leaveForStripe(uid: string | null, plan: string): void {
  setAnalyticsUser(uid)
  noteCheckoutRedirect(plan)
  resetAnalyticsForTests()
}

const subscriptionEvents = (): unknown[][] =>
  trackMock.mock.calls.filter((c: unknown[]) => c[0] === 'subscription_started')

describe('useCheckoutReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
    resetAnalyticsForTests()
    trackMock.mockClear()
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

describe('useCheckoutReturn — subscription_started (CR-M1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
    // Marcajul se scrie DOAR cu acordul „Performanță” (servește doar statisticii);
    // fără acord `subscription_started` nu pleacă oricum.
    localStorage.setItem(
      'menuvia_cookie_consent',
      JSON.stringify({ necessary: true, performance: true, functional: false, timestamp: 1 }),
    )
    resetAnalyticsForTests()
    trackMock.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetAnalyticsForTests()
    at('/')
  })

  it('CR18 checkout pornit din acest tab, webhook-ul scrie planul după încărcare → un singur eveniment', () => {
    // Controlul pozitiv al lui CR19–CR21: cu marcajul potrivit, evenimentul pleacă.
    leaveForStripe('u1', 'growth')
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result, rerender } = setup({ hasUser: true, plan: 'free', refreshProfile })
    expect(result.current.status).toBe('activating')
    expect(subscriptionEvents()).toHaveLength(0)

    rerender({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('active')
    expect(subscriptionEvents()).toEqual([['subscription_started', { plan: 'growth' }]])
    // Marcajul e consumat; randările următoare nu mai emit nimic.
    expect(sessionStorage.getItem(CHECKOUT_REDIRECT_KEY)).toBeNull()
    rerender({ hasUser: true, plan: 'growth', refreshProfile })
    expect(subscriptionEvents()).toHaveLength(1)
  })

  it('CR19 cont deja pe Growth, URL de succes fără checkout din acest tab (reload / semn de carte) → banner activ, ZERO evenimente', () => {
    // Mutația care pică: `track` pe potrivirea de plan singură (codul de dinainte).
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'growth', refreshProfile })
    // Bannerul rămâne neschimbat: nu e analytics.
    expect(result.current.status).toBe('active')
    expect(subscriptionEvents()).toHaveLength(0)
  })

  it('CR20 webhook-ul a câștigat cursa → numărat o dată; reîncărcarea aceluiași URL în tab nu mai numără', () => {
    // Mutația care pică: citirea marcajului fără să-l consume (a doua încărcare
    // l-ar găsi din nou și ar număra al doilea abonament).
    leaveForStripe('u1', 'growth')
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const first = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(first.result.current.status).toBe('active')
    expect(subscriptionEvents()).toHaveLength(1)
    first.unmount()

    // Încărcare nouă a documentului cu URL-ul de succes intact (replaceState
    // eșuat, sau un semn de carte deschis în același tab).
    resetAnalyticsForTests()
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const second = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(second.result.current.status).toBe('active')
    expect(subscriptionEvents()).toHaveLength(1)
  })

  it('CR21 marcajul altui cont sau al altui plan din același tab nu e dovada', () => {
    // Mutația care pică: verificarea doar a EXISTENȚEI marcajului (fără plan/cont).
    // Dispozitiv comun: A pleacă spre Stripe, B (deja pe Growth) deschide URL-ul.
    leaveForStripe('uA', 'growth')
    setAnalyticsUser('uB')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const other = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(other.result.current.status).toBe('active')
    other.unmount()

    // Același cont, alt plan decât cel pentru care a plecat.
    resetAnalyticsForTests()
    leaveForStripe('uB', 'pro')
    setAnalyticsUser('uB')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const wrongPlan = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(wrongPlan.result.current.status).toBe('active')
    expect(subscriptionEvents()).toHaveLength(0)
  })

  it('CR22 contul se publică DUPĂ montare (getSession asincron) → marcajul se citește abia la activare', () => {
    // Mutația care pică: citirea marcajului la montare — contul e încă necunoscut,
    // potrivirea pică și marcajul e consumat degeaba.
    leaveForStripe('u1', 'growth')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result, rerender } = setup({ hasUser: false, plan: null, refreshProfile })
    expect(result.current.status).toBe('activating')
    // Ordinea din AuthContext: contul spre analytics, apoi profilul.
    setAnalyticsUser('u1')
    rerender({ hasUser: true, plan: null, refreshProfile })
    rerender({ hasUser: true, plan: 'free', refreshProfile })
    expect(subscriptionEvents()).toHaveLength(0)
    rerender({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('active')
    expect(subscriptionEvents()).toEqual([['subscription_started', { plan: 'growth' }]])
  })

  it('CR23 anularea nu consumă marcajul: înapoi în Stripe și plata tot se numără o dată', () => {
    // Mutația care pică: ștergerea marcajului pe `?checkout=cancelled`.
    leaveForStripe('u1', 'growth')
    setAnalyticsUser('u1')
    at('/pricing?checkout=cancelled')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const cancelled = setup({ hasUser: true, plan: 'free', refreshProfile })
    expect(cancelled.result.current.status).toBe('cancelled')
    expect(subscriptionEvents()).toHaveLength(0)
    expect(sessionStorage.getItem(CHECKOUT_REDIRECT_KEY)).not.toBeNull()
    cancelled.unmount()

    // Butonul Înapoi duce în sesiunea Stripe încă deschisă; omul plătește.
    resetAnalyticsForTests()
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const { result, rerender } = setup({ hasUser: true, plan: 'free', refreshProfile })
    rerender({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('active')
    expect(subscriptionEvents()).toHaveLength(1)
  })

  it('CR24 storage care ARUNCĂ (Safari „Block All Cookies") → banner activ, fără eveniment, fără excepție', () => {
    // Mutația care pică: citirea marcajului direct din sessionStorage, fără gardă.
    const boom = (): never => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom)
    leaveForStripe('u1', 'growth')
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success&checkout_plan=growth')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result } = setup({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('active')
    expect(subscriptionEvents()).toHaveLength(0)
  })

  it('CR25 URL fără `checkout_plan` (funcție veche): schimbarea de plan + marcajul → numărat cu planul NOU', () => {
    // Mutația care pică: marcajul citit pe planul din URL (`purchased`, aici null)
    // în loc de planul activat.
    leaveForStripe('u1', 'growth')
    setAnalyticsUser('u1')
    at('/dashboard?checkout=success')
    const refreshProfile = vi.fn(() => Promise.resolve())
    const { result, rerender } = setup({ hasUser: true, plan: 'free', refreshProfile })
    rerender({ hasUser: true, plan: 'growth', refreshProfile })
    expect(result.current.status).toBe('active')
    expect(subscriptionEvents()).toEqual([['subscription_started', { plan: 'growth' }]])
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
