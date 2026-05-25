// netlify/functions/automation-cron.js
// Cron-triggered (Netlify scheduled): consolidate automation jobs in one fn.
// Schedules (netlify.toml):
//   [functions."automation-cron"]
//     schedule = "*/15 * * * *"  # every 15 minutes
//
// Jobs executed each tick:
//   1. process_lifecycle_events   (every tick)
//   2. compute_health_scores       (only at HH:00, HH:30 — every 30 min)
//   3. cleanup_old_rate_limits     (only daily at 03:15)
//   4. weekly_report dispatch      (only Friday 18:00 ish)
//
// Idempotent: re-running shouldn't cause duplicate emails (dedup_key on queue).

const { createClient } = require('@supabase/supabase-js')

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
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d).reduce((a, p) => ({ ...a, [p.type]: p.value }), {})
  const t = fmtBuc(now)
  const hour = parseInt(t.hour, 10)
  const minute = parseInt(t.minute, 10)
  const weekday = t.weekday // "lun.", "vin.", etc. (ro)

  const results = {}

  // ── Job 1: process lifecycle events (every tick) ──
  try {
    const { data, error } = await supabase.rpc('process_lifecycle_events', { p_batch_size: 50 })
    if (error) throw error
    results.lifecycle_processed = data
  } catch (e) {
    results.lifecycle_error = e.message
  }

  // ── Job 2: compute health scores (every 30 min) ──
  if (minute < 15 || (minute >= 30 && minute < 45)) {
    try {
      const { data, error } = await supabase.rpc('compute_health_scores')
      if (error) throw error
      results.health_scores_computed = (data || []).length
      results.health_alerts = (data || []).filter(r => r.alert_needed).length
    } catch (e) {
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
      results.cleanup_error = e.message
    }
  }

  // ── Job 4: weekly reports (Friday 18:00-18:15) ──
  // "vin." = Friday in Romanian
  if (weekday.startsWith('vin') && hour === 18 && minute < 15) {
    try {
      const reportsDispatched = await dispatchWeeklyReports(supabase)
      results.weekly_reports_dispatched = reportsDispatched
    } catch (e) {
      results.weekly_error = e.message
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

// ── Dispatch weekly reports for all active restaurants ──────────
async function dispatchWeeklyReports(supabase) {
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, owner_id, name, profiles!inner(email, full_name)')
    .eq('is_active', true)

  if (error) throw error
  if (!restaurants || restaurants.length === 0) return 0

  let dispatched = 0
  for (const r of restaurants) {
    try {
      // Compute report data
      const { data: report, error: repErr } = await supabase.rpc('compute_weekly_report', {
        p_restaurant_id: r.id,
        p_week_start: null,
      })

      if (repErr) {
        console.warn(`[automation-cron] Report failed for ${r.id}:`, repErr.message)
        continue
      }

      // Skip if zero activity (no point spamming)
      if (!report || report.orders === 0) continue

      // Enqueue email
      const weekTag = new Date().toISOString().slice(0, 10)
      await supabase.rpc('enqueue_email', {
        p_recipient_email: r.profiles.email,
        p_template_kind: 'weekly_report',
        p_template_data: { ...report, owner_name: r.profiles.full_name, restaurant_name: r.name },
        p_user_id: r.owner_id,
        p_recipient_name: r.profiles.full_name,
        p_scheduled_for: null,
        p_dedup_key: `weekly:${r.id}:${weekTag}`,
      })

      dispatched++
    } catch (e) {
      console.warn(`[automation-cron] Weekly report exception for ${r.id}:`, e.message)
    }
  }

  return dispatched
}
