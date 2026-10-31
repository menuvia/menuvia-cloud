// Pagina de prețuri — Planul 3 (Fiscalizare) NU ajunge niciodată la checkout.
//
// Regula de aur + decizia D4: Fiscalizarea se cere prin „Cere ofertă" (email),
// nu se cumpără singură. Înainte, când WhatsApp era oprit (VITE_WHATSAPP_NUMBER
// lipsă), butonul ei cădea pe `onCheckout('pro')`, adică pe Stripe.
//
//   PP1  fără WhatsApp: CTA-ul Fiscalizării e un link mailto „Cere ofertă" și
//        NICIUN buton de pe pagină nu cheamă onCheckout cu pro/enterprise
//        (controlul pozitiv: starter și growth chiar ajung la onCheckout)
//   PP2  același lucru cu WhatsApp pornit
//   PP3  o intenție de plan 'pro' păstrată din altă parte NU pornește checkout
//        la autentificare (control pozitiv: 'growth' îl pornește)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const { authState } = vi.hoisted(() => ({
  authState: { user: null as { id: string; email: string } | null },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}))

import PricingPage from '../PricingPage'
import { writePlanIntent } from '../../lib/planIntent'
import { isQuoteOnlyPlan } from '../../lib/planCta'

function renderPage(onCheckout: (plan: string) => void) {
  return render(<PricingPage onBack={vi.fn()} onLogin={vi.fn()} onCheckout={onCheckout} />)
}

async function clickEveryButton() {
  // Lista se ia O DATĂ: butoanele rămân aceleași noduri DOM între randări.
  for (const button of screen.getAllByRole('button')) {
    await act(async () => {
      fireEvent.click(button)
    })
  }
}

beforeEach(() => {
  authState.user = null
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('PricingPage — Fiscalizarea nu are cale spre checkout', () => {
  it('PP1: fără WhatsApp — „Cere ofertă" e link mailto, onCheckout nu primește pro', async () => {
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '')
    const onCheckout = vi.fn()
    renderPage(onCheckout)

    const quote = screen.getAllByRole('link', { name: 'Cere ofertă' })
    expect(quote).toHaveLength(1)
    expect(quote[0].getAttribute('href') ?? '').toMatch(/^mailto:/)

    await clickEveryButton()

    const plans = onCheckout.mock.calls.map((c) => String(c[0]))
    // Control pozitiv: butoanele planurilor self-serve chiar funcționează.
    expect(plans).toContain('starter')
    expect(plans).toContain('growth')
    expect(plans.filter((p) => isQuoteOnlyPlan(p))).toEqual([])
  })

  it('PP2: cu WhatsApp pornit — tot nicio cale spre checkout pentru pro/enterprise', async () => {
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '40700000000')
    const onCheckout = vi.fn()
    renderPage(onCheckout)

    expect(screen.getAllByRole('link', { name: 'Cere ofertă' })).toHaveLength(1)
    await clickEveryButton()

    const plans = onCheckout.mock.calls.map((c) => String(c[0]))
    expect(plans).toContain('growth')
    expect(plans.filter((p) => isQuoteOnlyPlan(p))).toEqual([])
  })

  it("PP3: intenția 'pro' păstrată nu pornește checkout-ul (control: 'growth' îl pornește)", async () => {
    authState.user = { id: 'u1', email: 'ana@example.test' }

    writePlanIntent('pro')
    const onCheckoutPro = vi.fn()
    const first = renderPage(onCheckoutPro)
    await act(async () => {})
    expect(onCheckoutPro).not.toHaveBeenCalled()
    first.unmount()

    window.localStorage.clear()
    window.sessionStorage.clear()
    writePlanIntent('growth')
    const onCheckoutGrowth = vi.fn()
    renderPage(onCheckoutGrowth)
    await act(async () => {})
    expect(onCheckoutGrowth).toHaveBeenCalledWith('growth')
  })
})
