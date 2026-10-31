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
//        (ux-guest-12): regiunea role="status" există ȘI fiecare append pe
//        coș e urmat de anunț; `<html lang>` urmează limba (a11y-guest-html-lang).
//   GA7  fiecare dialog modal inline (aria-modal + capcană de focus) are o
//        ieșire care DOAR închide — un X cu `T(lang, 'close')` —, altfel
//        capcana de focus devine capcană reală (WCAG 2.1.2). Foaia de bacșiș
//        de pe /q avea doar butoane care TRIMIT cererea de notă, iar coșul de
//        ridicare de pe /m doar „Continuă la ridicare". Control pozitiv pe un
//        eșantion; scutire cu motiv pentru confirmarea ridicării.
//   GA8  tabul de categorie trece prin `selectCategory` pe /q și /m: lista urcă
//        sub bara de categorii (ținta e testată în menuUi, BL3), iar pe /q
//        căutarea se golește (ux-guest-6). Fără clichet, `onSelect` putea
//        reveni la setter-ul gol fără ca vreun test să pice.
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
      expect(s).toMatch(/role="status"\s+aria-live="polite"/)
      expect(s).toMatch(/useDocumentLang\(lang\)/)
    }
    expect(src.qr).not.toMatch(/aria-label=\{T\(lang, 'my_order'\)\}/)

    // Regiunea există, dar trebuie și SCRISĂ: fiecare adăugare în coș (append
    // pe `cart`) e urmată, în cel mult 20 de linii, de anunț. O cale nouă de
    // adăugare fără anunț ar lăsa cititorul de ecran fără confirmare exact pe
    // ea. Anti-vacuitate: /q are patru căi (quick-add, fișă, asocieri,
    // sugestiile din coș), /m una (addToCart, prin care trec toate).
    const ANNOUNCE = /announceAdded\(|setLastAdded\(/
    for (const [file, source, min] of [
      [FILES.qr, src.qr, 4],
      [FILES.pub, src.pub, 1],
    ] as const) {
      const lines = source.split('\n')
      const appends = [...source.matchAll(/setCart\(\((\w+)\) => \[\s*\.\.\.\1,/g)].map(
        (m) => source.slice(0, m.index).split('\n').length - 1,
      )
      const silent = appends.filter((ln) => !ANNOUNCE.test(lines.slice(ln, ln + 20).join('\n')))
      expect({ file, enough: appends.length >= min, silent }).toEqual({
        file,
        enough: true,
        silent: [],
      })
    }
  })

  it('GA7 fiecare dialog modal inline are o ieșire care DOAR închide (fără capcană)', () => {
    // Control pozitiv: extractorul vede dialogul întreg (și copiii lui), iar
    // un dialog fără X e raportat.
    const sample = [
      '<div onClick={() => setOpen(false)}>',
      '  <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={T(lang, \'a\')}>',
      '    <FocusTrap />',
      '    <div style={{ height: 4 }} />',
      "    <div><button onClick={() => send()}>{T(lang, 'send')}</button></div>",
      '  </div>',
      '</div>',
      '<div role="dialog" aria-modal="true" aria-label={T(lang, \'b\')}>',
      "  <button onClick={() => setOpen(false)} aria-label={T(lang, 'close')} />",
      '</div>',
    ].join('\n')
    expect(modalDialogs(sample).map((d) => [d.name, d.hasClose])).toEqual([
      ["{T(lang, 'a')}", false],
      ["{T(lang, 'b')}", true],
    ])

    // Dialogul de confirmare a ridicării are un singur buton, „Mulțumim",
    // care DOAR închide (setConfirmation(null)) — ieșirea există, fără X.
    const NO_X_ALLOWED: Record<string, string> = {
      'pickup-confirmation-title': 'singurul buton („Mulțumim") doar închide confirmarea',
    }
    const found: Array<{ file: string; name: string }> = []
    for (const [file, source] of [
      [FILES.qr, src.qr],
      [FILES.pub, src.pub],
    ] as const) {
      const dialogs = modalDialogs(source)
      // Anti-vacuitate: paginile AU dialoguri inline (bacșiș pe /q; ridicare +
      // confirmare pe /m) — un extractor stricat ar întoarce [] și ar trece.
      expect({ file, n: dialogs.length > 0 }).toEqual({ file, n: true })
      for (const d of dialogs) {
        if (!d.hasClose && !(d.name in NO_X_ALLOWED)) found.push({ file, name: d.name })
      }
    }
    expect(found).toEqual([])
    // Foaia de bacșiș se închide și din tastatură.
    expect(src.qr).toMatch(/e\.key === 'Escape'\) setShowTipSheet\(false\)/)
  })

  it('GA8 tabul de categorie câștigă peste căutare și urcă lista sub bară (ux-guest-6)', () => {
    // Corpul lui `selectCategory`, de la declarație până la `}, [])`.
    const body = (s: string): string => {
      const at = s.indexOf('const selectCategory = useCallback(')
      if (at === -1) return ''
      const end = s.indexOf('\n  }, [])', at)
      return end === -1 ? '' : s.slice(at, end)
    }
    const qr = body(src.qr)
    const pub = body(src.pub)
    // Anti-vacuitate: extractorul găsește funcția în ambele pagini.
    expect(qr).toMatch(/setActiveCatId\(id\)/)
    expect(pub).toMatch(/setActiveCat\(id\)/)
    for (const [file, source, fn] of [
      [FILES.qr, src.qr, qr],
      [FILES.pub, src.pub, pub],
    ] as const) {
      expect({
        file,
        // CategoryTabs primește funcția, nu setter-ul gol al stării.
        wired: /onSelect=\{selectCategory\}/.test(source),
        // Ținta derulării e containerul listei.
        listRef: /ref=\{listRef\}/.test(source),
        scrolls: /listScrollTarget\(/.test(fn) && /window\.scrollTo\(/.test(fn),
        reducedMotion: /prefersReducedMotion\(\)/.test(fn),
      }).toEqual({ file, wired: true, listRef: true, scrolls: true, reducedMotion: true })
    }
    // Pe /q căutarea caută în TOT meniul și ascunde categoria: fără golirea
    // ei, tabul atins în timpul căutării nu schimba nimic pe ecran.
    expect(qr).toMatch(/setSearch\(''\)/)
  })
})

// Dialogurile modale inline (`role="dialog"` + `aria-modal="true"`) dintr-o
// sursă JSX: numele (aria-label / aria-labelledby) și dacă blocul lor conține
// un buton „Închide" (`aria-label={T(lang, 'close')}`). Blocul = de la `<div`
// care poartă role="dialog" până la `</div>`-ul pereche; tag-urile de deschidere
// se citesc până la `>` din afara acoladelor (`onClick={(e) => …}` conține `>`),
// iar `<div … />` nu deschide nimic.
function modalDialogs(source: string): Array<{ name: string; hasClose: boolean }> {
  const out: Array<{ name: string; hasClose: boolean }> = []
  const tagEnd = (from: number): number => {
    let depth = 0
    for (let i = from; i < source.length; i++) {
      const c = source[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) return i
    }
    return source.length
  }
  let at = source.indexOf('role="dialog"')
  while (at !== -1) {
    const start = source.lastIndexOf('<div', at)
    const openEnd = tagEnd(start)
    const opening = source.slice(start, openEnd + 1)
    if (/aria-modal="true"/.test(opening)) {
      let depth = 1
      let i = openEnd + 1
      while (i < source.length && depth > 0) {
        const nextOpen = source.indexOf('<div', i)
        const nextClose = source.indexOf('</div>', i)
        if (nextClose === -1) break
        if (nextOpen !== -1 && nextOpen < nextClose) {
          const e = tagEnd(nextOpen)
          if (source[e - 1] !== '/') depth++
          i = e + 1
        } else {
          depth--
          i = nextClose + '</div>'.length
        }
      }
      const block = source.slice(start, i)
      const name =
        opening.match(/aria-labelledby="([^"]+)"/)?.[1] ??
        opening.match(/aria-label=(\{[^\n]*?\}|"[^"]*")/)?.[1] ??
        ''
      out.push({ name, hasClose: /aria-label=\{T\(lang, 'close'\)\}/.test(block) })
    }
    at = source.indexOf('role="dialog"', at + 1)
  }
  return out
}
