// tests/functions/automation-cron-schedule.test.js
// Clichetul de LĂȚIME A TICK-ULUI (OPS-14).
//
// `automation-cron.js` are ~12 gate-uri care înseamnă „al câtelea tick al
// orei" (`tickSlot(minute) === 0`, `=== 1`, `% 2 === 0`). Ele au sens DOAR
// dacă orarul din `netlify.toml` produce exact un tick la `TICK_MINUTES`.
// Rărirea orarului la `*/30` ar face fereastra slotului 1 inaccesibilă, iar
// `cleanup_old_rate_limits` (Job 3, zilnic la 03:15) n-ar mai rula NICIODATĂ —
// fără nicio eroare, fără nicio alarmă. Până acum cuplajul era un avertisment
// în proză în `netlify.toml`, adică nicăieri unde să poată pica ceva.
//
//   OC1  orarul din netlify.toml == `*/TICK_MINUTES * * * *`
//   OC2  fiecare index de slot e ATINS de un tick (nicio fereastră moartă)
//   OC3  control pozitiv pe parser: găsește toate funcțiile programate
//
// Parser-ul e aceeași formă ca `readSchedules` din `deploy/server.js` — shim-ul
// VPS citește ACELEAȘI programări, deci sursa unică rămâne `netlify.toml`.
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { installModuleMocks } = require('./helpers/mocks')

const ROOT = path.join(__dirname, '..', '..')
const NETLIFY_TOML = path.join(ROOT, 'netlify.toml')
const CRON_PATH = path.join(ROOT, 'netlify', 'functions', 'automation-cron.js')

// `automation-cron.js` cere `@supabase/supabase-js` la nivel de modul, iar
// directorul ăsta e ZERO-DEPS — harness-ul îl interceptează prin Module._load.
// Constanta se citește din MODULUL REAL, nu dintr-o copie textuală: altfel
// testul ar îngheța un literal care nu mai e folosit de niciun gate.
function loadTickMinutes() {
  installModuleMocks()
  delete require.cache[require.resolve(CRON_PATH)]
  return require(CRON_PATH).TICK_MINUTES
}

function readSchedules(tomlPath) {
  const text = fs.readFileSync(tomlPath, 'utf8')
  const re = /\[functions\."([\w-]+)"\]\s*[\r\n]+\s*schedule\s*=\s*"([^"]+)"/g
  const out = []
  let m
  while ((m = re.exec(text)) !== null) out.push({ name: m[1], expr: m[2] })
  return out
}

describe('automation-cron — lățimea tick-ului (OPS-14)', () => {
  it('OC1: orarul din netlify.toml e exact `*/TICK_MINUTES * * * *`', () => {
    const tick = loadTickMinutes()
    assert.equal(typeof tick, 'number', 'automation-cron.js nu exportă TICK_MINUTES')

    const job = readSchedules(NETLIFY_TOML).find((j) => j.name === 'automation-cron')
    assert.ok(job, 'automation-cron nu are schedule în netlify.toml')
    assert.equal(
      job.expr,
      `*/${tick} * * * *`,
      'orarul din netlify.toml nu mai corespunde cu TICK_MINUTES din automation-cron.js — ' +
        'gate-urile pe slot de tick devin ferestre moarte (vezi Job 3, cleanup zilnic)',
    )
  })

  it('OC2: fiecare index de slot e atins de un tick (nicio fereastră moartă)', () => {
    const tick = loadTickMinutes()
    assert.ok(tick > 0 && tick <= 60, `TICK_MINUTES nesănătos: ${tick}`)
    assert.equal(60 % tick, 0, `60 nu e divizibil cu TICK_MINUTES=${tick} — sloturile derivă în oră`)

    // Minutele la care chiar se declanșează `*/tick`, mapate pe indexul de slot
    // folosit de gate-uri. Trebuie să acopere TOATE sloturile, fiecare o
    // singură dată: un slot neatins = un job care nu mai rulează niciodată;
    // un slot atins de două ori = job rulat de două ori pe oră.
    const slots = []
    for (let m = 0; m < 60; m++) {
      if (m % tick === 0) slots.push(Math.floor(m / tick))
    }
    assert.deepEqual(
      slots,
      Array.from({ length: 60 / tick }, (_, i) => i),
      'sloturile de tick nu sunt acoperite exact o dată',
    )
  })

  it('OC3 (control pozitiv): parser-ul chiar găsește programările din netlify.toml', () => {
    // Fără el, o regex ruptă ar face OC1 să pice cu „nu are schedule" în loc să
    // raporteze o nepotrivire reală — și ar ascunde faptul că testul nu citește
    // nimic.
    const jobs = readSchedules(NETLIFY_TOML)
    assert.ok(jobs.length >= 5, `prea puține funcții programate găsite: ${jobs.length}`)
    for (const j of jobs) {
      assert.match(j.expr, /^\S+( \S+){4}$/, `orar cu formă necunoscută: ${j.name} = "${j.expr}"`)
    }
  })
})
