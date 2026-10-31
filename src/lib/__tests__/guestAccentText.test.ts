// src/lib/__tests__/guestAccentText.test.ts
// Clichet pe SURSĂ: în foile și ecranele oaspetelui din acest registru, nicio
// culoare de TEXT nu e alb fix. Albul fix stătea peste accent (Setări: 7 culori,
// toate sub AA cu albul; auriul implicit 2,66:1) — textul peste accent vine din
// `readableTextOn`, iar accentul folosit ca text din `legibleOn` (lib/themes).
// Paginile QrMenuPage/PublicMenuPage/ProductSheet/MyListSheet au clichetul lor.
//   GA-W1  niciun `color: '#fff'` / `color: cond ? '#fff' : …` / `color={'#fff'}`
//          (și variantele #FFFFFF / white), inclusiv ternare pe mai multe rânduri.
//          Mutația care îl pică: orice `color: '#fff'` readus în aceste fișiere.
//   GA-W2  control POZITIV: scanerul prinde formele vechi și lasă în pace
//          fundalurile albe și `legibleOn(accent, '#FFFFFF')`.
//   GA-A1  accentul NU e culoare de TEXT brută (`color: accent`, `color: q > 0 ?
//          accent : …`): ca text pe fundal deschis auriul implicit are ~2,5:1,
//          deci trece prin `legibleOn`. Recenzia a găsit două scăpări după ce
//          raportul le declara acoperite: cantitatea aleasă din SplitBillSheet și
//          totalul din OrderClosedScreen. Mutația care pică: oricare dintre ele
//          readusă la `accent`. Scutirile au MOTIV și sunt verificate (GA-A3).
//   GA-A2  control POZITIV pentru GA-A1: prinde formele brute, lasă în pace
//          `readableTextOn(accent, …)`, `legibleOn(accent, …)`, `accentInk`,
//          `onAccent`, `borderColor` și prop-ul `color={accent}` al unei grafice.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const FILES: readonly string[] = [
  'src/components/OrderTracker.tsx',
  'src/components/QrCartSheet.tsx',
  'src/components/ReservationSheet.tsx',
  'src/components/PickupCheckoutSheet.tsx',
  'src/components/PayTableSheet.tsx',
  'src/components/SplitBillSheet.tsx',
  'src/components/PaymentConfirmedScreen.tsx',
  'src/components/OrderClosedScreen.tsx',
  'src/components/PhoneInput.tsx',
]

// `color` ca proprietate CSS (`color:`) sau prop (`color=`), urmat — fără să
// treacă de `,` `;` `{` `}` — de un literal alb. Prinde și ternarele pe mai
// multe rânduri; NU prinde `backgroundColor`/`borderColor` (fără limită de
// cuvânt) și nici `legibleOn(accent, '#FFFFFF')` (virgula oprește potrivirea).
const WHITE_TEXT = /\bcolor\s*[:=]\s*\{?[^,;{}]*?['"](?:#fff|#ffffff|white)['"]/gi

function whiteTextHits(src: string): string[] {
  return [...src.matchAll(WHITE_TEXT)].map((m) => m[0].replace(/\s+/g, ' '))
}

// Proprietatea de STIL `color:` urmată — fără să treacă de `,` `;` `{` `}` sau de
// o paranteză (argumentele lui readableTextOn/legibleOn) — de identificatorul
// `accent` ca atare (nu `onAccent`, `accentInk`, `PUB.accent`, `accent(`).
const RAW_ACCENT_TEXT = /\bcolor\s*:\s*[^,;{}()]*?(?<![\w.])accent\b(?![\w(])/g

// Scutiri: (fișier, rând de sursă normalizat) + MOTIV.
const RAW_ACCENT_ALLOWED: ReadonlyArray<{ file: string; line: string; reason: string }> = [
  {
    file: 'src/components/ReservationSheet.tsx',
    line: 'color: accent,',
    reason:
      '„×" în accent pe butonul de închidere al cărui FUNDAL e readableTextOn(accent) — aceeași pereche, contrast ≥4.5:1 prin construcție',
  },
  {
    file: 'src/components/PaymentConfirmedScreen.tsx',
    line: "{T(lang, 'powered_by')} <strong style={{ color: accent }}>Menuvia</strong>",
    reason: 'nume de marcă (WCAG 1.4.3 exceptează logotipurile)',
  },
  {
    file: 'src/components/OrderClosedScreen.tsx',
    line: "{T(lang, 'powered_by')} <strong style={{ color: accent }}>Menuvia</strong>",
    reason: 'nume de marcă (WCAG 1.4.3 exceptează logotipurile)',
  },
]

function rawAccentHits(src: string): Array<{ line: string; at: number }> {
  const lines = src.split('\n')
  return [...src.matchAll(RAW_ACCENT_TEXT)].map((m) => {
    const at = src.slice(0, m.index).split('\n').length
    return { line: (lines[at - 1] ?? '').trim(), at }
  })
}

describe('Fluxul oaspetelui — fără text alb fix (peste accent)', () => {
  it('GA-W1 niciun fișier din registru nu are culoare de text albă fixă', () => {
    const hits: string[] = []
    for (const f of FILES) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8')
      for (const h of whiteTextHits(src)) hits.push(`${f}: ${h}`)
    }
    expect(hits).toEqual([])
  })

  it('GA-W2 control: scanerul prinde formele vechi, nu fundalurile', () => {
    const bad = [
      "color: '#fff',",
      "color: canSubmit ? '#fff' : PUB.text3,",
      "color: '#FFFFFF',",
      "color={'#fff'}",
      "color:\n  phase === 'paid'\n    ? PUB.text\n    : canConfirm\n      ? '#fff'\n      : PUB.text3,",
    ]
    for (const b of bad) expect(whiteTextHits(b), b).toHaveLength(1)
    const ok = [
      "background: '#FFFFFF',",
      "color: legibleOn(accent, '#FFFFFF'),",
      "backgroundColor: '#fff',",
      "borderColor: '#fff',",
      "color: PUB.text,\n  background: '#fff',",
    ]
    for (const o of ok) expect(whiteTextHits(o), o).toHaveLength(0)
  })
})

describe('Fluxul oaspetelui — accentul ca text trece prin legibleOn', () => {
  const allowed = new Set(RAW_ACCENT_ALLOWED.map((a) => `${a.file}|${a.line}`))
  const found = FILES.flatMap((f) =>
    rawAccentHits(readFileSync(resolve(process.cwd(), f), 'utf8')).map((h) => ({ file: f, ...h })),
  )

  it('GA-A1 nicio culoare de text nu e accentul brut, în afara scutirilor', () => {
    expect(
      found
        .filter((h) => !allowed.has(`${h.file}|${h.line}`))
        .map((h) => `${h.file}:${h.at} — ${h.line}`),
    ).toEqual([])
  })

  it('GA-A2 control: scanerul prinde formele brute, nu helperii', () => {
    const bad = [
      'color: accent,',
      'color: q > 0 ? accent : PUB.text2,',
      "<strong style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>",
      'color:\n  isSel\n    ? accent\n    : PUB.text,',
    ]
    for (const b of bad) expect(rawAccentHits(b), b).toHaveLength(1)
    const ok = [
      'color: readableTextOn(accent, PUB.text),',
      'color: legibleOn(accent, PUB.surface),',
      'color: accentInkOnSurface,',
      'color: isConfirmed ? onAccent : accentInk,',
      'borderColor: accent,',
      'background: accent,',
      '<Dot color={accent} top={20} />',
      'color: PUB.accent,',
    ]
    for (const o of ok) expect(rawAccentHits(o), o).toHaveLength(0)
  })

  it('GA-A3 fiecare scutire e încă găsită (registrul nu putrezește)', () => {
    const seen = new Set(found.map((h) => `${h.file}|${h.line}`))
    expect(RAW_ACCENT_ALLOWED.filter((a) => !seen.has(`${a.file}|${a.line}`))).toEqual([])
  })
})
