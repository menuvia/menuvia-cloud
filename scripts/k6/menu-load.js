// k6 — load test pe calea cea mai fierbinte: meniul public (Faza 2 / PLAN_10).
// Criteriu: 100 utilizatori concurenți, p95 < 1s pe shell + pe datele meniului.
//
// Rulare (k6 instalat local sau docker):
//   k6 run -e BASE_URL=https://deploy-preview-182--menuvia.netlify.app scripts/k6/menu-load.js
//   k6 run -e BASE_URL=https://menuvia.ro \
//          -e SUPABASE_URL=https://<ref>.supabase.co -e SUPABASE_ANON_KEY=<anon> \
//          scripts/k6/menu-load.js
//
// Fără SUPABASE_URL/ANON_KEY testează doar shell-ul static; cu ele, lovește și
// RPC-ul real de meniu (get_restaurant_by_slug pe 'tinctura') — adică exact ce
// execută telefonul unui client la scanarea QR-ului.
// NB: rulează pe preview/staging, nu pe prod în orele de vârf ale localurilor.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4173';
const SUPABASE_URL = __ENV.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';
const SLUG = __ENV.MENU_SLUG || 'tinctura';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '1m', target: 100 },
        { duration: '2m', target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:shell}': ['p(95)<1000'],
    'http_req_duration{kind:menu-data}': ['p(95)<1000'],
  },
};

export default function () {
  // 1. Shell-ul SPA (ce încarcă browserul la /m/:slug)
  const shell = http.get(`${BASE_URL}/m/${SLUG}`, { tags: { kind: 'shell' } });
  check(shell, { 'shell 200': (r) => r.status === 200 });

  // 2. Datele meniului (RPC-ul public pe care îl face clientul)
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const data = http.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_restaurant_by_slug`,
      JSON.stringify({ p_slug: SLUG }),
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        tags: { kind: 'menu-data' },
      }
    );
    check(data, { 'menu-data 200': (r) => r.status === 200 });
  }

  sleep(Math.random() * 2 + 1); // gând de client real: 1-3s între acțiuni
}
