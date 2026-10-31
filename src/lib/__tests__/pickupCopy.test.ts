// PK1–PK6 — ce îi spune dashboard-ul owner-ului despre ridicare, după mig 309.
//
// Din 309, /m/:slug arată ridicarea DOAR cu feature-ul `pickup_orders`. Setarea
// stocată n-are gate (comutatorul din Setări apare pe orice plan, onboarding-ul
// food truck o pornește intenționat pe Planul 1), deci fără textele astea
// owner-ul vedea „clienții pot comanda” în Setări și „clienții comandă și
// ridică” în Mese, iar oaspeții lui doar meniul — refuzul de la `create_order`,
// singurul semnal de până atunci, dispăruse odată cu fluxul.
//
//   PK1  `pickupFeatureState` e TRISTATE: features neîncărcate → null.
//   PK2  Nicio promisiune de comenzi fără feature CUNOSCUT activ (null = nu știm).
//   PK3  Avertismentul de plan DOAR pe feature CUNOSCUT absent, cu numele planului.
//   PK4  Planul numit e cel minim care chiar are `pickup_orders` în matricea DB.
//   PK5  Clichet pe SURSĂ: SettingsTab și TablesManager nu mai au promisiunile
//        scrise de mână și citesc feature-ul RESTAURANTULUI (pică pe codul vechi).
//   PK6  Empty state-ul „doar ridicare”: „clienții comandă” doar pornit + feature.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  PICKUP_MIN_TIER,
  generalMenuQrText,
  pickupCardDescription,
  pickupFeatureState,
  pickupOnlyEmptyStateText,
  pickupPlanName,
  pickupPlanWarning,
} from '../pickupCopy'
import { planNameForTier, planTier, type RestaurantFeatures } from '../features'
import { PLAN_LABELS } from '../constants'
import { DB_PLANS, PLAN_FEATURE_MATRIX } from './planFeatureMatrix.fixture'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

// Orice formulare care îi spune owner-ului că oaspeții POT comanda.
const PROMISE = /pot comanda|pot și comanda|comandă și ridică/i

const features = (pickup: boolean | undefined): RestaurantFeatures => ({
  plan: 'starter',
  features: pickup === undefined ? {} : { pickup_orders: { enabled: pickup, limit: null } },
})

const STATES: ReadonlyArray<boolean | null> = [true, false, null]

describe('PK1: feature-ul de ridicare, tristate', () => {
  it('null pe features neîncărcate; true/false doar când planul e cunoscut', () => {
    expect(pickupFeatureState(null)).toBeNull()
    expect(pickupFeatureState(features(true))).toBe(true)
    expect(pickupFeatureState(features(false))).toBe(false)
    // cheie lipsă din răspunsul serverului = feature dezactivat (ca hasFeature)
    expect(pickupFeatureState(features(undefined))).toBe(false)
  })
})

describe('PK2: promisiunea de comenzi doar pe feature cunoscut activ', () => {
  it('fără feature sau pe plan necunoscut niciun text nu promite comenzi', () => {
    for (const f of [false, null] as const) {
      const d = pickupCardDescription(f)
      expect(`${d.lead} /m/x${d.tail}`).not.toMatch(PROMISE)
      expect(generalMenuQrText(f)).not.toMatch(PROMISE)
      expect(pickupOnlyEmptyStateText(true, f)).not.toMatch(PROMISE)
    }
  })

  it('control pozitiv: cu feature-ul activ promisiunea există', () => {
    const d = pickupCardDescription(true)
    expect(`${d.lead} /m/x${d.tail}`).toMatch(PROMISE)
    expect(generalMenuQrText(true)).toMatch(PROMISE)
    expect(pickupOnlyEmptyStateText(true, true)).toMatch(PROMISE)
  })
})

describe('PK3: avertismentul de plan', () => {
  it('doar pe feature CUNOSCUT absent — nici pe activ, nici pe necunoscut', () => {
    for (const enabled of [true, false]) {
      expect(pickupPlanWarning(enabled, true)).toBeNull()
      expect(pickupPlanWarning(enabled, null)).toBeNull()
      const w = pickupPlanWarning(enabled, false)
      expect(w).not.toBeNull()
      expect(w).toContain(pickupPlanName())
      expect(w).toMatch(/doar meniul/)
    }
  })

  it('cu ridicarea pornită spune explicit că oaspeții nu pot comanda', () => {
    const on = pickupPlanWarning(true, false)
    const off = pickupPlanWarning(false, false)
    expect(on).toMatch(/nu pot comanda/)
    expect(on).toMatch(/setarea rămâne salvată/)
    expect(off).not.toEqual(on)
  })
})

describe('PK4: planul numit e cel care chiar include ridicarea', () => {
  it('PICKUP_MIN_TIER = tier-ul minim cu pickup_orders în matricea DB', () => {
    const tiers = DB_PLANS.filter((p) => PLAN_FEATURE_MATRIX.pickup_orders[p]).map((p) => planTier(p))
    expect(tiers.length).toBeGreaterThan(0)
    expect(Math.min(...tiers)).toBe(PICKUP_MIN_TIER)
  })

  it('numele vine din sursa unică (PLAN_LABELS), nu e scris de mână', () => {
    expect(pickupPlanName()).toBe(planNameForTier(PICKUP_MIN_TIER))
    expect(pickupPlanName()).toContain(PLAN_LABELS.growth)
  })
})

describe('PK5: ecranele de staff trec prin pickupCopy', () => {
  const FILES = ['src/components/SettingsTab.tsx', 'src/components/TablesManager.tsx'] as const

  it('fără promisiuni de comenzi scrise de mână în SettingsTab / TablesManager', () => {
    for (const f of FILES) {
      // JSX-ul rupe frazele pe rânduri — comparăm pe spații normalizate.
      const src = read(f).replace(/\s+/g, ' ')
      expect(src, f).not.toMatch(PROMISE)
      expect(src, f).toContain('pickupFeatureState(')
    }
  })

  it('SettingsTab: feature-ul RESTAURANTULUI (useFeatures), avertismentul randat', () => {
    const src = read('src/components/SettingsTab.tsx')
    expect(src).toMatch(/useFeatures\(restaurant\.id\)/)
    expect(src).toContain('pickupPlanWarning(')
    expect(src).toContain('pickupCardDescription(')
  })

  it('TablesManager: QR-ul general și empty state-ul „doar ridicare” prin helperi', () => {
    const src = read('src/components/TablesManager.tsx')
    expect(src).toContain('generalMenuQrText(pickupFeature)')
    expect(src).toContain('pickupOnlyEmptyStateText(')
  })
})

describe('PK6: empty state-ul modului „doar ridicare”', () => {
  it('„clienții comandă” DOAR cu ridicarea pornită ȘI feature-ul cunoscut activ', () => {
    for (const enabled of [true, false]) {
      for (const f of STATES) {
        const t = pickupOnlyEmptyStateText(enabled, f)
        expect(t).toMatch(/^Mod „doar ridicare" activ/)
        expect(PROMISE.test(t), `enabled=${enabled} feature=${String(f)}`).toBe(enabled && f === true)
        // planul se numește DOAR când știm că lipsește
        expect(t.includes(pickupPlanName()), `enabled=${enabled} feature=${String(f)}`).toBe(f === false)
      }
    }
  })
})
