'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Encoding-uri suportate nativ de Node pentru scrierea fișierelor de bon.
// ATENȚIE: unele case EconMedia cer CP1250 pentru diacritice — Node NU are
// cp1250 nativ (ar cere iconv-lite, o dependență). Până atunci, default utf8;
// dacă la pilot diacriticele ies „?", vezi checklist-ul din
// docs/BRIDGE_FISCALNET_ARCHITECTURE.md (secțiunea 8).
const SUPPORTED_ENCODINGS = ['utf8', 'utf-8', 'latin1', 'ascii', 'ucs2', 'utf16le'];

function num(...candidates) {
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// Citește o cheie din secțiunea fiscalnet a fișierului de config.
function fnField(fromFile, key) {
  return fromFile && fromFile.fiscalnet ? fromFile.fiscalnet[key] : undefined;
}

function findConfigFile() {
  const candidates = [
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, '..', 'config.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Încarcă și validează configul. Prioritate: variabile de mediu > config.json.
function loadConfig() {
  const file = process.env.MENUVIA_BRIDGE_CONFIG || findConfigFile();
  let fromFile = {};
  if (file && fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`config.json invalid (${file}): ${err.message}`);
    }
  }
  const env = process.env;

  const cfg = {
    supabaseUrl: env.SUPABASE_URL || fromFile.supabaseUrl,
    supabaseAnonKey: env.SUPABASE_ANON_KEY || fromFile.supabaseAnonKey,
    deviceSecret: env.DEVICE_SECRET || fromFile.deviceSecret,
    pollIntervalMs: num(env.POLL_INTERVAL_MS, fromFile.pollIntervalMs) || 5000,
    heartbeatMs: num(env.HEARTBEAT_MS, fromFile.heartbeatMs) || 30000,
    batchLimit: num(env.BATCH_LIMIT, fromFile.batchLimit) || 5,
    fiscalnet: {
      mode: String(env.FISCALNET_MODE || fnField(fromFile, 'mode') || 'api').toLowerCase(),
      // Endpoint confirmat pe webtest.driverfiscal.ro: path lowercase `/api/receipt`.
      // Driver-ul local expune HTTP pe 65400 (plain, fără dependență de cert) și HTTPS pe
      // 65401 (`https://localhost.driverfiscal.ro:65401/api/receipt`). Default = HTTP local,
      // ca să evităm problema de trust al certului TLS (vezi §8 din arhitectură).
      apiUrl: env.FISCALNET_API_URL || fnField(fromFile, 'apiUrl') || 'http://localhost:65400/api/receipt',
      bonuriDir: env.FISCALNET_BONURI_DIR || fnField(fromFile, 'bonuriDir') || 'C:\\FiscalNet\\Bonuri',
      raspunsDir: env.FISCALNET_RASPUNS_DIR || fnField(fromFile, 'raspunsDir') || 'C:\\FiscalNet\\Raspuns',
      encoding: String(env.FISCALNET_ENCODING || fnField(fromFile, 'encoding') || 'utf8').toLowerCase(),
      timeoutMs: num(env.FISCALNET_TIMEOUT_MS, fnField(fromFile, 'timeoutMs')) || 30000,
      pollResponseMs: num(env.FISCALNET_POLL_RESPONSE_MS, fnField(fromFile, 'pollResponseMs')) || 500,
    },
  };

  validate(cfg);
  return cfg;
}

function validate(cfg) {
  const errs = [];
  if (!cfg.supabaseUrl) errs.push('supabaseUrl / SUPABASE_URL lipsește');
  if (!cfg.supabaseAnonKey) errs.push('supabaseAnonKey / SUPABASE_ANON_KEY lipsește');
  if (!cfg.deviceSecret || String(cfg.deviceSecret).length < 16) {
    errs.push('deviceSecret / DEVICE_SECRET lipsește sau e prea scurt (min 16 caractere)');
  }
  if (!['api', 'file'].includes(cfg.fiscalnet.mode)) {
    errs.push(`fiscalnet.mode invalid: "${cfg.fiscalnet.mode}" (accept: api | file)`);
  }
  if (!SUPPORTED_ENCODINGS.includes(cfg.fiscalnet.encoding)) {
    errs.push(`fiscalnet.encoding nesuportat de Node: "${cfg.fiscalnet.encoding}" (accept: ${SUPPORTED_ENCODINGS.join(', ')})`);
  }
  if (cfg.fiscalnet.mode === 'file') {
    if (!cfg.fiscalnet.bonuriDir) errs.push('fiscalnet.bonuriDir lipsește (necesar în mod file)');
    if (!cfg.fiscalnet.raspunsDir) errs.push('fiscalnet.raspunsDir lipsește (necesar în mod file)');
  }
  if (errs.length) {
    throw new Error('Config invalid:\n  - ' + errs.join('\n  - '));
  }
}

module.exports = { loadConfig, SUPPORTED_ENCODINGS };
