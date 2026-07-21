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
  // Fallback VITE_ pentru paritate cu health.js/send-health-slack-alerts —
  // altfel cel mai critic cron (lifecycle + rapoarte + payout + GDPR) moare cu
  // 500 ÎNAINTE de a putea alerta, dacă mediul are doar VITE_SUPABASE_URL.
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const { SUPABASE_SERVICE_ROLE_KEY } = process.env
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

  // OPT-5: sub-joburile RPC independente (1, 1b–1e, 2, 8) porneau serial —
  // durata tick-ului era SUMA lor. Acum pornesc CONCURENT la definire (fiecare
  // își prinde singur erorile → promisiunile nu resping niciodată) și se
  // așteaptă TOATE înainte de return (altfel Netlify ar încheia funcția cu
  // joburi neterminate). Gate-urile temporale rămân neschimbate, în afara
  // fiecărui push. Joburile 3–7 (zilnice/rare) rămân seriale — se suprapun
  // oricum cu grupul concurent.
  const quickJobs = []

  // ── Job 1: process lifecycle events (every tick) ──
  quickJobs.push((async () => {
    try {
      const { data, error } = await supabase.rpc('process_lifecycle_events', { p_batch_size: 50 })
      if (error) throw error
      results.lifecycle_processed = data
    } catch (e) {
      console.error('[automation-cron] lifecycle events FAILED:', e.message)
      await postCronAlert('lifecycle-events', e.message)
      results.lifecycle_error = e.message
    }
  })())

  // ── Job 1b: expiră sesiunile de masă inactive (orar) ──
  // Sesiunile QR rămase deschise (clientul a plecat fără a închide) blochează masa pentru
  // următorii clienți. Le expirăm orar (inactiv > 3h). Idempotent — un tick ratat se reia.
  if (minute < 15) {
    quickJobs.push((async () => {
      try {
        const { data, error } = await supabase.rpc('expire_inactive_sessions', { p_inactive_hours: 3 })
        if (error) throw error
        results.sessions_expired = data
      } catch (e) {
        console.error('[automation-cron] expire sessions FAILED:', e.message)
        await postCronAlert('expire-sessions', e.message)
        results.sessions_expire_error = e.message
      }
    })())
  }

  // ── Job 1c: tichete bucătărie blocate pe 'sent' (orar) ──
  // Un bridge care a revendicat tichetul dar a murit înainte de confirm lasă
  // tichetul agățat în 'sent' — îl marcăm error (BRIDGE_TIMEOUT) ca să apară
  // butonul „Reîncearcă" în dashboard; purge pe terminale >30 zile (mig 227).
  if (minute < 15) {
    quickJobs.push((async () => {
      try {
        const { data, error } = await supabase.rpc('kitchen_tickets_mark_stale')
        // PGRST202 = mig 227 neaplicată încă (deploy frontend înaintea DB-ului)
        // — nu alertăm orar pentru o funcție care nu există încă.
        if (error && error.code !== 'PGRST202') throw error
        if (!error) results.kitchen_tickets_stale = data
      } catch (e) {
        console.error('[automation-cron] kitchen tickets stale FAILED:', e.message)
        await postCronAlert('kitchen-tickets-stale', e.message)
        results.kitchen_tickets_stale_error = e.message
      }
    })())
  }

  // ── Job 1e: facturi Oblio blocate în 'generating' (orar, mig 239) ──
  // Un kill de proces între claim și emitere lasă factura agățată în
  // 'generating' pentru totdeauna — o marcăm 'failed' cu eroare ambiguă
  // (NU o re-punem în coadă: risc de duplicat fiscal), ca să apară în lista
  // de eșecuri a founderului pentru retry manual după verificare în Oblio.
  if (minute < 15) {
    quickJobs.push((async () => {
      try {
        const { data, error } = await supabase.rpc('oblio_reclaim_stale_generating')
        // PGRST202 = mig 239 neaplicată încă (deploy frontend înaintea DB-ului).
        if (error && error.code !== 'PGRST202') throw error
        if (!error) results.oblio_stale_generating = data
      } catch (e) {
        console.error('[automation-cron] oblio stale generating FAILED:', e.message)
        await postCronAlert('oblio-stale-generating', e.message)
        results.oblio_stale_generating_error = e.message
      }
    })())
  }

  // ── Job 1d: auto no-show pe rezervări (orar, mig 234) ──
  // Rezervările 'confirmed' cu starts_at depășit de >120 min fără să fi fost
  // așezate (seated) trec automat în 'no_show' — alimentează badge-ul de
  // recidivist din ReservationsTab fără să depindă de disciplina staff-ului.
  if (minute < 15) {
    quickJobs.push((async () => {
      try {
        const { data, error } = await supabase.rpc('auto_mark_reservation_no_show')
        // PGRST202 = mig 234 neaplicată încă (deploy frontend înaintea DB-ului).
        if (error && error.code !== 'PGRST202') throw error
        if (!error) results.reservations_auto_no_show = data
      } catch (e) {
        console.error('[automation-cron] auto no-show FAILED:', e.message)
        await postCronAlert('reservations-auto-no-show', e.message)
        results.reservations_auto_no_show_error = e.message
      }
    })())
  }

  // ── Job 2: compute health scores (every 30 min) ──
  if (minute < 15 || (minute >= 30 && minute < 45)) {
    quickJobs.push((async () => {
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
    })())
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
    quickJobs.push((async () => {
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
    })())
  }

  // Barieră: toate sub-joburile concurente s-au încheiat înainte de return.
  await Promise.allSettled(quickJobs)

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

// OPT-5: dispecer partajat de rapoarte — chunk-uri PARALELE (per restaurant
// secvența compute→enqueue rămâne serială în interiorul thunk-ului). La 50 de
// restaurante: ~100 RTT-uri seriale (~10-20s, peste limita de 10s Netlify →
// batch omorât la mijloc) devin ~13 valuri (~2-3s). Circuit-breaker-ul
// păstrează semantica „eșecuri consecutive": ORICE succes/skip din chunk
// resetează contorul; doar chunk-urile integral eșuate îl cresc — un contor
// global ne-resetabil ar avorta batch-uri mari pe eșecuri izolate răspândite.
// perRestaurant întoarce 'sent' | 'skip' sau ARUNCĂ pe eșec (logat de apelant).
const REPORT_CHUNK_SIZE = 8

async function dispatchReportsChunked(restaurants, alertKey, perRestaurant) {
  let dispatched = 0
  let consecutiveFailures = 0
  for (let i = 0; i < restaurants.length; i += REPORT_CHUNK_SIZE) {
    const chunk = restaurants.slice(i, i + REPORT_CHUNK_SIZE)
    const settled = await Promise.allSettled(chunk.map((r) => perRestaurant(r)))
    let anyOk = false
    let failures = 0
    for (const st of settled) {
      if (st.status === 'fulfilled') {
        anyOk = true
        if (st.value === 'sent') dispatched++
      } else {
        failures++
      }
    }
    if (anyOk) consecutiveFailures = 0
    consecutiveFailures += failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_REPORT_FAILURES) {
      await postCronAlert(
        alertKey,
        `${consecutiveFailures} eșecuri consecutive, posibil bug sistemic — dispatch oprit după ${dispatched} rapoarte trimise`,
      )
      break
    }
  }
  return dispatched
}

// ── Dispatch weekly reports for all active restaurants ──────────
async function dispatchWeeklyReports(supabase) {
  // Short-circuit (perf): fereastra de dispatch e largă (2h, catch-up pe tick ratat),
  // dar odată ce raportul a fost trimis nu are rost să recomputăm compute_weekly_report
  // pentru FIECARE restaurant la fiecare tick. Dacă există deja un email weekly cu
  // weekTag-ul de azi, sărim tot batch-ul. Fail-open pe eroare de query (worst case:
  // recompute, oricum deduplicat pe dedup_key).
  const weekTag = new Date().toISOString().slice(0, 10)
  const { data: alreadySent, error: chkErr } = await supabase
    .from('email_queue')
    .select('id')
    .like('dedup_key', `weekly:%:${weekTag}`)
    .limit(1)
  if (!chkErr && alreadySent && alreadySent.length > 0) return 0

  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, owner_id, name, profiles!inner(email, full_name)')
    .eq('is_active', true)

  if (error) throw error
  if (!restaurants || restaurants.length === 0) return 0

  return dispatchReportsChunked(restaurants, 'weekly-reports', async (r) => {
    const { data: report, error: repErr } = await supabase.rpc('compute_weekly_report', {
      p_restaurant_id: r.id,
      p_week_start: null,
    })
    if (repErr) {
      console.warn(`[automation-cron] Report failed for ${r.id}:`, repErr.message)
      throw new Error(repErr.message)
    }
    // Skip if zero activity (no point spamming) — compute reușit = non-eșec.
    if (!report || report.orders === 0) return 'skip'
    const { error: enqErr } = await supabase.rpc('enqueue_email', {
      p_recipient_email: r.profiles.email,
      p_template_kind: 'weekly_report',
      p_template_data: { ...report, owner_name: r.profiles.full_name, restaurant_name: r.name },
      p_user_id: r.owner_id,
      p_recipient_name: r.profiles.full_name,
      p_scheduled_for: null,
      p_dedup_key: `weekly:${r.id}:${weekTag}`,
    })
    // Un enqueue eșuat NU e succes — contribuie la pragul de bug sistemic.
    if (enqErr) {
      console.warn(`[automation-cron] Weekly enqueue failed for ${r.id}:`, enqErr.message)
      throw new Error(enqErr.message)
    }
    return 'sent'
  })
}

// ── Dispatch daily reports for all active restaurants ──────────
// Raport pe ziua precedentă. Skip restaurante fără comenzi în acea zi
// (n-are sens să trimiți „0 lei, 0 comenzi" zilnic).
async function dispatchDailyReports(supabase) {
  // Dedup tag = ziua acoperită de raport (ieri în Bucharest).
  const yesterdayBuc = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - 24 * 60 * 60 * 1000))

  // Short-circuit (perf): dacă raportul zilnic a fost deja trimis pentru ziua asta,
  // nu recomputa compute_daily_report per restaurant la fiecare tick din fereastră.
  const { data: alreadySent, error: chkErr } = await supabase
    .from('email_queue')
    .select('id')
    .like('dedup_key', `daily:%:${yesterdayBuc}`)
    .limit(1)
  if (!chkErr && alreadySent && alreadySent.length > 0) return 0

  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, owner_id, name, profiles!inner(email, full_name)')
    .eq('is_active', true)

  if (error) throw error
  if (!restaurants || restaurants.length === 0) return 0

  return dispatchReportsChunked(restaurants, 'daily-reports', async (r) => {
    const { data: report, error: repErr } = await supabase.rpc('compute_daily_report', {
      p_restaurant_id: r.id,
      p_day: null,
    })
    if (repErr) {
      console.warn(`[automation-cron] Daily report failed for ${r.id}:`, repErr.message)
      throw new Error(repErr.message)
    }
    if (!report || report.orders === 0) return 'skip'
    const { error: enqErr } = await supabase.rpc('enqueue_email', {
      p_recipient_email: r.profiles.email,
      p_template_kind: 'daily_report',
      p_template_data: { ...report, owner_name: r.profiles.full_name, restaurant_name: r.name },
      p_user_id: r.owner_id,
      p_recipient_name: r.profiles.full_name,
      p_scheduled_for: null,
      p_dedup_key: `daily:${r.id}:${yesterdayBuc}`,
    })
    // Un enqueue eșuat NU e succes — contribuie la pragul de bug sistemic.
    if (enqErr) {
      console.warn(`[automation-cron] Daily enqueue failed for ${r.id}:`, enqErr.message)
      throw new Error(enqErr.message)
    }
    return 'sent'
  })
}
