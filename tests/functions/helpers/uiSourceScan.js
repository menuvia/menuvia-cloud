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

// ── Text pentru om ──────────────────────────────────────────────────────
/**
 * Fragmentele de text VIZIBIL dintr-un fișier: literalele de string (`'…'`,
 * `"…"`, `` `…` `` pe un rând) care NU arată a identificator/cheie/rută, plus
 * textul JSX (între `>` și `<`, sau un rând întreg de text într-un bloc JSX).
 * Întoarce `{ line, text }`.
 */
function visibleTexts(src) {
  const out = []
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
      // text JSX între taguri pe același rând: `>Text<`
      for (const m of line.matchAll(/>([^<>{}]*[A-Za-zĂÂÎȘȚăâîșț][^<>{}]*)</g)) {
        out.push({ line: n, text: m[1].trim() })
      }
      // rând întreg de text JSX (fără caractere de cod)
      const t = line.trim()
      if (t && !/[{}()<>=;:'"`[\]]/.test(t) && /[A-Za-zĂÂÎȘȚăâîșț]{2,}\s/.test(t)) {
        out.push({ line: n, text: t })
      }
    })
  return out
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
  visibleTexts,
}
