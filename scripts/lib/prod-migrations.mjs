// scripts/lib/prod-migrations.mjs
// =============================================================================
// Logica PURĂ a aplicării automate a migrațiilor pe producție (PR-0). Zero
// dependențe, zero rețea, zero acces la bază — tot ce decide CE se aplică și
// CUM se învelește un fișier stă aici, ca să poată fi testat offline
// (`node --test tests/prod-migrations/`). Execuția (psql, GitHub API) stă în
// `scripts/apply-prod-migrations.mjs` și `scripts/prod-migrations-gate.mjs`.
//
// Cele trei reguli care contează (fiecare e un mod de eșec real, nu o precauție):
//   1. Cheia ledger-ului e NUMELE, nu `version`. Pe producție `version` e
//      momentul APLICĂRII prin MCP (mig 269 = 20260905075533), nu prefixul
//      fișierului — aceeași derivare ca `get_schema_version` (mig 271) și
//      `scripts/gen-schema-manifest.mjs`, care importă `migrationName` de aici.
//   2. Rândul de ledger intră ÎN tranzacția fișierului, imediat înaintea
//      `commit;`-ului final: fișierul și urma lui se comit ATOMIC. Un rând pus
//      după `commit;` ar putea lipsi după un fișier aplicat (re-aplicat apoi
//      la următoarea rulare); un fișier picat nu lasă nici urmă, nici obiecte.
//   3. Forma fișierului e verificată pe instrucțiunile de NIVEL ÎNALT: un
//      `begin`/`end;` din corpul unei funcții sau al unui bloc `DO $$…$$`, dintr-un
//      comentariu sau dintr-un șir NU e o tranzacție (mig 289+ au blocuri DO cu
//      `end;` — numărate naiv, ar părea commit-uri).
// =============================================================================
import { readdirSync } from 'node:fs'

// ── 1. Numele migrațiilor ───────────────────────────────────────────────────

const FILE_RE = /^(\d{14})_(.+)\.sql$/
const NAME_RE = /^[A-Za-z0-9_]+$/

/** Fișierul 2026…_migration_289_x.sql → `migration_289_x` (forma din ledger). */
export function migrationName(filename) {
  const m = FILE_RE.exec(filename)
  if (!m) throw new Error(`migrație fără prefix de 14 cifre: ${filename}`)
  return m[2]
}

/** Prefixul de 14 cifre — `version` pe care îl scriem NOI în ledger. */
export function migrationVersion(filename) {
  const m = FILE_RE.exec(filename)
  if (!m) throw new Error(`migrație fără prefix de 14 cifre: ${filename}`)
  return m[1]
}

/** `migration_096a_x` → 96; `base_schema` → null. */
export function migrationNumber(nameOrFile) {
  const name = FILE_RE.test(nameOrFile) ? migrationName(nameOrFile) : nameOrFile
  const m = /^migration_(\d+)/.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * Fișierele `.sql` din director, sortate după prefix (= ordinea de aplicare,
 * aceeași cu `ls | sort` din sql-verify). Prefixele și numele trebuie să fie
 * UNICE: un `version` dublat ar face al doilea INSERT în ledger să pice, iar un
 * nume dublat ar face ledger-ul ambiguu.
 */
export function listMigrationFiles(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const seenVersion = new Map()
  const seenName = new Map()
  for (const f of files) {
    const v = migrationVersion(f)
    const n = migrationName(f)
    if (!NAME_RE.test(n)) throw new Error(`nume de migrație cu caractere nepermise: ${f}`)
    if (seenVersion.has(v)) throw new Error(`prefix dublat ${v}: ${seenVersion.get(v)} și ${f}`)
    if (seenName.has(n)) throw new Error(`nume dublat ${n}: ${seenName.get(n)} și ${f}`)
    seenVersion.set(v, f)
    seenName.set(n, f)
  }
  return files
}

// ── 2. Ledger: ce lipsește, golurile, coliziunile ──────────────────────────

/** Fișierele (în ordinea dată) al căror NUME nu e în ledger. `version` nu contează. */
export function pendingMigrations(ledgerNames, files) {
  const applied = new Set(ledgerNames)
  return files.filter((f) => !applied.has(migrationName(f)))
}

/** Fișierele al căror nume E în ledger (ordinea fișierelor, nu a ledger-ului). */
export function appliedMigrations(ledgerNames, files) {
  const applied = new Set(ledgerNames)
  return files.filter((f) => applied.has(migrationName(f)))
}

/**
 * Un fișier în așteptare e GOL („gap") dacă o migrație DEJA APLICATĂ se sortează
 * după el: aplicarea lui ar rula PESTE o stare care l-a depășit. Ordinea e a
 * FIȘIERELOR (prefixul), nu a ledger-ului — pe prod `version` e data aplicării.
 *
 * `pending` și `applied` sunt nume de FIȘIERE; `allowGaps` sunt NUME de migrații
 * (fără prefix), listate explicit în `scripts/prod-migrations-allow-gaps.json`
 * după ce s-a verificat că obiectele lor sunt disjuncte de ce s-a aplicat după.
 * Aruncă dacă există vreun gol nepermis. Întoarce golurile (permise).
 */
export function assertNoUnexpectedGaps(pending, applied, allowGaps = []) {
  const allow = new Set(allowGaps)
  const lastApplied = applied.length ? [...applied].sort().at(-1) : null
  const gaps = lastApplied ? pending.filter((f) => f < lastApplied) : []
  const unexpected = gaps.filter((f) => !allow.has(migrationName(f)))
  if (unexpected.length) {
    const err = new Error(
      `goluri NEPERMISE în ledger: ${unexpected.map(migrationName).join(', ')} — ` +
        `în așteptare, dar ${migrationName(lastApplied)} (mai nouă) e deja aplicată. ` +
        'Aplicarea lor ar rula peste o stare care le-a depășit; verifică manual că ' +
        'obiectele sunt disjuncte și adaugă numele în scripts/prod-migrations-allow-gaps.json.',
    )
    err.code = 'UNEXPECTED_GAP'
    err.gaps = unexpected
    throw err
  }
  return gaps
}

/**
 * Un fișier în așteptare al cărui PREFIX există deja în ledger (sub alt nume —
 * altfel n-ar fi în așteptare): INSERT-ul nostru ar lovi cheia primară. E
 * eroare, nu „do nothing": fișierul s-ar aplica fără urmă și ar fi re-aplicat
 * la următoarea rulare.
 */
export function findVersionCollisions(pending, ledgerRows) {
  const byVersion = new Map()
  for (const r of ledgerRows) byVersion.set(String(r.version), r.name)
  return pending
    .filter((f) => byVersion.has(migrationVersion(f)))
    .map((f) => ({ file: f, version: migrationVersion(f), ledgerName: byVersion.get(migrationVersion(f)) }))
}

/** Validează conținutul fișierului de excepții: un array de nume de migrații. */
export function parseAllowGaps(jsonText) {
  let v
  try {
    v = JSON.parse(jsonText)
  } catch {
    throw new Error('lista de goluri permise nu e JSON valid')
  }
  if (!Array.isArray(v)) throw new Error('lista de goluri permise trebuie să fie un array de nume')
  for (const x of v) {
    if (typeof x !== 'string' || !NAME_RE.test(x)) {
      throw new Error(`intrare invalidă în lista de goluri permise: ${JSON.stringify(x)}`)
    }
  }
  return v
}

// ── 3. Forma fișierului (lexer minimal, paritate cu psqlscan) ───────────────

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y

function lineAt(text, pos) {
  let line = 1
  for (let k = 0; k < pos; k++) if (text.charCodeAt(k) === 10) line++
  return line
}

/**
 * Împarte textul în instrucțiuni de NIVEL ÎNALT, exact cum le-ar trimite psql:
 * `;` termină o instrucțiune doar în afara șirurilor ('…', E'…', "…"),
 * comentariilor (`--`, `/* … *\/` imbricate) și corpurilor dollar-quoted
 * ($$…$$, $tag$…$tag$) și doar la adâncime 0 de paranteze. Un `\` necitat
 * deschide o meta-comandă psql până la capătul liniei.
 *
 * Întoarce `{ statements: [{ start, end, body }], metaCommands: [{ line, text }] }`;
 * `start` = offsetul primului caracter semnificativ (nu comentariu), `body` =
 * textul fără comentarii, cu spațiile comprimate.
 */
export function scanSql(text) {
  const statements = []
  const metaCommands = []
  const n = text.length
  let i = 0
  let start = -1
  let depth = 0
  let buf = ''
  const mark = (pos) => {
    if (start < 0) start = pos
  }
  const flush = (end) => {
    const body = buf.replace(/\s+/g, ' ').trim()
    if (body) statements.push({ start, end, body })
    buf = ''
    start = -1
    depth = 0
  }
  const fail = (msg, pos) => {
    const e = new Error(`${msg} (linia ${lineAt(text, pos)})`)
    e.code = 'SQL_SCAN'
    throw e
  }

  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '-' && d === '-') {
      const j = text.indexOf('\n', i)
      i = j < 0 ? n : j
      buf += ' '
      continue
    }
    if (c === '/' && d === '*') {
      let lvl = 1
      let j = i + 2
      while (j < n && lvl > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          lvl++
          j += 2
        } else if (text[j] === '*' && text[j + 1] === '/') {
          lvl--
          j += 2
        } else j++
      }
      if (lvl > 0) fail('comentariu /* neînchis', i)
      i = j
      buf += ' '
      continue
    }
    if (c === "'") {
      mark(i)
      const prev = i > 0 ? text[i - 1] : ''
      const prev2 = i > 1 ? text[i - 2] : ''
      const backslashEscapes = (prev === 'e' || prev === 'E') && !(prev2 && IDENT_CHAR.test(prev2))
      let j = i + 1
      for (;;) {
        if (j >= n) fail('șir neînchis', i)
        const ch = text[j]
        if (backslashEscapes && ch === '\\') {
          j += 2
          continue
        }
        if (ch === "'") {
          if (text[j + 1] === "'") {
            j += 2
            continue
          }
          break
        }
        j++
      }
      buf += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '"') {
      mark(i)
      let j = i + 1
      for (;;) {
        if (j >= n) fail('identificator "…" neînchis', i)
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2
            continue
          }
          break
        }
        j++
      }
      buf += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '$') {
      const prev = i > 0 ? text[i - 1] : ''
      // `$` după un caracter de identificator face parte din identificator
      // (`foo$bar`, `end$$` în afara unui corp) — ca în psqlscan.
      if (!(prev && IDENT_CHAR.test(prev))) {
        DOLLAR_TAG.lastIndex = i
        const m = DOLLAR_TAG.exec(text)
        if (m) {
          const tag = m[0]
          const close = text.indexOf(tag, i + tag.length)
          if (close < 0) fail(`corp ${tag}…${tag} neînchis`, i)
          mark(i)
          buf += text.slice(i, close + tag.length)
          i = close + tag.length
          continue
        }
      }
      mark(i)
      buf += c
      i++
      continue
    }
    if (c === '\\') {
      const j = text.indexOf('\n', i)
      const end = j < 0 ? n : j
      metaCommands.push({ line: lineAt(text, i), text: text.slice(i, end).trim() })
      i = end
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && depth > 0) depth--
    if (c === ';' && depth === 0) {
      flush(i)
      i++
      continue
    }
    if (!/\s/.test(c)) mark(i)
    buf += c
    i++
  }
  flush(n)
  return { statements, metaCommands }
}

const BEGIN_RE = /^(?:begin|start transaction)\b/i
const COMMIT_RE = /^(?:commit|end)(?: work| transaction)?$/i
const FORBIDDEN_TX_RE =
  /^(?:rollback|abort|savepoint|release|prepare transaction|commit prepared|rollback prepared|commit\b|end\b)/i
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)`
const LIT = String.raw`'(?:[^']|'')*'`
const ENUM_ADD_RE = new RegExp(
  String.raw`^alter type ${IDENT}(?:\.${IDENT})? add value if not exists ${LIT}(?: (?:before|after) ${LIT})?$`,
  'i',
)

function txKind(body) {
  if (BEGIN_RE.test(body)) return 'begin'
  if (COMMIT_RE.test(body)) return 'commit'
  if (FORBIDDEN_TX_RE.test(body)) return 'forbidden'
  return null
}

/**
 * Forma unui fișier de migrație:
 *   • `transactional` — EXACT un `begin;` (prima instrucțiune) și EXACT un
 *     `commit;` (ultima); tot ce e între ele e atomic, deci un eșec nu lasă nimic.
 *   • `enum_only` — doar `alter type … add value if not exists …` (+ comentarii),
 *     fără begin/commit (tiparul mig 254/256: idempotent, re-rulabil).
 *   • `invalid` — orice altceva, cu `reason`.
 * Instrucțiunile din afara perechii begin/commit ar rula în autocommit, deci un
 * eșec la mijloc ar lăsa o aplicare PE JUMĂTATE fără rând de ledger.
 */
export function classifyShape(sqlText) {
  let scan
  try {
    scan = scanSql(sqlText)
  } catch (e) {
    return { kind: 'invalid', reason: e.message, metaCommands: [] }
  }
  const { statements: st, metaCommands } = scan
  const invalid = (reason) => ({ kind: 'invalid', reason, metaCommands })
  if (!st.length) return invalid('fișier fără nicio instrucțiune')
  const kinds = st.map((s) => txKind(s.body))
  const bad = kinds.indexOf('forbidden')
  if (bad >= 0) {
    return invalid(`control de tranzacție nepermis la nivel înalt: „${st[bad].body.slice(0, 40)}”`)
  }
  const begins = kinds.flatMap((k, idx) => (k === 'begin' ? [idx] : []))
  const commits = kinds.flatMap((k, idx) => (k === 'commit' ? [idx] : []))
  if (!begins.length && !commits.length) {
    const other = st.find((s) => !ENUM_ADD_RE.test(s.body))
    if (other) {
      return invalid(
        `fără begin/commit, dar nu e doar „alter type … add value if not exists”: „${other.body.slice(0, 60)}”`,
      )
    }
    return { kind: 'enum_only', statements: st.length, metaCommands }
  }
  if (begins.length !== 1 || commits.length !== 1) {
    return invalid(`trebuie EXACT un begin și un commit la nivel înalt (găsite ${begins.length} / ${commits.length})`)
  }
  if (begins[0] !== 0) return invalid('`begin;` trebuie să fie PRIMA instrucțiune')
  if (commits[0] !== st.length - 1) return invalid('`commit;` trebuie să fie ULTIMA instrucțiune')
  return { kind: 'transactional', commitOffset: st[st.length - 1].start, statements: st.length, metaCommands }
}

/** Ultimul fișier deja aplicat peste tot care are voie să conțină meta-comenzi psql. */
export const LEGACY_META_CUTOFF_VERSION = '20261014090000' // mig 297
export const META_FORBIDDEN_FROM = 298

/**
 * Meta-comenzile psql (`\set`, `\i`, …) sunt interzise în fișierele ≥298: runner-ul
 * CLI Supabase nu le știe, iar un fișier care depinde de ele nu mai e SQL pur.
 * 120/121 au `\set ON_ERROR_STOP on` legitim și sunt aplicate peste tot.
 * Un fișier fără număr e nou dacă prefixul lui trece de 297.
 */
export function metaCommandsForbidden(filename) {
  const num = migrationNumber(filename)
  if (num !== null) return num >= META_FORBIDDEN_FROM
  return migrationVersion(filename) > LEGACY_META_CUTOFF_VERSION
}

/** Forma + regula meta-comenzilor, pentru un fișier concret. */
export function checkMigrationFile(filename, sqlText) {
  migrationName(filename) // aruncă pe prefix lipsă
  const shape = classifyShape(sqlText)
  if (shape.kind === 'invalid') return shape
  if (shape.metaCommands.length && metaCommandsForbidden(filename)) {
    const m = shape.metaCommands[0]
    return {
      kind: 'invalid',
      reason: `meta-comandă psql interzisă în migrațiile ≥${META_FORBIDDEN_FROM} (linia ${m.line}: ${m.text})`,
      metaCommands: shape.metaCommands,
    }
  }
  return shape
}

/** INSERT-ul de ledger. Valorile sunt validate (cifre / [A-Za-z0-9_]) — nu se pot evada. */
export function ledgerInsertSql({ version, name }) {
  if (!/^\d{14}$/.test(String(version))) throw new Error(`version invalid: ${version}`)
  if (!NAME_RE.test(String(name))) throw new Error(`nume invalid: ${name}`)
  return `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');`
}

/**
 * `transactional` → INSERT-ul de ledger e inserat IMEDIAT ÎNAINTEA `commit;`-ului
 * final (fișier + urmă = o singură tranzacție). FĂRĂ `on conflict do nothing`:
 * un conflict pe `version` trebuie să anuleze fișierul, nu să-l lase aplicat
 * fără urmă (ar fi re-aplicat la următoarea rulare).
 * `enum_only` → textul NESCHIMBAT; apelantul rulează `ledgerInsertSql` separat,
 * după fișier (ADD VALUE IF NOT EXISTS e idempotent, deci re-rularea e sigură).
 */
export function wrapWithLedger(sqlText, { version, name }) {
  const insert = ledgerInsertSql({ version, name })
  const shape = classifyShape(sqlText)
  if (shape.kind === 'enum_only') return sqlText
  if (shape.kind !== 'transactional') throw new Error(`forma fișierului nu permite aplicarea: ${shape.reason}`)
  const at = shape.commitOffset
  const sep = at > 0 && sqlText[at - 1] !== '\n' ? '\n' : ''
  return (
    sqlText.slice(0, at) +
    sep +
    '-- [apply-prod-migrations] urma în ledger, în ACEEAȘI tranzacție cu fișierul\n' +
    insert +
    '\n' +
    sqlText.slice(at)
  )
}

// ── 4. Conexiunea: validare + redactare (URL-ul nu se tipărește NICIODATĂ) ──

/** Acceptă doar URI-uri postgres(ql):// parsabile; nu întoarce și nu tipărește valoarea. */
export function validateDbUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return 'SUPABASE_DB_URL lipsește'
  if (url !== url.trim()) return 'SUPABASE_DB_URL are spații la capete'
  if (!/^postgres(?:ql)?:\/\//.test(url)) return 'SUPABASE_DB_URL nu e un URI postgresql://'
  try {
    new URL(url)
  } catch {
    return 'SUPABASE_DB_URL nu e un URI valid'
  }
  return null
}

/** Înlocuiește URL-ul și parola (brută și decodată) cu `***` în orice text tipărit. */
export function redact(text, url) {
  if (!text || !url) return text || ''
  const secrets = new Set([url])
  try {
    const u = new URL(url)
    if (u.password) {
      secrets.add(u.password)
      try {
        secrets.add(decodeURIComponent(u.password))
      } catch {
        /* parola nu e percent-encodată valid — rămâne forma brută */
      }
    }
  } catch {
    /* URL invalid: se redactează doar forma întreagă */
  }
  let out = String(text)
  for (const s of [...secrets].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join('***')
  }
  return out
}

// ── 5. Poarta: CI + Tests + SQL verify verzi pe același commit ──────────────

/**
 * Verdictul celui mai recent run al unui workflow pentru un commit de pe main
 * (doar evenimente `push` — un PR dintr-un fork cu ramura numită `main` NU
 * contează): 'success' | 'pending' | 'failure' | 'absent'.
 */
export function latestRunVerdict(runs, sha, { branch = 'main', event = 'push' } = {}) {
  const mine = (Array.isArray(runs) ? runs : []).filter(
    (r) => r && r.head_sha === sha && r.event === event && r.head_branch === branch,
  )
  if (!mine.length) return 'absent'
  mine.sort((a, b) => (b.run_number || 0) - (a.run_number || 0))
  const r = mine[0]
  if (r.status !== 'completed') return 'pending'
  return r.conclusion === 'success' ? 'success' : 'failure'
}

/** Pattern de filtru GitHub (`*`, `**`, `?`) → RegExp ancorat. Negațiile nu sunt suportate. */
export function ghGlobToRegExp(pattern) {
  if (!pattern || pattern.startsWith('!')) throw new Error(`pattern de cale nesuportat: ${pattern}`)
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/**
 * Lista `on.push.paths` dintr-un workflow (sql-verify.yml) — SURSĂ UNICĂ pentru
 * „ce schimbări ar fi declanșat SQL verify”. Parser minimal pe indentare; aruncă
 * dacă nu găsește lista (fail-closed: fără ea poarta nu poate judeca acoperirea).
 */
export function parsePushPaths(yamlText) {
  const lines = yamlText.split('\n')
  const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l))
  if (onIdx < 0) throw new Error('workflow fără blocul `on:`')
  let i = onIdx + 1
  let pushIndent = -1
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l)) break
    const m = /^(\s+)push:\s*$/.exec(l)
    if (m) {
      pushIndent = m[1].length
      i++
      break
    }
  }
  if (pushIndent < 0) throw new Error('workflow fără `on.push`')
  const paths = []
  let inPaths = false
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim() || /^\s*#/.test(l)) continue
    const indent = l.length - l.trimStart().length
    if (indent <= pushIndent) break
    if (/^\s+paths:\s*$/.test(l)) {
      inPaths = true
      continue
    }
    if (inPaths) {
      const m = /^\s+-\s*(['"]?)(.+?)\1\s*$/.exec(l)
      if (m) paths.push(m[2])
      else inPaths = false
    }
  }
  if (!paths.length) throw new Error('workflow fără `on.push.paths`')
  return paths
}

/** Căile schimbate care s-ar fi potrivit filtrului (deci ar fi declanșat workflow-ul). */
export function pathsMatching(changedFiles, patterns) {
  const res = patterns.map(ghGlobToRegExp)
  return changedFiles.filter((f) => res.some((r) => r.test(f)))
}

/**
 * Decizia porții. `sqlCoverage` contează doar când SQL verify n-a rulat pe
 * commit (`absent` — filtru de căi): atunci un run verde pe un strămoș e valabil
 * DOAR dacă între ele nu s-a schimbat nicio cale din filtrul workflow-ului.
 */
export function decideGate({ ref, ci, tests, sql, sqlCoverage }) {
  const reasons = []
  if (ref !== 'refs/heads/main') reasons.push(`ref ${ref} nu e main`)
  if (ci !== 'success') reasons.push(`CI: ${ci}`)
  if (tests !== 'success') reasons.push(`Tests & Quality: ${tests}`)
  if (sql === 'absent') {
    if (!sqlCoverage || !sqlCoverage.covered) {
      reasons.push(`SQL verify: absent pe commit și neacoperit (${(sqlCoverage && sqlCoverage.reason) || 'fără run verde'})`)
    }
  } else if (sql !== 'success') reasons.push(`SQL verify: ${sql}`)
  const pending = [ci, tests, sql].includes('pending')
  return { go: reasons.length === 0, pending, reasons }
}

// ── 6. MO1: ordinea migrațiilor unui PR față de main ───────────────────────

/**
 * Migrațiile ADĂUGATE de un PR (în `headFiles`, absente din `baseFiles`) trebuie
 * să vină STRICT după tot ce e pe main, pe AMBELE axe: numărul (`migration_NNN`)
 * și prefixul de 14 cifre. Altfel aplicarea automată (care merge pe ordinea
 * prefixelor) ar vedea un GOL — fișier nou sortat înaintea unuia deja aplicat —
 * și ar refuza tot lotul. Între ele, migrațiile noi cresc pe ambele axe deodată.
 * Întoarce lista de probleme (goală = ok).
 */
export function checkMigrationOrder(baseFiles, headFiles) {
  const base = new Set(baseFiles)
  const added = headFiles.filter((f) => !base.has(f)).sort()
  const problems = []
  if (!added.length) return problems
  const baseNums = baseFiles.map(migrationNumber).filter((n) => n !== null)
  const maxNum = baseNums.length ? Math.max(...baseNums) : -1
  const maxVer = baseFiles.length ? baseFiles.map(migrationVersion).sort().at(-1) : ''
  let prev = null
  for (const f of added) {
    const num = migrationNumber(f)
    const ver = migrationVersion(f)
    if (num === null) {
      problems.push(`${f}: o migrație nouă trebuie să se numească <14 cifre>_migration_<NNN>_<slug>.sql`)
      continue
    }
    if (num <= maxNum) problems.push(`${f}: numărul ${num} nu e mai mare decât ultimul de pe main (${maxNum}) — ia ${maxNum + 1}`)
    if (ver <= maxVer) problems.push(`${f}: prefixul ${ver} nu e după ultimul de pe main (${maxVer}) — folosește un timestamp mai nou`)
    if (prev && num <= prev.num) problems.push(`${f}: numărul ${num} nu crește față de ${prev.f} (${prev.num}), deși prefixul e mai nou`)
    prev = { f, num }
  }
  return problems
}
