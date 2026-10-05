// Clichet: pagina de prețuri promite pe Planurile 1–2 DOAR ce acoperă DB-ul
// (oct 2026, PR „prețuri adevărate"). Fiecare rând de pe cardurile starter/
// growth (`included`/`notIncluded`) și fiecare celulă starter/growth din
// `PLAN_COMPARISON` trebuie să aibă o intrare în registrul BINDINGS de mai jos,
// iar intrarea trebuie să se verifice pe fixtura înghețată a DB-ului:
//   - `features`: toate activate pentru plan (și DEZACTIVATE unde pagina zice nu);
//   - `limit`: numărul din text == limita reală din plan_limits/plan_features;
//   - `universal`: nu e gate-uit de plan (motivul e scris).
// Un rând NOU fără intrare face testul roșu — exact ca registrul JL1/GR10.
//   PL1  cardurile starter/growth: fiecare rând legat și adevărat;
//   PL2  tabelul comparativ: fiecare celulă starter/growth legată și adevărată;
//   PL3  limitele din `PLANS.limits` == fixtura DB (inclusiv maxRestaurants);
//   PL4  promisiunile scoase deliberat (AI, SMS, Happy Hour, rapoarte pe email,
//        rezervări „simple/complete") nu reapar pe starter/growth;
//   PL5  registrul nu putrezește: fiecare intrare e încă folosită;
//   PL6  fixtura TS == blocul FIXTURE din PD5 (tests/sql/plan_dead_data_assertions.sql),
//        care la rândul lui e comparat în CI cu `plan_features` REAL — deci
//        fixtura nu poate păstra rânduri șterse de o migrație (mig 290).
//
// „Dashboard bucătărie" NU are feature propriu: rândul `kitchen_dashboard` era
// date moarte (zero cititori, șters în mig 290), iar KitchenPage nu are gate de
// plan — afișează comenzile, care pe Planul 2 există DOAR prin `order_qr`
// (comenzi QR, mig 083) și `waiter_manual` (comenzi de ospătar); grupul
// „Comenzi" din dashboard e `minTier: 2`. Promisiunea se leagă deci de ce chiar
// produce conținutul ecranului.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PLANS, PLAN_COMPARISON, getPlan, type PlanId } from '../plans'
import {
  DB_PLANS,
  PLAN_FEATURE_MATRIX,
  PLAN_LIMIT_MATRIX,
  type DbFeature,
  type DbPlan,
} from './planFeatureMatrix.fixture'

type LimitKey = keyof typeof PLAN_LIMIT_MATRIX
type Basis =
  | { features: readonly DbFeature[] }
  | { limit: LimitKey }
  | { universal: string }
  | { header: true }

// Textele de pe carduri (included + notIncluded) pentru starter/growth.
const CARD_BINDINGS: Record<string, Basis> = {
  'Meniu QR digital': { features: ['menu_qr'] },
  'Până la 300 de produse': { limit: 'max_products' },
  'Până la 120 mese / QR-uri': { limit: 'max_tables' },
  'Imagini la produse': { universal: 'câmp de produs, fără gate de plan' },
  'Alergeni + valori nutriționale': { universal: 'câmpuri de produs, fără gate de plan' },
  'Meniul public în 7 limbi (RO, EN, DE, FR, IT, HU, ES)': {
    universal: 'menu_languages (mig 197/219), fără gate de plan',
  },
  'Teme premium + stil flipbook': { features: ['themes'] },
  'Rezervări online + link pentru butonul Google': {
    universal: 'modulul reservations e permis pe orice plan (mig 086, set_restaurant_module)',
  },
  'Comenzi prin QR': { features: ['order_qr'] },
  'Dashboard bucătărie': { features: ['order_qr', 'waiter_manual'] },
  'Tot din Meniu Digital +': { header: true },
  'Până la 1.000 de produse': { limit: 'max_products' },
  'Până la 300 mese / QR-uri': { limit: 'max_tables' },
  'Comenzi prin QR (identificare automată a mesei)': { features: ['order_qr'] },
  'Dashboard bucătărie + flux ospătar': { features: ['order_qr', 'waiter_manual'] },
  'Pre-comandă pentru ridicare (pickup)': { features: ['pickup_orders'] },
  'Fidelizare pe comenzile prin QR (puncte + recompense)': { features: ['loyalty', 'order_qr'] },
  '„Cere nota" cu bacșiș, din telefonul clientului': { features: ['order_qr', 'table_lifecycle'] },
  'Cerere de recenzie Google după comanda prin QR': { features: ['order_qr'] },
  'Gestiune stocuri + rețete': { features: ['stocks', 'recipes'] },
  // Tab-ul Rapoarte e minTier 2; fără comenzi nu există ce evidenția.
  'Evidența comenzilor și a produselor vândute': { features: ['order_qr'] },
  'Echipă până la 10 membri': { limit: 'max_team_members' },
  'Mod offline pentru ospătari': { features: ['waiter_manual'] },
  'Fără badge-ul Menuvia pe meniul public': { features: ['remove_branding'] },
  'Plăți și bon fiscal în aplicație': { features: ['fiscal_receipt'] },
  'TVA, casă, facturi': { features: ['fiscal_receipt', 'reports_vat'] },
}

// Rândurile tabelului comparativ (doar coloanele starter/growth contează aici).
const ROW_BINDINGS: Record<string, Basis> = {
  'Produse în meniu': { limit: 'max_products' },
  'Mese / QR-uri': { limit: 'max_tables' },
  'Locații în abonament': { limit: 'max_restaurants' },
  'Meniul public în 7 limbi': { universal: 'menu_languages, fără gate de plan' },
  'Teme premium + flipbook': { features: ['themes'] },
  'Rezervări online': { universal: 'modul permis pe orice plan (mig 086)' },
  'Comenzi prin QR': { features: ['order_qr'] },
  'Dashboard bucătărie': { features: ['order_qr', 'waiter_manual'] },
  'Flux ospătar': { features: ['waiter_manual'] },
  'Pre-comandă pentru ridicare (pickup)': { features: ['pickup_orders'] },
  'Fidelizare pe comenzile prin QR': { features: ['loyalty'] },
  'Cerere de recenzie Google după comanda prin QR': { features: ['order_qr'] },
  'Fără badge-ul Menuvia pe meniul public': { features: ['remove_branding'] },
  Stocuri: { features: ['stocks', 'recipes'] },
  'Rapoarte în aplicație': { features: ['order_qr'] },
  'Membri echipă': { limit: 'max_team_members' },
  'Plăți în aplicație': { features: ['fiscal_receipt'] },
  'Plata online la masă (clientul plătește din telefon)': { features: ['online_payments'] },
  'Bon fiscal + casă de marcat': { features: ['fiscal_receipt'] },
  'Facturi Oblio': { features: ['fiscal_receipt'] },
  'Hartă sală + panou „Stadiu mese"': { features: ['floor_plan'] },
}

const LOW_PLANS: readonly (PlanId & DbPlan)[] = ['starter', 'growth']

function numberIn(text: string): number | null {
  const m = /(\d[\d.]*)/.exec(text)
  return m ? Number(m[1].replace(/\./g, '')) : null
}

/** Verifică o promisiune POZITIVĂ (`text`) pe planul dat. */
function assertPromise(where: string, text: string, basis: Basis, plan: DbPlan) {
  if ('header' in basis || 'universal' in basis) return
  if ('limit' in basis) {
    const real = PLAN_LIMIT_MATRIX[basis.limit][plan]
    expect(numberIn(text), `${where}: „${text}" nu e limita reală (${real}) pe ${plan}`).toBe(real)
    return
  }
  for (const f of basis.features) {
    expect(PLAN_FEATURE_MATRIX[f][plan], `${where}: „${text}" cere ${f}, oprit pe ${plan}`).toBe(
      true,
    )
  }
}

/** Verifică o NEGAȚIE: pagina spune „nu", DB-ul trebuie să fie de acord. */
function assertAbsent(where: string, text: string, basis: Basis, plan: DbPlan) {
  expect('features' in basis, `${where}: „${text}" negat fără feature de verificat`).toBe(true)
  if (!('features' in basis)) return
  const anyOff = basis.features.some((f) => !PLAN_FEATURE_MATRIX[f][plan])
  expect(anyOff, `${where}: „${text}" marcat lipsă, dar DB îl dă pe ${plan}`).toBe(true)
}

describe('pagina de prețuri e legată de matricea reală din DB', () => {
  it('PL1: fiecare rând de pe cardurile starter/growth e legat și adevărat', () => {
    let checked = 0
    for (const id of LOW_PLANS) {
      const plan = getPlan(id)
      for (const text of plan.included) {
        const basis = CARD_BINDINGS[text]
        expect(basis, `rând nelegat pe ${id}: „${text}" — adaugă-l în CARD_BINDINGS`).toBeDefined()
        if (basis) assertPromise(`card ${id}`, text, basis, id)
        checked++
      }
      for (const text of plan.notIncluded) {
        const basis = CARD_BINDINGS[text]
        expect(basis, `negație nelegată pe ${id}: „${text}"`).toBeDefined()
        if (basis) assertAbsent(`card ${id}`, text, basis, id)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(15) // control pozitiv: cardurile nu sunt goale
  })

  it('PL2: fiecare celulă starter/growth din tabel e legată și adevărată', () => {
    let positives = 0
    for (const r of PLAN_COMPARISON) {
      const basis = ROW_BINDINGS[r.label]
      expect(basis, `rând nelegat în tabel: „${r.label}" — adaugă-l în ROW_BINDINGS`).toBeDefined()
      if (!basis) continue
      for (const id of LOW_PLANS) {
        const v = r[id]
        if (v === false) {
          if ('features' in basis) assertAbsent(`tabel ${id}`, r.label, basis, id)
          continue
        }
        positives++
        const text = typeof v === 'string' ? v : r.label
        assertPromise(`tabel ${id}`, text, basis, id)
      }
    }
    expect(positives).toBeGreaterThan(10)
  })

  it('PL3: limitele din PLANS sunt cele din plan_limits / plan_features', () => {
    for (const p of PLANS) {
      expect(p.limits.maxProducts, `${p.id} produse`).toBe(PLAN_LIMIT_MATRIX.max_products[p.id])
      expect(p.limits.maxTables, `${p.id} mese`).toBe(PLAN_LIMIT_MATRIX.max_tables[p.id])
      expect(p.limits.maxTeamMembers, `${p.id} echipă`).toBe(
        PLAN_LIMIT_MATRIX.max_team_members[p.id],
      )
      expect(p.limits.maxRestaurants, `${p.id} locații`).toBe(
        PLAN_LIMIT_MATRIX.max_restaurants[p.id],
      )
    }
  })

  it('PL4: promisiunile scoase deliberat nu reapar pe Planurile 1–2', () => {
    // D3: cota AI reală nu e „2/20 pe lună"; SMS și emailurile depind de un
    // worker care nu rulează; D4: Happy Hour nu se aplică pe comenzile de
    // ospătar; rapoartele pe email numără doar `paid`; rezervările nu diferă.
    const FORBIDDEN =
      /\bAI\b|SMS|remind|Happy Hour|zilnic|săptămânal|e-?mail|Agendă simplă|Complete/i
    const texts: string[] = []
    for (const id of LOW_PLANS) {
      texts.push(...getPlan(id).included)
      for (const r of PLAN_COMPARISON) {
        const v = r[id]
        if (v === false) continue
        texts.push(r.label, typeof v === 'string' ? v : '')
      }
    }
    expect(texts.length).toBeGreaterThan(20)
    for (const t of texts) expect(t, `promisiune scoasă a reapărut: „${t}"`).not.toMatch(FORBIDDEN)
  })

  it('PL5: registrul nu putrezește — fiecare intrare e încă pe pagină', () => {
    const cardTexts = new Set(
      LOW_PLANS.flatMap((id) => [...getPlan(id).included, ...getPlan(id).notIncluded]),
    )
    for (const k of Object.keys(CARD_BINDINGS)) {
      expect(cardTexts.has(k), `intrare moartă în CARD_BINDINGS: „${k}"`).toBe(true)
    }
    const labels = new Set(PLAN_COMPARISON.map((r) => r.label))
    for (const k of Object.keys(ROW_BINDINGS)) {
      expect(labels.has(k), `intrare moartă în ROW_BINDINGS: „${k}"`).toBe(true)
    }
  })

  it('PL6: fixtura TS == blocul FIXTURE din PD5 (oglinda plan_features din DB)', () => {
    // Din process.cwd(), NU din import.meta.url/__dirname (capcana din qr-scan.test.ts, #269).
    const sql = readFileSync(
      resolve(process.cwd(), 'tests/sql/plan_dead_data_assertions.sql'),
      'utf8',
    )
    const block = /-- FIXTURE-BEGIN([\s\S]*?)-- FIXTURE-END/.exec(sql)
    expect(block, 'blocul FIXTURE lipsește din PD5').not.toBeNull()
    const frozen = new Map<string, string>()
    for (const m of (block?.[1] ?? '').matchAll(/\('([a-z_]+)',\s*'([a-z,]*)'\)/g)) {
      frozen.set(m[1], m[2])
    }
    // control pozitiv: parserul chiar a citit matricea
    expect(frozen.size).toBeGreaterThan(20)
    const fromTs = new Map<string, string>()
    for (const [feature, byPlan] of Object.entries(PLAN_FEATURE_MATRIX)) {
      fromTs.set(feature, DB_PLANS.filter((p) => byPlan[p]).join(','))
    }
    expect(Object.fromEntries(fromTs)).toEqual(Object.fromEntries(frozen))
    // rândurile șterse de mig 290 nu au voie să reapară în fixtură
    for (const dead of ['kitchen_dashboard', 'ai_import']) {
      expect(dead in PLAN_FEATURE_MATRIX, `fixtura are rândul șters ${dead}`).toBe(false)
    }
  })
})
