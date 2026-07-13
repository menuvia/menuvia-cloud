#!/usr/bin/env node
'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// Menuvia Bridge — proces local care leagă coada fiscală Supabase de FiscalNet.
//
// Flux (contract RPC: mig 030 + mig 045):
//   1. bridge_validate_device  → confirmă device_secret, aflăm restaurant_name
//   2. bridge_get_pending      → ridicăm bonurile `pending`
//   3. bridge_claim_receipt    → claim atomic pending→sent (anti dublă-trimitere)
//   4. sendReceipt (FiscalNet) → tipărim bonul (API primar / fișiere fallback)
//   5. bridge_confirm_receipt  → raportăm rezultatul final (success/error + NRBON)
//   + heartbeat periodic (bridge_heartbeat) ca dashboard-ul să știe „online".
//
// Rulare:  node menuvia-bridge.js   (config din config.json sau variabile env)
// ═════════════════════════════════════════════════════════════════════════════

const { loadConfig } = require('./lib/config');
const { rpc, firstRow } = require('./lib/supabase');
const { sendReceipt } = require('./lib/fiscalnet');
const { printTicket } = require('./lib/kitchenPrinter');
const { sleep, log } = require('./lib/util');

async function validateDevice(cfg) {
  const row = firstRow(await rpc(cfg, 'bridge_validate_device', { p_device_secret: cfg.deviceSecret }));
  if (!row || !row.restaurant_id) throw new Error('Device secret respins de server');
  return row;
}

// Un ciclu: ridică pending, procesează-le pe rând. Întoarce câte a procesat.
async function processOnce(cfg) {
  const rows = await rpc(cfg, 'bridge_get_pending', {
    p_device_secret: cfg.deviceSecret,
    p_limit: cfg.batchLimit,
  });
  const pending = Array.isArray(rows) ? rows : [];

  for (const receipt of pending) {
    // Claim atomic: doar dacă e încă `pending`. Dacă alt bridge l-a luat → skip.
    const claimed = await rpc(cfg, 'bridge_claim_receipt', {
      p_device_secret: cfg.deviceSecret,
      p_receipt_id: receipt.id,
    });
    if (claimed !== true) {
      log('info', `Bon ${receipt.id} deja revendicat de alt bridge — skip`);
      continue;
    }

    let result;
    try {
      result = await sendReceipt(cfg, receipt);
    } catch (err) {
      result = { success: false, bonNumber: null, errorCode: 'BRIDGE_EXCEPTION', errorInfo: err.message };
    }

    // Raportăm mereu rezultatul — success sau error. Bonul `sent` fără confirm
    // ar fi prins altfel de bridge_mark_stale_as_error (cron), dar îl închidem aici.
    try {
      await rpc(cfg, 'bridge_confirm_receipt', {
        p_device_secret: cfg.deviceSecret,
        p_receipt_id: receipt.id,
        p_success: result.success,
        p_bon_number: result.bonNumber,
        p_error_code: result.errorCode,
        p_error_info: result.errorInfo,
      });
    } catch (err) {
      log('error', `confirm eșuat pentru bon ${receipt.id}`, err.message);
    }

    if (result.success) {
      log('info', `Bon ${receipt.id} tipărit ✓ (NRBON=${result.bonNumber})`);
    } else {
      log('warn', `Bon ${receipt.id} EROARE ${result.errorCode}`, result.errorInfo || '');
    }
  }
  return pending.length;
}

// Ciclul de TICHETE de bucătărie (mig 227) — coadă complet separată de cea
// fiscală; imprimanta termică, nu FiscalNet. Aceeași coregrafie:
// get_pending → claim atomic → print → confirm.
async function processKitchenOnce(cfg) {
  const rows = await rpc(cfg, 'bridge_get_pending_tickets', {
    p_device_secret: cfg.deviceSecret,
    p_limit: cfg.batchLimit,
  });
  const pending = Array.isArray(rows) ? rows : [];

  for (const ticket of pending) {
    const claimed = await rpc(cfg, 'bridge_claim_ticket', {
      p_device_secret: cfg.deviceSecret,
      p_ticket_id: ticket.id,
    });
    if (!claimed || claimed.claimed !== true) {
      log('info', `Tichet ${ticket.id} deja revendicat — skip`);
      continue;
    }

    const result = await printTicket(cfg, ticket);

    try {
      await rpc(cfg, 'bridge_confirm_ticket', {
        p_device_secret: cfg.deviceSecret,
        p_ticket_id: ticket.id,
        p_success: result.success,
        p_error_code: result.errorCode,
        p_error_info: result.errorInfo,
      });
    } catch (err) {
      log('error', `confirm eșuat pentru tichet ${ticket.id}`, err.message);
    }

    if (result.success) {
      log('info', `Tichet ${ticket.id} tipărit ✓`);
    } else {
      log('warn', `Tichet ${ticket.id} EROARE ${result.errorCode}`, result.errorInfo || '');
    }
  }
  return pending.length;
}

// `--setup`: wizard interactiv la prima rulare — scrie config.json fără ca
// utilizatorul (non-tehnic) să editeze JSON manual.
async function setup() {
  const fs = require('node:fs');
  const path = require('node:path');

  // Interactiv (TTY) → readline linie-cu-linie. Ne-interactiv (pipe/fișier) → citim
  // tot stdin upfront, altfel readline/promises se blochează pe EOF fără să scrie.
  const isTTY = Boolean(process.stdin.isTTY);
  let rl = null;
  let queue = null;
  if (isTTY) {
    rl = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout });
  } else {
    queue = fs.readFileSync(0, 'utf8').split('\n');
  }
  const ask = async (q, def) => {
    const prompt = def ? `${q} [${def}]: ` : `${q}: `;
    let a;
    if (rl) {
      a = (await rl.question(prompt)).trim();
    } else {
      process.stdout.write(prompt);
      a = (queue.length ? queue.shift() : '').trim();
      process.stdout.write((a || def || '') + '\n');
    }
    return a || def || '';
  };

  log('info', 'Configurare Menuvia Bridge — apasă Enter pentru valoarea implicită.');
  const cfg = {
    supabaseUrl: await ask('Supabase URL', 'https://swjcptdylfmpvopdepqf.supabase.co'),
    supabaseAnonKey: await ask('Supabase anon key (public)'),
    deviceSecret: await ask('Device secret (Dashboard → Casă de marcat → Înregistrează)'),
    fiscalnet: {},
  };
  const mode = (await ask('Transport (api/file)', 'api')).toLowerCase();
  cfg.fiscalnet.mode = mode === 'file' ? 'file' : 'api';
  if (cfg.fiscalnet.mode === 'file') {
    cfg.fiscalnet.bonuriDir = await ask('Folder Bonuri', 'C:\\FiscalNet\\Bonuri');
    cfg.fiscalnet.raspunsDir = await ask('Folder Raspuns', 'C:\\FiscalNet\\Raspuns');
  } else {
    cfg.fiscalnet.apiUrl = await ask('URL API FiscalNet', 'http://localhost:65400/api/receipt');
  }
  // Imprimanta de bucătărie (tichete, mig 227) — opțională.
  const wantKitchen = (await ask('Imprimantă de bucătărie pentru tichete? (da/nu)', 'nu')).toLowerCase();
  if (wantKitchen === 'da' || wantKitchen === 'yes' || wantKitchen === 'y') {
    cfg.kitchen = { enabled: true };
    const kMode = (await ask('Transport tichete (tcp/file)', 'tcp')).toLowerCase();
    cfg.kitchen.mode = kMode === 'file' ? 'file' : 'tcp';
    if (cfg.kitchen.mode === 'tcp') {
      cfg.kitchen.host = await ask('IP imprimantă termică (port 9100)', '192.168.1.100');
      cfg.kitchen.port = Number(await ask('Port', '9100')) || 9100;
    } else {
      cfg.kitchen.dir = await ask('Folder tichete', 'C:\\Menuvia\\Tichete');
    }
  }
  if (rl) rl.close();

  // Când rulează ca .exe împachetat (SEA/pkg), scriem lângă executabil ca autostart-ul
  // (cwd = system32) să găsească același config. În dev, scriem în cwd.
  const packaged = !process.argv[1] || !process.argv[1].endsWith('.js');
  const targetDir = packaged ? path.dirname(process.execPath) : process.cwd();
  const target = path.join(targetDir, 'config.json');
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  log('info', `Config scris în ${target}.`);
  log('info', 'Verifică apoi cu: menuvia-bridge --check');
}

// `--check` (doctor): verifică config + Supabase + FiscalNet FĂRĂ să tipărească
// niciun bon. Util la instalare / diagnoză. Cod de ieșire ≠ 0 dacă ceva pică.
async function doctor() {
  const cfg = loadConfig();
  log('info', `1/3 Config valid · transport=${cfg.fiscalnet.mode}`);

  const dev = await validateDevice(cfg);
  log('info', `2/3 Supabase OK · ${dev.restaurant_name} (${dev.restaurant_id})`);

  if (cfg.fiscalnet.mode === 'api') {
    try {
      // GET (NU POST!) — nu trimite comenzi, deci nu tipărește; orice răspuns HTTP
      // (chiar și 405) dovedește că FiscalNet ascultă pe port.
      const res = await fetch(cfg.fiscalnet.apiUrl, { method: 'GET' });
      log('info', `3/3 FiscalNet reachable · HTTP ${res.status} la ${cfg.fiscalnet.apiUrl}`);
    } catch (err) {
      log('error', `3/3 FiscalNet UNREACHABLE la ${cfg.fiscalnet.apiUrl}`, err.message);
      process.exitCode = 1;
    }
  } else {
    const fsp = require('node:fs/promises');
    for (const [label, dir] of [
      ['Bonuri', cfg.fiscalnet.bonuriDir],
      ['Raspuns', cfg.fiscalnet.raspunsDir],
    ]) {
      try {
        await fsp.access(dir);
        log('info', `3/3 ${label} accesibil · ${dir}`);
      } catch {
        log('error', `3/3 ${label} INEXISTENT/inaccesibil · ${dir}`);
        process.exitCode = 1;
      }
    }
  }
  // Pas 4 (opțional): imprimanta de bucătărie, doar cu kitchen.enabled.
  if (cfg.kitchen.enabled) {
    if (cfg.kitchen.mode === 'tcp') {
      const netMod = require('node:net');
      await new Promise((resolve) => {
        const s = netMod.createConnection(
          { host: cfg.kitchen.host, port: cfg.kitchen.port },
          () => {
            log('info', `4/4 Imprimantă bucătărie reachable · ${cfg.kitchen.host}:${cfg.kitchen.port}`);
            s.destroy();
            resolve();
          },
        );
        s.setTimeout(cfg.kitchen.timeoutMs, () => {
          log('error', `4/4 Imprimantă bucătărie TIMEOUT · ${cfg.kitchen.host}:${cfg.kitchen.port}`);
          process.exitCode = 1;
          s.destroy();
          resolve();
        });
        s.on('error', (err) => {
          log('error', `4/4 Imprimantă bucătărie UNREACHABLE · ${cfg.kitchen.host}:${cfg.kitchen.port}`, err.message);
          process.exitCode = 1;
          resolve();
        });
      });
    } else {
      const fsp = require('node:fs/promises');
      try {
        await fsp.access(cfg.kitchen.dir);
        log('info', `4/4 Folder tichete accesibil · ${cfg.kitchen.dir}`);
      } catch {
        log('error', `4/4 Folder tichete INEXISTENT/inaccesibil · ${cfg.kitchen.dir}`);
        process.exitCode = 1;
      }
    }
  }
  if (!process.exitCode) log('info', 'Toate verificările au trecut ✓');
}

async function main() {
  const cfg = loadConfig();
  const dev = await validateDevice(cfg);
  log('info', `Conectat: ${dev.restaurant_name} (${dev.restaurant_id}) · transport=${cfg.fiscalnet.mode}`);

  // Heartbeat periodic (best-effort, nu blochează bucla).
  const hb = setInterval(() => {
    rpc(cfg, 'bridge_heartbeat', { p_device_secret: cfg.deviceSecret }).catch((e) =>
      log('warn', 'Heartbeat eșuat', e.message)
    );
  }, cfg.heartbeatMs);
  if (typeof hb.unref === 'function') hb.unref();

  let running = true;
  const stop = () => {
    if (running) log('info', 'Oprire cerută — închid după ciclul curent…');
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    try {
      // Ambele cozi într-un ciclu: bonuri fiscale + tichete de bucătărie.
      // Tichetele rulează doar cu kitchen.enabled — bridge-urile existente
      // (fără secțiunea kitchen în config) nu-și schimbă comportamentul.
      const n = (await processOnce(cfg)) +
        (cfg.kitchen.enabled ? await processKitchenOnce(cfg) : 0);
      if (n === 0) await sleep(cfg.pollIntervalMs);
    } catch (err) {
      log('error', 'Ciclu eșuat', err.message);
      await sleep(cfg.pollIntervalMs);
    }
  }

  clearInterval(hb);
  log('info', 'Bridge oprit curat');
}

if (require.main === module) {
  const argv = process.argv;
  const entry = argv.includes('--setup') ? setup : argv.includes('--check') ? doctor : main;
  entry().catch((err) => {
    log('error', 'Bridge a crăpat', err.message);
    process.exit(1);
  });
}

module.exports = { processOnce, processKitchenOnce, validateDevice, doctor, setup };
