// tests/functions/founder-alert.test.js
// Alertele de BANI și GDPR din automation-cron ajung pe `founder_alert`.
//
// De ce există: batch-ul de comisioane picat sau parțial, draft-urile de plată
// care așteaptă transferul, evenimentele Stripe blocate și ștergerile GDPR
// picate plecau DOAR pe Slack — iar Slack e oprit (decizia D4). Fără
// SLACK_WEBHOOK_URL, postCronAlert e no-op: exact alertele care cer o decizie
// nu ajungeau la nimeni. Tipul de email `founder_alert` (mig 299) exista, cu
// șablon și cu contract de dedup, dar fără niciun producător.
//
//   FAL1  ștergerile GDPR picate → founder_alert `gdpr_deletions_failed`, către
//         fondator, cu dedup `founder_alert:<kind>:<zi București>`. Mutația care
//         pică: doar postCronAlert (fără enqueueFounderAlert).
//   FAL2  batch-ul de comisioane: draft-uri create → `payout_drafts_ready`;
//         afiliați săriți → `payout_batch_partial`; RPC picat → `payout_batch_failed`.
//   FAL3  evenimente Stripe blocate → `stripe_events_failed` cu tipurile în detalii.
//   FAL4  control de ZGOMOT: un job care nu ține de bani/GDPR (tichete de
//         bucătărie) NU produce founder_alert.
//   FAL5  dedup pe ziua ROMÂNEASCĂ: 22:30Z pe 29 oct = 30 oct în București.
//   FAL6  o alertă care nu se poate pune în coadă nu doboară cron-ul (200),
//         iar un tip invalid nu ajunge la RPC.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { state, resetMocks, installModuleMocks, loadFunction, rpcCallsFor } = require('./helpers/mocks')

// FAL5/FAL6 cer `@supabase/supabase-js` direct (fake-ul harness-ului): mock-urile
// se instalează aici, nu doar prin loadFunction, ca testele să meargă și izolat.
installModuleMocks()

const ROOT = path.join(__dirname, '..', '..')
const { FOUNDER_EMAIL } = require(path.join(ROOT, 'netlify/functions/lib/appUrl.js'))
const CRON = 'netlify/functions/automation-cron.js'
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SLACK_WEBHOOK_URL']

let saved
let savedErr
let savedWarn

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k] // Slack oprit, ca în producție (D4)
  Object.assign(process.env, { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service' })
  savedErr = console.error
  savedWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  state.rpcHandlers['enqueue_email'] = () => ({ data: 'email-id', error: null })
})

afterEach(() => {
  mock.timers.reset()
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  console.error = savedErr
  console.warn = savedWarn
})

async function runAt(iso) {
  mock.timers.enable({ apis: ['Date'], now: new Date(iso) })
  const { handler } = loadFunction(CRON)
  return handler({})
}

const alerts = () =>
  rpcCallsFor('enqueue_email').filter((c) => c.args.p_template_kind === 'founder_alert')
const alertKinds = () => alerts().map((c) => c.args.p_template_data.kind).sort()

describe('automation-cron → founder_alert (bani + GDPR)', () => {
  it('FAL1: ștergerile GDPR picate → gdpr_deletions_failed către fondator', async () => {
    state.rpcHandlers['process_account_deletions'] = () => ({ data: null, error: { message: 'deadlock detected' } })
    // 01:35Z = 03:35 în București (EET, după schimbarea orei din 25 oct).
    const res = await runAt('2026-10-30T01:35:00Z')
    assert.equal(res.statusCode, 200, res.body)
    const a = alerts()
    assert.equal(a.length, 1, `alerte: ${JSON.stringify(alertKinds())}`)
    const args = a[0].args
    assert.equal(args.p_recipient_email, FOUNDER_EMAIL)
    assert.equal(args.p_dedup_key, 'founder_alert:gdpr_deletions_failed:2026-10-30')
    assert.equal(args.p_template_data.kind, 'gdpr_deletions_failed')
    assert.match(args.p_template_data.title, /GDPR/)
    assert.match(args.p_template_data.details, /deadlock detected/)
    assert.equal(args.p_template_data.action_url, '/founder')
    assert.equal(args.p_template_data.occurred_at, '2026-10-30T01:35:00.000Z')
  })

  it('FAL2: batch-ul de comisioane — draft-uri, afiliați săriți, RPC picat', async () => {
    state.fromHandlers['affiliate_payouts'] = () => ({ data: null, count: 0, error: null })
    state.rpcHandlers['run_affiliate_payout_batch'] = () => ({
      data: { ok: false, created: 3, errors: [{ affiliate_id: 'a1' }] },
      error: null,
    })
    // 1 noiembrie, 05:20 București: fereastra batch-ului, în afara celei GDPR.
    await runAt('2026-11-01T03:20:00Z')
    assert.deepEqual(alertKinds(), ['payout_batch_partial', 'payout_drafts_ready'])
    const drafts = alerts().find((c) => c.args.p_template_data.kind === 'payout_drafts_ready').args
    assert.equal(drafts.p_dedup_key, 'founder_alert:payout_drafts_ready:2026-11-01')
    assert.match(drafts.p_template_data.title, /^3 plăți/)
    assert.match(drafts.p_template_data.details, /2026-11-01/)

    resetMocks()
    state.rpcHandlers['enqueue_email'] = () => ({ data: 'email-id', error: null })
    state.fromHandlers['affiliate_payouts'] = () => ({ data: null, count: 0, error: null })
    state.rpcHandlers['run_affiliate_payout_batch'] = () => ({ data: null, error: { message: 'lock timeout' } })
    mock.timers.reset()
    await runAt('2026-11-01T03:20:00Z')
    assert.deepEqual(alertKinds(), ['payout_batch_failed'])
    assert.match(alerts()[0].args.p_template_data.details, /lock timeout/)
  })

  it('FAL3: evenimente Stripe blocate → stripe_events_failed', async () => {
    state.fromHandlers['stripe_events'] = () => ({
      data: [
        { event_id: 'evt_1', event_type: 'invoice.paid', received_at: '2026-10-29T10:00:00Z' },
        { event_id: 'evt_2', event_type: 'customer.subscription.deleted', received_at: '2026-10-29T11:00:00Z' },
      ],
      count: 2,
      error: null,
    })
    // 10:05 București: primul tick al orei, în afara oricărei ferestre zilnice.
    await runAt('2026-10-30T08:05:00Z')
    assert.deepEqual(alertKinds(), ['stripe_events_failed'])
    const d = alerts()[0].args.p_template_data
    assert.match(d.title, /^2 evenimente Stripe/)
    assert.match(d.details, /invoice\.paid/)
    assert.match(d.details, /evt_1/)
  })

  it('FAL4 (control de zgomot): un job care nu ține de bani/GDPR nu produce founder_alert', async () => {
    state.rpcHandlers['kitchen_tickets_mark_stale'] = () => ({ data: null, error: { message: 'boom' } })
    state.rpcHandlers['expire_inactive_sessions'] = () => ({ data: null, error: { message: 'boom' } })
    const res = await runAt('2026-10-30T08:05:00Z')
    assert.equal(res.statusCode, 200)
    assert.deepEqual(alertKinds(), [])
  })

  it('FAL5: dedup pe ziua românească (22:30Z pe 29 oct = 30 oct)', async () => {
    const { enqueueFounderAlert, bucharestDay } = require(path.join(ROOT, 'netlify/functions/lib/founderAlert.js'))
    assert.equal(bucharestDay(new Date('2026-10-29T22:30:00Z')), '2026-10-30')
    assert.equal(bucharestDay(new Date('2026-07-15T21:30:00Z')), '2026-07-16') // EEST
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient('https://sb.example', 'service')
    const r = await enqueueFounderAlert(supabase, {
      kind: 'payout_drafts_ready',
      title: 'T',
      now: new Date('2026-10-29T22:30:00Z'),
    })
    assert.deepEqual(r, { ok: true, enqueued: true })
    assert.equal(alerts()[0].args.p_dedup_key, 'founder_alert:payout_drafts_ready:2026-10-30')
    // Al doilea apel în aceeași zi: enqueue_email întoarce null (dedup) → enqueued:false.
    state.rpcHandlers['enqueue_email'] = () => ({ data: null, error: null })
    const again = await enqueueFounderAlert(supabase, { kind: 'payout_drafts_ready', title: 'T' })
    assert.deepEqual(again, { ok: true, enqueued: false })
  })

  it('FAL6: coada picată nu doboară cron-ul; tipul invalid nu ajunge la RPC', async () => {
    state.rpcHandlers['process_account_deletions'] = () => ({ data: null, error: { message: 'x' } })
    state.rpcHandlers['enqueue_email'] = () => {
      throw new Error('ECONNRESET')
    }
    const res = await runAt('2026-10-30T01:35:00Z')
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.body).account_deletions_error, 'x')

    const { enqueueFounderAlert } = require(path.join(ROOT, 'netlify/functions/lib/founderAlert.js'))
    const { createClient } = require('@supabase/supabase-js')
    const before = rpcCallsFor('enqueue_email').length
    for (const kind of ['', 'Payout', 'a b', null, 'x;drop']) {
      const r = await enqueueFounderAlert(createClient('u', 'k'), { kind, title: 'T' })
      assert.equal(r.ok, false, String(kind))
    }
    assert.equal(rpcCallsFor('enqueue_email').length, before)
  })
})
