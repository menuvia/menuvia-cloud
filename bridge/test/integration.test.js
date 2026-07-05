'use strict';

// Teste de integrare pe bucla principală (menuvia-bridge.js) contra unui mock
// Supabase (forme PostgREST reale) + mock FiscalNet. Validează CONTRACTUL RPC —
// numele parametrilor (p_device_secret, p_receipt_id, p_success, p_bon_number,
// p_error_code), logica de claim-skip și maparea confirm-ului. O nepotrivire de
// nume de parametru ar pica aici, nu abia la pilotul real.

const test = require('node:test');
const assert = require('node:assert');

const { createMockSupabase } = require('./helpers/mock-supabase');
const { createServer: createMockFiscal } = require('../mock-fiscalnet');
const { processOnce, validateDevice } = require('../menuvia-bridge');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, resolve));
  return server.address().port;
}

function makeCfg(supaPort, fiscalPort) {
  return {
    supabaseUrl: `http://localhost:${supaPort}`,
    supabaseAnonKey: 'anon-test',
    deviceSecret: 'device-secret-abcdef123456',
    batchLimit: 5,
    pollIntervalMs: 10,
    heartbeatMs: 100000,
    fiscalnet: {
      mode: 'api',
      apiUrl: `http://localhost:${fiscalPort}/api/receipt`,
      timeoutMs: 3000,
      pollResponseMs: 50,
      encoding: 'utf8',
    },
  };
}

test('integration: validateDevice întoarce restaurantul', async () => {
  const { server: supa } = createMockSupabase();
  const fiscal = createMockFiscal();
  const sp = await listen(supa);
  const fp = await listen(fiscal);
  try {
    const dev = await validateDevice(makeCfg(sp, fp));
    assert.strictEqual(dev.restaurant_id, 'rest-1');
    assert.strictEqual(dev.restaurant_name, 'Test SRL');
  } finally {
    supa.close();
    fiscal.close();
  }
});

test('integration: flux complet — claim + send + confirm success cu NRBON', async () => {
  const { server: supa, state } = createMockSupabase({
    pending: [{ id: 'r-1', order_id: 'o-1', payload: 'S^Cafea^800^1000^buc^1^1\nST^\nP^1^800' }],
  });
  const fiscal = createMockFiscal();
  const sp = await listen(supa);
  const fp = await listen(fiscal);
  try {
    const n = await processOnce(makeCfg(sp, fp));
    assert.strictEqual(n, 1);
    assert.strictEqual(state.confirms.length, 1);
    const c = state.confirms[0];
    assert.strictEqual(c.p_receipt_id, 'r-1');
    assert.strictEqual(c.p_success, true);
    assert.ok(c.p_bon_number, 'confirm-ul trebuie să conțină NRBON');
    assert.strictEqual(c.p_error_code, null);
  } finally {
    supa.close();
    fiscal.close();
  }
});

test('integration: bon nerevendicabil (alt bridge) → NU se trimite, NU se confirmă', async () => {
  const { server: supa, state } = createMockSupabase({
    pending: [{ id: 'r-taken', order_id: 'o-2', payload: 'S^X^100^1000^buc^1^1\nP^1^100' }],
    unclaimableIds: ['r-taken'],
  });
  const fiscal = createMockFiscal();
  const sp = await listen(supa);
  const fp = await listen(fiscal);
  try {
    await processOnce(makeCfg(sp, fp));
    assert.strictEqual(state.confirms.length, 0, 'nu confirmăm un bon pe care nu l-am revendicat');
  } finally {
    supa.close();
    fiscal.close();
  }
});

test('integration: FiscalNet PAPER_OUT → confirm success=false + errorCode', async () => {
  const { server: supa, state } = createMockSupabase({
    pending: [{ id: 'r-err', order_id: 'o-3', payload: 'S^X^100^1000^buc^1^1\nFAIL_PAPER\nP^1^100' }],
  });
  const fiscal = createMockFiscal();
  const sp = await listen(supa);
  const fp = await listen(fiscal);
  try {
    await processOnce(makeCfg(sp, fp));
    assert.strictEqual(state.confirms.length, 1);
    assert.strictEqual(state.confirms[0].p_success, false);
    assert.strictEqual(state.confirms[0].p_error_code, 'PAPER_OUT');
  } finally {
    supa.close();
    fiscal.close();
  }
});

test('integration: două bonuri pending → ambele procesate în ordine', async () => {
  const { server: supa, state } = createMockSupabase({
    pending: [
      { id: 'r-a', order_id: 'o-a', payload: 'S^A^100^1000^buc^1^1\nP^1^100' },
      { id: 'r-b', order_id: 'o-b', payload: 'S^B^200^1000^buc^1^1\nP^1^200' },
    ],
  });
  const fiscal = createMockFiscal();
  const sp = await listen(supa);
  const fp = await listen(fiscal);
  try {
    const n = await processOnce(makeCfg(sp, fp));
    assert.strictEqual(n, 2);
    assert.strictEqual(state.confirms.length, 2);
    assert.deepStrictEqual(
      state.confirms.map((c) => c.p_receipt_id),
      ['r-a', 'r-b']
    );
    assert.ok(state.confirms.every((c) => c.p_success === true));
  } finally {
    supa.close();
    fiscal.close();
  }
});
