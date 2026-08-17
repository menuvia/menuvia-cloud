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

  const healthy = dbOk && cron !== 'stale'
  return jsonResponse(healthy ? 200 : 503, {
    status: healthy ? 'ok' : 'degraded',
    checks: { db: dbOk ? 'ok' : 'down', cron },
    cron_last_run: cronLastRun,
    config,
    ts,
  })
}
