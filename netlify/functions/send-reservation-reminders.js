// netlify/functions/send-reservation-reminders.js
// Cron-triggered (Netlify scheduled): la fiecare 10 min.
// Atomic claim via RPC `claim_reservation_reminders` → enqueue în
// email_queue cu dedup_key per rezervare. Idempotent — re-run nu
// trimite duplicate (RPC marchează `reminder_sent_at`).
//
// Schedule (netlify.toml):
//   [functions."send-reservation-reminders"]
//     schedule = "*/10 * * * *"

const { createClient } = require('@supabase/supabase-js')

exports.handler = async () => {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[send-reservation-reminders] Missing env vars')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'missing_env' }),
    }
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 1. Atomic claim — marchează reminder_sent_at=now() pe rândurile eligibile.
  // RPC selectează doar confirmed + reminder_sent_at IS NULL + email non-null +
  // în fereastra de [now, now + reminder_hours_before] per setări restaurant.
  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_reservation_reminders',
    { p_batch_size: 50 },
  )
  if (claimErr) {
    console.error('[send-reservation-reminders] claim failed:', claimErr)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: claimErr.message }),
    }
  }
  if (!claimed || claimed.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ enqueued: 0 }) }
  }

  // 2. Enqueue în email_queue (process-email-queue le livrează ≤ 5 min).
  let ok = 0
  let fail = 0
  for (const r of claimed) {
    try {
      const { error: enqErr } = await supabase.rpc('enqueue_email', {
        p_recipient_email: r.customer_email,
        p_template_kind: 'reservation_reminder',
        p_template_data: {
          customer_name: r.customer_name,
          restaurant_name: r.restaurant_name,
          restaurant_phone: r.restaurant_phone,
          starts_at: r.starts_at,
          party_size: r.party_size,
          confirmation_code: r.confirmation_code,
        },
        p_recipient_name: r.customer_name,
        p_dedup_key: 'reservation_reminder:' + r.id,
      })
      if (enqErr) {
        fail++
        console.error(
          '[send-reservation-reminders] enqueue failed for',
          r.id,
          enqErr.message,
        )
      } else {
        ok++
      }
    } catch (e) {
      fail++
      console.error('[send-reservation-reminders] exception for', r.id, e.message)
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ enqueued: ok, failed: fail }),
  }
}
