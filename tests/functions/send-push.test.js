// tests/functions/send-push.test.js
// Notificarea push „comandă nouă” către personal (send-push.js, webhook pe
// INSERT în orders) — primul test al funcției (lotul L8b).
//
//   PU1  controale de acces neschimbate: fără WEBHOOK_SECRET → 503 (fail-closed),
//        secret greșit → 401, ambele fără nicio interogare; un eveniment care nu e
//        INSERT nu atinge baza.
//   PU2  corpul vine din datele REALE: masa din `tables.name` (după
//        `orders.table_id`), numărul de produse = suma cantităților din
//        `order_items` → „Masa T5 · 3 produse”; titlul, tag-ul, orderId, url și
//        eticheta acțiunii din payload.
//        [PICĂ: corpul vechi pe `order.table_label` / `order.item_count`, care
//         nu există pe orders → „Masă necunoscută · 0 produse” la ORICE comandă]
//   PU3  instantaneul `_table_name_snapshot` câștigă și nu mai cere `tables`;
//        pickup-ul → „Pickup · 1 produs” (singular); fără masă și fără pickup →
//        „Fără masă”.
//   PU4  limba fiecărui abonat: EXACT o interogare pe `profiles` cu user_id-urile
//        abonaților; prin handler, din activarea limbilor (toate patru), U1 'ro'
//        primește româna și U2 'en' engleza, pe endpoint-ul lui.
//        [PICĂ: limba ignorată în handler; limba primului abonat dată tuturor]
//   PU5  textele în celelalte 3 limbi ale personalului (pentru ziua activării):
//        aceleași chei peste tot, placeholderele păstrate, nicio rezervă
//        românească scăpată într-o altă limbă.
//   PU6  toleranță: profiles → 42703 (bază fără 323), tables / order_items →
//        eroare: notificarea pleacă oricum, în română, cu „Masă necunoscută” și
//        FĂRĂ număr (nu „0 produse”).
//   PU7  410/404 de la serviciul de push → abonamentul se șterge după id; un
//        abonament valid din același lot primește notificarea.
//   PU8  public/sw.js afișează textele PAYLOAD-ului (titlu, corp, acțiune):
//        încărcat într-un sandbox `vm`, evenimentul push cu payload-ul englez
//        produce o notificare fără niciun cuvânt românesc.
//        [PICĂ: eticheta acțiunii fixată pe „Deschide bucătăria”]
//   PU9  doar MEMBRII primesc: un abonat scos din echipă (rândul din
//        push_subscriptions rămâne după `remove_member`) nu primește nimic,
//        interogarea pe restaurant_memberships e pe restaurantul COMENZII și pe
//        user-ii abonaților; apartenență necunoscută (eroare) → nu pleacă nimic
//        (fail-closed), fără niciun apel web-push.
//        [PICĂ: filtrul scos (ospătarul scos primește masa și produsele);
//         eroarea tratată ca „toți membri”]
//   PU10 limba FIECĂRUI abonat (`enabled` injectat, ca EW7): U1 'ro' și U2 'en'
//        pe același lot → fiecare endpoint primește textul lui; un text per
//        limbă, nu per abonat; implicit (toate patru) la fel; GATE: cu
//        `['ro', 'en']`, un abonat 'fr' primește româna.
//        [PICĂ: limba fixată pe 'ro'; limba primului abonat dată tuturor;
//         gate-ul scos (cazul 'fr')]
//   PU11 cuvintele = glosarul personalului: formele `items_count` (ns/common) și
//        `tableLabel`/`noTable`/`card_srcPickup` (ns/orders), citite din
//        src/i18n, sunt EXACT cele din PUSH_STRINGS; pluralul urmează
//        `Intl.PluralRules` („20 de produse”, „101 produse”, „1000000 de
//        produits”, „3 Produkte”).
//        [PICĂ: „{n} produse” pentru orice n > 1; „Artikel”/„article”]
//   PU12 numele mesei (scris de personal) intră VERBATIM: `$$`, `$&`, `` $` ``,
//        `$'` și „{n}” nu sunt interpretate.
//        [PICĂ: String.replace cu șir de înlocuire]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { state, resetMocks, loadFunction } = require('./helpers/mocks')

const REL = 'netlify/functions/send-push.js'
const ENV = ['WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_EMAIL']
const RID = '32800000-0000-4000-8000-0000000000a1'
const OID = '32800000-0000-4000-8000-0000000000b1'
const TID = '32800000-0000-4000-8000-0000000000c1'
const U1 = '32800000-0000-4000-8000-0000000000d1'
const U2 = '32800000-0000-4000-8000-0000000000d2'

let saved
beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, {
    WEBHOOK_SECRET: 'whsec',
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
  })
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const ORDER = { id: OID, restaurant_id: RID, table_id: TID, source: 'qr', status: 'new', total: 80 }
const event = (record, { secret = 'whsec', type = 'INSERT' } = {}) => ({
  httpMethod: 'POST',
  headers: { 'x-webhook-secret': secret },
  body: JSON.stringify({ type, table: 'orders', schema: 'public', record, old_record: null }),
})

function scriptDb({
  subs = [{ id: 'p1', subscription: { endpoint: 'https://push.test/1' }, user_id: U1 }],
  tables = { [TID]: 'T5' },
  items = [{ quantity: 2 }, { quantity: 1 }],
  profiles = { [U1]: 'ro' },
  members = [U1, U2],
  tablesError = null,
  itemsError = null,
  profilesError = null,
  membersError = null,
} = {}) {
  state.fromHandlers.push_subscriptions = (ops) => {
    if (ops.some((o) => o.m === 'delete')) return { data: null, error: null }
    return { data: subs, error: null }
  }
  state.fromHandlers.tables = (ops) => {
    if (tablesError) return { data: null, error: tablesError }
    const id = (ops.find((o) => o.m === 'eq') || { args: [] }).args[1]
    return { data: id in tables ? { name: tables[id] } : null, error: null }
  }
  state.fromHandlers.order_items = () => (itemsError ? { data: null, error: itemsError } : { data: items, error: null })
  state.fromHandlers.restaurant_memberships = (ops) => {
    if (membersError) return { data: null, error: membersError }
    const rid = (ops.find((o) => o.m === 'eq' && o.args[0] === 'restaurant_id') || { args: [] }).args[1]
    const ids = (ops.find((o) => o.m === 'in') || { args: [null, []] }).args[1]
    return { data: rid === RID ? ids.filter((id) => members.includes(id)).map((id) => ({ user_id: id })) : [], error: null }
  }
  state.fromHandlers.profiles = (ops) => {
    if (profilesError) return { data: null, error: profilesError }
    const ids = (ops.find((o) => o.m === 'in') || { args: [null, []] }).args[1]
    return { data: ids.filter((id) => id in profiles).map((id) => ({ id, ui_language: profiles[id] })), error: null }
  }
}
const calls = (table) => state.fromCalls.filter((c) => c.table === table)

async function quiet(fn) {
  const w = console.warn
  const l = console.log
  const warns = []
  console.warn = (...a) => warns.push(a.join(' '))
  console.log = () => {}
  try {
    return { res: await fn(), warns }
  } finally {
    console.warn = w
    console.log = l
  }
}

describe('PU1: accesul', () => {
  it('fără WEBHOOK_SECRET → 503; secret greșit → 401; non-INSERT → skip; nicio interogare', async () => {
    const { handler } = loadFunction(REL)
    scriptDb()
    delete process.env.WEBHOOK_SECRET
    const { res: r1 } = await quiet(() => handler(event(ORDER)))
    assert.equal(r1.statusCode, 503)
    process.env.WEBHOOK_SECRET = 'whsec'
    const { res: r2 } = await quiet(() => handler(event(ORDER, { secret: 'gresit' })))
    assert.equal(r2.statusCode, 401)
    const { res: r3 } = await quiet(() => handler(event(ORDER, { type: 'UPDATE' })))
    assert.equal(r3.statusCode, 200)
    assert.equal(JSON.parse(r3.body).skipped, 'not an insert')
    assert.equal(state.fromCalls.length, 0)
    assert.equal(state.webpushCalls.length, 0)
  })
})

describe('PU2–PU3: corpul din datele reale', () => {
  it('PU2: masa din tables.name, suma cantităților din order_items', async () => {
    scriptDb()
    const { res } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(state.webpushCalls.length, 1)
    assert.deepEqual(state.webpushCalls[0].payload, {
      title: '🔔 Comandă nouă',
      body: 'Masa T5 · 3 produse',
      tag: `order-${OID}`,
      orderId: OID,
      url: '/kitchen',
      actionTitle: 'Deschide bucătăria',
    })
    const items = calls('order_items')
    assert.equal(items.length, 1)
    assert.deepEqual(items[0].ops.find((o) => o.m === 'eq').args, ['order_id', OID])
    assert.deepEqual(calls('tables')[0].ops.find((o) => o.m === 'eq').args, ['id', TID])
  })

  it('PU3: instantaneul câștigă; pickup la singular; fără masă', async () => {
    scriptDb({ items: [{ quantity: 4 }] })
    await quiet(() => loadFunction(REL).handler(event({ ...ORDER, _table_name_snapshot: 'Terasa 2' })))
    assert.equal(state.webpushCalls[0].payload.body, 'Masa Terasa 2 · 4 produse')
    assert.equal(calls('tables').length, 0, 'instantaneul există — tables nu trebuia citit')

    resetMocks()
    scriptDb({ items: [{ quantity: 1 }] })
    await quiet(() => loadFunction(REL).handler(event({ ...ORDER, table_id: null, source: 'pickup' })))
    assert.equal(state.webpushCalls[0].payload.body, 'Pickup · 1 produs')

    resetMocks()
    scriptDb({ items: [{ quantity: 2 }] })
    await quiet(() => loadFunction(REL).handler(event({ ...ORDER, table_id: null, source: 'waiter' })))
    assert.equal(state.webpushCalls[0].payload.body, 'Fără masă · 2 produse')
  })
})

describe('PU4: limba fiecărui abonat', () => {
  it('o interogare pe profiles; fiecare abonat în limba lui, prin handler', async () => {
    scriptDb({
      subs: [
        { id: 'p1', subscription: { endpoint: 'https://push.test/1' }, user_id: U1 },
        { id: 'p2', subscription: { endpoint: 'https://push.test/2' }, user_id: U2 },
        { id: 'p3', subscription: { endpoint: 'https://push.test/3' }, user_id: U1 },
      ],
      profiles: { [U1]: 'ro', [U2]: 'en' },
    })
    const { res } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(JSON.parse(res.body).sent, 3)
    const pc = calls('profiles')
    assert.equal(pc.length, 1, 'o interogare per abonat')
    assert.deepEqual([...pc[0].ops.find((o) => o.m === 'in').args[1]].sort(), [U1, U2].sort())
    const titles = Object.fromEntries(state.webpushCalls.map((c) => [c.subscription.endpoint, c.payload.title]))
    assert.deepEqual(titles, {
      'https://push.test/1': '🔔 Comandă nouă',
      'https://push.test/2': '🔔 New order',
      'https://push.test/3': '🔔 Comandă nouă',
    })
  })
})

describe('PU5: textele în limbile personalului', () => {
  it('fiecare limbă are aceleași chei și placeholdere; nicio rezervă românească', () => {
    const { PUSH_STRINGS, pushPayload } = loadFunction(REL)
    assert.deepEqual(Object.keys(PUSH_STRINGS).sort(), ['de', 'en', 'fr', 'ro'])
    const keys = Object.keys(PUSH_STRINGS.ro).sort()
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).join(',')
    for (const lang of ['ro', 'en', 'fr', 'de']) {
      assert.deepEqual(Object.keys(PUSH_STRINGS[lang]).sort(), keys, lang)
      for (const k of keys) {
        if (k === 'items') continue
        assert.equal(ph(PUSH_STRINGS[lang][k]), ph(PUSH_STRINGS.ro[k]), `${lang}.${k}`)
      }
      const forms = PUSH_STRINGS[lang].items
      assert.ok(typeof forms.other === 'string', `${lang}.items fără forma „other”`)
      for (const [cat, f] of Object.entries(forms)) assert.equal(ph(f), 'n', `${lang}.items.${cat}`)
      if (lang === 'ro') continue
      const p = pushPayload(lang, ORDER, { tableName: 'T5', itemCount: 3 })
      const all = `${p.title} ${p.body} ${p.actionTitle}`
      assert.ok(!/Masa|Comandă|produse|bucătăria/.test(all), `${lang}: ${all}`)
      assert.ok(p.body.includes('T5') && p.body.includes('3'), `${lang}: ${p.body}`)
    }
    assert.equal(pushPayload('en', ORDER, { tableName: 'T5', itemCount: 1 }).body, 'Table T5 · 1 item')
    assert.equal(pushPayload('xx', ORDER, { tableName: 'T5', itemCount: 2 }).body, 'Masa T5 · 2 produse')
  })
})

describe('PU6: toleranța', () => {
  it('profiles/tables/order_items cu erori → notificarea pleacă în română, fără „0 produse”', async () => {
    scriptDb({
      profilesError: { code: '42703', message: 'column profiles.ui_language does not exist' },
      tablesError: { code: '57014', message: 'timeout' },
      itemsError: { code: '57014', message: 'timeout' },
    })
    const { res, warns } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(state.webpushCalls.length, 1)
    assert.equal(state.webpushCalls[0].payload.body, 'Masă necunoscută')
    assert.equal(state.webpushCalls[0].payload.title, '🔔 Comandă nouă')
    assert.ok(warns.length >= 3, `erorile nu sunt logate: ${warns}`)
  })

  it('niciun rând în order_items încă → fără număr, nu „0 produse”', async () => {
    scriptDb({ items: [] })
    await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(state.webpushCalls[0].payload.body, 'Masa T5')
  })
})

describe('PU7: abonamentele expirate', () => {
  it('410 → abonamentul se șterge după id; celălalt primește notificarea', async () => {
    scriptDb({
      subs: [
        { id: 'p-gone', subscription: { endpoint: 'https://push.test/gone' }, user_id: U1 },
        { id: 'p-ok', subscription: { endpoint: 'https://push.test/ok' }, user_id: U1 },
      ],
    })
    state.webpushImpl = async (sub) => {
      if (sub.endpoint.endsWith('/gone')) {
        const e = new Error('Gone')
        e.statusCode = 410
        throw e
      }
      return { statusCode: 201 }
    }
    const { res } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(res.statusCode, 200)
    const del = calls('push_subscriptions').filter((c) => c.ops.some((o) => o.m === 'delete'))
    assert.equal(del.length, 1)
    assert.deepEqual(del[0].ops.find((o) => o.m === 'eq').args, ['id', 'p-gone'])
    assert.equal(state.webpushCalls.length, 2)
  })
})

describe('PU8: service worker-ul afișează textele payload-ului', () => {
  it('payload englez → titlu, corp și acțiune în engleză, nimic românesc', async () => {
    const listeners = {}
    const shown = []
    const sandbox = {
      self: {
        addEventListener: (type, fn) => {
          listeners[type] = fn
        },
        registration: { showNotification: async (title, options) => shown.push({ title, options }) },
        location: { origin: 'https://app.test' },
      },
      clients: {},
      caches: {},
      URL,
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8'), sandbox)
    assert.equal(typeof listeners.push, 'function', 'sw.js nu mai ascultă evenimentul push')
    const { pushPayload } = loadFunction(REL)
    const payload = pushPayload('en', ORDER, { tableName: 'T5', itemCount: 3 })
    let waited = null
    listeners.push({ data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (p) => (waited = p) })
    await waited
    assert.equal(shown.length, 1)
    const n = shown[0]
    assert.equal(n.title, '🔔 New order')
    assert.equal(n.options.body, 'Table T5 · 3 items')
    assert.equal(n.options.actions[0].title, 'Open the kitchen')
    assert.ok(!/Comandă|bucătăr|Masa/.test(JSON.stringify(n)), JSON.stringify(n))
    assert.equal(n.options.tag, `order-${OID}`)
    assert.equal(n.options.data.orderId, OID)
  })
})

describe('PU9: doar membrii echipei primesc notificarea', () => {
  it('abonatul scos din echipă nu primește nimic; interogarea e pe restaurantul comenzii', async () => {
    scriptDb({
      subs: [
        { id: 'p-member', subscription: { endpoint: 'https://push.test/member' }, user_id: U1 },
        { id: 'p-removed', subscription: { endpoint: 'https://push.test/removed' }, user_id: U2 },
      ],
      profiles: { [U1]: 'ro', [U2]: 'ro' },
      members: [U1],
    })
    const { res } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(JSON.parse(res.body), { ok: true, sent: 1, total: 1, excluded: 1 })
    assert.deepEqual(state.webpushCalls.map((c) => c.subscription.endpoint), ['https://push.test/member'])
    const mc = calls('restaurant_memberships')
    assert.equal(mc.length, 1, 'o interogare de apartenență per comandă')
    assert.deepEqual(mc[0].ops.find((o) => o.m === 'eq').args, ['restaurant_id', RID])
    assert.deepEqual([...mc[0].ops.find((o) => o.m === 'in').args[1]].sort(), [U1, U2].sort())
    // Abonamentul ospătarului scos NU se șterge de aici (nu e un 410).
    assert.equal(calls('push_subscriptions').filter((c) => c.ops.some((o) => o.m === 'delete')).length, 0)
  })

  it('nimeni membru → nu pleacă nimic', async () => {
    scriptDb({ members: [] })
    const { res } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.deepEqual(JSON.parse(res.body), { ok: true, sent: 0, total: 0, excluded: 1 })
    assert.equal(state.webpushCalls.length, 0)
  })

  it('apartenență necunoscută (eroare) → fail-closed: nicio notificare', async () => {
    scriptDb({ membersError: { code: '57014', message: 'timeout' } })
    const { res, warns } = await quiet(() => loadFunction(REL).handler(event(ORDER)))
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: true, sent: 0, skipped: 'membership_unavailable' })
    assert.equal(state.webpushCalls.length, 0)
    assert.ok(warns.some((w) => w.includes('apartenența')), `eșecul nu e logat: ${warns}`)
  })
})

describe('PU10: limba fiecărui abonat, cu a doua limbă activă', () => {
  it('U1 ro / U2 en → fiecare endpoint își primește textul; un text per limbă', async () => {
    scriptDb({
      subs: [
        { id: 'p1', subscription: { endpoint: 'https://push.test/1' }, user_id: U1 },
        { id: 'p2', subscription: { endpoint: 'https://push.test/2' }, user_id: U2 },
        { id: 'p3', subscription: { endpoint: 'https://push.test/3' }, user_id: U1 },
      ],
      profiles: { [U1]: 'ro', [U2]: 'en' },
    })
    const { resolvePushTargets } = loadFunction(REL)
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient('https://sb.example', 'service')
    const subs = state.fromHandlers.push_subscriptions([])
    const run = (enabled) => quiet(() => resolvePushTargets(supabase, ORDER, subs.data, enabled ? { enabled } : undefined))

    const { res: two } = await run(['ro', 'en'])
    const byEndpoint = Object.fromEntries(two.targets.map((x) => [x.subscription.endpoint, JSON.parse(x.payload)]))
    assert.equal(byEndpoint['https://push.test/1'].title, '🔔 Comandă nouă')
    assert.equal(byEndpoint['https://push.test/2'].title, '🔔 New order')
    assert.equal(byEndpoint['https://push.test/2'].body, 'Table T5 · 3 items')
    assert.equal(byEndpoint['https://push.test/2'].actionTitle, 'Open the kitchen')
    assert.equal(byEndpoint['https://push.test/3'].title, '🔔 Comandă nouă')
    assert.deepEqual(two.targets.map((x) => x.lang), ['ro', 'en', 'ro'])
    assert.equal(new Set(two.targets.map((x) => x.payload)).size, 2, 'un text per limbă')

    // Producția (implicit ENABLED_STAFF_LANGS, toate patru din activare): același rezultat.
    const { res: prod } = await run(null)
    assert.deepEqual(prod.targets.map((x) => x.lang), ['ro', 'en', 'ro'])
  })

  it('gate: o limbă care nu e activă pentru personal cade pe română', async () => {
    scriptDb({
      subs: [{ id: 'p1', subscription: { endpoint: 'https://push.test/1' }, user_id: U1 }],
      profiles: { [U1]: 'fr' },
    })
    const { resolvePushTargets } = loadFunction(REL)
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient('https://sb.example', 'service')
    const subs = state.fromHandlers.push_subscriptions([])
    const { res: gated } = await quiet(() => resolvePushTargets(supabase, ORDER, subs.data, { enabled: ['ro', 'en'] }))
    assert.deepEqual(gated.targets.map((x) => x.lang), ['ro'])
    // Control: implicit (franceza activă) aceeași persoană primește franceza.
    const { res: open } = await quiet(() => resolvePushTargets(supabase, ORDER, subs.data))
    assert.deepEqual(open.targets.map((x) => x.lang), ['fr'])
  })
})

describe('PU11: cuvintele notificării = glosarul personalului', () => {
  const root = path.join(__dirname, '..', '..')
  const read = (ns, lang) => fs.readFileSync(path.join(root, 'src', 'i18n', 'ns', ns, `${lang}.ts`), 'utf8')
  const str = (src, key) => {
    const m = new RegExp(`\\n\\s*${key}:\\s*'([^']*)'`).exec(src)
    assert.ok(m, `cheia ${key} nu e găsită`)
    return m[1]
  }
  it('items_count, tableLabel, noTable, card_srcPickup coincid în toate cele 4 limbi', () => {
    const { PUSH_STRINGS } = loadFunction(REL)
    for (const lang of Object.keys(PUSH_STRINGS)) {
      const common = read('common', lang)
      const m = /\n\s*items_count:\s*\{((?:[^{}]|\{\w+\})*)\}/.exec(common)
      assert.ok(m, `${lang}: items_count nu e găsit`)
      const forms = Object.fromEntries([...m[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((x) => [x[1], x[2]]))
      assert.deepEqual({ ...PUSH_STRINGS[lang].items }, forms, `${lang}: formele de plural diferă de common.items_count`)
      const orders = read('orders', lang)
      assert.equal(PUSH_STRINGS[lang].table, str(orders, 'tableLabel'), `${lang}.table`)
      assert.equal(PUSH_STRINGS[lang].no_table, str(orders, 'noTable'), `${lang}.no_table`)
      assert.equal(PUSH_STRINGS[lang].pickup, str(orders, 'card_srcPickup'), `${lang}.pickup`)
    }
  })

  it('pluralul urmează Intl.PluralRules', () => {
    const { pushPayload } = loadFunction(REL)
    const body = (lang, n) => pushPayload(lang, ORDER, { tableName: '5', itemCount: n }).body
    assert.equal(body('ro', 1), 'Masa 5 · 1 produs')
    assert.equal(body('ro', 2), 'Masa 5 · 2 produse')
    assert.equal(body('ro', 19), 'Masa 5 · 19 produse')
    assert.equal(body('ro', 20), 'Masa 5 · 20 de produse')
    assert.equal(body('ro', 24), 'Masa 5 · 24 de produse')
    assert.equal(body('ro', 101), 'Masa 5 · 101 produse')
    assert.equal(body('de', 1), 'Tisch 5 · 1 Produkt')
    assert.equal(body('de', 3), 'Tisch 5 · 3 Produkte')
    assert.equal(body('fr', 1), 'Table 5 · 1 produit')
    assert.equal(body('fr', 3), 'Table 5 · 3 produits')
    assert.equal(body('fr', 1000000), 'Table 5 · 1000000 de produits')
    assert.equal(body('en', 20), 'Table 5 · 20 items')
  })
})

describe('PU12: numele mesei intră verbatim', () => {
  it('$$, $&, $`, $\' și {n} nu sunt interpretate', () => {
    const { pushPayload } = loadFunction(REL)
    for (const name of ['Bar $$ VIP', 'T$&', 'A$`B', "C$'D", 'Masa {n}', '$1 terasa']) {
      assert.equal(pushPayload('ro', ORDER, { tableName: name, itemCount: 2 }).body, `Masa ${name} · 2 produse`, name)
    }
  })
})
