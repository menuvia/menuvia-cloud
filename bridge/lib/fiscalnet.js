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
//   { success: boolean, bonNumber: string|null, errorCode: string|null, errorInfo: string|null,
//     ambiguous: boolean }
//
// `ambiguous` (audit aug 2026, oglinda politicii Oblio din mig 218): true când
// cererea POATE să fi ajuns la casă dar confirmarea s-a pierdut (timeout după
// predarea fișierului către driver / abort după trimiterea POST-ului / eroare
// la CITIREA răspunsului). Un retry orb pe un astfel de eșec = BON FISCAL
// DUBLU real (bandă + raport Z + discrepanță ANAF), nu doar hârtie dublă.
// Marker-ul AMBIGUOUS_PREFIX intră în error_info → ajunge în pending_receipts
// → BridgeTab cere confirmare explicită la retrimitere.
// ─────────────────────────────────────────────────────────────────────────────

const AMBIGUOUS_PREFIX = 'POSIBIL DUPLICAT — verifică banda casei înainte de retrimitere: ';

// Erori de rețea PRE-conectare: cererea sigur NU a ajuns la FiscalNet → retry sigur.
const PRECONNECT_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'EAI_AGAIN',
]);
function isPreconnectError(err) {
  const cause = err && err.cause;
  const code = err && (err.code || (cause && cause.code));
  if (code != null && PRECONNECT_CODES.has(String(code))) return true;
  // Dual-stack (IPv4+IPv6): undici împachetează refuzurile într-un AggregateError.
  if (cause && Array.isArray(cause.errors) && cause.errors.length > 0) {
    return cause.errors.every((e) => PRECONNECT_CODES.has(String(e && e.code)));
  }
  // URL/port invalid ('bad port') — undici refuză ÎNAINTE de orice trimitere.
  if (cause && /bad port|invalid url/i.test(String(cause.message || ''))) return true;
  return false;
}

async function sendReceipt(cfg, receipt) {
  const lines = String(receipt.payload || '')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return fail('EMPTY_PAYLOAD', 'Payload gol — nimic de trimis la casă');
  }
  if (cfg.fiscalnet.mode === 'file') return sendViaFile(cfg, receipt.id, lines);
  return sendViaApi(cfg, lines, receipt.id);
}

// ── Transport 1: API HTTP (BonLocal Post) — recomandat (sincron, fără race) ──
async function sendViaApi(cfg, lines, receiptId) {
  const url = cfg.fiscalnet.apiUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.fiscalnet.timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Cheie de idempotență = receipt_id. La un retry după „timeout-după-tipărire",
          // dacă FiscalNet o onorează, evită bonul FISCAL DUBLU (paritate cu idempotența
          // pe nume de fișier din modul `file`). DE CONFIRMAT că API-ul o respectă — până
          // atunci, un timeout NU e sigur de re-trimis automat (vezi §8.6 din arhitectură).
          'Idempotency-Key': String(receiptId || ''),
        },
        body: JSON.stringify(lines),
        signal: controller.signal,
      });
    } catch (err) {
      // Pre-conectare (refuz/DNS) = cererea sigur n-a plecat → retry SIGUR.
      // Abort (timeout-ul nostru) sau reset DUPĂ conectare = POST-ul poate fi
      // ajuns și bonul tipărit → AMBIGUU, retry doar cu verificare umană.
      const preconnect = isPreconnectError(err) && err.name !== 'AbortError';
      return fail('API_UNREACHABLE', `${url}: ${err.message}`, !preconnect);
    }
    // Citim corpul ÎN fereastra de timeout: un server care trimite header-ele apoi
    // atârnă pe corp ar bloca altfel bridge-ul la nesfârșit.
    let raw;
    try {
      raw = await res.text();
    } catch (err) {
      // Header-ele au sosit → serverul A PRIMIT cererea; doar răspunsul s-a
      // pierdut. Cel mai clar caz de ambiguitate — înainte, eroarea scăpa
      // neprinsă și ajungea BRIDGE_EXCEPTION generic, fără marker.
      return fail('RESPONSE_READ_FAILED', `${url}: ${err.message}`, true);
    }
    if (!res.ok) {
      return fail(`HTTP_${res.status}`, raw.slice(0, 300));
    }
    return parseFiscalNetResponse(raw);
  } finally {
    clearTimeout(timer);
  }
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
  // Fișierul bonului a fost DEJA predat driver-ului (rename reușit) — casa
  // poate să-l fi tipărit fără ca răspunsul să apară la timp → AMBIGUU.
  return fail('RESPONSE_TIMEOUT', `Fără răspuns în Raspuns/${fileName} după ${timeoutMs}ms`, true);
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

function fail(code, info, ambiguous = false) {
  // Marker-ul de ambiguitate călătorește ÎN error_info (singura coloană care
  // ajunge nealterată în pending_receipts → BridgeTab), nu doar în flag.
  const errorInfo = ambiguous ? AMBIGUOUS_PREFIX + (info || code) : info;
  return { success: false, bonNumber: null, errorCode: code, errorInfo, ambiguous };
}

module.exports = { sendReceipt, parseFiscalNetResponse, AMBIGUOUS_PREFIX };
