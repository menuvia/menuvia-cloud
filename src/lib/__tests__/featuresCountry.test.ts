// Gate-urile pe bani urmează ȚARA de acum (recenzia CodeRabbit pe #377).
//   FC1 cheile stinse de mască == lista din `feature_requires_ro` (ultima migrație
//       care o DEFINEȘTE) — o feature românească nouă se adaugă în ambele.
//       Mutația care pică: o cheie scoasă din listă.
//   FC2 `countryScopedFeatures`: țară cunoscută ≠ RO → cele cinci false (limita
//       păstrată), restul neatins, `moneyTier` coboară la 2; RO / țară necunoscută
//       / features null → ACELAȘI obiect (pe România nimic nu se schimbă).
//       Mutația care pică: masca pe `country !== 'RO'` fără garda pe necunoscut.
//   FC3 STRUCTURAL: DashboardPage derivă tier-urile, suprafața, ridicarea, TVA,
//       casa și Statisticile din feature-urile aliniate la țară, nu din cache.
//       Mutația care pică: `surfaceTiers(features.features)` readus.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countryScopedFeatures, moneyTier, type RestaurantFeatures } from '../features'

// Lista din client = ce stinge efectiv masca pe un set gol de feature-uri
// (constanta rămâne privată modulului — FX1, fără exporturi doar pentru teste).
const RO_ONLY_FEATURES: string[] = Object.keys(
  countryScopedFeatures({ plan: 'pro', features: {} }, 'US')?.features ?? {},
)

const ROOT = process.cwd()

function sample(): RestaurantFeatures {
  return {
    plan: 'pro',
    features: {
      fiscal_receipt: { enabled: true, limit: null },
      online_payments: { enabled: true, limit: null },
      split_bill: { enabled: true, limit: null },
      shifts: { enabled: true, limit: null },
      reports_vat: { enabled: true, limit: null },
      sms_notifications: { enabled: true, limit: 500 },
      floor_plan: { enabled: true, limit: null },
    },
  }
}

describe('feature-urile românești urmează țara', () => {
  it('FC1 lista din client == feature_requires_ro din ultima migrație care o definește', () => {
    const dir = resolve(ROOT, 'supabase/migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    let last: string | null = null
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      if (/create\s+(or\s+replace\s+)?function\s+public\.feature_requires_ro\s*\(/i.test(src)) last = src
    }
    expect(last).not.toBeNull()
    const body = (last ?? '').split(/function\s+public\.feature_requires_ro/i)[1] ?? ''
    const arr = /array\s*\[([^\]]*)\]/i.exec(body)
    expect(arr).not.toBeNull()
    const sqlList = Array.from((arr?.[1] ?? '').matchAll(/'([a-z_]+)'/g), (m) => m[1]).sort()
    expect(sqlList.length).toBeGreaterThanOrEqual(5)
    expect([...RO_ONLY_FEATURES].sort()).toEqual(sqlList)
  })

  it('FC2 țară ≠ RO stinge feature-urile românești; RO / necunoscută nu atinge nimic', () => {
    const f = sample()
    expect(moneyTier(f)).toBe(3)
    const us = countryScopedFeatures(f, 'US')
    for (const name of RO_ONLY_FEATURES) expect(us?.features[name]?.enabled, name).toBe(false)
    expect(us?.features.sms_notifications).toEqual({ enabled: true, limit: 500 })
    expect(us?.features.floor_plan).toEqual({ enabled: true, limit: null })
    expect(us?.plan).toBe('pro')
    expect(moneyTier(us ?? null)).toBe(2)
    // cache-ul nu e mutat
    expect(f.features.fiscal_receipt?.enabled).toBe(true)
    // control: România și țara necunoscută → același obiect
    expect(countryScopedFeatures(f, 'RO')).toBe(f)
    expect(countryScopedFeatures(f, null)).toBe(f)
    expect(countryScopedFeatures(f, undefined)).toBe(f)
    expect(countryScopedFeatures(f, '')).toBe(f)
    expect(countryScopedFeatures(null, 'US')).toBeNull()
  })

  it('FC3 DashboardPage gate-uiește din feature-urile aliniate la țară', () => {
    const dash = readFileSync(resolve(ROOT, 'src/pages/DashboardPage.tsx'), 'utf8')
    expect(dash).toMatch(/countryScopedFeatures\(features\.features, restaurantCountry\)/)
    for (const use of [
      'surfaceTiers(scopedFeatures)',
      'planSurface(scopedFeatures)',
      'pickupFeatureState(scopedFeatures)',
      "hasFeature(scopedFeatures, 'reports_vat')",
      "hasFeature(scopedFeatures, 'shifts')",
      'fiscalEnabled={scopedFeatures?.features?.fiscal_receipt?.enabled ?? null}',
    ]) {
      expect(dash, use).toContain(use)
    }
    // Nicio citire directă a cache-ului în afara măștii. Excepția numită: legătura
    // feature-uri ↔ restaurant pentru contextul de analytics (`featuresOwner`, #385)
    // compară doar IDENTITATEA obiectului, nu citește niciun feature; liniile ei
    // nu au voie să conțină altceva decât identitatea (verificat mai jos).
    const ownershipLines = dash
      .split('\n')
      .filter((l) => /featuresOwner|data: features\.features/.test(l))
    expect(ownershipLines.length).toBeGreaterThan(0)
    for (const l of ownershipLines) {
      expect(l, l).not.toMatch(/features\.features\??\.(features|plan)|hasFeature|surfaceTiers|planSurface/)
    }
    const outsideOwnership = dash
      .split('\n')
      .filter((l) => !/featuresOwner|data: features\.features/.test(l))
      .join('\n')
    const direct = outsideOwnership.match(/features\.features/g) ?? []
    expect(direct.length).toBe(2)
    expect(dash).not.toMatch(/features\.has\(/)
  })
})
