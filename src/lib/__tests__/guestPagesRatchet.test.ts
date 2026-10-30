// Clichete pe SURSĂ pentru paginile oaspetelui (audit oct 2026). QrMenuPage și
// PublicMenuPage au peste 1700 de linii și zeci de dependențe (RPC-uri, sesiune
// de masă, loyalty, plăți) — un test de randare ar mock-ui mai mult decât ar
// verifica. Comportamentul e testat pe componentele mici (ProductSheet,
// MyListSheet, menuUi); aici se păzește CABLAJUL din pagini.
//
//   GA1  niciun CTA cu alb fix peste accentul temei: textul se alege cu
//        readableTextOn (a11y-guest-cta-white-on-accent / ux-guest-4).
//        Control pozitiv pe un eșantion.
//   GA2  CTA-urile lipite jos respectă bara de home (ux-guest-11):
//        forma `calc(Npx + env(safe-area-inset-bottom, 0px))` numărată.
//   GA3  fișa produsului se deschide pe orice plan pe /q și primește modul
//        corect pe /q și /m; „Lista mea" e MyListSheet (ux-guest-2/3).
//   GA4  reîncercarea comenzii QR folosește detecția comună de rețea, care
//        cunoaște „Load failed" de pe iPhone (ux-guest-9).
//   GA5  dialogurile inline de pe /m sunt dialoguri reale cu capcană de focus
//        (a11y-focus-trap-gaps).
//   GA6  bara de coș își anunță conținutul, iar adăugarea e anunțată
//        (ux-guest-12); `<html lang>` urmează limba (a11y-guest-html-lang).
//
// Fiecare verificare pică pe codul de dinainte (alb fix pe bară, condiția
// `&& orderingAllowed`, lista inline `msg.includes('fetch')`, foaia inline cu
// un singur buton, aria-label fix).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const read = (f: string): string => readFileSync(resolve(process.cwd(), f), 'utf8')

const FILES = {
  qr: 'src/pages/QrMenuPage.tsx',
  pub: 'src/pages/PublicMenuPage.tsx',
  sheet: 'src/components/ProductSheet.tsx',
  list: 'src/components/MyListSheet.tsx',
} as const
const src = {
  qr: read(FILES.qr),
  pub: read(FILES.pub),
  sheet: read(FILES.sheet),
  list: read(FILES.list),
}

// Blocurile `style={{ … }}` (acolade echilibrate), cu linia de început.
function styleBlocks(source: string): Array<{ line: number; body: string }> {
  const out: Array<{ line: number; body: string }> = []
  const re = /style=\{\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    let depth = 2
    let i = m.index + m[0].length
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
      i++
    }
    out.push({
      line: source.slice(0, m.index).split('\n').length,
      body: source.slice(m.index, i),
    })
  }
  return out
}

// Fundal = accentul temei (nu gradientul / varianta soft) + text alb fix.
const ACCENT_BG = /background:\s*[^,\n]*\baccent\b(?!Gradient|Soft)/
const FIXED_WHITE = /\bcolor:\s*[^,\n]*['"]#fff(?:fff)?['"]/i

function whiteOnAccent(source: string): number[] {
  return styleBlocks(source)
    .filter((b) => ACCENT_BG.test(b.body) && FIXED_WHITE.test(b.body))
    .map((b) => b.line)
}

describe('clichete pe sursa paginilor oaspetelui', () => {
  it('GA1 niciun CTA cu alb fix peste accent (control pozitiv pe eșantion)', () => {
    const sample = [
      "<button style={{ background: cart.length > 0 ? accent : PUB.surface, color: cart.length > 0 ? '#fff' : PUB.text }} />",
      "<div style={{ background: accentGradient, color: '#fff' }} />",
      '<button style={{ background: accent, color: readableTextOn(accent, PUB.text) }} />',
    ].join('\n')
    // Doar primul rând e o încălcare: gradientul și readableTextOn sunt permise.
    expect(whiteOnAccent(sample)).toEqual([1])

    for (const [key, file] of Object.entries(FILES)) {
      expect({ file, lines: whiteOnAccent(src[key as keyof typeof src]) }).toEqual({
        file,
        lines: [],
      })
    }
  })

  it('GA2 CTA-urile lipite jos respectă bara de home a iPhone-ului', () => {
    const SAFE = /calc\(\d+px \+ env\(safe-area-inset-bottom, 0px\)\)/g
    const count = (s: string): number => (s.match(SAFE) ?? []).length
    expect(count(src.sheet)).toBeGreaterThanOrEqual(1) // subsolul fișei
    expect(count(src.list)).toBeGreaterThanOrEqual(1) // subsolul „Lista mea"
    expect(count(src.pub)).toBeGreaterThanOrEqual(2) // bara de jos + foaia de ridicare
    expect(count(src.qr)).toBeGreaterThanOrEqual(1) // bara „Comanda mea"
  })

  it('GA3 fișa pe orice plan pe /q; modul corect pe /q și /m; „Lista mea" e foaie proprie', () => {
    expect(src.qr).not.toMatch(/activeProduct != null && orderingAllowed/)
    expect(src.qr).not.toMatch(/if \(orderingAllowed\) setActiveProduct/)
    expect(src.qr).toMatch(/mode=\{orderingAllowed \? 'order' : 'view'\}/)
    expect(src.pub).toMatch(/mode=\{listMode \? 'list' : 'order'\}/)
    expect(src.pub).toMatch(/<MyListSheet\b/)
    // Golirea listei nu mai stă pe butonul unic al foii.
    expect(src.pub).not.toMatch(/if \(cart\.length > 0\) setCart\(\[\]\)/)
  })

  it('GA4 reîncercarea comenzii QR folosește detecția comună de rețea', () => {
    expect(src.qr).toMatch(/isNetworkGuestError\(e\)/)
    expect(src.qr).not.toMatch(/msg\.includes\('fetch'\)/)
  })

  it('GA5 dialogurile inline de pe /m sunt dialoguri modale cu capcană de focus', () => {
    expect((src.pub.match(/<FocusTrap \/>/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect((src.pub.match(/aria-modal="true"/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(src.pub).toMatch(/aria-labelledby="pickup-confirmation-title"/)
    expect(src.pub).toMatch(/id="pickup-confirmation-title"/)
    expect(src.list).toMatch(/<FocusTrap \/>/)
  })

  it('GA6 bara își anunță conținutul, adăugarea e anunțată, `<html lang>` urmează limba', () => {
    for (const s of [src.qr, src.pub]) {
      expect(s).toMatch(/aria-label=\{cartBarLabel\(/)
      expect(s).toMatch(/role="status" aria-live="polite"/)
      expect(s).toMatch(/useDocumentLang\(lang\)/)
    }
    expect(src.qr).not.toMatch(/aria-label=\{T\(lang, 'my_order'\)\}/)
  })
})
