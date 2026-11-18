// Clichete de CLASĂ pe apelurile `track()` din src/ (scanează sursa, ca
// utcDayPrefix / guestI18n):
//   AE0  anti-vacuitate: uniunea și apelurile chiar se citesc.
//   AE1  fiecare membru `AppEvent` are cel puțin un `track()` real în afara
//        lib/analytics.ts și a testelor — un nume fără emițător e un grafic gol
//        în PostHog care arată exact ca „zero utilizatori”. Mutația care pică:
//        un membru nou în uniune, fără apel (sau ștergerea unui apel unic).
//   AE2  proprietățile sunt absente sau un OBIECT LITERAL (fără variabile, fără
//        spread), iar nicio cheie nu e din clasa PII (e-mail, telefon, nume,
//        client, note, adresă, token, cod, parolă, CUI, IP…). Mutațiile care
//        pică: `{ customer_phone }`, `{ ...order }`, `track('x', props)`.
//   AE3  primul argument e un literal de șir (altfel AE1/AE2 ar fi orbi).
//   AE4  control POZITIV: parserul prinde fiecare formă interzisă pe un eșantion.
//   AE5  fiecare scutire din registrul de chei e încă folosită.
//   AE6  suprafața OASPEȚILOR (GUEST_FILES, aceeași listă ca GI2) nu emite și nu
//        importă analytics: acolo Menuvia e persoana împuternicită a
//        restaurantului, iar DPA-ul (menuvia-pack/05 §3.4 + Anexa 2) nu cunoaște
//        PostHog (PH-DPA-1). Mutația care pică: `track('reservation_created', …)`
//        readus în ReservationSheet. Ramurile qr/pickup ale `createOrder` le ține
//        comportamental OA1–OA3 (orders-analytics.test.ts).
//   AE7  catalogul (docs/ANALYTICS_EVENTS.md) e EGAL cu codul: aceleași
//        evenimente ca uniunea și, pe fiecare, exact cheile literale din
//        apelurile `track()` (BV11 — documentația care minte). Mutațiile care
//        pică: un eveniment nou fără rând în tabel, o cheie nouă nedocumentată.
// ATENȚIE: scanerul nu citește comentariile ca apeluri doar dacă nu arată a
// apel — nu scrie în comentarii din src/ un apel complet de forma track('…').
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import { GUEST_FILES } from './visibleTextScanner'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')
const ANALYTICS = 'src/lib/analytics.ts'
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

/** Sfârșitul unui literal de șir care începe la `i` (ghilimeaua inclusă). */
function skipString(src: string, i: number): number {
  const q = src[i]
  let j = i + 1
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2
      continue
    }
    if (src[j] === q) return j + 1
    j++
  }
  return j
}

/** Argumentele de la nivelul de sus ale apelului care începe după `(` la `open`. */
function callArgs(src: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  let i = open + 1
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i)
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) {
        const last = src.slice(start, i).trim()
        if (last) args.push(last)
        return args
      }
      depth--
    } else if (c === ',' && depth === 0) {
      args.push(src.slice(start, i).trim())
      start = i + 1
    }
    i++
  }
  return args
}

/** Cheile de la nivelul de sus ale unui obiect literal `{ … }`. */
function literalKeys(obj: string): { keys: string[]; spread: boolean } {
  const inner = obj.trim().replace(/^\{/, '').replace(/\}$/, '')
  const parts = callArgs(`(${inner})`, 0)
  const keys: string[] = []
  let spread = false
  for (const p of parts) {
    if (p.startsWith('...')) {
      spread = true
      continue
    }
    const m = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(p)
    if (m) keys.push(m[1] ?? m[2] ?? m[3])
  }
  return { keys, spread }
}

interface TrackCall {
  file: string
  line: number
  event: string | null
  props: string | null
}

function findTrackCalls(file: string, src: string): TrackCall[] {
  const out: TrackCall[] = []
  const re = /(?<![\w$.])track\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1
    const args = callArgs(src, open)
    const ev = /^'([a-z0-9_]+)'$/.exec(args[0] ?? '')
    out.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      event: ev ? ev[1] : null,
      props: args[1] ?? null,
    })
  }
  return out
}

/**
 * Rândurile tabelului „Evenimentele de afacere” din catalog: eveniment → cheile
 * din coloana „Proprietăți” (doar identificatorii între backtick-uri; valorile
 * se scriu fără backtick-uri).
 */
function catalogRows(md: string): Map<string, string[]> {
  const start = md.indexOf('## Evenimentele de afacere')
  if (start < 0) return new Map()
  const next = md.indexOf('\n## ', start + 1)
  const section = md.slice(start, next < 0 ? undefined : next)
  const rows = new Map<string, string[]>()
  for (const line of section.split('\n')) {
    const m = /^\| `([a-z0-9_]+)` \|/.exec(line)
    if (!m) continue
    const cells = line.split('|').map((c) => c.trim())
    const props = cells[4] ?? ''
    rows.set(m[1], Array.from(props.matchAll(/`([a-z0-9_]+)`/g), (x) => x[1]).sort())
  }
  return rows
}

const IMPORTS_ANALYTICS = /from\s+['"](?:\.\.?\/)+(?:lib\/)?analytics['"]/

interface Violation {
  where: string
  why: string
}

function violations(calls: TrackCall[]): Violation[] {
  const v: Violation[] = []
  for (const c of calls) {
    const where = `${c.file}:${c.line}`
    if (c.event === null) v.push({ where, why: 'evenimentul nu e un literal de șir' })
    if (c.props === null) continue
    if (!c.props.startsWith('{')) {
      v.push({ where, why: `proprietățile nu sunt un obiect literal: ${c.props}` })
      continue
    }
    const { keys, spread } = literalKeys(c.props)
    if (spread) v.push({ where, why: 'spread în proprietăți' })
    for (const k of keys) if (isForbiddenKey(k)) v.push({ where, why: `cheie interzisă: ${k}` })
  }
  return v
}

describe('clichet: evenimentele de analytics', () => {
  const analyticsSrc = readFileSync(resolve(ROOT, ANALYTICS), 'utf8')
  const members = appEventMembers(analyticsSrc)
  const files = sourceFiles(SRC)
  const calls = files.flatMap((f) => {
    const rel = relative(ROOT, f).split(sep).join('/')
    if (rel === ANALYTICS) return []
    return findTrackCalls(rel, readFileSync(f, 'utf8'))
  })

  it('AE0 anti-vacuitate: uniunea și apelurile chiar se citesc', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(members.length).toBeGreaterThanOrEqual(15)
    expect(new Set(members).size).toBe(members.length)
    expect(calls.length).toBeGreaterThanOrEqual(members.length)
  })

  it('AE1 fiecare membru AppEvent are un emițător real', () => {
    const emitted = new Set(calls.map((c) => c.event))
    expect(members.filter((e) => !emitted.has(e))).toEqual([])
    // Și invers: nimeni nu emite un nume din afara uniunii (TS îl prinde deja,
    // dar un `as` l-ar strecura).
    expect(calls.filter((c) => c.event !== null && !members.includes(c.event))).toEqual([])
  })

  it('AE2 + AE3 proprietăți literale, fără chei PII, eveniment literal', () => {
    expect(violations(calls)).toEqual([])
  })

  it('AE5 fiecare scutire de cheie e încă folosită (registrul nu putrezește)', () => {
    const used = new Set(
      calls.flatMap((c) => (c.props?.startsWith('{') ? literalKeys(c.props).keys : [])),
    )
    expect(ALLOWED_KEYS.filter((a) => !used.has(a.key)).map((a) => a.key)).toEqual([])
  })

  it('AE6 suprafața oaspeților nu emite și nu importă analytics (DPA 05 §3.4)', () => {
    const guest = GUEST_FILES.map((f) => ({ f, src: readFileSync(resolve(ROOT, f), 'utf8') }))
    expect(guest.length).toBeGreaterThan(20)
    const offenders = guest
      .filter(({ f, src }) => findTrackCalls(f, src).length > 0 || IMPORTS_ANALYTICS.test(src))
      .map(({ f }) => f)
    expect(offenders).toEqual([])
    // Control pozitiv: detectorul prinde ambele forme.
    expect(IMPORTS_ANALYTICS.test("import { track } from '../lib/analytics'")).toBe(true)
    expect(IMPORTS_ANALYTICS.test("import { track } from '../../lib/analytics'")).toBe(true)
    expect(findTrackCalls('x.tsx', "  track('reservation_created', { party_size: 2 })")).toHaveLength(1)
  })

  it('AE7 catalogul docs/ANALYTICS_EVENTS.md = evenimentele și cheile din cod', () => {
    const rows = catalogRows(readFileSync(resolve(ROOT, CATALOG), 'utf8'))
    expect(rows.size).toBeGreaterThanOrEqual(15)
    expect([...rows.keys()].sort()).toEqual([...members].sort())
    const codeKeys = new Map<string, Set<string>>()
    for (const c of calls) {
      if (c.event === null) continue
      const set = codeKeys.get(c.event) ?? new Set<string>()
      if (c.props?.startsWith('{')) for (const k of literalKeys(c.props).keys) set.add(k)
      codeKeys.set(c.event, set)
    }
    const mismatches = members
      .map((e) => ({ e, doc: rows.get(e) ?? [], code: [...(codeKeys.get(e) ?? [])].sort() }))
      .filter((x) => x.doc.join(',') !== x.code.join(','))
      .map((x) => `${x.e}: catalog [${x.doc.join(', ')}] ≠ cod [${x.code.join(', ')}]`)
    expect(mismatches).toEqual([])
    // Control pozitiv: parserul de tabel citește backtick-urile, nu valorile.
    const sample = catalogRows(
      '## Evenimentele de afacere\n| Eveniment | a | b | Proprietăți | c |\n|---|---|---|---|---|\n' +
        '| `x_y` | când | `src/a.ts` | `k1`, `k2` (val1/val2) | ? |\n## Altceva\n| `z` | a | b | `q` | c |\n',
    )
    expect([...sample.entries()]).toEqual([['x_y', ['k1', 'k2']]])
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
    // Cheile permise rămân permise (lista nu e atât de largă încât să prindă tot).
    for (const ok of [
      'restaurant_id', 'ui_source', 'plan', 'item_count', 'line_count', 'mfa', 'target',
      'z_sent', 'b2b', 'tab', 'step', 'skipped', 'count', 'plan_intent', 'party_size', 'amount',
    ]) {
      expect(isForbiddenKey(ok)).toBe(false)
    }
    expect(appEventMembers("export type AppEvent =\n  | 'a_b'\n  | 'c'\n\nconst x = 1")).toEqual(['a_b', 'c'])
  })
})
