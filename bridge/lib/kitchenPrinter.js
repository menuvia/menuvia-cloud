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

// ─── Octeți tipăribili ──────────────────────────────────────────────────────
// Payload-ul conține text scris de OASPETE (notele comenzii QR, mig 227 le
// curăță doar de \r\n\t). Pe 9100 orice octet de control e o COMANDĂ:
// ESC p = deschide sertarul de bani, GS V = taie hârtia, ESC @ = reset. Iar
// vechiul `socket.end(text, 'binary')` trunchia fiecare caracter la octetul
// lui de jos: „ě” (U+011B) devenea 0x1B = ESC, „ȝ” (U+021D) 0x1D = GS, „„”
// (U+201E) 0x1E. Deci și un text inofensiv la vedere ajungea la imprimantă
// ca secvență de control. Regula de aici: după transliterare, singurul
// control păstrat e \n, iar setul de caractere depinde de canal (`charset`):
//   'ascii'   — 0x20–0x7E (transliterare pornită, implicit);
//   'latin1'  — + 0xA0–0xFF, pe 9100 cu transliterarea OPRITĂ (codepage-ul
//               imprimantei e configurarea instalatorului — amânat);
//   'unicode' — orice caracter tipăribil, pentru fișierul UTF-8 (cu sau
//               fără transliterare): un spooler care citea UTF-8 nu regresează.
// Tot ce nu încape devine '?', vizibil, nu dispare tăcut.
const PUNCT_MAP = {
  '\u201e': '"', '\u201c': '"', '\u201d': '"', '\u00ab': '"', '\u00bb': '"',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u2032': "'",
  '\u2013': '-', '\u2014': '-', '\u2212': '-', '\u2026': '...',
  '\u20ac': 'EUR', '\u00d7': 'x', '\u00a0': ' ', '\u2022': '*',
  // `·` e separatorul din ANTETUL fiecărui tichet (mig 227: „OSPATAR · MASA”).
  '\u00b7': '-', '\u2260': '!=',
};

function sanitizeForEscPos(text, { charset = 'ascii' } = {}) {
  let out = '';
  // NFC întâi: „s” + virgulă combinată devine „ș” precompus (altfel ieșea
  // „s?”). Singurul rând nou e \n (și CRLF): e separatorul pus de SQL între
  // rândurile tichetului. CR singur, NEL, LS, PS și tab devin SPAȚIU — mig 227
  // aplatizează notele pe un rând tocmai ca o notă de oaspete să nu poată
  // apărea pe tichet ca un rând separat, adică un produs comandat fals.
  const src = String(text)
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[\r\t\u0085\u2028\u2029]/g, ' ');
  for (const ch of src) {
    if (ch === '\n') { out += ch; continue; }
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) { out += ch; continue; }
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) continue; // C0, DEL, C1: aruncate
    if (charset === 'unicode') {
      // Fișier UTF-8: textul rămâne cum l-a scris omul; afară doar ce nu se
      // vede (formatare/bidi, separatori de rând, surogate, uz privat).
      out += /[\p{C}]/u.test(ch) ? '?' : ch;
      continue;
    }
    const mapped = PUNCT_MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    if (charset === 'latin1' && cp >= 0xa0 && cp <= 0xff) { out += ch; continue; }
    // Un semn diacritic rămas singur după NFC nu are literă de purtat.
    if (/\p{M}/u.test(ch)) continue;
    // Litere latine cu accent (é, ü, ő…): litera de bază — DOAR dacă e literă.
    // Altfel NFD scotea negația din „≠”/„≮” și inversa sensul notei (≠ → =).
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += /^[A-Za-z]+$/.test(base) ? base : '?';
  }
  return out;
}

// ESC/POS minimal: init + text + feed + full cut. Buffer EXPLICIT: textul e
// deja restrâns la ≤ 0xFF, deci latin1 e o codificare 1:1, nu o trunchiere.
const ESC_INIT = Buffer.from([0x1b, 0x40]);
const ESC_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const FEED = Buffer.from('\n\n\n', 'latin1');

// 9100: ASCII cu transliterarea pornită, latin1 cu ea oprită. Fișierul e
// UTF-8 pe AMBELE ramuri (ca înainte): transliterarea scoate doar
// diacriticele românești, restul textului tipăribil rămâne.
function ticketText(cfg, payload, channel) {
  const src = String(payload).normalize('NFC');
  const text = cfg.kitchen.transliterate ? transliterate(src) : src;
  if (channel === 'file') return sanitizeForEscPos(text, { charset: 'unicode' });
  return sanitizeForEscPos(text, { charset: cfg.kitchen.transliterate ? 'ascii' : 'latin1' });
}

function buildEscPos(cfg, payload) {
  return Buffer.concat([ESC_INIT, Buffer.from(ticketText(cfg, payload, 'tcp'), 'latin1'), FEED, ESC_CUT]);
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
      socket.end(bytes, () =>
        done({ success: true, errorCode: null, errorInfo: null }));
    });
  });
}

function printViaFile(cfg, ticket) {
  try {
    // Aceeași regulă ca pe 9100: un spooler RAW trimite fișierul ca atare.
    const text = ticketText(cfg, ticket.payload, 'file').replace(/\n/g, '\r\n');
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

module.exports = { printTicket, transliterate, sanitizeForEscPos, buildEscPos };
