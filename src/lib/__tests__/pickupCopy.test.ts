// PK1–PK7 — ce îi spune dashboard-ul owner-ului despre ridicare, după mig 309.
//
// Din 309, /m/:slug arată ridicarea DOAR cu feature-ul `pickup_orders`; setarea
// stocată rămâne neatinsă (pentru re-urcare). UI-ul nu o mai pornește pe un plan
// fără ridicare (comutatorul din Setări, #318; onboarding-ul food truck, #319),
// deci „pornit fără feature” rămâne după un DOWNGRADE sau pe rândurile scrise
// înainte de #318/#319. Atunci owner-ul vede „pornit”, oaspeții lui nu mai pot
// comanda pentru ridicare, iar refuzul de la `create_order` — singurul semnal de
// până la 309 — nu mai apare, fiindcă oaspetele nu mai ajunge la formular.
//
//   PK1  `pickupFeatureState` / `pickupFeatureFromToggle` sunt TRISTATE.
//   PK2  Nicio promisiune de comenzi fără feature CUNOSCUT activ (null = nu știm).
//   PK3  Nota de sub comutator: UNA pe stare; avertismentul de plan DOAR pe plan
//        CUNOSCUT fără ridicare, cu numele planului; pe `locked_on` spune ce e
//        ADEVĂRAT după 309 (oaspeții nu văd ridicarea, setarea rămâne) — NU
//        „văd formularul, dar comenzile sunt respinse” (adevărat doar înainte de
//        309). NU „doar meniul” — cu modulul Rezervări pornit (permis pe orice
//        plan, mig 086) /m/:slug are și „Rezervă o masă”.
//   PK4  Pragul și numele planului dintr-o sursă: `PICKUP_MIN_PLAN` e planul
//        minim care chiar are `pickup_orders` în matricea DB; numele e cel
//        comercial din `PLAN_LABELS`, fără nume interne.
//   PK5  Clichet pe SURSĂ: SettingsTab și TablesManager n-au texte de ridicare
//        scrise de mână; SettingsTab derivă textele din starea comutatorului și
//        NU cheamă `useFeatures` (pică pe codul vechi al ambelor PR-uri).
//   PK6  Empty state-ul „doar ridicare”: „clienții comandă” doar pornit + feature.
//   PK7  Un singur adevăr: Setări (din plan) și Mese (din feature) dau același
//        tristate pe fiecare plan din matricea DB.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  generalMenuQrText,
  pickupCardDescription,
  pickupFeatureFromToggle,
  pickupFeatureState,
  pickupOnlyEmptyStateText,
  pickupPlanName,
  pickupToggleNotice,
} from '../pickupCopy'
import {
  PICKUP_MIN_PLAN,
  PICKUP_MIN_TIER,
  pickupToggleState,
  type PickupToggleState,
} from '../pickupAvailability'
import { planTier, type RestaurantFeatures } from '../features'
import { PLAN_LABELS } from '../constants'
import { DB_PLANS, PLAN_FEATURE_MATRIX } from './planFeatureMatrix.fixture'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

// Orice formulare care îi spune owner-ului că oaspeții POT comanda. Negația
// („nu pot comanda pentru ridicare”) e exact opusul unei promisiuni.
const PROMISE = /(?<!nu )pot (și )?comanda|comandă și ridică/i

const features = (pickup: boolean | undefined): RestaurantFeatures => ({
  plan: 'starter',
  features: pickup === undefined ? {} : { pickup_orders: { enabled: pickup, limit: null } },
})

const STATES: ReadonlyArray<boolean | null> = [true, false, null]
const TOGGLE_STATES: ReadonlyArray<PickupToggleState> = [
  'available',
  'locked',
  'locked_on',
  'unknown',
]

// Afirmația FALSĂ pe care textele o făceau: pagina publică arată „doar meniul”.
// Pe Planul 1 cu Rezervări pornit, /m/:slug are și „Rezervă o masă”
// (PublicMenuPage, `reservationsModuleEnabled`).
const ONLY_MENU = /\b(doar|numai|exclusiv)\s+(cu\s+)?meniul?\b/i
// Ce e adevărat pe ORICE plan fără `pickup_orders`.
const NO_PICKUP_ORDER =
  /nu pot comanda pentru ridicare|fără comanda pentru ridicare|comenzile pentru ridicare nu pot fi primite/
// Afirmația adevărată DOAR înainte de 309 (textul vechi al stării `locked_on`):
// din 309 oaspetele nu mai ajunge la formular, deci nici la refuz.
const PRE_309 = /văd formularul|sunt respinse/i
// Numele interne de plan nu apar în text (regula 4 din CLAUDE.md).
const INTERNAL_PLAN = /\b(free|starter|growth|pro|enterprise)\b/

describe('PK1: feature-ul de ridicare, tristate', () => {
  it('din features: null pe neîncărcate; true/false doar când planul e cunoscut', () => {
    expect(pickupFeatureState(null)).toBeNull()
    expect(pickupFeatureState(features(true))).toBe(true)
    expect(pickupFeatureState(features(false))).toBe(false)
    // cheie lipsă din răspunsul serverului = feature dezactivat (ca hasFeature)
    expect(pickupFeatureState(features(undefined))).toBe(false)
  })

  it('din starea comutatorului: available → true, locked/locked_on → false, unknown → null', () => {
    expect(pickupFeatureFromToggle('available')).toBe(true)
    expect(pickupFeatureFromToggle('locked')).toBe(false)
    expect(pickupFeatureFromToggle('locked_on')).toBe(false)
    expect(pickupFeatureFromToggle('unknown')).toBeNull()
  })
})

describe('PK2: promisiunea de comenzi doar pe feature cunoscut activ', () => {
  it('control al regex-ului: negația nu e promisiune', () => {
    expect('Clienții pot comanda fără să scaneze QR').toMatch(PROMISE)
    expect('oaspeții nu pot comanda pentru ridicare').not.toMatch(PROMISE)
  })

  it('fără feature sau pe plan necunoscut niciun text nu promite comenzi', () => {
    for (const f of [false, null] as const) {
      const d = pickupCardDescription(f)
      expect(`${d.lead} /m/x${d.tail}`).not.toMatch(PROMISE)
      expect(generalMenuQrText(f)).not.toMatch(PROMISE)
      expect(pickupOnlyEmptyStateText(true, f)).not.toMatch(PROMISE)
    }
    for (const s of TOGGLE_STATES) {
      expect(pickupToggleNotice(s) ?? '', s).not.toMatch(PROMISE)
    }
  })

  it('control pozitiv: cu feature-ul activ promisiunea există', () => {
    const d = pickupCardDescription(true)
    expect(`${d.lead} /m/x${d.tail}`).toMatch(PROMISE)
    expect(generalMenuQrText(true)).toMatch(PROMISE)
    expect(pickupOnlyEmptyStateText(true, true)).toMatch(PROMISE)
  })

  it('pe cardul din Setări promisiunea e CONDIȚIONATĂ de comutator, înaintea ei', () => {
    // Descrierea stă lângă comutator și când e OPRIT (atunci pagina publică nu
    // arată ridicarea), deci nu are voie să afirme la prezent că oaspeții pot
    // comanda. Condiția trebuie să preceadă promisiunea, în aceeași frază.
    // Mutația care pică: textul vechi „Activează pagina ta publică. Clienții pot
    // comanda …” (recenzie CodeRabbit pe #324).
    const text = (() => {
      const d = pickupCardDescription(true)
      return `${d.lead} /m/x${d.tail}`
    })()
    const promise = text.search(PROMISE)
    const condition = text.search(/\bcu ridicarea pornită,/i)
    expect(promise).toBeGreaterThanOrEqual(0)
    expect(condition, text).toBeGreaterThanOrEqual(0)
    expect(condition).toBeLessThan(promise)
    expect(text.slice(condition, promise)).not.toMatch(/[.!?]/)
  })
})

describe('PK3: nota de sub comutatorul de ridicare', () => {
  it('available → nicio notă; unknown → doar „se verifică”, fără verdict despre plan', () => {
    expect(pickupToggleNotice('available')).toBeNull()
    const u = pickupToggleNotice('unknown')
    expect(u).toMatch(/Se verifică planul restaurantului/)
    expect(u).not.toContain(pickupPlanName())
    expect(u).not.toMatch(NO_PICKUP_ORDER)
    expect(u).not.toMatch(PRE_309)
    // „unknown” e și încărcarea NORMALĂ — textul nu pretinde un eșec.
    expect(u).not.toMatch(/Nu am putut/)
  })

  it('plan cunoscut fără ridicare → numele planului și ce lipsește', () => {
    for (const s of ['locked', 'locked_on'] as const) {
      const n = pickupToggleNotice(s)
      expect(n, s).not.toBeNull()
      expect(n, s).toContain(pickupPlanName())
      expect(n, s).toMatch(NO_PICKUP_ORDER)
    }
    expect(pickupToggleNotice('locked')).toMatch(/^Disponibil de la planul /)
  })

  it('locked_on spune ce e adevărat după 309: oaspeții nu văd ridicarea, setarea rămâne', () => {
    const on = pickupToggleNotice('locked_on')
    expect(on).toMatch(/nu văd ridicarea pe pagina publică/)
    expect(on).toMatch(/nu pot comanda pentru ridicare/)
    expect(on).toMatch(/Setarea rămâne salvată/)
    // Textul de dinainte de 309 (formularul vizibil, comenzile respinse) e FALS acum.
    expect(on).not.toMatch(PRE_309)
    expect(on).not.toEqual(pickupToggleNotice('locked'))
  })

  it('niciun text de staff nu afirmă că pagina publică arată „doar meniul”', () => {
    // Control pozitiv al regex-ului: formularea veche e prinsă.
    expect('pe planul curent pagina publică arată doar meniul.').toMatch(ONLY_MENU)
    expect('clienții văd doar meniul și nu pot comanda').toMatch(ONLY_MENU)
    expect('Mod „doar ridicare" activ').not.toMatch(ONLY_MENU)
    for (const s of TOGGLE_STATES) {
      expect(pickupToggleNotice(s) ?? '', s).not.toMatch(ONLY_MENU)
    }
    for (const enabled of [true, false]) {
      for (const f of STATES) {
        const d = pickupCardDescription(f)
        for (const t of [
          pickupOnlyEmptyStateText(enabled, f),
          generalMenuQrText(f),
          `${d.lead} /m/x${d.tail}`,
        ]) {
          expect(t, `enabled=${enabled} feature=${String(f)}`).not.toMatch(ONLY_MENU)
        }
      }
    }
    // Empty state-ul fără feature spune ce lipsește, nu ce rămâne.
    expect(pickupOnlyEmptyStateText(true, false)).toMatch(NO_PICKUP_ORDER)
  })
})

describe('PK4: pragul și numele planului, dintr-o sursă', () => {
  it('PICKUP_MIN_PLAN = primul plan cu pickup_orders în matricea DB; tier-ul derivat din el', () => {
    const withPickup = DB_PLANS.filter((p) => PLAN_FEATURE_MATRIX.pickup_orders[p])
    expect(withPickup.length).toBeGreaterThan(0)
    expect(withPickup[0]).toBe(PICKUP_MIN_PLAN)
    expect(Math.min(...withPickup.map((p) => planTier(p)))).toBe(PICKUP_MIN_TIER)
    expect(planTier(PICKUP_MIN_PLAN)).toBe(PICKUP_MIN_TIER)
  })

  it('numele vine din PLAN_LABELS, fără prefix emoji și fără nume interne', () => {
    expect(pickupPlanName()).toBe(PLAN_LABELS[PICKUP_MIN_PLAN])
    for (const s of TOGGLE_STATES) {
      expect(pickupToggleNotice(s) ?? '', s).not.toMatch(INTERNAL_PLAN)
    }
    for (const enabled of [true, false]) {
      for (const f of STATES) {
        expect(pickupOnlyEmptyStateText(enabled, f)).not.toMatch(INTERNAL_PLAN)
      }
    }
  })
})

describe('PK5: ecranele de staff trec prin pickupCopy', () => {
  const FILES = ['src/components/SettingsTab.tsx', 'src/components/TablesManager.tsx'] as const

  it('fără texte de ridicare scrise de mână în SettingsTab / TablesManager', () => {
    for (const f of FILES) {
      // JSX-ul rupe frazele pe rânduri — comparăm pe spații normalizate.
      const src = read(f).replace(/\s+/g, ' ')
      expect(src, f).not.toMatch(PROMISE)
      expect(src, f).not.toMatch(PRE_309)
      expect(src, f).not.toContain('Disponibil de la planul')
      expect(src, f).not.toContain('Se verifică planul restaurantului')
    }
  })

  it('SettingsTab: textele derivă din starea comutatorului, fără al doilea useFeatures', () => {
    const src = read('src/components/SettingsTab.tsx').replace(/\s+/g, ' ')
    // Starea #318, pe planul cunoscut primit de la DashboardPage.
    expect(src).toMatch(/pickupToggleState\( ?planKnown \? plan : null/)
    expect(src).toMatch(/pickupCardDescription\( ?pickupFeatureFromToggle\(pickupState\)/)
    // O SINGURĂ notă: nicio a doua sursă de avertisment pentru ridicare.
    expect(src.split('pickupToggleNotice(').length - 1).toBe(1)
    expect(src).not.toContain('pickupPlanWarning')
    expect(src).not.toContain('pickupFeatureState(')
    // Un `useFeatures` aici ar chema `supabase.rpc` pe mock-ul `{}` din
    // SettingsTabPickup.test (unhandled rejection) și ar dubla sursa planului.
    expect(src).not.toMatch(/from '\.\.\/hooks\/useFeatures'/)
  })

  it('TablesManager: QR-ul general și empty state-ul „doar ridicare” prin helperi', () => {
    const src = read('src/components/TablesManager.tsx')
    expect(src).toContain('pickupFeatureState(restaurantFeatures.features)')
    expect(src).toContain('generalMenuQrText(pickupFeature)')
    expect(src).toContain('pickupOnlyEmptyStateText(')
  })
})

describe('PK6: empty state-ul modului „doar ridicare”', () => {
  it('„clienții comandă” DOAR cu ridicarea pornită ȘI feature-ul cunoscut activ', () => {
    for (const enabled of [true, false]) {
      for (const f of STATES) {
        const t = pickupOnlyEmptyStateText(enabled, f)
        expect(t).toMatch(/^Mod „doar ridicare" activ/)
        expect(PROMISE.test(t), `enabled=${enabled} feature=${String(f)}`).toBe(enabled && f === true)
        // planul se numește DOAR când știm că lipsește
        expect(t.includes(pickupPlanName()), `enabled=${enabled} feature=${String(f)}`).toBe(f === false)
      }
    }
  })
})

describe('PK7: Setări și Mese spun același lucru', () => {
  it('pe fiecare plan, tristate-ul din comutator == cel din feature', () => {
    for (const plan of DB_PLANS) {
      const pickup = PLAN_FEATURE_MATRIX.pickup_orders[plan]
      const fromFeatures = pickupFeatureState({
        plan,
        features: { pickup_orders: { enabled: pickup, limit: null } },
      })
      for (const enabled of [true, false]) {
        const fromToggle = pickupFeatureFromToggle(pickupToggleState(plan, enabled))
        expect(fromToggle, `${plan} enabled=${enabled}`).toBe(fromFeatures)
      }
    }
    // Planul necunoscut: ambele intrări dau null.
    expect(pickupFeatureFromToggle(pickupToggleState(null, true))).toBeNull()
    expect(pickupFeatureState(null)).toBeNull()
  })
})
