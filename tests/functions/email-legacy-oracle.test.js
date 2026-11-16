// tests/functions/email-legacy-oracle.test.js
// ORACOLUL pe română (lotul L8a): emailurile în limba destinatarului NU au voie
// să schimbe nimic pentru un patron/oaspete român la un local pe București.
//
//   EO0  hash-ul copiei vechi (fixtures/legacy/process-email-queue.30a6400.js)
//        e cel înghețat aici: oracolul NU se „repară” ca să egaleze codul nou.
//        [PICĂ: orice octet schimbat în copia veche]
//   EO1  pentru TOATE cele 31 de kind-uri (fiecare caz din fixturi + `{}`),
//        subiectul și HTML-ul codului NOU pe contextul românesc (ro-RO,
//        Europe/Bucharest, now = NOW) sunt EGALE byte cu byte cu codul VECHI;
//        ambele randate într-un proces copil cu TZ=Europe/Bucharest și ceasul
//        oprit (așa arăta ieșirea veche pe o gazdă din București).
//        Anti-vacuitate: fiecare valoare din MUST_RENDER apare (escapată) în
//        ieșirea VECHE a cazului complet al kind-ului ei, iar fiecare kind din
//        TEMPLATES are cel puțin un caz.
//        [PICĂ: un caracter schimbat într-un șir `ro` din emailStrings.js; un
//         `esc()` scos; două paragrafe inversate; dateTimeLong pe alt locale]
//   EO2  independența de GAZDĂ: codul nou (context românesc) dă EXACT ieșirea
//        din EO1 și în copii cu TZ=UTC, America/Los_Angeles și
//        Pacific/Kiritimati.
//        [PICĂ: periodShort fără timeZone (UTC → „8 nov.”), calendarDay fără
//         `timeZone:'UTC'` (Los Angeles → „sâmbătă, 14 noiembrie”), relativeDay
//         pe calendarul gazdei (UTC → „astăzi”)]
//   EO3  CONTROLUL care împiedică EO2 să fie vacuu: codul VECHI pe gazde
//        străine ARATĂ defectele de fus reparate (UTC: „8 nov. – 15 nov.” și
//        „astăzi” în loc de „mâine” în reminder; Los Angeles: „sâmbătă, 14
//        noiembrie”; UTC cu ceasul la 22:30Z: „mâine” în loc de „astăzi”).
//        Dacă TZ-ul copilului sau ceasul oprit n-ar avea efect, EO3 pică.
//        Sunt SINGURELE diferențe față de ce trimitea Netlify (UTC): perioada
//        săptămânală, ziua raportului zilnic pe o gazdă la vest de UTC și
//        cuvântul astăzi/mâine/„pe <dată>” din subiectul reminderului, care
//        se judecă acum pe ziua din București, nu pe calendarul UTC al gazdei
//        — diferă în AMBELE sensuri când ora rezervării sau ora rulării cade
//        în 00:00–02/03:00 București.
//   EO4  partea „ACUM” a comparației: cu ceasul la 22:30Z (00:30 în
//        București, încă 16 pe UTC) codul nou e egal cu cel vechi pe
//        București și dă aceeași ieșire pe o gazdă UTC.
//        [PICĂ: ziua lui „ACUM” calculată pe UTC în relativeDay — cu NOW =
//         20:00Z mutația trecea de EO1–EO3]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { CASES, MUST_RENDER, NOW, NOW_LATE, STARTS_LATE, APP } = require('./fixtures/email-fixtures')

const LEGACY = path.join(__dirname, 'fixtures', 'legacy', 'process-email-queue.30a6400.js')
const RENDER = path.join(__dirname, 'helpers', 'render-emails.js')
// sha256 al `git show 30a6400:netlify/functions/process-email-queue.js`.
const LEGACY_SHA256 = '2a7415447e1c505113210bc0b62aea2fb6d404e4ab9cf83162a0aba0fa281e53'
const RO_CTX = { lang: 'ro', locale: 'ro-RO', timeZone: 'Europe/Bucharest', now: Date.parse(NOW) }

function render(mode, tz, cases, now = NOW) {
  const r = spawnSync(process.execPath, [RENDER, JSON.stringify({ mode, now, appUrl: APP, cases })], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`render ${mode}/${tz} a eșuat: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

// Toate cazurile, în ordine stabilă: fiecare fixtură + `{}` pentru fiecare kind.
const ALL = []
for (const [kind, list] of Object.entries(CASES)) {
  for (const c of list) ALL.push({ kind, label: c.label, data: c.data })
  ALL.push({ kind, label: '{}', data: {} })
}
const withCtx = (cases) => cases.map(({ kind, data }) => ({ kind, data, ctx: RO_CTX }))

let OLD_BUC
let NEW_BUC
before(() => {
  OLD_BUC = render('old', 'Europe/Bucharest', ALL)
  NEW_BUC = render('new', 'Europe/Bucharest', withCtx(ALL))
})

describe('EO0: oracolul e copia exactă a worker-ului vechi', () => {
  it('sha256 neschimbat', () => {
    const h = crypto.createHash('sha256').update(fs.readFileSync(LEGACY)).digest('hex')
    assert.equal(h, LEGACY_SHA256, 'copia veche a fost modificată — oracolul nu se „repară”')
  })
})

describe('EO1: româna pe București e BYTE-identică pe toate cele 31 de kind-uri', () => {
  it('anti-vacuitate: fiecare kind din TEMPLATES are cazuri, iar fixturile își randează valorile', () => {
    const { TEMPLATES } = require('./helpers/mocks').loadFunction('netlify/functions/process-email-queue.js')
    const kinds = Object.keys(TEMPLATES).sort()
    assert.equal(kinds.length, 31, `${kinds.length} kind-uri`)
    assert.deepEqual(Object.keys(CASES).sort(), kinds, 'fixturi lipsă sau în plus')
    assert.deepEqual(Object.keys(MUST_RENDER).sort(), kinds)
    for (const kind of kinds) {
      const i = ALL.findIndex((c) => c.kind === kind)
      const out = OLD_BUC[i]
      assert.ok(!out.error, `${kind}: codul vechi a aruncat: ${out.error}`)
      for (const v of MUST_RENDER[kind]) {
        assert.ok(out.subject.includes(v) || out.html.includes(v), `${kind}: „${v}” nu apare în ieșirea veche`)
      }
    }
  })

  it('fiecare caz: subiect + HTML egale cu worker-ul vechi', () => {
    assert.equal(NEW_BUC.length, ALL.length)
    for (let i = 0; i < ALL.length; i++) {
      const { kind, label } = ALL[i]
      assert.ok(!NEW_BUC[i].error, `${kind}/${label}: codul nou a aruncat: ${NEW_BUC[i].error}`)
      assert.equal(NEW_BUC[i].subject, OLD_BUC[i].subject, `${kind}/${label}: subiect diferit`)
      assert.equal(NEW_BUC[i].html, OLD_BUC[i].html, `${kind}/${label}: HTML diferit`)
    }
  })
})

describe('EO2: codul nou nu depinde de fusul gazdei', () => {
  for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    it(`TZ=${tz} → aceeași ieșire ca pe București`, () => {
      const out = render('new', tz, withCtx(ALL))
      for (let i = 0; i < ALL.length; i++) {
        const { kind, label } = ALL[i]
        assert.equal(out[i].subject, NEW_BUC[i].subject, `${kind}/${label}@${tz}: subiect`)
        assert.equal(out[i].html, NEW_BUC[i].html, `${kind}/${label}@${tz}: HTML`)
      }
    })
  }
})

describe('EO3: controlul — codul vechi pe o gazdă străină arată defectele reparate', () => {
  const pick = (kind) => ALL.findIndex((c) => c.kind === kind && c.label !== '{}')

  it('UTC: perioada raportului săptămânal începe pe 8, reminderul spune „astăzi”', () => {
    const old = render('old', 'UTC', ALL)
    const w = pick('weekly_report')
    assert.ok(old[w].html.includes('8 nov. – 15 nov.'), 'controlul nu vede defectul de perioadă')
    assert.ok(NEW_BUC[w].html.includes('9 nov. – 15 nov.'))
    const r = pick('reservation_reminder')
    assert.match(old[r].subject, /astăzi$/, 'controlul nu vede defectul „astăzi”')
    assert.match(NEW_BUC[r].subject, /mâine$/)
  })

  it('Los Angeles: ziua raportului zilnic iese ziua precedentă', () => {
    const old = render('old', 'America/Los_Angeles', ALL)
    const d = pick('daily_report')
    assert.ok(old[d].html.includes('sâmbătă, 14 noiembrie'), 'controlul nu vede defectul de zi')
    assert.ok(NEW_BUC[d].html.includes('duminică, 15 noiembrie'))
  })
})

describe('EO4: reminderul cu ceasul la 22:30Z — „ACUM” pe ziua din București', () => {
  const LATE_CTX = { ...RO_CTX, now: Date.parse(NOW_LATE) }
  const cases = [
    { kind: 'reservation_reminder', data: { customer_name: 'Ion', restaurant_name: 'X', starts_at: STARTS_LATE, party_size: 2 } },
    { kind: 'reservation_reminder', data: { customer_name: 'Ion', restaurant_name: 'X', starts_at: '2026-11-18T18:00:00Z', party_size: 2 } },
  ]
  const withLate = (c) => c.map(({ kind, data }) => ({ kind, data, ctx: LATE_CTX }))

  it('egal cu codul vechi pe București; aceeași ieșire pe o gazdă UTC', () => {
    const old = render('old', 'Europe/Bucharest', cases, NOW_LATE)
    const now = render('new', 'Europe/Bucharest', withLate(cases), NOW_LATE)
    const utc = render('new', 'UTC', withLate(cases), NOW_LATE)
    assert.match(old[0].subject, / astăzi$/, 'controlul: pe București rezervarea de pe 17 e „astăzi”')
    assert.match(old[1].subject, / mâine$/)
    for (let i = 0; i < cases.length; i++) {
      assert.ok(!now[i].error && !utc[i].error)
      assert.equal(now[i].subject, old[i].subject)
      assert.equal(now[i].html, old[i].html)
      assert.equal(utc[i].subject, old[i].subject, 'gazda UTC schimbă „ACUM”')
      assert.equal(utc[i].html, old[i].html)
    }
  })

  it('controlul: codul VECHI pe o gazdă UTC spune „mâine” (sensul opus lui EO3)', () => {
    const old = render('old', 'UTC', cases, NOW_LATE)
    assert.match(old[0].subject, / mâine$/)
  })
})
