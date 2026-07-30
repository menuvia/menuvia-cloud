// netlify/functions/send-health-slack-alerts.js
// Cron-triggered (Netlify scheduled): la :05, :20, :35, :50 — 5 min după
// compute_health_scores rulează prin automation-cron (la :00, :15, :30, :45).
//
// Pattern:
//   1. claim_pending_slack_alerts() — atomic update + return scoruri critice
//      ne-alertate Slack în ultimele 24h. RPC marchează slack_alerted_at=now().
//   2. POST la SLACK_WEBHOOK_URL per restaurant — payload formatat (block kit).
//   3. Dacă SLACK_WEBHOOK_URL lipsește, RPC încă marchează slack_alerted_at →
//      asta ar fi BUG. Deci verificăm întâi env, exit early dacă lipsește
//      (RPC nu rulează → idempotent).
//
// Schedule (netlify.toml):
//   [functions."send-health-slack-alerts"]
//     schedule = "5,20,35,50 * * * *"
//
// Env vars:
//   SUPABASE_URL || VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SLACK_WEBHOOK_URL (opțional — dacă lipsește, funcția exit silent 200)

const { createClient } = require('@supabase/supabase-js')

exports.handler = async () => {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const slackWebhook = process.env.SLACK_WEBHOOK_URL

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[send-health-slack-alerts] Missing Supabase env')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'missing_supabase_env' }),
    }
  }

  // Slack webhook NU e setat → exit silent fără să atingem DB
  // (altfel claim_pending_slack_alerts ar marca slack_alerted_at fără să trimitem).
  if (!slackWebhook) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: 'no_slack_webhook' }),
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 1. Atomic claim
  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_pending_slack_alerts',
    { p_batch_size: 20 },
  )
  if (claimErr) {
    console.error('[send-health-slack-alerts] claim failed:', claimErr)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: claimErr.message }),
    }
  }
  if (!claimed || claimed.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ posted: 0 }) }
  }

  // 2. POST la Slack per restaurant
  let ok = 0
  let fail = 0
  // restaurant_id-urile pentru care POST-ul a eșuat — le resetăm la final ca
  // să re-încercăm la următorul tick (RPC-ul deja marcase slack_alerted_at).
  const failedIds = []
  for (const r of claimed) {
    try {
      const payload = buildSlackPayload(r)
      const resp = await fetch(slackWebhook, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        fail++
        failedIds.push(r.restaurant_id)
        const body = await resp.text().catch(() => '')
        console.error(
          '[send-health-slack-alerts] slack post failed',
          r.restaurant_id,
          resp.status,
          body.slice(0, 200),
        )
      } else {
        ok++
      }
    } catch (e) {
      fail++
      failedIds.push(r.restaurant_id)
      console.error(
        '[send-health-slack-alerts] exception for',
        r.restaurant_id,
        e.message,
      )
    }
  }

  // 3. Reset slack_alerted_at pentru rândurile eșuate → re-încercare next tick.
  // Dacă RPC-ul eșuează, restaurantele rămân cu slack_alerted_at deja setat de
  // claim_pending_slack_alerts (pas 1) și NU vor mai fi re-alertate în 24h, deși
  // POST-ul Slack a eșuat. O singură reîncercare imediată (fără backoff — cron-ul
  // rulează oricum la 15 min, nu merită complexitate suplimentară) acoperă eșecuri
  // tranzitorii de rețea; dacă și reîncercarea eșuează, doar logăm (given up).
  if (failedIds.length > 0) {
    let resetErr = (await supabase.rpc('mark_slack_alert_failed', {
      p_restaurant_ids: failedIds,
    })).error
    if (resetErr) {
      console.error(
        '[send-health-slack-alerts] mark_slack_alert_failed failed, retrying once:',
        resetErr,
      )
      resetErr = (await supabase.rpc('mark_slack_alert_failed', {
        p_restaurant_ids: failedIds,
      })).error
      if (resetErr) {
        console.error(
          '[send-health-slack-alerts] mark_slack_alert_failed retry failed, giving up:',
          resetErr,
        )
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ posted: ok, failed: fail }),
  }
}

// Slack Block Kit payload — actionable, scannable
function buildSlackPayload(r) {
  const lastLoginStr = r.last_login
    ? new Date(r.last_login).toLocaleDateString('ro-RO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'niciodată'
  const previousStr = r.previous_score != null ? ` (era ${r.previous_score})` : ''

  return {
    text: `Health critic: ${r.restaurant_name} — scor ${r.score}/100`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ Restaurant la risc' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Restaurant:*\n${r.restaurant_name || '—'}` },
          {
            type: 'mrkdwn',
            text: `*Scor:*\n${r.score}/100${previousStr} _(${r.trend})_`,
          },
          {
            type: 'mrkdwn',
            text: `*Patron:*\n${r.owner_full_name || '—'}\n${r.owner_email || ''}`,
          },
          {
            type: 'mrkdwn',
            text: `*Comenzi (7zi vs 7zi):*\n${r.orders_this_week ?? 0} → ${r.orders_prev_week ?? 0}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Ultimul login owner: *${lastLoginStr}* · Restaurant ID: \`${r.restaurant_id}\``,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              '_Acțiune recomandată: sună patronul în 24h. Re-alert după 24h dacă rămâne critic._',
          },
        ],
      },
    ],
  }
}
