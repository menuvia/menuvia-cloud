// tests/functions/schedule-comments.test.js
// Clichetul COMENTARIILOR DE ORAR din funcțiile programate.
//
// De ce există: CLAUDE.md cere ca orice schimbare de `schedule` din
// netlify.toml să se oglindească în același commit, fiindcă „documentația care
// minte pe cron-uri a re-declanșat o dată bugetul care a omorât cron-ul". Dar
// regula trăia în proză, iar trei antete ajunseseră să mintă:
//   • process-sms-queue: „la fiecare 1 min", `* * * * *`   (toml: */15)
//   • send-reservation-reminders: „la fiecare 10 min", `*/10 * * * *` (toml: */30)
//   • send-health-slack-alerts: `5,20,35,50 * * * *`, „compute_health_scores
//     la :00, :15, :30, :45"                                (toml: 5,35; health la :00/:30)
// Un om care citea antetul ca să judece bugetul de invocări (sau ca să
// „coboare înapoi" cadența) pornea de la o cifră falsă.
//
//   SCH1  orice expresie cron completă (5 câmpuri, între ghilimele/backtick-uri)
//         din fișierul unei funcții programate == orarul ei din netlify.toml.
//   SCH2  „la fiecare N min" din primele rânduri ale antetului == cadența din
//         toml (`*/N` → N, `*` → 1, listă echidistantă → pasul ei).
//   SCH3  un câmp de minut scris singur (`*/15`) în antet == câmpul de minut
//         din toml (oblio-generator: „azi `*/15`").
//   SCH4  anti-vacuitate: parserul vede funcțiile programate, fiecare fișier
//         există, iar verificarea PICĂ pe un antet mutat în memorie (control).
//
// Mutațiile care pică: oricare dintre cele trei antete vechi (SCH1/SCH2), sau
// o schimbare de `schedule` în netlify.toml fără antetul funcției.
// Parser-ul de toml = `readSchedules` din deploy/server.js (aceeași formă ca
// automation-cron-schedule.test.js). Rulează în jobul „Bridge tests".
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const NETLIFY_TOML = path.join(ROOT, 'netlify.toml')
const FUNCTIONS = path.join(ROOT, 'netlify', 'functions')

function readSchedules(tomlPath) {
  const text = fs.readFileSync(tomlPath, 'utf8')
  const re = /\[functions\."([\w-]+)"\]\s*[\r\n]+\s*schedule\s*=\s*"([^"]+)"/g
  const out = []
  let m
  while ((m = re.exec(text)) !== null) out.push({ name: m[1], expr: m[2] })
  return out
}

// Blocul de comentarii de la începutul fișierului (până la primul rând de cod).
function leadingComment(src) {
  const lines = src.split('\n')
  const out = []
  for (const line of lines) {
    const t = line.trim()
    if (t === '' || t.startsWith('//')) out.push(line)
    else break
  }
  return out
}

const CRON_LITERAL = /["'`]((?:[\d*/,-]+[ \t]+){4}[\d*/,-]+)["'`]/g
const MINUTE_LITERAL = /`(\*\/\d+)`/g
const EVERY_N_MIN = /la fiecare (\d+) min/gi

// Pasul în minute al câmpului de minut: `*/N` → N, `*` → 1, listă
// echidistantă (`5,35`) → pasul ei; altfel null (nu se verifică).
function cadenceMinutes(expr) {
  const minute = expr.trim().split(/\s+/)[0]
  if (minute === '*') return 1
  const step = minute.match(/^\*\/(\d+)$/)
  if (step) return Number(step[1])
  if (/^\d+(,\d+)+$/.test(minute)) {
    const ms = minute.split(',').map(Number)
    const gaps = ms.map((m, i) => ((ms[(i + 1) % ms.length] - m + 60) % 60) || 60)
    return gaps.every((g) => g === gaps[0]) ? gaps[0] : null
  }
  return null
}

/** Neconcordanțele dintre antetul unui fișier și orarul din toml. */
function mismatches(src, expr) {
  const out = []
  for (const m of src.matchAll(CRON_LITERAL)) {
    if (m[1].trim().replace(/\s+/g, ' ') !== expr) out.push(`expresie cron „${m[1]}" ≠ „${expr}"`)
  }
  const header = leadingComment(src)
  const minuteField = expr.split(/\s+/)[0]
  for (const line of header) {
    for (const m of line.matchAll(MINUTE_LITERAL)) {
      if (m[1] !== minuteField) out.push(`câmp de minut „${m[1]}" ≠ „${minuteField}"`)
    }
  }
  const cadence = cadenceMinutes(expr)
  for (const line of header.slice(0, 4)) {
    for (const m of line.matchAll(EVERY_N_MIN)) {
      if (cadence !== null && Number(m[1]) !== cadence) {
        out.push(`„la fiecare ${m[1]} min" ≠ cadența din toml (${cadence} min)`)
      }
    }
  }
  return out
}

const jobs = readSchedules(NETLIFY_TOML)
const fileOf = (name) => path.join(FUNCTIONS, `${name}.js`)

describe('comentariile de orar din funcțiile programate == netlify.toml', () => {
  it('SCH1–SCH3: niciun antet nu contrazice orarul din toml', () => {
    const problems = []
    for (const { name, expr } of jobs) {
      const src = fs.readFileSync(fileOf(name), 'utf8')
      for (const p of mismatches(src, expr)) problems.push(`${name}.js: ${p}`)
    }
    assert.deepEqual(
      problems,
      [],
      'antete care mint despre cadență (corectează antetul în ACELAȘI commit cu netlify.toml):\n' +
        problems.join('\n'),
    )
  })

  it('SCH4 (anti-vacuitate): parserul vede funcțiile și verificarea chiar pică pe un antet greșit', () => {
    assert.ok(jobs.length >= 6, `prea puține funcții programate: ${jobs.length}`)
    let withLiteral = 0
    for (const { name, expr } of jobs) {
      assert.ok(fs.existsSync(fileOf(name)), `${name}: programată în toml, dar fișierul lipsește`)
      const src = fs.readFileSync(fileOf(name), 'utf8')
      if ([...src.matchAll(CRON_LITERAL)].length > 0) withLiteral++
      // Control: același fișier, cu orarul din antet „uitat" la o valoare veche.
      const stale = src.includes(`"${expr}"`) ? src.replace(`"${expr}"`, '"* * * * *"') : null
      if (stale && expr !== '* * * * *') {
        assert.ok(mismatches(stale, expr).length > 0, `${name}: mutația antetului NU e prinsă`)
      }
    }
    assert.ok(withLiteral >= 5, `doar ${withLiteral} antete documentează orarul complet`)
    // Proza veche a lui process-sms-queue („la fiecare 1 min") e prinsă de SCH2.
    assert.deepEqual(mismatches('// x\n// Cron-triggered: la fiecare 1 min.\n', '*/15 * * * *'), [
      '„la fiecare 1 min" ≠ cadența din toml (15 min)',
    ])
    assert.deepEqual(mismatches('// azi `*/30`\nconst a = 1\n', '*/15 * * * *'), [
      'câmp de minut „*/30" ≠ „*/15"',
    ])
    assert.equal(cadenceMinutes('5,35 * * * *'), 30)
    assert.equal(cadenceMinutes('* * * * *'), 1)
    assert.equal(cadenceMinutes('5,20,50 * * * *'), null)
  })
})
