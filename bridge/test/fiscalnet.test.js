'use strict';

// Teste de fum pentru transportul FiscalNet, rulate contra mock-ului (fără hardware).
// Rulare:  node --test test/     (din folderul bridge/)
// NU e prins de vitest/CI (e în afara src/) — verificare manuală/local.

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const { createServer } = require('../mock-fiscalnet');
const { sendReceipt, parseFiscalNetResponse } = require('../lib/fiscalnet');

function apiCfg(port) {
  return {
    fiscalnet: {
      mode: 'api',
      apiUrl: `http://localhost:${port}/api/receipt`,
      timeoutMs: 4000,
      pollResponseMs: 100,
      encoding: 'utf8',
    },
  };
}

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await fn(port);
  } finally {
    server.close();
  }
}

test('API: bon reușit → success + NRBON', async () => {
  await withServer(async (port) => {
    const res = await sendReceipt(apiCfg(port), {
      id: 'r1',
      payload: 'S^Cafea^800^1000^buc^1^1\nST^\nP^1^800',
    });
    assert.strictEqual(res.success, true);
    assert.ok(res.bonNumber, 'trebuie să avem un număr de bon');
    assert.strictEqual(res.errorCode, null);
  });
});

test('API: hârtie terminată → error PAPER_OUT', async () => {
  await withServer(async (port) => {
    const res = await sendReceipt(apiCfg(port), {
      id: 'r2',
      payload: 'S^X^100^1000^buc^1^1\nFAIL_PAPER\nP^1^100',
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, 'PAPER_OUT');
    assert.match(res.errorInfo, /Hârtia/);
  });
});

test('API: casă offline (fără răspuns) → timeout, nu success', async () => {
  await withServer(async (port) => {
    const cfg = apiCfg(port);
    cfg.fiscalnet.timeoutMs = 600; // scurt, ca testul să nu aștepte mult
    const res = await sendReceipt(cfg, { id: 'r3', payload: 'S^X^100^1000^buc^1^1\nFAIL_OFFLINE\nP^1^100' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, 'API_UNREACHABLE');
  });
});

test('API: server picat → API_UNREACHABLE (nu marchează success)', async () => {
  // Port 1 e privilegiat/închis — conexiunea eșuează imediat.
  const res = await sendReceipt(apiCfg(1), { id: 'r4', payload: 'S^X^100^1000^buc^1^1' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errorCode, 'API_UNREACHABLE');
});

test('payload gol → EMPTY_PAYLOAD (fără trimitere)', async () => {
  const res = await sendReceipt(apiCfg(65400), { id: 'r5', payload: '   \n  ' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errorCode, 'EMPTY_PAYLOAD');
});

test('File: scrie Bonuri/<id>.txt + citește Raspuns/<id>.txt', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fnbridge-'));
  const bonuriDir = path.join(dir, 'Bonuri');
  const raspunsDir = path.join(dir, 'Raspuns');
  await fs.mkdir(bonuriDir);
  await fs.mkdir(raspunsDir);

  const cfg = {
    fiscalnet: { mode: 'file', bonuriDir, raspunsDir, encoding: 'utf8', timeoutMs: 3000, pollResponseMs: 50 },
  };
  const id = 'file-bon-1';

  const pending = sendReceipt(cfg, { id, payload: 'S^X^100^1000^buc^1^1\nP^1^100' });
  // Simulează FiscalNet: după ce apare bonul, scrie răspunsul de succes.
  const nudge = setTimeout(() => {
    fs.writeFile(path.join(raspunsDir, `${id}.txt`), 'BONOK=1\nNRBON=777').catch(() => {});
  }, 150);

  const res = await pending;
  clearTimeout(nudge);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.bonNumber, '777');

  // Bonul a fost scris cu conținutul corect (CRLF).
  const written = await fs.readFile(path.join(bonuriDir, `${id}.txt`), 'utf8');
  assert.match(written, /S\^X\^100\^1000\^buc\^1\^1\r\n/);

  await fs.rm(dir, { recursive: true, force: true });
});

test('API: trimite Idempotency-Key = receipt.id (anti bon dublu la retry)', async () => {
  let capturedKey = null;
  const server = http.createServer((req, res) => {
    capturedKey = req.headers['idempotency-key'];
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ BONOK: 1, NRBON: 55 }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const res = await sendReceipt(apiCfg(port), { id: 'receipt-abc-123', payload: 'S^X^100^1000^buc^1^1' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(capturedKey, 'receipt-abc-123', 'header-ul Idempotency-Key trebuie să fie receipt.id');
  } finally {
    server.close();
  }
});

test('parse: răspuns text BONOK=0 mapează codul de eroare', () => {
  const res = parseFiscalNetResponse('BONOK=0\nERRCODE=CASA_OFFLINE\nERRINFO=Cablu deconectat');
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errorCode, 'CASA_OFFLINE');
});

test('parse: răspuns JSON cu chei alternative (receiptNumber)', () => {
  const res = parseFiscalNetResponse(JSON.stringify({ success: true, receiptNumber: 4242 }));
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.bonNumber, '4242');
});
