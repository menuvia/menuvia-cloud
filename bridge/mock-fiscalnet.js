#!/usr/bin/env node
'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// Mock FiscalNet — server HTTP care imită API-ul BonLocal (POST /api/receipt)
// pentru testare fără casă de marcat reală. Exact abordarea sugerată de EconMedia:
// „un simulator care validează comanda ca format".
//
// Comportament:
//   • primește un JSON array de linii `^`-delimitate;
//   • dacă vreo linie conține FAIL_PAPER  → BONOK=0 / PAPER_OUT;
//   • dacă vreo linie conține FAIL_OFFLINE → nu răspunde deloc (simulează casă moartă);
//   • altfel → BONOK=1 cu NRBON incremental.
//   • ?format=text → răspuns text (BONOK=1\nNRBON=…) ca la transportul pe fișiere.
//
// Rulare:  node mock-fiscalnet.js         (port 65400, ca FiscalNet real)
//          MOCK_PORT=8080 node mock-fiscalnet.js
// ═════════════════════════════════════════════════════════════════════════════

const http = require('node:http');

function createServer(opts = {}) {
  let counter = Number(opts.startBon || process.env.MOCK_START_BON || 1000);

  return http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed — folosește POST /api/receipt');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy(); // guard anti-flood
    });
    req.on('end', () => {
      let lines;
      try {
        lines = JSON.parse(body);
        if (!Array.isArray(lines)) throw new Error('body nu e un array JSON de linii');
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ BONOK: 0, ERRCODE: 'BAD_REQUEST', ERRINFO: err.message }));
        return;
      }

      const joined = lines.join('\n');
      const wantText = /[?&]format=text/.test(req.url || '');

      if (joined.includes('FAIL_OFFLINE')) {
        process.stdout.write(`[mock-fiscalnet] ${lines.length} linii → simulez casă offline (fără răspuns)\n`);
        return; // nu răspundem — clientul va da timeout
      }

      let result;
      if (joined.includes('FAIL_PAPER')) {
        result = { BONOK: 0, ERRCODE: 'PAPER_OUT', ERRINFO: 'Hârtia s-a terminat' };
      } else {
        counter += 1;
        result = { BONOK: 1, NRBON: counter };
      }

      process.stdout.write(`[mock-fiscalnet] ${lines.length} linii → ${JSON.stringify(result)}\n`);

      if (wantText) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(
          result.BONOK === 1
            ? `BONOK=1\nNRBON=${result.NRBON}`
            : `BONOK=0\nERRCODE=${result.ERRCODE}\nERRINFO=${result.ERRINFO}`
        );
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || 65400);
  createServer().listen(port, () => {
    process.stdout.write(`[mock-fiscalnet] ascult pe http://localhost:${port}/api/receipt\n`);
  });
}

module.exports = { createServer };
