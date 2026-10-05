// Clichet: textele publice nu poartă numele unei persoane (cerința fondatorului,
// oct 2026). Pagina de prețuri promitea „Vine Radu personal", „Vorbește cu
// Radu", „Direct cu Radu, fondatorul" și precompleta mesajele WhatsApp cu
// „Salut Radu" — un nume de persoană ca promisiune comercială e o obligație pe
// care firma n-o poate onora când răspunde altcineva.
//
// Trei fișiere numite EXPLICIT (sursele de copy comercial) + o scanare de
// CLASĂ pe tot `src/` (fără teste) și pe `index.html`, ca un text nou mutat în
// altă componentă să nu scape. Comentariile sunt incluse deliberat — un nume
// în comentariu se copiază ușor într-un string.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { TRUST_SIGNALS } from '../plans'
import { PILOT_BANNER, TRIAL_FAQ, TRIAL_HEADLINE } from '../pricingCopy'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
// Cuvânt întreg, sensibil la majuscule: `georgeradu119` (adresa din comentariul
// FounderAiPanel, internă) nu e text public și nu se potrivește.
const NAME = /\bRadu\b/

const NAMED_FILES = ['src/lib/plans.ts', 'src/lib/pricingCopy.ts', 'src/pages/PricingPage.tsx']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(p))
    } else if (/\.(tsx?|html|json)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

describe('fără nume de persoană în textele publice', () => {
  it('NP1: sursele de copy comercial nu conțin numele', () => {
    for (const f of NAMED_FILES) {
      const abs = resolve(ROOT, f)
      // Control pozitiv: fișierul există și chiar are conținut — altfel o
      // redenumire ar face testul vacuu.
      expect(existsSync(abs), `${f} lipsește`).toBe(true)
      const src = readFileSync(abs, 'utf8')
      expect(src.length).toBeGreaterThan(1000)
      expect(NAME.test(src), `numele apare în ${f}`).toBe(false)
    }
  })

  it('NP2: datele exportate (semnale, pilot, FAQ) nu conțin numele', () => {
    const texts = [
      TRIAL_HEADLINE,
      TRIAL_FAQ.q,
      TRIAL_FAQ.a,
      PILOT_BANNER.title,
      PILOT_BANNER.body,
      ...TRUST_SIGNALS.flatMap((t) => [t.label, t.desc]),
    ]
    expect(texts.length).toBeGreaterThan(4)
    for (const t of texts) expect(NAME.test(t), `numele apare în „${t}"`).toBe(false)
  })

  it('NP3: clasă — nimic din src/ și index.html nu conține numele', () => {
    const files = [...sourceFiles(resolve(ROOT, 'src')), resolve(ROOT, 'index.html')].filter(
      existsSync,
    )
    expect(files.length).toBeGreaterThan(50)
    const hits = files
      .filter((f) => NAME.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f))
    expect(hits).toEqual([])
  })
})
