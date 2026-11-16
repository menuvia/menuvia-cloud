// netlify/functions/send-push.js
// Called by Supabase Database Webhook when a new order is inserted.
// Sends Web Push notification to the push subscriptions of the restaurant's
// CURRENT team members (restaurant_memberships), each in the member's language.
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
const { NOREPLY_EMAIL } = require('./lib/appUrl')
const { ENABLED_STAFF_LANGS, isUuid, staffEmailLang, fetchUiLanguages } = require('./lib/emailLang')

// ── Textele notificării (lotul L8b) ─────────────────────────────
// Destinatarul e PERSONALUL: fiecare abonament primește textul în
// `profiles.ui_language` al user-ului lui, DOAR dacă limba e activă pentru
// personal (ENABLED_STAFF_LANGS, oglinda src/i18n/langs.ts) — azi doar româna,
// deci textul e cel de dinainte. Cuvintele mesei / pickup-ului sunt EXACT cele
// din ns/orders (`tableLabel`, `noTable`, `card_srcPickup`), iar numărul de
// produse e EXACT pluralul `items_count` din ns/common (cu formele lui:
// româna are „{n} de produse” de la 20, franceza „{n} de produits” pe `many`),
// ales cu `Intl.PluralRules(lang)` ca `selectPlural` din src/i18n/core.ts —
// notificarea spune ce scrie pe cardul din Bucătărie; PU11 citește glosarul și
// pică la orice divergență. Fără ore.
// service worker-ul (public/sw.js) afișează DOAR ce vine de aici.
const PUSH_STRINGS = Object.freeze({
  ro: {
    title: '🔔 Comandă nouă',
    table: 'Masa {table}',
    table_unknown: 'Masă necunoscută',
    no_table: 'Fără masă',
    pickup: 'Pickup',
    items: Object.freeze({ one: '{n} produs', few: '{n} produse', other: '{n} de produse' }),
    action: 'Deschide bucătăria',
  },
  en: {
    title: '🔔 New order',
    table: 'Table {table}',
    table_unknown: 'Unknown table',
    no_table: 'No table',
    pickup: 'Pickup',
    items: Object.freeze({ one: '{n} item', other: '{n} items' }),
    action: 'Open the kitchen',
  },
  fr: {
    title: '🔔 Nouvelle commande',
    table: 'Table {table}',
    table_unknown: 'Table inconnue',
    no_table: 'Sans table',
    pickup: 'À emporter',
    items: Object.freeze({ one: '{n} produit', many: '{n} de produits', other: '{n} produits' }),
    action: 'Ouvrir la cuisine',
  },
  de: {
    title: '🔔 Neue Bestellung',
    table: 'Tisch {table}',
    table_unknown: 'Unbekannter Tisch',
    no_table: 'Ohne Tisch',
    pickup: 'Abholung',
    items: Object.freeze({ one: '{n} Produkt', other: '{n} Produkte' }),
    action: 'Küche öffnen',
  },
})

// Un singur pas de înlocuire, cu FUNCȚIE de înlocuire: numele mesei îl scrie
// personalul, iar într-un șir de înlocuire `$$`, `$&`, `` $` `` și `$'` ar fi
// tipare („Bar $$ VIP” → „Bar $ VIP”). O valoare care conține „{n}” nu se
// re-expandează.
function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m))
}

const pluralRules = new Map()
function itemsLabel(lang, n) {
  const forms = (PUSH_STRINGS[lang] || PUSH_STRINGS.ro).items
  let rules = pluralRules.get(lang)
  if (!rules) {
    try {
      rules = new Intl.PluralRules(lang)
    } catch {
      rules = new Intl.PluralRules('ro')
    }
    pluralRules.set(lang, rules)
  }
  return fill(forms[rules.select(n)] || forms.other, { n })
}

/**
 * Corpul unei notificări, din datele REALE ale comenzii. Webhook-ul trimite
 * rândul din `orders`, care NU are `table_label` / `item_count` (prima coloană
 * e pe `waiter_calls`, a doua n-a existat niciodată) — de aceea corpul de
 * dinainte era mereu „Masă necunoscută · 0 produse”. Masa: instantaneul
 * `_table_name_snapshot` (mig 003), apoi `tables.name`; numărul de produse =
 * suma cantităților din `order_items` (porțiile de pregătit). Un număr
 * necunoscut (eroare / niciun rând încă) nu se mai afișează ca „0 produse”.
 */
function pushPayload(lang, order, details) {
  const key = PUSH_STRINGS[lang] ? lang : 'ro'
  const s = PUSH_STRINGS[key]
  const d = details || {}
  let where
  if (typeof d.tableName === 'string' && d.tableName.trim() !== '') where = fill(s.table, { table: d.tableName.trim() })
  else if (order.table_id) where = s.table_unknown
  else if (order.source === 'pickup') where = s.pickup
  else where = s.no_table
  const n = Number.isInteger(d.itemCount) && d.itemCount > 0 ? d.itemCount : null
  const count = n === null ? null : itemsLabel(key, n)
  return {
    title: s.title,
    body: count ? `${where} · ${count}` : where,
    tag: `order-${order.id}`,
    orderId: order.id,
    url: '/kitchen',
    actionTitle: s.action,
  }
}

/** Masa și numărul de produse ale comenzii — tolerant: orice eroare lasă câmpul necunoscut. */
async function fetchOrderDetails(supabase, order) {
  const out = { tableName: null, itemCount: null }
  const snapshot = order._table_name_snapshot
  const tableTask =
    typeof snapshot === 'string' && snapshot.trim() !== ''
      ? Promise.resolve(snapshot)
      : isUuid(order.table_id)
        ? (async () => {
            try {
              const { data, error } = await supabase.from('tables').select('name').eq('id', order.table_id).maybeSingle()
              if (error) {
                console.warn('[send-push] numele mesei indisponibil:', error.code || error.message)
                return null
              }
              return data && typeof data.name === 'string' ? data.name : null
            } catch (e) {
              console.warn('[send-push] numele mesei indisponibil:', e && e.message)
              return null
            }
          })()
        : Promise.resolve(null)
  const itemsTask = isUuid(order.id)
    ? (async () => {
        try {
          const { data, error } = await supabase.from('order_items').select('quantity').eq('order_id', order.id)
          if (error || !Array.isArray(data)) {
            if (error) console.warn('[send-push] produsele comenzii indisponibile:', error.code || error.message)
            return null
          }
          return data.reduce((sum, r) => sum + (Number.isInteger(r && r.quantity) && r.quantity > 0 ? r.quantity : 0), 0)
        } catch (e) {
          console.warn('[send-push] produsele comenzii indisponibile:', e && e.message)
          return null
        }
      })()
    : Promise.resolve(null)
  const [tableName, itemCount] = await Promise.all([tableTask, itemsTask])
  out.tableName = tableName
  out.itemCount = itemCount
  return out
}

/**
 * User-ii abonați care sunt ÎNCĂ membri ai restaurantului: `Set<user_id>`, sau
 * `null` dacă apartenența nu se poate afla (eroare).
 *
 * De ce e nevoie: `remove_member` (096a) șterge doar rândul din
 * `restaurant_memberships`; abonamentul push al omului rămâne (singurele
 * cascade sunt pe ștergerea restaurantului / a profilului), iar politica 136
 * (`is_member`) îl face doar INVIZIBIL pentru el, nu îl șterge. Fără filtru, un
 * ospătar scos din echipă primea în continuare fiecare comandă nouă — din L8b cu
 * masa și numărul de produse. Tot aici cad și abonamentele făcute în
 * founder-view (politica 136 trece prin `is_member` → `is_platform_admin`, fără
 * rând de apartenență): notificarea e pentru ECHIPA localului. Owner-ul are
 * mereu rândul lui (invariantul 096).
 */
async function fetchMemberIds(supabase, restaurantId, userIds) {
  const list = [...new Set(userIds.filter(isUuid))]
  if (!isUuid(restaurantId) || list.length === 0) return new Set()
  try {
    const { data, error } = await supabase
      .from('restaurant_memberships')
      .select('user_id')
      .eq('restaurant_id', restaurantId)
      .in('user_id', list)
    if (error || !Array.isArray(data)) {
      console.warn('[send-push] apartenența abonaților indisponibilă:', (error && (error.code || error.message)) || 'răspuns fără rânduri')
      return null
    }
    return new Set(data.map((r) => r && r.user_id).filter(isUuid))
  } catch (e) {
    console.warn('[send-push] apartenența abonaților indisponibilă:', e && e.message)
    return null
  }
}

/**
 * Cui pleacă notificarea și cu ce text: `{ targets, excluded, membershipUnknown }`,
 * `targets` = `[{ id, subscription, lang, payload }]` (payload deja serializat,
 * o singură dată pe limbă). Doar abonații care sunt membri; limba fiecăruia =
 * `ui_language` gate-uit pe `enabled` (implicit ENABLED_STAFF_LANGS — parametru
 * ca testul să poată activa a doua limbă, oglinda `resolveEmailContexts`).
 * Apartenența e FAIL-CLOSED: dacă nu se poate afla, nu pleacă nimic — alternativa
 * ar trimite datele comenzii unor oameni scoși din echipă. Masa, produsele și
 * limba rămân tolerante (o eroare = câmpul lipsă / româna).
 */
async function resolvePushTargets(supabase, order, subs, { enabled = ENABLED_STAFF_LANGS } = {}) {
  const list = Array.isArray(subs) ? subs.filter((s) => s && s.subscription) : []
  const userIds = list.map((s) => s.user_id)
  const [members, details, uiLangs] = await Promise.all([
    fetchMemberIds(supabase, order.restaurant_id, userIds),
    fetchOrderDetails(supabase, order),
    fetchUiLanguages(supabase, userIds),
  ])
  if (members === null) return { targets: [], excluded: list.length, membershipUnknown: true }
  const payloads = new Map()
  const targets = []
  for (const s of list) {
    if (!members.has(s.user_id)) continue
    const lang = staffEmailLang(uiLangs.get(s.user_id), enabled)
    if (!payloads.has(lang)) payloads.set(lang, JSON.stringify(pushPayload(lang, order, details)))
    targets.push({ id: s.id, subscription: s.subscription, lang, payload: payloads.get(lang) })
  }
  return { targets, excluded: list.length - targets.length, membershipUnknown: false }
}

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

exports.PUSH_STRINGS = PUSH_STRINGS
exports.pushPayload = pushPayload
exports.resolvePushTargets = resolvePushTargets
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Get all push subscriptions for this restaurant
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, subscription, user_id')
    .eq('restaurant_id', restaurantId)

  if (error || !subs?.length) return json(200, { ok: true, sent: 0 })

  webpush.setVapidDetails(
    `mailto:${VAPID_EMAIL || NOREPLY_EMAIL}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  )

  // Apartenența abonaților, masa + produsele (o interogare fiecare) și limba
  // abonaților (UNA pe `profiles`, oricâți abonați) — în paralel. Masa,
  // produsele și limba sunt tolerante (o eroare lasă româna și corpul fără
  // câmpul lipsă); apartenența e fail-closed (vezi resolvePushTargets).
  const { targets, excluded, membershipUnknown } = await resolvePushTargets(supabase, order, subs)
  if (membershipUnknown) {
    console.warn(`[send-push] apartenența nu s-a putut verifica — nicio notificare pentru restaurantul ${restaurantId}`)
    return json(200, { ok: true, sent: 0, skipped: 'membership_unavailable' })
  }
  if (targets.length === 0) return json(200, { ok: true, sent: 0, total: 0, excluded })

  const results = await Promise.allSettled(
    targets.map(({ id, subscription, payload }) =>
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
  console.log(`Push sent: ${sent}/${targets.length} for restaurant ${restaurantId} (excluded non-members: ${excluded})`)
  return json(200, { ok: true, sent, total: targets.length, excluded })
}
