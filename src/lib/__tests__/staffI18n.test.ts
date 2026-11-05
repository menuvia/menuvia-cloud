// src/lib/__tests__/staffI18n.test.ts — clichetele limbilor PERSONALULUI
// (Partea II, lotul L0b). Cinci, de la dicționar la sursă:
//   SK1  fiecare namespace din `src/i18n/ns/` are ro + en + fr + de + index,
//        cu EXACT aceleași chei, același tip (text / plural) și texte ne-goale
//        (tipul `Translation` le prinde la compilare; aici rămân prinse și
//        când cineva ocolește tipul cu un cast).
//   SK2  locurile `{x}` sunt aceleași în toate limbile (un „{name}” uitat ar
//        apărea pe ecran ca atare).
//   SK3  formele de plural sunt EXACT categoriile limbii după `Intl.PluralRules`
//        (ro: one/few/other, fr: one/many/other) — o formă lipsă ar cădea
//        tăcut pe `other`, una în plus nu s-ar afișa niciodată.
//   SK4  dicționarele personalului NU intră în graful STATIC al intrării
//        aplicației și al paginilor oaspetelui (meniul QR rămâne mic), cu
//        control pozitiv: graful intrării chiar ajunge la UiLangContext, cel al
//        unui namespace ajunge la `ro.ts`, dar nu la `en.ts` (leneș), iar
//        parserul (TypeScript, nu regex) prinde formele care păcăleau regex-ul.
//   SK5  textul scris direct în componentele personalului e VIZIBIL în review:
//        numărul per fișier e egal cu `staffI18n.baseline.ts`. Scade → se
//        coboară baseline-ul în același PR (câștigul se blochează); crește →
//        testul pică, iar creșterea e permisă DOAR cu baseline ridicat în
//        același PR și motivul scris în descriere (un fișier încă nemigrat care
//        primește o funcție nouă). Nu e o barieră, e un contor care nu poate
//        crește pe tăcute. Controlul pozitiv e pe scaner.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { STAFF_LANGS } from '../../i18n/langs'
import type { Dict, Plural } from '../../i18n/core'
import { GUEST_FILES, listStaffFiles, scanSource } from './visibleTextScanner'
import { STAFF_TEXT_BASELINE } from './staffI18n.baseline'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const NS_DIR = 'src/i18n/ns'

const modules = import.meta.glob<{ default?: Dict }>('../../i18n/ns/*/*.ts', { eager: true })
function nsModule(ns: string, file: string): { default?: Dict } | undefined {
  return modules[`../../i18n/ns/${ns}/${file}.ts`]
}
const NAMESPACES = readdirSync(resolve(ROOT, NS_DIR), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

const placeholders = (v: string | Plural): string[] =>
  [...new Set((typeof v === 'string' ? [v] : Object.values(v)).join(' ').match(/\{\w+\}/g) ?? [])].sort()

describe('dicționarele personalului', () => {
  it('SK1 fiecare namespace: patru limbi, aceleași chei și tipuri, texte ne-goale', () => {
    expect(NAMESPACES.length).toBeGreaterThan(0)
    const problems: string[] = []
    for (const ns of NAMESPACES) {
      if (!nsModule(ns, 'index')) problems.push(`${ns}: lipsește index.ts`)
      const ro = nsModule(ns, 'ro')?.default
      if (!ro) {
        problems.push(`${ns}: lipsește ro.ts (sursa)`)
        continue
      }
      const roKeys = Object.keys(ro).sort()
      for (const lang of STAFF_LANGS) {
        const d = nsModule(ns, lang)?.default
        if (!d) {
          problems.push(`${ns}/${lang}: lipsește`)
          continue
        }
        if (JSON.stringify(Object.keys(d).sort()) !== JSON.stringify(roKeys)) problems.push(`${ns}/${lang}: alte chei decât ro`)
        for (const k of roKeys) {
          const v = d[k]
          if (typeof v !== typeof ro[k]) problems.push(`${ns}/${lang}.${k}: alt tip decât în ro`)
          const texts = typeof v === 'string' ? [v] : v ? Object.values(v) : []
          if (texts.length === 0 || texts.some((x) => typeof x !== 'string' || !x.trim()))
            problems.push(`${ns}/${lang}.${k}: text gol`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('SK2 locurile {x} sunt aceleași în toate limbile', () => {
    const problems: string[] = []
    for (const ns of NAMESPACES) {
      const ro = nsModule(ns, 'ro')?.default ?? {}
      for (const lang of STAFF_LANGS) {
        const d = nsModule(ns, lang)?.default ?? {}
        for (const k of Object.keys(ro)) {
          if (!d[k]) continue
          const a = placeholders(ro[k])
          const b = placeholders(d[k])
          if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${ns}/${lang}.${k}: ${b.join(',')} ≠ ${a.join(',')}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('SK3 pluralul are exact categoriile limbii', () => {
    const problems: string[] = []
    let plurals = 0
    for (const ns of NAMESPACES) {
      for (const lang of STAFF_LANGS) {
        const want = [...new Intl.PluralRules(lang).resolvedOptions().pluralCategories].sort()
        const d = nsModule(ns, lang)?.default ?? {}
        for (const [k, v] of Object.entries(d)) {
          if (typeof v === 'string') continue
          plurals++
          const got = Object.keys(v).sort()
          if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${ns}/${lang}.${k}: ${got.join(',')} ≠ ${want.join(',')}`)
        }
      }
    }
    // Anti-vacuitate: `common.items_count` există în toate cele patru limbi.
    expect(plurals).toBeGreaterThanOrEqual(STAFF_LANGS.length)
    expect(problems).toEqual([])
  })
})

// ── Graful de importuri STATICE (import()/lazy nu se urmează) ────────────
// Parserul TypeScript, nu un regex (recenzia L0b: un `export type … = { … }`
// urmat de un import pe linia următoare era citit ca un singur import de tip,
// iar importul real dispărea din graf). Muchie = `import … from` / `export … from`
// / importul de efect, cu excepția celor ȘTERSE la compilare (`import type`,
// `export type`, sau doar specificatori `type`). `import()` e o expresie, nu o
// declarație de nivel superior, deci nu se urmează — exact granița lazy.
function staticSpecs(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause
      if (clause?.isTypeOnly) continue
      const named = clause?.namedBindings
      const onlyTypes =
        clause !== undefined &&
        !clause.name &&
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((e) => e.isTypeOnly)
      if (!onlyTypes) out.push(st.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      if (!st.isTypeOnly) out.push(st.moduleSpecifier.text)
    }
  }
  return out
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}` // alias-ul din tsconfig (`@/*` → `./src/*`)
  else if (spec.startsWith('.')) base = join(dirname(fromFile), spec)
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(cand) && existsSync(resolve(ROOT, cand))) return cand
  }
  return null
}

function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop() as string
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(resolve(ROOT, f), 'utf8')
    for (const spec of staticSpecs(f, src)) {
      const next = resolveImport(f, spec)
      if (next && !seen.has(next)) stack.push(next)
    }
  }
  return seen
}

describe('dicționarele personalului nu intră în intrare și la oaspete', () => {
  const guestPages = GUEST_FILES.filter((f) => f.startsWith('src/pages/'))

  it('SK4 control pozitiv: graful urmează importurile statice, nu și pe cele leneșe', () => {
    const entry = staticClosure('src/main.tsx')
    expect(entry.has('src/App.tsx')).toBe(true)
    expect(entry.has('src/i18n/UiLangContext.tsx')).toBe(true)
    const ns = staticClosure('src/i18n/ns/common/index.ts')
    expect(ns.has('src/i18n/ns/common/ro.ts')).toBe(true)
    expect(ns.has('src/i18n/ns/common/en.ts')).toBe(false)
    expect(guestPages.length).toBeGreaterThanOrEqual(3)
    // Parserul, pe formele care păcăleau regex-ul: tip pe mai multe linii urmat
    // de import, comentariu înaintea importului, alias `@/`, plus ce NU e muchie.
    const sample = [
      'export type Row = {',
      '  id: number',
      '}',
      "import { commonNs } from './a'",
      "/* c */ import b from './b'",
      "import '@/c'",
      "import type { T } from './t1'",
      "import { type U, type V } from './t2'",
      "export type { W } from './t3'",
      "export * from './d'",
      "const L = lazy(() => import('./lazy'))",
    ].join('\n')
    expect(staticSpecs('x.tsx', sample)).toEqual(['./a', './b', '@/c', './d'])
  })

  it('SK4 intrarea și paginile oaspetelui nu ating src/i18n/ns', () => {
    const offenders: string[] = []
    for (const start of ['src/main.tsx', ...guestPages]) {
      for (const f of staticClosure(start)) if (f.startsWith(`${NS_DIR}/`)) offenders.push(`${start} → ${f}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('textul scris direct în ecranele personalului doar scade', () => {
  const files = listStaffFiles(ROOT)
  const counts = new Map(files.map((f) => [f, scanSource(f, readFileSync(resolve(ROOT, f), 'utf8')).length]))

  it('SK5 control pozitiv: scanerul vede fișierele și textul lor', () => {
    expect(files.length).toBeGreaterThan(80)
    expect(files.some((f) => GUEST_FILES.includes(f))).toBe(false)
    expect(files.some((f) => f.includes('__tests__') || f.startsWith(`${NS_DIR}/`))).toBe(false)
    const sample = "export const X = () => <button aria-label=\"Închide\">Salvează</button>\nconst ok = t('save')"
    expect(scanSource('x.tsx', sample).map((h) => h.text)).toEqual(['Închide', 'Salvează'])
  })

  it('SK5 numărul per fișier = baseline (crește → prin useT; scade → coboară baseline-ul)', () => {
    const drift: string[] = []
    for (const [f, n] of counts) {
      const want = STAFF_TEXT_BASELINE[f] ?? 0
      if (n !== want) drift.push(`  '${f}': ${n},   // baseline ${want}${n > want ? ' — text NOU scris direct: folosește useT' : ' — coboară baseline-ul'}`)
    }
    for (const f of Object.keys(STAFF_TEXT_BASELINE)) {
      if (!counts.has(f)) drift.push(`  '${f}' — nu mai există (sau a devenit al oaspetelui): scoate-l din baseline`)
    }
    expect(drift).toEqual([])
  })
})
