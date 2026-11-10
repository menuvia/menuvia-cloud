// Etichetele navigării panoului, traduse la RANDARE (lotul L3b). Datele din
// `lib/dashboardNav.ts` rămân românești (testele vechi le citesc acolo);
// DashboardPage randează `t(navLabelKey(...))` / `t(navGroupLabelKey(...))`.
//   NL1  fiecare sub-tab din NAV_GROUPS, pe fiecare suprafață de plan (necunoscut,
//        cele cinci planuri, în și în afara RO, plus suprafețe sintetice care
//        ating fiecare ramură): `ro[navLabelKey]` === `subTabLabel`, caracter cu
//        caracter; fiecare grup: `ro[navGroupLabelKey]` === eticheta grupului.
//        Mutația care pică: o cheie românească schimbată, sau `navLabelKey` care
//        nu mai oglindește o ramură a lui `subTabLabel` (ex. `noFiscal` ignorat).
//   NL2  pe grupurile VIZIBILE (`visibleNavGroups`: fiecare plan × admin ×
//        „doar ridicare” × mai multe locații × partener), cheile dau EXACT
//        etichetele afișate până acum — inclusiv grupul Comenzi de pe Planul 1,
//        care poartă numele Rezervărilor (`soloSubTab`). Mutația care pică:
//        ramura `soloSubTab` scoasă din `navGroupLabelKey`.
//   NL3  nicio cheie `nav_*` / `navGroup_*` orfană: fiecare e produsă de NL1/NL2
//        (anti-vacuitate: cele trei variante pe plan sunt printre ele).
//        Mutația care pică: o cheie rămasă după ștergerea unui tab.
//   NL4  control pozitiv pe NL1: un tab NOU adăugat în NAV_GROUPS fără cheie
//        (și un grup nou) e raportat de aceeași verificare — exact mutația
//        „tab nou în NAV_GROUPS fără `nav_<id>` în ro.ts”.
//   NL5  în fiecare limbă (ro/en/fr/de), etichetele grupurilor sunt distincte
//        între ele, iar sub-tab-urile vizibile ale unui grup sunt distincte pe
//        orice suprafață — două chip-uri cu același nume nu se pot deosebi.
//        Mutația care pică: o traducere care contopește două ecrane (ex.
//        „Orders” pe Comenzi live și pe Comenzi & plăți din același grup).
import { describe, it, expect } from 'vitest'
import {
  NAV_GROUPS,
  subTabLabel,
  visibleNavGroups,
  type NavGroup,
  type SubTab,
  type Tab,
} from '../../lib/dashboardNav'
import { surfaceTiers } from '../../lib/features'
import { isPartnerTab } from '../../lib/partnerAccess'
import type { PlanSurface } from '../../lib/planSurface'
import { featuresFor, surfaceFor } from '../../lib/__tests__/planSurfaceFixtures'
import { DB_PLANS } from '../../lib/__tests__/planFeatureMatrix.fixture'
import { navGroupLabelKey, navLabelKey } from '../navLabels'
import ro from '../ns/dashboard/ro'
import en from '../ns/dashboard/en'
import fr from '../ns/dashboard/fr'
import de from '../ns/dashboard/de'

type Table = Readonly<Record<string, unknown>>
const RO: Table = ro

const PRO = surfaceFor('pro')
const SURFACES: ReadonlyArray<PlanSurface | null> = [
  null,
  ...DB_PLANS.map((p) => surfaceFor(p)),
  ...DB_PLANS.map((p) => surfaceFor(p, { outsideRo: true })),
  // Ramurile lui `subTabLabel`, atinse explicit (nu doar prin matricea de azi).
  { ...PRO, payments: false },
  { ...PRO, payments: false, ordering: false },
  { ...PRO, fiscal: false },
]

/** Diferențele dintre cheile produse și etichetele datelor (gol = nicio derivă). */
function driftProblems(groups: readonly NavGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    const gk = navGroupLabelKey(g, null)
    if (RO[gk] !== g.label) out.push(`grup ${g.id}: ro[${gk}] = ${String(RO[gk])} ≠ ${g.label}`)
    for (const st of g.subTabs) {
      for (const s of SURFACES) {
        const k = navLabelKey(st, s)
        const want = subTabLabel(st, s)
        if (RO[k] !== want) out.push(`${st.id}: ro[${k}] = ${String(RO[k])} ≠ ${want}`)
      }
    }
  }
  return out
}

interface VisibleCase {
  name: string
  surface: PlanSurface | null
  groups: NavGroup[]
}

function visibleCases(): VisibleCase[] {
  const out: VisibleCase[] = []
  const plans = [null, ...DB_PLANS] as const
  for (const plan of plans) {
    const features = plan == null ? null : featuresFor(plan)
    const surface = plan == null ? null : surfaceFor(plan)
    const { general, money } = surfaceTiers(features)
    for (const isAdmin of [true, false]) {
      for (const pickupOnly of [false, true]) {
        for (const multiLocation of [false, true]) {
          for (const partner of [false, true]) {
            out.push({
              name: `${plan ?? 'necunoscut'}/admin=${isAdmin}/pickup=${pickupOnly}/multi=${multiLocation}/partner=${partner}`,
              surface,
              groups: visibleNavGroups({
                isAdmin,
                tier: general,
                money,
                pickupOnly,
                surface,
                isPartnerTab: partner ? isPartnerTab : null,
                multiLocation,
              }),
            })
          }
        }
      }
    }
  }
  return out
}

describe('etichetele navigării — cheile de dicționar', () => {
  it('NL1 fiecare sub-tab și grup: ro[cheie] === eticheta datelor, pe orice suprafață', () => {
    expect(driftProblems(NAV_GROUPS)).toEqual([])
  })

  it('NL2 grupurile vizibile: cheile dau etichetele afișate (inclusiv soloSubTab)', () => {
    const problems: string[] = []
    let solo = 0
    for (const c of visibleCases()) {
      for (const g of c.groups) {
        const gk = navGroupLabelKey(g, c.surface)
        if (RO[gk] !== g.label) problems.push(`${c.name} grup ${g.id}: ro[${gk}] ≠ ${g.label}`)
        if (g.soloSubTab && gk.startsWith('nav_')) solo++
        for (const st of g.subTabs) {
          const k = navLabelKey(st, c.surface)
          if (RO[k] !== st.label) problems.push(`${c.name} ${st.id}: ro[${k}] ≠ ${st.label}`)
        }
      }
    }
    expect(problems).toEqual([])
    // Anti-vacuitate: cazul „Comenzi = Rezervări” (Planul 1) chiar a fost atins.
    expect(solo).toBeGreaterThan(0)
  })

  it('NL3 nicio cheie de navigare orfană', () => {
    const produced = new Set<string>()
    for (const g of NAV_GROUPS) {
      produced.add(navGroupLabelKey(g, null))
      for (const st of g.subTabs) for (const s of SURFACES) produced.add(navLabelKey(st, s))
    }
    for (const c of visibleCases()) for (const g of c.groups) produced.add(navGroupLabelKey(g, c.surface))
    for (const variant of [
      'nav_settings-orders_noPayments',
      'nav_settings-orders_noOrdering',
      'nav_casa-marcat_noFiscal',
    ]) {
      expect(produced.has(variant)).toBe(true)
    }
    const orphans = Object.keys(ro).filter((k) => /^nav(Group)?_/.test(k) && !produced.has(k))
    expect(orphans).toEqual([])
  })

  it('NL4 control: un tab și un grup noi, fără cheie, sunt raportați', () => {
    const fakeTab: SubTab = { id: 'ecran-nou' as Tab, label: 'Ecran nou' }
    const withNewTab: NavGroup[] = NAV_GROUPS.map((g) =>
      g.id === 'meniu' ? { ...g, subTabs: [...g.subTabs, fakeTab] } : g,
    )
    const withNewGroup: NavGroup[] = [
      ...NAV_GROUPS,
      { id: 'grup-nou', label: 'Grup nou', icon: 'home', subTabs: [{ id: 'home', label: 'Acasă' }] },
    ]
    expect(driftProblems(withNewTab).some((p) => p.startsWith('ecran-nou:'))).toBe(true)
    expect(driftProblems(withNewGroup).some((p) => p.startsWith('grup grup-nou:'))).toBe(true)
  })

  it('NL5 în fiecare limbă: grupurile și chip-urile unui grup au nume distincte', () => {
    const problems: string[] = []
    const langs: ReadonlyArray<[string, Table]> = [
      ['ro', ro],
      ['en', en],
      ['fr', fr],
      ['de', de],
    ]
    const dupes = (xs: readonly unknown[]): unknown[] => xs.filter((x, i) => xs.indexOf(x) !== i)
    for (const [lang, dict] of langs) {
      const groupNames = NAV_GROUPS.map((g) => dict[navGroupLabelKey(g, null)])
      for (const d of dupes(groupNames)) problems.push(`${lang}: grup dublat „${String(d)}”`)
      for (const c of visibleCases()) {
        const shown = c.groups.map((g) => dict[navGroupLabelKey(g, c.surface)])
        for (const d of dupes(shown)) problems.push(`${lang} ${c.name}: grup dublat „${String(d)}”`)
        for (const g of c.groups) {
          const chips = g.subTabs.map((st) => dict[navLabelKey(st, c.surface)])
          for (const d of dupes(chips)) problems.push(`${lang} ${c.name} ${g.id}: chip dublat „${String(d)}”`)
        }
      }
    }
    expect([...new Set(problems)]).toEqual([])
  })
})
