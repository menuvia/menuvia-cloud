'use strict';

// Client minimal PostgREST pentru RPC-urile bridge. Zero dependențe — folosim
// `fetch` global (Node 18+). Toate RPC-urile bridge (mig 030/045) au
// `grant execute ... to anon`, deci ne autentificăm doar cu anon key; drepturile
// reale vin din `device_secret` verificat în corpul fiecărei funcții.
async function rpc(cfg, fn, params) {
  const base = String(cfg.supabaseUrl).replace(/\/+$/, '');
  const url = `${base}/rest/v1/rpc/${fn}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: cfg.supabaseAnonKey,
          Authorization: `Bearer ${cfg.supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params || {}),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`RPC ${fn} rețea: ${err.message}`);
    }
    // Corpul se citește ÎN fereastra de timeout (altfel un corp care atârnă ar bloca).
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`RPC ${fn} → ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Scalarele (boolean) pot veni ca text brut `true`/`false`.
      if (text === 'true') return true;
      if (text === 'false') return false;
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

// Helper: RPC-urile care returnează `table(...)` întorc un array de rânduri;
// scoatem primul rând pentru funcțiile cu un singur rezultat.
function firstRow(rows) {
  if (Array.isArray(rows)) return rows[0] || null;
  return rows || null;
}

module.exports = { rpc, firstRow };
