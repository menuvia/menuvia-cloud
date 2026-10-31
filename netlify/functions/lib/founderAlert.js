// netlify/functions/lib/founderAlert.js
// Alertele de BANI și GDPR către fondator, prin coada de email (tipul
// `founder_alert`, mig 299; șablonul e în process-email-queue.js).
//
// De ce există: semnalele care spun că banii sau o obligație legală au o
// problemă (batch-ul de comisioane picat sau parțial, draft-uri de plată care
// așteaptă transferul, evenimente Stripe blocate, ștergerile GDPR picate)
// plecau DOAR pe Slack — iar Slack e oprit (decizia D4: „apelurile spre Slack
// devin founder_alert, maximum una pe zi"). Fără SLACK_WEBHOOK_URL, postCronAlert
// e no-op, deci exact alertele care cer o decizie nu ajungeau la nimeni.
//
// Plafonul de ZGOMOT e al producătorului (contractul șablonului): cel mult o
// alertă pe zi per tip, prin dedup_key `founder_alert:<kind>:<YYYY-MM-DD>`, cu
// ziua în Europe/Bucharest. Doar bani/juridic — restul rămâne pe Slack/loguri.
//
// Best-effort: NU aruncă niciodată (o alertă eșuată nu are voie să doboare
// jobul care a detectat problema); eșecul se loghează.
'use strict'

const { FOUNDER_EMAIL } = require('./appUrl')

/** Ziua calendaristică din România (YYYY-MM-DD) pentru un moment dat. */
function bucharestDay(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Pune în coadă o alertă `founder_alert`. Întoarce `{ ok, enqueued }`:
 * `enqueued: false` = deduplicată (alerta de azi pentru tipul ăsta a plecat deja).
 */
async function enqueueFounderAlert(supabase, { kind, title, details, actionUrl, now } = {}) {
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9_]*$/.test(kind)) {
    console.error('[founder-alert] tip de alertă invalid:', kind)
    return { ok: false, enqueued: false }
  }
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  try {
    const { data, error } = await supabase.rpc('enqueue_email', {
      p_recipient_email: FOUNDER_EMAIL,
      p_template_kind: 'founder_alert',
      p_template_data: {
        kind,
        title: String(title || ''),
        details: String(details || '').slice(0, 2000),
        occurred_at: at.toISOString(),
        action_url: actionUrl || '/founder',
      },
      p_user_id: null,
      p_recipient_name: null,
      p_scheduled_for: null,
      p_dedup_key: `founder_alert:${kind}:${bucharestDay(at)}`,
    })
    if (error) {
      console.error(`[founder-alert] ${kind}: enqueue_email a eșuat:`, error.message)
      return { ok: false, enqueued: false }
    }
    // enqueue_email întoarce null pe conflict de dedup_key (deja trimisă azi).
    return { ok: true, enqueued: data != null }
  } catch (e) {
    console.error(`[founder-alert] ${kind}: enqueue_email a aruncat:`, e && e.message)
    return { ok: false, enqueued: false }
  }
}

module.exports = { enqueueFounderAlert, bucharestDay }
