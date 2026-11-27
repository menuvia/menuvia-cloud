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
//   BZ5  bucla pe PC-ul doar de bucătărie (config.json de Plan 2, prin
//        `loadConfig` REAL): un bon `pending` NU e cerut, NU e revendicat, NU
//        e confirmat — rămâne pentru casa de marcat (coada e pe restaurant, nu
//        pe device: altfel PC-ul din bucătărie fura bonuri și le făcea să pice
//        cu ECONNREFUSED în cursă cu casa reală). Coada de tichete e
//        interogată în continuare. Control POZITIV: același bon, pe un config
//        fără `required` (casa de marcat), e revendicat și confirmat tipărit.
//        Mutația care pică: `processOnce(cfg)` necondiționat în runCycle.
//   BZ6  ieșirea din „doar bucătărie": pe un PC de Plan 2 wizardul întreabă
//        dacă FiscalNet e instalat aici; „da" scoate `required=false`, cere
//        transportul și lasă imprimanta neatinsă, iar `loadConfig` vede din
//        nou FiscalNet obligatoriu. Fără întrebare, după o trecere pe Planul 3
//        cu FiscalNet pe ACELAȘI PC bonurile n-ar mai fi ridicate niciodată
//        (installer-ul nu mai înlocuiește un config existent). Mutația care
//        pică: wizardul fără întrebare (răspunsurile alunecă, `required`
//        rămâne false).
//   BZ7  clichet pe installer (build/installer.iss nu se poate compila aici —
//        doar pe Windows, în bridge-release.yml): `{src}\config.json` poartă
//        `onlyifdoesntexist` (o reinstalare din Descărcări nu mai suprascrie
//        configul completat de wizard cu fișierul brut din panou), iar [Run]
//        PORNEȘTE bridge-ul DUPĂ `--setup` (altfel bucla pornea abia la
//        logon, iar „● Online”-ul aprins de `--check` era fals). Mutațiile
//        care pică: flag-ul scos; intrarea de pornire scoasă sau mutată
//        înaintea wizardului.
//   BZ8  consola scurtăturii „Verificare conexiune (check)" nu se mai închide
//        înainte ca rezultatul să poată fi citit: cu TTY pe intrare ȘI pe ieșire
//        `pauseIfInteractive` cere Enter și se termină abia după el; fără TTY
//        (pipe, teste, fumul din CI, autostart) iese IMEDIAT, fără prompt —
//        altfel `--check` rulat ne-interactiv s-ar agăța. Control POZITIV: cazul
//        TTY chiar așteaptă (nu se rezolvă înainte de Enter), deci „fără prompt”
//        din cazul ne-TTY nu trece dintr-o funcție care nu face nimic.
//        Mutațiile care pică: garda TTY scoasă (cazul ne-TTY se agață și scrie
//        promptul); doar garda pe intrare (ieșirea capturată de CI e ne-TTY,
//        intrarea poate fi TTY); pauza scoasă (cazul TTY nu mai așteaptă).

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
      // URL, cheia anon, cheia dispozitivului: Enter. FiscalNet aici? Enter (nu).
      // Imprimantă: Enter (da), transport Enter (tcp), IP tastat, port Enter.
      const r = runSetup(dir, ['', '', '', '', '', '', '192.168.1.50', '']);
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
      // Configul existent se păstrează (installer-ul nu-l mai suprascrie), deci
      // wizardul spune ce dispozitiv păstrează — un config.json vechi se vede.
      assert.match(r.stdout, /se termină în …zz99/);

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

async function listenLocal(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('BZ5 bucla pe PC-ul doar de bucătărie nu revendică bonuri fiscale', () =>
  withCleanEnv(async () => {
    const { runCycle } = require('../menuvia-bridge');
    const { createServer: createMockFiscal } = require('../mock-fiscalnet');
    const receipt = { id: 'r-1', order_id: 'o-1', payload: 'S^Cafea^800^1000^buc^1^1\nST^\nP^1^800' };
    const fiscal = createMockFiscal();
    const fiscalPort = await listenLocal(fiscal);
    const dir = tmpDir();
    const file = path.join(dir, 'config.json');
    const cycle = async (extra) => {
      const { server: supa, state } = createMockSupabase({ pending: [receipt] });
      const supaPort = await listenLocal(supa);
      try {
        fs.writeFileSync(
          file,
          JSON.stringify({
            ...PANEL_PLAN2,
            supabaseUrl: `http://127.0.0.1:${supaPort}`,
            kitchen: { enabled: true, mode: 'tcp', host: '127.0.0.1' },
            ...extra,
          }),
        );
        process.env.MENUVIA_BRIDGE_CONFIG = file;
        const cfg = loadConfig();
        const n = await runCycle(cfg);
        return { n, cfg, state, fns: state.calls.map((c) => c.fn) };
      } finally {
        supa.close();
      }
    };
    try {
      // PC-ul din bucătărie (config.json de Plan 2, cu IP-ul completat).
      const kitchen = await cycle({});
      assert.strictEqual(kitchen.cfg.fiscalnet.required, false);
      assert.strictEqual(kitchen.n, 0);
      assert.ok(!kitchen.fns.includes('bridge_get_pending'), `bonuri cerute: ${kitchen.fns}`);
      assert.ok(!kitchen.fns.includes('bridge_claim_receipt'), 'bon revendicat de PC-ul fără FiscalNet');
      assert.strictEqual(kitchen.state.confirms.length, 0, 'bon confirmat (deci consumat) de PC-ul fără FiscalNet');
      assert.ok(kitchen.fns.includes('bridge_get_pending_tickets'), 'coada de tichete trebuie să ruleze în continuare');

      // Control pozitiv: casa de marcat (FiscalNet obligatoriu, implicit) ridică bonul.
      const register = await cycle({
        fiscalnet: { mode: 'api', apiUrl: `http://127.0.0.1:${fiscalPort}/api/receipt`, timeoutMs: 3000 },
        kitchen: undefined,
      });
      assert.strictEqual(register.cfg.fiscalnet.required, true);
      assert.strictEqual(register.n, 1);
      assert.deepStrictEqual(register.state.confirms.map((c) => [c.p_receipt_id, c.p_success]), [['r-1', true]]);
      assert.ok(!register.fns.includes('bridge_get_pending_tickets'), 'fără kitchen.enabled, tichetele nu se cer');
    } finally {
      fiscal.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }));

test('BZ6 wizardul scoate PC-ul din „doar bucătărie" când FiscalNet e instalat aici', () =>
  withCleanEnv(() => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'config.json'),
        JSON.stringify({ ...PANEL_PLAN2, kitchen: { enabled: true, mode: 'tcp', host: '192.168.1.50', port: 9100 } }),
      );
      // URL, cheia anon, cheia dispozitivului: Enter. FiscalNet aici? „da".
      // Transport Enter (api), URL API Enter. Imprimantă Enter (da), transport
      // Enter (tcp), IP Enter (cel existent), port Enter.
      const r = runSetup(dir, ['', '', '', 'da', '', '', '', '', '', '']);
      assert.strictEqual(r.status, 0, r.stderr);
      const written = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      assert.deepStrictEqual(written.fiscalnet, { mode: 'api', apiUrl: 'http://localhost:65400/api/receipt' });
      assert.deepStrictEqual(written.kitchen, { enabled: true, mode: 'tcp', host: '192.168.1.50', port: 9100 });

      process.env.MENUVIA_BRIDGE_CONFIG = path.join(dir, 'config.json');
      const cfg = loadConfig();
      assert.strictEqual(cfg.fiscalnet.required, true);
      assert.strictEqual(cfg.kitchen.enabled, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }));

// [Section] → intrările ei, cu liniile continuate (`\` la final) lipite și
// fără comentarii — exact cum le citește iscc.
function issSections(src) {
  const out = {};
  let section = null;
  let pending = '';
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!pending && (!line || line.startsWith(';'))) continue;
    const m = /^\[(\w+)\]$/.exec(line);
    if (!pending && m) {
      section = m[1];
      out[section] = [];
      continue;
    }
    if (line.endsWith('\\')) {
      pending += line.slice(0, -1) + ' ';
      continue;
    }
    if (section) out[section].push(pending + line);
    pending = '';
  }
  return out;
}

function issParams(entry) {
  const params = {};
  for (const part of entry.split(/;\s*/)) {
    const m = /^(\w+):\s*(.*)$/.exec(part.trim());
    if (m) params[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return params;
}

test('BZ7 installer-ul nu suprascrie configul și pornește bridge-ul după wizard', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.iss'), 'utf8');
  const sections = issSections(src);

  const files = (sections.Files || []).map(issParams);
  const cfgEntry = files.find((f) => f.Source === '{src}\\config.json');
  assert.ok(cfgEntry, '[Files] fără config.json-ul de lângă installer');
  const cfgFlags = cfgEntry.Flags.split(/\s+/);
  assert.ok(cfgFlags.includes('onlyifdoesntexist'), `config.json fără onlyifdoesntexist: ${cfgEntry.Flags}`);

  const run = (sections.Run || []).map(issParams);
  const exe = '{app}\\{#ExeName}';
  const setupIdx = run.findIndex((e) => e.Filename === exe && e.Parameters === '--setup');
  const startIdx = run.findIndex((e) => e.Filename === exe && !e.Parameters);
  assert.ok(setupIdx >= 0, '[Run] fără wizardul --setup');
  assert.ok(startIdx >= 0, '[Run] nu pornește bridge-ul (doar la următorul logon)');
  assert.ok(startIdx > setupIdx, 'bridge-ul pornește ÎNAINTEA wizardului, deci fără config');
  const startFlags = run[startIdx].Flags.split(/\s+/);
  assert.ok(startFlags.includes('postinstall'), 'pornirea trebuie să fie o bifă la final');
  assert.ok(startFlags.includes('nowait'), 'bucla nu se termină: fără nowait installer-ul ar sta agățat');
});

test('BZ8 --check așteaptă Enter doar într-o consolă reală', async () => {
  const { PassThrough } = require('node:stream');
  const { pauseIfInteractive } = require('../menuvia-bridge');
  const streams = (inTTY, outTTY) => {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = inTTY;
    output.isTTY = outTTY;
    let written = '';
    output.on('data', (c) => {
      written += c.toString('utf8');
    });
    return { input, output, written: () => written };
  };
  const settledWithin = (p, ms) => {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    return Promise.race([p.then(() => true), timeout]).finally(() => clearTimeout(timer));
  };

  // Fără TTY (sau TTY doar pe una dintre părți): ieșire imediată, fără prompt.
  for (const [inTTY, outTTY] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const s = streams(inTTY, outTTY);
    const p = pauseIfInteractive(s.input, s.output);
    assert.strictEqual(await settledWithin(p, 500), true, `agățat fără consolă (in=${inTTY}, out=${outTTY})`);
    assert.strictEqual(await p, false);
    assert.ok(!s.written().includes('Enter'), `prompt scris fără consolă: ${s.written()}`);
  }

  // Control pozitiv: consolă reală — promptul apare și se așteaptă Enter.
  const s = streams(true, true);
  const p = pauseIfInteractive(s.input, s.output);
  assert.strictEqual(await settledWithin(p, 300), false, 'nu a așteptat Enter');
  assert.match(s.written(), /Apasă Enter ca să închizi fereastra/);
  s.input.write('\n');
  assert.strictEqual(await settledWithin(p, 2000), true, 'Enter nu a închis pauza');
  assert.strictEqual(await p, true);
});
