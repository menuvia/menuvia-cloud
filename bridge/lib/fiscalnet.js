'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { sleep } = require('./util');

// ─────────────────────────────────────────────────────────────────────────────
// Transportul bonului fiscal către FiscalNet. Payload-ul vine din Supabase
// (coloana pending_receipts.payload) ca text cu linii `^`-delimitate unite cu
// `\n` — EXACT același format pentru ambele transporturi (comenzile FiscalNet
// `S^…`, `P^…`, `CF^…`, `DP^/DV^`, `ST^`). Vezi docs/BRIDGE_FISCALNET_ARCHITECTURE.md.
//
// Rezultat normalizat (indiferent de transport):
//   { success: boolean, bonNumber: string|null, errorCode: string|null, errorInfo: string|null }
// ─────────────────────────────────────────────────────────────────────────────

async function sendReceipt(cfg, receipt) {
  const lines = String(receipt.payload || '')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return fail('EMPTY_PAYLOAD', 'Payload gol — nimic de trimis la casă');
  }
  if (cfg.fiscalnet.mode === 'file') return sendViaFile(cfg, receipt.id, lines);
  return sendViaApi(cfg, lines);
}

// ── Transport 1: API HTTP (BonLocal Post) — recomandat (sincron, fără race) ──
async function sendViaApi(cfg, lines) {
  const url = cfg.fiscalnet.apiUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.fiscalnet.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lines),
      signal: controller.signal,
    });
  } catch (err) {
    // Casă offline / FiscalNet oprit / timeout — nu marcăm success, retry din UI.
    return fail('API_UNREACHABLE', `${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  if (!res.ok) {
    return fail(`HTTP_${res.status}`, raw.slice(0, 300));
  }
  return parseFiscalNetResponse(raw);
}

// ── Transport 2: fișiere (fallback) — scrie Bonuri/<id>.txt, citește Raspuns/ ──
async function sendViaFile(cfg, receiptId, lines) {
  const { bonuriDir, raspunsDir, encoding, timeoutMs, pollResponseMs } = cfg.fiscalnet;
  const fileName = `${receiptId}.txt`;
  const tmpPath = path.join(bonuriDir, `.${fileName}.tmp`);
  const finalPath = path.join(bonuriDir, fileName);
  // FiscalNet pe Windows preferă CRLF.
  const content = lines.join('\r\n') + '\r\n';

  // Scriere atomică: scriem în .tmp, apoi rename — driver-ul nu ridică fișier pe jumătate.
  await fs.writeFile(tmpPath, content, { encoding });
  await fs.rename(tmpPath, finalPath);

  const respPath = path.join(raspunsDir, fileName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(respPath, 'utf8');
      await fs.rm(respPath, { force: true });
      return parseFiscalNetResponse(raw);
    } catch {
      // Răspunsul încă nu există — mai așteptăm.
    }
    await sleep(pollResponseMs);
  }
  return fail('RESPONSE_TIMEOUT', `Fără răspuns în Raspuns/${fileName} după ${timeoutMs}ms`);
}

// ── Parsare răspuns: acceptă JSON (API) SAU text BONOK=/NRBON= (fișiere) ──
function parseFiscalNetResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return fail('EMPTY_RESPONSE', 'Răspuns gol de la FiscalNet');
  // Încercăm JSON întâi (API BonLocal poate răspunde cu obiect).
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const obj = JSON.parse(text);
      const target = Array.isArray(obj) ? obj[0] : obj;
      if (target && typeof target === 'object') return normalizeResponseObject(target);
    } catch {
      // nu e JSON valid — cădem pe parsarea key=value
    }
  }
  return parseKeyValueResponse(text);
}

function normalizeResponseObject(obj) {
  const get = (...keys) => {
    const lowered = {};
    for (const k of Object.keys(obj)) lowered[k.toLowerCase()] = obj[k];
    for (const k of keys) {
      if (lowered[k.toLowerCase()] !== undefined) return lowered[k.toLowerCase()];
    }
    return undefined;
  };
  const okRaw = get('BONOK', 'success', 'ok', 'isSuccess');
  const success = okRaw === true || okRaw === 1 || okRaw === '1' || String(okRaw).toLowerCase() === 'true';
  const bonNumber = get('NRBON', 'receiptNumber', 'bonNumber', 'documentNumber');
  const errorCode = get('ERRCODE', 'errorCode', 'code');
  const errorInfo = get('ERRINFO', 'errorInfo', 'message', 'error');
  if (success) {
    return { success: true, bonNumber: bonNumber != null ? String(bonNumber) : null, errorCode: null, errorInfo: null };
  }
  return fail(errorCode != null ? String(errorCode) : 'UNKNOWN', errorInfo != null ? String(errorInfo) : null);
}

function parseKeyValueResponse(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) map[line.slice(0, eq).trim().toUpperCase()] = line.slice(eq + 1).trim();
  }
  const success = map.BONOK === '1' || String(map.BONOK).toLowerCase() === 'true';
  if (success) {
    return { success: true, bonNumber: map.NRBON || null, errorCode: null, errorInfo: null };
  }
  return fail(map.ERRCODE || 'UNKNOWN', map.ERRINFO || null);
}

function fail(code, info) {
  return { success: false, bonNumber: null, errorCode: code, errorInfo: info };
}

module.exports = { sendReceipt, parseFiscalNetResponse };
