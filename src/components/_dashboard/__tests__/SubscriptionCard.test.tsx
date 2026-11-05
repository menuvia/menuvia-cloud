// SubscriptionCard — „Abonament & facturare" din Setări → Abonament & cont
// (lotul O7c, nov 2026). Cardul îl vede DOAR proprietarul (SA1/SA2 din
// SettingsTabPlan.test.tsx), iar serverul (stripe-portal.js) răspunde 404
// `no_customer` când contul lui n-are client Stripe: proprietar pe gratuit care
// n-a pornit niciodată un checkout, sau cu plan setat manual / pilot. Până acum
// cardul îi spunea „Abonamentul e gestionat de contul proprietarului
// restaurantului." — fals (EL e proprietarul) și fără nicio ieșire.
//
//   SUB1  `no_customer` → textul neutru „…nu ai nimic de gestionat…" în
//         role=status, NICIUN „proprietar" în card, „Vezi planurile" ÎN LOCUL lui
//         „Gestionează abonamentul", iar click-ul cheamă `onSeePlans` o dată.
//         Mutațiile care pică: textul vechi „gestionat de contul proprietarului"
//         (b); butonul scos (c); butonul legat de un no-op (d).
//   SUB2  CONTROL POZITIV pentru SUB1: la prima randare și pe calea de redirect
//         (promisiune care nu se rezolvă) nu există „Vezi planurile" și nici
//         textul de no_customer. Mutația care pică: „Vezi planurile" randat
//         necondiționat (SUB1 singur ar rămâne verde).
//   SUB3  `portal_unavailable` cu mesaj românesc → role=alert cu EXACT acel text,
//         fără „Vezi planurile", iar „Gestionează abonamentul" rămâne (se poate
//         reîncerca). Mutația care pică: orice eroare cu cod tratată ca
//         no_customer (`if (be.code)`).
//   SUB4  corp englezesc fără cod („Stripe not configured", env lipsă pe server)
//         → textul de rezervă românesc, iar textul englezesc NU ajunge în DOM.
//         Mutația care pică: revenirea la `be.message || …`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openBillingPortal = vi.fn<() => Promise<never>>()

vi.mock('../../../lib/billing', () => ({
  openBillingPortal: () => openBillingPortal(),
}))

import { SubscriptionCard } from '../SubscriptionCard'

function billingError(message: string, code?: string): Error & { code?: string } {
  return Object.assign(new Error(message), { code })
}

const MANAGE = 'Gestionează abonamentul'
const SEE_PLANS = 'Vezi planurile'
const NO_CUSTOMER = /nu ai nimic de gestionat/i

beforeEach(() => {
  openBillingPortal.mockReset()
})

describe('SubscriptionCard', () => {
  it('SUB1: no_customer → mesaj adevărat, fără „proprietar", „Vezi planurile" cheamă onSeePlans', async () => {
    openBillingPortal.mockRejectedValueOnce(
      billingError('Nu ai încă un abonament de gestionat.', 'no_customer'),
    )
    const onSeePlans = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<SubscriptionCard onSeePlans={onSeePlans} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    // (a) textul neutru, ca informație (status), nu ca eroare.
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(NO_CUSTOMER)
    expect(screen.queryByRole('alert')).toBeNull()
    // (b) nimic despre „proprietar" — omul care citește E proprietarul.
    expect(container.textContent ?? '').not.toMatch(/proprietar/i)
    // (c) ieșirea înlocuiește butonul inutil, nu se adaugă lângă el.
    const seePlans = screen.getByRole('button', { name: SEE_PLANS })
    expect(screen.queryByRole('button', { name: MANAGE })).toBeNull()
    // (d) ieșirea chiar duce undeva.
    expect(onSeePlans).not.toHaveBeenCalled()
    await user.click(seePlans)
    expect(onSeePlans).toHaveBeenCalledTimes(1)
  })

  it('SUB2: control — fără no_customer nu există „Vezi planurile" (nici la randare, nici la redirect)', async () => {
    const onSeePlans = vi.fn()
    const user = userEvent.setup()
    render(<SubscriptionCard planName="Meniu Digital" onSeePlans={onSeePlans} />)
    // (a) prima randare: doar „Gestionează abonamentul".
    expect(screen.getByRole('button', { name: MANAGE })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
    expect(screen.queryByText(NO_CUSTOMER)).toBeNull()
    expect(onSeePlans).not.toHaveBeenCalled()
    // (b) calea de succes: openBillingPortal redirecționează și nu se mai întoarce.
    openBillingPortal.mockReturnValueOnce(new Promise<never>(() => {}))
    await user.click(screen.getByRole('button', { name: MANAGE }))
    expect(openBillingPortal).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Se deschide…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
    expect(screen.queryByText(NO_CUSTOMER)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSeePlans).not.toHaveBeenCalled()
  })

  it('SUB3: portal_unavailable → mesajul serverului ca eroare, „Gestionează abonamentul" rămâne', async () => {
    openBillingPortal.mockRejectedValueOnce(
      billingError('Portalul de facturare nu e disponibil momentan.', 'portal_unavailable'),
    )
    const user = userEvent.setup()
    render(<SubscriptionCard onSeePlans={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Portalul de facturare nu e disponibil momentan\.$/)
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
    expect(screen.queryByText(NO_CUSTOMER)).toBeNull()
    // Reîncercarea rămâne posibilă (butonul nu mai e în încărcare).
    expect(screen.getByRole('button', { name: MANAGE })).toBeEnabled()
  })

  it('SUB4: corp englezesc fără cod → textul de rezervă românesc, englezescul nu apare', async () => {
    openBillingPortal.mockRejectedValueOnce(billingError('Stripe not configured'))
    const user = userEvent.setup()
    const { container } = render(<SubscriptionCard onSeePlans={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: MANAGE }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Nu am putut deschide portalul de facturare/)
    expect(container.textContent ?? '').not.toMatch(/Stripe not configured/)
    expect(screen.queryByRole('button', { name: SEE_PLANS })).toBeNull()
  })
})
