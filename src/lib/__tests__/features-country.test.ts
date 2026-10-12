// moneyTier (lib/features.ts) — gating-ul de bani al UI-ului pe țară (mig 296).
//   FT1  restaurant RO: identic cu planTier(plan) pe toate planurile
//   FT2  server fără mig 296 (fără cheia fiscal_receipt): identic cu planTier
//   FT3  Plan 3 cu fiscal_receipt dezactivat (restaurant din afara RO) → 2
//   FT4  null (planul necunoscut) → 1, ca înainte
import { describe, it, expect } from 'vitest'
import { moneyTier, planTier, type RestaurantFeatures } from '../features'

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
