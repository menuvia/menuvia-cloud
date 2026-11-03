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
//   KDS → Ecran bucătărie · Device-uri (Bridge) → Dispozitive ·
//   Layout meniu → Aspect meniu
//
//   TM0  CONTROL POZITIV pe linii SINTETICE: termenii sunt prinși în literale
//        de string cu spațiu sau majusculă (`'Owner'`, `title="Layout meniu"`,
//        `'Device-uri Bridge'`), în textul JSX dintre taguri (`>Dashboard<`) și
//        pe un rând întreg de text JSX; NU sunt prinși identificatorii și rutele
//        (`role === 'owner'`, `navigate('/dashboard')`, `owner_id`, `isOwner`,
//        `'dashboard'`, importul `./_dashboard/…`) și nici comentariile.
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

const FORBIDDEN = /(?<![\w/.])(owner|setup|dashboard|kds|device-uri|layout meniu)(?![\wăâîșț])/i

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
        'Dashboard → Panou, KDS → Ecran bucătărie, Device-uri → Dispozitive, ' +
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
