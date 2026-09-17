// netlify/functions/health.js
// Endpoint public de healthcheck pentru monitoare externe de uptime
// (UptimeRobot, BetterStack etc.) — "dead-man's-switch" extern care alertează
// founderul când aplicația sau DB-ul cade.
//
// NU e scheduled — e un endpoint HTTP normal, expus auto de Netlify la:
//   /.netlify/functions/health
// și rutat "frumos" la /health prin redirect în netlify.toml (vezi acolo).
//
// GET → ping simplu la Supabase (select minimal pe o tabelă stabilă) cu client
// service_role (ca celelalte funcții). Timeout defensiv scurt pe query ca un DB
// lent/blocat să nu țină cererea agățată — monitorul primește 503 rapid.
//
// Răspuns PUBLIC (exact trei chei — forma e înghețată de testul HL8):
//   200 { status: 'ok',       checks: { db, cron, storage, schema, queues, pgcron }, ts }
//   503 { status: 'degraded', checks: { db: 'down' | cron: 'stale' | storage: 'critical' | queues: 'stale' | pgcron: 'drift' | 'stale' }, ts }
// Cu antetul `x-health-diag` (HEALTH_DIAG_TOKEN) se adaugă `config`,
// `cron_last_run`, `storage_detail`, `schema_detail`, `queue_detail`, `pgcron_detail`.
// `schema: 'behind'` (mig 271) NU schimbă codul HTTP — îl alertează health-watch.
//
// ── De ce verificăm ȘI cron-ul aici (incident 2–9 august 2026) ──────────────
// automation-cron a încetat să ruleze pe 2 august 19:30 și NIMENI n-a aflat
// timp de 7 zile: emailuri, SMS-uri, facturi Oblio, remindere de rezervare,
// no-show — toată automatizarea a fost moartă în tăcere. Cauza structurală a
// invizibilității: singurul watchdog (send-health-slack-alerts) e EL ÎNSUȘI o
// funcție programată, deci o cădere de cron îl omoară exact pe el. Monitorul
// nu are voie să trăiască în interiorul lucrului monitorizat.
// Fix: /health (endpoint HTTP, lovit din AFARĂ de UptimeRobot) raportează
// prospețimea ultimei rulări de cron. `customer_health_scores.computed_at` e
// proxy-ul: compute_health_scores rulează la fiecare 30 de minute din
// automation-cron, deci o vechime > 2h înseamnă cron căzut → 503 → alertă.
//
// Blocul `config` = booleeni de PREZENȚĂ a env-urilor critice (NICIODATĂ valori) —
// founderul vede rapid dacă un secret a fost revocat/lipsă (finding audit:
// fallback-uri silențioase care mascau erori). Fără secrete în răspuns — și,
// din audit v3 RES-38, DOAR cu token: starea integrărilor (Resend/Slack morți)
// spune unui străin că nimeni nu va afla de un incident.
//
// Env vars:
//   SUPABASE_URL || VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DB_SIZE_LIMIT_BYTES  (optional) plafonul de stocare in OCTETI, fara sufix de
//                        unitate. Default 500 MB (planul Free). O valoare
//                        invalida e ignorata CU avertisment in log.
//   HEALTH_DIAG_TOKEN    (optional) deblocheaza `config`, `cron_last_run`,
//                        `storage_detail` (octeti, plafon, procent, primele 5
//                        tabele), `schema_detail`, `queue_detail` si `pgcron_detail` EXCLUSIV prin antetul
//                        `x-health-diag`. NU se accepta in query string (un
//                        secret in URL ajunge in loguri — CWE-598). NESETAT =
//                        diagnosticul nu e accesibil de nicaieri (fail-closed).
//                        Vezi docs/RUNBOOK.md §4.1.

const crypto = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')
// Manifestul migrațiilor din repo (nume fără prefixul de 14 cifre), generat de
// scripts/gen-schema-manifest.mjs și COMIS — sonda `get_schema_version` (mig
// 271) primește lista și întoarce ce lipsește din ledger-ul producției.
const SCHEMA_MANIFEST = require('./schema-manifest.json')

// ── Praguri pentru backlog-ul cozilor (mig 271, audit v3 RES-32) ────────────
// Grupa `cron` = platformă → `stale` dă 503 (alertă). Pragurile sunt multipli
// de tick-ul REAL al fiecărui worker din netlify.toml (email */5 → 30 min = 6
// tick-uri ratate; sms/invoices */15 → 60 min = 4; remindere */30 → 120 min = 4).
// Grupa `bridge` = PC-ul unui restaurant → DOAR `warn` (200): un 503 de
// platformă pentru o casă oprită antrenează founderul să ignore /health.
const QUEUE_STALE_S = { email: 30 * 60, sms: 60 * 60, invoices: 60 * 60, reminders: 120 * 60 }
const BRIDGE_WARN_S = 15 * 60
// Cozile bridge-ului al căror backlog dă `warn` — lista e CONTRACT cu RPC-ul.
const BRIDGE_QUEUES = ['receipts', 'tickets']

// ── Janitoarele din DB (mig 274, RES-04/RES-09) ─────────────────────────────
// `checks.cron` măsoară planificatorul NETLIFY (customer_health_scores, scris de
// compute_health_scores, care rămâne DELIBERAT pe Netlify ca dead-man's switch).
// `checks.pgcron` măsoară AL DOILEA planificator, cel din BAZĂ, care duce
// janitoarele fiscale. Sunt două lucruri diferite și se raportează separat: un
// pg_cron verde nu spune NIMIC despre Netlify, și invers. Fără sonda asta, mig
// 274 ar instala un planificator pe care nimic nu-l observă.
// Contract COMPLET sau `unknown` (disciplina HL13/HL18 de la cozi): `jobs`
// trebuie să fie un array NE-VID de obiecte cu TOATE cele 9 chei. Un
// `{available:true, jobs:[]}` ar da „ok" pentru zero joburi, iar o cheie lipsă
// ar face o ramură de severitate IMPOSIBIL de atins.
const PGCRON_JOB_KEYS = [
  'job_name', 'scheduled', 'active', 'schedule_ok',
  'last_status', 'last_run_age_s', 'last_success_age_s', 'since_scheduled_s', 'max_age_s',
]

/**
 * Comparare constant-time (oglinda lui `safeEqual` din deploy/server.js, SEC-09).
 * @param {unknown} a valoarea primita
 * @param {unknown} b valoarea asteptata
 * @returns {boolean} true doar la egalitate exacta (lungime + bytes)
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// Timeout defensiv pe ping-ul DB (ms). Un DB blocat nu ține cererea agățată —
// monitorul extern trebuie să primească un 503 rapid, nu un timeout de gateway.
const DB_PING_TIMEOUT_MS = 4000

// Cât de veche poate fi ultima rulare de cron înainte s-o considerăm căzută.
// compute_health_scores rulează la 30 de minute (automation-cron, Job 2) →
// 2h e de 4× marja normală: fără fals-pozitive la un deploy sau un tick ratat.
const CRON_STALE_HOURS = 2

// ── Plafonul de stocare (audit v3, rangul 12) ────────────────────────────────
// Cand Postgres atinge plafonul planului, baza trece in READ-ONLY: platforma nu
// mai accepta comenzi, la NICIUN restaurant. E o cadere totala care se anunta cu
// saptamani inainte si pe care nimeni nu o vede, fiindca nimic nu o masoara —
// exact tiparul incidentului de cron din august. Pragurile lasa timp de reactie:
// 80% doar raporteaza (200, vizibil in payload), 90% da 503, adica ALERTEAZA.
// Plafonul e configurabil: planul Supabase se poate schimba fara redeploy de cod.
const DEFAULT_DB_SIZE_LIMIT_BYTES = 500 * 1024 * 1024
// `|| fallback` accepta Infinity SI valorile negative (ambele truthy). Masurat:
//   "Infinity" -> limit = Infinity -> pct = 0            -> critical? NU
//   "-1"       -> limit = -1       -> pct = -2229365100  -> critical? NU
// Adica o singura variabila de mediu gresita stinge TACUT alarma, exact clasa
// CA-01 din CLAUDE.md: o poarta stinsa tacut e mai rea decat una lipsa. Acceptam
// doar valori finite SI strict pozitive; orice altceva cade pe plafonul implicit.
const rawDbSizeLimit = Number(process.env.DB_SIZE_LIMIT_BYTES)
const DB_SIZE_LIMIT_BYTES =
  Number.isFinite(rawDbSizeLimit) && rawDbSizeLimit > 0
    ? rawDbSizeLimit
    : DEFAULT_DB_SIZE_LIMIT_BYTES
// A respinge TACUT o valoare setata EXPLICIT e aceeasi lipsa de lizibilitate ca
// CA-01: `DB_SIZE_LIMIT_BYTES=8GB` (sufixele de unitate sunt normale in config)
// da NaN -> 500 MB -> 503 permanent pe un plan de 8 GB, fara ca nimic sa spuna
// ca valoarea a fost ignorata.
// Verificam PREZENTA variabilei si refolosim exact predicatul de validare —
// comparatia pe sir raporta fals ca invalida o valoare corecta scrisa altfel
// (`5.24288e8` e egal numeric cu plafonul implicit), iar un sir gol setat
// EXPLICIT nu producea niciun avertisment.
if (
  Object.prototype.hasOwnProperty.call(process.env, 'DB_SIZE_LIMIT_BYTES') &&
  !(Number.isFinite(rawDbSizeLimit) && rawDbSizeLimit > 0)
) {
  console.warn(
    `[health] DB_SIZE_LIMIT_BYTES="${process.env.DB_SIZE_LIMIT_BYTES}" nu e un numar finit pozitiv (octeti, fara sufix) — folosesc plafonul implicit de ${DEFAULT_DB_SIZE_LIMIT_BYTES}`,
  )
}
const DB_SIZE_WARN_PCT = 80
const DB_SIZE_CRITICAL_PCT = 90

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Monitoarele nu trebuie să vadă niciodată un răspuns cache-uit.
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}

// Booleeni de PREZENȚĂ a secretelor critice — NU valorile. Doar `!!`.
function envConfig() {
  return {
    resend: !!process.env.RESEND_API_KEY,
    slack: !!process.env.SLACK_WEBHOOK_URL,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    ai_platform: !!(
      process.env.PLATFORM_OPENAI_KEY || process.env.PLATFORM_ANTHROPIC_KEY
    ),
  }
}

exports.handler = async (event) => {
  const ts = new Date().toISOString()
  const config = envConfig()

  // GET și HEAD. UptimeRobot & co. probează DEFAULT cu HEAD; pe VPS (shim-ul
  // deploy/server.js rutează după path, nu tratează HEAD ca Netlify), un 405 pe
  // HEAD ar întoarce ACELAȘI răspuns și cu DB up, și cu DB down → dead-man's-
  // switch-ul devine mut. Rulăm ping-ul DB și pe HEAD (corpul e ignorat de client).
  const method = event && event.httpMethod
  if (method && method !== 'GET' && method !== 'HEAD') {
    return jsonResponse(405, { status: 'degraded', error: 'method_not_allowed', ts })
  }

  // Cine are voie sa vada diagnosticul privilegiat de stocare (vezi mai jos).
  //
  // NUMAI prin antetul `x-health-diag`. `?diag=` NU e acceptat: un secret in URL
  // ajunge in logurile de request Netlify, in configul monitorului si in
  // istoricul de shell (CWE-598). Prima varianta a acestui cod ACCEPTA query
  // param-ul si il documenta — cu un comentariu care descria exact riscul si il
  // numea „calea neintentionata". A identifica o vulnerabilitate si a o livra
  // oricum, cu o nota explicativa, e mai rau decat a nu o observa.
  //
  // Comparatie CONSTANT-TIME prin `safeEqual`, aceeasi primitiva ca verificarea
  // lui `x-cron-key` din deploy/server.js (audit v3 SEC-09) — nu `===`, care e
  // data-dependent pe siruri de lungime egala.
  const diagToken = process.env.HEALTH_DIAG_TOKEN || ''
  const headers = (event && event.headers) || {}
  const presentedDiag = headers['x-health-diag'] || ''
  const diagAllowed = diagToken.length > 0 && safeEqual(presentedDiag, diagToken)

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Lipsa env-ului de bază = nu putem verifica DB-ul → degraded (nu 500),
  // ca monitorul să alerteze la fel ca la un DB căzut.
  if (!supabaseUrl || !serviceRoleKey) {
    // Public = doar severitatea; `config` (ce integrări sunt moarte) cere token —
    // altfel un curl anonim afla că fondatorul e orb (fără Slack, fără cron).
    return jsonResponse(503, {
      status: 'degraded',
      checks: { db: 'down' },
      ...(diagAllowed ? { config } : {}),
      ts,
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let dbOk = false
  // AbortController anulează efectiv cererea HTTP către Supabase la timeout —
  // spre deosebire de Promise.race cu un setTimeout, care doar ignoră promisiunea
  // lentă în JS, dar lasă request-ul să continue în fundal (leak de conexiune/timp
  // de execuție Netlify Function irosit pe un răspuns pe care nu-l mai așteaptă nimeni).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DB_PING_TIMEOUT_MS)
  try {
    // Ping minimal: 1 rând, o singură coloană, pe o tabelă stabilă. Nu ne
    // interesează conținutul — doar că DB-ul răspunde fără eroare la timp.
    const { error } = await supabase
      .from('restaurants')
      .select('id')
      .limit(1)
      .abortSignal(controller.signal)
    dbOk = !error
    if (error) {
      console.error('[health] db ping error:', error.message)
    }
  } catch (e) {
    console.error('[health] db ping failed:', e.message)
    dbOk = false
  } finally {
    clearTimeout(timer)
  }

  // ── Prospețimea cron-ului ────────────────────────────────────────────────
  // Doar dacă DB-ul răspunde (altfel n-avem de unde citi). 'unknown' pe DB
  // căzut sau pe instalare nouă fără niciun scor calculat încă — NU declanșăm
  // alarmă falsă pe un proiect gol; doar o vechime REALĂ peste prag e 'stale'.
  let cron = 'unknown'
  let cronLastRun = null
  const cronProbe = (async () => {
    if (dbOk) {
      const cronController = new AbortController()
      const cronTimer = setTimeout(() => cronController.abort(), DB_PING_TIMEOUT_MS)
      try {
        const { data, error } = await supabase
          .from('customer_health_scores')
          .select('computed_at')
          .order('computed_at', { ascending: false })
          .limit(1)
          .abortSignal(cronController.signal)
        if (error) throw new Error(error.message)
        const last = data && data[0] && data[0].computed_at
        if (last) {
          cronLastRun = last
          const ageHours = (Date.now() - new Date(last).getTime()) / 3_600_000
          cron = ageHours > CRON_STALE_HOURS ? 'stale' : 'ok'
        }
      } catch (e) {
        // Eșecul verificării NU trebuie să dea fals-pozitiv „cron mort":
        // rămâne 'unknown' și nu influențează codul de status.
        console.error('[health] cron freshness check failed:', e.message)
      } finally {
        clearTimeout(cronTimer)
      }
    }
  })()

  // ── Plafonul de stocare ──────────────────────────────────────────────────
  // Aceeasi disciplina ca la cron: doar cand DB-ul raspunde, tolerant la esec
  // ('unknown' nu influenteaza codul de status), si DOAR 'critical' da 503.
  // Un RPC neaplicat inca (PGRST202) lasa 'unknown' — clientul se poate deploya
  // inaintea migratiei fara sa declanseze o alarma falsa.
  let storage = 'unknown'
  let storageDetail = null
  const storageProbe = (async () => {
    if (dbOk) {
      const sizeController = new AbortController()
      const sizeTimer = setTimeout(() => sizeController.abort(), DB_PING_TIMEOUT_MS)
      try {
        const { data, error } = await supabase
          .rpc('get_database_size')
          .abortSignal(sizeController.signal)
        if (error) throw new Error(error.message)
        const bytes = data && Number(data.bytes)
        if (Number.isFinite(bytes) && bytes > 0) {
          const pct = (bytes / DB_SIZE_LIMIT_BYTES) * 100
          storage =
            pct >= DB_SIZE_CRITICAL_PCT ? 'critical' : pct >= DB_SIZE_WARN_PCT ? 'warn' : 'ok'
          // PUBLIC: NIMIC numeric. `/health` e lovit din AFARA de UptimeRobot,
          // deci orice pune aici ajunge la oricine face curl. Severitatea
          // (`checks.storage`: ok/warn/critical) e tot ce-i trebuie unui monitor
          // ca sa alerteze — si e tot ce dam public.
          //
          // Nici macar `used_pct` nu ramane public: plafonul implicit e o CONSTANTA
          // publica (500 MB, in sursa si in CLAUDE.md), deci un procent la 0,1%
          // rezolutie da dimensiunea bazei la +/-262 kB, iar interogat zilnic da
          // curba de crestere — adica volumul de comenzi. Regula devine simpla si
          // uniforma: public = SEVERITATE, cu token = CIFRE.
          storageDetail = null
          // DIAGNOSTICUL COMPLET doar cu token. Intentia din mig 266 („alarma cara
          // diagnosticul cu ea") se pastreaza: founderul il ia intr-un singur curl
          // cu tokenul. FAIL-CLOSED: daca `HEALTH_DIAG_TOKEN` nu e setat, nu se da
          // detaliu deloc — absenta configurarii nu deschide suprafata.
          if (diagAllowed) {
            storageDetail = {
              bytes,
              pretty: data.pretty || null,
              limit_bytes: DB_SIZE_LIMIT_BYTES,
              used_pct: Math.round(pct * 10) / 10,
              top_tables: Array.isArray(data.top_tables) ? data.top_tables : null,
            }
          }
        }
      } catch (e) {
        // Nu transformam un esec de verificare intr-o alarma falsa de stocare.
        console.error('[health] db size check failed:', e.message)
      } finally {
        clearTimeout(sizeTimer)
      }
    }
  })()

  // ── Decalajul de schemă (mig 271, RES-08) ────────────────────────────────
  // `behind` = repo-ul are migrații pe care ledger-ul prod NU le are (deploy
  // înaintea migrației — un tranzit legitim, deci NU schimbă codul HTTP; îl
  // alertează health-watch, nu UptimeRobot). `unknown` = sonda nu răspunde
  // (RPC neaplicat / ledger absent) — după aplicarea mig 271 înseamnă sondă
  // moartă, vizibil din afară ca la storage. Public = doar severitatea;
  // numele migrațiilor lipsă cer token.
  let schema = 'unknown'
  let schemaDetail = null
  const schemaProbe = (async () => {
    if (dbOk) {
      const schemaController = new AbortController()
      const schemaTimer = setTimeout(() => schemaController.abort(), DB_PING_TIMEOUT_MS)
      try {
        const { data, error } = await supabase
          .rpc('get_schema_version', { p_expected: SCHEMA_MANIFEST.names })
          .abortSignal(schemaController.signal)
        if (error) throw new Error(error.message)
        // `missing` TREBUIE să fie array: un RPC re-format (cheie redenumită,
        // null pe ramura available=true) ar face altfel „behind" imposibil de
        // raportat — alarma de decalaj verde pentru totdeauna, clasa RES-08.
        if (data && typeof data === 'object' && data.available === true && Array.isArray(data.missing)) {
          const missing = data.missing
          schema = missing.length > 0 ? 'behind' : 'ok'
          if (diagAllowed) {
            schemaDetail = {
              expected_latest: SCHEMA_MANIFEST.names[SCHEMA_MANIFEST.names.length - 1] || null,
              db_latest: data.latest_name || null,
              ledger_count: Number.isFinite(Number(data.ledger_count)) ? Number(data.ledger_count) : null,
              missing,
            }
          }
        }
      } catch (e) {
        console.error('[health] schema version check failed:', e.message)
      } finally {
        clearTimeout(schemaTimer)
      }
    }
  })()

  // ── Backlog-ul cozilor (mig 271, RES-32) ─────────────────────────────────
  // /health vedea UN singur job din șase. Sonda e de BACKLOG (muncă ce
  // așteaptă și nu e ridicată), cu predicate care oglindesc claim-urile —
  // prinde și clasa „funcția rulează, întoarce 200 și nu face nimic" (cheie
  // lipsă, PGRST202), pe care un heartbeat per job n-o vede. `data` null sau
  // fără formă → `unknown`, NICIODATĂ `ok` (absența datelor nu e sănătate).
  let queues = 'unknown'
  let queueDetail = null
  const queuesProbe = (async () => {
    if (dbOk) {
      const qController = new AbortController()
      const qTimer = setTimeout(() => qController.abort(), DB_PING_TIMEOUT_MS)
      try {
        const { data, error } = await supabase.rpc('get_queue_backlog').abortSignal(qController.signal)
        if (error) throw new Error(error.message)
        if (data && typeof data === 'object' && data.cron && typeof data.cron === 'object' && data.bridge && typeof data.bridge === 'object') {
          /** Vârsta (s) a celui mai vechi rând în așteptare din coada `key`; null când coada lipsește sau nu are formă. */
          const age = (group, key) => {
            const q = group[key]
            if (!q || typeof q !== 'object' || Array.isArray(q)) return null
            const v = Number(q.oldest_age_s)
            return Number.isFinite(v) ? v : null
          }
          const cronAges = Object.keys(QUEUE_STALE_S).map((k) => [k, age(data.cron, k)])
          const bridgeAges = BRIDGE_QUEUES.map((k) => [k, age(data.bridge, k)])
          // `slack_alerts` are doar `waiting` (raportat, nu criteriu de 503) —
          // dar face parte din contract (QB1 îngheață cheile), deci lipsa sau
          // forma greșită e tot „RPC re-format", nu „nimic de raportat".
          const slack = data.cron.slack_alerts
          const slackOk =
            slack != null && typeof slack === 'object' && !Array.isArray(slack) && Number.isFinite(Number(slack.waiting))
          // Contractul COMPLET sau nimic: o coadă lipsă, redenumită sau fără
          // vârstă numerică înseamnă că sonda nu mai vorbește limba RPC-ului —
          // rămâne `unknown`. Un `ok` pe `{cron:{}, bridge:{}}` ar fi exact
          // alarma moartă pe care o închide RES-32 (recenzie #246).
          if (slackOk && cronAges.every(([, a]) => a != null) && bridgeAges.every(([, a]) => a != null)) {
            const stale = cronAges.some(([k, a]) => a > QUEUE_STALE_S[k])
            const bridgeWarn = bridgeAges.some(([, a]) => a > BRIDGE_WARN_S)
            queues = stale ? 'stale' : bridgeWarn ? 'warn' : 'ok'
            if (diagAllowed) queueDetail = data
          }
        }
      } catch (e) {
        console.error('[health] queue backlog check failed:', e.message)
      } finally {
        clearTimeout(qTimer)
      }
    }
  })()

  // ── Janitoarele pg_cron (mig 274) ────────────────────────────────────────
  // Severitatea se ia din PROSPEȚIMEA ULTIMEI REUȘITE (sau, pentru un job care
  // n-a reușit niciodată, din vârsta de la PROGRAMARE), nu din statusul ultimei
  // rulări — un eșec izolat pe un job zilnic nu are voie să țină alarma roșie
  // 24h (antrenează ignorarea ei), dar un job care nu mai REUȘEȘTE ajunge
  // oricum la `stale` după max_age_s-ul LUI din manifest.
  // `drift`   = manifest != cron.job (job lipsă, dezactivat, orar/comandă
  //             schimbate, sau job-stafie cu prefixul nostru) -> 503.
  // `stale`   = ultima reușită mai veche decât max_age_s -> 503. Pentru un job
  //             fără nicio reușită, semnalul e `since_scheduled_s` — singurul
  //             detector automat pentru „worker-ul pg_cron nu se conectează"
  //             (zero rulări = zero erori = verde perfect altfel).
  // `failing` = ULTIMA rulare a eșuat, dar o reușită e încă în fereastră -> 200;
  //             health-watch avertizează.
  // `warming` = programat, fără nicio reușită, încă în grație -> 200 (starea
  //             normală imediat după aplicarea migrației).
  // `absent`  = RPC-ul răspunde, dar pg_cron NU e instalat. Migrația pică
  //             ZGOMOTOS dacă nu poate instala extensia, deci un `false` aici,
  //             cu RPC-ul prezent, înseamnă că extensia a DISPĂRUT (toggle din
  //             Dashboard, restore, branch reset) -> 200 + warning din
  //             health-watch: e o regresie de configurare, nu o cădere, și
  //             trebuie să aibă o cale de întoarcere (vezi RUNBOOK).
  // `unknown` = RPC neaplicat (PGRST202) sau contract necunoscut. NU schimbă
  //             codul de status (deploy-înaintea-migrației e tranzit legitim).
  let pgcron = 'unknown'
  let pgcronDetail = null
  const pgcronProbe = (async () => {
    if (dbOk) {
      const pcController = new AbortController()
      const pcTimer = setTimeout(() => pcController.abort(), DB_PING_TIMEOUT_MS)
      try {
        const { data, error } = await supabase
          .rpc('get_cron_janitor_health')
          .abortSignal(pcController.signal)
        if (error) throw new Error(error.message)
        if (
          data && typeof data === 'object' && !Array.isArray(data) &&
          typeof data.available === 'boolean' && Array.isArray(data.unexpected)
        ) {
          if (data.available === false) {
            pgcron = 'absent'
            if (diagAllowed) pgcronDetail = data
          } else if (Array.isArray(data.jobs) && data.jobs.length > 0) {
            // `Number(null)` e 0 și `Number('')` e 0 — deci un `isFinite(Number(v))`
            // naiv ar lua un `max_age_s: null` drept „0 secunde" și ar raporta
            // `stale` în loc de `unknown` (prins de HL21). Numeric = număr finit
            // sau șir numeric ne-vid; nimic altceva.
            const isNum = (v) =>
              typeof v === 'number'
                ? Number.isFinite(v)
                : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
            /** Număr finit sau null (null = „nicio rulare”), altfel undefined = contract rupt. */
            const numOrNull = (v) => (v == null ? null : isNum(v) ? Number(v) : undefined)
            const shaped = data.jobs.every(
              (j) =>
                j && typeof j === 'object' && !Array.isArray(j) &&
                PGCRON_JOB_KEYS.every((k) => k in j) &&
                typeof j.scheduled === 'boolean' &&
                typeof j.active === 'boolean' &&
                typeof j.schedule_ok === 'boolean' &&
                isNum(j.max_age_s) &&
                isNum(j.since_scheduled_s) &&
                numOrNull(j.last_run_age_s) !== undefined &&
                numOrNull(j.last_success_age_s) !== undefined,
            )
            if (shaped) {
              // Vârsta care contează: ultima REUȘITĂ, sau — dacă n-a reușit
              // niciodată — cât timp a trecut de la programare.
              const freshness = (j) =>
                j.last_success_age_s == null ? Number(j.since_scheduled_s) : Number(j.last_success_age_s)
              const drift =
                data.unexpected.length > 0 ||
                data.jobs.some((j) => !j.scheduled || !j.active || !j.schedule_ok)
              const stale = data.jobs.some((j) => freshness(j) > Number(j.max_age_s))
              const failing = data.jobs.some((j) => j.last_status === 'failed')
              const warming = data.jobs.some((j) => j.last_success_age_s == null)
              pgcron = drift ? 'drift' : stale ? 'stale' : failing ? 'failing' : warming ? 'warming' : 'ok'
              if (diagAllowed) pgcronDetail = data
            }
          }
        }
      } catch (e) {
        console.error('[health] pg_cron janitor check failed:', e.message)
      } finally {
        clearTimeout(pcTimer)
      }
    }
  })()

  // Cele CINCI sonde tolerante rulează ÎN PARALEL, nu în serie: fiecare are
  // propriul AbortController (DB_PING_TIMEOUT_MS), deci în serie cazul cel mai
  // rău ar fi ping + 5 × timeout = 24 s — peste limita sincronă implicită de
  // 10 s a funcțiilor Netlify. O bază LENTĂ-dar-vie ar fi dat 502 FĂRĂ corp
  // (adică fără `checks`, fără diagnostic cu token) exact când ai nevoie de el.
  // În paralel plafonul e ping + 1 × timeout = 8 s. Semantica per sondă e
  // neschimbată: fiecare are try/catch/finally propriu și nu respinge niciodată.
  await Promise.all([cronProbe, storageProbe, schemaProbe, queuesProbe, pgcronProbe])

  // `pgcron` în drift/stale = plasele de recuperare fiscală din mig 262 sunt
  // INERTE, adică exact starea RES-04 pe care mig 274 o închide. `failing`,
  // `warming`, `absent` și `unknown` NU dau 503 — dar `warming` devine `stale`
  // după max_age_s, deci un worker mort ajunge oricum la 503.
  const healthy =
    dbOk && cron !== 'stale' && storage !== 'critical' && queues !== 'stale' &&
    pgcron !== 'drift' && pgcron !== 'stale'
  // PUBLIC = SEVERITATE, cu token = CIFRE (audit v3 RES-38): corpul public are
  // EXACT {status, checks, ts}. `config` (ce integrări sunt moarte),
  // `cron_last_run`, `storage_detail`, `schema_detail`, `queue_detail`,
  // `pgcron_detail` apar DOAR cu `x-health-diag`. Forma publică e înghețată de HL8.
  return jsonResponse(healthy ? 200 : 503, {
    status: healthy ? 'ok' : 'degraded',
    checks: { db: dbOk ? 'ok' : 'down', cron, storage, schema, queues, pgcron },
    ...(diagAllowed
      ? {
          config,
          cron_last_run: cronLastRun,
          storage_detail: storageDetail,
          schema_detail: schemaDetail,
          queue_detail: queueDetail,
          pgcron_detail: pgcronDetail,
        }
      : {}),
    ts,
  })
}
