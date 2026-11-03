// planSurface — ce vede fiecare plan, într-un singur loc (lotul P, nov 2026).
// Decizia fondatorului: planurile inferioare nu văd nimic din cele superioare,
// cu un singur upsell (Planul 1 → „Meniu + Comenzi", Planul 2 → „Plata la masă").
//
// Matricea se calculează din fixtura ÎNGHEȚATĂ a lui `plan_features`
// (planFeatureMatrix.fixture.ts, legată de DB prin PD5/PL6), nu din valori
// scrise de mână aici — o migrație care mută un feature între planuri schimbă
// și ce vede panoul, iar testul o spune.
//
//   PS1  matricea completă pe free / starter / growth / pro / enterprise.
//        Mutația care pică: `vat: true` pe orice plan (cotele TVA înapoi pe
//        Planurile 1–2), `pickup` derivat din `order_qr` (fără să existe
//        `pickup_orders`), `fiscal` pe `general` în loc de `money`, `sms`
//        derivat din `ordering` (starterul cu SMS pornit nu l-ar mai putea opri).
//   PS2  `null` (features neîncărcate) → `null`: nici funcția, nici upsell-ul.
//        Mutația care pică: un fallback pe planul cel mai restrictiv (un obiect
//        cu totul `false` ar arăta upsell-ul de Planul 1 unui plătitor).
//   PS3  Planul 3 din afara României: `fiscal` cade (mig 296, `money` 2), dar
//        `payments` și `vat` rămân — pe Planul 3 nu se schimbă nimic față de
//        înainte (cardul de plăți își explică singur restricția de țară).
//        Mutația care pică: `payments`/`vat` pe `money`.
//   PS4  upsell-ul unic: Planul 1 → 'ordering', Planul 2 → 'payments', Planul 3
//        → niciunul, `null` → niciunul. Control pozitiv pe fiecare plan.
//   PS5  în afara pieței fiscale (non-RO sau .com) Planul 2 nu primește oferta
//        „Plata la masă", dar Planul 1 tot primește „Meniu + Comenzi".
//        Mutația care pică: `fiscalMarket` ignorat.
//   PS6  „Planul 3 nu vede mai puțin": pe pro și enterprise TOATE cheile sunt
//        `true` (controlul pozitiv al lotului — nimic nu se ascunde pe Plan 3).
import { describe, it, expect } from 'vitest'
import { planSurface, planUpsellTarget, type PlanSurface } from '../planSurface'
import { featuresFor, surfaceFor } from './planSurfaceFixtures'
import { DB_PLANS } from './planFeatureMatrix.fixture'

const OFF: PlanSurface = {
  ordering: false,
  staff: false,
  pickup: false,
  extras: false,
  stocks: false,
  branding: false,
  sms: false,
  payments: false,
  fiscal: false,
  vat: false,
}
const PLAN_2: PlanSurface = {
  ordering: true,
  staff: true,
  pickup: true,
  extras: true,
  stocks: true,
  branding: true,
  sms: true,
  payments: false,
  fiscal: false,
  vat: false,
}
const ALL: PlanSurface = {
  ordering: true,
  staff: true,
  pickup: true,
  extras: true,
  stocks: true,
  branding: true,
  sms: true,
  payments: true,
  fiscal: true,
  vat: true,
}

describe('planSurface — matricea pe planuri', () => {
  it('PS1: free / starter / growth / pro / enterprise', () => {
    expect(surfaceFor('free')).toEqual(OFF)
    // Starter = Planul 1, dar ARE `sms_notifications` (plafon 100/lună): cardul
    // SMS trebuie să se poată opri. Singura cheie diferită față de free.
    expect(surfaceFor('starter')).toEqual({ ...OFF, sms: true })
    expect(surfaceFor('growth')).toEqual(PLAN_2)
    expect(surfaceFor('pro')).toEqual(ALL)
    expect(surfaceFor('enterprise')).toEqual(ALL)
  })

  it('PS2: features neîncărcate → null (nici funcția, nici upsell-ul)', () => {
    expect(planSurface(null)).toBeNull()
    expect(planUpsellTarget(null, { fiscalMarket: true })).toBeNull()
  })

  it('PS3: Planul 3 din afara RO — fără bon, dar plățile și cotele rămân ca înainte', () => {
    for (const plan of ['pro', 'enterprise'] as const) {
      const s = surfaceFor(plan, { outsideRo: true })
      expect(s.fiscal).toBe(false)
      expect(s.payments).toBe(true)
      expect(s.vat).toBe(true)
      expect(s.ordering).toBe(true)
    }
  })

  it('PS6: Planul 3 nu pierde nimic — toate cheile sunt true', () => {
    for (const plan of ['pro', 'enterprise'] as const) {
      for (const [k, v] of Object.entries(surfaceFor(plan))) expect(v, `${plan}.${k}`).toBe(true)
    }
    // Anti-vacuitate: fixtura chiar are cele cinci planuri.
    expect(DB_PLANS).toHaveLength(5)
    expect(featuresFor('pro').features.fiscal_receipt?.enabled).toBe(true)
  })
})

describe('planUpsellTarget — un singur upsell, pe planul următor', () => {
  it('PS4: Planul 1 → ordering, Planul 2 → payments, Planul 3 → niciunul', () => {
    const t = (plan: 'free' | 'starter' | 'growth' | 'pro' | 'enterprise') =>
      planUpsellTarget(surfaceFor(plan), { fiscalMarket: true })
    expect(t('free')).toBe('ordering')
    expect(t('starter')).toBe('ordering')
    expect(t('growth')).toBe('payments')
    expect(t('pro')).toBeNull()
    expect(t('enterprise')).toBeNull()
    // Planul 3 din afara RO nu primește oferta pe care deja o are (planul).
    expect(planUpsellTarget(surfaceFor('pro', { outsideRo: true }), { fiscalMarket: false })).toBeNull()
  })

  it('PS5: în afara pieței fiscale — Planul 2 fără ofertă, Planul 1 tot cu „Meniu + Comenzi"', () => {
    expect(planUpsellTarget(surfaceFor('growth'), { fiscalMarket: false })).toBeNull()
    expect(planUpsellTarget(surfaceFor('starter'), { fiscalMarket: false })).toBe('ordering')
  })
})
