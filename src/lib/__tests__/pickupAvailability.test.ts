// Starea comutatorului de ridicare pe planul restaurantului (lib/pickupAvailability).
// `pickup_orders` e activ doar de la Meniu + Comenzi (planFeatureMatrix.fixture):
// PA1 leagă helperul de fixtură, ca o schimbare a matricei să se vadă aici.
import { describe, it, expect } from 'vitest'
import { canSetPickupEnabled, pickupToggleState } from '../pickupAvailability'
import { DB_PLANS, PLAN_FEATURE_MATRIX } from './planFeatureMatrix.fixture'

describe('pickupToggleState', () => {
  it('PA1: „available" exact pe planurile cu pickup_orders în matrice', () => {
    for (const plan of DB_PLANS) {
      const expected = PLAN_FEATURE_MATRIX.pickup_orders[plan]
      expect(pickupToggleState(plan, false) === 'available', plan).toBe(expected)
    }
  })

  it('PA2: fără pickup_orders — oprit = blocat, pornit (downgrade) = doar oprire', () => {
    expect(pickupToggleState('starter', false)).toBe('locked')
    expect(pickupToggleState('free', true)).toBe('locked_on')
    expect(canSetPickupEnabled('locked', true)).toBe(false)
    expect(canSetPickupEnabled('locked_on', true)).toBe(false)
    expect(canSetPickupEnabled('locked_on', false)).toBe(true)
    expect(canSetPickupEnabled('available', true)).toBe(true)
  })

  it('PA3: plan necunoscut = blocat în ambele sensuri, fără verdict despre plan', () => {
    expect(pickupToggleState(null, false)).toBe('unknown')
    expect(pickupToggleState(undefined, true)).toBe('unknown')
    expect(canSetPickupEnabled('unknown', true)).toBe(false)
    expect(canSetPickupEnabled('unknown', false)).toBe(false)
    // Un șir nerecunoscut e un plan CUNOSCUT, dar fără ridicare.
    expect(pickupToggleState('business', false)).toBe('locked')
  })
})
