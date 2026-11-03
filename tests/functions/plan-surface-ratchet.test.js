// tests/functions/plan-surface-ratchet.test.js
// CLICHET: ce vede fiecare plan în panou se decide ÎNTR-UN SINGUR LOC —
// `planSurface(features)` din src/lib/planSurface.ts (lotul P, nov 2026).
//
// Decizia fondatorului: planurile inferioare nu văd nimic din cele superioare
// („ce treabă avem cu date de fiscalizare pe al doilea plan, nu mai zic de
// primul"), cu UN SINGUR upsell. Auditul a găsit pragurile scrise de mână în
// fiecare tab (`planTier(plan) >= 2`, `tier >= 3`, `money >= 3`, `tier === 1`),
// fiecare cu propria idee despre ce e „Plan 2": cotele TVA apăreau pe toate
// planurile, ridicarea și extra-urile pe Planul 1, „Brand nedefinit" pe Planul 2.
// Un prag nou scris de mână e exact felul în care s-ar întoarce.
//
//   PR0  CONTROL POZITIV pe linii SINTETICE: fiecare formă interzisă e prinsă
//        (apel `planTier(`/`moneyTier(`/`surfaceTiers(`, comparație a unui
//        `…tier…`/`money` cu 1–3, în ambele sensuri, inclusiv într-un comentariu
//        JSX `{/* … */}` lipit de cod), iar formele legitime NU (citirea
//        `surface?.vat`, `minTier: 2` din NAV_GROUPS, comparația cu
//        `st.minTier`, comentariile `//` și cele cu „≥"). Fără el, un regex
//        stricat ar face PR1 verde pe orice cod.
//   PR1  nicio linie din src/components și src/pages (fără teste) nu poartă o
//        formă interzisă în afara registrului ALLOWED.
//        Mutația care îl pică: readuci `{planTier(plan) >= 2 && (` în
//        SettingsTab, `const isFiscal = tier != null && tier >= 3` în HomeTab
//        sau `fiscalReports={money >= 3}` în DashboardPage.
//   PR2  registrul e ONEST: fiecare intrare se potrivește pe o linie care chiar
//        e prinsă (o scutire care nu mai acoperă nimic pică — tiparul DC1b/RM2).
//        Mutația care îl pică: o intrare rămasă după migrarea liniei ei.
//   PR3  sursa unică există și e citită: planSurface.ts exportă `planSurface`
//        și `planUpsellTarget`, iar tab-urile migrate (DashboardPage, HomeTab,
//        SettingsTab, ProductsTab, WaiterPage) le importă. Fără el, ștergerea
//        sursei unice ar lăsa PR1 verde (nimic de prins = nimic de migrat).
//
// Rulează în jobul „Bridge tests" (`cd tests/functions && npm test`); vitest
// nu vede tests/functions.
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const DIRS = ['src/components', 'src/pages']

const RULES = [
  {
    name: 'apel planTier/moneyTier/surfaceTiers',
    test: (l) => /\b(?:planTier|moneyTier|surfaceTiers)\s*\(/.test(l),
  },
  {
    name: 'prag de tier scris de mână',
    test: (l) =>
      /\b(?:\w*[tT]ier\w*|money)\s*(?:>=|<=|===|!==|==|!=|>|<)\s*[1-3]\b/.test(l) ||
      /\b[1-3]\s*(?:>=|<=|===|!==|==|!=|>|<)\s*(?:\w*[tT]ier\w*|money)\b/.test(l),
  },
]

function violations(line) {
  // Comentariile `//` și rândurile de bloc (` * …`) nu sunt cod. Un comentariu
  // JSX `{/* … */}` pe același rând cu codul rămâne scanat — cine scrie
  // pragul acolo îl scrie de obicei și în cod.
  const code = line.replace(/\/\/.*$/, '')
  if (/^\s*\*/.test(code) || /^\s*\/\*/.test(code)) return []
  return RULES.filter((r) => r.test(code)).map((r) => r.name)
}

// Scutiri: fișier + fragment EXACT de pe linie → motiv. Cazurile EXISTENTE pe
// care lotul P nu le migrează, fiecare cu motivul lui.
const ALLOWED = [
  {
    file: 'src/pages/DashboardPage.tsx',
    contains: 'const { general: tier, money } = surfaceTiers(features.features)',
    reason:
      'filtrul NAV_GROUPS (minTier/money pe sub-tab-uri) — reorganizarea navigării e lotul R2; tab-urile citesc planSurface',
  },
  {
    file: 'src/components/LoyaltySettingsCard.tsx',
    contains: 'const eligible = planTier(plan) >= 2',
    reason:
      'starea internă de lacăt a cardului; din lotul P SettingsTab îl montează doar cu planSurface.ordering, deci lacătul nu mai e vizibil',
  },
]

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(rel))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(rel)
    }
  }
  return out
}

function scan() {
  const hits = []
  for (const dir of DIRS) {
    for (const file of sourceFiles(dir)) {
      fs.readFileSync(path.join(ROOT, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const v = violations(line)
          if (v.length) hits.push({ file, line: line.trim(), where: `${file}:${i + 1}`, rules: v })
        })
    }
  }
  return hits
}

describe('clichet: ce vede planul vine din planSurface', () => {
  it('PR0 control pozitiv: scannerul prinde pragurile scrise de mână și le lasă pe cele legitime', () => {
    const caught = [
      '{planTier(plan) >= 2 && (',
      '  const isFiscal = tier != null && tier >= 3',
      '<ReportsTab restaurantId={restaurant.id} fiscalReports={money >= 3} />',
      "desc: tier >= 3 ? 'Preluare manuală + plăți la masă' : 'x',",
      '{isOwner && tier === 1 && (',
      'const ok = moneyTier(features) >= 3',
      'const t = planTier(plan)',
      'const { general } = surfaceTiers(f)',
      'if (3 <= planTierValue) return',
      'const eligible = currentTier > 1',
      '<X /> {/* gate: tier >= 2 */}',
    ]
    for (const l of caught) assert.ok(violations(l).length > 0, `ar trebui prinsă: ${l}`)
    const fine = [
      "{surface?.vat === true && (",
      "const hasOrdering = surface?.ordering === true",
      "{ id: 'modificatori', label: 'Opțiuni produse', minTier: 2 },",
      'if (st.minTier && (st.money ? moneyTierValue : tier) < st.minTier) return false',
      '(!g.minTier || tier >= g.minTier) &&',
      '// tier 2 — Meniu + Comenzi:  + Comenzi, Rapoarte',
      '//   planTier(plan) >= 2 era vechiul cod',
      ' * moneyTier(features) >= 3 — comentariu de bloc',
      '{/* Abonament & facturare — ORICE plan (tier ≥ 1 = toate). */}',
      "const label = PLAN_LABELS[plan] || plan",
    ]
    for (const l of fine) assert.deepEqual(violations(l), [], `nu trebuie prinsă: ${l}`)
  })

  it('PR1 niciun prag de plan scris de mână în afara registrului', () => {
    const hits = scan().filter(
      (h) => !ALLOWED.some((a) => a.file === h.file && h.line.includes(a.contains)),
    )
    assert.deepEqual(
      hits.map((h) => `${h.where}  [${h.rules.join(', ')}]  ${h.line}`),
      [],
      'Prag de plan scris de mână într-un tab. Citește din planSurface(features) ' +
        '(src/lib/planSurface.ts) — adaugă acolo o cheie dacă lipsește — sau, dacă ' +
        'cazul e chiar legitim, adaugă-l în ALLOWED cu motiv.',
    )
  })

  it('PR2 registrul de scutiri nu conține intrări moarte', () => {
    const hits = scan()
    for (const a of ALLOWED) {
      assert.ok(
        hits.some((h) => h.file === a.file && h.line.includes(a.contains)),
        `scutirea „${a.contains}" din ${a.file} nu mai acoperă nicio linie prinsă — scoate-o`,
      )
    }
  })

  it('PR3 sursa unică există și tab-urile o citesc', () => {
    const lib = fs.readFileSync(path.join(ROOT, 'src/lib/planSurface.ts'), 'utf8')
    assert.match(lib, /^export function planSurface\(/m)
    assert.match(lib, /^export function planUpsellTarget\(/m)
    for (const file of [
      'src/pages/DashboardPage.tsx',
      'src/pages/WaiterPage.tsx',
      'src/components/_dashboard/HomeTab.tsx',
      'src/components/SettingsTab.tsx',
      'src/components/ProductsTab.tsx',
    ]) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      assert.match(src, /from '\.\.\/(?:\.\.\/)?lib\/planSurface'/, `${file} nu citește planSurface`)
    }
  })
})
