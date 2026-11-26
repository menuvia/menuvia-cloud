// tests/functions/sitemap.test.js
// Sitemap-ul listează meniul în FIECARE limbă oferită (lotul C8e), cu aceeași
// regulă de adrese ca `useMenuSeo` pe pagină (src/lib/menuSeo.ts): limba de
// bază pe `/m/:slug` (și `x-default`), celelalte pe `/m/:slug?lang=xx`.
//
//   STM1  local român cu `menu_languages` = [de, en]: trei <url> (bază, en, de
//         — ordinea MENU_LANGS, nu a setării), fiecare cu toate cele patru
//         `xhtml:link hreflang` (ro, en, de, x-default) și namespace-ul xhtml.
//         [PICĂ: sitemap-ul de dinainte — un singur URL, fără alternative]
//   STM2  baza e `restaurants.language`, nu româna: local francez cu [ro, fr]
//         → `/m/slug` e `fr`, româna e `?lang=ro`, iar baza NU apare și ca
//         `?lang=fr`. [PICĂ: bază fixă 'ro']
//   STM3  control POZITIV de compatibilitate: fără limbi în plus (listă goală,
//         null, coduri necunoscute, doar baza) → exact un URL, fără
//         `xhtml:link`; paginile statice și /rezervare/:slug neschimbate.
//   STM4  interogarea cere `language` și `menu_languages` (fake-ul întoarce
//         orice rând — fără acest pin, un select care nu le mai cere ar trece
//         cu toate meniurile pe un singur URL).
//
// Rulează în jobul „Bridge tests" (vitest nu vede tests/functions).
'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { state, resetMocks, loadFunction, opArg } = require('./helpers/mocks')

const REL = 'netlify/functions/sitemap.js'
const BASE = 'https://meniu.example'

const saved = {}
beforeEach(() => {
  resetMocks()
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'URL', 'VITE_APP_URL']) saved[k] = process.env[k]
  Object.assign(process.env, { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', URL: BASE })
  delete process.env.VITE_APP_URL
})
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function withRestaurants(rows, reservationsFor = []) {
  state.fromHandlers.restaurants = () => ({ data: rows, error: null })
  state.fromHandlers.restaurant_modules = () => ({
    data: reservationsFor.map((id) => ({ restaurant_id: id })),
    error: null,
  })
}

// Blocurile <url>…</url> ale corpului, cu loc-ul și hreflang-urile lor.
function entries(body) {
  return [...body.matchAll(/<url><loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: m[1],
    links: [...m[2].matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map(
      (l) => `${l[1]}=${l[2]}`,
    ),
  }))
}

describe('sitemap: meniul în fiecare limbă oferită (C8e)', () => {
  it('STM1: bază + câte un URL ?lang= per limbă, toate cu alternativele complete', async () => {
    withRestaurants([{ id: 'r1', slug: 'bistro', language: 'ro', menu_languages: ['de', 'en'] }])
    const res = await loadFunction(REL).handler({})
    assert.equal(res.statusCode, 200)
    assert.match(res.body, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/)
    const menu = entries(res.body).filter((e) => e.loc.includes('/m/'))
    assert.deepEqual(
      menu.map((e) => e.loc),
      [`${BASE}/m/bistro`, `${BASE}/m/bistro?lang=en`, `${BASE}/m/bistro?lang=de`],
    )
    const expected = [
      `ro=${BASE}/m/bistro`,
      `en=${BASE}/m/bistro?lang=en`,
      `de=${BASE}/m/bistro?lang=de`,
      `x-default=${BASE}/m/bistro`,
    ]
    for (const e of menu) assert.deepEqual(e.links, expected, e.loc)
  })

  it('STM2: baza e limba localului — francez cu română în plus', async () => {
    withRestaurants([{ id: 'r1', slug: 'chez-nous', language: 'fr', menu_languages: ['ro', 'fr'] }])
    const res = await loadFunction(REL).handler({})
    const menu = entries(res.body).filter((e) => e.loc.includes('/m/'))
    assert.deepEqual(
      menu.map((e) => e.loc),
      [`${BASE}/m/chez-nous`, `${BASE}/m/chez-nous?lang=ro`],
    )
    assert.deepEqual(menu[0].links, [
      `fr=${BASE}/m/chez-nous`,
      `ro=${BASE}/m/chez-nous?lang=ro`,
      `x-default=${BASE}/m/chez-nous`,
    ])
    assert.equal(res.body.includes('?lang=fr'), false, 'baza nu are adresă ?lang= proprie')
  })

  it('STM3 (control): fără limbi în plus — un singur URL, fără alternative; restul neschimbat', async () => {
    withRestaurants(
      [
        { id: 'r1', slug: 'a', language: 'ro', menu_languages: [] },
        { id: 'r2', slug: 'b', language: null, menu_languages: null },
        { id: 'r3', slug: 'c', language: 'xx', menu_languages: ['pl', 'ro'] },
      ],
      ['r2'],
    )
    const res = await loadFunction(REL).handler({})
    assert.equal(res.body.includes('<xhtml:link'), false)
    const locs = entries(res.body).map((e) => e.loc)
    for (const p of ['/', '/en', '/pricing', '/rezervari']) assert.ok(locs.includes(`${BASE}${p}`), p)
    assert.deepEqual(
      locs.filter((l) => l.includes('/m/') || l.includes('/rezervare/')),
      [`${BASE}/m/a`, `${BASE}/m/b`, `${BASE}/rezervare/b`, `${BASE}/m/c`],
    )
  })

  it('STM4: interogarea cere limba de bază și limbile meniului', async () => {
    withRestaurants([])
    await loadFunction(REL).handler({})
    const call = state.fromCalls.find((c) => c.table === 'restaurants')
    assert.ok(call, 'restaurants neinterogat')
    const cols = String(opArg(call.ops, 'select'))
      .split(',')
      .map((c) => c.trim())
    for (const col of ['id', 'slug', 'language', 'menu_languages']) assert.ok(cols.includes(col), col)
  })
})
