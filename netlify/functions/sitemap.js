// netlify/functions/sitemap.js
// Sitemap dinamic (/sitemap.xml prin redirect din netlify.toml) — treapta 2
// a ecosistemului Google (docs/GOOGLE_REZERVARI.md): fiecare meniu public
// (/m/:slug) și fiecare pagină de rezervare (/rezervare/:slug, DOAR unde
// modulul reservations e activ — altfel Google ar indexa pagini care refuză)
// devin indexabile în momentul în care domeniul intră în Search Console.
//
// Baza URL: process.env.URL (Netlify o setează la domeniul PRIMAR al site-ului
// — devine automat https://menuvia.ro când domeniul e configurat, zero cod).

const { createClient } = require('@supabase/supabase-js')

// Paginile de marketing statice — doar cele publice și stabile.
const STATIC_PATHS = [
  '/', '/en', '/pricing', '/rezervari', '/codvia',
  '/hoteluri', '/terase', '/cafenele',
  '/comparatie', '/case-de-marcat', '/recrutare',
]

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

exports.handler = async () => {
  const base = (process.env.URL || process.env.VITE_APP_URL || 'https://menuvia.netlify.app')
    .replace(/\/+$/, '')

  const urls = STATIC_PATHS.map((p) => `${base}${p}`)

  // Restaurantele active — fără date sensibile: doar slug-urile, care sunt
  // deja publice prin design (proiecția get_restaurant_by_slug, mig 148→217).
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, slug')
      .eq('is_active', true)
      .not('slug', 'is', null)
      .limit(5000)
    if (error) throw error

    const ids = (restaurants || []).map((r) => r.id)
    // Modulul reservations per restaurant — /rezervare/:slug intră în sitemap
    // DOAR unde e pornit. .in() se face în FELII de 200 (audit aug 2026: cu
    // mii de UUID-uri, un singur .in() depășește limita de lungime a URL-ului
    // PostgREST și pica tăcut pe fail-open, golind paginile de rezervare).
    const withReservations = new Set()
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data: mods } = await supabase
        .from('restaurant_modules')
        .select('restaurant_id')
        .eq('module_key', 'reservations')
        .eq('enabled', true)
        .in('restaurant_id', chunk)
      for (const m of mods || []) withReservations.add(m.restaurant_id)
    }

    for (const r of restaurants || []) {
      urls.push(`${base}/m/${r.slug}`)
      if (withReservations.has(r.id)) urls.push(`${base}/rezervare/${r.slug}`)
    }
  } catch (e) {
    // Fail-open pe partea dinamică: un blip de DB nu face sitemap-ul 500 —
    // servim măcar paginile statice (Google re-crawlează oricum).
    console.error('[sitemap] dynamic part failed:', e?.message)
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n'

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // O oră de cache pe CDN — sitemap-ul nu are nevoie de real-time.
      'Cache-Control': 'public, max-age=3600',
    },
    body,
  }
}
