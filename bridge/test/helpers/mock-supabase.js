'use strict';

const http = require('node:http');

// ─────────────────────────────────────────────────────────────────────────────
// Mock PostgREST pentru RPC-urile bridge (mig 030 + 045). Reproduce formele de
// răspuns reale: funcțiile `returns table(...)` → array de obiecte; `returns
// boolean` → boolean brut. Ține stare configurabilă și înregistrează fiecare
// `bridge_confirm_receipt` pentru asserții.
// ─────────────────────────────────────────────────────────────────────────────

function createMockSupabase(opts = {}) {
  const state = {
    device: opts.device || { device_id: 'dev-1', restaurant_id: 'rest-1', restaurant_name: 'Test SRL' },
    pending: (opts.pending || []).slice(),
    claimedIds: new Set(),
    unclaimableIds: new Set(opts.unclaimableIds || []), // simulează bon luat de alt bridge
    confirms: [],
    heartbeats: 0,
    calls: [],
  };

  const server = http.createServer((req, res) => {
    const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(req.url || '');
    if (!m) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const fn = m[1];
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let params = {};
      try {
        params = body ? JSON.parse(body) : {};
      } catch {
        /* body invalid — lăsăm params gol */
      }
      state.calls.push({ fn, params });
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };

      switch (fn) {
        case 'bridge_validate_device':
          return reply([state.device]);
        case 'bridge_heartbeat':
          state.heartbeats += 1;
          return reply([{ device_id: state.device.device_id, restaurant_id: state.device.restaurant_id, ok: true }]);
        case 'bridge_get_pending':
          return reply(state.pending);
        case 'bridge_claim_receipt': {
          const id = params.p_receipt_id;
          if (state.unclaimableIds.has(id) || state.claimedIds.has(id)) return reply(false);
          state.claimedIds.add(id);
          return reply(true);
        }
        case 'bridge_confirm_receipt':
          state.confirms.push(params);
          return reply(true);
        default:
          res.writeHead(400);
          res.end(JSON.stringify({ message: `RPC necunoscut în mock: ${fn}` }));
      }
    });
  });

  return { server, state };
}

module.exports = { createMockSupabase };
