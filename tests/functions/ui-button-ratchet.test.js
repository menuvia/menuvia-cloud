// tests/functions/ui-button-ratchet.test.js
// CLICHET: butoanele de acțiune ale panoului sunt <Button> (src/components/ui/
// Button.tsx), nu <button style={…}> colorate de mână (lotul V, nov 2026).
//
// Auditul a găsit 666 de `<button style=…>` în src/components + src/pages și un
// singur fișier care importa `ui/Button`: fiecare ecran își alegea înălțimea
// (32/36/40/44/48), raza (6/7/8/9/10), auriul cu text #000 sau D.bg, roșul cu
// #fff la 3.75:1. Primitiva dă variantele (primary/secondary/ghost/danger),
// înălțimea minimă `--tap-min`, focusul vizibil, `type="button"` și starea
// `loading` (fără dublu-submit) dintr-un singur loc.
//
//   BT0  CONTROL POZITIV pe surse SINTETICE: numără `<button style=` pe un rând,
//        forma pe mai multe rânduri (atributul `style` după `onClick={() => a > b}`,
//        al cărui `>` NU închide tagul) și `<button\n style={btn()}>`; NU numără
//        `<Button style=…>`, `<button className=…>`, un `style` aflat pe un COPIL
//        al butonului sau un `<button style>` dintr-un comentariu.
//   BT1  totalul nu crește peste BUTTON_CEILING (înghețat după lotul V:
//        666 → 610). Mutația care îl pică: un `<button style={{…}}>` nou în
//        orice fișier din panou.
//   BT2  ecranele migrate în lotul V au plafon PROPRIU (ce a rămas acolo sunt
//        comutatoare/plăci de selecție/rânduri de listă, nu acțiuni). Mutația
//        care îl pică: readuci butonul „Salvează" ca `<button style={btn(…)}>`
//        în SettingsTab, chiar dacă alt fișier a scăzut între timp.
//   BT3  primitiva rămâne sursa unică: Button.tsx are cele patru variante,
//        `type = 'button'` implicit și `loading` care dezactivează butonul; iar
//        ecranele migrate chiar o importă (fără asta, ștergerea primitivei ar
//        lăsa BT1 verde).
//   BT4  CONTROL POZITIV pe surse SINTETICE pentru BT5 (recenzia #336): numără
//        `<Button style={{ background: … }}>`, forma pe mai multe rânduri (cu
//        `onClick={() => a > b}` înaintea lui `style`) și fiecare cheie de culoare
//        sau chenar (`background`, `backgroundColor`, `color`, `border`,
//        `borderColor`, `boxShadow`); NU numără `style` de LAYOUT pe <Button>,
//        `style` cu culoare pe un COPIL (`icon={<Icon style={{ color }} />}`),
//        `<button style>` (e al lui BT1), `<ButtonGroup>` sau un comentariu.
//   BT5  `<Button>` nu primește culori/chenar prin `style` — varianta le dă.
//        Plafon 0 pe ecranele migrate și total înghețat la COLORED_CEILING (0
//        după repararea lui SettingsTab, unde „Șterge” de pe copertă avea
//        `background: D.overlay` — fundal translucid peste varianta opacă).
//        Mutația care îl pică: readuci acel `background` (verificat).
//
// Rulează în jobul „Bridge tests" (`cd tests/functions && npm test`).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { uiFiles, read, styledButtons, coloredButtons } = require('./helpers/uiSourceScan')

const BUTTON_CEILING = 610
const COLORED_CEILING = 0

const MIGRATED_CEILINGS = {
  'src/components/_dashboard/HomeTab.tsx': 3,
  'src/components/ProductsTab.tsx': 27,
  'src/components/_dashboard/ProductsToolbar.tsx': 2,
  'src/components/SettingsTab.tsx': 5,
  'src/components/TablesManager.tsx': 3,
  'src/pages/WaiterPage.tsx': 3,
  'src/pages/KitchenPage.tsx': 0,
  'src/components/_dashboard/PlanUpsellCard.tsx': 0,
  'src/components/_dashboard/SubscriptionCard.tsx': 0,
}

describe('clichet: butoanele panoului sunt <Button>', () => {
  it('BT0 control pozitiv: scannerul prinde butoanele stilizate și le lasă pe cele legitime', () => {
    const caught = [
      '<button style={{ color: D.t1 }}>A</button>',
      '<button',
      '  type="button"',
      '  onClick={() => setOpen(a > b)}',
      '  style={btn({ background: D.gold })}',
      '>',
      '  B',
      '</button>',
      '<button',
      '  style={x}>C</button>',
    ].join('\n')
    assert.equal(styledButtons(caught), 3)
    const fine = [
      '<Button variant="primary" style={{ flex: 1 }}>A</Button>',
      '<button className="btn btn--secondary">B</button>',
      '<button onClick={f}>',
      '  <span style={{ color: D.t2 }}>C</span>',
      '</button>',
      '// <button style={{}}> într-un comentariu',
      '{/* <button style={{}}> într-un comentariu JSX */}',
    ].join('\n')
    assert.equal(styledButtons(fine), 0)
  })

  it(`BT1 butoanele stilizate de mână nu cresc peste ${BUTTON_CEILING}`, () => {
    const per = uiFiles()
      .map((f) => ({ f, n: styledButtons(read(f)) }))
      .filter((x) => x.n > 0)
    const total = per.reduce((s, x) => s + x.n, 0)
    assert.ok(per.length > 30, `anti-vacuitate: doar ${per.length} fișiere cu butoane stilizate`)
    assert.ok(
      total <= BUTTON_CEILING,
      `${total} butoane <button style=…> (plafon ${BUTTON_CEILING}). Folosește <Button ` +
        'variant="primary|secondary|ghost|danger" size="sm|md"> din src/components/ui/Button; ' +
        '`style` pe <Button> rămâne pentru layout. Cele mai multe: ' +
        per
          .sort((a, b) => b.n - a.n)
          .slice(0, 5)
          .map((x) => `${x.f} (${x.n})`)
          .join(', '),
    )
  })

  it('BT2 ecranele migrate nu primesc butoane stilizate noi', () => {
    const over = Object.entries(MIGRATED_CEILINGS)
      .map(([f, max]) => ({ f, max, n: styledButtons(read(f)) }))
      .filter((x) => x.n > x.max)
      .map((x) => `${x.f}: ${x.n} > ${x.max}`)
    assert.deepEqual(over, [], 'Buton stilizat de mână într-un ecran migrat — folosește <Button>.')
  })

  it('BT3 primitiva e sursa unică și ecranele migrate o folosesc', () => {
    const src = read('src/components/ui/Button.tsx')
    assert.match(src, /'primary' \| 'secondary' \| 'ghost' \| 'danger'/)
    assert.match(src, /type = 'button'/)
    assert.match(src, /disabled=\{disabled \|\| loading\}/)
    // HomeTab nu are butoane de acțiune proprii (doar rânduri de listă și
    // acțiuni rapide-card), deci nu e cerut aici; folosește Card + PageHeader.
    for (const f of Object.keys(MIGRATED_CEILINGS).filter((x) => !x.endsWith('HomeTab.tsx'))) {
      assert.match(read(f), /from '[./]*(?:components\/)?ui\/Button'/, `${f} nu importă ui/Button`)
    }
  })

  it('BT4 control pozitiv: scannerul prinde <Button> colorat de mână', () => {
    const caught = [
      '<Button variant="secondary" style={{ background: D.overlay }}>A</Button>',
      '<Button',
      '  variant="primary"',
      '  onClick={() => setOpen(a > b)}',
      '  style={{ flex: 1, color: D.t1 }}',
      '>',
      '  B',
      '</Button>',
      '<Button style={{ backgroundColor: x }}>C</Button>',
      '<Button style={{ border: `1px solid ${D.gold}` }}>D</Button>',
      '<Button style={{ borderColor: D.red }}>E</Button>',
      '<Button style={{ boxShadow: D.shadowLg }}>F</Button>',
    ].join('\n')
    assert.equal(coloredButtons(caught), 6)
    const fine = [
      '<Button variant="primary" style={{ flex: 1, position: \'absolute\', top: 8 }}>A</Button>',
      '<Button icon={<Icon name="x" style={{ color: D.gold }} />} style={{ marginTop: 4 }}>B</Button>',
      '<button style={{ background: D.gold }}>C</button>',
      '<ButtonGroup style={{ background: D.s2 }} />',
      '// <Button style={{ color: D.t1 }}> într-un comentariu',
      '{/* <Button style={{ color: D.t1 }}> */}',
    ].join('\n')
    assert.equal(coloredButtons(fine), 0)
  })

  it(`BT5 <Button> fără culori în style (plafon 0 pe ecranele migrate, total ${COLORED_CEILING})`, () => {
    const per = uiFiles()
      .map((f) => ({ f, n: coloredButtons(read(f)) }))
      .filter((x) => x.n > 0)
    const migrated = per.filter((x) => x.f in MIGRATED_CEILINGS).map((x) => `${x.f} (${x.n})`)
    assert.deepEqual(migrated, [], '<Button> colorat prin style într-un ecran migrat — alege varianta.')
    const total = per.reduce((s, x) => s + x.n, 0)
    assert.ok(
      total <= COLORED_CEILING,
      `${total} <Button> cu culoare/chenar în style (plafon ${COLORED_CEILING}): ` +
        per.map((x) => `${x.f} (${x.n})`).join(', ') +
        '. Culoarea vine din `variant`; `style` pe <Button> e doar pentru layout.',
    )
  })
})
