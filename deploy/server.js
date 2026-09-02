#!/usr/bin/env node
'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// Menuvia VPS shim — rulează funcțiile Netlify NESCHIMBATE pe un server propriu.
//
//   • HTTP:  /.netlify/functions/<nume>  → require(netlify/functions/<nume>.js)
//            .handler(event) cu event/response în forma Lambda (httpMethod,
//            headers, body / statusCode, headers, body) — aceeași pe care o
//            primeau pe Netlify, deci ZERO modificări în funcții sau frontend.
//   • Cron:  programările sunt citite din netlify.toml (sursa de adevăr unică,
//            [functions."nume"] schedule = "...") și rulate cu un matcher
//            minimal de cron (minute + ore acoperă toate cele 5 joburi).
//
// Zero dependențe runtime proprii (funcțiile își au ale lor din package.json).
// Rulare:  node deploy/server.js         (PORT default 8788)
// Env:     prin systemd EnvironmentFile (vezi deploy/menuvia-functions.service)
// ═════════════════════════════════════════════════════════════════════════════

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.FUNCTIONS_PORT || 8788);
const REPO_ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = process.env.FUNCTIONS_DIR || path.join(REPO_ROOT, 'netlify', 'functions');
const NETLIFY_TOML = process.env.NETLIFY_TOML || path.join(REPO_ROOT, 'netlify.toml');

/**
 * Comparare constant-time a cheii de cron (anti timing attack; audit v3 SEC-09).
 * @param {unknown} a valoarea primită (header x-cron-key)
 * @param {unknown} b valoarea așteptată (CRON_TRIGGER_KEY)
 * @returns {boolean} true doar la egalitate exactă (lungime + bytes)
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  (level === 'ERROR' ? process.stderr : process.stdout).write(line + '\n');
}

// Erorile de funcții/cron ajung și în Slack (dacă SLACK_WEBHOOK_URL e setat) —
// error-tracking-ul de backend din Faza 1. Best-effort + rate-limit simplu
// (max 20/oră) ca un failure-loop să nu inunde canalul.
let slackCount = 0;
let slackWindowStart = Date.now();
function notifySlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const now = Date.now();
  if (now - slackWindowStart > 3600_000) {
    slackWindowStart = now;
    slackCount = 0;
  }
  if (++slackCount > 20) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `🔴 [menuvia-vps] ${text}`.slice(0, 2900) }),
  }).catch(() => {});
}

// ── Whitelist de funcții = fișierele .js din dir la pornire ─────────────────
const available = new Set(
  fs.readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3))
);
log('INFO', `Funcții disponibile (${available.size}): ${[...available].sort().join(', ')}`);

const handlers = new Map();
function getHandler(name) {
  if (!handlers.has(name)) {
    const mod = require(path.join(FUNCTIONS_DIR, name + '.js'));
    if (typeof mod.handler !== 'function') throw new Error(`${name}: lipsește exports.handler`);
    handlers.set(name, mod.handler);
  }
  return handlers.get(name);
}

// ── Cron: citește programările din netlify.toml ─────────────────────────────
// Format căutat:  [functions."nume"]\n  schedule = "expr"
function readSchedules(tomlPath) {
  const out = [];
  if (!fs.existsSync(tomlPath)) return out;
  const text = fs.readFileSync(tomlPath, 'utf8');
  const re = /\[functions\."([\w-]+)"\]\s*[\r\n]+\s*schedule\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ name: m[1], expr: m[2] });
  return out;
}

// Funcțiile cu schedule în netlify.toml sunt CRON-ONLY: la fel ca pe Netlify, NU
// trebuie invocabile prin HTTP public (altfel oricine ar putea declanșa joburi de
// sistem — dunning, payout, GDPR — de pe internet). Le blocăm pe suprafața HTTP;
// scheduler-ul intern le cheamă DIRECT (getHandler), neafectat. Escape pentru
// operator: header `x-cron-key` == env CRON_TRIGGER_KEY (declanșare manuală).
const scheduledOnly = new Set(readSchedules(NETLIFY_TOML).map((j) => j.name));
log('INFO', `Funcții cron-only (blocate pe HTTP public): ${[...scheduledOnly].sort().join(', ') || '(niciuna)'}`);

// Matcher minimal de cron pe câmpurile minute + oră (acoperă toate joburile
// Menuvia: */2, */5, */10, */15, "5,20,35,50"). Câmp: "*" | "*/n" | "a,b,c" | "n".
function fieldMatches(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const n = parseInt(field.slice(2), 10);
    return Number.isFinite(n) && n > 0 && value % n === 0;
  }
  return field.split(',').some((p) => parseInt(p, 10) === value);
}

function cronMatches(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  // dom/mon/dow: joburile Menuvia folosesc doar "*" — orice altceva e refuzat
  // explicit la pornire (fail-fast, nu silent-wrong).
  if (dom !== '*' || mon !== '*' || dow !== '*') {
    throw new Error(`Expresie cron nesuportată de shim: "${expr}" (doar minute/oră)`);
  }
  return fieldMatches(min, date.getMinutes()) && fieldMatches(hour, date.getHours());
}

// ── Plafon de invocare (audit aug 2026) ──────────────────────────────────────
// Netlify omoară handler-ele singur; shim-ul nu avea NICIUN plafon — un handler
// agățat ținea conexiunea HTTP la nesfârșit, iar pe cron bloca jobul PERMANENT
// prin anti-suprapunere (exact incidentul „cron mort tăcut", reprodus pe VPS).
// Race cu timeout: nu putem avorta cod arbitrar (fără worker threads), dar
// plafonul eliberează slotul de cron / conexiunea și face eșecul VIZIBIL.
const HTTP_INVOKE_TIMEOUT_MS = Number(process.env.HTTP_INVOKE_TIMEOUT_MS || 30_000);
const CRON_INVOKE_TIMEOUT_MS = Number(process.env.CRON_INVOKE_TIMEOUT_MS || 300_000);
function invokeWithTimeout(name, event, ms) {
  let timer;
  const gate = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`invocare peste ${ms}ms (plafon shim)`)),
      ms,
    );
    if (timer.unref) timer.unref();
  });
  return Promise.race([
    Promise.resolve().then(() => getHandler(name)(event)),
    gate,
  ]).finally(() => clearTimeout(timer));
}

function startScheduler() {
  const jobs = readSchedules(NETLIFY_TOML);
  for (const j of jobs) {
    if (!available.has(j.name)) {
      log('ERROR', `Cron pentru funcție inexistentă: ${j.name}`);
      continue;
    }
    cronMatches(j.expr, new Date()); // validare fail-fast a expresiei
    log('INFO', `Cron înregistrat: ${j.name} @ "${j.expr}"`);
  }
  let lastMinute = -1;
  const running = new Set();
  setInterval(async () => {
    const now = new Date();
    if (now.getMinutes() === lastMinute) return; // un singur tick pe minut
    lastMinute = now.getMinutes();
    for (const j of jobs) {
      if (!available.has(j.name) || !cronMatches(j.expr, now)) continue;
      if (running.has(j.name)) {
        log('ERROR', `Cron ${j.name}: rularea anterioară încă în curs — skip (anti-suprapunere)`);
        continue;
      }
      running.add(j.name);
      const t0 = Date.now();
      try {
        // Netlify scheduled functions primesc un event cu body JSON ({next_run}).
        const res = await invokeWithTimeout(j.name, {
          httpMethod: 'POST',
          headers: {},
          body: JSON.stringify({ next_run: null }),
          queryStringParameters: {},
          path: `/.netlify/functions/${j.name}`,
          isBase64Encoded: false,
        }, CRON_INVOKE_TIMEOUT_MS);
        log('INFO', `Cron ${j.name}: ${res && res.statusCode} în ${Date.now() - t0}ms`);
      } catch (err) {
        log('ERROR', `Cron ${j.name} a aruncat: ${err.message}`);
        notifySlack(`cron ${j.name}: ${err.message}`);
      } finally {
        running.delete(j.name);
      }
    }
  }, 5_000);
}

// ── HTTP: /.netlify/functions/* → handler ────────────────────────────────────
const FN_PREFIX = '/.netlify/functions/';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/__shim/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, functions: available.size }));
    return;
  }

  if (!url.pathname.startsWith(FN_PREFIX)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found (shim servește doar /.netlify/functions/*)');
    return;
  }
  const name = url.pathname.slice(FN_PREFIX.length).split('/')[0];
  if (!available.has(name)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Funcție necunoscută: ${name}`);
    return;
  }

  // Parity cu Netlify: funcțiile cron-only NU se invocă prin HTTP public. 404 (nu 403)
  // ca să nu confirmăm existența funcției. Escape operator: header x-cron-key valid.
  if (scheduledOnly.has(name)) {
    const key = req.headers['x-cron-key'];
    if (!process.env.CRON_TRIGGER_KEY || !safeEqual(key, process.env.CRON_TRIGGER_KEY)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Funcție necunoscută: ${name}`);
      return;
    }
  }

  // Corpul se citește RAW (Buffer) — semnătura Stripe se verifică pe bytes
  // nealterați; utf8 e ok cât timp nu-l re-serializăm.
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 10 * 1024 * 1024) req.destroy(); // guard 10MB
    else chunks.push(c);
  });
  req.on('end', async () => {
    const qs = {};
    for (const [k, v] of url.searchParams) qs[k] = v;
    const event = {
      httpMethod: req.method,
      path: url.pathname,
      headers: req.headers,
      queryStringParameters: qs,
      body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
      isBase64Encoded: false,
    };
    try {
      const out = (await invokeWithTimeout(name, event, HTTP_INVOKE_TIMEOUT_MS)) || {};
      const headers = out.headers || {};
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      res.writeHead(out.statusCode || 200, headers);
      res.end(
        out.isBase64Encoded ? Buffer.from(out.body || '', 'base64') : out.body || ''
      );
    } catch (err) {
      log('ERROR', `${name}: ${err.stack || err.message}`);
      notifySlack(`funcția ${name} a aruncat: ${err.message}`);
      // 504 pe plafon (distinct de 500 — operatorul vede „agățat", nu „crăpat").
      const timedOut = String(err.message || '').includes('plafon shim');
      res.writeHead(timedOut ? 504 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: timedOut ? 'Function timeout' : 'Internal error' }));
    }
  });
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    log('INFO', `Shim funcții pe http://127.0.0.1:${PORT} (dir: ${FUNCTIONS_DIR})`);
    startScheduler();
  });
}

module.exports = { server, cronMatches, readSchedules, fieldMatches };
