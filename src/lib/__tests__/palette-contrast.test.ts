// src/lib/__tests__/palette-contrast.test.ts
// Contrastul AA (4.5:1, text normal) pe panou (D / tokens.css / button.css) și
// pe paginile de marketing (MKT). Comentariile din cod pretindeau AA acolo unde
// cifrele nu-l atingeau — acum cifrele sunt verificate, nu crezute pe cuvânt.
//   DP1  D_RAW.t3 (355 de utilizări) ≥4.5:1 pe bg și pe s1…s4. Fostul #7C766C
//        pretindea „~4.6:1 pe s1" și avea 4.26:1 → mutația „valoare veche" pică.
//   DP2  tokens.css :root == D_RAW pe tokenii de text (sursă unică; altfel DP1 ar
//        testa obiectul JS în timp ce CSS-ul servește altă culoare).
//   DP3  .btn--primary: textul trece AA pe auriu ȘI pe auriul deschis de la hover
//        (era #fff: 2.66:1 și 1.91:1).
//   DP4  .btn--danger: textul trece AA pe fundal, iar hover-ul nu deschide fundalul
//        de sub textul alb (era #fff pe #e05555 = 3.75:1 + brightness(1.1)).
//   DP5  MKT.accentInk ≥4.5:1 pe bg/surface/surface2/accentSoft (era #A57A28,
//        3.45–3.88:1, folosit la 12–14px); MKT.text3 și onAccent rămân AA.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { D_RAW } from '../constants'
import { MKT } from '../marketing'

const AA = 4.5

function rgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`nu e hex: ${hex}`)
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

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

// Primul bloc `:root { … }` din tokens.css (cel care oglindește D_RAW).
function rootTokens(): Map<string, string> {
  const css = read('src/styles/tokens.css')
  const m = css.match(/:root\s*\{([\s\S]*?)\n\}/)
  if (!m) throw new Error('lipsește blocul :root din tokens.css')
  const out = new Map<string, string>()
  for (const d of (m[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(d[1] ?? '', (d[2] ?? '').trim())
  }
  return out
}

// Declarațiile unei reguli exacte din button.css (ex. `.btn--primary`).
function rule(selector: string): Map<string, string> {
  const css = read('src/styles/components/button.css')
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`lipsește regula ${selector} din button.css`)
  const out = new Map<string, string>()
  for (const d of (m[1] ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(d[1] ?? '', (d[2] ?? '').trim())
  }
  return out
}

function resolveColor(value: string, tokens: Map<string, string>): string {
  const v = value.match(/^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/)
  if (v) {
    const t = tokens.get(v[1] ?? '') ?? v[2]
    if (!t) throw new Error(`token nedefinit: ${v[1]}`)
    return resolveColor(t, tokens)
  }
  if (value === 'white') return '#FFFFFF'
  return value
}

describe('Panou + marketing — contrast AA', () => {
  it('DP1 D_RAW.t3 trece AA pe bg și pe toate suprafețele', () => {
    const fails: string[] = []
    for (const k of ['bg', 's1', 's2', 's3', 's4'] as const) {
      const r = contrast(D_RAW.t3, D_RAW[k])
      if (r < AA) fails.push(`t3 pe ${k}: ${r.toFixed(2)}:1`)
    }
    expect(fails).toEqual([])
    // Control: t2 e textul de corp, iar t3 rămâne mai estompat decât el.
    expect(luminance(D_RAW.t3)).toBeLessThan(luminance(D_RAW.t2))
  })

  it('DP2 tokens.css servește aceleași culori de text ca D_RAW', () => {
    const tk = rootTokens()
    expect(tk.get('--color-text-1')?.toUpperCase()).toBe(D_RAW.t1.toUpperCase())
    expect(tk.get('--color-text-2')?.toUpperCase()).toBe(D_RAW.t2.toUpperCase())
    expect(tk.get('--color-text-3')?.toUpperCase()).toBe(D_RAW.t3.toUpperCase())
    expect(tk.get('--color-on-gold')?.toUpperCase()).toBe(D_RAW.onGold.toUpperCase())
  })

  it('DP3 .btn--primary: text lizibil pe auriu și pe auriul de hover', () => {
    const tk = rootTokens()
    const base = rule('.btn--primary')
    const hover = rule('.btn--primary:hover:not(:disabled)')
    const fg = resolveColor(base.get('color') ?? '', tk)
    const bg = resolveColor(base.get('background') ?? '', tk)
    const bgHover = resolveColor(hover.get('background') ?? base.get('background') ?? '', tk)
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA)
    expect(contrast(fg, bgHover)).toBeGreaterThanOrEqual(AA)
  })

  it('DP4 .btn--danger: text lizibil, iar hover-ul nu deschide fundalul', () => {
    const tk = rootTokens()
    const base = rule('.btn--danger')
    const hover = rule('.btn--danger:hover:not(:disabled)')
    const fg = resolveColor(base.get('color') ?? '', tk)
    const bg = resolveColor(base.get('background') ?? '', tk)
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA)
    // Un filtru de luminozitate > 1 sub text alb coboară contrastul.
    const b = (hover.get('filter') ?? '').match(/brightness\(([\d.]+)\)/)
    if (b && luminance(fg) > 0.5) expect(Number(b[1])).toBeLessThanOrEqual(1)
  })

  it('DP5 MKT: accentInk, text3 și onAccent trec AA pe fundalurile de marketing', () => {
    const fails: string[] = []
    for (const k of ['bg', 'surface', 'surface2', 'accentSoft'] as const) {
      for (const fg of ['accentInk', 'text3', 'text2'] as const) {
        const r = contrast(MKT[fg], MKT[k])
        if (r < AA) fails.push(`${fg} pe ${k}: ${r.toFixed(2)}:1`)
      }
    }
    expect(fails).toEqual([])
    expect(contrast(MKT.onAccent, MKT.accent)).toBeGreaterThanOrEqual(AA)
  })
})
