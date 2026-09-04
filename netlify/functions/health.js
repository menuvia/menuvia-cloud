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
// Răspuns:
//   200 { status: 'ok',       checks: { db: 'ok',   cron: 'ok'    }, ... }
//   503 { status: 'degraded', checks: { db: 'down' | cron: 'stale' }, ... }
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
// fallback-uri silențioase care mascau erori). Fără secrete în răspuns.
//
// Env vars:
//   SUPABASE_URL || VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js')

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
  // Comparatie pe lungime egala inainte de egalitate, ca sa nu depindem de
  // scurtcircuitul lui `===` pe siruri de lungimi diferite.
  const diagToken = process.env.HEALTH_DIAG_TOKEN || ''
  const headers = (event && event.headers) || {}
  const presentedDiag =
    (event && event.queryStringParameters && event.queryStringParameters.diag) ||
    headers['x-health-diag'] ||
    headers['X-Health-Diag'] ||
    ''
  const diagAllowed =
    diagToken.length > 0 &&
    presentedDiag.length === diagToken.length &&
    presentedDiag === diagToken

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Lipsa env-ului de bază = nu putem verifica DB-ul → degraded (nu 500),
  // ca monitorul să alerteze la fel ca la un DB căzut.
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(503, {
      status: 'degraded',
      checks: { db: 'down' },
      config,
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

  // ── Plafonul de stocare ──────────────────────────────────────────────────
  // Aceeasi disciplina ca la cron: doar cand DB-ul raspunde, tolerant la esec
  // ('unknown' nu influenteaza codul de status), si DOAR 'critical' da 503.
  // Un RPC neaplicat inca (PGRST202) lasa 'unknown' — clientul se poate deploya
  // inaintea migratiei fara sa declanseze o alarma falsa.
  let storage = 'unknown'
  let storageDetail = null
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
        // PUBLIC: doar procentul. `/health` e lovit din AFARA de UptimeRobot,
        // deci orice pune aici ajunge la oricine face curl. Procentul e tot ce-i
        // trebuie unui monitor ca sa stie cat de rau e; numele tabelelor si
        // dimensiunile lor scurg schema SI volumul de business (cat de mare e
        // `orders`, cat de mare e `audit_log`).
        storageDetail = { used_pct: Math.round(pct * 10) / 10 }
        // DIAGNOSTICUL COMPLET doar cu token. Intentia din mig 266 („alarma cara
        // diagnosticul cu ea") se pastreaza: founderul il ia intr-un singur curl
        // cu tokenul. FAIL-CLOSED: daca `HEALTH_DIAG_TOKEN` nu e setat, nu se da
        // detaliu deloc — absenta configurarii nu deschide suprafata.
        if (diagAllowed) {
          storageDetail.bytes = bytes
          storageDetail.pretty = data.pretty || null
          storageDetail.limit_bytes = DB_SIZE_LIMIT_BYTES
          storageDetail.top_tables = Array.isArray(data.top_tables) ? data.top_tables : null
        }
      }
    } catch (e) {
      // Nu transformam un esec de verificare intr-o alarma falsa de stocare.
      console.error('[health] db size check failed:', e.message)
    } finally {
      clearTimeout(sizeTimer)
    }
  }

  const healthy = dbOk && cron !== 'stale' && storage !== 'critical'
  return jsonResponse(healthy ? 200 : 503, {
    status: healthy ? 'ok' : 'degraded',
    checks: { db: dbOk ? 'ok' : 'down', cron, storage },
    cron_last_run: cronLastRun,
    storage_detail: storageDetail,
    config,
    ts,
  })
}
