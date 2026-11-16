// tests/functions/helpers/render-emails.js
// Scriptul PROCESULUI COPIL al oracolului (EO1–EO3, lotul L8a). Rulează cu
// `TZ=<fus>` ales de părinte și cu ceasul OPRIT la `now`, deci fusul gazdei
// chiar are efect — un test pe `process.env.TZ` în același proces ar fi vacuu
// (fusul se citește o singură dată, la pornire).
//
//   node render-emails.js '<json>'
//     json = { mode: 'old' | 'new', now: ISO, appUrl, cases: [{ kind, data, ctx? }] }
//   stdout: JSON [{ subject, html } | { error }] în ordinea cazurilor.
//
// `old` = copia byte cu byte a worker-ului de dinainte
// (fixtures/legacy/process-email-queue.30a6400.js), compilată ca și cum ar sta
// în netlify/functions (ca `./lib/appUrl` să se rezolve); `new` = worker-ul de
// azi. Nu e fișier de test (nu se potrivește pe globurile `node --test`).
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.join(__dirname, '..', '..', '..')
const LEGACY = path.join(__dirname, '..', 'fixtures', 'legacy', 'process-email-queue.30a6400.js')

const input = JSON.parse(process.argv[2] || '{}')

// Ceasul oprit: `new Date()` și `Date.now()` dau `now`; restul API-ului rămâne.
const RealDate = Date
const NOW_MS = RealDate.parse(input.now)
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(NOW_MS)
    else super(...args)
  }
  static now() {
    return NOW_MS
  }
}
global.Date = FrozenDate

process.env.APP_URL = input.appUrl
const { installModuleMocks } = require('./mocks')
installModuleMocks()

function loadLegacy() {
  const filename = path.join(ROOT, 'netlify', 'functions', '__legacy_process_email_queue.js')
  const m = new Module(filename, module)
  m.filename = filename
  m.paths = Module._nodeModulePaths(path.dirname(filename))
  m._compile(fs.readFileSync(LEGACY, 'utf8'), filename)
  return m.exports
}

const mod = input.mode === 'old' ? loadLegacy() : require(path.join(ROOT, 'netlify', 'functions', 'process-email-queue.js'))

const out = (input.cases || []).map(({ kind, data, ctx }) => {
  try {
    const r = input.mode === 'old' ? mod.TEMPLATES[kind](data || {}) : mod.renderEmail(kind, data, ctx)
    return { subject: r.subject, html: r.html }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
})
process.stdout.write(JSON.stringify(out))
