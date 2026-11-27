// Clichet de CLASĂ (recenzie CodeRabbit pe #373): FORMATELE — data, ora,
// numerele prin `staffLocale`, `toLocale*String`, `Intl.*` sau un helper
// `format*(…, limbă)` — urmează limba UTILIZATORULUI (`useUiLang().lang`, la
// fel ca `fmt` din `useT`), NU limba dicționarului SERVIT: `<traducător>.lang`
// sau `lang` destructurat din `useT(…)`. Aceea cade pe română la o încărcare
// eșuată a chunk-ului, deci un englez ar vedea textul în română (inevitabil)
// ȘI data în formatul românesc (evitabil). `tr.lang` rămâne corect acolo unde
// decide TEXTUL (`tc.lang !== 'ro'` → mesajul serverului vs. rezerva tradusă,
// pluralul românesc legacy, `toLocaleUpperCase` pe un nume, limba declarată a
// unui dialog). Prima apariție găsită: ReservationsTab (#373); măturarea a
// prins și AiSettingsTab, GdprCard, lib/locations, TeamManager, StocksTab
// (L5b, deja pe main) și InviteAcceptPage. ATENȚIE: potrivește și
// comentariile din sursă — nu scrie tiparul literal în explicații.
//   LF1 anti-vacuitate: scanarea vede sursa (> 100 de fișiere) și găsește
//       traducători (> 50 de declarații `useT` / parametri `Translator<…>`).
//   LF2 niciun loc în afara scutirilor (registrul e gol azi).
//   LF3 fiecare scutire e încă găsită (registrul nu putrezește).
//   LF4 control POZITIV al detectorului pe surse sintetice: fiecare formă
//       interzisă e prinsă, cele legitime (text, `useUiLang`) nu.
// Dialectul unui CSV (separatorul + semnul zecimal, lotul C6a) e tot un FORMAT:
// `…CsvDialect(<traducător>.lang)` e sink, ca `staffLocale` — fără el, un
// englez cu chunk-ul eșuat ar primi un fișier cu „;” și virgulă zecimală.
// Mutația care pică: `staffLocale(tr.lang)` readus în GdprCard (LF2),
// `reportCsvDialect(tr.lang)` în ReportsTab (LF2), sau un sink scos din
// detector (LF4).
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')

const ALLOWED: ReadonlyArray<{ hit: string; reason: string }> = []

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      // Dicționarele nu conțin cod de formatare; testele au tipare intenționate.
      if (e.name !== '__tests__' && !(e.name === 'ns' && dir.endsWith(`${sep}i18n`))) out.push(...sourceFiles(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Identificatorii al căror `.lang` e limba dicționarului servit. */
function translatorNames(src: string): string[] {
  const names = new Set<string>()
  for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*useT\(/g)) names.add(m[1] ?? '')
  for (const m of src.matchAll(/\b(\w+)\s*\??:\s*(?:Translator|StaffT)</g)) names.add(m[1] ?? '')
  names.delete('')
  return [...names]
}

/** Locurile unde limba dicționarului ajunge într-un formatator. */
export function findViolations(src: string): string[] {
  const refs = translatorNames(src).map((n) => `\\b${escapeRe(n)}\\.lang\\b`)
  // `lang` destructurat din `useT` (`const { t, lang } = useT(ns)`).
  if (/\bconst\s*\{[^}]*\blang\b[^}]*\}\s*=\s*useT\(/.test(src)) refs.push('(?<![\\w.])lang\\b')
  const hits: string[] = []
  const lines = src.split('\n')
  for (const ref of refs) {
    const sinks: ReadonlyArray<{ name: string; re: RegExp }> = [
      { name: 'staffLocale', re: new RegExp(`staffLocale\\(\\s*${ref}`) },
      { name: 'toLocale*String', re: new RegExp(`toLocale(?:Date|Time)?String\\(\\s*${ref}`) },
      { name: 'Intl', re: new RegExp(`new\\s+Intl\\.\\w+\\(\\s*${ref}`) },
      { name: 'format*()', re: new RegExp(`\\bformat\\w*\\([^()]*,\\s*${ref}\\s*\\)`) },
      { name: '*CsvDialect', re: new RegExp(`\\b\\w*CsvDialect\\(\\s*${ref}`) },
    ]
    lines.forEach((line, i) => {
      for (const s of sinks) if (s.re.test(line)) hits.push(`${i + 1}: ${s.name}: ${line.trim()}`)
    })
  }
  return hits
}

describe('clichet: formatele urmează limba utilizatorului, nu dicționarul servit', () => {
  const files = sourceFiles(SRC)
  const scanned = files.map((file) => ({ rel: relative(ROOT, file).split(sep).join('/'), src: readFileSync(file, 'utf8') }))
  const hits = scanned.flatMap((f) => findViolations(f.src).map((h) => `${f.rel}:${h}`))

  it('LF1 anti-vacuitate: scanarea vede sursa și traducătorii', () => {
    expect(files.length).toBeGreaterThan(100)
    const translators = scanned.reduce((n, f) => n + translatorNames(f.src).length, 0)
    expect(translators).toBeGreaterThan(50)
  })

  it('LF2 niciun formatator alimentat cu limba dicționarului', () => {
    const allowed = new Set(ALLOWED.map((a) => a.hit))
    expect(hits.filter((h) => !allowed.has(h))).toEqual([])
  })

  it('LF3 fiecare scutire e încă găsită', () => {
    const found = new Set(hits)
    expect(ALLOWED.filter((a) => !found.has(a.hit)).map((a) => a.hit)).toEqual([])
  })

  it('LF4 control pozitiv: formele interzise sunt prinse, cele legitime nu', () => {
    const bad = [
      'const tr = useT(ns)\nconst locale = staffLocale(tr.lang)',
      'const rv = useT(ns)\nreturn formatDay(r.starts_at, rv.lang)',
      'const tm = useT(ns)\nx.toLocaleDateString(tm.lang)',
      'const ta = useT(ns)\nnew Intl.DateTimeFormat(ta.lang, {})',
      'function f(tr: Translator<typeof ro>) { return staffLocale(tr.lang) }',
      'const { t, lang } = useT(ns)\nconst l = staffLocale(lang)',
      'const tr = useT(ns)\nconst d = reportCsvDialect(tr.lang)',
    ]
    for (const src of bad) expect(findViolations(src), src).toHaveLength(1)
    const good = [
      "const tc = useT(ns)\nif (tc.lang !== 'ro') return x",
      'const tr = useT(ns)\nconst { lang: uiLang } = useUiLang()\nconst l = staffLocale(uiLang)',
      'const tr = useT(ns)\nreturn name.toLocaleUpperCase(tr.lang)',
      'const tr = useT(ns)\nreturn countryLabel(c.code, c.name, tr.lang)',
      'const { t, lang } = useT(ns)\nreturn <Dialog lang={lang} />',
      'const locale = staffLocale(useUiLang().lang)',
      'const tr = useT(ns)\nconst { lang: uiLang } = useUiLang()\nconst d = reportCsvDialect(uiLang)',
    ]
    for (const src of good) expect(findViolations(src), src).toEqual([])
  })
})
