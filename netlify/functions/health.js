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
//   200 { status: 'ok',       checks: { db: 'ok'   }, config, ts }  → DB răspunde
//   503 { status: 'degraded', checks: { db: 'down' }, config, ts }  → DB cade / lipsă env
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

  // Doar GET (HEAD tratat de Netlify) — monitoarele de uptime folosesc GET/HEAD.
  if (event && event.httpMethod && event.httpMethod !== 'GET') {
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
  try {
    // Ping minimal: 1 rând, o singură coloană, pe o tabelă stabilă. Nu ne
    // interesează conținutul — doar că DB-ul răspunde fără eroare la timp.
    const ping = supabase.from('restaurants').select('id').limit(1)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('db_ping_timeout')), DB_PING_TIMEOUT_MS),
    )
    const { error } = await Promise.race([ping, timeout])
    dbOk = !error
    if (error) {
      console.error('[health] db ping error:', error.message)
    }
  } catch (e) {
    console.error('[health] db ping failed:', e.message)
    dbOk = false
  }

  return jsonResponse(dbOk ? 200 : 503, {
    status: dbOk ? 'ok' : 'degraded',
    checks: { db: dbOk ? 'ok' : 'down' },
    config,
    ts,
  })
}
