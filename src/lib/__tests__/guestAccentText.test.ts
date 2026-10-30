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
