// Fiecare rol pe ecranul lui după login (S1).
//
//   PL1  doar bucătărie → /kitchen; doar ospătar → /waiter
//   PL2  fără restaurant: afiliat ACTIV sau în așteptare → /afiliat (panoul agentului)
//   PL3  fără restaurant, fără afiliere (sau afiliat închis/respins) → /dashboard
//        (patronul nou ajunge pe onboarding)
//   PL4  AVÂND restaurant, agentul rămâne pe /dashboard — afilierea nu mută un patron
//   PL5  roluri mixte → /dashboard (comportamentul de dinainte)
import { describe, it, expect } from 'vitest'
import { pickPostLoginDestination } from '../postLogin'

describe('pickPostLoginDestination', () => {
  it('PL1 personalul pe pagina lui', () => {
    expect(pickPostLoginDestination({ roles: ['kitchen'], affiliate: 'none' })).toBe('/kitchen')
    expect(pickPostLoginDestination({ roles: ['kitchen', 'kitchen'], affiliate: 'none' })).toBe('/kitchen')
    expect(pickPostLoginDestination({ roles: ['waiter'], affiliate: 'none' })).toBe('/waiter')
  })

  it('PL2 agentul fără restaurant → panoul de afiliat', () => {
    expect(pickPostLoginDestination({ roles: [], affiliate: 'active' })).toBe('/afiliat')
    expect(pickPostLoginDestination({ roles: [], affiliate: 'pending' })).toBe('/afiliat')
  })

  it('PL3 patronul nou (sau afiliat închis/respins) → /dashboard (onboarding)', () => {
    expect(pickPostLoginDestination({ roles: [], affiliate: 'none' })).toBe('/dashboard')
    expect(pickPostLoginDestination({ roles: [], affiliate: 'other' })).toBe('/dashboard')
  })

  it('PL4 cine are restaurant rămâne pe /dashboard, chiar dacă e și afiliat', () => {
    expect(pickPostLoginDestination({ roles: ['owner'], affiliate: 'active' })).toBe('/dashboard')
    expect(pickPostLoginDestination({ roles: ['manager'], affiliate: 'pending' })).toBe('/dashboard')
    expect(pickPostLoginDestination({ roles: ['waiter'], affiliate: 'active' })).toBe('/waiter')
  })

  it('PL5 roluri mixte → /dashboard', () => {
    expect(pickPostLoginDestination({ roles: ['kitchen', 'waiter'], affiliate: 'none' })).toBe('/dashboard')
    expect(pickPostLoginDestination({ roles: ['owner', 'waiter'], affiliate: 'none' })).toBe('/dashboard')
  })
})
