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
//   PK6  Empty state-ul „doar ridicare”: „clienții comandă” doar cu feature-ul
//        cunoscut activ și fără flipbook; pe planul fără ridicare modul e
//        SUSPENDAT (nu „activ”).
//   PK7  Un singur adevăr: Setări (din plan) și Mese (din feature) dau același
//        tristate pe fiecare plan din matricea DB.
//
// Reziduurile lui #324, închise aici:
//   PY1  Stilul Flipbook (EFECTIV — `resolveEffectiveMenuLayout`): pagina
//        publică n-are carduri, coș sau ridicare, deci NICIUN text de staff nu
//        promite comenzi, nici pe planul care le include; fiecare spune DE CE
//        (Flipbook, fără coș) și CE face owner-ul (alt stil din „Meniu &
//        aspect”). Mutația care pică: textele vechi, fără parametrul de stil
//        (`pickupCardDescription(true)` promitea și pe flipbook).
//   PY2  Control pozitiv: fără flipbook, pe feature activ, promisiunea rămâne;
//        pe planul fără ridicare sau necunoscut flipbook-ul nu adaugă nimic
//        (fără avertisment fals pe „nu știm”).
//   PY3  „Doar ridicare” pe planul CUNOSCUT fără ridicare (`pickupOnlyMode` =
//        'suspended'): empty state-ul din Mese și descrierea comutatorului din
//        Setări spun că modul NU se aplică și că panoul arată mesele și
//        rezervările — nu „nu ai nevoie de mese” / „ascunde Harta sălii”, care
//        după R1 ar fi false. Mutația care pică: textul vechi „Mod … activ —
//        nu ai nevoie de mese” pe feature=false.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  generalMenuQrText,
  pickupCardDescription,
  pickupFeatureFromToggle,
  pickupFeatureState,
  pickupOnlyEmptyStateText,
  pickupOnlyToggleDescription,
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
const FLIPBOOK: ReadonlyArray<boolean> = [false, true]
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
      for (const fb of FLIPBOOK) {
        const d = pickupCardDescription(f, fb)
        expect(`${d.lead} /m/x${d.tail}`).not.toMatch(PROMISE)
        expect(generalMenuQrText(f, fb)).not.toMatch(PROMISE)
        expect(pickupOnlyEmptyStateText(f, fb)).not.toMatch(PROMISE)
      }
    }
    for (const s of TOGGLE_STATES) {
      expect(pickupToggleNotice(s) ?? '', s).not.toMatch(PROMISE)
    }
  })

  it('control pozitiv: cu feature-ul activ (și fără flipbook) promisiunea există', () => {
    const d = pickupCardDescription(true, false)
    expect(`${d.lead} /m/x${d.tail}`).toMatch(PROMISE)
    expect(generalMenuQrText(true, false)).toMatch(PROMISE)
    expect(pickupOnlyEmptyStateText(true, false)).toMatch(PROMISE)
  })

  it('pe cardul din Setări promisiunea e CONDIȚIONATĂ de comutator, înaintea ei', () => {
    // Descrierea stă lângă comutator și când e OPRIT (atunci pagina publică nu
    // arată ridicarea), deci nu are voie să afirme la prezent că oaspeții pot
    // comanda. Condiția trebuie să preceadă promisiunea, în aceeași frază.
    // Mutația care pică: textul vechi „Activează pagina ta publică. Clienții pot
    // comanda …” (recenzie CodeRabbit pe #324).
    const text = (() => {
      const d = pickupCardDescription(true, false)
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
    for (const fb of FLIPBOOK) {
      for (const f of STATES) {
        const d = pickupCardDescription(f, fb)
        for (const t of [
          pickupOnlyEmptyStateText(f, fb),
          pickupOnlyToggleDescription(f),
          generalMenuQrText(f, fb),
          `${d.lead} /m/x${d.tail}`,
        ]) {
          expect(t, `flipbook=${fb} feature=${String(f)}`).not.toMatch(ONLY_MENU)
        }
      }
    }
    // Empty state-ul fără feature spune ce lipsește, nu ce rămâne.
    expect(pickupOnlyEmptyStateText(false, false)).toMatch(NO_PICKUP_ORDER)
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
    for (const fb of FLIPBOOK) {
      for (const f of STATES) {
        const d = pickupCardDescription(f, fb)
        for (const t of [
          pickupOnlyEmptyStateText(f, fb),
          pickupOnlyToggleDescription(f),
          generalMenuQrText(f, fb),
          `${d.lead} /m/x${d.tail}`,
        ]) {
          expect(t, `flipbook=${fb} feature=${String(f)}`).not.toMatch(INTERNAL_PLAN)
        }
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
      // Descrierea modului „doar ridicare” stă în pickupCopy (PY3): scrisă de
      // mână ar fi rămas „ascunde Harta sălii” și pe planul care o suspendă.
      expect(src, f).not.toContain('ascunde Harta sălii')
      // Motivul flipbook (PY1) are o singură formulare, în pickupCopy.
      expect(src, f).not.toContain('alege alt stil')
    }
  })

  it('SettingsTab: textele derivă din starea comutatorului, fără al doilea useFeatures', () => {
    const src = read('src/components/SettingsTab.tsx').replace(/\s+/g, ' ')
    // Starea #318, pe planul cunoscut primit de la DashboardPage.
    expect(src).toMatch(/pickupToggleState\( ?planKnown \? plan : null/)
    expect(src).toMatch(/pickupCardDescription\( ?pickupFeatureFromToggle\(pickupState\)/)
    // Stilul vine din FORMULAR (nesalvat), pe regula EFECTIVĂ din lib/themes.
    expect(src).toContain('resolveEffectiveMenuLayout(form.theme_settings)')
    expect(src).toMatch(/pickupCardDescription\( ?pickupFeatureFromToggle\(pickupState\), menuFlipbook\)/)
    expect(src).toContain('pickupOnlyToggleDescription(pickupFeatureFromToggle(pickupState))')
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
    // Stilul EFECTIV salvat intră în ambele texte (PY1).
    expect(src).toContain('resolveEffectiveMenuLayout(restaurant.theme_settings)')
    expect(src).toContain('generalMenuQrText(pickupFeature, menuFlipbook)')
    expect(src).toContain('pickupOnlyEmptyStateText(pickupFeature, menuFlipbook)')
  })
})

describe('PK6: empty state-ul modului „doar ridicare”', () => {
  it('„clienții comandă” DOAR cu feature-ul cunoscut activ și fără flipbook', () => {
    for (const fb of FLIPBOOK) {
      for (const f of STATES) {
        const t = pickupOnlyEmptyStateText(f, fb)
        const ctx = `flipbook=${fb} feature=${String(f)}`
        // Pe planul cunoscut fără ridicare modul e SUSPENDAT (PY3), nu activ.
        expect(t, ctx).toMatch(f === false ? /^Mod „doar ridicare" suspendat/ : /^Mod „doar ridicare" activ/)
        expect(PROMISE.test(t), ctx).toBe(f === true && !fb)
        // planul se numește DOAR când știm că lipsește
        expect(t.includes(pickupPlanName()), ctx).toBe(f === false)
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

// Motivul și ieșirea pe flipbook: stilul pe nume, lipsa coșului, alt stil din
// „Meniu & aspect”.
const FLIPBOOK_WHY = /stilul Flipbook/
const FLIPBOOK_NO_CART = /fără coș/
const FLIPBOOK_WAY_OUT = /alege alt stil din Setări → Meniu & aspect/

describe('PY1: pe flipbook niciun text nu promite comenzi și spune de ce', () => {
  it('feature activ + flipbook: fără promisiune, cu motivul și ieșirea, în toate cele trei texte', () => {
    const d = pickupCardDescription(true, true)
    const texts = {
      card: `${d.lead} /m/x${d.tail}`,
      qr: generalMenuQrText(true, true),
      empty: pickupOnlyEmptyStateText(true, true),
    }
    for (const [where, t] of Object.entries(texts)) {
      expect(t, where).not.toMatch(PROMISE)
      expect(t, where).toMatch(NO_PICKUP_ORDER)
      expect(t, where).toMatch(FLIPBOOK_WHY)
      expect(t, where).toMatch(FLIPBOOK_NO_CART)
      expect(t, where).toMatch(FLIPBOOK_WAY_OUT)
    }
  })

  it('pe cardul din Setări motivul stă după linkul paginii, în aceeași descriere', () => {
    const d = pickupCardDescription(true, true)
    expect(d.lead).not.toMatch(FLIPBOOK_WHY)
    expect(d.tail).toMatch(FLIPBOOK_WHY)
  })
})

describe('PY2: control — fără flipbook promisiunea rămâne; pe „nu știm” flipbook-ul tace', () => {
  it('feature activ fără flipbook: promisiunea există și nu pomenește stilul', () => {
    const d = pickupCardDescription(true, false)
    for (const t of [
      `${d.lead} /m/x${d.tail}`,
      generalMenuQrText(true, false),
      pickupOnlyEmptyStateText(true, false),
    ]) {
      expect(t).toMatch(PROMISE)
      expect(t).not.toMatch(FLIPBOOK_WHY)
    }
  })

  it('plan fără ridicare sau necunoscut: flipbook-ul nu adaugă avertisment', () => {
    for (const f of [false, null] as const) {
      const on = pickupCardDescription(f, true)
      const off = pickupCardDescription(f, false)
      expect(on, String(f)).toEqual(off)
      expect(generalMenuQrText(f, true), String(f)).toBe(generalMenuQrText(f, false))
      expect(pickupOnlyEmptyStateText(f, true), String(f)).toBe(pickupOnlyEmptyStateText(f, false))
      expect(generalMenuQrText(f, true), String(f)).not.toMatch(FLIPBOOK_WHY)
    }
  })
})

describe('PY3: „doar ridicare” suspendat pe planul fără ridicare', () => {
  it('empty state: nu „activ — nu ai nevoie de mese”, ci ce face panoul și când revine', () => {
    const t = pickupOnlyEmptyStateText(false, false)
    expect(t).not.toMatch(/nu ai nevoie de mese/)
    expect(t).not.toMatch(/\bactiv\b/)
    expect(t).toMatch(/panoul îți arată mesele și rezervările/)
    expect(t).toMatch(/Setarea rămâne salvată/)
    expect(t).toContain(pickupPlanName())
    // Control pozitiv: pe planul cu ridicare (sau necunoscut) modul e activ.
    for (const f of [true, null] as const) {
      expect(pickupOnlyEmptyStateText(f, false), String(f)).toMatch(/nu ai nevoie de mese/)
    }
  })

  it('descrierea comutatorului din Setări: „nu se aplică” DOAR pe planul cunoscut fără ridicare', () => {
    const off = pickupOnlyToggleDescription(false)
    expect(off).toMatch(/modul nu se aplică/)
    expect(off).toMatch(/panoul îți arată mesele și rezervările/)
    expect(off).toContain(pickupPlanName())
    expect(off).not.toMatch(/ascunde Harta sălii/)
    for (const f of [true, null] as const) {
      const t = pickupOnlyToggleDescription(f)
      expect(t, String(f)).toMatch(/ascunde Harta sălii și Rezervările/)
      expect(t, String(f)).not.toMatch(/nu se aplică/)
      expect(t, String(f)).not.toContain(pickupPlanName())
    }
  })

  it('aceeași stare din ambele intrări: Setări (comutator) și Mese (features)', () => {
    for (const plan of DB_PLANS) {
      const pickup = PLAN_FEATURE_MATRIX.pickup_orders[plan]
      const fromToggle = pickupFeatureFromToggle(pickupToggleState(plan, true))
      const fromFeatures = pickupFeatureState({
        plan,
        features: { pickup_orders: { enabled: pickup, limit: null } },
      })
      expect(pickupOnlyToggleDescription(fromToggle).includes('nu se aplică'), plan).toBe(!pickup)
      expect(pickupOnlyEmptyStateText(fromFeatures, false).includes('suspendat'), plan).toBe(!pickup)
    }
  })
})
