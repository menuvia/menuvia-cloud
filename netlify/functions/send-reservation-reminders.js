// netlify/functions/send-reservation-reminders.js
// Cron-triggered (Netlify scheduled): la fiecare 10 min.
// Atomic claim via RPC `claim_reservation_reminders` → enqueue în
// email_queue + sms_queue (mig 233/234) cu dedup_key per rezervare.
// Idempotent — re-run nu trimite duplicate (RPC marchează `reminder_sent_at`).
//
// Schedule (netlify.toml):
//   [functions."send-reservation-reminders"]
//     schedule = "*/10 * * * *"

const { createClient } = require('@supabase/supabase-js')

// ── Alertă Slack pe eșecuri de enqueue ──────────────────────────
// Replicat din automation-cron.js. Best-effort: fără SLACK_WEBHOOK_URL → no-op;
// orice eroare de rețea/Slack e înghițită intern (guard pe resp.ok + try/catch)
// ca alertarea să NU doboare cron-ul. Nu aruncă niciodată.
async function postCronAlert(jobName, message) {
  const slackWebhook = process.env.SLACK_WEBHOOK_URL
  if (!slackWebhook) return // env lipsă → no-op silent
  try {
    const text = `🔴 Cron job ${jobName} a eșuat: ${message}`
    const resp = await fetch(slackWebhook, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.error('[send-reservation-reminders] postCronAlert slack post failed:', resp.status, body.slice(0, 200))
    }
  } catch (e) {
    // Alertarea e best-effort — o eroare aici nu trebuie să propage în cron.
    console.error('[send-reservation-reminders] postCronAlert failed:', e.message)
  }
}

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

  // 2. Enqueue pe AMBELE canale disponibile: email (email_queue) + SMS
  // (sms_queue, mig 233/234 — claim-ul aduce și rezervări doar-cu-telefon
  // când modulul sms_notifications e pornit). Semantica lui reminder_sent_at:
  //   • cel puțin un canal enqueued → rămâne marcat (trimis);
  //   • niciun canal enqueued, dar a existat un EȘEC real (eroare RPC) →
  //     reset la NULL pentru retry la tick-ul următor;
  //   • niciun canal enqueued, fără eșec (email absent + enqueue_sms a întors
  //     null = skip definitiv: modul oprit între timp / plafon lunar atins /
  //     număr ne-mobil) → rămâne marcat. Un reset aici ar re-revendica aceeași
  //     rezervare la fiecare 10 min, la nesfârșit, fără să existe vreun canal.
  let ok = 0
  let fail = 0
  for (const r of claimed) {
    let emailAttempted = false
    let emailOk = false
    let smsEnqueued = false
    let smsErrored = false
    try {
      if (r.customer_email) {
        emailAttempted = true
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
          console.error(
            '[send-reservation-reminders] email enqueue failed for',
            r.id,
            enqErr.message,
          )
        } else {
          emailOk = true
        }
      }

      // enqueue_sms își face singur toate gate-urile (modul/plan/plafon/mobil
      // RO) și întoarce null pe skip — null NU e eroare. Înainte de mig 233,
      // valoarea de enum lipsește → eroare 22P02: o tratăm ca skip (frontend
      // deployat înaintea migrației, pattern-ul PGRST202 din automation-cron).
      const { data: smsId, error: smsErr } = await supabase.rpc('enqueue_sms', {
        p_restaurant_id: r.restaurant_id,
        p_recipient_phone: r.customer_phone,
        p_template_kind: 'reservation_reminder',
        p_template_data: {
          restaurant_name: r.restaurant_name,
          restaurant_phone: r.restaurant_phone,
          starts_at: r.starts_at,
          party_size: r.party_size,
          confirmation_code: r.confirmation_code,
        },
        p_dedup_key: 'sms_reservation_reminder:' + r.id,
      })
      if (smsErr) {
        const enumMissing =
          smsErr.code === '22P02' || /invalid input value for enum/i.test(smsErr.message || '')
        if (enumMissing) {
          console.warn('[send-reservation-reminders] SMS skip (mig 233 neaplicată încă)')
        } else {
          smsErrored = true
          console.error(
            '[send-reservation-reminders] sms enqueue failed for',
            r.id,
            smsErr.message,
          )
        }
      } else if (smsId) {
        smsEnqueued = true
      }

      const anyOk = emailOk || smsEnqueued
      const realFailure = !anyOk && ((emailAttempted && !emailOk) || smsErrored)
      if (anyOk) {
        ok++
      } else if (realFailure) {
        fail++
        // Reset pentru retry — RPC-ul de claim filtrează reminder_sent_at IS
        // NULL; fără reset, rezervarea rămâne marcată permanent și reminderul
        // nu se mai trimite. reservations NU e lockdown table → UPDATE direct.
        const { error: resetErr } = await supabase
          .from('reservations')
          .update({ reminder_sent_at: null })
          .eq('id', r.id)
        if (resetErr) {
          console.error(
            '[send-reservation-reminders] reset reminder_sent_at failed for',
            r.id,
            resetErr.message,
          )
        }
      }
      // else: skip definitiv (nimic de trimis) — flag-ul rămâne setat.
    } catch (e) {
      fail++
      console.error('[send-reservation-reminders] exception for', r.id, e.message)
      // Fără canal confirmat → reset, ca pe ramura realFailure.
      if (!emailOk && !smsEnqueued) {
        const { error: resetErr } = await supabase
          .from('reservations')
          .update({ reminder_sent_at: null })
          .eq('id', r.id)
        if (resetErr) {
          console.error(
            '[send-reservation-reminders] reset reminder_sent_at failed for',
            r.id,
            resetErr.message,
          )
        }
      }
    }
  }

  // Dacă au fost eșecuri, alertăm founder-ul pe Slack — fără asta, un enqueue
  // rupt sistemic ar trece tăcut (rezervările sunt resetate, dar nimeni nu află).
  if (fail > 0) {
    await postCronAlert(
      'reservation-reminders',
      `${fail} rezervări au eșuat la enqueue (din ${claimed.length} revendicate); reminder_sent_at resetat pentru retry la tick-ul următor`,
    )
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ enqueued: ok, failed: fail }),
  }
}
