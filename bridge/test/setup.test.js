'use strict';

// Wizardul `--setup` și verificarea `--check` pe config.json-ul descărcat din
// panou (lotul C7a). Prefixul BZ: verificat cu grep în src/, tests/, e2e/,
// supabase/, docs/, bridge/ și CLAUDE.md, nefolosit înainte.
//
//   BZ1  implicitele vin din config.json-ul găsit: adresa, cheia anon, cheia
//        dispozitivului, „da" la imprimanta de bucătărie pe Planul 2 și
//        FiscalNet nefolosit; locurile goale din config.example.json NU devin
//        implicite. Mutația care pică: `kitchen` implicit „nu" readus.
//   BZ2  cap-coadă: `--setup` rulat lângă un config.json de Plan 2 cu toate
//        răspunsurile goale în afară de IP-ul imprimantei scrie un config pe
//        care `loadConfig` îl acceptă, păstrează câmpurile neîntrebate și NU
//        scrie cheile întregi pe ecran. Mutația care pică: wizardul fără
//        citirea config.json-ului existent (cheia anon goală → config invalid).
//   BZ3  control POZITIV: fără config.json, aceleași răspunsuri goale dau
//        implicitele de fabrică (fără cheie, fără imprimantă) — altfel BZ2 ar
//        trece și dacă wizardul ar avea cheile scrise în cod.
//   BZ4  `--check` cu `fiscalnet.required=false` și FiscalNet de negăsit NU
//        iese cu eroare; cu FiscalNet obligatoriu (implicit), aceeași mașină
//        iese cu eroare (control pozitiv). Mutația care pică: pasul FiscalNet
//        fără garda `required`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const { wizardDefaults, maskSecret, DEFAULT_SUPABASE_URL } = require('../lib/setupDefaults');
const { loadConfig } = require('../lib/config');
const { createMockSupabase } = require('./helpers/mock-supabase');

const BRIDGE = path.join(__dirname, '..', 'menuvia-bridge.js');
const SECRET = 'dev-secret-0123456789abcdef-zz99';
const ANON = 'eyJhbGciOiJIUzI1NiJ9.anon-public-key-wxyz';

// Forma exactă dată de panou pe Planul 2 (src/lib/bridgeSetup.ts).
const PANEL_PLAN2 = {
  supabaseUrl: 'https://proj.supabase.co',
  supabaseAnonKey: ANON,
  deviceSecret: SECRET,
  fiscalnet: { required: false },
  kitchen: { enabled: true, mode: 'tcp' },
};

// Variabilele de mediu au prioritate peste config.json — nu le lăsăm să
// strice testul dacă mașina le are setate.
const ENV_KEYS = [
  'MENUVIA_BRIDGE_CONFIG',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'DEVICE_SECRET',
  'FISCALNET_MODE',
  'FISCALNET_API_URL',
  'FISCALNET_REQUIRED',
  'KITCHEN_ENABLED',
  'KITCHEN_MODE',
  'KITCHEN_HOST',
];
function withCleanEnv(fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const restore = () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  let out;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'menuvia-bridge-setup-'));
}

function runSetup(cwd, answers) {
  const env = { ...process.env };
  for (const k of ENV_KEYS) delete env[k];
  return spawnSync(process.execPath, [BRIDGE, '--setup'], {
    cwd,
    input: answers.join('\n') + '\n',
    encoding: 'utf8',
    env,
    timeout: 20000,
  });
}

test('BZ1 implicitele wizardului vin din config.json-ul din panou', () => {
  const d = wizardDefaults(PANEL_PLAN2);
  assert.strictEqual(d.supabaseUrl, 'https://proj.supabase.co');
  assert.strictEqual(d.supabaseAnonKey, ANON);
  assert.strictEqual(d.deviceSecret, SECRET);
  assert.strictEqual(d.kitchen, true);
  assert.strictEqual(d.kitchenMode, 'tcp');
  assert.strictEqual(d.fiscalRequired, false);

  // Fără fișier (sau gunoi): implicitele de fabrică — FiscalNet obligatoriu, fără imprimantă.
  for (const junk of [{}, null, [], 'x', { fiscalnet: 'nu', kitchen: 7 }]) {
    const f = wizardDefaults(junk);
    assert.strictEqual(f.supabaseUrl, DEFAULT_SUPABASE_URL);
    assert.strictEqual(f.supabaseAnonKey, '');
    assert.strictEqual(f.deviceSecret, '');
    assert.strictEqual(f.kitchen, false);
    assert.strictEqual(f.fiscalRequired, true);
  }

  // config.example.json copiat ca atare: locurile goale nu sunt chei.
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
  const e = wizardDefaults(example);
  assert.strictEqual(e.supabaseAnonKey, '');
  assert.strictEqual(e.deviceSecret, '');

  assert.strictEqual(maskSecret(SECRET), '…zz99');
  assert.strictEqual(maskSecret(''), '');
});

test('BZ2 --setup lângă config.json-ul de Plan 2: doar IP-ul imprimantei de tastat', () =>
  withCleanEnv(() => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ...PANEL_PLAN2, pollIntervalMs: 7000 }));
      // URL, cheia anon, cheia dispozitivului: Enter. FiscalNet: sărit.
      // Imprimantă: Enter (da), transport Enter (tcp), IP tastat, port Enter.
      const r = runSetup(dir, ['', '', '', '', '', '192.168.1.50', '']);
      assert.strictEqual(r.status, 0, r.stderr);

      const written = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      assert.strictEqual(written.supabaseUrl, 'https://proj.supabase.co');
      assert.strictEqual(written.supabaseAnonKey, ANON);
      assert.strictEqual(written.deviceSecret, SECRET);
      assert.strictEqual(written.pollIntervalMs, 7000); // neîntrebat → păstrat
      assert.deepStrictEqual(written.fiscalnet, { required: false });
      assert.deepStrictEqual(written.kitchen, { enabled: true, mode: 'tcp', host: '192.168.1.50', port: 9100 });

      // Cheile nu apar întregi pe ecran (doar coada lor).
      assert.ok(!r.stdout.includes(SECRET), 'cheia dispozitivului afișată întreagă');
      assert.ok(!r.stdout.includes(ANON), 'cheia anon afișată întreagă');
      assert.ok(r.stdout.includes('…zz99'));

      // Bridge-ul pornește pe configul scris.
      process.env.MENUVIA_BRIDGE_CONFIG = path.join(dir, 'config.json');
      const cfg = loadConfig();
      assert.strictEqual(cfg.kitchen.enabled, true);
      assert.strictEqual(cfg.kitchen.host, '192.168.1.50');
      assert.strictEqual(cfg.fiscalnet.required, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }));

test('BZ3 control pozitiv: fără config.json, răspunsurile goale dau implicitele de fabrică', () =>
  withCleanEnv(() => {
    const dir = tmpDir();
    try {
      // URL, cheia anon, cheia dispozitivului, transport, URL API, imprimantă.
      const r = runSetup(dir, ['', '', '', '', '', '']);
      assert.strictEqual(r.status, 0, r.stderr);
      const written = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      assert.strictEqual(written.supabaseUrl, DEFAULT_SUPABASE_URL);
      assert.strictEqual(written.supabaseAnonKey, '');
      assert.strictEqual(written.deviceSecret, '');
      assert.strictEqual(written.kitchen, undefined);
      assert.strictEqual(written.fiscalnet.mode, 'api');

      process.env.MENUVIA_BRIDGE_CONFIG = path.join(dir, 'config.json');
      assert.throws(() => loadConfig(), /supabaseAnonKey/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }));

async function closedPort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

test('BZ4 --check: FiscalNet sărit pe PC-ul doar de bucătărie; obligatoriu altfel', () =>
  withCleanEnv(async () => {
    const { doctor } = require('../menuvia-bridge');
    const { server: supa } = createMockSupabase();
    await new Promise((resolve) => supa.listen(0, '127.0.0.1', resolve));
    const supaPort = supa.address().port;
    const fiscalPort = await closedPort();
    const dir = tmpDir();
    const file = path.join(dir, 'config.json');
    const saved = process.exitCode;
    const run = async (fiscalnet) => {
      fs.writeFileSync(
        file,
        JSON.stringify({
          supabaseUrl: `http://127.0.0.1:${supaPort}`,
          supabaseAnonKey: 'anon-test',
          deviceSecret: SECRET,
          fiscalnet: { mode: 'api', apiUrl: `http://127.0.0.1:${fiscalPort}/api/receipt`, ...fiscalnet },
        }),
      );
      process.env.MENUVIA_BRIDGE_CONFIG = file;
      process.exitCode = undefined;
      await doctor();
      const code = process.exitCode;
      process.exitCode = undefined;
      return code;
    };
    try {
      assert.ok(!(await run({ required: false })), 'PC doar de bucătărie: --check nu trebuie să pice');
      assert.strictEqual(await run({}), 1, 'control pozitiv: FiscalNet obligatoriu și de negăsit → eroare');
    } finally {
      process.exitCode = saved;
      supa.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }));
