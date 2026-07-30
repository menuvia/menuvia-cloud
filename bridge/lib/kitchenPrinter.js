'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// kitchenPrinter — tipărește tichete de bucătărie (mig 227) pe o imprimantă
// TERMICĂ, prin ACELAȘI bridge local, dar pe cu totul alt canal decât FiscalNet:
//   • tcp  — ESC/POS RAW pe port 9100 (standardul Epson/Xprinter; zero deps).
//            ATENȚIE: 9100 e fire-and-forget — NU există ACK de la imprimantă,
//            deci „success" = socket-ul a fost scris complet. Un tichet se
//            poate pierde cu hârtia terminată fără nicio eroare; acceptat în
//            v1 (retry-ul înseamnă doar hârtie dublă în bucătărie, inofensiv —
//            spre deosebire de fiscal, unde un retry = bon dublu).
//   • file — scriere atomică .tmp→rename `<ticket_id>.txt` (CRLF) într-un
//            folder, pentru soluții de print-spooling locale. Fără folder de
//            răspuns (nu e FiscalNet).
// ─────────────────────────────────────────────────────────────────────────────

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

// Imprimantele termice ieftine nu au UTF-8 / diacritice românești.
const RO_MAP = { ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't',
                 Ă: 'A', Â: 'A', Î: 'I', Ș: 'S', Ş: 'S', Ț: 'T', Ţ: 'T' };
function transliterate(text) {
  return String(text).replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (c) => RO_MAP[c] || c);
}

// ESC/POS minimal: init + text + feed + full cut.
const ESC_INIT = '\x1b\x40';
const ESC_CUT = '\x1d\x56\x42\x00';

function buildEscPos(cfg, payload) {
  const text = cfg.kitchen.transliterate ? transliterate(payload) : payload;
  return ESC_INIT + text + '\n\n\n' + ESC_CUT;
}

function printViaTcp(cfg, ticket) {
  return new Promise((resolve) => {
    const bytes = buildEscPos(cfg, ticket.payload);
    const socket = net.createConnection({ host: cfg.kitchen.host, port: cfg.kitchen.port });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(cfg.kitchen.timeoutMs, () =>
      done({ success: false, errorCode: 'PRINT_TIMEOUT',
             errorInfo: `timeout ${cfg.kitchen.timeoutMs}ms la ${cfg.kitchen.host}:${cfg.kitchen.port}` }));
    socket.on('error', (err) =>
      done({ success: false, errorCode: 'PRINTER_UNREACHABLE', errorInfo: err.message }));
    socket.on('connect', () => {
      // Succes = datele scrise complet (callback-ul lui end = flush terminat).
      // NU așteptăm 'close': multe imprimante termice acceptă datele dar nu
      // trimit niciodată FIN — fiecare print ar fi raportat fals PRINT_TIMEOUT
      // (zgomot + retry-uri manuale degeaba). 9100 rămâne fire-and-forget.
      socket.end(bytes, 'binary', () =>
        done({ success: true, errorCode: null, errorInfo: null }));
    });
  });
}

function printViaFile(cfg, ticket) {
  try {
    const text = (cfg.kitchen.transliterate ? transliterate(ticket.payload) : ticket.payload)
      .replace(/\r?\n/g, '\r\n');
    const target = path.join(cfg.kitchen.dir, `${ticket.id}.txt`);
    const tmp = target + '.tmp';
    // Scriere atomică: spooler-ul nu are voie să vadă fișiere pe jumătate.
    fs.writeFileSync(tmp, text + '\r\n', 'utf8');
    fs.renameSync(tmp, target);
    return { success: true, errorCode: null, errorInfo: null };
  } catch (err) {
    return { success: false, errorCode: 'FILE_WRITE_FAILED', errorInfo: err.message };
  }
}

// API-ul public: {success, errorCode, errorInfo} — nu aruncă niciodată.
async function printTicket(cfg, ticket) {
  try {
    if (cfg.kitchen.mode === 'file') return printViaFile(cfg, ticket);
    return await printViaTcp(cfg, ticket);
  } catch (err) {
    return { success: false, errorCode: 'BRIDGE_EXCEPTION', errorInfo: err.message };
  }
}

module.exports = { printTicket, transliterate, buildEscPos };
