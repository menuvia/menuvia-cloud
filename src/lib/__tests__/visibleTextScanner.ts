// src/lib/__tests__/visibleTextScanner.ts — scanerul de text vizibil scris
// direct în sursă, comun clichetelor de limbă (NU e fișier de test).
//   guestI18n.test.ts  fluxul oaspetelui: zero texte în afara T()/Tf()
//   staffI18n.test.ts  ecranele personalului: baseline per fișier care doar scade
// Un lexer mic, fără dependențe: ignoră comentariile și regex-urile, prinde
// textul JSX, atributele vizibile (aria-label/title/placeholder/alt/label) și
// orice alt șir cu diacritice sau cuvinte românești. Jurnalele de consolă și
// erorile aruncate nu ajung pe ecran, deci nu se numără.
// ATENȚIE: scanerul nu se scanează pe sine — nu-l adăuga în listele clichetelor.
// ── Fluxul oaspetelui: fișierele pe care le vede un client, nu staff-ul ──
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export const GUEST_FILES: readonly string[] = [
  'src/pages/QrMenuPage.tsx',
  'src/pages/PublicMenuPage.tsx',
  'src/pages/ReservePage.tsx',
  'src/components/QrCartSheet.tsx',
  'src/components/ProductSheet.tsx',
  'src/components/MyListSheet.tsx',
  'src/components/OrderTracker.tsx',
  'src/components/PayTableSheet.tsx',
  'src/components/SplitBillSheet.tsx',
  'src/components/PickupCheckoutSheet.tsx',
  'src/components/ReservationSheet.tsx',
  'src/components/PaymentConfirmedScreen.tsx',
  'src/components/OrderClosedScreen.tsx',
  'src/components/PhoneInput.tsx',
  'src/components/menu/AllergenIcons.tsx',
  'src/components/menu/CategoryTabs.tsx',
  'src/components/menu/FlipbookViewer.tsx',
  'src/components/menu/FloorPlanViewer.tsx',
  'src/components/menu/MenuBrandBadge.tsx',
  'src/components/menu/MenuHeader.tsx',
  'src/components/menu/MenuStates.tsx',
  'src/components/menu/ProductCard.tsx',
  'src/components/menu/ProductGridCard.tsx',
  'src/components/menu/ProductMinimalRow.tsx',
  'src/components/menu/ProductPhotoCard.tsx',
]

export type FragmentKind = 'jsx' | 'attr' | 'str'
export interface Fragment {
  text: string
  line: number
  kind: FragmentKind
}

const VISIBLE_ATTR = /(?:aria-label|title|placeholder|alt|label)\s*=\s*\{?\s*$/
const RO_DIACRITIC = /[ăâîșțşţĂÂÎȘȚŞŢ]/
// Cuvinte românești FĂRĂ diacritice frecvente în UI („Eroare la trimiterea
// comenzii", „Epuizat") — diacriticele singure ratau o parte din clasă.
const RO_WORDS =
  /\b(?:eroare|comanda|comenzii|comenzi|meniul|masa|mesei|plata|pentru|este|nu|sau|trimite|cere|nota|momentan|conexiune|disponibil|produse|produsul|rezervare|rezervarea|ridicare|epuizat|de la|alergeni|calorii|proteine|obligatoriu|ales|specialitate|cantitate|mai multe|persoane|telefon|nume|inapoi)\b/i

/** Un fragment e „text vizibil scris direct": orice text JSX sau atribut
 *  vizibil cu litere; orice alt șir cu diacritice/cuvinte românești. */
export function isVisibleLiteral(f: Fragment): boolean {
  if (f.kind === 'jsx' || f.kind === 'attr') return /\p{L}{2,}/u.test(f.text)
  return RO_DIACRITIC.test(f.text) || RO_WORDS.test(f.text)
}

export function normalize(t: string): string {
  // Resturile de tag (`>` / `/>`) prinse la începutul unui text JSX se scot.
  return t.replace(/^\s*\/?>/, '').replace(/\s+/g, ' ').trim()
}

export function extractFragments(src: string): Fragment[] {
  const out: Fragment[] = []
  const n = src.length
  const tplStack: Array<{ depth: number; kind: FragmentKind }> = []
  let i = 0
  let line = 1
  let braceDepth = 0
  let prevSig = ''
  const push = (text: string, l: number, kind: FragmentKind): void => {
    if (text.trim().length > 0) out.push({ text, line: l, kind })
  }
  const kindAt = (pos: number): FragmentKind =>
    VISIBLE_ATTR.test(src.slice(Math.max(0, pos - 40), pos)) ? 'attr' : 'str'
  // Text JSX după `>` (sau după `}` doar dacă se termină într-un tag);
  // dacă fragmentul arată a cod (generic, comparație, instrucțiune) nu consumă.
  const jsxText = (start: number, requireTag: boolean): number => {
    let j = start
    let s = ''
    let nl = 0
    while (j < n && !'<{}\'"`'.includes(src[j])) {
      if (src[j] === '\n') nl++
      s += src[j]
      j++
    }
    const codeLike =
      /^\s*[(),;.[\]?:=|&]/.test(s) ||
      /\w\(\s*$/.test(s) ||
      /\/\/|\/\*|=>|&&|\|\||===|!==|\b(?:return|const|let|function|if|else|as|export|import|type|interface|try|catch|finally)\b/.test(s)
    const ends = requireTag ? src[j] === '<' : src[j] === '<' || src[j] === '{'
    if (!ends || codeLike) return start
    push(s, line + (s.match(/^\s*/)?.[0].split('\n').length ?? 1) - 1, 'jsx')
    line += nl
    return j
  }
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '\n') {
      line++
      i++
      continue
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const l0 = line
      const kind = kindAt(i)
      let j = i + 1
      let s = ''
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') {
          s += src[j + 1]
          j += 2
          continue
        }
        if (src[j] === '\n') break
        s += src[j]
        j++
      }
      push(s, l0, kind)
      i = src[j] === '\n' ? j : j + 1
      prevSig = c
      continue
    }
    const top = tplStack[tplStack.length - 1]
    const closesTpl = c === '}' && top !== undefined && top.depth === braceDepth - 1
    if (c === '`' || closesTpl) {
      const kind: FragmentKind = closesTpl && top ? top.kind : kindAt(i)
      if (closesTpl) {
        tplStack.pop()
        braceDepth--
      }
      const l0 = line
      let j = i + 1
      let s = ''
      while (j < n) {
        const e = src[j]
        if (e === '\\') {
          s += src[j + 1]
          j += 2
          continue
        }
        if (e === '`') {
          j++
          break
        }
        if (e === '$' && src[j + 1] === '{') {
          tplStack.push({ depth: braceDepth, kind })
          braceDepth++
          j += 2
          break
        }
        if (e === '\n') line++
        s += e
        j++
      }
      push(s, l0, kind)
      i = j
      prevSig = '`'
      continue
    }
    if (c === '{') {
      braceDepth++
      i++
      prevSig = c
      continue
    }
    if (c === '}') {
      braceDepth--
      i = jsxText(i + 1, true)
      prevSig = c
      continue
    }
    if (c === '/' && /^[(,=:[!&|?;{}]?$/.test(prevSig)) {
      let j = i + 1
      let inClass = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) break
        j++
      }
      i = j + 1
      prevSig = '/'
      continue
    }
    if (c === '>' && prevSig !== '=' && prevSig !== '-') {
      i = jsxText(i + 1, false)
      prevSig = '>'
      continue
    }
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  return out
}

export interface Hit {
  file: string
  text: string
  where: string
}

export function scanSource(file: string, src: string): Hit[] {
  const lines = src.split('\n')
  return extractFragments(src)
    .filter((f) => isVisibleLiteral(f))
    // Jurnalele de consolă și erorile aruncate nu ajung pe ecranul oaspetelui.
    .filter((f) => !/console\.|throw new Error/.test(lines[f.line - 1] ?? ''))
    .map((f) => ({ file, text: normalize(f.text), where: `${file}:${f.line}` }))
}

// ── Suprafața personalului (staffI18n.test.ts, SK5) ──────────────────────
// Toate componentele `.tsx` din `src/` care NU sunt ale oaspetelui și nu sunt
// teste. Fișierele `.ts` (tabele de mesaje din lib/) se mută pe dicționare
// lot cu lot, prin `describeStaffError`; clichetul de bază numără UI-ul.
export function listStaffFiles(root: string): string[] {
  const guest = new Set(GUEST_FILES)
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const ent of readdirSync(join(root, rel), { withFileTypes: true })) {
      const p = `${rel}/${ent.name}`
      if (ent.isDirectory()) {
        if (ent.name === '__tests__' || p === 'src/i18n/ns') continue
        walk(p)
      } else if (/\.tsx$/.test(ent.name) && !/\.(test|spec)\.tsx$/.test(ent.name) && !guest.has(p)) {
        out.push(p)
      }
    }
  }
  walk('src')
  return out.sort()
}
