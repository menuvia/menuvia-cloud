// netlify/functions/process-sms-queue.js
// Cron-triggered (Netlify scheduled): la fiecare 1 min — „comanda gata la
// pickup" e time-sensitive (clientul e pe drum); funcția iese imediat când
// coada e goală, deci costul unui tick e neglijabil.
//
// Procesează coada sms_queue (mig 228) → trimite prin SMSO.ro → marchează status.
// Clonă structurală a lui process-email-queue.js (claim atomic + backoff +
// alertă Slack pe eșec de configurare).
//
// Env:
//   SMSO_API_KEY  — obligatoriu (fără el: skip cu warn, ca RESEND_API_KEY).
//   SMSO_SENDER   — opțional; senderul alfanumeric (ex. 'Menuvia') cere
//                   aprobarea SMSO — fără aprobare, omite variabila și SMSO
//                   folosește senderul numeric implicit al contului.
//
// Schedule (netlify.toml):
//   [functions."process-sms-queue"]
//     schedule = "* * * * *"

const { createClient } = require('@supabase/supabase-js')

// ── Template-uri SMS ────────────────────────────────────────────
// FĂRĂ diacritice: un singur caracter non-GSM-7 forțează UCS-2 (70 caractere/
// segment în loc de 160) și dublează costul. Ținta: <= 160 caractere.
const RO_MAP = { ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't',
                 Ă: 'A', Â: 'A', Î: 'I', Ș: 'S', Ş: 'S', Ț: 'T', Ţ: 'T' }
function stripDiacritics(text) {
  return String(text || '').replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (c) => RO_MAP[c] || c)
}

// '15 iul 19:30' în ora României — lunile scurte RO nu au diacritice.
function formatDateTimeRo(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString('ro-RO', {
      day: 'numeric', month: 'short', timeZone: 'Europe/Bucharest',
    }).replace('.', '')
    const time = d.toLocaleTimeString('ro-RO', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest',
    })
    return `${date} ${time}`
  } catch {
    return ''
  }
}

const TEMPLATES = {
  reservation_confirmed: (d) => {
    const name = stripDiacritics(d.restaurant_name || 'Restaurantul').slice(0, 30)
    const when = formatDateTimeRo(d.starts_at)
    const base = `${name}: Rezervare confirmata ${when} pentru ${d.party_size || '?'} pers. Cod: ${d.confirmation_code || '-'}.`
    const withPhone = d.restaurant_phone ? `${base} Modificari? ${d.restaurant_phone}` : base
    return (withPhone.length <= 160 ? withPhone : base).slice(0, 160)
  },
  pickup_ready: (d) => {
    const name = stripDiacritics(d.restaurant_name || 'Restaurantul').slice(0, 40)
    return `${name}: Comanda #${d.short_id || ''} este gata de ridicare. Te asteptam!`.slice(0, 160)
  },
}

// Parsarea răspunsului SMSO e izolată aici — dacă forma API-ului diferă,
// schimbarea e într-un singur loc. Documentația SMSO v1: POST /api/v1/send,
// header X-Authorization, body { to, body, sender? }; succes = HTTP 2xx cu
// { responseCode/status, ...id-ul mesajului sub 'id'/'message_id' }.
function parseSmsoResponse(json) {
  if (!json || typeof json !== 'object') return { messageId: null }
  return { messageId: json.id || json.message_id || json.messageId || null }
}

// Alertă Slack best-effort — DOAR pentru eșecuri de CONFIGURARE (401/403 =
// cheie invalidă/rotită): fără ea coada devine 'failed' tăcut.
async function postSmsAlert(message) {
  const slackWebhook = process.env.SLACK_WEBHOOK_URL
  if (!slackWebhook) return
  try {
    const resp = await fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🔴 process-sms-queue: ${message}` }),
    })
    if (!resp.ok) console.error(`[process-sms-queue] alertă Slack non-ok (${resp.status})`)
  } catch (e) {
    console.error('[process-sms-queue] alertă Slack a eșuat:', e && e.message)
  }
}

// ── Main handler ──────────────────────────────────────────────
exports.handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const { SUPABASE_SERVICE_ROLE_KEY, SMSO_API_KEY, SMSO_SENDER } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Missing env' }
  }
  if (!SMSO_API_KEY) {
    console.warn('[process-sms-queue] SMSO_API_KEY not set — SMS skipped')
    return { statusCode: 200, body: 'No SMSO key; skipped' }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Claim atomic (FOR UPDATE SKIP LOCKED + reclaim stale-sending, ca la email).
  const { data: pending, error } = await supabase.rpc('claim_sms_batch', { p_limit: 30 })

  if (error) {
    // PGRST202 = mig 228 neaplicată încă (deploy frontend înaintea DB-ului).
    if (error.code === 'PGRST202') {
      return { statusCode: 200, body: 'sms_queue RPC missing; skipped' }
    }
    console.error('[process-sms-queue] Claim failed:', error.message)
    return { statusCode: 500, body: error.message }
  }

  if (!pending || pending.length === 0) {
    return { statusCode: 200, body: 'No pending SMS' }
  }

  let sent = 0, failed = 0, authFailures = 0

  for (const sms of pending) {
    const template = TEMPLATES[sms.template_kind]
    if (!template) {
      // Enum extins în DB înaintea deploy-ului JS: cap pe TIMP (24h), fără
      // bump pe failed_attempts — același raționament ca la email.
      const ageMs = Date.now() - new Date(sms.created_at).getTime()
      const tooOld = Number.isFinite(ageMs) && ageMs > 24 * 60 * 60_000
      await supabase.from('sms_queue').update({
        status: tooOld ? 'failed' : 'queued',
        claimed_at: null,
        last_error: `Unknown template: ${sms.template_kind}`,
        scheduled_for: new Date(Date.now() + 15 * 60_000).toISOString(),
      }).eq('id', sms.id)
      failed++
      continue
    }

    let text
    try {
      text = template(sms.template_data || {})
    } catch (err) {
      await supabase.from('sms_queue').update({
        status: 'failed',
        last_error: `Template render: ${err.message}`,
        failed_attempts: sms.failed_attempts + 1,
      }).eq('id', sms.id)
      failed++
      continue
    }

    try {
      const res = await fetch('https://app.smso.ro/api/v1/send', {
        method: 'POST',
        headers: {
          'X-Authorization': SMSO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: sms.recipient_phone,
          body: text,
          ...(SMSO_SENDER ? { sender: SMSO_SENDER } : {}),
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        const smsoErr = new Error(`SMSO ${res.status}: ${errText.slice(0, 200)}`)
        smsoErr.status = res.status
        // 4xx (except 429) = permanent (număr respins, sender neaprobat) —
        // retry-ul nu schimbă rezultatul. 429/5xx/network → backoff.
        smsoErr.permanent = res.status >= 400 && res.status < 500 && res.status !== 429
        throw smsoErr
      }

      let messageId = null
      try {
        messageId = parseSmsoResponse(await res.json()).messageId
      } catch {
        /* corp non-JSON la 2xx — acceptăm, id-ul rămâne null */
      }

      // SMS-ul a plecat (2xx). SMSO NU are Idempotency-Key ca Resend — dacă
      // UPDATE-ul de mai jos eșuează, reclaim-ul (10 min) POATE retrimite:
      // risc rezidual acceptat (identic cu emailul pre-mig-167); logăm clar.
      const { error: markErr } = await supabase.from('sms_queue').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: messageId,
      }).eq('id', sms.id)
      if (markErr) {
        console.error(
          `[process-sms-queue] DUBLU-SEND RISC: SMS ${sms.id} (${sms.template_kind} → ` +
          `${sms.recipient_phone}) trimis prin SMSO, dar marcarea 'sent' a eșuat: ` +
          `${markErr.message}. Reclaim-ul îl poate retrimite.`
        )
        failed++
        continue
      }
      sent++
    } catch (err) {
      const attempts = sms.failed_attempts + 1
      if (err.status === 401 || err.status === 403) authFailures++
      if (err.permanent) {
        await supabase.from('sms_queue').update({
          status: 'failed',
          failed_attempts: attempts,
          last_error: String(err.message || err).slice(0, 500),
        }).eq('id', sms.id)
      } else {
        await supabase.from('sms_queue').update({
          status: attempts >= 3 ? 'failed' : 'queued',
          claimed_at: null,
          failed_attempts: attempts,
          last_error: String(err.message || err).slice(0, 500),
          scheduled_for: new Date(Date.now() + attempts * 10 * 60_000).toISOString(),
        }).eq('id', sms.id)
      }
      failed++
    }
  }

  if (authFailures > 0) {
    await postSmsAlert(
      `${authFailures}/${pending.length} SMS-uri respinse cu 401/403 de SMSO — ` +
      `cheia SMSO_API_KEY pare invalidă/rotită. Coada de SMS (confirmări rezervare, ` +
      `pickup gata) nu mai pleacă până la remedierea cheii.`,
    )
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: pending.length, sent, failed, authFailures }),
  }
}
