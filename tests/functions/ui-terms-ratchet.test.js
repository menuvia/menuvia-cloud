// tests/functions/ui-terms-ratchet.test.js
// CLICHET: textul pentru om din panou e în română, cu aceiași termeni peste tot
// (lotul V, nov 2026). Fondatorul vrea un panou „simplu și premium, clar,
// profesional": același lucru se numea „Owner" într-un ecran și „proprietar"
// în altul, „Setup" pe Acasă și „Configurează" lângă el, „KDS" și „Dashboard
// bucătărie" pentru ecranul de bucătărie, „Device-uri Bridge" pentru casele
// de marcat, „Layout meniu" lângă „Tema meniului".
//
// Regula (DOAR în textul pentru om — identificatorii, cheile, rutele și id-urile
// de tab rămân în engleză, ex. `role === 'owner'`, `/dashboard`):
//   Owner → Proprietar · Setup → Configurare · Dashboard → Panou ·
//   KDS → Ecran bucătărie · Device / device-uri (Bridge) → Dispozitiv(e) ·
//   Layout meniu → Aspect meniu — cu tot cu formele flexionate (dashboardul,
//   dashboard-ul, dashboarduri, owner-ul, owneri, device-ul, setup-ul…).
//
//   TM0  CONTROL POZITIV pe linii SINTETICE: termenii sunt prinși în literale
//        de string cu spațiu sau majusculă (`'Owner'`, `title="Layout meniu"`,
//        `'Device-uri Bridge'`), în textul JSX dintre taguri (`>Dashboard<`) și
//        pe un rând întreg de text JSX — inclusiv un cuvânt SINGUR pe rândul
//        lui după un tag deschis (`<span>` / `Dashboard` / `</span>`; mutația
//        care pică: regula cuvântului singur scoasă) —, și când rândul are o interpolare `{…}`
//        sau ghilimele românești „…" (recenzia #336) —, plus formele flexionate
//        (`title="Deschide dashboardul…"`, `dashboard-ul`, `dashboarduri`,
//        `owneri`, `device-ul`, `Înregistrează device`); NU sunt prinși
//        identificatorii și rutele (`role === 'owner'`, `navigate('/dashboard')`,
//        `owner_id`, `isOwner`, `'dashboard'`, `'device_secret'`, importul
//        `./_dashboard/…`), identificatorii dintr-o destructurare pe mai multe
//        rânduri (`const {` / `owner,`) sau de după `=>`, cuvintele care doar ÎNCEP cu rădăcina (`ownership`,
//        `Dashboards`, `devices`) și nici comentariile.
//   TM1  niciun termen interzis în textul vizibil din src/components,
//        src/pages, src/lib/dashboardNav.ts și copy-ul de planuri/prețuri din
//        src/lib (plans.ts, pricingCopy.ts, pickupCopy.ts), în afara ALLOWED.
//        Mutația care îl pică: readuci `owner: 'Owner'` în TeamManager.tsx sau
//        `label: 'Setup'` în HomeTab.tsx.
//   TM2  registrul e ONEST: fiecare scutire se potrivește pe un text chiar prins.
//
// Rulează în jobul „Bridge tests" (`cd tests/functions && npm test`).
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { uiFiles, read, visibleTexts } = require('./helpers/uiSourceScan')

// Formele FLEXIONATE contează (recenzia #336): „dashboardul”, „owner-ul”,
// „device-uri”, „setup-ul” sunt același termen, iar granița de cuvânt de după
// rădăcină le respingea pe cele lipite (`dashboardul`). „device” singur e tot
// pentru om (Bridge: „Înregistrează device”) → „dispozitiv”.
const STEMS = 'owner|setup|dashboard|kds|device'
const SUFFIX = '(?:-?(?:ul|ului|uri|urilor|ii|i|ilor|ele|elor))?'
const FORBIDDEN = new RegExp(`(?<![\\w/.])(?:(?:${STEMS})${SUFFIX}|layout meniu)(?![\\wăâîșț])`, 'i')

const FILES = [
  ...uiFiles(),
  'src/lib/dashboardNav.ts',
  'src/lib/plans.ts',
  'src/lib/pricingCopy.ts',
  'src/lib/pickupCopy.ts',
]

function termHits(src) {
  return visibleTexts(src).filter((t) => FORBIDDEN.test(t.text))
}

const EN = 'text în ENGLEZĂ (menuvia.com / onboarding EN): terminologia română nu se aplică'
// Scutiri: fișier + fragment EXACT din text → motiv.
const ALLOWED = [
  {
    file: 'src/pages/DashboardPage.tsx',
    contains: '[dashboard] țara restaurantului',
    reason: 'prefix de console.warn (diagnoză pentru dezvoltator), nu text afișat',
  },
  { file: 'src/pages/LandingPageEn.tsx', contains: 'payment setup?', reason: EN },
  { file: 'src/pages/OnboardingPage.tsx', contains: 'Add the rest from the dashboard', reason: EN },
  { file: 'src/pages/OnboardingPage.tsx', contains: 'rename them from the dashboard', reason: EN },
  { file: 'src/pages/OnboardingPage.tsx', contains: 'add your items from the dashboard', reason: EN },
  { file: 'src/pages/OnboardingPage.tsx', contains: 'Next steps in the dashboard', reason: EN },
  { file: 'src/pages/OnboardingPage.tsx', contains: 'Open the dashboard', reason: EN },
]

function scan() {
  const hits = []
  for (const file of FILES) {
    for (const t of termHits(read(file))) hits.push({ file, text: t.text, where: `${file}:${t.line}` })
  }
  return hits
}

describe('clichet: terminologia din panou', () => {
  it('TM0 control pozitiv: termenii sunt prinși în text, nu în identificatori', () => {
    const caught = [
      "  owner: 'Owner',",
      '<SettingsCard title="Layout meniu" />',
      "{fiscal ? 'Case de marcat' : 'Device-uri Bridge'}",
      '<span>Dashboard</span>',
      "{ label: 'Setup', value: x }",
      "desc: 'Ecranul de preparare (KDS)',",
      '            30 de zile gratuite. Setup în 10 minute.',
      "toast('Roagă owner-ul să reactiveze produsul')",
      '          Configurează totul din dashboard pentru {restaurantName}.',
      '          Bun venit, {name}! Deschide {cta && <b>acum</b>} dashboardul.',
      '            Activează „Tichete bucătărie" pe un device de mai sus — comenzile',
      'title="Deschide dashboardul acestui restaurant în mod fondator"',
      "{ label: 'Vezi dashboard-ul' }",
      "toast('Ai 3 dashboarduri')",
      "title: 'Ștergi acest device?',",
      "confirmLabel: 'Înregistrează device'",
      "desc: 'Doar owneri și manageri'",
      "hint: 'Reia setup-ul'",
      // cuvânt singur pe rândul lui, între taguri pe rânduri separate (recenzia #336)
      '        <span>\n          Dashboard\n        </span>',
      // tag deschis pe mai multe rânduri: ultimul atribut închide tag-ul
      '        <span\n          className="x">\n          Dashboard\n        </span>',
      // fragment: `<>` deschide JSX la fel ca un tag (recenzia #336)
      '        <>\n          Dashboard\n        </>',
    ]
    for (const l of caught) assert.ok(termHits(l).length > 0, `ar trebui prinsă: ${l}`)
    const fine = [
      "const isAdmin = role === 'owner' || role === 'manager'",
      "window.history.pushState({}, '', '/dashboard')",
      "navigate('/dashboard?tab=billing')",
      'if (r.owner_id === user.id) return',
      'const isOwner = m.role === "owner"',
      "import HomeTab from './_dashboard/HomeTab'",
      "track('dashboard')",
      '// Setup restaurant — comentariu, nu UI',
      '{/* KDS: comentariu JSX */}',
      ' * Owner/Manager alocă mesele — comentariu de bloc',
      "select('id, device_secret')",
      "const ownership = 'ownership'",
      "label: 'Dashboards'",
      "label: 'Devices'",
      '  {devices.map((d) => (',
      // destructurare pe mai multe rânduri: identificatori, nu text
      'const {\n  owner,\n  setup\n} = x',
      // rând după `=>` (corpul unei funcții-săgeată), nu după un tag
      'const pick = () =>\n  owner',
      // comparație pe două rânduri: `>` final nu e tag (recenzia #336)
      'const over = count >\n  owner.limit',
    ]
    for (const l of fine) assert.deepEqual(termHits(l), [], `nu trebuie prinsă: ${l}`)
  })

  it('TM1 niciun termen interzis în textul pentru om', () => {
    const hits = scan().filter(
      (h) => !ALLOWED.some((a) => a.file === h.file && h.text.includes(a.contains)),
    )
    assert.deepEqual(
      hits.map((h) => `${h.where}  ${h.text}`),
      [],
      'Termen interzis în textul panoului: Owner → Proprietar, Setup → Configurare, ' +
        'Dashboard → Panou, KDS → Ecran bucătărie, Device → Dispozitiv, ' +
        'Layout meniu → Aspect meniu. Dacă textul nu e pentru om (log, cheie) sau e în ' +
        'engleză, adaugă-l în ALLOWED cu motiv.',
    )
  })

  it('TM2 registrul de scutiri nu conține intrări moarte', () => {
    const hits = scan()
    for (const a of ALLOWED) {
      assert.ok(
        hits.some((h) => h.file === a.file && h.text.includes(a.contains)),
        `scutirea „${a.contains}" din ${a.file} nu mai acoperă niciun text prins — scoate-o`,
      )
    }
  })
})
