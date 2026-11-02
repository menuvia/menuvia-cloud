// Starea comutatorului de ridicare pe planul restaurantului (lib/pickupAvailability).
// `pickup_orders` e activ doar de la Meniu + Comenzi (planFeatureMatrix.fixture):
// PA1 leagă helperul de fixtură, ca o schimbare a matricei să se vadă aici.
//
// Modul „doar ridicare” pe planul restaurantului (`pickupOnlyMode`, reziduul R1
// al lui #324). DashboardPage îl calcula din cele două flag-uri STOCATE, deci
// după un downgrade (sau pe rânduri dinainte de #318/#319) panoul ascundea
// Hartă sală / Rezervări și scotea mesele din checklist-ul de pe Acasă, deși
// din mig 309 pagina publică nu mai arată ridicarea, iar `create_order` o
// refuză — exact localul care are nevoie de mese și rezervări le pierdea.
//   PX1  tabelul de adevăr: 'off' fără ambele flag-uri; 'suspended' DOAR pe
//        feature CUNOSCUT absent; feature necunoscut → comportamentul stocat
//        ('on'), fără pâlpâirea nav-ului la încărcare. Mutația care pică:
//        expresia veche din DashboardPage (doar flag-urile) dă 'on' pe
//        feature=false.
//   PX2  pe fiecare plan din matricea DB, ACEEAȘI stare din ambele intrări
//        (features în DashboardPage/Mese, comutatorul în Setări).
//   PX3  clichet de CLASĂ pe sursă: niciun fișier din src/ nu citește
//        `pickup_only` direct în afara registrului (scriitorii + tipul +
//        helperul); DashboardPage și Mese trec prin `pickupOnlyMode` cu
//        feature-ul planului. Mutația care pică: expresia veche din DashboardPage
//        sau condiția veche din TablesManager (`pickup_settings?.pickup_only`).
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  canSetPickupEnabled,
  pickupOnlyMode,
  pickupToggleState,
  type PickupOnlyMode,
} from '../pickupAvailability'
import { pickupFeatureFromToggle, pickupFeatureState } from '../pickupCopy'
import { DB_PLANS, PLAN_FEATURE_MATRIX } from './planFeatureMatrix.fixture'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()

describe('pickupToggleState', () => {
  it('PA1: „available" exact pe planurile cu pickup_orders în matrice', () => {
    for (const plan of DB_PLANS) {
      const expected = PLAN_FEATURE_MATRIX.pickup_orders[plan]
      expect(pickupToggleState(plan, false) === 'available', plan).toBe(expected)
    }
  })

  it('PA2: fără pickup_orders — oprit = blocat, pornit (downgrade) = doar oprire', () => {
    expect(pickupToggleState('starter', false)).toBe('locked')
    expect(pickupToggleState('free', true)).toBe('locked_on')
    expect(canSetPickupEnabled('locked', true)).toBe(false)
    expect(canSetPickupEnabled('locked_on', true)).toBe(false)
    expect(canSetPickupEnabled('locked_on', false)).toBe(true)
    expect(canSetPickupEnabled('available', true)).toBe(true)
  })

  it('PA3: plan necunoscut = blocat în ambele sensuri, fără verdict despre plan', () => {
    expect(pickupToggleState(null, false)).toBe('unknown')
    expect(pickupToggleState(undefined, true)).toBe('unknown')
    expect(canSetPickupEnabled('unknown', true)).toBe(false)
    expect(canSetPickupEnabled('unknown', false)).toBe(false)
    // Un șir nerecunoscut e un plan CUNOSCUT, dar fără ridicare.
    expect(pickupToggleState('business', false)).toBe('locked')
  })
})

const BOTH_ON = { enabled: true, pickup_only: true }

describe('pickupOnlyMode', () => {
  it('PX1: off fără ambele flag-uri; suspendat DOAR pe feature cunoscut absent', () => {
    for (const f of [true, false, null] as const) {
      expect(pickupOnlyMode(null, f)).toBe('off')
      expect(pickupOnlyMode(undefined, f)).toBe('off')
      expect(pickupOnlyMode({ enabled: true, pickup_only: false }, f)).toBe('off')
      // pickup_only fără ridicarea pornită e inert (ca nav-ul de dinainte).
      expect(pickupOnlyMode({ enabled: false, pickup_only: true }, f)).toBe('off')
      expect(pickupOnlyMode({ enabled: true }, f)).toBe('off')
    }
    expect(pickupOnlyMode(BOTH_ON, true)).toBe('on')
    // Plan necunoscut: comportamentul stocat, fără să ascundă/arate nav-ul în gol.
    expect(pickupOnlyMode(BOTH_ON, null)).toBe('on')
    // Plan CUNOSCUT fără ridicare: setarea rămâne stocată, dar nu se aplică.
    expect(pickupOnlyMode(BOTH_ON, false)).toBe('suspended')
  })

  it('PX2: pe fiecare plan din matrice, aceeași stare din features și din comutator', () => {
    const expected = (pickup: boolean): PickupOnlyMode => (pickup ? 'on' : 'suspended')
    for (const plan of DB_PLANS) {
      const pickup = PLAN_FEATURE_MATRIX.pickup_orders[plan]
      const fromFeatures = pickupFeatureState({
        plan,
        features: { pickup_orders: { enabled: pickup, limit: null } },
      })
      const fromToggle = pickupFeatureFromToggle(pickupToggleState(plan, true))
      expect(pickupOnlyMode(BOTH_ON, fromFeatures), plan).toBe(expected(pickup))
      expect(pickupOnlyMode(BOTH_ON, fromToggle), plan).toBe(expected(pickup))
    }
    // Anti-vacuitate: matricea are planuri de AMBELE feluri.
    const kinds = new Set(DB_PLANS.map((p) => PLAN_FEATURE_MATRIX.pickup_orders[p]))
    expect(kinds).toEqual(new Set([true, false]))
  })
})

// Codul fără comentarii: comentariile pomenesc `pickup_only` în proză fără să-l
// citească (DashboardPage, OnboardingPage, pickupAvailability).
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// Cine are voie să atingă `pickup_only` direct — și de ce.
const PICKUP_ONLY_READERS: Record<string, string> = {
  'src/lib/pickupAvailability.ts': 'helperul pickupOnlyMode — sursa unică a modului efectiv',
  'src/hooks/useData.ts': 'tipul rândului restaurants.pickup_settings',
  'src/components/SettingsTab.tsx': 'comutatorul care SCRIE setarea (valoarea stocată, nu cea efectivă)',
  'src/pages/OnboardingPage.tsx': 'onboarding-ul food truck SCRIE setarea (#319)',
}

describe('PX3: modul „doar ridicare” se citește doar prin pickupOnlyMode', () => {
  const files = (readdirSync(resolve(ROOT, 'src'), { recursive: true }) as string[])
    .map((f) => `src/${f.replace(/\\/g, '/')}`)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && !f.endsWith('.d.ts'))
  const readers = files.filter((f) =>
    /\bpickup_only\b/.test(code(readFileSync(resolve(ROOT, f), 'utf8'))),
  )

  it('control: scanerul vede fișierele și elimină comentariile', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(code('// pickup_only\n/* pickup_only */\nconst a = 1')).not.toMatch(/pickup_only/)
    expect(code('const x = s.pickup_only')).toMatch(/pickup_only/)
  })

  it('setul cititorilor e EXACT registrul (o scutire care nu mai acoperă nimic pică)', () => {
    expect([...readers].sort()).toEqual(Object.keys(PICKUP_ONLY_READERS).sort())
  })

  it('DashboardPage (nav + Acasă) și Mese trec prin helper, cu feature-ul planului', () => {
    const norm = (f: string) => readFileSync(resolve(ROOT, f), 'utf8').replace(/\s+/g, ' ')
    const dash = norm('src/pages/DashboardPage.tsx')
    expect(dash).toContain(
      "pickupOnlyMode(restaurant?.pickup_settings, pickupFeatureState(features.features)) === 'on'",
    )
    // Valoarea efectivă ajunge în nav ȘI pe Acasă.
    expect(dash).toContain('isSubTabVisible(st, isAdminRole, tier, money, isPlatAdmin, pickupOnly)')
    expect(dash).toContain('pickupOnly={pickupOnly}')
    const tables = norm('src/components/TablesManager.tsx')
    expect(tables).toContain('pickupOnlyMode(restaurant.pickup_settings, pickupFeature)')
    expect(tables).toContain("pickupOnly !== 'off'")
  })
})
