// Clichete de CLASĂ pe apelurile `track()` din src/. Sursa se citește cu
// parserul TypeScript (expresii de apel din AST), NU cu regex — recenzia
// CodeRabbit pe #385: un apel COMENTAT se număra ca emițător, o cheie CALCULATĂ
// (`['customer_phone']: p`) trecea nevăzută de AE2/AE7, iar importul DINAMIC al
// modulului (`await import('../lib/analytics')` + `analytics.track(…)`) nu se
// vedea deloc. Comentariile și șirurile nu mai pot produce (sau ascunde) apeluri.
//   AE0  anti-vacuitate: uniunea și apelurile chiar se citesc.
//   AE1  fiecare membru `AppEvent` are cel puțin un `track()` real în afara
//        lib/analytics.ts și a testelor — un nume fără emițător e un grafic gol
//        în PostHog care arată exact ca „zero utilizatori”. Mutațiile care pică:
//        un membru nou în uniune, fără apel; ștergerea SAU comentarea apelului unic.
//   AE2  proprietățile sunt absente sau un OBIECT LITERAL (fără variabile, fără
//        spread), iar nicio cheie nu e din clasa PII (e-mail, telefon, nume,
//        client, note, adresă, token, cod, parolă, CUI, IP…). O cheie calculată
//        se REZOLVĂ când e statică (literal, șablon fără variabile, concatenare,
//        `const` din același fișier) și PICĂ atunci când nu se poate afla static.
//        Mutațiile care pică: `{ customer_phone }`, `{ ['customer_phone']: p }`,
//        `{ [k]: v }`, `{ ...order }`, `track('x', props)`.
//   AE3  primul argument e un literal de șir (altfel AE1/AE2 ar fi orbi), iar
//        funcția `track` și modulul analytics nu circulă ca VALOARE (`const t =
//        track`, `onClick={track}`, modulul dat altei funcții, un import cu
//        specificator nedeterminabil) — un apel prin alias ar ocoli AE1/AE2.
//   AE4  control POZITIV: parserul prinde fiecare formă interzisă pe un eșantion.
//   AE5  fiecare scutire din registrul de chei e încă folosită.
//   AE6  suprafața OASPEȚILOR (GUEST_FILES, aceeași listă ca GI2) nu emite și nu
//        importă analytics — nici static, nici DINAMIC, nici prin re-export:
//        acolo Menuvia e persoana împuternicită a restaurantului, iar DPA-ul
//        (menuvia-pack/05 §3.4 + Anexa 2) nu cunoaște PostHog (PH-DPA-1).
//        Mutațiile care pică: `track('reservation_created', …)` readus în
//        ReservationSheet; `await import('../lib/analytics')` într-o pagină de
//        oaspete. Ramurile qr/pickup ale `createOrder` le ține comportamental
//        OA1–OA3 (orders-analytics.test.ts).
//   AE7  catalogul (docs/ANALYTICS_EVENTS.md) e EGAL cu codul: aceleași
//        evenimente ca uniunea și, pe fiecare, exact cheile literale din
//        apelurile `track()` (BV11 — documentația care minte); un rând DUPLICAT
//        pică cu numele evenimentului (altfel al doilea l-ar suprascrie tăcut pe
//        primul). Mutațiile care pică: un eveniment nou fără rând în tabel, o
//        cheie nouă nedocumentată, un rând copiat de două ori.
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import * as ts from 'typescript'
import { describe, it, expect } from 'vitest'
import { GUEST_FILES } from './visibleTextScanner'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')
const ANALYTICS = 'src/lib/analytics.ts'
const ANALYTICS_MODULE = 'src/lib/analytics'
const CATALOG = 'docs/ANALYTICS_EVENTS.md'

// Clasa PII: potrivire pe cheia normalizată (litere mici).
const FORBIDDEN_KEY_RES: readonly RegExp[] = [
  /e-?mail/,
  /phone|telefon|^tel$|mobile/,
  /name|nume/,
  /^customer|^client|^guest_|^oaspete/,
  /^note|^notes$|comment|request|message|mesaj/,
  /address|adres|street|strada|city|oras/,
  /token|secret|password|parol|passwd/,
  /(^|_)code$|^cod$/,
  /^cif$|^cui$|iban|vat_?id/,
  /^ip$|ip_?address|user_?agent/,
  /birth|nastere|cnp/,
]

// Scutiri: chei care SEAMĂNĂ cu clasa PII dar nu poartă date personale. CU
// MOTIV; fiecare trebuie încă folosită (AE5), altfel registrul putrezește.
const ALLOWED_KEYS: ReadonlyArray<{ key: string; reason: string }> = [
  {
    key: 'email_confirmation_required',
    reason: 'boolean: contul nou cere confirmarea e-mailului — nu adresa',
  },
]

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase()
  if (ALLOWED_KEYS.some((a) => a.key === k)) return false
  return FORBIDDEN_KEY_RES.some((re) => re.test(k))
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** Membrii uniunii `AppEvent`, citiți din sursă. */
function appEventMembers(src: string): string[] {
  const m = /export type AppEvent =([\s\S]*?)\n\n/.exec(src)
  if (!m) return []
  return Array.from(m[1].matchAll(/'([a-z0-9_]+)'/g), (x) => x[1])
}

// ── Scanerul (AST) ───────────────────────────────────────────────────────

/** Specificatorul duce la src/lib/analytics(.ts)? Relativ la fișier sau prin alias-ul `@/`. */
function isAnalyticsSpecifier(file: string, spec: string): boolean {
  let p: string
  if (spec.startsWith('@/')) p = `src/${spec.slice(2)}`
  else if (spec.startsWith('.')) p = posix.normalize(posix.join(posix.dirname(file), spec))
  else return false
  return p.replace(/\.(?:ts|tsx|js|mjs)$/, '').replace(/\/index$/, '') === ANALYTICS_MODULE
}

/** Ambalajele care nu schimbă valoarea: paranteze, `as`, `!`, `satisfies`, `<T>x`. */
function isWrapper(
  n: ts.Node,
): n is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.NonNullExpression
  | ts.SatisfiesExpression
  | ts.TypeAssertion {
  return (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n)
  )
}

function unwrap(e: ts.Expression): ts.Expression {
  return isWrapper(e) ? unwrap(e.expression) : e
}

/** Primul părinte care nu e un ambalaj (și nici `await`, când `throughAwait`). */
function outerUse(node: ts.Node, throughAwait: boolean): { child: ts.Node; parent: ts.Node } {
  let child = node
  let parent = node.parent
  while (isWrapper(parent) || (throughAwait && ts.isAwaitExpression(parent))) {
    child = parent
    parent = parent.parent
  }
  return { child, parent }
}

/** Declarațiile `const` cu nume simplu; `null` = numele e declarat de mai multe ori (ambiguu). */
type ConstMap = ReadonlyMap<string, ts.Expression | null>

function constInitializers(nodes: readonly ts.Node[]): ConstMap {
  const out = new Map<string, ts.Expression | null>()
  for (const n of nodes) {
    let name: string | null = null
    let init: ts.Expression | null = null
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      name = n.name.text
      if (n.initializer && (ts.getCombinedNodeFlags(n) & ts.NodeFlags.Const) !== 0)
        init = n.initializer
    } else if ((ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name)) {
      name = n.name.text
    }
    if (name !== null) out.set(name, out.has(name) ? null : init)
  }
  return out
}

/** Valoarea unei expresii-șir, dacă se poate afla STATIC din fișier; altfel `null`. */
function staticString(e: ts.Expression, consts: ConstMap, depth = 0): string | null {
  if (depth > 8) return null
  const x = unwrap(e)
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text
  if (ts.isTemplateExpression(x)) {
    let out = x.head.text
    for (const span of x.templateSpans) {
      const v = staticString(span.expression, consts, depth + 1)
      if (v === null) return null
      out += v + span.literal.text
    }
    return out
  }
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = staticString(x.left, consts, depth + 1)
    const r = staticString(x.right, consts, depth + 1)
    return l !== null && r !== null ? l + r : null
  }
  if (ts.isIdentifier(x)) {
    const init = consts.get(x.text)
    return init ? staticString(init, consts, depth + 1) : null
  }
  return null
}

/** Cheia unei proprietăți / a unui acces `o[k]`, ca în JS (`1` → '1'); `null` = nedeterminabilă. */
function staticKeyExpr(e: ts.Expression, consts: ConstMap): string | null {
  const x = unwrap(e)
  return ts.isNumericLiteral(x) ? String(Number(x.text)) : staticString(x, consts)
}

function staticKey(name: ts.PropertyName, consts: ConstMap): string | null {
  if (ts.isComputedPropertyName(name)) return staticKeyExpr(name.expression, consts)
  if (ts.isNumericLiteral(name)) return String(Number(name.text))
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return null
}

const SPREAD = 'spread în proprietăți'

function objectKeys(
  obj: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
  consts: ConstMap,
): { keys: string[]; problems: string[] } {
  const keys: string[] = []
  const problems: string[] = []
  for (const m of obj.properties) {
    if (ts.isSpreadAssignment(m)) {
      if (!problems.includes(SPREAD)) problems.push(SPREAD)
      continue
    }
    const k = ts.isShorthandPropertyAssignment(m) ? m.name.text : staticKey(m.name, consts)
    if (k === null) problems.push(`cheie calculată nedeterminabilă static: ${m.name.getText(sf)}`)
    else keys.push(k)
  }
  return { keys, problems }
}

function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  )
}

/** Domeniul unei legături: funcția (sau blocul, pentru let/const) care o conține. */
function scopeOf(decl: ts.Node): ts.Node {
  const blockScoped =
    ts.isVariableDeclaration(decl) &&
    (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.BlockScoped) !== 0
  let a: ts.Node = decl.parent
  while (!ts.isSourceFile(a)) {
    if (isFunctionLike(a)) return a
    if (
      blockScoped &&
      (ts.isBlock(a) ||
        ts.isForStatement(a) ||
        ts.isForOfStatement(a) ||
        ts.isForInStatement(a) ||
        ts.isCaseBlock(a))
    )
      return a
    a = a.parent
  }
  return a
}

/** Nume legate de ceva din analytics, fiecare cu domeniile lui (poziții în fișier). */
class Bindings {
  private readonly scopes = new Map<string, ts.Node[]>()
  add(name: string, scope: ts.Node): void {
    const list = this.scopes.get(name) ?? []
    if (!list.includes(scope)) list.push(scope)
    this.scopes.set(name, list)
  }
  has(id: ts.Identifier): boolean {
    return (this.scopes.get(id.text) ?? []).some((s) => id.pos >= s.pos && id.end <= s.end)
  }
  get size(): number {
    let n = 0
    for (const list of this.scopes.values()) n += list.length
    return n
  }
}

/** Identificatorul DECLARĂ un nume (nu îl folosește): import, destructurare, parametru, cheie. */
function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent
  // `{ track }` și `export { track }` FOLOSESC valoarea (o pun într-un obiect / o scot din fișier).
  if (ts.isShorthandPropertyAssignment(p) || ts.isExportSpecifier(p)) return false
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true
  if (ts.isBindingElement(p)) return p.name === id || p.propertyName === id
  // `<track …>` din JSX e elementul HTML, nu o referință.
  if (
    (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
    p.tagName === id
  )
    return true
  return 'name' in p && p.name === id
}

/** Identificatorul stă într-o poziție de TIP (`typeof analytics`, `analytics.AppEvent`) — șters la compilare. */
function inTypePosition(id: ts.Identifier): boolean {
  let a: ts.Node = id.parent
  while (ts.isQualifiedName(a)) a = a.parent
  return ts.isTypeNode(a)
}

interface TrackCall {
  file: string
  line: number
  event: string | null
  /** Cheile obiectului de proprietăți; `null` = fără proprietăți sau ne-literal (vezi `problems`). */
  keys: string[] | null
  problems: string[]
}

interface Violation {
  where: string
  why: string
}

interface FileScan {
  calls: TrackCall[]
  importsAnalytics: boolean
  /** Folosiri pe care scanerul nu le poate urmări (AE3): fiecare PICĂ. */
  problems: Violation[]
}

type ModuleKind = 'module' | 'promise' | null

function scanFile(file: string, src: string): FileScan {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const nodes: ts.Node[] = []
  const collect = (n: ts.Node): void => {
    nodes.push(n)
    ts.forEachChild(n, collect)
  }
  collect(sf)
  const consts = constInitializers(nodes)
  const where = (n: ts.Node): string =>
    `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const problems: Array<Violation & { pos: number }> = []
  const flag = (n: ts.Node, why: string): void => {
    problems.push({ pos: n.getStart(sf), where: where(n), why })
  }

  // 1. Referințele la modul: import static / re-export / import() / require().
  let importsAnalytics = false
  const promiseCalls = new Set<ts.Node>() // import('…analytics') — promisiunea modulului
  const moduleCalls = new Set<ts.Node>() // require('…analytics') — modulul
  const trackB = new Bindings() // nume legate de funcția `track`
  const moduleB = new Bindings() // nume legate de modul (namespace, import dinamic așteptat, parametrul din .then)
  const promiseB = new Bindings() // nume legate de promisiunea modulului
  for (const n of nodes) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!isAnalyticsSpecifier(file, n.moduleSpecifier.text)) continue
      importsAnalytics = true
      const clause = n.importClause
      if (clause?.name) moduleB.add(clause.name.text, sf)
      const named = clause?.namedBindings
      if (named && ts.isNamespaceImport(named)) moduleB.add(named.name.text, sf)
      else if (named) {
        for (const el of named.elements)
          if ((el.propertyName ?? el.name).text === 'track') trackB.add(el.name.text, sf)
      }
    } else if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      if (isAnalyticsSpecifier(file, n.moduleSpecifier.text)) importsAnalytics = true
    } else if (
      ts.isImportEqualsDeclaration(n) &&
      ts.isExternalModuleReference(n.moduleReference) &&
      ts.isStringLiteral(n.moduleReference.expression)
    ) {
      if (!isAnalyticsSpecifier(file, n.moduleReference.expression.text)) continue
      importsAnalytics = true
      moduleB.add(n.name.text, sf)
    } else if (ts.isCallExpression(n)) {
      const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword
      const required = ts.isIdentifier(n.expression) && n.expression.text === 'require'
      if (!dynamic && !required) continue
      const arg = n.arguments[0]
      const spec = arg ? staticString(arg, consts) : null
      if (spec === null) {
        flag(n, `import cu specificator nedeterminabil static: ${n.getText(sf)}`)
        continue
      }
      if (!isAnalyticsSpecifier(file, spec)) continue
      importsAnalytics = true
      if (dynamic) promiseCalls.add(n)
      else moduleCalls.add(n)
    }
  }

  const kindOf = (e: ts.Expression): ModuleKind => {
    const x = unwrap(e)
    if (promiseCalls.has(x)) return 'promise'
    if (moduleCalls.has(x)) return 'module'
    if (ts.isAwaitExpression(x)) return kindOf(x.expression) ? 'module' : null
    if (ts.isIdentifier(x)) return moduleB.has(x) ? 'module' : promiseB.has(x) ? 'promise' : null
    return null
  }

  const bindModule = (name: ts.BindingName, scope: ts.Node): void => {
    if (ts.isIdentifier(name)) {
      moduleB.add(name.text, scope)
      return
    }
    if (ts.isArrayBindingPattern(name)) {
      flag(name, 'destructurare de tablou din modulul analytics')
      return
    }
    for (const el of name.elements) {
      if (el.dotDotDotToken) {
        bindModule(el.name, scope) // restul obiectului = tot modulul
        continue
      }
      const prop = el.propertyName
        ? staticKey(el.propertyName, consts)
        : ts.isIdentifier(el.name)
          ? el.name.text
          : null
      if (prop === null) flag(el, `destructurare nedeterminabilă din analytics: ${el.getText(sf)}`)
      else if (prop === 'track') {
        if (ts.isIdentifier(el.name)) trackB.add(el.name.text, scope)
        else flag(el, `destructurare nedeterminabilă din analytics: ${el.getText(sf)}`)
      }
    }
  }

  // 2. Legăturile (punct fix: `const p = import(…)` → `const m = await p` → `m.track`).
  for (let round = 0; round < 8; round++) {
    const before = trackB.size + moduleB.size + promiseB.size
    for (const n of nodes) {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const k = kindOf(n.initializer)
        if (k === 'module') bindModule(n.name, scopeOf(n))
        else if (k === 'promise') {
          if (ts.isIdentifier(n.name)) promiseB.add(n.name.text, scopeOf(n))
          else flag(n, 'destructurarea promisiunii modulului analytics')
        }
      } else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left)
      ) {
        const k = kindOf(n.right)
        if (k === 'module') moduleB.add(n.left.text, sf)
        else if (k === 'promise') promiseB.add(n.left.text, sf)
      } else if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'then' &&
        kindOf(n.expression.expression) === 'promise'
      ) {
        const cb = n.arguments[0]
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          const p = cb.parameters[0]
          if (p) bindModule(p.name, cb)
        } else {
          flag(n, 'modulul analytics dat unei funcții necunoscute (.then)')
        }
      }
    }
    if (trackB.size + moduleB.size + promiseB.size === before) break
  }

  // 3. Apelurile: `track(…)` (sau aliasul importat), `analytics.track(…)`, `analytics['track'](…)`.
  const isTrackCallee = (callee: ts.Expression): boolean => {
    const x = unwrap(callee)
    if (ts.isIdentifier(x)) return x.text === 'track' || trackB.has(x)
    if (ts.isPropertyAccessExpression(x))
      return x.name.text === 'track' && kindOf(x.expression) === 'module'
    if (ts.isElementAccessExpression(x))
      return (
        kindOf(x.expression) === 'module' && staticKeyExpr(x.argumentExpression, consts) === 'track'
      )
    return false
  }
  const calls: TrackCall[] = []
  for (const n of nodes) {
    if (!ts.isCallExpression(n) || !isTrackCallee(n.expression)) continue
    const [first, second] = n.arguments
    const event =
      first &&
      (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
      /^[a-z0-9_]+$/.test(first.text)
        ? first.text
        : null
    const callProblems: string[] = []
    if (event === null) callProblems.push('evenimentul nu e un literal de șir')
    let keys: string[] | null = null
    if (second) {
      const obj = ts.isSpreadElement(second) ? null : unwrap(second)
      if (obj && ts.isObjectLiteralExpression(obj)) {
        const r = objectKeys(obj, sf, consts)
        keys = r.keys
        callProblems.push(...r.problems)
      } else {
        callProblems.push(`proprietățile nu sunt un obiect literal: ${second.getText(sf)}`)
      }
    }
    calls.push({
      file,
      line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      event,
      keys,
      problems: callProblems,
    })
  }

  // 4. Fiecare FOLOSIRE a unei legături e una pe care scanerul o înțelege, altfel pică.
  const calledDirectly = (node: ts.Node): boolean => {
    const { child, parent } = outerUse(node, false)
    return ts.isCallExpression(parent) && parent.expression === child
  }
  const checkModuleUse = (node: ts.Node): void => {
    const { child, parent } = outerUse(node, true)
    let member: string | null | undefined // undefined = nu e un acces la membru
    if (ts.isPropertyAccessExpression(parent) && parent.expression === child)
      member = parent.name.text
    else if (ts.isElementAccessExpression(parent) && parent.expression === child)
      member = staticKeyExpr(parent.argumentExpression, consts)
    if (member === null) {
      flag(parent, `acces nedeterminabil la modulul analytics: ${parent.getText(sf)}`)
      return
    }
    if (member === 'track') {
      if (!calledDirectly(parent)) flag(parent, 'track folosit ca valoare (apel nedeterminabil)')
      return
    }
    // alt export (`setAnalyticsUser`…), `.then`/`.catch` (legate la pasul 2)
    if (member !== undefined) return
    if (ts.isVariableDeclaration(parent) && parent.initializer === child) return
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === child &&
      ts.isIdentifier(parent.left)
    )
      return
    if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) return
    flag(parent, 'modulul analytics folosit ca valoare')
  }
  for (const n of [...promiseCalls, ...moduleCalls]) checkModuleUse(n)
  for (const n of nodes) {
    if (!ts.isIdentifier(n) || isDeclarationName(n) || inTypePosition(n)) continue
    if (trackB.has(n)) {
      if (!calledDirectly(n)) flag(n, 'track folosit ca valoare (apel nedeterminabil)')
    } else if (moduleB.has(n) || promiseB.has(n)) {
      checkModuleUse(n)
    }
  }

  // Pasul 2 rulează de mai multe ori: aceeași problemă se raportează o dată,
  // iar lista iese în ordinea din fișier.
  const seen = new Set<string>()
  const unique: Violation[] = []
  for (const p of [...problems].sort((a, b) => a.pos - b.pos)) {
    const k = `${p.pos} ${p.why}`
    if (seen.has(k)) continue
    seen.add(k)
    unique.push({ where: p.where, why: p.why })
  }
  return { calls, importsAnalytics, problems: unique }
}

function findTrackCalls(file: string, src: string): TrackCall[] {
  return scanFile(file, src).calls
}

/** Membrii uniunii fără niciun emițător (AE1). */
function missingEmitters(members: readonly string[], calls: readonly TrackCall[]): string[] {
  const emitted = new Set(calls.map((c) => c.event))
  return members.filter((e) => !emitted.has(e))
}

/**
 * Rândurile tabelului „Evenimentele de afacere” din catalog: eveniment → cheile
 * din coloana „Proprietăți” (doar identificatorii între backtick-uri; valorile
 * se scriu fără backtick-uri). Un eveniment cu DOUĂ rânduri intră în
 * `duplicates` (Map-ul ar păstra tăcut doar ultimul).
 */
function catalogRows(md: string): { rows: Map<string, string[]>; duplicates: string[] } {
  const rows = new Map<string, string[]>()
  const duplicates: string[] = []
  const start = md.indexOf('## Evenimentele de afacere')
  if (start < 0) return { rows, duplicates }
  const next = md.indexOf('\n## ', start + 1)
  const section = md.slice(start, next < 0 ? undefined : next)
  for (const line of section.split('\n')) {
    const m = /^\| `([a-z0-9_]+)` \|/.exec(line)
    if (!m) continue
    if (rows.has(m[1])) duplicates.push(m[1])
    const cells = line.split('|').map((c) => c.trim())
    const props = cells[4] ?? ''
    rows.set(m[1], Array.from(props.matchAll(/`([a-z0-9_]+)`/g), (x) => x[1]).sort())
  }
  return { rows, duplicates }
}

function violations(calls: readonly TrackCall[]): Violation[] {
  const v: Violation[] = []
  for (const c of calls) {
    const where = `${c.file}:${c.line}`
    for (const why of c.problems) v.push({ where, why })
    for (const k of c.keys ?? [])
      if (isForbiddenKey(k)) v.push({ where, why: `cheie interzisă: ${k}` })
  }
  return v
}

describe('clichet: evenimentele de analytics', () => {
  const analyticsSrc = readFileSync(resolve(ROOT, ANALYTICS), 'utf8')
  const members = appEventMembers(analyticsSrc)
  const files = sourceFiles(SRC)
  const scans = files.flatMap((f) => {
    const rel = relative(ROOT, f).split(sep).join('/')
    if (rel === ANALYTICS) return []
    return [scanFile(rel, readFileSync(f, 'utf8'))]
  })
  const calls = scans.flatMap((s) => s.calls)

  it('AE0 anti-vacuitate: uniunea și apelurile chiar se citesc', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(members.length).toBeGreaterThanOrEqual(15)
    expect(new Set(members).size).toBe(members.length)
    expect(calls.length).toBeGreaterThanOrEqual(members.length)
    // Scanerul chiar vede importurile modulului (altfel AE3 ar fi vacuu).
    expect(scans.filter((s) => s.importsAnalytics).length).toBeGreaterThanOrEqual(10)
  })

  it('AE1 fiecare membru AppEvent are un emițător real', () => {
    expect(missingEmitters(members, calls)).toEqual([])
    // Și invers: nimeni nu emite un nume din afara uniunii (TS îl prinde deja,
    // dar un `as` l-ar strecura).
    expect(calls.filter((c) => c.event !== null && !members.includes(c.event))).toEqual([])
  })

  it('AE2 + AE3 proprietăți literale, fără chei PII, eveniment literal, fără alias', () => {
    expect([...violations(calls), ...scans.flatMap((s) => s.problems)]).toEqual([])
  })

  it('AE5 fiecare scutire de cheie e încă folosită (registrul nu putrezește)', () => {
    const used = new Set(calls.flatMap((c) => c.keys ?? []))
    expect(ALLOWED_KEYS.filter((a) => !used.has(a.key)).map((a) => a.key)).toEqual([])
  })

  it('AE6 suprafața oaspeților nu emite și nu importă analytics (DPA 05 §3.4)', () => {
    const guest = GUEST_FILES.map((f) => ({
      f,
      scan: scanFile(f, readFileSync(resolve(ROOT, f), 'utf8')),
    }))
    expect(guest.length).toBeGreaterThan(20)
    const offenders = guest
      .filter(
        ({ scan }) => scan.calls.length > 0 || scan.importsAnalytics || scan.problems.length > 0,
      )
      .map(({ f }) => f)
    expect(offenders).toEqual([])
    // Control pozitiv: detectorul prinde fiecare formă — static, DINAMIC, re-export.
    const guestFile = 'src/components/menu/Sample.tsx'
    for (const src of [
      "import { track } from '../../lib/analytics'",
      "import type { AppEvent } from '@/lib/analytics'",
      "const a = await import('../../lib/analytics')",
      "void import('../../lib/analytics')",
      "export { track } from '../../lib/analytics'",
    ]) {
      expect(scanFile(guestFile, src).importsAnalytics, src).toBe(true)
    }
    expect(
      scanFile('src/pages/Sample.tsx', "import { track } from '../lib/analytics'").importsAnalytics,
    ).toBe(true)
    // …și nu se aprinde pe un modul care doar se NUMEȘTE la fel în alt loc.
    expect(scanFile(guestFile, "import { x } from '../analytics'").importsAnalytics).toBe(false)
    expect(scanFile(guestFile, "import { x } from 'analytics'").importsAnalytics).toBe(false)
    // Un import pe care scanerul nu-l poate rezolva PICĂ (nu se presupune „altceva”).
    expect(scanFile(guestFile, 'const m = await import(path)').problems.map((p) => p.why)).toEqual([
      'import cu specificator nedeterminabil static: import(path)',
    ])
    expect(
      findTrackCalls('x.tsx', "  track('reservation_created', { party_size: 2 })"),
    ).toHaveLength(1)
  })

  it('AE7 catalogul docs/ANALYTICS_EVENTS.md = evenimentele și cheile din cod', () => {
    const { rows, duplicates } = catalogRows(readFileSync(resolve(ROOT, CATALOG), 'utf8'))
    expect(duplicates).toEqual([])
    expect(rows.size).toBeGreaterThanOrEqual(15)
    expect([...rows.keys()].sort()).toEqual([...members].sort())
    const codeKeys = new Map<string, Set<string>>()
    for (const c of calls) {
      if (c.event === null) continue
      const set = codeKeys.get(c.event) ?? new Set<string>()
      for (const k of c.keys ?? []) set.add(k)
      codeKeys.set(c.event, set)
    }
    const mismatches = members
      .map((e) => ({ e, doc: rows.get(e) ?? [], code: [...(codeKeys.get(e) ?? [])].sort() }))
      .filter((x) => x.doc.join(',') !== x.code.join(','))
      .map((x) => `${x.e}: catalog [${x.doc.join(', ')}] ≠ cod [${x.code.join(', ')}]`)
    expect(mismatches).toEqual([])
    // Control pozitiv: parserul de tabel citește backtick-urile, nu valorile…
    const head =
      '## Evenimentele de afacere\n| Eveniment | a | b | Proprietăți | c |\n|---|---|---|---|---|\n'
    const row = '| `x_y` | când | `src/a.ts` | `k1`, `k2` (val1/val2) | ? |\n'
    const sample = catalogRows(`${head}${row}## Altceva\n| \`z\` | a | b | \`q\` | c |\n`)
    expect([...sample.rows.entries()]).toEqual([['x_y', ['k1', 'k2']]])
    expect(sample.duplicates).toEqual([])
    // …și un rând DUPLICAT apare cu numele evenimentului (nu e suprascris tăcut).
    const dup = catalogRows(`${head}${row}| \`x_y\` | altă dată | \`src/b.ts\` | \`k3\` | ? |\n`)
    expect(dup.duplicates).toEqual(['x_y'])
  })

  it('AE4 control pozitiv: parserul prinde fiecare formă interzisă', () => {
    const sample = [
      "track('order_placed', { restaurant_id: r.id, customer_phone: p })",
      'track(name, { plan })',
      "track('order_placed', props)",
      "track('order_placed', { ...order })",
      "track('reservation_created', { 'customer_name': n, party_size: 2 })",
      "track('checkout_started', { plan, confirmation_code: c }, { sendInstantly: true })",
      "x.track('ignored', { email })",
      "track('login_completed', { mfa: f(a, b), source: 'qr' })",
    ].join('\n')
    const sc = findTrackCalls('sample.ts', sample)
    expect(sc.map((c) => c.event)).toEqual([
      'order_placed',
      null,
      'order_placed',
      'order_placed',
      'reservation_created',
      'checkout_started',
      'login_completed',
    ])
    expect(violations(sc).map((v) => v.why)).toEqual([
      'cheie interzisă: customer_phone',
      'evenimentul nu e un literal de șir',
      'proprietățile nu sunt un obiect literal: props',
      'spread în proprietăți',
      'cheie interzisă: customer_name',
      'cheie interzisă: confirmation_code',
    ])

    // Cheile CALCULATE (CR-M2): rezolvate când sunt statice, eșec când nu.
    const computed = [
      "const K = 'guest_name'",
      'let dyn = pick()',
      "track('order_placed', { ['customer_phone']: p })",
      "track('order_placed', { [`customer_${'email'}`]: e })",
      "track('order_placed', { ['ui_' + 'source']: 'x', [K]: n })",
      "track('order_placed', { [k]: v })",
      "track('order_placed', { [dyn]: v, [`a_${dyn}`]: w })",
      "track('order_placed', { [1]: v, ['item_count']: 2 })",
    ].join('\n')
    const cc = findTrackCalls('sample.ts', computed)
    expect(cc.map((c) => c.keys)).toEqual([
      ['customer_phone'],
      ['customer_email'],
      ['ui_source', 'guest_name'],
      [],
      [],
      ['1', 'item_count'],
    ])
    expect(violations(cc).map((v) => v.why)).toEqual([
      'cheie interzisă: customer_phone',
      'cheie interzisă: customer_email',
      'cheie interzisă: guest_name',
      'cheie calculată nedeterminabilă static: [k]',
      'cheie calculată nedeterminabilă static: [dyn]',
      'cheie calculată nedeterminabilă static: [`a_${dyn}`]',
    ])

    // Comentariile și șirurile NU sunt apeluri (CR-m8): apelul unic COMENTAT nu
    // ține în viață evenimentul (AE1 pică), apelul activ da (AE1 trece).
    const commented = [
      "// track('x_y', { customer_phone: p })",
      "/* track('x_y') */",
      'const s = "track(\'x_y\')"',
      "const t = `track('x_y')`",
    ].join('\n')
    expect(findTrackCalls('src/a.ts', commented)).toEqual([])
    expect(missingEmitters(['x_y'], findTrackCalls('src/a.ts', commented))).toEqual(['x_y'])
    expect(
      missingEmitters(['x_y'], findTrackCalls('src/a.ts', `${commented}\ntrack('x_y')`)),
    ).toEqual([])

    // Importul DINAMIC / namespace al modulului (CR-m10): fiecare formă e un apel.
    const dynamic = [
      "import * as ns from '../lib/analytics'",
      "import { track as t } from '../lib/analytics'",
      'async function f() {',
      "  const analytics = await import('../lib/analytics')",
      "  analytics.track('a_a', { customer_phone: phone })",
      "  const { track: tt } = await import('../lib/analytics')",
      "  tt('b_b')",
      "  void import('../lib/analytics').then((m) => m.track('c_c'))",
      "  ;(await import('../lib/analytics')).track('d_d')",
      "  const p = import('../lib/analytics')",
      '  const later = await p',
      "  later['track']('e_e')",
      '}',
      "ns.track('f_f')",
      "t('g_g')",
      "other.track('ignored')",
    ].join('\n')
    const ds = scanFile('src/pages/Sample.tsx', dynamic)
    expect(ds.importsAnalytics).toBe(true)
    expect(ds.calls.map((c) => c.event)).toEqual(['a_a', 'b_b', 'c_c', 'd_d', 'e_e', 'f_f', 'g_g'])
    expect(violations(ds.calls).map((v) => v.why)).toEqual(['cheie interzisă: customer_phone'])
    expect(ds.problems).toEqual([])
    // Un `analytics` care NU e modulul (fără import) nu se numără.
    expect(findTrackCalls('src/pages/Sample.tsx', "analytics.track('z_z')")).toEqual([])

    // Funcția / modulul ca VALOARE (AE3): orice folosire neurmăribilă pică.
    const escapes = [
      "import { track } from '../lib/analytics'",
      'const alias = track',
      'onClick(track)',
      'const o = { track }',
      'export { track }',
      'async function g() {',
      "  const a = await import('../lib/analytics')",
      '  send(a)',
      '  const tr = a.track',
      '  a[key]()',
      "  import('../lib/analytics').then(handler)",
      '}',
    ].join('\n')
    expect(scanFile('src/pages/Sample.tsx', escapes).problems).toEqual([
      { where: 'src/pages/Sample.tsx:2', why: 'track folosit ca valoare (apel nedeterminabil)' },
      { where: 'src/pages/Sample.tsx:3', why: 'track folosit ca valoare (apel nedeterminabil)' },
      { where: 'src/pages/Sample.tsx:4', why: 'track folosit ca valoare (apel nedeterminabil)' },
      { where: 'src/pages/Sample.tsx:5', why: 'track folosit ca valoare (apel nedeterminabil)' },
      { where: 'src/pages/Sample.tsx:8', why: 'modulul analytics folosit ca valoare' },
      { where: 'src/pages/Sample.tsx:9', why: 'track folosit ca valoare (apel nedeterminabil)' },
      {
        where: 'src/pages/Sample.tsx:10',
        why: 'acces nedeterminabil la modulul analytics: a[key]',
      },
      {
        where: 'src/pages/Sample.tsx:11',
        why: 'modulul analytics dat unei funcții necunoscute (.then)',
      },
    ])
    // Folosirile LEGITIME nu se aprind: o variabilă locală numită `track` fără
    // import (CategoryTabs.tsx: `const track = trackRef.current`), elementul
    // HTML `<track>`, poziții de tip, alte exporturi ale modulului.
    const legit = [
      "import { setAnalyticsUser, track } from '../lib/analytics'",
      "import * as ns from '../lib/analytics'",
      'type E = typeof ns.track',
      'const el = <video><track kind="captions" /></video>',
      'ns.setAnalyticsUser(null)',
      "track('a_a')",
      'function h() { const local = { track: 1 }; return local.track }',
    ].join('\n')
    expect(scanFile('src/pages/Sample.tsx', legit).problems).toEqual([])
    const noImport = 'const track = ref.current\nconst w = track.scrollWidth - track.clientWidth'
    expect(scanFile('src/components/menu/Sample.tsx', noImport)).toEqual({
      calls: [],
      importsAnalytics: false,
      problems: [],
    })

    // Cheile permise rămân permise (lista nu e atât de largă încât să prindă tot).
    for (const ok of [
      'restaurant_id',
      'ui_source',
      'plan',
      'item_count',
      'line_count',
      'mfa',
      'target',
      'z_sent',
      'b2b',
      'tab',
      'step',
      'skipped',
      'count',
      'plan_intent',
      'party_size',
      'amount',
    ]) {
      expect(isForbiddenKey(ok)).toBe(false)
    }
    expect(appEventMembers("export type AppEvent =\n  | 'a_b'\n  | 'c'\n\nconst x = 1")).toEqual([
      'a_b',
      'c',
    ])
  })
})
