// tests/functions/domain-ratchet.test.js
// CLICHET: domeniile platformei (menuvia.ro / menuvia.com) se scriu într-UN
// singur loc pe fiecare parte — `netlify/functions/lib/appUrl.js` (server) și
// `src/lib/domain.ts` (client). Înainte de a doua piață, 8 funcții și 12
// fișiere de UI aveau `menuvia.ro` scris de mână, cu fallback-uri divergente;
// menuvia.com ar fi cerut să le găsești pe toate de mână, iar orice fișier
// uitat ar fi trimis clientul .com pe domeniul .ro.
//
//   DR1  `menuvia.ro` apare în cod (nu în comentarii) DOAR în fișierele din
//        registru, cu numărul EXACT de apariții — un fișier nou pică, o
//        apariție în plus pică, iar una scoasă cere actualizarea registrului
//        (registrul rămâne adevărat, nu doar un plafon).
//   DR2  la fel pentru `menuvia.com`.
//   DR3  anti-vacuitate: scanarea VEDE fișierele (altfel un glob stricat ar
//        face DR1/DR2 trivial adevărate) și vede sursa unică.
//
// Exclus: testele (`__tests__`, tests/), documentele legale / markdown și
// liniile de comentariu (`//`, `*`, `/*`, `{/*`) — acolo domeniul e text, nu
// configurare. Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

// Registrul: fișier → număr EXACT de linii de cod care conțin domeniul.
const ALLOW_RO = {
  'netlify/functions/lib/appUrl.js': 1, // RO_DOMAIN — sursa unică server
  'src/lib/domain.ts': 1, // SITE_HOSTS.ro — sursa unică client
  // Text de oaspete în 7 limbi (tabela T); nu e configurare de domeniu.
  'src/lib/guestStrings.ts': 7,
}
const ALLOW_COM = {
  'src/lib/domain.ts': 1, // SITE_HOSTS.com
  'src/lib/siteMarket.ts': 1, // mesajul „coming soon" de pe .com
}

function walk(dir, exts, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '__tests__') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(full)
  }
  return out
}

function isCommentLine(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')
}

function scan(re) {
  const files = [
    ...walk(path.join(ROOT, 'src'), ['.ts', '.tsx'], []),
    ...walk(path.join(ROOT, 'netlify', 'functions'), ['.js'], []),
  ]
  const hits = {}
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/')
    const n = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !isCommentLine(l) && re.test(l)).length
    if (n > 0) hits[rel] = n
  }
  return { files, hits }
}

function diff(hits, allow) {
  const errs = []
  for (const [f, n] of Object.entries(hits)) {
    if (!(f in allow)) errs.push(`${f}: ${n} apariții, fișierul NU e în registru`)
    else if (allow[f] !== n) errs.push(`${f}: ${n} apariții, registrul spune ${allow[f]}`)
  }
  for (const f of Object.keys(allow)) {
    if (!(f in hits)) errs.push(`${f}: în registru, dar fără nicio apariție (actualizează registrul)`)
  }
  return errs
}

describe('domain-ratchet — domeniul scris într-un singur loc', () => {
  it('DR1: menuvia.ro doar în registru', () => {
    const { hits } = scan(/menuvia\.ro\b/)
    const errs = diff(hits, ALLOW_RO)
    assert.deepEqual(
      errs,
      [],
      'folosește appUrl()/FROM_* (netlify/functions/lib/appUrl.js) sau SITE_HOSTS/CONTACT_EMAIL ' +
        '(src/lib/domain.ts):\n' + errs.join('\n'),
    )
  })

  it('DR2: menuvia.com doar în registru', () => {
    const { hits } = scan(/menuvia\.com\b/)
    const errs = diff(hits, ALLOW_COM)
    assert.deepEqual(errs, [], errs.join('\n'))
  })

  it('DR3: anti-vacuitate — scanarea vede sursele', () => {
    const { files, hits } = scan(/menuvia\.ro\b/)
    assert.ok(files.length > 100, `doar ${files.length} fișiere scanate`)
    assert.ok(files.some((f) => f.endsWith(path.join('functions', 'stripe-webhook.js'))))
    assert.equal(hits['netlify/functions/lib/appUrl.js'], 1)
    assert.equal(hits['src/lib/domain.ts'], 1)
  })
})
