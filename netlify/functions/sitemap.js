// netlify/functions/sitemap.js
// Sitemap dinamic (/sitemap.xml prin redirect din netlify.toml) — treapta 2
// a ecosistemului Google (docs/GOOGLE_REZERVARI.md): fiecare meniu public
// (/m/:slug) și fiecare pagină de rezervare (/rezervare/:slug, DOAR unde
// modulul reservations e activ — altfel Google ar indexa pagini care refuză)
// devin indexabile în momentul în care domeniul intră în Search Console.
//
// Baza URL: process.env.URL (Netlify o setează la domeniul PRIMAR al site-ului
// — devine automat https://menuvia.ro când domeniul e configurat, zero cod).
//
// Meniul în mai multe limbi (lotul C8e): fiecare limbă OFERITĂ în setări
// (`restaurants.menu_languages`) are adresa ei, `/m/:slug?lang=xx`, iar limba de
// BAZĂ (`restaurants.language`) rămâne pe `/m/:slug` (și `x-default`). Fiecare
// adresă își listează alternativele prin `xhtml:link hreflang` — aceeași regulă
// ca `useMenuSeo` (src/lib/menuSeo.ts) pe pagină. Rezidual consemnat: pagina
// oferă doar limbile în care meniul CHIAR e tradus (`availableMenuLangs`, din
// conținut), pe care sitemap-ul nu le vede fără să citească tot catalogul; o
// limbă bifată dar netradusă apare aici, iar pagina ei se declară canonic pe
// bază — Google o tratează ca duplicat, nu ca eroare.

const { createClient } = require('@supabase/supabase-js')
const { appUrl, LEGACY_NETLIFY_URL } = require('./lib/appUrl')

// Paginile de marketing statice — doar cele publice și stabile.
// Limbile meniului, în ordinea din src/lib/i18nMenu.ts (MENU_LANGS; CHECK-ul
// din mig 298 are aceleași 7).
const MENU_LANGS = ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es']

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

/** Limba de bază + limbile oferite în plus (fără bază, ordinea MENU_LANGS). */
function menuLangsOf(r) {
  const base = MENU_LANGS.includes(r.language) ? r.language : 'ro'
  const offered = Array.isArray(r.menu_languages) ? r.menu_languages : []
  return { base, extra: MENU_LANGS.filter((c) => c !== base && offered.includes(c)) }
}

/** Intrările meniului unui restaurant: una per limbă, cu alternativele lor. */
function menuEntries(base, r) {
  const root = `${base}/m/${r.slug}`
  const { base: baseLang, extra } = menuLangsOf(r)
  if (extra.length === 0) return [{ loc: root }]
  const alternates = [
    { hreflang: baseLang, href: root },
    ...extra.map((c) => ({ hreflang: c, href: `${root}?lang=${c}` })),
    { hreflang: 'x-default', href: root },
  ]
  return [root, ...extra.map((c) => `${root}?lang=${c}`)].map((loc) => ({ loc, alternates }))
}

function urlXml(entry) {
  const links = (entry.alternates || [])
    .map((a) => `\n    <xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`)
    .join('')
  return links
    ? `  <url><loc>${esc(entry.loc)}</loc>${links}\n  </url>`
    : `  <url><loc>${esc(entry.loc)}</loc></url>`
}

exports.handler = async () => {
  // Cheile + fallback-ul de dinainte, EXACT: `URL` (domeniul primar Netlify)
  // → VITE_APP_URL → menuvia.netlify.app.
  const base = appUrl({ keys: ['URL', 'VITE_APP_URL'], fallback: LEGACY_NETLIFY_URL })

  const urls = STATIC_PATHS.map((p) => ({ loc: `${base}${p}` }))

  // Restaurantele active — fără date sensibile: doar slug-ul și limbile
  // meniului, deja publice prin design (proiecția get_restaurant_by_slug, mig
  // 148→217; `menu_languages` din 219, `language` din 298).
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      // `language` + `menu_languages`: adresele `?lang=` ale meniului (C8e).
      .select('id, slug, language, menu_languages')
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
      urls.push(...menuEntries(base, r))
      if (withReservations.has(r.id)) urls.push({ loc: `${base}/rezervare/${r.slug}` })
    }
  } catch (e) {
    // Fail-open pe partea dinamică: un blip de DB nu face sitemap-ul 500 —
    // servim măcar paginile statice (Google re-crawlează oricum).
    console.error('[sitemap] dynamic part failed:', e?.message)
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.map(urlXml).join('\n') +
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
