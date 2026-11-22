// tests/functions/posthog-env.test.js
// CLICHET: cheia PostHog ajunge DOAR în build-ul de PRODUCȚIE.
//
// `VITE_POSTHOG_KEY` e o cheie de proiect `phc_` — PUBLICĂ prin construcție (o
// citește oricine din JS-ul paginii), deci stă în repo. Riscul nu e scurgerea
// ei, ci LOCUL: o cheie pusă în `[build.environment]` sau într-un context de
// preview ar trimite în proiectul de producție evenimentele fiecărui deploy
// preview, ale fiecărui branch deploy și ale E2E-ului — cifre false de
// activare exact în pâlnia pe care o măsurăm. Valoarea din netlify.toml bate
// UI-ul Netlify DOAR în contextele în care fișierul SETEAZĂ cheia: un
// `VITE_POSTHOG_KEY` pus în UI pe „toate contextele” ar ajunge altfel în
// preview-uri. De aceea fișierul o setează EXPLICIT GOALĂ peste tot în afara
// producției, iar el rămâne sursa de adevăr pentru contexte.
//
//   PE1  în netlify.toml, cheia `phc_` apare O SINGURĂ dată, în
//        `[context.production.environment]`, ca `VITE_POSTHOG_KEY`.
//   PE2  hostul de producție e cel UE (eu.i.posthog.com) — politica promite
//        PostHog Cloud UE; un host US ar muta datele în SUA tăcut.
//   PE3  în afara producției singura linie PostHog permisă e `VITE_POSTHOG_KEY =
//        ""`, și ea e OBLIGATORIE în `[build.environment]` (baza oricărui context
//        nou și a lui `netlify dev`) și în FIECARE `[context.*.environment]`.
//        Mutațiile care pică: o cheie reală în preview, linia goală ștearsă dintr-un
//        context, un context nou fără ea.
//   PE4  deploy-vps.yml (producția de rezervă) construiește cu ACEEAȘI cheie și
//        același host UE, citite din maparea `env:` a pasului care rulează
//        `npm run build` (parsată, nu regex: o linie COMENTATĂ nu contează).
//   PE5  în fișierele pe care git le-ar comite (urmărite + neignorate), un token
//        `phc_` real apare doar în cele două fișiere — nu și în cele ignorate
//        (`netlify.toml.bak`, `node_modules/`).
//   PE6  anti-vacuitate: parserul vede contextele cunoscute.
//   PE7  niciun alt loc din .github/workflows nu setează și nu pomenește
//        `VITE_POSTHOG_*` — nici dintr-o expresie (`${{ vars.X }}`, `${{
//        secrets.X }}`), nici prin `$GITHUB_ENV` într-un `run:` (CI/E2E/Lighthouse
//        rămân fără analytics).
//   PE8  control pozitiv pe parserul de workflow: comentariile nu se citesc,
//        expresiile și `$GITHUB_ENV` se văd, iar formele pe care nu le înțelege
//        ARUNCĂ (nu se sar tăcut).
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const TOML = path.join(ROOT, 'netlify.toml')
const WORKFLOWS = path.join(ROOT, '.github', 'workflows')
const VPS = path.join(WORKFLOWS, 'deploy-vps.yml')
const BUILD_STEP = 'jobs.deploy.steps[Install + build (env de producție)]'
const NEEDLE = 'VITE_POSTHOG_'
const EU_HOST = 'https://eu.i.posthog.com'
// Un token de proiect real: prefixul + cel puțin 30 de caractere. Placeholder-ele
// din documentație (`phc_xxx`) nu se potrivesc.
const KEY_RE = /phc_[A-Za-z0-9]{30,}/g
const HAS_KEY = new RegExp(KEY_RE.source)
const EMPTY_KEY_LINE = /^VITE_POSTHOG_KEY\s*=\s*""$/

/** Secțiunile TOML (antet → linii), fără comentarii. */
function tomlSections(text) {
  const out = new Map()
  let cur = '(root)'
  out.set(cur, [])
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (line.startsWith('#') || line === '') continue
    const h = /^\[\[?([^\]]+)\]\]?$/.exec(line)
    if (h) {
      cur = h[1].trim()
      if (!out.has(cur)) out.set(cur, [])
      continue
    }
    out.get(cur).push(line)
  }
  return out
}

function tomlValue(lines, key) {
  for (const l of lines) {
    const m = new RegExp(`^${key}\\s*=\\s*"([^"]*)"$`).exec(l)
    if (m) return m[1]
  }
  return null
}

// ── Workflow-uri: citire structurală minimă (fără bibliotecă YAML) ────────

/** Valoarea unui scalar YAML pe o linie, fără ghilimele. */
function unquote(v) {
  const s = /^'(.*)'$/.exec(v)
  if (s) return s[1].replace(/''/g, "'")
  const d = /^"(.*)"$/.exec(v)
  if (d) return d[1].replace(/\\(.)/g, '$1')
  return v
}

/**
 * Linia fără comentariul YAML. `#` începe un comentariu doar la început sau după
 * spațiu, și doar în afara unui scalar între ghilimele; o ghilimea deschide un
 * scalar doar la începutul unei valori (după `:`, `-`, `[`, `{`, `,`), altfel e
 * un caracter oarecare (`echo it's`). `open` = ghilimeaua nu se închide pe linie.
 */
function stripComment(line) {
  let q = null
  let prev = ''
  for (let j = 0; j < line.length; j++) {
    const c = line[j]
    if (q === "'") {
      if (c === "'") {
        if (line[j + 1] === "'") j++
        else q = null
      }
      continue
    }
    if (q === '"') {
      if (c === '\\') j++
      else if (c === '"') q = null
      continue
    }
    if (c === '#' && (j === 0 || line[j - 1] === ' ' || line[j - 1] === '\t')) {
      return { text: line.slice(0, j).trimEnd(), open: false }
    }
    if ((c === "'" || c === '"') && ['', ':', '-', '[', '{', ',', '?'].includes(prev)) {
      q = c
      continue
    }
    if (c !== ' ' && c !== '\t') prev = c
  }
  return { text: line.trimEnd(), open: q !== null }
}

function pathOf(snapshot) {
  let out = ''
  for (const e of snapshot) out += e.key === '-' ? `[${e.name ?? '?'}]` : out === '' ? e.key : `.${e.key}`
  return out
}

/**
 * Citire STRUCTURALĂ minimă a unui workflow GitHub Actions. Întoarce:
 *   envs      fiecare mapare `env:` (de workflow, job, pas, serviciu), cu calea
 *             ei (`jobs.deploy.steps[<name>].env`) și intrările `CHEIE: valoare`;
 *   runs      corpurile `run:` (bloc sau pe linie), cu calea pasului;
 *   mentions  liniile care conțin `needle` în afara comentariilor YAML (inclusiv
 *             în corpurile `run:` — acolo `#` e shell, deci se numără).
 * Orice formă pe care nu o înțelege ARUNCĂ, cu fișier:linie — nu o sare: o
 * mapare citită greșit ar face poarta moartă.
 */
function parseWorkflow(text, file, needle) {
  const lines = text.split('\n')
  const stack = [] // { indent, key, name? } — key '-' = element de secvență
  const envs = []
  const runs = []
  const mentions = []
  let block = null // scalar-bloc în curs: { indent, run }
  let env = null // mapare env: în curs: { indent, childIndent, map }
  let cont = null // coloana cheii al cărei scalar simplu poate continua pe liniile următoare
  const fail = (i, why) => {
    throw new Error(`${file}:${i + 1}: ${why}`)
  }
  const popTo = (col, keepParentKey) => {
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top.indent > col || (top.indent === col && (!keepParentKey || top.key === '-'))) stack.pop()
      else break
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    const lead = /^[ \t]*/.exec(raw)[0]
    if (lead.includes('\t') && raw.trim() !== '') fail(i, 'tab în indentare')
    const ind = lead.length

    if (block) {
      if (raw.trim() === '' || ind > block.indent) {
        if (raw.includes(needle)) mentions.push(i + 1)
        if (block.run) block.run.lines.push(raw.trim())
        continue
      }
      block = null
    }

    const { text: line, open } = stripComment(raw)
    if (open) fail(i, 'scalar între ghilimele pe mai multe linii')
    if (line.trim() === '') continue
    if (line.includes(needle)) mentions.push(i + 1)
    let rest = line.slice(ind)
    if (ind === 0 && (rest === '---' || rest === '...')) continue

    if (env) {
      if (ind > env.indent) {
        if (env.childIndent === null) env.childIndent = ind
        if (ind !== env.childIndent) fail(i, 'valoare pe mai multe linii sau structură imbricată în env:')
        const m = /^("([^"]*)"|'([^']*)'|[A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s+(.*))?$/.exec(rest)
        if (!m) fail(i, `intrare env: necunoscută: ${rest}`)
        const key = m[2] ?? m[3] ?? m[1]
        const value = (m[4] ?? '').trim()
        if (value === '' || /^[|>&*![{]/.test(value)) fail(i, `valoare env: nesuportată pentru ${key}: ${value}`)
        env.map.entries.push({ key, value: unquote(value), line: i + 1 })
        continue
      }
      if (env.map.entries.length === 0) fail(i, 'env: fără intrări')
      env = null
    }

    if (cont !== null && ind > cont) continue // scalar simplu continuat pe linia următoare
    cont = null

    let col = ind
    let afterDash = false
    if (rest === '-' || rest.startsWith('- ')) {
      popTo(col, true)
      stack.push({ indent: col, key: '-', name: null })
      const after = rest === '-' ? '' : rest.slice(2)
      col += 2 + (after.length - after.trimStart().length)
      rest = after.trimStart()
      afterDash = true
      if (rest === '') continue
      if (rest === '-' || rest.startsWith('- ')) fail(i, 'secvență imbricată pe aceeași linie')
    }
    if (rest.startsWith('? ') || rest.startsWith('<<')) fail(i, `cheie YAML nesuportată: ${rest}`)
    const km = /^("([^"]*)"|'([^']*)'|[^\s'"#:[\]{},&*!|>%@`][^:#]*?)\s*:(?:\s+(.*)|$)/.exec(rest)
    if (!km) {
      if (afterDash) {
        // element-scalar al secvenței (`- main`, `- https://…`)
        if (/^[&*!]/.test(rest)) fail(i, `ancoră/alias/etichetă YAML nesuportată: ${rest}`)
        cont = col - 2
        continue
      }
      fail(i, `linie necunoscută: ${rest}`)
    }
    const key = km[2] ?? km[3] ?? km[1].trim()
    const value = (km[4] ?? '').trim()
    popTo(col, false)
    stack.push({ indent: col, key })
    const parent = stack[stack.length - 2]
    if (key === 'name' && parent && parent.key === '-') parent.name = unquote(value)
    if (/^[&*!]/.test(value)) fail(i, `ancoră/alias/etichetă YAML nesuportată: ${value}`)
    if (key === 'env') {
      if (value !== '') fail(i, `env: cu valoare pe linie (${value}) — nu se poate citi`)
      const map = { snapshot: stack.slice(), line: i + 1, entries: [] }
      envs.push(map)
      env = { indent: col, childIndent: null, map }
      continue
    }
    if (/^[|>](?:[1-9]?[+-]?|[+-][1-9]?)$/.test(value)) {
      const run = key === 'run' ? { snapshot: stack.slice(0, -1), lines: [] } : null
      if (run) runs.push(run)
      block = { indent: col, run }
      continue
    }
    if (key === 'run' && value !== '') runs.push({ snapshot: stack.slice(0, -1), lines: [unquote(value)] })
    if (value !== '' && !/^['"[{]/.test(value)) cont = col
  }
  if (env && env.map.entries.length === 0) fail(lines.length - 1, 'env: fără intrări')

  return {
    envs: envs.map((e) => ({ path: pathOf(e.snapshot), line: e.line, entries: e.entries })),
    runs: runs.map((r) => ({ path: pathOf(r.snapshot), text: r.lines.join('\n') })),
    mentions,
  }
}

/**
 * Locurile în care un workflow setează sau pomenește `VITE_POSTHOG_*`, în afara
 * singurului permis: maparea `env:` a pasului de build din deploy-vps.yml.
 */
function posthogLeaks(workflows) {
  const bad = []
  for (const { name, text } of workflows) {
    const wf = parseWorkflow(text, name, NEEDLE)
    const explained = new Set()
    for (const e of wf.envs) {
      for (const x of e.entries) {
        if (!x.key.startsWith(NEEDLE)) continue
        explained.add(x.line)
        if (name !== 'deploy-vps.yml' || e.path !== `${BUILD_STEP}.env`) {
          bad.push(`${name}:${x.line} ${e.path}: ${x.key}=${x.value}`)
        }
      }
    }
    for (const line of wf.mentions) {
      if (!explained.has(line)) bad.push(`${name}:${line} pomenește ${NEEDLE} în afara unei mapări env:`)
    }
  }
  return bad
}

/** Căile pe care git le-ar comite: urmărite + neurmărite NEIGNORATE (fără shell). */
function committableFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return [...new Set(out.split('\0').filter(Boolean))]
}

const PROD = 'context.production.environment'

describe('PostHog — cheia doar în producție', () => {
  const sections = tomlSections(fs.readFileSync(TOML, 'utf8'))
  const prodKey = tomlValue(sections.get(PROD) ?? [], 'VITE_POSTHOG_KEY')

  it('PE6 anti-vacuitate: contextele cunoscute se citesc', () => {
    for (const s of [
      'build.environment',
      PROD,
      'context.branch-deploy.environment',
      'context."develop".environment',
      'context.deploy-preview.environment',
      'context.dev.environment',
    ]) {
      assert.ok(sections.has(s), `secțiunea ${s} lipsește din parser`)
    }
  })

  it('PE1 cheia apare o dată, ca VITE_POSTHOG_KEY în producție', () => {
    assert.ok(prodKey, 'VITE_POSTHOG_KEY lipsește din [context.production.environment]')
    assert.match(prodKey, /^phc_[A-Za-z0-9]{30,}$/)
    const text = fs.readFileSync(TOML, 'utf8')
    assert.deepEqual(text.match(KEY_RE), [prodKey], 'cheia apare și în altă parte a lui netlify.toml')
  })

  it('PE2 hostul de producție e cel UE', () => {
    assert.equal(tomlValue(sections.get(PROD), 'VITE_POSTHOG_HOST'), EU_HOST)
  })

  it('PE3 în afara producției cheia e setată EXPLICIT goală, și nimic altceva PostHog', () => {
    const leaks = []
    for (const [name, lines] of sections) {
      if (name === PROD) continue
      for (const l of lines) if (/VITE_POSTHOG_|phc_/.test(l) && !EMPTY_KEY_LINE.test(l)) leaks.push(`[${name}] ${l}`)
    }
    assert.deepEqual(leaks, [])
    // Fișierul bate UI-ul doar unde SETEAZĂ cheia: baza și fiecare context ne-producție.
    const envSections = [...sections.keys()].filter(
      (s) => s === 'build.environment' || (s !== PROD && /^context\..+\.environment$/.test(s)),
    )
    assert.ok(envSections.length >= 5, `prea puține contexte văzute: ${envSections.join(', ')}`)
    const unset = envSections.filter((s) => tomlValue(sections.get(s), 'VITE_POSTHOG_KEY') !== '')
    assert.deepEqual(unset, [], 'contexte în care UI-ul Netlify ar putea strecura cheia')
    // Control: regula chiar deosebește cheia goală de una reală și de lipsă.
    assert.ok(EMPTY_KEY_LINE.test('VITE_POSTHOG_KEY = ""'))
    assert.ok(!EMPTY_KEY_LINE.test(`VITE_POSTHOG_KEY = "${prodKey}"`))
    assert.equal(tomlValue(['VITE_APP_ENV = "preview"'], 'VITE_POSTHOG_KEY'), null)
  })

  it('PE4 deploy-vps.yml construiește cu aceeași cheie și același host UE', () => {
    const yml = fs.readFileSync(VPS, 'utf8')
    const wf = parseWorkflow(yml, 'deploy-vps.yml', NEEDLE)
    const maps = wf.envs.filter((e) => e.path === `${BUILD_STEP}.env`)
    assert.equal(maps.length, 1, 'pasul de build de producție (cu env:) din deploy-vps.yml nu se mai găsește')
    const values = (k) => maps[0].entries.filter((e) => e.key === k).map((e) => e.value)
    assert.deepEqual(values('VITE_POSTHOG_KEY'), [prodKey])
    assert.deepEqual(values('VITE_POSTHOG_HOST'), [EU_HOST])
    // …și e chiar pasul care construiește.
    const run = wf.runs.filter((r) => r.path === BUILD_STEP)
    assert.equal(run.length, 1, 'pasul de build nu are run:')
    assert.match(run[0].text, /^npm run build$/m)
    // Literal, comentariile incluse: cheia apare o singură dată în fișier.
    assert.deepEqual(yml.match(KEY_RE), [prodKey], 'cheia apare în deploy-vps.yml în afara pasului de build')
  })

  it('PE7 niciun alt workflow nu setează VITE_POSTHOG_* (nici din vars/secrets)', () => {
    const names = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort()
    assert.ok(names.length >= 8 && names.includes('deploy-vps.yml'), `workflow-uri văzute: ${names.join(', ')}`)
    const workflows = names.map((name) => ({ name, text: fs.readFileSync(path.join(WORKFLOWS, name), 'utf8') }))
    // Anti-vacuitate: parserul chiar vede mapările env: (altfel PE7 ar trece pe gol).
    const mapCount = workflows.reduce((n, w) => n + parseWorkflow(w.text, w.name, NEEDLE).envs.length, 0)
    assert.ok(mapCount > 50, `parserul vede prea puține mapări env: (${mapCount})`)
    assert.deepEqual(posthogLeaks(workflows), [])
  })

  it('PE8 control pozitiv: parserul de workflow', () => {
    const build = [
      'jobs:',
      '  deploy:',
      '    steps:',
      '      - name: Install + build (env de producție)',
      '        env:',
      '          # VITE_POSTHOG_KEY: phc_COMENTAT',
      '          VITE_POSTHOG_KEY: phc_real   # comentariu la final',
      "          VITE_POSTHOG_HOST: 'https://eu.i.posthog.com'",
      '        run: |',
      '          # VITE_POSTHOG_KEY într-un run: e shell, nu comentariu YAML',
      '          npm run build',
    ].join('\n')
    const wf = parseWorkflow(build, 'deploy-vps.yml', NEEDLE)
    // Linia COMENTATĂ nu se citește (regex-ul vechi pe textul pasului o lua pe ea).
    assert.deepEqual(wf.envs, [
      {
        path: `${BUILD_STEP}.env`,
        line: 5,
        entries: [
          { key: 'VITE_POSTHOG_KEY', value: 'phc_real', line: 7 },
          { key: 'VITE_POSTHOG_HOST', value: 'https://eu.i.posthog.com', line: 8 },
        ],
      },
    ])
    assert.deepEqual(wf.runs, [{ path: BUILD_STEP, text: '# VITE_POSTHOG_KEY într-un run: e shell, nu comentariu YAML\nnpm run build' }])
    assert.deepEqual(wf.mentions, [7, 8, 10])
    // Linia de shell din run: e o MENȚIUNE neexplicată de vreo mapare.
    assert.deepEqual(posthogLeaks([{ name: 'deploy-vps.yml', text: build }]), [
      `deploy-vps.yml:10 pomenește ${NEEDLE} în afara unei mapări env:`,
    ])

    // Alt workflow, din EXPRESII: la nivel de job, de pas și prin $GITHUB_ENV.
    const other = [
      'on: [push]',
      'jobs:',
      '  e2e:',
      '    env:',
      '      VITE_POSTHOG_KEY: ${{ vars.POSTHOG_KEY }}',
      '    steps:',
      '      - uses: actions/checkout@v7',
      '      - name: Build',
      '        env:',
      '          "VITE_POSTHOG_HOST": ${{ secrets.PH_HOST }}',
      '        run: echo "VITE_POSTHOG_KEY=${{ secrets.K }}" >> "$GITHUB_ENV"',
    ].join('\n')
    assert.deepEqual(posthogLeaks([{ name: 'e2e.yml', text: other }]), [
      'e2e.yml:5 jobs.e2e.env: VITE_POSTHOG_KEY=${{ vars.POSTHOG_KEY }}',
      'e2e.yml:10 jobs.e2e.steps[Build].env: VITE_POSTHOG_HOST=${{ secrets.PH_HOST }}',
      `e2e.yml:11 pomenește ${NEEDLE} în afara unei mapări env:`,
    ])
    // Aceeași mapare a pasului de build, mutată în ALT pas, nu mai e permisă.
    const moved = build.replace('Install + build (env de producție)', 'Lighthouse')
    assert.equal(posthogLeaks([{ name: 'deploy-vps.yml', text: moved }]).length, 3)

    // Formele pe care nu le înțelege ARUNCĂ (o mapare sărită ar fi o poartă moartă).
    const step = (body) => ['jobs:', '  a:', '    steps:', '      - run: x', ...body].join('\n')
    for (const [body, why] of [
      [['        env: { VITE_POSTHOG_KEY: x }'], /env: cu valoare pe linie/],
      [['        env: ${{ fromJSON(vars.ENV) }}'], /env: cu valoare pe linie/],
      [['        env:', '          A:', '            B: c'], /valoare env: nesuportată pentru A/],
      [['        env:', '          A: |', '            x'], /valoare env: nesuportată pentru A/],
      [['        env:', '          A: *ancora'], /valoare env: nesuportată pentru A/],
      [['        env:', '          - A=b'], /intrare env: necunoscută/],
      [['        env:', '        name: y'], /env: fără intrări/],
      [['        <<: *implicite'], /cheie YAML nesuportată/],
      [['        name: "neînchis'], /scalar între ghilimele pe mai multe linii/],
      [['        \tname: x'], /tab în indentare/],
    ]) {
      assert.throws(() => parseWorkflow(step(body), 'x.yml', NEEDLE), why, body.join(' / '))
    }
    // Comentariul YAML vs. `#` din interiorul unei valori / al unui șir.
    assert.equal(stripComment("name: it's # nota").text, "name: it's")
    assert.equal(stripComment('url: "https://x/#ancora" # nota').text, 'url: "https://x/#ancora"')
    assert.equal(stripComment('tag: a#b').text, 'tag: a#b')
  })

  it('PE5 niciun alt fișier comisibil nu conține un token phc_ real', () => {
    const allowed = new Set(['netlify.toml', '.github/workflows/deploy-vps.yml'])
    const files = committableFiles()
    assert.ok(files.length > 500, `git ls-files vede prea puține fișiere (${files.length})`)
    for (const must of ['netlify.toml', '.github/workflows/deploy-vps.yml', 'package.json']) {
      assert.ok(files.includes(must), `${must} lipsește din git ls-files`)
    }
    // Control: lista e cea a lui git, nu a discului — un fișier IGNORAT (copia
    // locală `netlify.toml.bak`, node_modules/) nu intră în scanare.
    execFileSync('git', ['check-ignore', '-q', '--no-index', 'netlify.toml.bak'], { cwd: ROOT })
    assert.deepEqual(files.filter((f) => /(^|\/)node_modules\/|\.bak$/.test(f)), [])
    assert.ok(HAS_KEY.test(`x phc_${'A1'.repeat(15)} y`) && !HAS_KEY.test('phc_xxx'))
    const hits = []
    for (const rel of files) {
      const full = path.join(ROOT, rel)
      let st
      try {
        st = fs.statSync(full)
      } catch {
        continue // urmărit, dar șters din working tree: nu se mai comite
      }
      if (!st.isFile() || st.size >= 2_000_000) continue
      if (allowed.has(rel)) continue
      if (HAS_KEY.test(fs.readFileSync(full, 'utf8'))) hits.push(rel)
    }
    assert.deepEqual(hits, [])
  })
})
