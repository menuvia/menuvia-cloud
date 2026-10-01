// tests/functions/email-templates.test.js
// Emailurile de abonament pentru trialul FĂRĂ card (RES-11).
//
// Cu `missing_payment_method: 'cancel'`, un trial fără card se încheie singur.
// Textele scrise pentru trialul CU card mințeau în trei locuri:
//   - `trial_ending_3d` cerea „actualizează cardul în setări” (card inexistent),
//     avea CTA „Continuă cu Pro →” (plan greșit) și nu spunea data;
//   - `welcome` promitea oricui „planul Pro: … casă fiscală”;
//   - `subscription_cancelled` confirma o anulare pe care omul n-a făcut-o.
//
//   ET1  trial_ending_3d fără card: ziua ROMÂNEASCĂ, „Adaugă un card”, planul real;
//   ET1b trial_ending_3d cu card: nicio amenințare de oprire;
//   ET2  welcome pe growth nu promite casă fiscală; pe pro o pomenește;
//   ET3  subscription_cancelled: varianta de trial expirat DOAR pe (trial_end,
//        ended_at ≤ trial_end+1h, fără card), anularea voluntară rămâne neatinsă;
//   ET4  PLAN_COMMERCIAL == PLAN_LABELS din src/lib/constants.ts (clichet de
//        sincronizare — funcția e CommonJS și nu poate importa TS-ul);
//   ET5  starter nu primește „comenzile de la masă se opresc” (nu le are).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { installModuleMocks } = require('./helpers/mocks')

const ROOT = path.join(__dirname, '..', '..')
const MOD_PATH = path.join(ROOT, 'netlify', 'functions', 'process-email-queue.js')

// Modulul REAL (cere @supabase/supabase-js la nivel de modul; directorul e
// zero-deps, deci harness-ul îl interceptează).
installModuleMocks()
const { TEMPLATES, PLAN_COMMERCIAL } = require(MOD_PATH)

// 2026-10-31T22:30:00Z = 1 noiembrie 2026, 00:30 ora României (EET). În UTC ar
// ieși 31 octombrie — exact clasa reparată la Oblio (mig 269, OM1).
const ENDS_AT = Date.UTC(2026, 9, 31, 22, 30, 0) / 1000

describe('email templates — trialul fără card (RES-11)', () => {
  it('ET1: trial_ending_3d fără card → ziua românească, „Adaugă un card”, planul real', () => {
    const { subject, html } = TEMPLATES.trial_ending_3d({
      owner_name: 'Ana', ends_at: ENDS_AT, plan: 'growth', has_payment_method: false,
    })
    assert.match(subject, /1 noiembrie 2026/)
    assert.match(html, /1 noiembrie 2026/)
    assert.doesNotMatch(html, /31 octombrie/)
    assert.match(html, /Adaugă un card/)
    // Condițional: cardul poate sta pe customer, nu pe abonament.
    assert.match(html, /Dacă n-ai adăugat încă un card/)
    assert.match(html, /Meniu \+ Comenzi/)
    assert.match(html, /comenzile de la masă se opresc/)
    assert.doesNotMatch(html, /Continuă cu Pro/)
    assert.doesNotMatch(html, /actualizează cardul/i)
  })

  it('ET1b: trial_ending_3d cu card salvat → continuă, fără amenințarea de oprire', () => {
    const { html } = TEMPLATES.trial_ending_3d({
      ends_at: ENDS_AT, plan: 'growth', has_payment_method: true,
    })
    assert.match(html, /continuă fără întrerupere/)
    assert.doesNotMatch(html, /se oprește singur/)
    assert.doesNotMatch(html, /Adaugă un card/)
  })

  it('ET1c: trial_ending_3d fără ends_at → nu inventează o dată', () => {
    const { subject, html } = TEMPLATES.trial_ending_3d({ plan: 'growth' })
    assert.match(subject, /în curând/)
    assert.doesNotMatch(html, /1970/)
  })

  it('ET2: welcome pe growth nu promite casă fiscală; pe pro pomenește bonul', () => {
    const growth = TEMPLATES.welcome({ owner_name: 'Ana', plan: 'growth' }).html
    assert.match(growth, /Meniu \+ Comenzi/)
    assert.doesNotMatch(growth, /casă fiscală|bonul fiscal|planul Pro/i)
    const pro = TEMPLATES.welcome({ owner_name: 'Ana', plan: 'pro' }).html
    assert.match(pro, /Fiscalizare/)
    assert.match(pro, /bonul fiscal/)
  })

  it('ET3: subscription_cancelled distinge trialul expirat de anularea voluntară', () => {
    const trialEnd = 1_800_000_000
    const expired = TEMPLATES.subscription_cancelled({
      trial_end: trialEnd, ended_at: trialEnd + 60, had_payment_method: false, plan: 'growth',
    })
    assert.match(expired.subject, /Trialul Menuvia s-a încheiat/)
    assert.match(expired.html, /Nu ai fost taxat/)
    assert.doesNotMatch(expired.html, /Confirmăm că abonamentul/)

    // Anulare voluntară în timpul trialului (ended_at ÎNAINTE de trial_end).
    const voluntaryDuringTrial = TEMPLATES.subscription_cancelled({
      trial_end: trialEnd, ended_at: trialEnd - 86_400, had_payment_method: false,
    })
    assert.match(voluntaryDuringTrial.html, /Confirmăm că abonamentul/)

    // Abonat cu card, anulat după luni de plată.
    const paying = TEMPLATES.subscription_cancelled({
      trial_end: trialEnd, ended_at: trialEnd + 90 * 86_400, had_payment_method: true,
    })
    assert.match(paying.html, /Confirmăm că abonamentul/)

    // Anulare CERUTĂ, programată la sfârșitul trialului (ended_at == trial_end).
    const scheduledAtTrialEnd = TEMPLATES.subscription_cancelled({
      trial_end: trialEnd, ended_at: trialEnd, had_payment_method: false,
      cancellation_reason: 'cancellation_requested',
    })
    assert.match(scheduledAtTrialEnd.html, /Confirmăm că abonamentul/)

    // Fără context (evenimente dinaintea RES-11) → textul vechi, neschimbat.
    assert.match(TEMPLATES.subscription_cancelled({}).html, /Confirmăm că abonamentul/)
  })

  it('ET4: PLAN_COMMERCIAL e oglinda EXACTĂ a PLAN_LABELS din src/lib/constants.ts', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'constants.ts'), 'utf8')
    const block = src.match(/export const PLAN_LABELS[^{]*\{([^}]*)\}/)
    assert.ok(block, 'PLAN_LABELS negăsit în constants.ts')
    const labels = {}
    for (const m of block[1].matchAll(/(\w+):\s*'([^']*)'/g)) labels[m[1]] = m[2]
    assert.ok(Object.keys(labels).length >= 5, 'control pozitiv pe parser')
    assert.deepEqual(PLAN_COMMERCIAL, labels)
  })

  it('ET5: pe starter nu se pomenesc comenzile de la masă (planul nu le are)', () => {
    const { html } = TEMPLATES.trial_ending_3d({
      ends_at: ENDS_AT, plan: 'starter', has_payment_method: false,
    })
    assert.match(html, /Meniu Digital \+ Rezervări/)
    assert.doesNotMatch(html, /comenzile de la masă/)
  })
})
