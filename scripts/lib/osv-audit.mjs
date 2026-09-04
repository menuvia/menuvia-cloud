// scripts/lib/osv-audit.mjs
// =============================================================================
// Poarta de securitate pe dependențele de PRODUCȚIE, cu OSV.dev ca sursă.
//
// DE CE NU MAI FOLOSIM `npm audit`: registry-ul retrage endpoint-ul legacy
// `security/audits/quick`, iar acest arbore e FORȚAT pe el (aliasul
// `web-vitals-soft-navs: npm:web-vitals@6.2.1` din posthog-js nu e exprimabil în
// `security/advisories/bulk`). Pe 3–4 sept 2026 a picat ~18h continuu.
//
// REGULA DE AUR A ACESTUI FIȘIER (lecția CA-01): o poartă care raportează
// „curat" fără să fi evaluat ceva e mai rea decât o poartă lipsă. De aceea NU
// există nicio cale prin care scriptul să iasă cu 0 fără dovadă POZITIVĂ că
// oracolul a funcționat. Vezi CANARIES.
//
// Zero dependențe: Node 22 are `fetch` și `AbortSignal.timeout` native.
//
// Fișierul e BIBLIOTECĂ (doar exporturi, nicio execuție la import) tocmai ca
// logica pură să poată fi testată offline — api.osv.dev nu e accesibil din
// containerul de dezvoltare. Rularea stă în `scripts/osv-audit-gate.mjs`.
// =============================================================================

import { readFileSync } from 'node:fs'

// ── Constante ───────────────────────────────────────────────────────────────

// NU se citește din env: o variabilă de repo/org numită OSV_API_BASE ar putea
// redirecta oracolul către un server care răspunde „curat" la orice.
const OSV_BASE = 'https://api.osv.dev'
const ECOSYSTEM = 'npm' // exact, minuscule — „NPM"/„npmjs" dau eroare de API
const BATCH_SIZE = 100
const ATTEMPTS = 4
const PER_REQUEST_MS = 20_000

/**
 * CONTROL POZITIV. Pachete cu avize publice permanente, interogate în ACELAȘI
 * lot cu ale noastre. Dacă oracolul nu le găsește, înseamnă că nu evaluează
 * nimic (ecosistem greșit, backend degradat care întoarce `{}`, proxy care
 * înghite, formă de cerere schimbată) — iar „zero vulnerabilități" pe arborele
 * nostru NU mai are nicio valoare probatorie. Fără ele, un OSV care răspunde
 * 200 cu corp gol e byte-cu-byte identic cu un arbore curat.
 * Nu intră NICIODATĂ în verdictul de blocare — nu sunt dependențele noastre.
 */
const CANARIES = [
  { name: 'event-stream', version: '3.3.6' }, // GHSA-mh6f-8j2x-4483 (cod malițios, 2018)
  { name: 'lodash', version: '4.17.15' },     // prototype pollution / command injection
]

// ── Extragerea pachetelor de PRODUCȚIE din lockfile (pur, testabil offline) ──

/**
 * Numele REAL al pachetului dintr-o intrare de lockfile.
 * `entry.name` e scris de npm DOAR când cheia diferă de numele pachetului —
 * adică exact la ALIASURI. `node_modules/web-vitals-soft-navs` are
 * `name: "web-vitals"`; a interoga OSV după numele din cale ar da zero
 * vulnerabilități PE VECI, adică un punct orb care arată exact ca „curat".
 * Fallback: segmentul de după ULTIMUL `node_modules/` (acoperă și imbricarea
 * `a/node_modules/b`, și scope-urile `@scope/pkg`).
 */
export function realPackageName(key, entry) {
  if (entry && typeof entry.name === 'string' && entry.name) return entry.name
  const marker = 'node_modules/'
  const i = key.lastIndexOf(marker)
  if (i === -1) return null // cheie de workspace/rădăcină — NU ghici un nume
  const n = key.slice(i + marker.length)
  return n || null
}

/** Numele pachetului dedus din URL-ul tarball-ului, pentru verificare încrucișată. */
export function nameFromResolved(resolved) {
  if (typeof resolved !== 'string') return null
  const m = resolved.match(/^https:\/\/registry\.npmjs\.org\/((?:@[^/]+\/)?[^/]+)\/-\//)
  return m ? m[1] : null
}

/**
 * Pachetele de PRODUCȚIE, deduplicate pe `name@version`.
 *
 * Filtrul e `dev !== true`, NU `!dev && !devOptional`: `npm audit --omit=dev`
 * PĂSTREAZĂ nodurile `devOptional` (se elimină doar când se omit și dev, și
 * optional). Excluderea lor ar îngusta tăcut acoperirea față de poarta pe care
 * o înlocuim. La fel, `optional: true` non-dev RĂMÂNE: `npm ci` le instalează
 * și ajung în bundle.
 * Dedup pe `name@version`, nu pe nume: `fflate` există la 0.8.3 și 0.4.9.
 */
export function productionPackages(lock) {
  if (!lock || typeof lock !== 'object' || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json nu are obiectul `packages` (lockfileVersion < 2?)')
  }
  const out = new Map()
  const warnings = []
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key) continue // rădăcina proiectului
    if (!entry || typeof entry !== 'object') continue
    if (entry.dev === true) continue
    if (entry.link === true) continue // symlink către workspace, nu un tarball
    if (typeof entry.version !== 'string' || !entry.version) continue

    const name = realPackageName(key, entry)
    if (!name) { warnings.push(`cheie fără nume derivabil: ${key}`); continue }

    // Verificare încrucișată a aliasului: dacă `resolved` spune alt nume decât
    // `entry.name`, nu tăcem — `entry.name` e singura sursă a numelui real și
    // exact bug-ul pe care îl reparăm ar reveni dacă npm ar înceta să-l scrie.
    const fromUrl = nameFromResolved(entry.resolved)
    if (fromUrl && fromUrl !== name) {
      warnings.push(`nume divergent pentru ${key}: entry.name=${name} vs tarball=${fromUrl}`)
    }
    if (entry.resolved === undefined && entry.inBundle !== true) {
      warnings.push(`intrare fără \`resolved\`: ${key}@${entry.version}`)
    }
    out.set(`${name}@${entry.version}`, { name, version: entry.version })
  }
  return { packages: [...out.values()], warnings }
}

// ── Severitate (pur, testabil offline) ──────────────────────────────────────

const RANK = { NONE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 }

/** Bucket-ul GHSA. Atenție: GitHub scrie MODERATE, nu MEDIUM. */
export function bucketFromLabel(label) {
  if (typeof label !== 'string') return null
  const s = label.trim().toUpperCase()
  if (s === 'MEDIUM') return 'MODERATE'
  return RANK[s] === undefined ? null : s
}

export function bucketFromScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null
  if (score >= 9.0) return 'CRITICAL'
  if (score >= 7.0) return 'HIGH'
  if (score >= 4.0) return 'MODERATE'
  if (score > 0) return 'LOW'
  return 'NONE'
}

/** Rotunjirea din CVSS v3.1 Appendix A (aritmetică pe întregi). NU e ceil(x*10)/10 — aia e v3.0 și diferă exact la praguri. */
function roundup(input) {
  const i = Math.round(input * 100000)
  if (i % 10000 === 0) return i / 100000
  return (Math.floor(i / 10000) + 1) / 10.0
}

const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
}

/** Scorul de bază CVSS v3.x dintr-un VECTOR (string). `severity[].score` e mereu vector, niciodată număr. */
export function cvss3BaseScore(vector) {
  if (typeof vector !== 'string' || !/^CVSS:3\.[01]\//.test(vector)) return null
  const m = Object.fromEntries(
    vector.split('/').slice(1).map((p) => {
      const [k, v] = p.split(':')
      return [k, v]
    }),
  )
  const scopeChanged = m.S === 'C'
  const av = W.AV[m.AV], ac = W.AC[m.AC], ui = W.UI[m.UI]
  const pr = (scopeChanged ? W.PR_C : W.PR_U)[m.PR]
  const c = W.CIA[m.C], i = W.CIA[m.I], a = W.CIA[m.A]
  if ([av, ac, ui, pr, c, i, a].some((x) => x === undefined)) return null

  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss
  if (impact <= 0) return 0
  const expl = 8.22 * av * ac * pr * ui
  const base = scopeChanged
    ? Math.min(1.08 * (impact + expl), 10)
    : Math.min(impact + expl, 10)
  return roundup(base)
}

/**
 * Severitatea unui aviz OSV.
 * Ia MAXIMUL dintre bucket-ul GHSA și cel derivat din vectorul CVSS — NU
 * primul găsit. Un aviz etichetat MODERATE de GitHub dar cu vector 9.8 e
 * CRITICAL; varianta „primul câștigă" lăsa exact asta să treacă (confirmat de
 * echipa roșie pe toate cele trei propuneri).
 * `null` = NEEVALUABIL (ex. doar CVSS v4, pe care nu-l calculăm) — apelantul
 * trebuie să trateze asta ca eșec, nu ca „curat".
 */
export function severityOf(vuln) {
  if (!vuln || typeof vuln !== 'object') return null
  let best = null
  const consider = (b) => {
    if (b && (best === null || RANK[b] > RANK[best])) best = b
  }
  consider(bucketFromLabel(vuln.database_specific && vuln.database_specific.severity))
  if (Array.isArray(vuln.severity)) {
    for (const s of vuln.severity) {
      if (!s || typeof s !== 'object') continue
      if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
        consider(bucketFromScore(cvss3BaseScore(s.score)))
      }
    }
  }
  if (Array.isArray(vuln.affected)) {
    for (const af of vuln.affected) {
      consider(bucketFromLabel(af && af.database_specific && af.database_specific.severity))
    }
  }
  return best
}

export function isBlocking(bucket) {
  return bucket === 'HIGH' || bucket === 'CRITICAL' // --audit-level=high INCLUDE critical
}

/** Avizele retrase nu blochează — altfel poarta dă alarme false și echipa învață s-o ocolească. */
export function isWithdrawn(vuln) {
  return !!(vuln && typeof vuln.withdrawn === 'string' && vuln.withdrawn)
}

// ── Rețea ───────────────────────────────────────────────────────────────────

class Transport extends Error {}
class Fatal extends Error {}

async function postJson(path, body) {
  let res
  try {
    res = await fetch(`${OSV_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_REQUEST_MS),
    })
  } catch (e) {
    throw new Transport(`rețea: ${e && e.message ? e.message : e}`)
  }
  if (res.status === 400) throw new Fatal(`OSV a respins cererea (400) — bug în scriptul nostru, nu transport`)
  if (!res.ok) throw new Transport(`HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Transport('corp non-JSON de la OSV')
  }
}

async function getJson(path) {
  let res
  try {
    res = await fetch(`${OSV_BASE}${path}`, { signal: AbortSignal.timeout(PER_REQUEST_MS) })
  } catch (e) {
    throw new Transport(`rețea: ${e && e.message ? e.message : e}`)
  }
  if (!res.ok) throw new Transport(`HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Transport('corp non-JSON de la OSV')
  }
}

/**
 * Extrage ID-urile per pachet dintr-un răspuns querybatch.
 * STRICT deliberat: OSV răspunde `{}` pentru „fără vulnerabilități", deci
 * singura formă acceptată e „obiect, fie fără `vulns`, fie cu `vulns` ARRAY de
 * obiecte cu `id` string". Orice altceva (null, `vulns` ne-array, intrare fără
 * `id`) e TRANSPORT, nu „curat" — echipa roșie a demonstrat că varianta
 * permisivă transformă gunoiul în verde.
 */
export function idsFromBatch(body, expected) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.results)) {
    throw new Transport('răspuns querybatch fără `results` array')
  }
  if (body.results.length !== expected) {
    throw new Transport(`querybatch a întors ${body.results.length} rezultate pentru ${expected} interogări`)
  }
  if (body.next_page_token) {
    throw new Transport('querybatch a paginat — scanare parțială, refuzăm să o tratăm ca întreagă')
  }
  return body.results.map((r) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      throw new Transport('element de rezultat cu formă necunoscută')
    }
    if (r.vulns === undefined) return [] // forma documentată pentru „curat"
    if (!Array.isArray(r.vulns)) throw new Transport('`vulns` prezent dar nu e array')
    return r.vulns.map((v) => {
      if (!v || typeof v.id !== 'string' || !v.id) throw new Transport('vulnerabilitate fără `id`')
      return v.id
    })
  })
}

async function withRetry(label, fn) {
  let last = null
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof Fatal) throw e
      last = e
      process.stderr.write(`  încercarea ${i}/${ATTEMPTS} a eșuat (${label}): ${e.message}\n`)
      if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, 3000 * i))
    }
  }
  throw new Transport(`${label}: ${last ? last.message : 'necunoscut'}`)
}

// ── Orchestrare ─────────────────────────────────────────────────────────────

export async function main() {
  const lockPath = process.argv[2] || 'package-lock.json'
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const { packages, warnings } = productionPackages(lock)
  for (const w of warnings) process.stderr.write(`  atenție: ${w}\n`)

  if (packages.length < 20) {
    throw new Fatal(`doar ${packages.length} pachete de producție extrase — lockfile trunchiat sau parser rupt`)
  }

  // Canarii intră în ACELAȘI lot: același drum, aceeași formă, același backend.
  const all = [...packages, ...CANARIES]
  const queries = all.map((p) => ({ package: { name: p.name, ecosystem: ECOSYSTEM }, version: p.version }))

  const perPackageIds = []
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const slice = queries.slice(i, i + BATCH_SIZE)
    const body = await withRetry(`lot ${i / BATCH_SIZE + 1}`, () =>
      postJson('/v1/querybatch', { queries: slice }).then((b) => idsFromBatch(b, slice.length)),
    )
    perPackageIds.push(...body)
  }

  // Verdictul canarilor ÎNAINTE de orice concluzie despre arborele nostru.
  const canaryIds = perPackageIds.slice(packages.length)
  const silent = CANARIES.filter((_, k) => canaryIds[k].length === 0)
  if (silent.length) {
    throw new Fatal(
      `CONTROLUL POZITIV A PICAT: ${silent.map((c) => `${c.name}@${c.version}`).join(', ')} ` +
        'nu au întors nicio vulnerabilitate. Oracolul NU evaluează — „zero vulnerabilități" pe arborele ' +
        'nostru nu are nicio valoare probatorie. Dacă OSV chiar a retras avizul acelui canar (verifică ' +
        'manual pe osv.dev), înlocuiește-l în CANARIES cu altul cunoscut vulnerabil — NU șterge controlul.',
    )
  }

  // Detaliile avizelor (querybatch NU întoarce severitate — doar id + modified).
  const need = new Set(perPackageIds.flat())
  const details = new Map()
  for (const id of need) {
    const v = await withRetry(`aviz ${id}`, () => getJson(`/v1/vulns/${encodeURIComponent(id)}`))
    details.set(id, v)
  }

  const blocking = []
  const unevaluated = []
  let canaryProvedSeverity = false

  all.forEach((pkg, idx) => {
    const isCanary = idx >= packages.length
    for (const id of perPackageIds[idx]) {
      const v = details.get(id)
      if (!v || isWithdrawn(v)) continue
      const bucket = severityOf(v)
      if (bucket === null) {
        // Nu putem exclude „critical" → nu avem voie să tăcem.
        if (!isCanary) unevaluated.push(`${pkg.name}@${pkg.version} ${id}`)
        continue
      }
      if (isBlocking(bucket)) {
        if (isCanary) canaryProvedSeverity = true
        else blocking.push(`${pkg.name}@${pkg.version} ${id} ${bucket}`)
      }
    }
  })

  if (!canaryProvedSeverity) {
    throw new Fatal(
      'CONTROLUL POZITIV A PICAT: niciun canar nu s-a clasificat high/critical — calea de severitate ' +
        '(querybatch → /v1/vulns/{id} → CVSS/GHSA) nu funcționează, deci un high real de-al nostru ar trece neobservat.',
    )
  }
  if (unevaluated.length) {
    throw new Fatal(
      `avize fără severitate calculabilă (probabil doar CVSS v4): ${unevaluated.join(', ')}. ` +
        'Nu le putem exclude ca fiind sub prag — clasificare manuală necesară.',
    )
  }
  if (blocking.length) {
    process.stderr.write(`Audit securitate: ${blocking.length} vulnerabilități high/critical:\n`)
    for (const b of blocking) process.stderr.write(`  - ${b}\n`)
    return 1
  }

  process.stdout.write(
    `Audit securitate: 0 vulnerabilități high/critical în ${packages.length} pachete de producție ` +
      `(sursă: OSV.dev; control pozitiv confirmat pe ${CANARIES.length} canari).\n`,
  )
  return 0
}
