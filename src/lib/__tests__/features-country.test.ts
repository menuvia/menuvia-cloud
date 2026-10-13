// moneyTier (lib/features.ts) — gating-ul de bani al UI-ului pe țară (mig 296).
//   FT1  restaurant RO: identic cu planTier(plan) pe toate planurile
//   FT2  server fără mig 296 (fără cheia fiscal_receipt): identic cu planTier
//   FT3  Plan 3 cu fiscal_receipt dezactivat (restaurant din afara RO) → 2
//   FT4  null (planul necunoscut) → 1, ca înainte
//   FT5  surfaceTiers: RO → general == money; în afara RO pe pro → general 3
//        (harta sălii/statistici rămân), money 2 (bani/bon ascunși)
//   FT6  analyticsAccess: RO identic cu vechiul `plan === 'pro' || 'enterprise'`;
//        fiscal CUNOSCUT dezactivat pe pro → 'country_unavailable'; necunoscut → 'full'
import { describe, it, expect } from 'vitest'
import {
  analyticsAccess,
  moneyTier,
  planTier,
  surfaceTiers,
  type RestaurantFeatures,
} from '../features'

function feats(plan: string, fiscal: boolean | null): RestaurantFeatures {
  return {
    plan,
    features: fiscal === null ? {} : { fiscal_receipt: { enabled: fiscal, limit: null } },
  }
}

describe('moneyTier', () => {
  it('FT1: RO — identic cu planTier', () => {
    for (const [plan, fiscal] of [
      ['free', false],
      ['starter', false],
      ['growth', false],
      ['pro', true],
      ['enterprise', true],
    ] as const) {
      expect(moneyTier(feats(plan, fiscal))).toBe(planTier(plan))
    }
  })

  it('FT2: fără cheia fiscal_receipt — identic cu planTier', () => {
    expect(moneyTier(feats('pro', null))).toBe(3)
    expect(moneyTier(feats('growth', null))).toBe(2)
  })

  it('FT3: Plan 3 în afara României → 2', () => {
    expect(moneyTier(feats('pro', false))).toBe(2)
    expect(moneyTier(feats('enterprise', false))).toBe(2)
  })

  it('FT4: necunoscut → 1', () => {
    expect(moneyTier(null)).toBe(1)
  })
})

describe('surfaceTiers', () => {
  it('FT5: RO identic; în afara RO doar banii coboară', () => {
    for (const plan of ['free', 'starter', 'growth', 'pro', 'enterprise']) {
      const t = surfaceTiers(feats(plan, planTier(plan) === 3))
      expect(t.general).toBe(planTier(plan))
      expect(t.money).toBe(planTier(plan))
    }
    expect(surfaceTiers(feats('pro', false))).toEqual({ general: 3, money: 2 })
    expect(surfaceTiers(feats('enterprise', false))).toEqual({ general: 3, money: 2 })
    expect(surfaceTiers(null)).toEqual({ general: 1, money: 1 })
  })
})

describe('analyticsAccess', () => {
  it('FT6: RO identic cu gate-ul vechi; non-RO pe pro → country_unavailable', () => {
    for (const plan of ['free', 'starter', 'growth', 'pro', 'enterprise', 'business', '']) {
      const old = plan === 'pro' || plan === 'enterprise'
      expect(analyticsAccess(plan, old ? true : false)).toBe(old ? 'full' : 'upgrade')
      expect(analyticsAccess(plan, null)).toBe(old ? 'full' : 'upgrade')
    }
    expect(analyticsAccess('pro', false)).toBe('country_unavailable')
    expect(analyticsAccess('enterprise', false)).toBe('country_unavailable')
  })
})
