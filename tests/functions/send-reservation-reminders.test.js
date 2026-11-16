// tests/functions/send-reservation-reminders.test.js
// Reminderul de rezervare (lotul L8a): emailul poartă restaurantul, ca
// worker-ul să-i citească fusul și limba de bază; SMS-ul rămâne neatins (L8b).
//
//   SR1  `enqueue_email` primește `p_template_data.restaurant_id` = restaurantul
//        rezervării, plus TOATE cheile de dinainte (dedup și destinatar
//        neschimbate).
//        [PICĂ: cheia scoasă]
//   SR2  `enqueue_sms` primește EXACT setul vechi de chei (restaurant_name,
//        restaurant_phone, starts_at, party_size, confirmation_code).
//        [PICĂ: cheia adăugată și la SMS]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, rpcCallsFor } = require('./helpers/mocks')

const REL = 'netlify/functions/send-reservation-reminders.js'
const RID = '32700000-0000-4000-8000-0000000000f1'
const ROW = {
  id: '32700000-0000-4000-8000-0000000000f2',
  restaurant_id: RID,
  restaurant_name: 'Bistro',
  restaurant_phone: '+40722000111',
  customer_name: 'Ana',
  customer_email: 'ana@x.test',
  customer_phone: '0722000222',
  starts_at: '2026-11-17T18:00:00Z',
  party_size: 2,
  confirmation_code: 'AB12CD34',
}

const saved = {}
beforeEach(() => {
  resetMocks()
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) saved[k] = process.env[k]
  Object.assign(process.env, { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })
  state.rpcHandlers.claim_reservation_reminders = () => ({ data: [ROW], error: null })
  state.rpcHandlers.enqueue_email = () => ({ data: 'e1', error: null })
  state.rpcHandlers.enqueue_sms = () => ({ data: 's1', error: null })
})
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('send-reservation-reminders: restaurantul în emailul de reminder', () => {
  it('SR1: emailul poartă restaurant_id, restul contractului neschimbat', async () => {
    const res = await loadFunction(REL).handler({})
    assert.equal(res.statusCode, 200, res.body)
    const [call] = rpcCallsFor('enqueue_email')
    assert.ok(call, 'enqueue_email nechemat')
    assert.equal(call.args.p_template_data.restaurant_id, RID)
    assert.deepEqual(Object.keys(call.args.p_template_data).sort(), [
      'confirmation_code',
      'customer_name',
      'party_size',
      'restaurant_id',
      'restaurant_name',
      'restaurant_phone',
      'starts_at',
    ])
    assert.equal(call.args.p_dedup_key, `reservation_reminder:${ROW.id}`)
    assert.equal(call.args.p_recipient_email, 'ana@x.test')
    assert.equal(call.args.p_template_kind, 'reservation_reminder')
  })

  it('SR2: SMS-ul are EXACT cheile de dinainte', async () => {
    await loadFunction(REL).handler({})
    const [call] = rpcCallsFor('enqueue_sms')
    assert.ok(call, 'enqueue_sms nechemat')
    assert.deepEqual(Object.keys(call.args.p_template_data).sort(), [
      'confirmation_code',
      'party_size',
      'restaurant_name',
      'restaurant_phone',
      'starts_at',
    ])
    assert.equal(call.args.p_restaurant_id, RID)
  })
})
