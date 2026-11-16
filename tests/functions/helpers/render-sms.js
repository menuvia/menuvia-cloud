// tests/functions/helpers/render-sms.js
// Scriptul PROCESULUI COPIL al oracolului SMS (SO1–SO3, lotul L8b). Rulează cu
// `TZ=<fus>` ales de părinte, deci fusul gazdei chiar are efect — un test pe
// `process.env.TZ` în același proces ar fi vacuu (fusul se citește o singură
// dată, la pornire).
//
//   node render-sms.js '<json>'
//     json = { mode: 'old' | 'new', cases: [{ kind, data, ctx? }] }
//   stdout: JSON { hostOffset, out: [{ text } | { error }] } în ordinea cazurilor.
//
// `old` = copia byte cu byte a worker-ului de dinainte
// (fixtures/legacy/process-sms-queue.40d3033.js). Copia veche nu-și exporta
// șabloanele, deci încărcătorul ADAUGĂ o linie de export la compilare —
// fișierul de pe disc rămâne neatins (SO0 îi verifică hash-ul). `new` =
// worker-ul de azi. Nu e fișier de test (nu se potrivește pe globurile
// `node --test`).
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.join(__dirname, '..', '..', '..')
const LEGACY = path.join(__dirname, '..', 'fixtures', 'legacy', 'process-sms-queue.40d3033.js')

const input = JSON.parse(process.argv[2] || '{}')
const { installModuleMocks } = require('./mocks')
installModuleMocks()

function loadLegacy() {
  const filename = path.join(ROOT, 'netlify', 'functions', '__legacy_process_sms_queue.js')
  const m = new Module(filename, module)
  m.filename = filename
  m.paths = Module._nodeModulePaths(path.dirname(filename))
  m._compile(`${fs.readFileSync(LEGACY, 'utf8')}\nmodule.exports.__TEMPLATES = TEMPLATES\n`, filename)
  return m.exports.__TEMPLATES
}

const templates =
  input.mode === 'old'
    ? loadLegacy()
    : require(path.join(ROOT, 'netlify', 'functions', 'process-sms-queue.js')).TEMPLATES

const out = (input.cases || []).map(({ kind, data, ctx }) => {
  try {
    const text = input.mode === 'old' ? templates[kind](data || {}) : templates[kind](data || {}, ctx)
    return { text }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
})
process.stdout.write(JSON.stringify({ hostOffset: new Date(2026, 0, 15).getTimezoneOffset(), out }))
