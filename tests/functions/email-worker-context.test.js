// tests/functions/email-worker-context.test.js
// Cablajul worker-ului de email (lotul L8a): limba și fusul se rezolvă pe LOT,
// cu interogări tolerante, iar handler-ul le folosește la randare.
//
//   EW1  un lot amestecat: personal (`payment_failed`, `reservation_created`),
//        oaspete (`reservation_reminder`) și fondator (`founder_alert`) →
//        contextul corect pentru fiecare rând; EXACT o interogare pe profiles
//        (doar user_id-urile personalului) și una pe restaurants (doar
//        restaurant_id-urile cu fus operațional), deduplicate.
//        [PICĂ: o interogare per rând; gate-ul de limbă scos (u1 → 'en' implicit)]
//   EW2  profiles → 42703 (bază fără mig 323): personalul pe 'ro', fusul
//        restaurantelor se aplică în continuare, fără throw.
//   EW3  restaurants cu `country` → 42703 (bază fără mig 296): a doua încercare
//        fără coloană, fusul se aplică; control: două interogări, a doua fără
//        `country`.
//   EW4  `restaurant_id` care nu e uuid nu intră în `.in()` și rândul rămâne
//        pe București.
//   EW5  cap-coadă prin handler: un reminder revendicat pleacă la Resend cu
//        subiectul german și ora pe Berlin; Idempotency-Key și marcarea `sent`
//        neschimbate.
//   EW6  în producție (ENABLED = ['ro']) un patron cu `ui_language = 'en'`
//        primește BYTE-ul de dinainte (oracolul vechi, ceas oprit).
//        [PICĂ: gate-ul scos]
//   EW7  reminderul oaspetelui (lotul L8b): limba STOCATĂ pe rezervare
//        (`template_data.guest_language`, mig 328) bate limba de bază a
//        localului, fusul rămâne al localului; o limbă stocată necunoscută cade
//        pe limba localului; fără restaurant, limba stocată rămâne (pe
//        București); un kind de PERSONAL ignoră cheia. EW7b: cap-coadă prin
//        handler — subiectul și eticheta în italiană, ora pe Berlin.
//        [PICĂ: cheia ignorată (limba localului peste tot); limba stocată
//         aplicată și personalului]
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { state, resetMocks, loadFunction } = require('./helpers/mocks')
const F = require('./fixtures/email-fixtures')

const REL = 'netlify/functions/process-email-queue.js'
const U1 = '32700000-0000-4000-8000-0000000000c1'
const U2 = '32700000-0000-4000-8000-0000000000c2'
const R1 = '32700000-0000-4000-8000-0000000000d1'
const R2 = '32700000-0000-4000-8000-0000000000d2'
const NOW = Date.parse(F.NOW)

const selectOf = (ops) => String((ops.find((o) => o.m === 'select') || { args: [''] }).args[0])
const inOf = (ops) => (ops.find((o) => o.m === 'in') || { args: [null, []] }).args[1]

function scriptDb({ profiles = {}, restaurants = {}, profilesError = null, countryError = null } = {}) {
  state.fromHandlers.profiles = (ops) => {
    if (profilesError) return { data: null, error: profilesError }
    const ids = inOf(ops)
    return { data: ids.filter((id) => id in profiles).map((id) => ({ id, ui_language: profiles[id] })), error: null }
  }
  state.fromHandlers.restaurants = (ops) => {
    if (countryError && selectOf(ops).includes('country')) return { data: null, error: countryError }
    const ids = inOf(ops)
    return {
      data: ids.filter((id) => id in restaurants).map((id) => ({ id, ...restaurants[id] })),
      error: null,
    }
  }
}

const calls = (table) => state.fromCalls.filter((c) => c.table === table)

const ROWS = [
  { id: 'e1', template_kind: 'payment_failed', user_id: U1, template_data: { owner_name: 'Ana' } },
  { id: 'e2', template_kind: 'reservation_reminder', user_id: null, template_data: { restaurant_id: R1 } },
  { id: 'e3', template_kind: 'reservation_created', user_id: U1, template_data: { restaurant_id: R2 } },
  { id: 'e4', template_kind: 'founder_alert', user_id: U2, template_data: { restaurant_id: R1 } },
  { id: 'e5', template_kind: 'reservation_cancelled', user_id: U1, template_data: { restaurant_id: R2 } },
]
const DB = {
  profiles: { [U1]: 'en', [U2]: 'de' },
  restaurants: {
    [R1]: { timezone: 'Europe/Berlin', language: 'de', country: 'DE' },
    [R2]: { timezone: 'America/New_York', language: 'en', country: 'US' },
  },
}

let Q
beforeEach(() => {
  resetMocks()
  Q = loadFunction(REL)
})

describe('EW1: contextul pe lot', () => {
  it('ENABLED implicit (doar ro): personalul rămâne pe română, oaspetele și fusul se aplică', async () => {
    scriptDb(DB)
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), ROWS, { now: NOW })
    assert.equal(ctxs.get('e1').lang, 'ro')
    assert.equal(ctxs.get('e1').timeZone, 'Europe/Bucharest')
    assert.deepEqual(
      { lang: ctxs.get('e2').lang, tz: ctxs.get('e2').timeZone, locale: ctxs.get('e2').locale },
      { lang: 'de', tz: 'Europe/Berlin', locale: 'de-DE' },
    )
    assert.deepEqual([ctxs.get('e3').lang, ctxs.get('e3').timeZone, ctxs.get('e3').locale], ['ro', 'America/New_York', 'ro-RO'])
    assert.deepEqual([ctxs.get('e4').lang, ctxs.get('e4').timeZone], ['ro', 'Europe/Bucharest'], 'fondatorul: română + București')
    assert.equal(ctxs.get('e2').now, NOW)
  })

  it('cu engleza activă: patronul în engleză, cu locale pe țara localului', async () => {
    scriptDb(DB)
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), ROWS, {
      now: NOW,
      enabled: ['ro', 'en'],
    })
    assert.equal(ctxs.get('e1').lang, 'en')
    assert.deepEqual([ctxs.get('e3').lang, ctxs.get('e3').locale, ctxs.get('e3').timeZone], ['en', 'en-US', 'America/New_York'])
    assert.equal(ctxs.get('e4').lang, 'ro', 'germana nu e activă, iar founder_alert rămâne oricum în română')
  })

  it('exact O interogare pe tabelă, cu id-urile deduplicate și doar ale kind-urilor care le cer', async () => {
    scriptDb(DB)
    await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), ROWS, { now: NOW })
    assert.equal(calls('profiles').length, 1)
    assert.deepEqual(inOf(calls('profiles')[0].ops), [U1], 'U2 (founder_alert) nu e personal')
    assert.equal(selectOf(calls('profiles')[0].ops), 'id, ui_language')
    assert.equal(calls('restaurants').length, 1)
    assert.deepEqual([...inOf(calls('restaurants')[0].ops)].sort(), [R1, R2].sort())
  })

  it('lot fără kind-uri care cer date → nicio interogare', async () => {
    scriptDb(DB)
    const rows = [{ id: 'x', template_kind: 'welcome', user_id: U1, template_data: { restaurant_id: R1 } }]
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), rows, { now: NOW })
    assert.equal(state.fromCalls.length, 0)
    assert.equal(ctxs.get('x').lang, 'ro')
  })
})

describe('EW2–EW4: toleranța', () => {
  it('EW2: profiles → 42703: personalul pe română, fusul se aplică, fără throw', async () => {
    scriptDb({ ...DB, profilesError: { code: '42703', message: 'column profiles.ui_language does not exist' } })
    const warn = console.warn
    const warnings = []
    console.warn = (...a) => warnings.push(a.join(' '))
    let ctxs
    try {
      ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), ROWS, { now: NOW, enabled: ['ro', 'en'] })
    } finally {
      console.warn = warn
    }
    assert.equal(ctxs.get('e1').lang, 'ro')
    assert.equal(ctxs.get('e3').timeZone, 'America/New_York')
    assert.ok(warnings.some((w) => w.includes('42703')), 'avertismentul cu codul lipsește')
  })

  it('EW3: restaurants fără `country` (bază fără 296) → a doua încercare, fusul se aplică', async () => {
    scriptDb({ ...DB, countryError: { code: '42703', message: 'column restaurants.country does not exist' } })
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), ROWS, { now: NOW })
    const rc = calls('restaurants')
    assert.equal(rc.length, 2)
    assert.ok(selectOf(rc[0].ops).includes('country'))
    assert.ok(!selectOf(rc[1].ops).includes('country'))
    assert.equal(ctxs.get('e2').timeZone, 'Europe/Berlin')
    assert.equal(ctxs.get('e2').locale, 'de-DE')
  })

  it('EW3b: ambele încercări eșuează → București + română, fără throw', async () => {
    state.fromHandlers.restaurants = () => ({ data: null, error: { code: '57014', message: 'timeout' } })
    state.fromHandlers.profiles = () => {
      throw new Error('rețea')
    }
    const warn = console.warn
    console.warn = () => {}
    let ctxs
    try {
      ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), ROWS, { now: NOW })
    } finally {
      console.warn = warn
    }
    for (const id of ['e1', 'e2', 'e3']) {
      assert.deepEqual([ctxs.get(id).lang, ctxs.get(id).timeZone], ['ro', 'Europe/Bucharest'], id)
    }
  })

  it('EW4: un restaurant_id care nu e uuid nu intră în `.in()`; rândul rămâne pe București', async () => {
    scriptDb(DB)
    const rows = [
      { id: 'a', template_kind: 'reservation_reminder', template_data: { restaurant_id: "x' or 1=1" } },
      { id: 'b', template_kind: 'reservation_created', user_id: 'nu-e-uuid', template_data: {} },
    ]
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), rows, { now: NOW })
    assert.equal(state.fromCalls.length, 0, 'nicio interogare cu id-uri invalide')
    assert.deepEqual([ctxs.get('a').lang, ctxs.get('a').timeZone], ['ro', 'Europe/Bucharest'])
    assert.equal(ctxs.get('b').timeZone, 'Europe/Bucharest')
  })

  it('fus invalid stocat → București', async () => {
    scriptDb({ restaurants: { [R1]: { timezone: 'Mars/Olympus', language: 'it', country: null } } })
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), [ROWS[1]], { now: NOW })
    assert.deepEqual([ctxs.get('e2').lang, ctxs.get('e2').timeZone], ['it', 'Europe/Bucharest'])
  })
})

describe('EW5/EW6: prin handler', () => {
  const saved = {}
  let savedFetch
  let resend
  beforeEach(() => {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'APP_URL']) saved[k] = process.env[k]
    Object.assign(process.env, { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', RESEND_API_KEY: 're_test' })
    savedFetch = global.fetch
    resend = []
    global.fetch = async (url, init) => {
      resend.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'em' }), text: async () => '' }
    }
  })
  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    global.fetch = savedFetch
  })

  function claim(rows) {
    state.rpcHandlers.claim_email_batch = () => ({
      data: rows.map((r) => ({ recipient_email: 'x@x.test', failed_attempts: 0, created_at: new Date().toISOString(), ...r })),
      error: null,
    })
    const updates = []
    state.fromHandlers.email_queue = (ops) => {
      const u = ops.find((o) => o.m === 'update')
      if (u) updates.push(u.args[0])
      return { data: null, error: null }
    }
    return updates
  }

  it('EW5: reminderul pleacă în germană, cu ora pe Berlin; cheia de idempotență neschimbată', async () => {
    const updates = claim([
      {
        id: 'rem-1',
        template_kind: 'reservation_reminder',
        template_data: { ...F.ASCII_CASES.reservation_reminder, restaurant_id: R1 },
      },
    ])
    scriptDb({ restaurants: { [R1]: { timezone: 'Europe/Berlin', language: 'de', country: 'DE' } } })
    const res = await Q.handler({})
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(resend.length, 1)
    assert.match(resend[0].body.subject, /^Erinnerung: deine Reservierung bei Zorba Grill /)
    assert.ok(resend[0].body.html.includes('Datum und Uhrzeit'))
    assert.ok(resend[0].body.html.includes('· 23:30'), 'ora pe Berlin (22:30Z)')
    assert.equal(resend[0].headers['Idempotency-Key'], 'idempotency-email-rem-1')
    assert.ok(updates.some((u) => u.status === 'sent'))
  })

  it('EW7b: reminderul cu guest_language=it la un local german pleacă în italiană, cu ora Berlinului', async () => {
    claim([
      {
        id: 'rem-it',
        template_kind: 'reservation_reminder',
        template_data: { ...F.ASCII_CASES.reservation_reminder, restaurant_id: R1, guest_language: 'it' },
      },
    ])
    scriptDb({ restaurants: { [R1]: { timezone: 'Europe/Berlin', language: 'de', country: 'DE' } } })
    const res = await Q.handler({})
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(resend.length, 1)
    assert.match(resend[0].body.subject, /^Promemoria: la tua prenotazione da Zorba Grill /)
    assert.ok(resend[0].body.html.includes('Data e ora'))
    assert.ok(resend[0].body.html.includes('23:30'), 'ora pe Berlin (22:30Z)')
    assert.equal(resend[0].headers['Idempotency-Key'], 'idempotency-email-rem-it')
  })

  it('EW6: în producție (doar româna activă) patronul cu ui_language=en primește byte-ul de dinainte', async () => {
    const data = F.CASES.reservation_created[0].data
    claim([{ id: 'rc-1', template_kind: 'reservation_created', user_id: U1, template_data: data }])
    scriptDb({ profiles: { [U1]: 'en' }, restaurants: { [F.RID]: { timezone: 'Europe/Bucharest', language: 'ro', country: 'RO' } } })
    process.env.APP_URL = F.APP
    delete require.cache[require.resolve(path.join(__dirname, '..', '..', REL))]
    const fresh = loadFunction(REL)
    const res = await fresh.handler({})
    assert.equal(res.statusCode, 200, res.body)
    // Oracolul: worker-ul vechi, în procesul copil, pe București.
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, 'helpers', 'render-emails.js'), JSON.stringify({ mode: 'old', now: F.NOW, appUrl: F.APP, cases: [{ kind: 'reservation_created', data }] })],
      { env: { ...process.env, TZ: 'Europe/Bucharest' }, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
    const [old] = JSON.parse(r.stdout)
    assert.equal(resend[0].body.subject, old.subject)
    assert.equal(resend[0].body.html, old.html)
    // Control: s-a cerut limba (gate-ul a decis, nu lipsa interogării).
    assert.equal(calls('profiles').length, 1)
  })
})

describe('EW7: limba oaspetelui stocată pe rezervare (L8b)', () => {
  it('stocată → a localului → română; fusul rămâne al localului; personalul o ignoră', async () => {
    scriptDb(DB)
    const rows = [
      { id: 'g1', template_kind: 'reservation_reminder', template_data: { restaurant_id: R1, guest_language: 'it' } },
      { id: 'g2', template_kind: 'reservation_reminder', template_data: { restaurant_id: R1, guest_language: 'pt' } },
      { id: 'g3', template_kind: 'reservation_reminder', template_data: { guest_language: 'es' } },
      { id: 'g4', template_kind: 'reservation_reminder', template_data: { restaurant_id: R2, guest_language: null } },
      { id: 'g5', template_kind: 'reservation_created', user_id: U1, template_data: { restaurant_id: R2, guest_language: 'de' } },
    ]
    // Germana și engleza ACTIVE pentru personal: altfel g5 ar ieși 'ro' oricum și
    // n-ar arăta că personalul ignoră cheia oaspetelui.
    const ctxs = await Q.resolveEmailContexts(require('@supabase/supabase-js').createClient(), rows, {
      now: NOW,
      enabled: ['ro', 'en', 'de'],
    })
    assert.equal(ctxs.get('g1').lang, 'it', 'limba stocată n-a bătut limba localului')
    assert.equal(ctxs.get('g1').timeZone, 'Europe/Berlin')
    assert.equal(ctxs.get('g2').lang, 'de', 'o limbă stocată necunoscută trebuie să cadă pe limba localului')
    assert.deepEqual([ctxs.get('g3').lang, ctxs.get('g3').timeZone], ['es', 'Europe/Bucharest'])
    assert.equal(ctxs.get('g4').lang, 'en')
    assert.equal(ctxs.get('g5').lang, 'en', 'personalul primește limba LUI (ui_language), nu pe a oaspetelui')
  })
})
