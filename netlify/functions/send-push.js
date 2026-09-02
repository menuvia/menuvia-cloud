// netlify/functions/send-push.js
// Called by Supabase Database Webhook when a new order is inserted.
// Sends Web Push notification to all kitchen subscriptions for the restaurant.
//
// Webhook setup (after migration-019 is run):
//   Supabase → Database → Webhooks → Create webhook:
//     Name:    send-push-on-order
//     Table:   orders
//     Event:   INSERT
//     URL:     https://YOUR_SITE.netlify.app/.netlify/functions/send-push
//     Headers: x-webhook-secret: <WEBHOOK_SECRET>
//              Content-Type: application/json

const { createClient } = require('@supabase/supabase-js')
const webpush = require('web-push')
const crypto = require('crypto')

/**
 * Comparare constant-time a secretului (anti timing attack) — oglindă
 * welcome-email.js (audit v3 SEC-09: surorile comparau cu `!==`).
 * @param {unknown} a valoarea primită (header)
 * @param {unknown} b valoarea așteptată (env)
 * @returns {boolean} true doar la egalitate exactă (lungime + bytes)
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  // Validate webhook secret (fail-closed — oglindă welcome-email.js).
  // Dacă WEBHOOK_SECRET nu e configurat, `secret !== undefined` ar fi false când lipsește
  // și headerul (undefined !== undefined) → bypass de auth. Refuzăm explicit ambele cazuri.
  const expectedSecret = process.env.WEBHOOK_SECRET
  if (!expectedSecret) {
    console.error('[send-push] WEBHOOK_SECRET neconfigurat — refuz (fail-closed)')
    return json(503, { error: 'Webhook secret not configured' })
  }
  const secret = event.headers['x-webhook-secret'] || event.headers['X-Webhook-Secret']
  if (!secret || !safeEqual(secret, expectedSecret)) return json(401, { error: 'Unauthorized' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env

  // Graceful no-op if VAPID not configured yet
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('VAPID keys not configured — push notifications skipped')
    return json(200, { ok: true, skipped: true })
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }

  // Supabase webhook sends { type, table, record, old_record, schema }
  const order = body.record
  if (!order || body.type !== 'INSERT') return json(200, { ok: true, skipped: 'not an insert' })

  const restaurantId = order.restaurant_id
  const tableLabel   = order.table_label || 'Masă necunoscută'
  const itemCount    = order.item_count || 0

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Get all push subscriptions for this restaurant
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('restaurant_id', restaurantId)

  if (error || !subs?.length) return json(200, { ok: true, sent: 0 })

  webpush.setVapidDetails(
    `mailto:${VAPID_EMAIL || 'noreply@menuvia.ro'}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  )

  const payload = JSON.stringify({
    title:   '🔔 Comandă nouă',
    body:    `${tableLabel} · ${itemCount} produs${itemCount !== 1 ? 'e' : ''}`,
    tag:     `order-${order.id}`,
    orderId: order.id,
    url:     '/kitchen',
  })

  const results = await Promise.allSettled(
    subs.map(({ id, subscription }) =>
      webpush.sendNotification(subscription, payload).catch((err) => {
        // Remove expired/invalid subscriptions (410 Gone) — ștergem după id (determinist),
        // nu după obiectul jsonb serializat (match pe conținut, fragil).
        if (err.statusCode === 410 || err.statusCode === 404) {
          return supabase.from('push_subscriptions')
            .delete()
            .eq('id', id)
        }
        throw err
      })
    )
  )

  const sent = results.filter((r) => r.status === 'fulfilled').length
  console.log(`Push sent: ${sent}/${subs.length} for restaurant ${restaurantId}`)
  return json(200, { ok: true, sent, total: subs.length })
}
