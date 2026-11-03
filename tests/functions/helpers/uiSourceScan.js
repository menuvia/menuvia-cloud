// tests/functions/helpers/uiSourceScan.js
// Scanner comun pentru clichetele de consistență vizuală (lotul V, nov 2026):
// culori hex, butoane stilizate de mână și terminologie. Lucrează pe SURSĂ
// (fără parser TS — directorul e zero-deps), deci regulile sunt deliberat
// simple și au fiecare control pozitiv în testul care le folosește.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..', '..')
const UI_DIRS = ['src/components', 'src/pages']

/** Fișierele .ts/.tsx dintr-un director (recursiv), fără teste. */
function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(rel))
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name)) {
      out.push(rel)
    }
  }
  return out.sort()
}

function uiFiles() {
  return UI_DIRS.flatMap((d) => sourceFiles(d))
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/**
 * Sursa fără comentarii, cu numărul de linii PĂSTRAT (comentariul devine
 * spațiu). Comentariile nu sunt UI: `PR #335` dintr-un comentariu nu e o culoare,
 * iar „KDS" dintr-o explicație nu e text pentru om.
 *  - `//` până la capăt de linie, doar când e precedat de început/spațiu/`{`/`;`/`,`/`)`
 *    (altfel `https://…` dintr-un string ar tăia linia);
 *  - `/* … *\/` (și `{/* … *\/}` din JSX), inclusiv pe mai multe linii, doar
 *    când `/*` e precedat de început/spațiu/`{` — `accept="image/*"` nu deschide
 *    un comentariu.
 */
function stripComments(src) {
  const lines = src.split('\n')
  const out = []
  let inBlock = false
  for (const raw of lines) {
    let line = raw
    let res = ''
    let i = 0
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i)
        if (end === -1) {
          i = line.length
        } else {
          inBlock = false
          i = end + 2
        }
        continue
      }
      const rest = line.slice(i)
      const prev = i === 0 ? '' : line[i - 1]
      const boundary = i === 0 || /[\s{;,(]/.test(prev)
      if (boundary && rest.startsWith('/*')) {
        inBlock = true
        i += 2
        continue
      }
      if (boundary && rest.startsWith('//')) break
      if (/^\s*\*/.test(line) && i === 0 && !res) {
        // continuarea unui bloc `/** … */` scris pe rânduri cu `*`
        break
      }
      res += line[i]
      i++
    }
    out.push(res)
  }
  return out.join('\n')
}

// ── Culori hex ──────────────────────────────────────────────────────────
// #rgb, #rgba, #rrggbb, #rrggbbaa — nu precedat de cuvânt/`&`/`#` (entități
// HTML) și nu urmat de cuvânt/`-`.
const HEX_RE = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g

function hexColors(src) {
  return stripComments(src).match(HEX_RE) || []
}

// rgb()/rgba()/hsl()/hsla() scrise de mână
const FN_COLOR_RE = /\b(?:rgba?|hsla?)\(/g

function fnColors(src) {
  return stripComments(src).match(FN_COLOR_RE) || []
}

// Sufix de alfa lipit de un token: `${D.gold}44` / `D.gold + '44'`. Tokenul e
// `var(--color-gold, #C8963C)`, deci rezultatul e `var(...)44` — CSS INVALID,
// declarația e aruncată și bordura/fundalul dispare tăcut.
const ALPHA_SUFFIX_RE = /\$\{D\.\w+\}[0-9a-fA-F]{2}(?![\w])|\bD\.\w+\s*\+\s*['"][0-9a-fA-F]{2}['"]/g

function alphaSuffixes(src) {
  return stripComments(src).match(ALPHA_SUFFIX_RE) || []
}

// ── Butoane stilizate de mână ───────────────────────────────────────────
/**
 * Câte taguri `<button …>` au `style=` între atributele lor (și forma pe mai
 * multe linii). Tagul se termină la primul `>` aflat în afara acoladelor
 * (`onClick={() => a > b}` nu-l închide).
 */
function styledButtons(src) {
  const s = stripComments(src)
  let count = 0
  const re = /<button\b/g
  let m
  while ((m = re.exec(s)) !== null) {
    let depth = 0
    let quote = ''
    let attrs = ''
    for (let i = m.index + 7; i < s.length; i++) {
      const c = s[i]
      if (quote) {
        if (c === quote) quote = ''
      } else if (depth === 0 && (c === '"' || c === "'")) {
        quote = c
      } else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
      if (depth === 0 || c === '{') attrs += c
    }
    if (/(?:^|\s)style=/.test(attrs)) count++
  }
  return count
}

/**
 * Atributele unui tag JSX care începe la `start` (indexul lui `<`), ca text
 * BRUT (cu tot cu conținutul acoladelor), până la primul `>` aflat în afara
 * acoladelor și a ghilimelelor.
 */
function tagAttrs(s, start, nameLen) {
  let depth = 0
  let quote = ''
  let i = start + 1 + nameLen
  for (; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (depth === 0 && (c === '"' || c === "'")) {
      quote = c
    } else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) break
  }
  return s.slice(start + 1 + nameLen, i)
}

/** Conținutul expresiei `style={…}` de la nivelul de sus al atributelor, sau null. */
function topLevelStyle(attrs) {
  let depth = 0
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (depth === 0 && attrs.startsWith('style={', i) && (i === 0 || /\s/.test(attrs[i - 1]))) {
      let d = 0
      for (let j = i + 6; j < attrs.length; j++) {
        if (attrs[j] === '{') d++
        else if (attrs[j] === '}' && --d === 0) return attrs.slice(i + 7, j)
      }
      return attrs.slice(i + 7)
    }
  }
  return null
}

// Chei de CULOARE/CHENAR: pe <Button> le dă varianta; `style` e doar pentru layout.
const BUTTON_COLOR_KEY_RE = /(?:^|[\s{,])(?:background(?:Color)?|color|border(?:Color)?|boxShadow)\s*:/

/**
 * Câte `<Button …>` (primitiva, și pe mai multe rânduri) au în `style={…}` o
 * cheie de culoare sau chenar — varianta colorată de mână pe care BT1 nu o vede.
 * Un `style` de pe un COPIL (ex. `icon={<Icon style={{ color }} />}`) nu contează.
 */
function coloredButtons(src) {
  const s = stripComments(src)
  let count = 0
  const re = /<Button\b/g
  let m
  while ((m = re.exec(s)) !== null) {
    const style = topLevelStyle(tagAttrs(s, m.index, 6))
    if (style != null && BUTTON_COLOR_KEY_RE.test(style)) count++
  }
  return count
}

// ── Text pentru om ──────────────────────────────────────────────────────
/**
 * Fragmentele de text VIZIBIL dintr-un fișier: literalele de string (`'…'`,
 * `"…"`, `` `…` `` pe un rând) care NU arată a identificator/cheie/rută, plus
 * textul JSX (între `>` și `<`, sau un rând întreg de text într-un bloc JSX —
 * inclusiv un rând cu UN SINGUR cuvânt, dar doar imediat după un tag deschis).
 * Întoarce `{ line, text }`.
 */
function visibleTexts(src) {
  const out = []
  // Ultimul rând ne-gol (după interpolări), pentru regula cuvântului singur.
  let prevTrim = ''
  stripComments(src)
    .split('\n')
    .forEach((line, idx) => {
      const n = idx + 1
      for (const m of line.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`/g)) {
        const text = m[1] ?? m[2] ?? m[3] ?? ''
        // identificator / cheie / rută / clasă CSS: fără spațiu și fără majusculă
        if (!/\s/.test(text) && !/[A-ZĂÂÎȘȚ]/.test(text)) continue
        out.push({ line: n, text })
      }
      // Interpolările `{…}` (și cele imbricate) devin un spațiu înainte de
      // testele pe JSX: `din dashboard pentru {restaurantName}.` e text pentru
      // om, iar acolada nu are voie să-l ascundă (recenzia #336). Literalele de
      // mai sus se citesc din rândul ORIGINAL.
      let plain = line
      for (let prev = ''; prev !== plain; ) {
        prev = plain
        plain = plain.replace(/\{[^{}]*\}/g, ' ')
      }
      // Ghilimelele românești „…" închise cu `"` drept (frecvent în textul JSX)
      // nu sunt cod: ghilimeaua de închidere devine `”`, ca rândul să rămână
      // text și conținutul citat să fie scanat.
      plain = plain.replace(/„([^"„\n]*)"/g, '„$1”')
      // text JSX între taguri pe același rând: `>Text<`
      for (const m of plain.matchAll(/>([^<>{}]*[A-Za-zĂÂÎȘȚăâîșț][^<>{}]*)</g)) {
        out.push({ line: n, text: m[1].trim() })
      }
      // rând întreg de text JSX (fără caractere de cod)
      const t = plain.trim()
      const textLine = t !== '' && !/[{}()<>=;:'"`[\]]/.test(t)
      if (textLine && /[A-Za-zĂÂÎȘȚăâîșț]{2,}\s/.test(t)) {
        out.push({ line: n, text: t })
      } else if (
        // Un SINGUR cuvânt pe rând (`<span>` / `Dashboard` / `</span>`, recenzia
        // #336) e text doar când rândul ne-gol de dinainte se termină cu `>`
        // (tag deschis, nu `=>`): altfel ar fi prinși identificatorii dintr-o
        // destructurare pe mai multe rânduri (`const {` / `owner,`).
        textLine &&
        !/\s/.test(t) &&
        /[A-Za-zĂÂÎȘȚăâîșț]{2,}/.test(t) &&
        endsJsxTag(prevTrim)
      ) {
        out.push({ line: n, text: t })
      }
      if (t !== '') prevTrim = t
    })
  return out
}

// Rândul de dinainte închide un TAG JSX, nu o comparație (`count >` urmat de
// `owner.limit` e cod, recenzia #336): un tag complet pe rând (`<span>`,
// `</div>`, `<Button variant="x">`), un `>` singur (închiderea unui tag scris pe
// mai multe rânduri), un fragment `<>` sau ultimul atribut al unui tag multilinie (`">`, `'>`,
// `}>`). `=>` nu e niciodată tag.
function endsJsxTag(prev) {
  if (!prev.endsWith('>') || prev.endsWith('=>')) return false
  // `>` singur sau deschiderea unui fragment (`<>`) pe rândul ei
  if (prev === '>' || prev.endsWith('<>')) return true
  if (/<\/?[A-Za-z][\w.:-]*(\s[^<>]*)?>$/.test(prev)) return true
  return /["'}]>$/.test(prev)
}

module.exports = {
  ROOT,
  UI_DIRS,
  sourceFiles,
  uiFiles,
  read,
  stripComments,
  hexColors,
  fnColors,
  alphaSuffixes,
  styledButtons,
  coloredButtons,
  visibleTexts,
}
