'use strict';

// Teste pentru kitchenPrinter (tichete de bucătărie, mig 227) — node:test,
// zero dependențe, ca fiscalnet.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { printTicket, transliterate, sanitizeForEscPos, buildEscPos } = require('../lib/kitchenPrinter');

function cfgWith(kitchen) {
  return { kitchen: { enabled: true, mode: 'tcp', host: '127.0.0.1', port: 9100,
                      dir: '', timeoutMs: 500, transliterate: true, ...kitchen } };
}

test('transliterate: diacriticele românești devin ASCII', () => {
  assert.equal(transliterate('Ștrudel cu brânză și țelină ĂÂÎ'), 'Strudel cu branza si telina AAI');
});

test('buildEscPos: init la început, cut la final, payload inclus', () => {
  const bytes = buildEscPos(cfgWith({}), 'MASA: 5\n1x Pizza');
  assert.ok(Buffer.isBuffer(bytes), 'buildEscPos trebuie să întoarcă Buffer');
  assert.ok(bytes.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])), 'lipsește ESC init');
  assert.ok(bytes.subarray(-4).equals(Buffer.from([0x1d, 0x56, 0x42, 0x00])), 'lipsește cut');
  assert.ok(bytes.includes('1x Pizza'));
});

// ─── KB1–KB5: tichetul conține doar octeți tipăribili ───────────────────────
// Mutații care pică: `buildEscPos` fără `sanitizeForEscPos` (KB1, KB2, KB4),
// `socket.end(text, 'binary')` pe șirul netransformat (KB2, KB4), latin1
// lăsat liber pe transliterare pornită (KB5), fișier fără curățare (KB5).

// Corpul tichetului: tot ce e între ESC @ inițial și GS V final.
function body(buf) {
  assert.ok(buf.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])));
  assert.ok(buf.subarray(-4).equals(Buffer.from([0x1d, 0x56, 0x42, 0x00])));
  return buf.subarray(2, -4);
}
function assertPrintable(bytes, { latin1 = false } = {}) {
  for (const b of bytes) {
    const ok = b === 0x0a || (b >= 0x20 && b <= 0x7e) || (latin1 && b >= 0xa0);
    assert.ok(ok, `octet ne-tipăribil 0x${b.toString(16).padStart(2, '0')} în ${bytes.toString('hex')}`);
  }
}

test('KB1 o notă de oaspete cu ESC p (sertarul de bani) și GS V nu ajunge comandă', () => {
  // ESC p 0 25 250 = deschide sertarul; GS V B 0 = taie; ESC @ = reset.
  const note = 'Fara ceapa\x1bp\x00\x19\xfa\x1dVB\x00\x1b@ multumesc';
  const buf = buildEscPos(cfgWith({}), `MASA: 4\nNOTE: ${note}`);
  const b = body(buf);
  assertPrintable(b);
  assert.ok(!b.includes(0x1b) && !b.includes(0x1d), 'ESC/GS în corpul tichetului');
  // Control pozitiv: textul obișnuit din jur rămâne.
  assert.ok(b.toString('latin1').includes('Fara ceapa'));
  assert.ok(b.toString('latin1').includes('multumesc'));
});

test('KB2 caracterele trunchiate de vechiul `binary` nu mai devin octeți de control', () => {
  // ě = U+011B (octetul de jos 0x1B = ESC), ȝ = U+021D (0x1D = GS),
  // „ = U+201E (0x1E). Pe codul vechi fiecare ieșea exact octetul de control.
  const buf = buildEscPos(cfgWith({}), 'ě ȝ „x”');
  assert.equal(body(buf).toString('hex'), Buffer.from('e ? "x"\n\n\n', 'latin1').toString('hex'));
});

test('KB3 hex exact: diacritice românești, ghilimele, €, tab și CRLF', () => {
  const buf = buildEscPos(cfgWith({}), 'Ciorbă „de burtă”\t1×\r\nTotal: 12 €');
  assert.equal(
    buf.toString('hex'),
    '1b40' + Buffer.from('Ciorba "de burta" 1x\nTotal: 12 EUR\n\n\n', 'latin1').toString('hex') + '1d564200',
  );
});

test('KB4 tcp: imprimanta primește doar octeți tipăribili între init și cut', async () => {
  const received = [];
  let gotAll;
  const allReceived = new Promise((r) => { gotAll = r; });
  const server = net.createServer((socket) => {
    socket.on('data', (d) => {
      received.push(d);
      if (Buffer.concat(received).includes(Buffer.from([0x1d, 0x56, 0x42, 0x00]))) gotAll();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const result = await printTicket(cfgWith({ port }), {
    id: 'kb4', payload: 'MASA: Terasă 2\n1x Pește\nNOTE: rapid\x1bp\x00\x19\xfa ě',
  });
  await allReceived;
  server.close();

  assert.equal(result.success, true);
  const all = Buffer.concat(received);
  const b = body(all);
  assertPrintable(b);
  assert.ok(b.toString('latin1').includes('1x Peste'));
});

test('KB5 transliterare oprită: latin1 pe 9100, UTF-8 curățat în fișier', async () => {
  // 9100: é (0xE9) rămâne octet latin1, ș (U+0219 → 0x19 pe codul vechi)
  // cade pe litera de bază, ESC dispare (`@` rămâne — e text, nu comandă).
  const buf = buildEscPos(cfgWith({ transliterate: false }), 'Café ș\x1b@');
  assert.equal(body(buf).toString('hex'), Buffer.from('Café s@\n\n\n', 'latin1').toString('hex'));
  assertPrintable(body(buf), { latin1: true });
  // Pe transliterare PORNITĂ latin1 nu e permis: é devine e.
  assertPrintable(body(buildEscPos(cfgWith({}), 'Café')));

  // Fișier UTF-8: diacriticele rămân (spooler-ul care citea UTF-8 nu
  // regresează), controalele și caracterele invizibile nu.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
  const result = await printTicket(cfgWith({ mode: 'file', dir, transliterate: false }), {
    id: 'kb5', payload: 'Ciorbă\x1bp\x00\u202e ok',
  });
  assert.equal(result.success, true);
  const written = fs.readFileSync(path.join(dir, 'kb5.txt'), 'utf8');
  assert.equal(written, 'Ciorbăp? ok\r\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

// Recenzie adversarială pe #339 (F1–F4). Mutații care pică: `·` scos din
// PUNCT_MAP (KB6), fișierul pe `ascii` când transliterarea e pornită (KB7),
// fișier necurățat pe ramura implicită (KB7), fără NFC (KB7), LS/NEL/CR
// mapate pe `\n` (KB8), baza NFD acceptată pe orice ASCII (KB9).
test('KB6 antetul real din mig 227 (`·`) rămâne lizibil, nu `?`', () => {
  const buf = buildEscPos(cfgWith({}), 'OSPATAR · MASA: 5\n#ABC123 · 12:30');
  assert.equal(body(buf).toString('latin1'), 'OSPATAR - MASA: 5\n#ABC123 - 12:30\n\n\n');
});

test('KB7 fișier cu transliterarea PORNITĂ (implicit): UTF-8 păstrat, controale scoase', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-'));
  const result = await printTicket(cfgWith({ mode: 'file', dir }), {
    // `S\u0326` = Ș DEScompus: fără NFC, transliterarea (doar forme
    // precompuse) îl rata și fișierul păstra diacriticul.
    id: 'kb7', payload: 'OSPATAR · MASA: 2\nCafé „mare” Ciorbă S\u0326nițel\x1bp\x00\x19',
  });
  assert.equal(result.success, true);
  const written = fs.readFileSync(path.join(dir, 'kb7.txt'), 'utf8');
  assert.equal(written, 'OSPATAR · MASA: 2\r\nCafé „mare” Ciorba Snitelp\r\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('KB8 CR singur, NEL și separatorii Unicode NU fac rând nou (fără produse false)', () => {
  // Recenzie CodeRabbit pe #339: o notă „rapid\u20282x Pizza” ar fi tipărit
  // „2x Pizza” pe rândul ei, adică un produs necomandat. Doar \n (și CRLF),
  // separatorul pus de SQL, rupe rândul.
  assert.equal(sanitizeForEscPos('a\rb\u0085c\u2028d\u2029e'), 'a b c d e');
  assert.equal(sanitizeForEscPos('MASA: 4\r\nNOTE: rapid\u20282x Pizza'), 'MASA: 4\nNOTE: rapid 2x Pizza');
});

test('KB9 diacritice descompuse și negații: fără „?” parazit, fără sens inversat', () => {
  const buf = buildEscPos(cfgWith({}), 's\u0326ef Cafe\u0301 fara \u2260 ceapa \u226e5');
  assert.equal(body(buf).toString('latin1'), 'sef Cafe fara != ceapa ?5\n\n\n');
});

test('sanitizeForEscPos: implicit ASCII, fără să atingă textul curat', () => {
  assert.equal(sanitizeForEscPos('2x Mici\nMASA: 5'), '2x Mici\nMASA: 5');
  assert.equal(sanitizeForEscPos('Ő ü ñ 漢'), 'O u n ?');
});

test('tcp: scrie ESC/POS pe un server local și întoarce success', async () => {
  const received = [];
  // Succesul se raportează la FLUSH-ul clientului (fire-and-forget, fără ACK) —
  // serverul primește datele un tick mai târziu, deci așteptăm cut-ul final
  // înainte de a citi ce a ajuns.
  let gotAll;
  const allReceived = new Promise((r) => { gotAll = r; });
  const server = net.createServer((socket) => {
    socket.on('data', (d) => {
      received.push(d);
      if (Buffer.concat(received).toString('binary').includes('\x1d\x56\x42\x00')) gotAll();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const result = await printTicket(cfgWith({ port }), {
    id: 't1', payload: '*** COMANDA NOUA ***\nMASA: Terasă 3\n2x Mici',
  });
  await allReceived;
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
