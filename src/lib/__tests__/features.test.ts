// src/lib/__tests__/features.test.ts
// Teste pentru regula de aur (planTier) + mapping comercial de planuri.
// Acoperire critică (audit P0): planTier() decide ce tier vede UI-ul și
// e folosit ca semn de gating peste tot; getPlanByInternalId() decide
// numele comercial văzut pe AuthPage pill, Pricing, Upgrade.

import { describe, it, expect } from 'vitest'
import { planTier, planNameForTier, PLAN_NAMES, suggestUpgrade } from '../features'
import { getPlanByInternalId, getPlan } from '../plans'

describe('planTier — regula de aur (bani + bon = Plan 3)', () => {
  it('free → tier 1 (Meniu Digital — demo/trial)', () => {
    expect(planTier('free')).toBe(1)
  })

  it('starter → tier 1 (Meniu Digital)', () => {
    expect(planTier('starter')).toBe(1)
  })

  it('growth → tier 2 (Meniu + Comenzi, fără bani)', () => {
    expect(planTier('growth')).toBe(2)
  })

  it('pro → tier 3 (Fiscalizare — bani + bon)', () => {
    expect(planTier('pro')).toBe(3)
  })

  it('enterprise → tier 3 (Fiscalizare custom)', () => {
    expect(planTier('enterprise')).toBe(3)
  })

  it('null → tier 1 (fail-safe: cel mai restrictiv)', () => {
    expect(planTier(null)).toBe(1)
  })

  it('undefined → tier 1 (fail-safe)', () => {
    expect(planTier(undefined)).toBe(1)
  })

  it('plan necunoscut → tier 1 (fail-safe — niciodată nu permite mai mult)', () => {
    // Test important: dacă DB-ul are vreodată un plan greșit, UI-ul NU
    // trebuie să acorde acces premium din greșeală.
    expect(planTier('business')).toBe(1)
    expect(planTier('xyz')).toBe(1)
    expect(planTier('')).toBe(1)
  })
})

describe('PLAN_NAMES — numele comerciale', () => {
  it('conține toate cele 5 ID-uri interne', () => {
    expect(PLAN_NAMES.free).toBeDefined()
    expect(PLAN_NAMES.starter).toBeDefined()
    expect(PLAN_NAMES.growth).toBeDefined()
    expect(PLAN_NAMES.pro).toBeDefined()
    expect(PLAN_NAMES.enterprise).toBeDefined()
  })

  it('numele comerciale nu conțin id-uri tehnice (Pro, Growth, Starter ca atare)', () => {
    // Regula de UX: clientul nu vede niciodată „Pro" / „Growth" / „Starter".
    expect(PLAN_NAMES.starter).not.toMatch(/\bStarter\b/)
    expect(PLAN_NAMES.growth).not.toMatch(/\bGrowth\b/)
    expect(PLAN_NAMES.pro).not.toMatch(/\bPro\b/)
  })

  it('starter folosește „Meniu Digital"', () => {
    expect(PLAN_NAMES.starter).toContain('Meniu Digital')
  })

  it('growth folosește „Meniu + Comenzi"', () => {
    expect(PLAN_NAMES.growth).toContain('Meniu + Comenzi')
  })

  it('pro folosește „Fiscalizare"', () => {
    expect(PLAN_NAMES.pro).toContain('Fiscalizare')
  })
})

describe('planNameForTier — tier comercial → nume public', () => {
  // Blochează maparea tier → planul reprezentativ → numele comercial.
  // Folosit de UpgradePrompt ca să indice planul-țintă corect.
  it('tier 1 → numele comercial al lui starter (Meniu Digital)', () => {
    expect(planNameForTier(1)).toBe(PLAN_NAMES.starter)
    expect(planNameForTier(1)).toContain('Meniu Digital')
  })

  it('tier 2 → numele comercial al lui growth (Meniu + Comenzi)', () => {
    expect(planNameForTier(2)).toBe(PLAN_NAMES.growth)
    expect(planNameForTier(2)).toContain('Meniu + Comenzi')
  })

  it('tier 3 → numele comercial al lui pro (Fiscalizare)', () => {
    expect(planNameForTier(3)).toBe(PLAN_NAMES.pro)
    expect(planNameForTier(3)).toContain('Fiscalizare')
  })
})

describe('suggestUpgrade — sugestia de upgrade', () => {
  it('starter → growth (urcăm o treaptă)', () => {
    expect(suggestUpgrade('starter')).toBe('growth')
  })

  it('growth → pro', () => {
    expect(suggestUpgrade('growth')).toBe('pro')
  })

  it('pro → enterprise (ultima treaptă publică)', () => {
    expect(suggestUpgrade('pro')).toBe('enterprise')
  })

  it('enterprise → null (top of chain, nu mai e nimic deasupra)', () => {
    expect(suggestUpgrade('enterprise')).toBeNull()
  })

  it('plan necunoscut → null', () => {
    expect(suggestUpgrade('business')).toBeNull()
    expect(suggestUpgrade('xyz')).toBeNull()
  })
})

describe('getPlanByInternalId — mapping intern → comercial', () => {
  // Acest mapping e ce vede userul pe AuthPage (pill de plan intent),
  // pe pricing, și pe upgrade card. Greșelile aici = experiență ruptă.

  it('free → planul comercial starter (Meniu Digital, demo)', () => {
    const plan = getPlanByInternalId('free')
    expect(plan.id).toBe('starter')
    expect(plan.name).toBe('Meniu Digital + Rezervări')
  })

  it('starter → starter', () => {
    const plan = getPlanByInternalId('starter')
    expect(plan.id).toBe('starter')
  })

  it('growth → growth (Meniu + Comenzi)', () => {
    const plan = getPlanByInternalId('growth')
    expect(plan.id).toBe('growth')
    expect(plan.name).toBe('Meniu + Comenzi')
  })

  it('pro → pro (Fiscalizare)', () => {
    const plan = getPlanByInternalId('pro')
    expect(plan.id).toBe('pro')
    expect(plan.name).toBe('Fiscalizare')
  })

  it('enterprise → pro (același tier comercial — Fiscalizare custom)', () => {
    const plan = getPlanByInternalId('enterprise')
    expect(plan.id).toBe('pro')
    expect(plan.name).toBe('Fiscalizare')
  })

  it('plan necunoscut → starter (fail-safe către cel mai mic)', () => {
    const plan = getPlanByInternalId('xyz')
    expect(plan.id).toBe('starter')
  })
})

describe('getPlan — accesare directă config', () => {
  it('returnează cele 3 planuri comerciale cu structură completă', () => {
    for (const id of ['starter', 'growth', 'pro'] as const) {
      const plan = getPlan(id)
      expect(plan.id).toBe(id)
      expect(plan.name).toBeDefined()
      expect(plan.priceMonthly).toBeGreaterThan(0)
      expect(plan.priceYearly).toBeGreaterThan(0)
      expect(plan.included.length).toBeGreaterThan(0)
      expect(plan.limits).toBeDefined()
      expect(plan.limits.maxProducts).toBeGreaterThan(0)
      expect(plan.limits.maxTables).toBeGreaterThan(0)
    }
  })

  it('prețurile cresc strict cu tier-ul (sanity comercială)', () => {
    expect(getPlan('starter').priceMonthly).toBeLessThan(getPlan('growth').priceMonthly)
    expect(getPlan('growth').priceMonthly).toBeLessThan(getPlan('pro').priceMonthly)
  })

  it('prețurile anuale sunt mai mici decât cele lunare (reducere)', () => {
    for (const id of ['starter', 'growth', 'pro'] as const) {
      expect(getPlan(id).priceYearly).toBeLessThan(getPlan(id).priceMonthly)
    }
  })

  it('limitele cresc strict cu tier-ul (sanity comercială)', () => {
    expect(getPlan('starter').limits.maxProducts).toBeLessThan(getPlan('growth').limits.maxProducts)
    expect(getPlan('growth').limits.maxProducts).toBeLessThan(getPlan('pro').limits.maxProducts)
    expect(getPlan('starter').limits.maxTables).toBeLessThan(getPlan('growth').limits.maxTables)
    expect(getPlan('growth').limits.maxTables).toBeLessThan(getPlan('pro').limits.maxTables)
  })

  it('doar pro/enterprise au highlight=true sau badge — UI-ul vinde Meniu + Comenzi', () => {
    // Conform DESIGN_SPEC.md: Meniu + Comenzi e planul recomandat,
    // Fiscalizare e pilot. Doar growth e highlight=true.
    expect(getPlan('growth').highlight).toBe(true)
    expect(getPlan('starter').highlight).toBe(false)
  })
})
