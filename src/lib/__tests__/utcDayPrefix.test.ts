// Clichet de CLASĂ: nicio zi de business din src/ nu se derivă din PREFIXUL unui
// șir ISO/UTC (BridgeTab „azi", default-ul datei NIR). Scanează sursa; scutirile
// stau într-un registru CU MOTIV și fiecare trebuie încă găsită — altfel
// registrul putrezește și testul tace. ATENȚIE: potrivește și comentariile —
// nu scrie tiparul literal în explicații (capcana position() din mig 273).
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, it, expect } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'toISOString().slice(0, 10)', re: /toISOString\(\)\s*\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/ },
  { name: "toISOString().split('T')", re: /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/ },
  { name: '<coloană>_at.startsWith(', re: /_at\??\.startsWith\(/ },
  { name: '<coloană>_at.slice(0, 10)', re: /_at\??\.(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/ },
]

const ALLOWED: ReadonlyArray<{ hit: string; reason: string }> = [
  {
    hit: 'src/components/GdprCard.tsx toISOString().slice(0, 10)',
    reason: 'numele fișierului de export GDPR — cosmetic, nu o zi de business',
  },
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

interface Hit { key: string; where: string }
function scan(files: string[]): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/')
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const p of PATTERNS) {
          if (p.re.test(line)) hits.push({ key: `${rel} ${p.name}`, where: `${rel}:${i + 1}` })
        }
      })
  }
  return hits
}

describe('clichet: nicio zi derivată din prefixul UTC', () => {
  const files = sourceFiles(SRC)
  const hits = scan(files)

  it('U1 anti-vacuitate: scanarea chiar vede sursa', () => {
    expect(files.length).toBeGreaterThan(100)
  })
  it('U2 niciun loc în afara scutirilor', () => {
    const allowed = new Set(ALLOWED.map((a) => a.hit))
    expect(hits.filter((h) => !allowed.has(h.key)).map((h) => `${h.where} — ${h.key}`)).toEqual([])
  })
  it('U3 fiecare scutire e încă găsită (control pozitiv al regex-urilor)', () => {
    const found = new Set(hits.map((h) => h.key))
    expect(ALLOWED.filter((a) => !found.has(a.hit)).map((a) => a.hit)).toEqual([])
  })
})
