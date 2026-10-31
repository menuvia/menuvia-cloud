// tests/functions/dead-code-ratchet.test.js
// CLICHET: niciun modul din src/ nu stă în repo fără să-l folosească aplicația.
//
// Auditul de optimizare (oct 2026) a găsit 12 fișiere pe care NIMIC din
// aplicație nu le mai importa: `lib/i18n.ts` + `LanguageSwitcher.tsx` (vechiul
// comutator RO/EN, înlocuit de cele 7 limbi ale oaspetelui — decizia C4),
// `ui/Badge.tsx`, `ui/Section.tsx`, șapte foi CSS din `styles/components/`
// (badge, card, data-table, field, modal, tabs, tooltip) și schemele zod din
// `src/schemas/` (importate DOAR de propria suită de teste). Un modul mort nu
// costă la runtime, dar minte: se prezintă drept „sursa unică” pentru ceva
// (schemele de validare, sistemul i18n, componentele de bază) și cine îl
// găsește îl modifică crezând că schimbă aplicația.
//
//   DC0  anti-vacuitate: rădăcinile se citesc din index.html și vitest.config.ts
//        (nu sunt scrise de mână aici), graful vede App.tsx, un tab încărcat
//        LENEȘ (import dinamic) și o foaie CSS importată dintr-o componentă —
//        câte un exemplu pentru fiecare fel de muchie. Fără asta, un parser
//        stricat ar marca totul „mort” sau, invers, nimic.
//   DC0b control pe un arbore SINTETIC: un modul importat doar de un test, unul
//        importat doar într-un comentariu și o foaie CSS fără `@import` ies
//        morți; importul multi-linie, cel dinamic, `export … from`, aliasul `@/`
//        și `@import` din CSS țin modulele în viață.
//   DC1  orice .ts/.tsx/.css din src/ (fără teste și fără .d.ts) e accesibil din
//        rădăcini. Mutația care îl pică: readuci oricare dintre cele 12 fișiere
//        șterse (sau `src/schemas/index.ts` cu testul lui) — testul îl numește.
//   DC1b registrul de scutiri e ONEST: fiecare intrare există ȘI e într-adevăr
//        inaccesibilă (o scutire care nu mai acoperă nimic pică — tiparul GI3).
//
// Rulează în jobul „Bridge tests" (`cd tests/functions && npm test`); vitest
// nu vede tests/functions.
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = 'src'

// Scutiri: modul → motiv. Un modul care NU e importat de aplicație, dar trebuie
// să rămână (ex. un punct de intrare citit de alt instrument). Azi: niciunul.
const ALLOWED_UNREACHABLE = {}

const posix = path.posix

function isTestPath(rel) {
  return /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)
}

function isCandidate(rel) {
  if (isTestPath(rel)) return false
  if (rel.endsWith('.d.ts')) return false
  return /\.(ts|tsx|css)$/.test(rel)
}

/** Toate fișierele de sub `dir` (relativ la ROOT, cu separator POSIX). */
function listFiles(dir) {
  const out = []
  ;(function walk(abs) {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue
      const full = path.join(abs, ent.name)
      if (ent.isDirectory()) walk(full)
      else out.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  })(path.join(ROOT, dir))
  return out
}

/**
 * Specificatorii importați de un fișier. Doar formele care chiar leagă module:
 * `import … from`, `export … from` (ancorate la început de rând — un import
 * comentat cu `//` sau ` * ` NU contează), `import 'x'` (efect secundar),
 * `import('x')` (încărcare leneșă) și `@import` în CSS.
 */
function extractSpecs(text, rel) {
  const specs = []
  if (rel.endsWith('.css')) {
    for (const m of text.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"\n]+)['"]/g)) specs.push(m[1])
    return specs
  }
  const fromRe = /^[ \t]*(?:import|export)\s+(?:type\s+)?[\w$*{}\s,]*?\bfrom\s*['"]([^'"\n]+)['"]/gm
  const sideRe = /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm
  const dynRe = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g
  for (const re of [fromRe, sideRe, dynRe]) for (const m of text.matchAll(re)) specs.push(m[1])
  return specs
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.css', '/index.ts', '/index.tsx']

/** Rezolvă un specificator la un fișier din `has`, sau null (pachet npm / altceva). */
function resolveSpec(fromRel, spec, has) {
  const clean = spec.replace(/\?.*$/, '')
  let base
  if (clean.startsWith('@/')) base = posix.join(SRC, clean.slice(2))
  else if (clean.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(fromRel), clean))
  else return null
  for (const ext of EXTENSIONS) if (has(base + ext)) return base + ext
  return null
}

/** BFS din rădăcini; întoarce mulțimea fișierelor accesibile. */
function reachableFrom(roots, readText, has) {
  const seen = new Set()
  const stack = [...roots]
  while (stack.length) {
    const rel = stack.pop()
    if (seen.has(rel) || !has(rel)) continue
    seen.add(rel)
    if (!/\.(ts|tsx|css)$/.test(rel)) continue
    for (const spec of extractSpecs(readText(rel), rel)) {
      const target = resolveSpec(rel, spec, has)
      if (target) stack.push(target)
    }
  }
  return seen
}

/** Rădăcinile reale: scripturile din index.html + setupFiles din vitest + .d.ts. */
function realRoots(files) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script[^>]*\bsrc="\/(src\/[^"]+)"/g)].map((m) => m[1])
  const vitest = fs.readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8')
  const setupBlock = vitest.match(/setupFiles:\s*\[([^\]]*)\]/)
  const setup = setupBlock
    ? [...setupBlock[1].matchAll(/['"]\.\/([^'"]+)['"]/g)].map((m) => m[1])
    : []
  const ambient = files.filter((f) => f.endsWith('.d.ts'))
  return { scripts, setup, ambient, all: [...scripts, ...setup, ...ambient] }
}

function realGraph() {
  const files = listFiles(SRC)
  const set = new Set(files)
  const has = (rel) => set.has(rel)
  const cache = new Map()
  const readText = (rel) => {
    if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    return cache.get(rel)
  }
  const roots = realRoots(files)
  const reachable = reachableFrom(roots.all, readText, has)
  const candidates = files.filter(isCandidate)
  return { files, roots, reachable, candidates }
}


describe('cod mort: module fără importatori', () => {
  const g = realGraph()

  it('DC0: rădăcinile vin din config și graful vede toate felurile de muchii', () => {
    assert.deepEqual(g.roots.scripts, ['src/main.tsx'], 'scriptul de intrare din index.html')
    assert.ok(g.roots.setup.includes('src/test-setup.ts'), 'setupFiles din vitest.config.ts')
    assert.ok(g.candidates.length > 150, `prea puține module găsite: ${g.candidates.length}`)
    // import static
    assert.ok(g.reachable.has('src/App.tsx'), 'App.tsx (import static din main.tsx)')
    // import dinamic (tab-urile mari din dashboard sunt lazy-loaded)
    assert.ok(g.reachable.has('src/components/ReservationsTab.tsx'), 'tab lazy-loaded')
    // import de foaie CSS dintr-o componentă
    assert.ok(g.reachable.has('src/styles/components/button.css'), 'button.css din Button.tsx')
  })

  it('DC0b: parserul și graful, pe un arbore sintetic', () => {
    const files = {
      'src/main.tsx': [
        "import App from './App'",
        "// import Ghost from './Ghost'",
        "import '@/styles/root.css'",
      ].join('\n'),
      'src/App.tsx': [
        'import {',
        '  a,',
        '  type B,',
        "} from './lib/multi'",
        "export { c } from './lib/reexport'",
        "const Tab = lazy(() => import('./Tab'))",
      ].join('\n'),
      'src/lib/multi.ts': 'export const a = 1',
      'src/lib/reexport.ts': 'export const c = 1',
      'src/Tab.tsx': 'export default function Tab() {}',
      'src/Ghost.tsx': 'export default function Ghost() {}',
      'src/styles/root.css': "@import './imported.css';",
      'src/styles/imported.css': '.x{}',
      'src/styles/orphan.css': '.y{}',
      'src/lib/onlyTested.ts': 'export const z = 1',
      'src/lib/__tests__/onlyTested.test.ts': "import { z } from '../onlyTested'",
    }
    const has = (rel) => Object.prototype.hasOwnProperty.call(files, rel)
    const reach = reachableFrom(['src/main.tsx'], (rel) => files[rel], has)
    const dead = Object.keys(files)
      .filter(isCandidate)
      .filter((f) => !reach.has(f))
      .sort()
    assert.deepEqual(dead, [
      'src/Ghost.tsx',
      'src/lib/onlyTested.ts',
      'src/styles/orphan.css',
    ])
  })

  it('DC1: orice modul din src/ e importat de aplicație', () => {
    const dead = g.candidates
      .filter((f) => !g.reachable.has(f))
      .filter((f) => !Object.prototype.hasOwnProperty.call(ALLOWED_UNREACHABLE, f))
      .sort()
    assert.deepEqual(
      dead,
      [],
      'Module pe care aplicația nu le importă (șterge-le sau, dacă trebuie să rămână, ' +
        'adaugă-le în ALLOWED_UNREACHABLE cu motiv): ' +
        dead.join(', '),
    )
  })

  it('DC1b: scutirile acoperă module reale și chiar inaccesibile', () => {
    for (const [rel, why] of Object.entries(ALLOWED_UNREACHABLE)) {
      assert.ok(typeof why === 'string' && why.length > 10, `${rel}: scutire fără motiv`)
      assert.ok(g.files.includes(rel), `${rel}: scutire pentru un fișier care nu există`)
      assert.ok(!g.reachable.has(rel), `${rel}: e importat de aplicație — scoate scutirea`)
    }
  })
})
