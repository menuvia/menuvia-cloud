// Bannerul de întoarcere din Stripe (recenzie pe #284).
//
//   CB1  în NICIO stare bannerul nu pretinde că s-a încasat ceva: pe
//        Meniu Digital / Meniu + Comenzi primele 30 de zile sunt trial, deci
//        la întoarcere nu s-a plătit nimic. Pe codul vechi „activating" și
//        „slow" spuneau „Plata a fost primită" → CB1 pică;
//   CB2  control pozitiv: fiecare stare chiar randează (altfel CB1 ar trece
//        pe un banner gol) — inclusiv „activ" doar pe planul CUMPĂRAT.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: useAuthMock }))

import CheckoutReturnBanner from '../CheckoutReturnBanner'
import { CHECKOUT_POLL_MAX_MS } from '../../hooks/useCheckoutReturn'

// Orice formulare care afirmă o încasare (RO).
const CLAIMS_PAYMENT = /plat[aă] a fost (primit|încasat|efectuat)|am încasat|ai plătit|plata a reușit/i

function at(path: string): void {
  window.history.replaceState(null, '', path)
}

function auth(plan: string): void {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', email: 'ana@x.test' },
    profile: { plan },
    refreshProfile: () => Promise.resolve(),
  })
}

function bannerText(): string {
  return screen.getByTestId('checkout-return-banner').textContent ?? ''
}

describe('CheckoutReturnBanner', () => {
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

  it('CB1+CB2 activating → slow: text neutru, fără „plata a fost primită"', () => {
    at('/dashboard?checkout=success&checkout_plan=starter')
    auth('free')
    render(<CheckoutReturnBanner />)
    expect(bannerText()).toMatch(/Activăm planul/)
    expect(bannerText()).not.toMatch(CLAIMS_PAYMENT)
    act(() => {
      vi.advanceTimersByTime(CHECKOUT_POLL_MAX_MS)
    })
    expect(bannerText()).toMatch(/durează mai mult/)
    expect(bannerText()).not.toMatch(CLAIMS_PAYMENT)
  })

  it('CB1+CB2 activ (planul cumpărat e în profil) și anulat: nici ele nu pretind o încasare', () => {
    at('/dashboard?checkout=success&checkout_plan=growth')
    auth('growth')
    const { unmount } = render(<CheckoutReturnBanner />)
    expect(bannerText()).toMatch(/Planul tău e activ/)
    expect(bannerText()).not.toMatch(CLAIMS_PAYMENT)
    unmount()

    at('/pricing?checkout=cancelled')
    auth('free')
    render(<CheckoutReturnBanner />)
    expect(bannerText()).toMatch(/anulată/)
    expect(bannerText()).not.toMatch(CLAIMS_PAYMENT)
  })

  it('CB3 regexul chiar prinde formularea veche (anti-vacuitate)', () => {
    expect('Plata a fost primită. Actualizăm contul tău').toMatch(CLAIMS_PAYMENT)
    expect('Abonamentul a fost înregistrat — activăm planul').not.toMatch(CLAIMS_PAYMENT)
  })
})
