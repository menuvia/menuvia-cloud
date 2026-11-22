// tests/functions/mocks-install-table.test.js
// Harness-ul `installTable` (helpers/mocks.js) e temelia testelor pe UPDATE-urile
// condiționate din stripe-webhook (abonament unic la finalizare, lotul #61): un
// UPDATE ratat se recunoaște după „0 rânduri”. Dacă un filtru greșit ar întoarce
// tot „0 rânduri”, o gardă scrisă greșit ar arăta exact ca una corectă. De aceea
// lanțul de operații se validează ÎNAINTEA scanării (recenzie pe #386, K4):
//   IT1  expresie or() stricată → eroare și pe tabelă GOALĂ, și după un `eq`
//        care exclude tot, pe SELECT și pe UPDATE (nimic scris, cârligul neatins)
//        [PICĂ: validarea pe rând (doar când se scanează un rând)]
//   IT2  operație nemodelată / is() pe ne-null / coloană lipsă → eroare pe
//        tabelă goală  [PICĂ: idem]
//   IT3  control POZITIV: o interogare VALIDĂ fără potriviri întoarce 0 rânduri
//        (nu eroare), iar una cu potriviri le întoarce
//   IT4  `failNextRead` / `failNextUpdate` (recenzie pe #386, R4/R8): exact O
//        operație întoarce `{error}`, rândurile și cârligele neatinse, iar
//        operația următoare merge; un filtru stricat aruncă tot ÎNAINTE și lasă
//        eroarea armată  [PICĂ: eroarea consumată de o citire non-single / de
//        mai multe operații; UPDATE-ul eșuat scrie totuși]

'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { resetMocks, installModuleMocks, installTable } = require('./helpers/mocks')

installModuleMocks()
const { createClient } = require('@supabase/supabase-js')

describe('installTable: validarea filtrelor înaintea scanării (K4)', () => {
  let db
  beforeEach(() => {
    resetMocks()
    db = createClient('https://x.supabase.co', 'srk')
  })

  const BAD_OR = ['stripe_subscription_id.isnull', 'a.eq.x,(b.eq.y)', 'a.is.true', '']

  it('IT1: or() stricat → eroare pe tabelă goală și după un eq care exclude tot, pe SELECT și UPDATE', async () => {
    for (const expr of BAD_OR) {
      for (const rows of [[], [{ id: 'u1', stripe_subscription_id: null }]]) {
        const label = `${JSON.stringify(expr)} / ${rows.length} rânduri`
        const t = installTable('profiles', rows)
        let hookRan = false
        t.hooks.beforeUpdate = () => { hookRan = true }
        await assert.rejects(
          Promise.resolve(db.from('profiles').select('id').eq('id', 'altcineva').or(expr)),
          /installTable/, `SELECT ${label}`,
        )
        await assert.rejects(
          Promise.resolve(db.from('profiles').update({ plan: 'pro' }).eq('id', 'altcineva').or(expr).select('id')),
          /installTable/, `UPDATE ${label}`,
        )
        assert.deepEqual(t.writes, [], label)
        assert.equal(hookRan, false, `${label}: validarea vine înaintea oricărui efect`)
      }
    }
  })

  it('IT2: operație nemodelată / is() pe ne-null / coloană lipsă → eroare și pe tabelă goală', async () => {
    installTable('profiles', [])
    for (const [label, q] of [
      ['neq', () => db.from('profiles').select('id').neq('id', 'u1')],
      ['is(col, true)', () => db.from('profiles').select('id').is('stripe_subscription_id', true)],
      ['eq fără coloană', () => db.from('profiles').select('id').eq(undefined, 'u1')],
      ['or ne-text', () => db.from('profiles').select('id').or(null)],
    ]) {
      await assert.rejects(Promise.resolve(q()), /installTable/, label)
    }
  })

  it('IT3: control POZITIV — interogare validă fără potriviri → 0 rânduri (nu eroare); cu potriviri → rândurile', async () => {
    const t = installTable('profiles', [{ id: 'u1', stripe_subscription_id: 'sub_A' }])
    const or = 'stripe_subscription_id.is.null,stripe_subscription_id.eq.sub_B'
    let r = await db.from('profiles').update({ stripe_subscription_id: 'sub_B' }).eq('id', 'u1').or(or).select('id')
    assert.deepEqual(r, { data: [], error: null })
    assert.deepEqual(t.writes, [])
    r = await db.from('profiles').select('id').eq('id', 'nimeni').or(or)
    assert.deepEqual(r, { data: [], error: null })
    r = await db.from('profiles').select('id').eq('id', 'u1').or('stripe_subscription_id.eq.sub_A')
    assert.deepEqual(r.data, [{ id: 'u1', stripe_subscription_id: 'sub_A' }])
    installTable('profiles', [])
    r = await db.from('profiles').select('id').eq('id', 'u1').or(or)
    assert.deepEqual(r, { data: [], error: null })
  })

  it('IT4: failNextRead / failNextUpdate — o SINGURĂ operație întoarce {error}, fără efect; următoarea merge', async () => {
    const blip = { code: 'XX000', message: 'blip' }
    const t = installTable('profiles', [{ id: 'u1', plan: 'free', stripe_subscription_id: null }])
    let hookRan = false
    t.hooks.beforeUpdate = () => { hookRan = true }

    // Un filtru stricat aruncă ÎNAINTEA erorii armate și n-o consumă.
    t.failNextUpdate = blip
    await assert.rejects(
      Promise.resolve(db.from('profiles').update({ plan: 'pro' }).eq('id', 'u1').or('x.isnull').select('id')),
      /installTable/,
    )
    assert.equal(t.failNextUpdate, blip, 'validarea vine înaintea erorii armate')

    let r = await db.from('profiles').update({ plan: 'pro' }).eq('id', 'u1').select('id')
    assert.deepEqual(r, { data: null, error: blip })
    assert.deepEqual(t.writes, [], 'UPDATE-ul eșuat nu scrie')
    assert.equal(t.rows[0].plan, 'free')
    assert.equal(hookRan, false, 'instrucțiunea n-a rulat: cârligul rămâne pentru următorul UPDATE')
    assert.equal(t.failNextUpdate, null)
    r = await db.from('profiles').update({ plan: 'pro' }).eq('id', 'u1').select('id')
    assert.deepEqual(r.data, [{ id: 'u1', plan: 'pro', stripe_subscription_id: null }], 'control POZITIV: următorul merge')
    assert.equal(hookRan, true)

    // Citirea: doar `.single()`/`.maybeSingle()` o consumă, o singură dată.
    t.failNextRead = blip
    r = await db.from('profiles').select('id').eq('id', 'u1')
    assert.equal(r.error, null, 'o citire de listă nu consumă eroarea armată')
    r = await db.from('profiles').select('id').eq('id', 'u1').single()
    assert.deepEqual(r, { data: null, error: blip })
    r = await db.from('profiles').select('id').eq('id', 'u1').single()
    assert.equal(r.error, null)
    assert.equal(r.data.id, 'u1')
  })
})
