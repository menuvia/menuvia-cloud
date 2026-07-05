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
      const n = await processOnce(cfg);
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
  const isCheck = process.argv.includes('--check');
  (isCheck ? doctor() : main()).catch((err) => {
    log('error', 'Bridge a crăpat', err.message);
    process.exit(1);
  });
}

module.exports = { processOnce, validateDevice, doctor };
