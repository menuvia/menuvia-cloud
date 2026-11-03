// tests/functions/ui-hex-ratchet.test.js
// CLICHET: culorile panoului vin din token-urile `D` (src/lib/constants.ts),
// nu sunt scrise de mână (lotul V — consistență vizuală, nov 2026).
//
// Auditul a găsit ~400 de culori hex scrise direct în src/components și
// src/pages, fiecare cu propria idee despre „auriu", „roșu de eroare" sau
// „negru pe buton" (#000 pe auriu, #fff pe roșu cu 3.75:1 contrast…), plus
// ~110 sufixe de alfa lipite de un token (`${D.gold}44`): tokenul e
// `var(--color-gold, #C8963C)`, deci rezultatul e `var(...)44`, CSS invalid —
// browserul aruncă declarația și bordura/fundalul dispare TĂCUT.
//
//   HX0  CONTROL POZITIV pe surse SINTETICE: scannerul numără `'#fff'`,
//        `#C8963C`, `#c8963c80`, `${D.gold}44`, `D.red + '22'` și NU numără
//        `PR #335` dintr-un comentariu `//`, `{/* #abc */}`, `&#123;`,
//        `accept="image/*"` (nu deschide comentariu) sau `${D.gold}` simplu.
//        Fără el, un regex stricat ar face HX1–HX4 verzi pe orice cod.
//   HX1  numărul de culori hex din src/components + src/pages, FĂRĂ fișierele
//        din registrul EXEMPT, nu crește peste HEX_CEILING (înghețat după lotul
//        V: 249 → 191). Mutația care îl pică: adaugi `color: '#123456'` în orice
//        fișier din panou care nu e în registru (ex. BridgeTab.tsx).
//   HX2  ecranele migrate în lotul V (MIGRATED) au ZERO hex, ZERO rgb()/hsl()
//        scrise de mână și ZERO sufixe de alfa pe token. Mutația care îl pică:
//        readuci `color: '#000'` sau `${D.gold}44` în KitchenPage.tsx.
//   HX3  registrul e ONEST: fiecare scutire există și chiar conține culori hex
//        (o scutire care nu mai acoperă nimic pică — tiparul PR2/DC1b), iar
//        niciun fișier migrat nu e scutit.
//   HX4  sufixele de alfa pe token nu cresc peste ALPHA_CEILING (110 → 81).
//        Mutația care îl pică: `border: \`1px solid ${D.amber}55\`` nou în
//        orice fișier din panou.
//
// Rulează în jobul „Bridge tests" (`cd tests/functions && npm test`).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, uiFiles, read, hexColors, fnColors, alphaSuffixes } = require('./helpers/uiSourceScan')

const HEX_CEILING = 191
const ALPHA_CEILING = 81

// Scutiri PE FIȘIER, fiecare cu motivul ei. Meniul oaspetelui are paleta lui
// (temele PUB din lib/themes, culoarea de accent a restaurantului), nu pe a
// panoului — acolo hex-urile sunt designul ales de restaurant, nu o abatere.
const GUEST = 'meniul oaspetelui: paleta temelor PUB / accentul restaurantului, nu tokenii panoului'
const EXEMPT = [
  { file: 'src/pages/QrMenuPage.tsx', reason: GUEST },
  { file: 'src/pages/PublicMenuPage.tsx', reason: GUEST },
  { file: 'src/pages/ReservePage.tsx', reason: GUEST },
  { file: 'src/components/QrCartSheet.tsx', reason: GUEST },
  { file: 'src/components/ProductSheet.tsx', reason: GUEST },
  { file: 'src/components/OrderTracker.tsx', reason: GUEST },
  { file: 'src/components/PayTableSheet.tsx', reason: GUEST },
  { file: 'src/components/SplitBillSheet.tsx', reason: GUEST },
  { file: 'src/components/PaymentConfirmedScreen.tsx', reason: GUEST },
  { file: 'src/components/OrderClosedScreen.tsx', reason: GUEST },
  { file: 'src/components/menu/FlipbookViewer.tsx', reason: GUEST },
  { file: 'src/components/menu/FloorPlanViewer.tsx', reason: GUEST },
  { file: 'src/components/menu/MenuHeader.tsx', reason: GUEST },
  { file: 'src/components/menu/ProductGridCard.tsx', reason: GUEST },
  { file: 'src/components/menu/ProductPhotoCard.tsx', reason: GUEST },
  {
    file: 'src/pages/DemoPage.tsx',
    reason: 'demonstrația publică a meniului oaspetelui (aceeași paletă de temă)',
  },
  {
    file: 'src/components/menu/MenuPreview.tsx',
    reason: 'previzualizarea temei din Setări: randează culorile temei alese, nu ale panoului',
  },
]

// Ecranele migrate în lotul V + primitivele: la ZERO, verificat separat.
const MIGRATED = [
  'src/components/_dashboard/HomeTab.tsx',
  'src/components/ProductsTab.tsx',
  'src/components/SettingsTab.tsx',
  'src/components/TablesManager.tsx',
  'src/pages/WaiterPage.tsx',
  'src/pages/KitchenPage.tsx',
  'src/components/_dashboard/ProductsToolbar.tsx',
  'src/components/_dashboard/PlanUpsellCard.tsx',
  'src/components/_dashboard/SubscriptionCard.tsx',
  'src/components/_dashboard/sharedUI.tsx',
  'src/components/ui/Button.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/PageHeader.tsx',
]

const exempt = new Set(EXEMPT.map((e) => e.file))

describe('clichet: culorile panoului vin din token-urile D', () => {
  it('HX0 control pozitiv: scannerul numără culorile scrise de mână și sare comentariile', () => {
    const caught = [
      "const a = { color: '#fff' }",
      'const b = `1px solid #C8963C`',
      "const c = '#c8963c80'",
      'const d = `1px solid ${D.gold}44`',
      "const e = D.red + '22'",
    ].join('\n')
    assert.equal(hexColors(caught).length, 3)
    assert.equal(alphaSuffixes(caught).length, 2)
    assert.equal(fnColors("background: 'rgba(0,0,0,0.75)', color: 'hsl(1,2%,3%)'").length, 2)
    const ignored = [
      '// recenzia pe PR #335 (#abc) — comentariu',
      '{/* culoarea #abc stătea aici */}',
      ' * #fff într-un comentariu de bloc',
      '<input accept="image/*" />',
      "const x = '#fff'",
      '/* bloc',
      '   pe mai multe rânduri #000',
      '*/',
      'const amp = "&#123;"',
      'const ok = `1px solid ${D.gold}`',
    ].join('\n')
    // Singurul hex numărat e cel din codul de după `image/*` — dovadă că
    // `image/*` nu a deschis un comentariu care să-l ascundă.
    assert.deepEqual(hexColors(ignored), ['#fff'])
    assert.deepEqual(alphaSuffixes(ignored), [])
  })

  it(`HX1 culorile hex din panou (fără scutiri) nu cresc peste ${HEX_CEILING}`, () => {
    const per = uiFiles()
      .filter((f) => !exempt.has(f))
      .map((f) => ({ f, n: hexColors(read(f)).length }))
      .filter((x) => x.n > 0)
    const total = per.reduce((s, x) => s + x.n, 0)
    // Anti-vacuitate: scannerul chiar vede fișiere cu culori (altfel 0 ≤ plafon
    // ar trece și cu o listă de fișiere goală).
    assert.ok(per.length > 20, `scannerul a văzut doar ${per.length} fișiere cu hex`)
    assert.ok(
      total <= HEX_CEILING,
      `${total} culori hex scrise de mână în panou (plafon ${HEX_CEILING}). Folosește un ` +
        'token din `D` (src/lib/constants.ts) — adaugă-l acolo, cu valoarea în D_RAW și ' +
        'în tokens.css, dacă lipsește. Fișierele cu cele mai multe: ' +
        per
          .sort((a, b) => b.n - a.n)
          .slice(0, 5)
          .map((x) => `${x.f} (${x.n})`)
          .join(', '),
    )
  })

  it('HX2 ecranele migrate în lotul V au zero hex, zero rgb()/hsl() și zero sufixe de alfa', () => {
    const bad = []
    for (const f of MIGRATED) {
      const src = read(f)
      for (const h of hexColors(src)) bad.push(`${f}: hex ${h}`)
      for (const h of fnColors(src)) bad.push(`${f}: ${h}…)`)
      for (const h of alphaSuffixes(src)) bad.push(`${f}: sufix de alfa ${h}`)
    }
    assert.deepEqual(bad, [], 'Culoare scrisă de mână într-un ecran migrat — folosește un token din `D`.')
  })

  it('HX3 registrul de scutiri e onest', () => {
    for (const e of EXEMPT) {
      assert.ok(fs.existsSync(path.join(ROOT, e.file)), `scutirea ${e.file} nu mai există — scoate-o`)
      assert.ok(e.reason.length > 10, `scutirea ${e.file} n-are motiv`)
      assert.ok(
        hexColors(read(e.file)).length > 0,
        `scutirea ${e.file} nu mai acoperă nicio culoare hex — scoate-o`,
      )
      assert.ok(!MIGRATED.includes(e.file), `${e.file} e migrat — nu poate fi scutit`)
    }
  })

  it(`HX4 sufixele de alfa lipite de token (CSS invalid) nu cresc peste ${ALPHA_CEILING}`, () => {
    const total = uiFiles().reduce((s, f) => s + alphaSuffixes(read(f)).length, 0)
    assert.ok(total > 0, 'anti-vacuitate: scannerul nu mai vede niciun sufix de alfa')
    assert.ok(
      total <= ALPHA_CEILING,
      `${total} sufixe de alfa pe token (plafon ${ALPHA_CEILING}): \`\${D.gold}44\` dă ` +
        '`var(...)44`, CSS invalid. Folosește D.goldBorder / D.goldA / D.redBorder / ' +
        'D.amberBorder / D.greenBorder sau `color-mix(in srgb, ${culoare} N%, transparent)`.',
    )
  })
})
