// src/lib/__tests__/themes-contrast.test.ts
// Contrastul AA (WCAG 1.4.3, 4.5:1 pentru text normal) pe meniurile publice.
//   TC1  `text3` (textul secundar) trece AA pe bg/surface/surface2 în TOATE cele
//        8 teme. Înainte pica pe 7 din 8 (tema implicită „cafe": 2,97:1).
//        Mutația care îl pică: orice valoare veche (ex. cafe #9A8C7A).
//   TC2  `readableTextOn` dă text lizibil peste FIECARE accent posibil: cele 7
//        culori din Setări (primary_color) și accentul fiecărei teme, cu textul
//        fiecărei teme ca „darkText". Vechiul prag fix (luminanță ≤ 0.45 → alb)
//        dădea alb pe toate cele 7 (auriul implicit: 2,66:1) — mutația „prag 0.45"
//        pică aici.
//   TC3  control: tokenul temei e păstrat când trece, albul rămâne pe accente
//        închise, iar pe teme dark „darkText" deschis NU e folosit orbește.
//   TC4  `legibleOn` (accentul/roșul folosit ca TEXT) — neschimbat când trece,
//        ajustat ≥4.5:1 când nu; mutația `return color` pică.
//   TC5  lista din test == lista din SettingsTab (altfel TC2 ar testa o paletă
//        care nu mai există).
//   TC6  fiecare valoare exportată din lib/themes are un consumator în src/
//        (code-health-dead-lib-exports). Mutația care pică: `export` readus pe
//        isValidHexColor, al cărui singur apelant e resolveTheme.
// Oracolul de contrast e scris AICI, independent de themes.ts: un bug în
// formula din producție nu se poate „confirma" singur.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { THEMES, readableTextOn, legibleOn, isDarkTheme } from '../themes'

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// Paleta „Culoare accent" din Setări (SettingsTab). TC5 o ține în sincron.
const SETTINGS_ACCENTS = [
  '#C8963C',
  '#E05555',
  '#4CAF6E',
  '#5B8DEF',
  '#9B72CF',
  '#E07B45',
  '#3ABFBF',
] as const

const AA = 4.5

describe('Temele publice — contrast AA', () => {
  it('TC1 text3 trece AA pe bg, surface și surface2 în toate temele', () => {
    const fails: string[] = []
    for (const t of THEMES) {
      for (const surface of ['bg', 'surface', 'surface2'] as const) {
        const ratio = contrast(t.colors.text3, t.colors[surface])
        if (ratio < AA) fails.push(`${t.id}.text3 pe ${surface}: ${ratio.toFixed(2)}:1`)
      }
    }
    expect(fails).toEqual([])
  })

  it('TC1b control: text și text2 trec deja (oracolul nu e vacuu)', () => {
    for (const t of THEMES) {
      for (const surface of ['bg', 'surface', 'surface2'] as const) {
        expect(contrast(t.colors.text, t.colors[surface])).toBeGreaterThanOrEqual(AA)
        expect(contrast(t.colors.text2, t.colors[surface])).toBeGreaterThanOrEqual(AA)
      }
    }
    // Oracolul însuși: alb pe auriul implicit e 2,66:1 (cifra din audit).
    expect(contrast('#FFFFFF', '#C8963C')).toBeCloseTo(2.66, 2)
  })

  it('TC2 readableTextOn trece AA pe fiecare accent, cu textul fiecărei teme', () => {
    const fails: string[] = []
    for (const t of THEMES) {
      for (const accent of [...SETTINGS_ACCENTS, t.colors.accent]) {
        const fg = readableTextOn(accent, t.colors.text)
        const ratio = contrast(fg, accent)
        if (ratio < AA) fails.push(`${t.id}: ${fg} pe ${accent} = ${ratio.toFixed(2)}:1`)
      }
    }
    expect(fails).toEqual([])
  })

  it('TC3 control: păstrează tokenul temei, albul pe accent închis, near-black pe temă dark', () => {
    // Auriul implicit cu textul temei „cafe" → textul temei (6,2:1), nu alb.
    expect(readableTextOn('#C8963C', '#2A1F18')).toBe('#2A1F18')
    // Albastrul Santorini e închis → alb (ar fi fost și înainte).
    expect(readableTextOn('#1E5C8A', '#0F1A24')).toBe('#FFFFFF')
    // Fine dining: textul temei e DESCHIS, deci pe auriu nu se ia orbește.
    const fine = THEMES.find((t) => t.id === 'fine-dining')
    if (!fine) throw new Error('lipsește tema fine-dining')
    const onGold = readableTextOn(fine.colors.accent, fine.colors.text)
    expect(onGold).not.toBe(fine.colors.text)
    expect(contrast(onGold, fine.colors.accent)).toBeGreaterThanOrEqual(AA)
    // Butonul „Cheamă ospătarul" din QR pune PUB.bg peste PUB.text.
    expect(readableTextOn('#F5F1E8', '#0F0E0C')).toBe('#0F0E0C')
    // Input neparsabil → alb (conservator, ca înainte).
    expect(readableTextOn('var(--x)', '#000000')).toBe('#FFFFFF')
  })

  it('TC4 legibleOn: neschimbat când trece AA, ajustat ≥4.5:1 când nu', () => {
    // Trece deja → ACELAȘI șir (nu o reformatare).
    expect(legibleOn('#2A1F18', '#F8F3EB')).toBe('#2A1F18')
    // Auriul ca text pe crem (2,5:1) → mai închis, ≥4.5:1, aceeași familie.
    const gold = legibleOn('#C8963C', '#F8F3EB')
    expect(gold).not.toBe('#C8963C')
    expect(contrast(gold, '#F8F3EB')).toBeGreaterThanOrEqual(AA)
    expect(luminance(gold)).toBeLessThan(luminance('#C8963C'))
    // Roșul erorii pe fundalul temei dark (3,5:1) → mai DESCHIS, nu mai închis.
    const red = legibleOn('#C0392B', '#0F0E0C')
    expect(contrast(red, '#0F0E0C')).toBeGreaterThanOrEqual(AA)
    expect(luminance(red)).toBeGreaterThan(luminance('#C0392B'))
    // Fiecare accent din Setări, pe fiecare fundal al fiecărei teme.
    for (const t of THEMES) {
      for (const bg of [t.colors.bg, t.colors.surface, t.colors.surface2]) {
        for (const c of [...SETTINGS_ACCENTS, t.colors.accent, t.colors.error]) {
          expect(contrast(legibleOn(c, bg), bg)).toBeGreaterThanOrEqual(AA)
        }
      }
    }
    // Neparsabil → neschimbat.
    expect(legibleOn('rgba(0,0,0,0.5)', '#FFFFFF')).toBe('rgba(0,0,0,0.5)')
  })

  it('TC5 paleta din test e exact cea din SettingsTab', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/SettingsTab.tsx'), 'utf8')
    const m = src.match(/const COLORS = \[([^\]]*)\]/)
    expect(m, 'nu mai găsesc `const COLORS = [...]` în SettingsTab').toBeTruthy()
    const inSettings = (m?.[1] ?? '').match(/#[0-9A-Fa-f]{6}/g)?.map((c) => c.toUpperCase()) ?? []
    expect(inSettings).toEqual([...SETTINGS_ACCENTS])
  })

  it('isDarkTheme: doar fine-dining e dark (refolosește aceeași luminanță)', () => {
    expect(THEMES.filter(isDarkTheme).map((t) => t.id)).toEqual(['fine-dining'])
  })
})

describe('lib/themes — fără exporturi moarte', () => {
  it('TC6 fiecare valoare exportată are un consumator în afara modulului', () => {
    const root = resolve(process.cwd(), 'src')
    const themesSrc = readFileSync(resolve(root, 'lib/themes.ts'), 'utf8')
    const exported = [
      ...themesSrc.matchAll(/^export (?:const|function|async function) (\w+)/gm),
    ].map((m) => m[1] ?? '')
    // Anti-vacuitate: scanerul chiar vede exporturile.
    expect(exported).toContain('readableTextOn')
    const others = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) => f.replace(/\\/g, '/') !== 'lib/themes.ts')
      .map((f) => readFileSync(resolve(root, f), 'utf8'))
    const unused = exported.filter(
      (name) => !others.some((src) => new RegExp(`\\b${name}\\b`).test(src)),
    )
    expect(unused).toEqual([])
  })
})
