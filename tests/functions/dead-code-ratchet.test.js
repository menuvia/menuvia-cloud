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
// Același audit a găsit și EXPORTURI moarte în module vii (src/lib, src/hooks):
// `useTableZones`, `trackPageView`/`identifyUser`/`resetAnalytics`/
// `isFeatureEnabled`, `TRANSITION_LABELS` + `KITCHEN_TRANSITIONS` +
// `WAITER_TRANSITIONS` (acesta din urmă spunea încă `['served','paid']`, adică
// un ciclu de viață de dinaintea lui `closed`), `PARTNER_DEFAULT_TAB` (o a doua
// sursă pentru tab-ul de pornire, pe care DashboardPage n-o citea),
// `fetchStockMovements`, `updateSupplier` și tipurile lor.
//
//   DC2  niciun export din src/lib și src/hooks nu e complet nefolosit: numele
//        lui nu apare în niciun alt fișier din src/ (cod sau test) și nici în
//        propriul fișier în afara declarației. Comentariile nu contează ca
//        folosire; accesul pe proprietate (`ph.isFeatureEnabled`) nici el.
//        Mutația care îl pică: readuci oricare dintre exporturile de mai sus.
//        Un export folosit DOAR de teste trece (e un cârlig de test, nu cod
//        mort tăcut) — DC2 prinde exact clasa „nu-l cheamă nimeni”.
//   DC2b control pe fișiere sintetice: exportul nefolosit, cel pomenit doar
//        într-un comentariu și cel atins doar ca proprietate ies morți; cel
//        importat, cel folosit în propriul fișier, cel folosit doar de test și
//        modulul importat cu `import * as` rămân vii.
//   DC2d importul DINAMIC: `import('x').Tip` (forma din useData.ts) și modulul
//        legat de o variabilă (`.then((m) => m.f())`, `(await import('x')).f`)
//        țin exporturile în viață; destructurarea păstrează precizia (numele
//        nedestructurat moare), iar `typeof import('x')` din mock-urile parțiale
//        nu scoate modulul din detecție. Mutațiile care îl pică: ramura de import
//        dinamic scoasă din `deadExports` (DC2 cerea ștergerea unui export
//        folosit, iar urmarea mesajului rupea `tsc`), „orice import dinamic
//        leagă modulul” și excepția `typeof` scoasă (ultimele două pică și DC2c:
//        orders.ts ieșea din detecție).
//   DC2c registrul KNOWN_DEAD nu acoperă un export VIU (o scutire pe un nume
//        care între timp a căpătat un apelant e o minciună) și nici un export
//        care NU MAI EXISTĂ: o intrare rămasă după ștergere e tot o minciună
//        (spune că exportul e acolo, mort). Cât timp PR-urile lotului de
//        curățenie erau deschise în paralel, intrările șterse erau tolerate;
//        #321 a scos ultimele (voidOrderPayment, rotateQrToken din orders.ts),
//        deci toleranța a devenit cerință. Mutația care pică: o intrare
//        readusă pentru un export șters.
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

// Exporturi moarte CUNOSCUTE, lăsate deliberat în fișiere pe care această
// curățenie nu le atinge (fișier → nume → motiv). Se scot pe măsură ce dispar.
// founder.ts nu se atinge în această rundă (fișier rezervat altei lucrări în
// curs), iar niciun PR deschis nu scoate exporturile de mai jos: rămân aici
// până când cineva atinge fișierul. Cine le șterge scoate și intrarea, în
// același PR — DC2c pică pe o intrare pentru un export care nu mai există.
const FOUNDER_WHY = 'founder.ts e exclus din runda de curățenie; se scot la următoarea atingere'
const KNOWN_DEAD = {
  'src/lib/founder.ts': {
    listHealth: FOUNDER_WHY,
    getPartnerAccess: FOUNDER_WHY,
    grantPartnerAccess: FOUNDER_WHY,
    revokeAffiliateAccess: FOUNDER_WHY,
  },
}

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

/** Textul de cod: rândurile de comentariu (`//`, `*`, `/*`, `{/*`) scoase. */
function codeOnly(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join('\n')
}

const EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract\s+class|interface|type|enum|const\s+enum)\s+([A-Za-z_$][\w$]*)/gm

function escapeRe(name) {
  return name.replace(/\$/g, '\\$')
}

/** Aparițiile lui `name` ca identificator (nu ca proprietate: `x.name` nu contează). */
function countRefs(code, name) {
  const re = new RegExp(`(?<![\\w$.])${escapeRe(name)}(?![\\w$])`, 'g')
  return (code.match(re) || []).length
}

/**
 * Exporturile complet nefolosite din fișierele `scanned` (relativ, POSIX),
 * căutate în TOATE fișierele `files` ({rel: text}). Un fișier importat
 * undeva cu `import * as` e sărit întreg (orice export poate fi atins prin
 * spațiul de nume).
 *
 * Importul DINAMIC are trei forme, iar doar una păstrează numele ca
 * identificator: `const { a } = await import('x')` (destructurare — `a` se
 * numără normal). `import('x').Tip` (tip, ex. `useData.ts`) pune numele DUPĂ
 * punct, unde `countRefs` nu-l vede: se numără explicit. Orice altă formă
 * (`.then((m) => m.f())`, `(await import('x')).f`, `const m = await
 * import('x')`) leagă modulul de o variabilă, ca `import * as`: fișierul e sărit
 * întreg. Fără asta, un export folosit doar așa ieșea „mort”, iar mesajul
 * clichetului cerea ștergerea lui — adică un `tsc` roșu. `typeof import('x')`
 * (tipul modulului, în mock-urile parțiale din teste) NU leagă nimic: altfel
 * orice modul mock-uit cu `importOriginal` ar fi ieșit din detecție.
 */
function deadExports(files, scanned) {
  const code = {}
  for (const [rel, text] of Object.entries(files)) code[rel] = codeOnly(text)
  const has = (rel) => Object.prototype.hasOwnProperty.call(files, rel)
  const namespaced = new Set()
  const usedByName = new Set()
  for (const [rel, text] of Object.entries(files)) {
    for (const m of text.matchAll(
      /^[ \t]*import\s+\*\s+as\s+[\w$]+\s+from\s*['"]([^'"\n]+)['"]/gm,
    )) {
      const target = resolveSpec(rel, m[1], has)
      if (target) namespaced.add(target)
    }
    const src = code[rel]
    for (const m of src.matchAll(
      /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)(\s*\.\s*([A-Za-z_$][\w$]*))?/g,
    )) {
      const target = resolveSpec(rel, m[1], has)
      if (!target) continue
      const prop = m[3]
      const before = src.slice(Math.max(0, m.index - 40), m.index)
      // `.catch`/`.finally` pe un import de prefetch nu ating niciun export.
      if (prop === 'catch' || prop === 'finally') continue
      if (prop && prop !== 'then') usedByName.add(`${target}:${prop}`)
      // `typeof import('x')` (tipul modulului, ex. `importOriginal<…>` din
      // mock-urile vitest) nu numește niciun export; destructurarea le numește
      // ca identificatori, deci se numără deja.
      else if (/\btypeof\s*$/.test(before) || /\}\s*=\s*await\s*$/.test(before)) continue
      else namespaced.add(target)
    }
  }
  const dead = []
  for (const rel of scanned) {
    if (namespaced.has(rel)) continue
    for (const m of code[rel].matchAll(EXPORT_RE)) {
      const name = m[1]
      if (usedByName.has(`${rel}:${name}`)) continue
      let refs = countRefs(code[rel], name) - 1
      for (const other of Object.keys(code)) {
        if (other === rel || refs > 0) continue
        refs += countRefs(code[other], name)
      }
      if (refs === 0) dead.push(`${rel}:${name}`)
    }
  }
  return dead.sort()
}

function realSources() {
  const files = {}
  for (const rel of listFiles(SRC)) {
    if (/\.(ts|tsx)$/.test(rel)) files[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  }
  const scanned = Object.keys(files).filter(
    (rel) => /^src\/(lib|hooks)\//.test(rel) && !isTestPath(rel) && !rel.endsWith('.d.ts'),
  )
  return { files, scanned }
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
    assert.deepEqual(dead, ['src/Ghost.tsx', 'src/lib/onlyTested.ts', 'src/styles/orphan.css'])
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

describe('cod mort: exporturi pe care nu le folosește nimeni', () => {
  const src = realSources()

  it('DC2: niciun export din src/lib și src/hooks nu e complet nefolosit', () => {
    assert.ok(src.scanned.length > 80, `prea puține module scanate: ${src.scanned.length}`)
    const known = new Set(
      Object.entries(KNOWN_DEAD).flatMap(([rel, names]) =>
        Object.keys(names).map((n) => `${rel}:${n}`),
      ),
    )
    const dead = deadExports(src.files, src.scanned).filter((k) => !known.has(k))
    assert.deepEqual(
      dead,
      [],
      'Exporturi pe care nu le folosește nimeni (șterge-le; dacă trebuie să rămână ' +
        'temporar, KNOWN_DEAD cu motiv): ' +
        dead.join(', '),
    )
  })

  it('DC2b: detectorul, pe fișiere sintetice', () => {
    const files = {
      'src/lib/a.ts': [
        'export function used() {}',
        'export function unused() {}',
        'export const onlyInComment = 1',
        'export const onlyAsProperty = 1',
        'export type Internal = { x: number }',
        'export function usesInternal(i: Internal) { return i }',
        'export const onlyInTest = 1',
      ].join('\n'),
      'src/lib/ns.ts': 'export const viaNamespace = 1',
      'src/App.tsx': [
        "import { used, usesInternal } from './lib/a'",
        "import * as NS from './lib/ns'",
        '// onlyInComment e pomenit doar aici',
        "const o = JSON.parse('{}')",
        'used(); usesInternal({ x: o.onlyAsProperty }); NS.viaNamespace',
      ].join('\n'),
      'src/lib/__tests__/a.test.ts': "import { onlyInTest } from '../a'",
    }
    assert.deepEqual(deadExports(files, ['src/lib/a.ts', 'src/lib/ns.ts']), [
      'src/lib/a.ts:onlyAsProperty',
      'src/lib/a.ts:onlyInComment',
      'src/lib/a.ts:unused',
    ])
  })

  it('DC2d: importul dinamic — tip după punct, destructurare, modul legat de o variabilă', () => {
    const files = {
      'src/lib/typed.ts': [
        'export type ViaImportType = { x: number }',
        'export type UnusedType = { y: number }',
      ].join('\n'),
      'src/lib/picked.ts': ['export function picked() {}', 'export function notPicked() {}'].join(
        '\n',
      ),
      'src/lib/lazyThen.ts': 'export function viaThen() {}',
      'src/lib/lazyAwait.ts': 'export function viaAwait() {}',
      'src/lib/prefetched.ts': 'export function neverCalled() {}',
      // Mock parțial vitest: tipul modulului nu numește niciun export.
      'src/lib/__tests__/picked.test.ts': [
        "vi.mock('../picked', async (importOriginal) => ({",
        "  ...(await importOriginal<typeof import('../picked')>()),",
        '}))',
      ].join('\n'),
      'src/App.tsx': [
        "type T = import('./lib/typed').ViaImportType",
        'export async function go(t: T) {',
        "  const { picked } = await import('./lib/picked')",
        "  void import('./lib/lazyThen').then((m) => m.viaThen())",
        "  ;(await import('./lib/lazyAwait')).viaAwait()",
        "  void import('./lib/prefetched').catch(() => undefined)",
        '  picked()',
        '  return t',
        '}',
      ].join('\n'),
    }
    // Pe detectorul fără ramura de import dinamic, `ViaImportType`, `viaThen`
    // și `viaAwait` ieșeau morți (toți trei sunt folosiți — `tsc` ar fi picat
    // după ștergerea lor). Precizia rămâne: `UnusedType`, `notPicked` (deși
    // modulul e mock-uit cu `typeof import`) și `neverCalled` (doar prefetch)
    // mor. Mutația „orice import dinamic leagă modulul” pică pe ele.
    assert.deepEqual(
      deadExports(files, [
        'src/lib/typed.ts',
        'src/lib/picked.ts',
        'src/lib/lazyThen.ts',
        'src/lib/lazyAwait.ts',
        'src/lib/prefetched.ts',
      ]),
      [
        'src/lib/picked.ts:notPicked',
        'src/lib/prefetched.ts:neverCalled',
        'src/lib/typed.ts:UnusedType',
      ],
    )
  })

  it('DC2c: KNOWN_DEAD acoperă doar exporturi care există și sunt moarte', () => {
    const dead = new Set(deadExports(src.files, src.scanned))
    for (const [rel, names] of Object.entries(KNOWN_DEAD)) {
      for (const [name, why] of Object.entries(names)) {
        assert.ok(typeof why === 'string' && why.length > 10, `${rel}:${name}: fără motiv`)
        const text = src.files[rel] ? codeOnly(src.files[rel]) : ''
        const stillExported = new RegExp(`^export\\s[^\\n]*\\b${escapeRe(name)}\\b`, 'm').test(text)
        assert.ok(
          stillExported,
          `${rel}:${name} nu mai e exportat — scoate intrarea din KNOWN_DEAD`,
        )
        assert.ok(
          dead.has(`${rel}:${name}`),
          `${rel}:${name} are apelanți — scoate-l din KNOWN_DEAD`,
        )
      }
    }
  })
})
