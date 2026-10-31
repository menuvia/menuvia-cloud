// tests/functions/root-docs.test.js
// CLICHET: documentele din rădăcina repo-ului nu mint despre repo.
//
// `CLAUDE.md` trimite pe oricine întâi la `ARCHITECTURE.md`, iar rădăcina e
// primul loc în care se uită un om nou. Auditul din oct 2026 a găsit acolo:
// cinci changelog-uri vechi (CHANGES-v13/v15/v16, BUGFIXES-v26,
// CHANGELOG-PRODUCTION) care treceau drept documentație curentă — „schemele
// zod sunt sursa unică”, „bacșișul intră în paid_amount”, „rulează migrațiile
// 001 → 022 în SQL Editor”; un `renovate.json` cu auto-merge pe patch-uri de
// securitate, deși botul real e Dependabot (o instalare a aplicației Renovate
// l-ar fi activat peste noapte); iar în ARCHITECTURE.md funelul de autorizare
// cu partenerul înăuntru (scos în mig 286), comisioanele „citite LIVE” (instantanee
// din mig 293), suitele SQL de eră șterse și aplicarea migrațiilor „manual în
// SQL Editor”, deși le aplică workflow-ul apply-prod-migrations. În
// DEPLOYMENT_GUIDE.md, arborele proiectului numea `ai-import.js`, care nu există.
//
//   DOC1  în rădăcină stau DOAR documentele vii din registru; note de versiune
//         istorice → docs/archive/, cu banner. Mutația: readuci un CHANGES-*.md.
//   DOC2  un singur bot de dependențe: .github/dependabot.yml există, nicio
//         configurație Renovate. Mutația: readuci renovate.json.
//   DOC3  orice cale de repo scrisă între backticks în documentele vii există
//         (cu `:linie` tolerat). Mutația: o trimitere la un fișier șters.
//   DOC3b orice fișier dintr-un ARBORE desenat (├── / └──) într-un document viu
//         există. Mutația: arborele vechi din DEPLOYMENT_GUIDE (`ai-import.js`).
//   DOC3c control pe text sintetic: extractorul vede căile și arborele.
//   DOC4  rândul „Escape-uri externe din funel, azi:” din ARCHITECTURE.md
//         numește EXACT escape-urile din definiția VIE a lui is_admin/is_member
//         (ultima migrație care le recreează). Mutația: `has_partner_access()`
//         readus în rând (sau o migrație nouă care îl readuce în funel).
//   DOC5  un document viu (plus șablonul de PR, citit la fiecare PR) care
//         pomenește „SQL Editor” trimite și la workflow-ul care aplică
//         migrațiile pe producție. Mutația: README-ul vechi („Production: prin
//         SQL Editor în Dashboard”) sau șablonul vechi („Aplicare manuală pe
//         prod … SQL Editor”).
//   DOC6  orice identificator snake_case dintr-un document viu (RPC, tabelă,
//         trigger, coloană) apare în cod: migrații, src/, funcții, teste,
//         workflow-uri. Mutația: fluxul vechi din ARCHITECTURE.md numea
//         `start_table_session`; RPC-ul real e `open_table_session`. Scutirile
//         (ex. o tabelă doar PROIECTATĂ) au motiv și trebuie să lipsească
//         într-adevăr din cod — una care a apărut între timp pică.
//
// Rulează în jobul „Bridge tests" (node --test, fără dependențe).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

// Documentele vii din rădăcină. Un document nou aici e o decizie: intră în
// registru (și sub DOC3), altfel își are locul în docs/.
const ROOT_DOCS = ['ARCHITECTURE.md', 'CLAUDE.md', 'DEPLOYMENT_GUIDE.md', 'README.md']
// Cele verificate pe conținut. CLAUDE.md are propriul regim (se scrie odată
// cu codul pe care îl descrie) și nu intră sub DOC3–DOC5.
const LIVING_DOCS = ['ARCHITECTURE.md', 'DEPLOYMENT_GUIDE.md', 'README.md']

const RENOVATE_CONFIGS = [
  'renovate.json',
  'renovate.json5',
  '.renovaterc',
  '.renovaterc.json',
  '.renovaterc.json5',
  '.github/renovate.json',
  '.github/renovate.json5',
  '.gitlab/renovate.json',
]

// Identificatori pe care documentele îi pot numi deși NU există încă în cod.
const PLANNED_IDENTIFIERS = {
  restaurant_subscriptions:
    'tabelă proiectată în docs/RESTAURANT_SUBSCRIPTIONS.md, încă necreată (ARCHITECTURE: datorii)',
}
// Unde se caută identificatorii (fără .md: documentația nu dovedește codul).
const CODE_DIRS = ['supabase', 'src', 'netlify', 'tests', 'bridge', 'scripts', '.github', 'deploy']
const SELF = path.relative(ROOT, __filename).split(path.sep).join('/')

const REPO_DIRS = [
  '.github',
  'bridge',
  'deploy',
  'docs',
  'e2e',
  'menuvia-pack',
  'netlify',
  'public',
  'scripts',
  'src',
  'supabase',
  'tests',
]

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

/** Textul fără blocurile ``` (comenzile din ele nu sunt trimiteri la fișiere). */
function withoutFences(md) {
  return md.replace(/```[\s\S]*?```/g, '')
}

/** Căile de repo scrise ca `cod` inline. */
function inlinePaths(md) {
  const out = []
  for (const m of withoutFences(md).matchAll(/`([^`\n]+)`/g)) {
    let token = m[1].trim()
    if (/[\s*<>{}…]/.test(token)) continue
    token = token.replace(/:\d+(-\d+)?$/, '').replace(/[.,;)]+$/, '')
    const top = token.split('/')[0]
    if (!token.includes('/') || !REPO_DIRS.includes(top)) continue
    out.push(token)
  }
  return out
}

/** Fișierele dintr-un arbore desenat cu ├── / └── într-un bloc ```. */
function treePaths(md) {
  const out = []
  for (const block of md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const lines = block[1].split('\n')
    if (!lines.some((l) => /[├└]── /.test(l))) continue
    let base = null
    let dirs = []
    for (const raw of lines) {
      const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '')
      if (!line) continue
      const rootMatch = line.match(/^([\w.@-][\w.@/-]*\/)$/)
      if (rootMatch) {
        base = rootMatch[1].replace(/\/$/, '')
        dirs = []
        continue
      }
      const m = line.match(/^((?:│ {3}| {4})*)[├└]── (\S+)$/)
      if (!m || base === null) continue
      const depth = m[1].length / 4
      const name = m[2]
      dirs = dirs.slice(0, depth)
      const rel = [base, ...dirs, name.replace(/\/$/, '')].join('/')
      out.push(rel)
      if (name.endsWith('/')) dirs[depth] = name.replace(/\/$/, '')
    }
  }
  return out
}

/** Escape-urile externe (apeluri `or [public.]f(`) din definiția VIE a unei funcții. */
function liveFunnelEscapes(fnName) {
  const dir = 'supabase/migrations'
  const files = fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\s*\\(`, 'i')
  let last = null
  for (const f of files) if (re.test(read(`${dir}/${f}`))) last = f
  assert.ok(last, `nicio migrație nu definește public.${fnName}`)
  const sql = read(`${dir}/${last}`)
  const start = sql.search(re)
  const bodyStart = sql.indexOf('$$', start)
  const bodyEnd = sql.indexOf('$$', bodyStart + 2)
  const body = sql.slice(bodyStart + 2, bodyEnd).replace(/--[^\n]*/g, '')
  const names = new Set()
  for (const m of body.matchAll(/\bor\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (m[1].toLowerCase() !== 'exists') names.add(m[1])
  }
  return { file: last, names }
}

/** Identificatorii snake_case dintr-un text (nu părți de căi sau de nume de fișier). */
function snakeIdentifiers(text) {
  const ids = new Set()
  for (const m of text.matchAll(/(?<![\w./-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w-])/g))
    ids.add(m[0])
  return [...ids].sort()
}

/** Tot codul din CODE_DIRS, concatenat (fără .md, fără node_modules, fără acest test). */
function codeCorpus() {
  const parts = []
  const walk = (abs) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue
      const full = path.join(abs, ent.name)
      if (ent.isDirectory()) walk(full)
      else {
        const rel = path.relative(ROOT, full).split(path.sep).join('/')
        if (rel === SELF || /\.md$/i.test(rel)) continue
        if (!/\.(sql|ts|tsx|js|mjs|cjs|json|ya?ml|toml|sh|css|html)$/i.test(rel)) continue
        parts.push(fs.readFileSync(full, 'utf8'))
      }
    }
  }
  for (const dir of CODE_DIRS) if (exists(dir)) walk(path.join(ROOT, dir))
  return parts.join('\n')
}

describe('documentele din rădăcină', () => {
  it('DOC1: în rădăcină stau doar documentele vii din registru', () => {
    const rootMd = fs
      .readdirSync(ROOT)
      .filter((f) => /\.md$/i.test(f))
      .sort()
    assert.deepEqual(
      rootMd,
      ROOT_DOCS,
      'Documentele .md din rădăcină diferă de registru. Notele de versiune istorice ' +
        'merg în docs/archive/ (cu banner), un document nou viu intră în ROOT_DOCS.',
    )
  })

  it('DOC2: un singur bot de dependențe (Dependabot), fără configurație Renovate', () => {
    assert.ok(exists('.github/dependabot.yml'), '.github/dependabot.yml lipsește')
    const renovate = RENOVATE_CONFIGS.filter(exists)
    assert.deepEqual(renovate, [], 'configurație Renovate lângă Dependabot')
    const pkg = JSON.parse(read('package.json'))
    assert.equal(pkg.renovate, undefined, 'cheia „renovate” din package.json')
  })

  it('DOC3: căile scrise în documentele vii există', () => {
    const missing = []
    let seen = 0
    for (const doc of LIVING_DOCS) {
      for (const rel of inlinePaths(read(doc))) {
        seen++
        if (!exists(rel)) missing.push(`${doc}: ${rel}`)
      }
    }
    assert.ok(seen > 20, `prea puține căi găsite (${seen}) — extractorul e stricat?`)
    assert.deepEqual(missing, [])
  })

  it('DOC3b: fișierele din arborii desenați există', () => {
    const missing = []
    let seen = 0
    for (const doc of LIVING_DOCS) {
      for (const rel of treePaths(read(doc))) {
        seen++
        if (!exists(rel)) missing.push(`${doc}: ${rel}`)
      }
    }
    assert.ok(seen > 15, `prea puține intrări de arbore (${seen}) — parserul e stricat?`)
    assert.deepEqual(missing, [])
  })

  it('DOC3c: extractorii, pe text sintetic', () => {
    const md = [
      'Vezi `src/lib/features.ts:42`, `docs/RUNBOOK.md` și `orders.ts`.',
      'Comanda `npm run test` nu e o cale; nici `tests/sql/*.sql`.',
      '```',
      'supabase link `src/ignored-in-fence.ts`',
      '```',
      '```',
      'src/',
      '├── hooks/',
      '│   └── useOrders.ts         # comentariu',
      '└── lib/',
      '    └── supabase.ts',
      'netlify/functions/',
      '└── health.js',
      '```',
    ].join('\n')
    assert.deepEqual(inlinePaths(md), ['src/lib/features.ts', 'docs/RUNBOOK.md'])
    assert.deepEqual(treePaths(md), [
      'src/hooks',
      'src/hooks/useOrders.ts',
      'src/lib',
      'src/lib/supabase.ts',
      'netlify/functions/health.js',
    ])
  })

  it('DOC4: ARCHITECTURE.md numește exact escape-urile din funelul VIU', () => {
    const live = new Set()
    const sources = []
    for (const fn of ['is_admin', 'is_member']) {
      const { file, names } = liveFunnelEscapes(fn)
      sources.push(`${fn}@${file}`)
      for (const n of names) live.add(n)
    }
    assert.ok(live.has('is_platform_admin'), 'escape-ul fondatorului lipsește din funel?')
    const line = read('ARCHITECTURE.md')
      .split('\n')
      .find((l) => l.includes('Escape-uri externe din funel, azi:'))
    assert.ok(line, 'ARCHITECTURE.md: lipsește rândul „Escape-uri externe din funel, azi:”')
    const documented = new Set([...line.matchAll(/`([a-z_][a-z0-9_]*)\(\)`/gi)].map((m) => m[1]))
    assert.deepEqual(
      [...documented].sort(),
      [...live].sort(),
      `funelul din doc ≠ funelul din ${sources.join(', ')}`,
    )
  })

  it('DOC5: cine pomenește „SQL Editor” trimite și la aplicarea automată pe producție', () => {
    assert.ok(exists('.github/workflows/apply-prod-migrations.yml'))
    const bad = [...LIVING_DOCS, '.github/pull_request_template.md'].filter((doc) => {
      const text = read(doc)
      return /SQL Editor/i.test(text) && !text.includes('apply-prod-migrations')
    })
    assert.deepEqual(bad, [])
  })

  it('DOC6: identificatorii din documentele vii există în cod', () => {
    const corpus = codeCorpus()
    const inCode = (id) => new RegExp(`(?<![\\w])${id}(?![\\w])`).test(corpus)
    const missing = []
    let seen = 0
    for (const doc of LIVING_DOCS) {
      for (const id of snakeIdentifiers(read(doc))) {
        seen++
        if (Object.prototype.hasOwnProperty.call(PLANNED_IDENTIFIERS, id)) continue
        if (!inCode(id)) missing.push(`${doc}: ${id}`)
      }
    }
    assert.ok(seen > 100, `prea puțini identificatori găsiți (${seen}) — extractorul e stricat?`)
    assert.ok(inCode('open_table_session'), 'corpusul de cod nu vede migrațiile?')
    assert.deepEqual(missing, [])
    for (const [id, why] of Object.entries(PLANNED_IDENTIFIERS)) {
      assert.ok(why.length > 10, `${id}: scutire fără motiv`)
      assert.ok(!inCode(id), `${id} există acum în cod — scoate-l din PLANNED_IDENTIFIERS`)
    }
  })
})
