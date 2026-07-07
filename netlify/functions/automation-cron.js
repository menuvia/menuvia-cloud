// netlify/functions/automation-cron.js
// Cron-triggered (Netlify scheduled): consolidate automation jobs in one fn.
// Schedules (netlify.toml):
//   [functions."automation-cron"]
//     schedule = "*/15 * * * *"  # every 15 minutes
//
// Jobs executed each tick:
//   1. process_lifecycle_events       (every tick)
//   2. compute_health_scores          (only at HH:00, HH:30 — every 30 min)
//   3. cleanup_old_rate_limits        (only daily at 03:15)
//   3c. process_account_deletions     (only daily at 03:30 — GDPR)
//   4. weekly_report dispatch         (only Friday 18:00 ish)
//   5. detect_winback_inactive        (only daily at 09:00 Bucharest)
//   6. detect_nps_due                 (only daily at 10:00 Bucharest)
//   7. daily_report dispatch          (only daily at 08:00 Bucharest)
//   8. stripe_events failed scan      (orar, la HH:00-HH:15)
//
// Idempotent: re-running shouldn't cause duplicate emails (dedup_key on queue).

const { createClient } = require('@supabase/supabase-js')

// ── Alertă Slack pe eșec de cron ────────────────────────────────
// Trimite founderului un mesaj scurt când un sub-job moare. Best-effort:
// dacă SLACK_WEBHOOK_URL lipsește → no-op; orice eroare de rețea/Slack e
// înghițită intern ca alertarea să NU doboare cron-ul. Nu aruncă niciodată.
// Pattern POST identic cu send-health-slack-alerts.js.
async function postCronAlert(jobName, message) {
  const slackWebhook = process.env.SLACK_WEBHOOK_URL
  if (!slackWebhook) return // env lipsă → no-op silent
  try {
    const text = `🔴 Cron job ${jobName} a eșuat: ${message}`
    const resp = await fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.error('[automation-cron] postCronAlert slack post failed:', resp.status, body.slice(0, 200))
    }
  } catch (e) {
    // Alertarea e best-effort — o eroare aici nu trebuie să propage în cron.
    console.error('[automation-cron] postCronAlert failed:', e.message)
  }
}

// ── Reminder Slack pentru founder (non-eroare) ──────────────────
// Folosit pentru semnale de tip „acțiune necesară" (ex. draft-uri de payout
// create). Best-effort, no-op fără webhook, nu aruncă niciodată.
async function postCronNotice(jobName, message) {
  const slackWebhook = process.env.SLACK_WEBHOOK_URL
  if (!slackWebhook) return
  try {
    const text = `🟡 Cron ${jobName}: ${message}`
    const resp = await fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    // Notice-ul de payout-draft e SINGURUL semnal că afiliații au bani de
    // procesat manual (Wise) — un POST Slack picat tăcut = payout-uri uitate.
    if (!resp.ok) {
      console.error(`[automation-cron] postCronNotice Slack non-ok (${resp.status}) pentru ${jobName}`)
    }
  } catch (e) {
    console.error('[automation-cron] postCronNotice failed:', e.message)
  }
}

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Missing env' }
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Bucharest local hour/minute for time-based dispatch
  const now = new Date()
  const fmtBuc = (d) => new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d).reduce((a, p) => ({ ...a, [p.type]: p.value }), {})
  const t = fmtBuc(now)
  const hour = parseInt(t.hour, 10)
  const minute = parseInt(t.minute, 10)
  const day = parseInt(t.day, 10)
  const weekday = t.weekday // "lun.", "vin.", etc. (ro)

  const results = {}

  // ── Job 1: process lifecycle events (every tick) ──
  try {
    const { data, error } = await supabase.rpc('process_lifecycle_events', { p_batch_size: 50 })
    if (error) throw error
    results.lifecycle_processed = data
  } catch (e) {
    console.error('[automation-cron] lifecycle events FAILED:', e.message)
    await postCronAlert('lifecycle-events', e.message)
    results.lifecycle_error = e.message
  }

  // ── Job 1b: expiră sesiunile de masă inactive (orar) ──
  // Sesiunile QR rămase deschise (clientul a plecat fără a închide) blochează masa pentru
  // următorii clienți. Le expirăm orar (inactiv > 3h). Idempotent — un tick ratat se reia.
  if (minute < 15) {
    try {
      const { data, error } = await supabase.rpc('expire_inactive_sessions', { p_inactive_hours: 3 })
      if (error) throw error
      results.sessions_expired = data
    } catch (e) {
      console.error('[automation-cron] expire sessions FAILED:', e.message)
      await postCronAlert('expire-sessions', e.message)
      results.sessions_expire_error = e.message
    }
  }

  // ── Job 2: compute health scores (every 30 min) ──
  if (minute < 15 || (minute >= 30 && minute < 45)) {
    try {
      const { data, error } = await supabase.rpc('compute_health_scores')
      if (error) throw error
      results.health_scores_computed = (data || []).length
      results.health_alerts = (data || []).filter(r => r.alert_needed).length
    } catch (e) {
      console.error('[automation-cron] health scores FAILED:', e.message)
      await postCronAlert('health-scores', e.message)
      results.health_error = e.message
    }
  }

  // ── Job 3: cleanup rate limits (once daily at 03:15) ──
  if (hour === 3 && minute >= 15 && minute < 30) {
    try {
      const { data, error } = await supabase.rpc('cleanup_old_rate_limits')
      if (error) throw error
      results.rate_limits_cleaned = data
    } catch (e) {
      console.error('[automation-cron] rate limit cleanup FAILED:', e.message)
      await postCronAlert('cleanup-rate-limits', e.message)
      results.cleanup_error = e.message
    }
  }

  // ── Job 3c: procesează ștergerile de cont GDPR (zilnic 03:30-04:30) ──
  // Conturile marcate cu deletion_requested_at și trecute de fereastra de
  // grație de 30 zile se șterg definitiv (cascade). RPC service_role-only,
  // proiectat pentru cron (vezi mig 042/055). Idempotent — un tick ratat se
  // reia a doua zi. Batch de 100/rulare ca să nu blocheze cron-ul.
  // FEREASTRĂ LĂRGITĂ (03:30–04:30, o oră) ca un tick Netlify ratat exact la
  // 03:30 să nu amâne ștergerea GDPR cu o zi întreagă.
  if ((hour === 3 && minute >= 30) || (hour === 4 && minute < 30)) {
    try {
      const { data, error } = await supabase.rpc('process_account_deletions')
      if (error) throw error
      results.account_deletions_processed = (data || []).length
    } catch (e) {
      // Eșec = conturi GDPR neșterse la termen → vizibil în logs (conformitate).
      console.error('[automation-cron] account deletions FAILED:', e.message)
      await postCronAlert('account-deletions', e.message)
      results.account_deletions_error = e.message
    }
  }

  // ── Job 3b: affiliate payout batch (lunar, catch-up robust) ──
  //   Creează DOAR draft-uri de payout din soldul plătibil (eligibil − în-zbor).
  //   NU mișcă bani — transferul efectiv (factură + Wise) e proces separat.
  //   FEREASTRĂ LARGĂ (primele 2 zile, înainte de 06:00) ca un tick ratat de
  //   Netlify să nu însemne „zero plăți luna asta". Un check ieftin de existență
  //   asigură că batch-ul (care iterează toți afiliații) rulează o SINGURĂ dată
  //   pe perioadă; restul tick-urilor sunt no-op.
  if (day <= 2 && hour < 6) {
    try {
      const period = `${t.year}-${t.month}-01` // prima zi a lunii curente (Buc)
      const { count, error: countErr } = await supabase
        .from('affiliate_payouts')
        .select('id', { count: 'exact', head: true })
        .eq('period_month', period)
      if (countErr) {
        // Eroarea de citire nu mai dispare tăcut (OPS-4); RPC-ul e idempotent,
        // deci continuăm, dar o logăm pentru observabilitate.
        console.error(`[automation-cron] payout existence-check failed for ${period}:`, countErr.message)
      }
      if (!count) {
        const { data, error } = await supabase.rpc('run_affiliate_payout_batch', {
          p_period_month: period,
        })
        if (error) throw error
        results.affiliate_payouts = data
        // Reminder founder: dacă batch-ul a creat draft-uri (data.created > 0),
        // ele stau în status 'draft' și necesită procesare manuală (factură + Wise).
        // Fără această notificare, payout-urile pot rămâne tăcut neprocesate.
        const created = (data && typeof data.created === 'number') ? data.created : 0
        if (created > 0) {
          await postCronNotice(
            'affiliate-payout',
            `${created} draft-uri de plată create, necesită procesare Wise`,
          )
        }
      }
    } catch (e) {
      // Batch ratat = afiliați neplătiți luna respectivă → vizibil în logs (OPS-1).
      console.error('[automation-cron] payout batch FAILED:', e.message)
      await postCronAlert('affiliate-payout', e.message)
      results.affiliate_payout_error = e.message
    }
  }

  // ── Job 4: weekly reports (Friday 18:00-20:00) ──
  // "vin." = Friday in Romanian
  // FEREASTRĂ LĂRGITĂ (2h) ca un tick ratat la 18:00 să nu amâne raportul
  // săptămânal cu o săptămână întreagă — se recuperează în aceeași seară.
  if (weekday.startsWith('vin') && hour >= 18 && hour < 20) {
    try {
      const reportsDispatched = await dispatchWeeklyReports(supabase)
      results.weekly_reports_dispatched = reportsDispatched
    } catch (e) {
      console.error('[automation-cron] weekly reports FAILED:', e.message)
      await postCronAlert('weekly-reports', e.message)
      results.weekly_error = e.message
    }
  }

  // ── Job 5: win-back inactive (daily 09:00-09:15 Bucharest) ──
  // Detector SQL face deduplication per lună prin dedup_key.
  if (hour === 9 && minute < 15) {
    try {
      const { data, error } = await supabase.rpc('detect_winback_inactive')
      if (error) throw error
      const row = (data && data[0]) || {}
      results.winback_7d = row.enqueued_7d ?? 0
      results.winback_30d = row.enqueued_30d ?? 0
    } catch (e) {
      console.error('[automation-cron] winback detect FAILED:', e.message)
      await postCronAlert('winback-inactive', e.message)
      results.winback_error = e.message
    }
  }

  // ── Job 6: NPS due (daily 10:00-10:15 Bucharest) ──
  // Useri la 60+ zile post-signup care n-au primit încă survey-ul.
  // Dedup_key lifetime — fiecare user primește exact 1 email vreodată.
  if (hour === 10 && minute < 15) {
    try {
      const { data, error } = await supabase.rpc('detect_nps_due')
      if (error) throw error
      results.nps_enqueued = data ?? 0
    } catch (e) {
      console.error('[automation-cron] nps detect FAILED:', e.message)
      await postCronAlert('nps-due', e.message)
      results.nps_error = e.message
    }
  }

  // ── Job 7: daily report (daily 08:00-09:00 Bucharest) ──
  // Raport pentru ieri către owner-ul fiecărui restaurant activ care a avut
  // comenzi. Dedup_key zilnic — re-run în aceeași zi nu duplică.
  // FEREASTRĂ LĂRGITĂ (1h) ca un tick ratat la 08:00 să se recupereze în
  // aceeași dimineață, nu să sară complet ziua respectivă.
  if (hour === 8 && minute < 60) {
    try {
      results.daily_reports_dispatched = await dispatchDailyReports(supabase)
    } catch (e) {
      console.error('[automation-cron] daily reports FAILED:', e.message)
      await postCronAlert('daily-reports', e.message)
      results.daily_error = e.message
    }
  }

  // ── Job 8: scan stripe_events blocate pe 'failed' (orar, HH:00-HH:15) ──
  // Webhook-urile Stripe eșuate (inclusiv comisioanele afiliat, după fixul din
  // stripe-webhook.js) se retrimit de Stripe ~3 zile; dacă retry-urile se
  // epuizează, rândul rămâne 'failed' SILENȚIOS și nimeni nu află. Scanăm
  // rândurile failed mai vechi de 1h (= probabil nu mai vine retry imediat)
  // și alertăm founder-ul pe Slack.
  // THROTTLE: fără stare în DB — alertăm doar în prima fereastră de 15 min a
  // fiecărei ore (determinist pe minutul curent), deci max 1 alertă/oră,
  // nu la fiecare tick de 15 min. Nota: coloana de timp e `received_at`
  // (mig 038), nu `created_at`.
  if (minute < 15) {
    try {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data, count, error } = await supabase
        .from('stripe_events')
        .select('event_id, event_type, received_at', { count: 'exact' })
        .eq('status', 'failed')
        .lt('received_at', cutoff)
        .order('received_at', { ascending: true })
        .limit(5)
      if (error) throw error
      results.stripe_failed_events = count ?? 0
      if (count && count > 0) {
        const rows = data || []
        const types = [...new Set(rows.map((r) => r.event_type))].join(', ')
        const ids = rows.map((r) => r.event_id).join(', ')
        await postCronAlert(
          'stripe-failed-events',
          `${count} evenimente Stripe blocate pe status='failed' de peste 1h ` +
            `(retry-urile Stripe s-au epuizat sau se vor epuiza) — necesită investigare manuală. ` +
            `Tipuri: ${types}. Cele mai vechi: ${ids}`,
        )
      }
    } catch (e) {
      // Eșecul scanului însuși nu trebuie să treacă neobservat — e exact
      // mecanismul care ne spune că banii/comisioanele au probleme.
      console.error('[automation-cron] stripe failed-events scan FAILED:', e.message)
      await postCronAlert('stripe-failed-events', e.message)
      results.stripe_failed_scan_error = e.message
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ran_at: now.toISOString(),
      bucharest_time: `${t.hour}:${t.minute}`,
      weekday,
      ...results,
    }),
  }
}

// Prag de eșecuri CONSECUTIVE la care oprim bucla per-restaurant și alertăm.
// Un șir lung de eșecuri identice (ex. coloană inexistentă într-un RPC) e
// aproape sigur un bug sistemic, nu o problemă izolată per restaurant —
// mai bine oprim devreme și alertăm decât să irosim tot batch-ul degeaba.
const MAX_CONSECUTIVE_REPORT_FAILURES = 10

// ── Dispatch weekly reports for all active restaurants ──────────
async function dispatchWeeklyReports(supabase) {
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, owner_id, name, profiles!inner(email, full_name)')
    .eq('is_active', true)

  if (error) throw error
  if (!restaurants || restaurants.length === 0) return 0

  let dispatched = 0
  let consecutiveFailures = 0
  for (const r of restaurants) {
    try {
      // Compute report data
      const { data: report, error: repErr } = await supabase.rpc('compute_weekly_report', {
        p_restaurant_id: r.id,
        p_week_start: null,
      })

      if (repErr) {
        console.warn(`[automation-cron] Report failed for ${r.id}:`, repErr.message)
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
          await postCronAlert(
            'weekly-reports',
            `${consecutiveFailures} eșecuri consecutive la compute_weekly_report, posibil bug sistemic — bucla s-a oprit după ${dispatched} rapoarte trimise`,
          )
          break
        }
        continue
      }
      consecutiveFailures = 0

      // Skip if zero activity (no point spamming)
      if (!report || report.orders === 0) continue

      // Enqueue email
      const weekTag = new Date().toISOString().slice(0, 10)
      const { error: enqErr } = await supabase.rpc('enqueue_email', {
        p_recipient_email: r.profiles.email,
        p_template_kind: 'weekly_report',
        p_template_data: { ...report, owner_name: r.profiles.full_name, restaurant_name: r.name },
        p_user_id: r.owner_id,
        p_recipient_name: r.profiles.full_name,
        p_scheduled_for: null,
        p_dedup_key: `weekly:${r.id}:${weekTag}`,
      })

      // Un enqueue eșuat NU e succes: nu incrementăm dispatched și tratăm eroarea
      // ca eșec consecutiv, ca pragul de alertă (bug sistemic) să nu fie ocolit.
      if (enqErr) {
        console.warn(`[automation-cron] Weekly enqueue failed for ${r.id}:`, enqErr.message)
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
          await postCronAlert(
            'weekly-reports',
            `${consecutiveFailures} eșecuri consecutive la enqueue_email, posibil bug sistemic — bucla s-a oprit după ${dispatched} rapoarte trimise`,
          )
          break
        }
        continue
      }
      consecutiveFailures = 0

      dispatched++
    } catch (e) {
      console.warn(`[automation-cron] Weekly report exception for ${r.id}:`, e.message)
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
        await postCronAlert(
          'weekly-reports',
          `${consecutiveFailures} eșecuri consecutive (excepții), posibil bug sistemic — bucla s-a oprit după ${dispatched} rapoarte trimise`,
        )
        break
      }
    }
  }

  return dispatched
}

// ── Dispatch daily reports for all active restaurants ──────────
// Raport pe ziua precedentă. Skip restaurante fără comenzi în acea zi
// (n-are sens să trimiți „0 lei, 0 comenzi" zilnic).
async function dispatchDailyReports(supabase) {
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, owner_id, name, profiles!inner(email, full_name)')
    .eq('is_active', true)

  if (error) throw error
  if (!restaurants || restaurants.length === 0) return 0

  // Dedup tag = ziua acoperită de raport (ieri în Bucharest).
  const yesterdayBuc = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - 24 * 60 * 60 * 1000))

  let dispatched = 0
  let consecutiveFailures = 0
  for (const r of restaurants) {
    try {
      const { data: report, error: repErr } = await supabase.rpc('compute_daily_report', {
        p_restaurant_id: r.id,
        p_day: null,
      })

      if (repErr) {
        console.warn(`[automation-cron] Daily report failed for ${r.id}:`, repErr.message)
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
          await postCronAlert(
            'daily-reports',
            `${consecutiveFailures} eșecuri consecutive la compute_daily_report, posibil bug sistemic — bucla s-a oprit după ${dispatched} rapoarte trimise`,
          )
          break
        }
        continue
      }
      consecutiveFailures = 0

      if (!report || report.orders === 0) continue

      const { error: enqErr } = await supabase.rpc('enqueue_email', {
        p_recipient_email: r.profiles.email,
        p_template_kind: 'daily_report',
        p_template_data: { ...report, owner_name: r.profiles.full_name, restaurant_name: r.name },
        p_user_id: r.owner_id,
        p_recipient_name: r.profiles.full_name,
        p_scheduled_for: null,
        p_dedup_key: `daily:${r.id}:${yesterdayBuc}`,
      })

      // Un enqueue eșuat NU e succes: nu incrementăm dispatched și tratăm eroarea
      // ca eșec consecutiv, ca pragul de alertă (bug sistemic) să nu fie ocolit.
      if (enqErr) {
        console.warn(`[automation-cron] Daily enqueue failed for ${r.id}:`, enqErr.message)
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
          await postCronAlert(
            'daily-reports',
            `${consecutiveFailures} eșecuri consecutive la enqueue_email, posibil bug sistemic — bucla s-a oprit după ${dispatched} rapoarte trimise`,
          )
          break
        }
        continue
      }
      consecutiveFailures = 0

      dispatched++
    } catch (e) {
      console.warn(`[automation-cron] Daily report exception for ${r.id}:`, e.message)
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
        await postCronAlert(
          'daily-reports',
          `${consecutiveFailures} eșecuri consecutive (excepții), posibil bug sistemic — bucla s-a oprit după ${dispatched} rapoarte trimise`,
        )
        break
      }
    }
  }

  return dispatched
}
