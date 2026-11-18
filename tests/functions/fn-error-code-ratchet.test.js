// tests/functions/fn-error-code-ratchet.test.js
// CLICHET (lotul L8d): fiecare răspuns de EROARE al funcțiilor Netlify pe care
// le cheamă ecranele PERSONALULUI poartă un `code` stabil.
//
// De ce: clientul traduce pe `code` în limba personalului (textul `error`
// rămâne românesc, pentru clienții vechi și pentru ecranele în română — regula
// `describeStaffError`). Un răspuns fără cod nu poate fi tradus: în altă limbă
// decât româna omul vede doar mesajul generic, iar o ramură nouă scrisă de mână
// ar reintroduce clasa fără să pice nimic. Funcțiile oaspetelui (table-payment)
// trec prin `describeGuestError`; cele ale paginilor publice (codvia-order,
// recrutare-contact) rămân în română prin decizie — nu sunt aici.
//
//   FEC0 CONTROL POZITIV pe surse SINTETICE: scanerul prinde un răspuns fără
//        cod, un cod doar într-un ȘIR sau într-un obiect IMBRICAT, un răspuns
//        scris de mână cu `statusCode` literal, un cod ne-literal la `fail`/
//        `aiError`; NU numără apelurile din comentarii, din șiruri sau din
//        definițiile helperilor și trece de un regex cu ghilimele și de un
//        șablon cu `${…}` (formele care păcăleau o căutare pe text).
//   FEC1 în cele opt funcții, fiecare apel `jsonResponse(<non-2xx>, {…})` are
//        cheia `code` la PRIMUL nivel al obiectului; `fail(…)` (send-invite) și
//        `aiError(…)` (AI) au codul ca șir literal ne-gol; niciun `statusCode`
//        literal 4xx/5xx în afara formei TEXT a lui 405 (SC1 o îngheață).
//        [PICĂ: `code: 'rate_limited'` scos din 429-ul lui stripe-portal]
//   FEC2 registrul e EXACT: numărul de răspunsuri de eroare per fișier e cel
//        din `EXPECTED` — o ramură nouă cere actualizarea registrului ȘI a
//        testului de comportament al funcției (SCK1 / SPT4 / SCN1 …), una
//        scoasă la fel. Anti-vacuitate: fiecare fișier are ≥ 1 răspuns.
//        [PICĂ: un `return jsonResponse(503, { error: 'x', code: 'y' })` nou]
//   FEC3 corpul cererii trece, în fiecare dintre cele opt funcții, printr-un
//        SINGUR `parseObjectBody(event.body)` (lib/jsonBody.js) și prin niciun
//        `JSON.parse(…event.body…)` direct: `JSON.parse('null')` reușește, iar
//        citirea de după arunca un TypeError neprins (un 5xx fără `code`, pe
//        șapte din opt funcții). Control pozitiv pe surse sintetice (formele
//        `event.body ? JSON.parse(event.body) : {}` și `|| '{}'` sunt prinse;
//        comentariile, șirurile și un `JSON.parse(text)` oarecare nu).
//        Comportamentul e JB3 din json-body.test.js.
//        [PICĂ: oricare funcție readusă la `JSON.parse(event.body || '{}')`]
//
// (Prefixul FEC: FE1–FE4 sunt ale bridge-ului, iar FE1/FE2 ale FloorPlanEditor
// — verificat cu grep în src/, tests/, bridge/, supabase/tests.)
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

// Fișier → numărul EXACT de răspunsuri de eroare (non-2xx) trecute prin
// contract. Funcțiile AI și send-invite aveau deja codul pe fiecare ramură
// (lib/aiErrors.js, AEC1–AEC5; `fail()`, L6b); cele trei Stripe l-au primit în L8d.
const EXPECTED = {
  'netlify/functions/stripe-checkout.js': 15,
  'netlify/functions/stripe-portal.js': 9,
  'netlify/functions/stripe-connect.js': 12,
  'netlify/functions/send-invite.js': 15,
  'netlify/functions/ai-proxy.js': 22,
  'netlify/functions/ai-config.js': 16,
  'netlify/functions/ai-generate-image.js': 23,
  'netlify/functions/ai-credits-checkout.js': 12,
}

// ── Lexer minimal ─────────────────────────────────────────────────────────────
// Întoarce sursa cu comentariile și CONȚINUTUL șirurilor / regex-urilor /
// textului din șabloane înlocuite cu spații (pozițiile rămân aceleași; ghilimelele
// și codul din `${…}` rămân). Pe sursa mascată, o căutare pe `fail(` nu mai vede
// text din comentarii sau din șiruri, iar acoladele dintr-un șir nu mai strică
// echilibrul unui obiect.
const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])

function maskSource(src) {
  const out = src.split('')
  const n = src.length
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  let lastSig = ''
  let lastWord = ''
  let depth = 0
  const tpl = [] // adâncimea acoladelor la care s-a deschis fiecare `${`
  let inTpl = false

  const readTplText = () => {
    // Suntem în textul unui șablon: până la ` (închis) sau ${ (cod).
    const start = i
    while (i < n) {
      if (src[i] === '\\') {
        i += 2
        continue
      }
      if (src[i] === '`') {
        blank(start, i)
        i++
        inTpl = false
        lastSig = 'x'
        return
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(start, i)
        i += 2
        depth++
        tpl.push(depth)
        inTpl = false
        lastSig = '{'
        return
      }
      i++
    }
    blank(start, n)
  }

  while (i < n) {
    if (inTpl) {
      readTplText()
      continue
    }
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i)
      const end = e < 0 ? n : e
      blank(i, end)
      i = end
      continue
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? n : e + 2
      blank(i, end)
      i = end
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      blank(i + 1, j)
      i = j + 1
      lastSig = 'x'
      lastWord = ''
      continue
    }
    if (c === '`') {
      i++
      inTpl = true
      continue
    }
    if (c === '/' && (REGEX_PREV.has(lastSig) || lastWord === 'return' || lastWord === 'typeof')) {
      let j = i + 1
      let cls = false
      while (j < n) {
        const ch = src[j]
        if (ch === '\\') {
          j += 2
          continue
        }
        if (ch === '[') cls = true
        else if (ch === ']') cls = false
        else if (ch === '/' && !cls) break
        else if (ch === '\n') break
        j++
      }
      blank(i + 1, j)
      i = j + 1
      while (i < n && /[a-z]/i.test(src[i])) i++ // flag-urile
      lastSig = 'x'
      lastWord = ''
      continue
    }
    if (c === '{') depth++
    if (c === '}') {
      if (tpl.length && tpl[tpl.length - 1] === depth) {
        tpl.pop()
        depth--
        i++
        inTpl = true
        continue
      }
      depth--
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++
      lastWord = src.slice(i, j)
      lastSig = 'x'
      i = j
      continue
    }
    lastSig = c
    lastWord = ''
    i++
  }
  return out.join('')
}

// Argumentele de la primul nivel ale apelului care începe la `open` (poziția
// parantezei), pe sursa MASCATĂ: [[start, end], …].
function callArgs(masked, open) {
  const args = []
  let depth = 0
  let start = open + 1
  for (let k = open; k < masked.length; k++) {
    const ch = masked[k]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        args.push([start, k])
        return args
      }
    } else if (ch === ',' && depth === 1) {
      args.push([start, k])
      start = k + 1
    }
  }
  throw new Error('apel neînchis')
}

// Obiectul literal din [a, b) are cheia `code` la PRIMUL nivel?
function hasTopLevelCode(masked, a, b) {
  const text = masked.slice(a, b).trim()
  if (!text.startsWith('{')) return false
  let depth = 0
  let flat = ''
  for (const ch of text) {
    if (ch === '{' || ch === '[' || ch === '(') depth++
    if (depth === 1) flat += ch
    if (ch === '}' || ch === ']' || ch === ')') depth--
  }
  return /[{,]\s*code\s*(?::|,|\})/.test(flat)
}

// Un șir literal ne-gol (pe sursa ORIGINALĂ: masca i-a golit conținutul).
function literalString(src, a, b) {
  const raw = src.slice(a, b).trim()
  const m = /^(['"])([a-z0-9_:]+)\1$/.exec(raw)
  return m ? m[2] : null
}

/** Răspunsurile de eroare ale unei surse: [{ line, kind, ok, why }]. */
function scanErrorResponses(src) {
  const masked = maskSource(src)
  const found = []
  const lineOf = (pos) => src.slice(0, pos).split('\n').length
  const re = /(^|[^.\w$])(jsonResponse|fail|aiError)\s*\(/g
  let m
  while ((m = re.exec(masked))) {
    const name = m[2]
    const open = m.index + m[0].length - 1
    const before = masked.slice(Math.max(0, m.index - 12), m.index + m[1].length)
    if (/function\s*$/.test(before)) continue // definiția helperului
    const args = callArgs(masked, open)
    const statusTxt = src.slice(args[0][0], args[0][1]).trim()
    const line = lineOf(open)
    if (name === 'jsonResponse') {
      if (!/^\d{3}$/.test(statusTxt)) {
        found.push({ line, kind: name, ok: false, why: `status ne-literal „${statusTxt}"` })
        continue
      }
      if (statusTxt.startsWith('2')) continue
      const ok = args.length >= 2 && hasTopLevelCode(masked, args[1][0], args[1][1])
      found.push({ line, kind: name, status: statusTxt, ok, why: ok ? '' : 'fără `code` la primul nivel' })
    } else {
      const code = args.length >= 2 ? literalString(src, args[1][0], args[1][1]) : null
      found.push({ line, kind: name, status: statusTxt, ok: !!code, why: code ? '' : 'cod ne-literal sau gol' })
    }
  }
  // Răspunsuri scrise de mână: `statusCode: 4xx/5xx` literal. Singura formă
  // admisă e 405 TEXT (`body: 'Method not allowed'`), contractul SC1.
  const lit = /statusCode\s*:\s*([45]\d\d)/g
  while ((m = lit.exec(masked))) {
    const tail = src.slice(m.index, m.index + 80)
    if (/^statusCode:\s*405,\s*body:\s*'Method not allowed'\s*\}/.test(tail)) continue
    found.push({ line: lineOf(m.index), kind: 'statusCode', status: m[1], ok: false, why: 'răspuns scris de mână' })
  }
  return found
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** Citirile corpului cererii: câte `parseObjectBody(event.body)` și câte
 *  `JSON.parse(…)` care primesc `event.body` direct (pe sursa MASCATĂ). */
function bodyReads(src) {
  const masked = maskSource(src)
  const helper = (masked.match(/(^|[^.\w$])parseObjectBody\s*\(\s*event\.body\s*\)/g) || []).length
  let direct = 0
  const re = /(^|[^.\w$])JSON\.parse\s*\(/g
  let m
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1
    const args = callArgs(masked, open)
    if (args.length && /\bevent\.body\b/.test(masked.slice(args[0][0], args[0][1]))) direct++
  }
  return { helper, direct }
}

describe('FEC0: scanerul, pe surse sintetice', () => {
  const bad = (src) => scanErrorResponses(src).filter((f) => !f.ok)

  it('prinde formele greșite', () => {
    assert.equal(bad("return jsonResponse(503, { error: 'x' })").length, 1)
    // `code` doar într-un șir sau într-un obiect imbricat NU contează.
    assert.equal(bad("return jsonResponse(503, { error: 'code: fals', meta: { code: 'n' } })").length, 1)
    assert.equal(bad("return { statusCode: 500, body: JSON.stringify({ error: 'x' }) }").length, 1)
    assert.equal(bad("return fail(400, code, 'x')").length, 1)
    assert.equal(bad('return aiError(400)').length, 1)
    assert.equal(bad("return jsonResponse(status, { error: 'x', code: 'y' })").length, 1)
  })

  it('trece formele corecte și nu numără ce nu e cod', () => {
    const ok = [
      "return jsonResponse(503, { error: 'x', code: 'y' })",
      "return jsonResponse(400, { code, error: 'x' })",
      "return fail(400, 'bad_json', 'x')",
      "return aiError(403, 'forbidden')",
      "return jsonResponse(200, { url: session.url })",
      "return { statusCode: 405, body: 'Method not allowed' }",
    ]
    for (const src of ok) assert.deepEqual(bad(src), [], src)
    // Comentarii, șiruri și definițiile helperilor nu sunt răspunsuri.
    const noise = [
      "// return jsonResponse(500, { error: 'x' })",
      "/* fail(400, x) */ const a = 1",
      "const s = 'jsonResponse(500, {})'",
      'function fail(statusCode, code, error) { return { statusCode, body: JSON.stringify({ error, code }) } }',
      "function aiError(statusCode, code) { return { statusCode } }",
    ]
    for (const src of noise) assert.deepEqual(scanErrorResponses(src), [], src)
  })

  it('trece de un regex cu ghilimele și de un șablon cu ${…}', () => {
    const src = [
      `const h = s.replace(/"/g, '&quot;').replace(/'/g, '&#39;')`,
      "const t = `a ${b ? '}' : '{'} c`",
      'return jsonResponse(403, { error: `Planul ${x} cere ofertă`, code: \'plan_requires_quote\' })',
      "return jsonResponse(500, { error: `{${y}}` })",
    ].join('\n')
    const found = scanErrorResponses(src)
    assert.equal(found.length, 2)
    assert.deepEqual(found.map((f) => f.ok), [true, false])
  })
})

describe('FEC3: citirea corpului, pe surse sintetice', () => {
  it('prinde JSON.parse direct pe event.body și nimic altceva', () => {
    assert.deepEqual(bodyReads('body = event.body ? JSON.parse(event.body) : {}'), { helper: 0, direct: 1 })
    assert.deepEqual(bodyReads("payload = JSON.parse(event.body || '{}')"), { helper: 0, direct: 1 })
    assert.deepEqual(bodyReads('body = parseObjectBody(event.body)'), { helper: 1, direct: 0 })
    const noise = [
      '// body = JSON.parse(event.body)',
      "const s = 'JSON.parse(event.body)'",
      'const data = JSON.parse(text)',
      'const r = JSON.parse(await res.text())',
      '// parseObjectBody(event.body)',
    ].join('\n')
    assert.deepEqual(bodyReads(noise), { helper: 0, direct: 0 })
  })
})

describe('FEC1–FEC3: funcțiile ecranelor personalului', () => {
  const results = Object.fromEntries(Object.keys(EXPECTED).map((f) => [f, scanErrorResponses(read(f))]))

  it('FEC1: fiecare răspuns de eroare are un cod stabil', () => {
    const problems = []
    for (const [f, found] of Object.entries(results)) {
      for (const r of found) if (!r.ok) problems.push(`${f}:${r.line} ${r.kind}(${r.status ?? '?'}) — ${r.why}`)
    }
    assert.deepEqual(problems, [])
  })

  it('FEC2: registrul e exact, iar fiecare fișier are răspunsuri', () => {
    const drift = []
    for (const [f, found] of Object.entries(results)) {
      assert.ok(found.length >= 1, `${f}: niciun răspuns de eroare găsit — scanerul nu vede fișierul`)
      if (found.length !== EXPECTED[f]) drift.push(`${f}: ${found.length} răspunsuri, registrul spune ${EXPECTED[f]}`)
    }
    assert.deepEqual(drift, [])
  })

  it('FEC3: corpul trece printr-un singur parseObjectBody, niciodată prin JSON.parse direct', () => {
    const problems = []
    for (const f of Object.keys(EXPECTED)) {
      const src = read(f)
      const { helper, direct } = bodyReads(src)
      if (!src.includes("require('./lib/jsonBody')")) problems.push(`${f}: nu folosește lib/jsonBody`)
      if (helper !== 1) problems.push(`${f}: ${helper} apeluri parseObjectBody(event.body), nu 1`)
      if (direct !== 0) problems.push(`${f}: ${direct} JSON.parse(…event.body…) direct`)
    }
    assert.deepEqual(problems, [])
  })
})
