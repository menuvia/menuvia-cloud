// tests/functions/process-sms-queue.test.js
// Worker-ul de SMS (mig 228): o cheie SMSO greșită NU mai aruncă coada.
//
// De ce există: ramura de eroare trata ORICE 4xx (în afară de 429) drept
// „permanent", deci un 401/403 — cheie invalidă/rotită, cont fără credit,
// sender neaprobat — marca rândul 'failed' din PRIMA încercare. O cheie
// greșită ștergea tăcut toată coada (confirmări de rezervare, „comanda e
// gata"); după repararea cheii nu mai pleca nimic, iar sonda de coadă din
// /health (care numără doar 'queued'/'sending') rămânea verde. Worker-ul de
// email avea deja paritatea corectă (EK7); cel de SMS, „clona" lui, nu.
//
//   SQW1  SMSO 401/403 → rândul revine 'queued' NEATINS (fără failed_attempts,
//         fără scheduled_for mutat), restul lotului nu mai cheamă SMSO și e
//         eliberat la fel. Mutația care pică: ramura veche `permanent` pe
//         401/403 (rândul ajunge 'failed', SMSO e chemat pentru fiecare rând).
//   SQW2  control: 400/422 (număr/conținut respins) rămâne 'failed' cu
//         încercare consumată și NU oprește lotul.
//   SQW3  control: 5xx → backoff cu încercare consumată (neschimbat).
//   SQW4  „comanda e gata" mai veche de 2 ore și rezervarea cu ora trecută se
//         ANULEAZĂ fără apel SMSO (ținute în coadă pe durata unei pene, ar
//         pleca dezinformând). Mutația care pică: fără expiryReason → SMSO e
//         chemat și rândul ajunge 'sent'.
//   SQW5  control: SMS-urile proaspete / cu `starts_at` ne-parsabil pleacă.
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).

'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction } = require('./helpers/mocks')

const REL = 'netlify/functions/process-sms-queue.js'
const ENV = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SMSO_API_KEY', 'SMSO_SENDER', 'SLACK_WEBHOOK_URL']

let saved
let savedFetch
let smso
let smsoStatus

beforeEach(() => {
  resetMocks()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SMSO_API_KEY: 'smso-key',
  })
  savedFetch = global.fetch
  smso = []
  smsoStatus = 200
  global.fetch = async (url, init) => {
    smso.push({ url: String(url), body: JSON.parse(init.body) })
    const st = typeof smsoStatus === 'function' ? smsoStatus(smso.length) : smsoStatus
    return {
      ok: st >= 200 && st < 300,
      status: st,
      json: async () => ({ id: `msg_${smso.length}` }),
      text: async () => (st === 200 ? '' : `{"status":${st},"message":"x"}`),
    }
  }
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = savedFetch
})

const HOUR = 60 * 60_000
const iso = (deltaMs) => new Date(Date.now() + deltaMs).toISOString()

function row(i, over) {
  return {
    id: `s${i}`,
    template_kind: 'reservation_confirmed',
    template_data: {
      restaurant_name: 'Bistro',
      starts_at: iso(24 * HOUR),
      party_size: 2,
      confirmation_code: 'ABC',
    },
    recipient_phone: `+4072200000${i}`,
    failed_attempts: 1,
    scheduled_for: iso(-5 * 60_000),
    created_at: iso(-5 * 60_000),
    ...over,
  }
}

// Claim-ul întoarce rândurile date; fiecare UPDATE pe sms_queue e înregistrat
// cu id-ul lui (din `.eq('id', …)`).
function claim(rows) {
  state.rpcHandlers['claim_sms_batch'] = () => ({ data: rows, error: null })
  const updates = []
  state.fromHandlers['sms_queue'] = (ops) => {
    const u = ops.find((o) => o.m === 'update')
    const id = ops.find((o) => o.m === 'eq')
    if (u) updates.push({ id: id && id.args[1], ...u.args[0] })
    return { data: null, error: null }
  }
  return updates
}

async function runQuiet(handler) {
  const errs = []
  const savedErr = console.error
  console.error = (...a) => errs.push(a.join(' '))
  try {
    return { res: await handler({}), errs }
  } finally {
    console.error = savedErr
  }
}

describe('process-sms-queue: cheia SMSO respinsă nu mai aruncă coada', () => {
  for (const st of [401, 403]) {
    it(`SQW1: SMSO ${st} → rândul revine 'queued' NEATINS, restul lotului nu se trimite`, async () => {
      const { handler } = loadFunction(REL)
      const updates = claim([row(1), row(2), row(3)])
      smsoStatus = st
      const { res, errs } = await runQuiet(handler)
      assert.equal(res.statusCode, 200, res.body)
      assert.deepEqual(JSON.parse(res.body), {
        processed: 3, sent: 0, failed: 0, authFailures: 1, released: 3, expired: 0,
      })
      assert.equal(smso.length, 1, 'după primul 401/403 nu se mai cheamă SMSO pentru restul lotului')
      assert.deepEqual(updates.map((u) => u.id).sort(), ['s1', 's2', 's3'])
      for (const u of updates) {
        assert.equal(u.status, 'queued', `${u.id}: ${u.status} — o cheie greșită a aruncat SMS-ul`)
        assert.equal(u.claimed_at, null)
        assert.ok(!('failed_attempts' in u), `${u.id}: încercare consumată pe o eroare de configurare`)
        assert.ok(!('scheduled_for' in u), `${u.id}: scheduled_for mutat — sonda de coadă n-ar mai vedea vechimea`)
        assert.match(u.last_error, /^CONFIG SMSO/)
      }
      assert.ok(errs.some((e) => e.includes('EROARE DE CONFIGURARE')), 'lipsește logul clar de configurare')
    })
  }

  for (const st of [400, 422]) {
    it(`SQW2 control: SMSO ${st} (număr/conținut respins) → 'failed' și lotul continuă`, async () => {
      const { handler } = loadFunction(REL)
      const updates = claim([row(1), row(2)])
      smsoStatus = st
      const { res } = await runQuiet(handler)
      assert.deepEqual(JSON.parse(res.body), {
        processed: 2, sent: 0, failed: 2, authFailures: 0, released: 0, expired: 0,
      })
      assert.equal(smso.length, 2, 'o eroare de destinatar NU oprește lotul')
      for (const u of updates) {
        assert.equal(u.status, 'failed')
        assert.equal(u.failed_attempts, 2)
      }
    })
  }

  it('SQW3 control: 5xx → backoff cu încercare consumată (neschimbat)', async () => {
    const { handler } = loadFunction(REL)
    const updates = claim([row(1, { failed_attempts: 0 })])
    smsoStatus = 503
    const { res } = await runQuiet(handler)
    assert.deepEqual(JSON.parse(res.body), {
      processed: 1, sent: 0, failed: 1, authFailures: 0, released: 0, expired: 0,
    })
    assert.equal(updates.length, 1)
    assert.equal(updates[0].status, 'queued')
    assert.equal(updates[0].failed_attempts, 1)
    assert.ok(Date.parse(updates[0].scheduled_for) > Date.now(), 'backoff-ul mută scheduled_for în viitor')
  })

  it('SQW4: SMS-urile care nu mai au sens se anulează, fără apel SMSO', async () => {
    const { handler } = loadFunction(REL)
    const updates = claim([
      // „Comanda e gata" ținut 3 ore (pană de cheie) — clientul a plecat de mult.
      row(1, { template_kind: 'pickup_ready', template_data: { restaurant_name: 'B', short_id: '12' }, created_at: iso(-3 * HOUR) }),
      // Confirmare pentru o rezervare care a început deja.
      row(2, { template_data: { restaurant_name: 'B', starts_at: iso(-HOUR), party_size: 2 } }),
      // Reminder pentru o rezervare trecută.
      row(3, { template_kind: 'reservation_reminder', template_data: { restaurant_name: 'B', starts_at: iso(-10 * 60_000) } }),
    ])
    const { res } = await runQuiet(handler)
    assert.deepEqual(JSON.parse(res.body), {
      processed: 3, sent: 0, failed: 0, authFailures: 0, released: 0, expired: 3,
    })
    assert.equal(smso.length, 0, 'un SMS expirat a plecat spre client')
    assert.deepEqual(updates.map((u) => u.id).sort(), ['s1', 's2', 's3'])
    for (const u of updates) {
      // 'cancelled', nu 'failed': n-a plecat nimic, deci nu consumă plafonul lunar.
      assert.equal(u.status, 'cancelled', `${u.id}: ${u.status}`)
      assert.match(u.last_error, /^Expirat înainte de trimitere/)
      assert.ok(!('failed_attempts' in u))
    }
  })

  it('SQW5 control: SMS-urile proaspete pleacă (inclusiv cu starts_at ne-parsabil)', async () => {
    const { handler } = loadFunction(REL)
    const updates = claim([
      row(1, { template_kind: 'pickup_ready', template_data: { restaurant_name: 'B', short_id: '12' }, created_at: iso(-30 * 60_000) }),
      row(2),
      row(3, { template_data: { restaurant_name: 'B', starts_at: 'nu-e-o-data' } }),
    ])
    const { res } = await runQuiet(handler)
    assert.deepEqual(JSON.parse(res.body), {
      processed: 3, sent: 3, failed: 0, authFailures: 0, released: 0, expired: 0,
    })
    assert.equal(smso.length, 3)
    assert.match(smso[0].body.body, /este gata de ridicare/)
    assert.equal(updates.filter((u) => u.status === 'sent').length, 3)
  })

  it('SQW1b: 401 la mijlocul lotului → cele deja trimise rămân sent, restul se eliberează', async () => {
    const { handler } = loadFunction(REL)
    const updates = claim([row(1), row(2), row(3)])
    smsoStatus = (n) => (n === 1 ? 200 : 401)
    const { res } = await runQuiet(handler)
    assert.deepEqual(JSON.parse(res.body), {
      processed: 3, sent: 1, failed: 0, authFailures: 1, released: 2, expired: 0,
    })
    assert.equal(smso.length, 2)
    const byId = Object.fromEntries(updates.map((u) => [u.id, u]))
    assert.equal(byId.s1.status, 'sent')
    assert.equal(byId.s2.status, 'queued')
    assert.equal(byId.s3.status, 'queued')
  })
})
