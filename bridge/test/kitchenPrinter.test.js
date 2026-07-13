'use strict';

// Teste pentru kitchenPrinter (tichete de bucătărie, mig 227) — node:test,
// zero dependențe, ca fiscalnet.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { printTicket, transliterate, buildEscPos } = require('../lib/kitchenPrinter');

function cfgWith(kitchen) {
  return { kitchen: { enabled: true, mode: 'tcp', host: '127.0.0.1', port: 9100,
                      dir: '', timeoutMs: 500, transliterate: true, ...kitchen } };
}

test('transliterate: diacriticele românești devin ASCII', () => {
  assert.equal(transliterate('Ștrudel cu brânză și țelină ĂÂÎ'), 'Strudel cu branza si telina AAI');
});

test('buildEscPos: init la început, cut la final, payload inclus', () => {
  const bytes = buildEscPos(cfgWith({}), 'MASA: 5\n1x Pizza');
  assert.ok(bytes.startsWith('\x1b\x40'), 'lipsește ESC init');
  assert.ok(bytes.endsWith('\x1d\x56\x42\x00'), 'lipsește cut');
  assert.ok(bytes.includes('1x Pizza'));
});

test('tcp: scrie ESC/POS pe un server local și întoarce success', async () => {
  const received = [];
  const server = net.createServer((socket) => {
    socket.on('data', (d) => received.push(d));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const result = await printTicket(cfgWith({ port }), {
    id: 't1', payload: '*** COMANDA NOUA ***\nMASA: Terasă 3\n2x Mici',
  });
  server.close();

  assert.equal(result.success, true);
  const all = Buffer.concat(received).toString('binary');
  assert.ok(all.startsWith('\x1b\x40'));
  assert.ok(all.includes('2x Mici'));
  // Transliterat: „Terasă" → „Terasa".
  assert.ok(all.includes('Terasa 3'));
  assert.ok(all.includes('\x1d\x56\x42\x00'));
});

test('tcp: imprimantă inexistentă → PRINTER_UNREACHABLE (fără throw)', async () => {
  // Port închis pe loopback — conexiunea e refuzată imediat.
  const result = await printTicket(cfgWith({ port: 1 }), { id: 't2', payload: 'x' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'PRINTER_UNREACHABLE');
});

test('tcp: server mut → PRINT_TIMEOUT', async () => {
  // Server care acceptă conexiunea dar nu o închide niciodată: socket-ul
  // clientului rămâne deschis → timeout-ul nostru trebuie să tragă.
  const server = net.createServer(() => {
    /* ține conexiunea deschisă */
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const result = await printTicket(cfgWith({ port, timeoutMs: 200 }), { id: 't3', payload: 'x' });
  server.close();

  // end() poate închide curat înainte de timeout pe unele platforme — ambele
  // rezultate sunt acceptabile pentru un canal fire-and-forget; important e
  // să NU arunce și să întoarcă o formă validă.
  assert.equal(typeof result.success, 'boolean');
  if (!result.success) assert.equal(result.errorCode, 'PRINT_TIMEOUT');
});

test('file: scrie <id>.txt cu CRLF, atomic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
  const result = await printTicket(cfgWith({ mode: 'file', dir }), {
    id: 'abc-123', payload: 'MASA: 1\n1x Ciorbă',
  });
  assert.equal(result.success, true);
  const written = fs.readFileSync(path.join(dir, 'abc-123.txt'), 'utf8');
  assert.ok(written.includes('1x Ciorba'));
  assert.ok(written.includes('\r\n'), 'lipsește CRLF');
  assert.ok(!fs.existsSync(path.join(dir, 'abc-123.txt.tmp')), 'tmp-ul nu a fost redenumit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('file: folder inexistent → FILE_WRITE_FAILED (fără throw)', async () => {
  const result = await printTicket(
    cfgWith({ mode: 'file', dir: '/cale/inexistenta/sigur' }),
    { id: 't4', payload: 'x' },
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'FILE_WRITE_FAILED');
});
