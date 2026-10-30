// Fiecare rol pe ecranul lui după login (S1).
//
//   PL1  doar bucătărie → /kitchen; doar ospătar → /waiter
//   PL2  fără restaurant: afiliat ACTIV sau în așteptare → /afiliat (panoul agentului)
//   PL3  fără restaurant, fără afiliere (sau afiliat închis/respins) → /dashboard
//        (patronul nou ajunge pe onboarding)
//   PL4  AVÂND restaurant, agentul rămâne pe /dashboard — afilierea nu mută un patron
//   PL5  roluri mixte → /dashboard (comportamentul de dinainte)
//
// Cu intenție de plan (ux-owner-checkout-before-restaurant): întâi restaurantul,
// apoi planul.
//   RQ1  patronul fără restaurant → /dashboard (onboarding), NU /pricing — mutația
//        care pică: „intenție ⇒ /pricing” necondiționat (comportamentul vechi)
//   RQ2  cine deține un restaurant → /pricing (checkout-ul automat rămâne)
//   RQ3  agentul fără restaurant care a ales un plan → onboarding, nu /afiliat
//   RQ4  personalul altui restaurant (fără owner) → ecranul rolului, nu Stripe
import { describe, it, expect } from 'vitest'
import { pickPlanIntentDestination, pickPostLoginDestination } from '../postLogin'

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

describe('pickPlanIntentDestination — întâi restaurantul, apoi planul', () => {
  it('RQ1 patronul fără restaurant → onboarding, nu Stripe', () => {
    expect(pickPlanIntentDestination({ roles: [], affiliate: 'none' })).toBe('/dashboard')
    expect(pickPlanIntentDestination({ roles: [], affiliate: 'other' })).toBe('/dashboard')
  })

  it('RQ2 cine deține un restaurant → /pricing', () => {
    expect(pickPlanIntentDestination({ roles: ['owner'], affiliate: 'none' })).toBe('/pricing')
    expect(pickPlanIntentDestination({ roles: ['waiter', 'owner'], affiliate: 'active' })).toBe(
      '/pricing',
    )
  })

  it('RQ3 agentul fără restaurant care a ales un plan → onboarding', () => {
    expect(pickPlanIntentDestination({ roles: [], affiliate: 'active' })).toBe('/dashboard')
    expect(pickPlanIntentDestination({ roles: [], affiliate: 'pending' })).toBe('/dashboard')
  })

  it('RQ4 personalul altui restaurant → ecranul rolului', () => {
    expect(pickPlanIntentDestination({ roles: ['waiter'], affiliate: 'none' })).toBe('/waiter')
    expect(pickPlanIntentDestination({ roles: ['kitchen'], affiliate: 'none' })).toBe('/kitchen')
    expect(pickPlanIntentDestination({ roles: ['manager'], affiliate: 'none' })).toBe('/dashboard')
  })
})
