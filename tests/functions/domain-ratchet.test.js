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
//   DR4  CLICHET D3 (pachetul 5): `menuvia.com` NU ne aparține. Niciun URL
//        (`https://menuvia.com`, `//www.menuvia.com/...`, `http://app.menuvia.com`)
//        nu apare în NICIUN fișier livrat (src, funcții, index.html, public/,
//        netlify.toml) — NICI în comentarii. Domeniul rămâne doar ca nume de
//        host pentru DETECȚIE (registrul DR2), nu ca URL generabil.
//   DR5  nicio piesă din afara sursei unice nu citește `SITE_HOSTS.com`/`COM_APP_URL`
//        (singura cale prin care un URL .com ar putea fi GENERAT din hostname).
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
// `menuvia.com` rămâne DOAR ca nume de host pentru DETECȚIE (D3: domeniul nu
// ne aparține; niciun URL generat). Fiecare intrare e un nume, nu un URL (DR4).
const ALLOW_COM = {
  'netlify/functions/lib/appUrl.js': 1, // COM_DOMAIN — isComHost (detecție)
  'src/lib/domain.ts': 1, // SITE_HOSTS.com — currentSite/isMenuviaRootHost (detecție)
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

  it('DR4: niciun URL spre menuvia.com în fișierele livrate (nici în comentarii)', () => {
    const URL_COM = /(?:https?:)?\/\/(?:[a-z0-9-]+\.)*menuvia\.com\b/i
    const files = [
      ...walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css', '.json'], []),
      ...walk(path.join(ROOT, 'netlify', 'functions'), ['.js', '.json'], []),
      ...walk(path.join(ROOT, 'public'), ['.html', '.xml', '.txt', '.json', '.webmanifest', '.js'], []),
      ...['index.html', 'netlify.toml'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
    ]
    const bad = []
    for (const f of files) {
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((l, i) => {
          if (URL_COM.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${l.trim().slice(0, 120)}`)
        })
    }
    assert.deepEqual(bad, [], 'URL spre menuvia.com (domeniul nu ne aparține — D3):\n' + bad.join('\n'))
    // anti-vacuitate: scanarea chiar vede ambele surse unice
    assert.ok(files.some((f) => f.endsWith(path.join('src', 'lib', 'domain.ts'))))
    assert.ok(files.some((f) => f.endsWith(path.join('lib', 'appUrl.js'))))
    // controlul pozitiv al regexului
    assert.ok(URL_COM.test('x = "https://menuvia.com/q/abc"'))
    assert.ok(URL_COM.test('href="//www.menuvia.com"'))
    assert.ok(!URL_COM.test('https://menuvia.ro/q/abc'))
    assert.ok(!URL_COM.test('https://evilmenuvia.com.example'))
  })

  it('DR5: SITE_HOSTS.com / COM_APP_URL doar în sursa unică', () => {
    const re = /SITE_HOSTS(?:\.com|\[\s*['"]com['"]\s*\])|COM_APP_URL|siteOrigin\(\s*['"]com['"]|siteHost\(\s*['"]com['"]/
    const { files } = scan(/^$/)
    const bad = []
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/')
      if (rel === 'src/lib/domain.ts') continue
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((l, i) => {
          if (!isCommentLine(l) && re.test(l)) bad.push(`${rel}:${i + 1}: ${l.trim()}`)
        })
    }
    assert.deepEqual(bad, [], bad.join('\n'))
    assert.ok(re.test('const u = SITE_HOSTS.com'))
    assert.ok(re.test("siteOrigin('com')"))
  })
})
