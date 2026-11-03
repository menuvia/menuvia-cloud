// Structura panoului (lotul R2, nov 2026): aceleași ecrane, fiecare într-un
// singur loc (lib/dashboardNav.ts). Testele țin harta vechi → nou și porțile.
//
//   NV1  SNAPSHOT pe id-urile și ordinea grupurilor și a sub-tab-urilor.
//        Mutația care pică: orice mutare / redenumire de id / reordonare.
//        Control: fiecare id apare O SINGURĂ dată (niciun ecran în două locuri —
//        exact cerința „fiecare lucru într-un singur loc").
//   NV2  fiecare sub-tab VECHI (structura de la a90a4cf, înghețată aici) are o
//        destinație, în grupul hărții; pe Planul 3, ca PROPRIETAR, fiecare ecran
//        de dinainte e accesibil. Mutația care pică: un sub-tab scos din
//        NAV_GROUPS (ecran pierdut) sau mutat în alt grup decât harta.
//        Control pozitiv: pe Planul 1 TVA NU e accesibil (filtrul e real, deci
//        „totul vizibil pe Planul 3" nu e vacuu).
//   NV3  porțile NU s-au mutat: poarta EFECTIVĂ a fiecărui ecran vechi (a
//        grupului vechi + a sub-tab-ului vechi) e egală cu cea nouă. Un sub-tab
//        mutat dintr-un grup `adminOnly` trebuie să-și ducă poarta cu el.
//        Mutația care pică: `adminOnly` scos de pe Stocuri / Ture de casă, sau
//        `minTier` schimbat pe orice sub-tab. Recenzia #335: pragul pe PLAN
//        (`minTierGeneral`) și cel pe BANI (`minTierMoney`, sub-tab cu `money`)
//        se țin SEPARAT și se compară pe COMPORTAMENT: vizibilitatea veche vs
//        nouă pe fiecare pereche (general, money) realizabilă — (1,1), (2,2),
//        (3,3) și (3,2), Planul 3 din afara RO (moneyTier coboară doar de la 3
//        la 2) — × admin × „doar ridicare". Un singur `minTier` contopit nu
//        spunea pe ce tier se compară pragul. Mutații care pică: `money` scos de
//        pe TVA / Facturi / Ture de casă (pe (3,2) ecranul de bani devine
//        vizibil), sau `money` pus pe Statistici (dispare pe (3,2)).
//   NV4  etichetele pe plan: „Comenzi & plăți" / „Comenzi" / „Meniu QR" (fost
//        `sectionLabel` din SettingsTab), „Casă & tichete" / „Imprimantă
//        bucătărie", iar grupul Comenzi pe Planul 1 poartă numele Rezervărilor.
//        Mutația care pică: eticheta citită fără plan; `soloSubTab` scos.
//   NV5  fiecare secțiune veche a Setărilor (pastilele interne restaurant /
//        menu / orders / account) e un sub-tab real în grupul Setări.
//        Mutația care pică: o secțiune fără sub-tab (cardurile ei ar dispărea).
//   NV6  `?tab=`: id cunoscut → el; `billing` → Abonament & cont; necunoscut,
//        gol, sau o cheie de pe prototip (`constructor`, `__proto__`) → null.
//        `dashboardPathFor` + `tabFromSearch` fac dus-întors pe fiecare tab.
//        Mutația care pică: căutarea aliasului cu `TAB_PARAM_ALIASES[raw]`
//        (prototipul), sau validarea id-ului scoasă.
//   NV7  „Toate locațiile" (lotul A, mig 314): ecran NOU (nu e în harta veche),
//        vizibil DOAR cu `multiLocation` ȘI rol de admin, pe orice plan; lipsa
//        câmpului din context = ascuns; partenerul nu-l vede. Mutațiile care
//        pică: `multiLocationOnly` scos de pe sub-tab (apare cu un singur
//        local), sau filtrul din visibleNavGroups scris `ctx.multiLocation !==
//        false` (lipsa = vizibil). `adminOnly` stă pe grup ȘI pe sub-tab, deci
//        ramura „ne-admin" pică DOAR dacă flag-ul e scos de pe AMBELE —
//        fiecare singur e mascat de celălalt (verificat pe modulul transpilat,
//        recenzia #344).
import { describe, it, expect } from 'vitest'
import {
  NAV_GROUPS,
  ALL_TABS,
  SETTINGS_SECTION_BY_TAB,
  TAB_PARAM_ALIASES,
  dashboardPathFor,
  settingsSectionOf,
  subTabLabel,
  tabFromSearch,
  visibleNavGroups,
  isSubTabVisible,
  type NavContext,
  type Tab,
} from '../dashboardNav'
import { surfaceTiers, type PlanTier } from '../features'
import { planSurface } from '../planSurface'
import { featuresFor, surfaceFor } from './planSurfaceFixtures'
import type { DbPlan } from './planFeatureMatrix.fixture'

function ctxFor(plan: DbPlan, over: Partial<NavContext> = {}): NavContext {
  const features = featuresFor(plan)
  const { general, money } = surfaceTiers(features)
  return {
    isAdmin: true,
    tier: general,
    money,
    pickupOnly: false,
    surface: planSurface(features),
    isPartnerTab: null,
    ...over,
  }
}

const visibleIds = (ctx: NavContext): Tab[] =>
  visibleNavGroups(ctx).flatMap((g) => g.subTabs.map((st) => st.id))

// Structura de DINAINTE de lotul R2 (DashboardPage.tsx la a90a4cf), cu porțile
// grupului și ale sub-tab-ului. Înghețată: e „vechiul" din harta vechi → nou.
interface OldGate {
  adminOnly?: boolean
  // Prag pe planul general (`tier`).
  minTierGeneral?: PlanTier
  // Prag pe tier-ul de BANI (`money`, mig 296) — doar pe sub-tab-uri.
  minTierMoney?: PlanTier
  hiddenPickupOnly?: boolean
}
const OLD: { group: string; gate: OldGate; subTabs: [string, OldGate][] }[] = [
  { group: 'acasa', gate: {}, subTabs: [['home', {}]] },
  {
    group: 'meniu',
    gate: {},
    subTabs: [
      ['products', {}],
      ['categories', {}],
      ['modificatori', { minTierGeneral: 2 }],
      ['happy-hour', { adminOnly: true, minTierGeneral: 2 }],
    ],
  },
  { group: 'comenzi', gate: { minTierGeneral: 2 }, subTabs: [['comenzi', {}]] },
  {
    group: 'mese-qr',
    gate: {},
    subTabs: [
      ['mese', {}],
      ['reservations', { adminOnly: true, hiddenPickupOnly: true }],
      ['arhitectura', { minTierGeneral: 3, hiddenPickupOnly: true }],
    ],
  },
  {
    group: 'rapoarte',
    gate: { adminOnly: true, minTierGeneral: 2 },
    subTabs: [
      ['raport', {}],
      ['analytics', { minTierGeneral: 3 }],
      ['tva', { minTierMoney: 3 }],
      ['casa-tura', { minTierMoney: 3 }],
      ['casa-marcat', { minTierGeneral: 2 }],
      ['invoices', { minTierMoney: 3 }],
      ['gestiune', { minTierGeneral: 2 }],
    ],
  },
  {
    group: 'setari',
    gate: { adminOnly: true },
    subTabs: [
      ['settings', {}],
      ['ai', { minTierGeneral: 2 }],
      ['echipa', { minTierGeneral: 2 }],
      ['ture', { minTierGeneral: 3 }],
    ],
  },
]

// Harta vechi → nou (grupul de destinație al fiecărui ecran vechi).
const OLD_TO_NEW: Record<string, string> = {
  home: 'acasa',
  products: 'meniu',
  categories: 'meniu',
  modificatori: 'meniu',
  'happy-hour': 'meniu',
  gestiune: 'meniu',
  comenzi: 'comenzi',
  reservations: 'comenzi',
  'casa-tura': 'comenzi',
  mese: 'mese-qr',
  arhitectura: 'mese-qr',
  raport: 'rapoarte',
  analytics: 'rapoarte',
  tva: 'rapoarte',
  invoices: 'rapoarte',
  settings: 'setari',
  ai: 'setari',
  echipa: 'setari',
  ture: 'setari',
  'casa-marcat': 'setari',
}

/** Vizibilitatea unei porți (grup + sub-tab), cu cele două praguri SEPARATE. */
function visibleAt(
  group: OldGate,
  sub: OldGate,
  at: { general: PlanTier; money: PlanTier; admin: boolean; pickupOnly: boolean },
): boolean {
  if ((group.adminOnly === true || sub.adminOnly === true) && !at.admin) return false
  if (Math.max(group.minTierGeneral ?? 0, sub.minTierGeneral ?? 0) > at.general) return false
  if (Math.max(group.minTierMoney ?? 0, sub.minTierMoney ?? 0) > at.money) return false
  if (sub.hiddenPickupOnly === true && at.pickupOnly) return false
  return true
}

// Perechile (general, money) care pot exista: money = general, sau 2 pe Planul 3
// din afara RO (moneyTier, lib/features.ts).
const REALIZABLE: [PlanTier, PlanTier][] = [
  [1, 1],
  [2, 2],
  [3, 3],
  [3, 2],
]
const SITUATIONS = REALIZABLE.flatMap(([general, money]) =>
  [true, false].flatMap((admin) =>
    [true, false].map((pickupOnly) => ({ general, money, admin, pickupOnly })),
  ),
)
const behaviour = (group: OldGate, sub: OldGate) =>
  SITUATIONS.map((at) => visibleAt(group, sub, at))

/** Porțile din NAV_GROUPS, în aceeași formă (`money` mută pragul pe tier-ul de bani). */
function gateOf(g: { adminOnly?: boolean; minTier?: PlanTier; money?: true; hiddenPickupOnly?: boolean }): OldGate {
  return {
    adminOnly: g.adminOnly,
    ...(g.money ? { minTierMoney: g.minTier } : { minTierGeneral: g.minTier }),
    hiddenPickupOnly: g.hiddenPickupOnly,
  }
}

function newGroupOf(id: string) {
  return NAV_GROUPS.find((g) => g.subTabs.some((st) => st.id === id)) ?? null
}

describe('dashboardNav — structura (lotul R2)', () => {
  it('NV1: id-urile și ordinea grupurilor și a sub-tab-urilor', () => {
    expect(NAV_GROUPS.map((g) => [g.id, g.subTabs.map((st) => st.id)])).toEqual([
      ['acasa', ['home']],
      ['locatii', ['locatii']],
      ['comenzi', ['comenzi', 'reservations', 'casa-tura']],
      ['meniu', ['products', 'categories', 'modificatori', 'happy-hour', 'gestiune']],
      ['mese-qr', ['mese', 'arhitectura']],
      ['rapoarte', ['raport', 'analytics', 'tva', 'invoices']],
      [
        'setari',
        [
          'settings',
          'settings-menu',
          'settings-orders',
          'echipa',
          'ture',
          'casa-marcat',
          'ai',
          'settings-account',
        ],
      ],
    ])
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      'Acasă',
      'Locații',
      'Comenzi',
      'Meniu',
      'Mese & QR',
      'Rapoarte',
      'Setări',
    ])
    // Control: fiecare ecran stă într-un singur loc.
    expect(new Set(ALL_TABS).size).toBe(ALL_TABS.length)
  })

  it('NV2: fiecare sub-tab vechi are o destinație; pe Planul 3 (proprietar) toate sunt accesibile', () => {
    const oldIds = OLD.flatMap((g) => g.subTabs.map(([id]) => id))
    expect(Object.keys(OLD_TO_NEW).sort()).toEqual([...oldIds].sort())
    for (const id of oldIds) {
      expect(newGroupOf(id)?.id, id).toBe(OLD_TO_NEW[id])
    }
    const proVisible = visibleIds(ctxFor('pro'))
    for (const id of oldIds) expect(proVisible, id).toContain(id as Tab)
    // Și secțiunile noi ale Setărilor (fosta „General").
    for (const id of ['settings-menu', 'settings-orders', 'settings-account'] as Tab[]) {
      expect(proVisible).toContain(id)
    }
    // Control pozitiv: filtrul e real — pe Planul 1 TVA și Live nu sunt accesibile.
    const starter = visibleIds(ctxFor('starter'))
    expect(starter).not.toContain('tva')
    expect(starter).not.toContain('comenzi')
    expect(starter).toContain('reservations')
  })

  it('NV3: poarta efectivă a fiecărui ecran vechi e neschimbată', () => {
    for (const g of OLD) {
      for (const [id, sub] of g.subTabs) {
        const ng = newGroupOf(id)
        const nst = ng?.subTabs.find((st) => st.id === id)
        if (!ng || !nst) throw new Error(`${id} lipsește din NAV_GROUPS`)
        expect(behaviour(gateOf(ng), gateOf(nst)), id).toEqual(behaviour(g.gate, sub))
      }
    }
    // Secțiunile noi ale Setărilor moștenesc poarta fostei „General" (`settings`).
    const setari = NAV_GROUPS.find((g) => g.id === 'setari')
    for (const id of ['settings-menu', 'settings-orders', 'settings-account']) {
      const st = setari?.subTabs.find((t) => t.id === id)
      if (!setari || !st) throw new Error(`${id} lipsește`)
      expect(behaviour(gateOf(setari), gateOf(st)), id).toEqual(behaviour({ adminOnly: true }, {}))
    }
    // Control: pragurile chiar sunt separate — TVA cere tier-ul de BANI, nu planul.
    const tva = newGroupOf('tva')?.subTabs.find((st) => st.id === 'tva')
    if (!tva) throw new Error('tva lipsește')
    expect(gateOf(tva)).toMatchObject({ minTierMoney: 3 })
    expect(gateOf(tva).minTierGeneral).toBeUndefined()
    const at32 = { general: 3 as PlanTier, money: 2 as PlanTier, admin: true, pickupOnly: false }
    expect(visibleAt({}, gateOf(tva), at32)).toBe(false)
    expect(isSubTabVisible(tva, true, 3, 2, false)).toBe(false)
    // …iar Statisticile (prag pe plan) rămân pe Planul 3 din afara RO.
    const analytics = newGroupOf('analytics')?.subTabs.find((st) => st.id === 'analytics')
    if (!analytics) throw new Error('analytics lipsește')
    expect(isSubTabVisible(analytics, true, 3, 2, false)).toBe(true)
    // Control: poarta e citită de filtru (managerul vede Stocurile, partenerul nu).
    const gestiune = newGroupOf('gestiune')?.subTabs.find((st) => st.id === 'gestiune')
    if (!gestiune) throw new Error('gestiune lipsește')
    expect(isSubTabVisible(gestiune, true, 2, 2, false)).toBe(true)
    expect(isSubTabVisible(gestiune, false, 2, 2, false)).toBe(false)
  })

  it('NV4: etichetele urmează planul', () => {
    const sub = (id: Tab) => {
      const st = NAV_GROUPS.flatMap((g) => g.subTabs).find((t) => t.id === id)
      if (!st) throw new Error(`${id} lipsește`)
      return st
    }
    const orders = sub('settings-orders')
    expect(subTabLabel(orders, surfaceFor('free'))).toBe('Meniu QR')
    expect(subTabLabel(orders, surfaceFor('starter'))).toBe('Meniu QR')
    expect(subTabLabel(orders, surfaceFor('growth'))).toBe('Comenzi')
    expect(subTabLabel(orders, surfaceFor('pro'))).toBe('Comenzi & plăți')
    expect(subTabLabel(orders, null)).toBe('Meniu QR')
    const casa = sub('casa-marcat')
    expect(subTabLabel(casa, surfaceFor('growth'))).toBe('Imprimantă bucătărie')
    expect(subTabLabel(casa, surfaceFor('pro'))).toBe('Casă & tichete')
    // Grupul Comenzi: pe Planul 1 doar Rezervările → numele și iconița lor.
    const comenzi = (plan: DbPlan) => visibleNavGroups(ctxFor(plan)).find((g) => g.id === 'comenzi')
    expect(comenzi('starter')).toMatchObject({ label: 'Rezervări', icon: 'calendar' })
    // Control: cu fluxul live grupul rămâne „Comenzi".
    expect(comenzi('growth')).toMatchObject({ label: 'Comenzi', icon: 'orders' })
    // Mod „doar ridicare" pe Planul 2: fără Rezervări, grupul e doar Live.
    expect(
      visibleNavGroups(ctxFor('growth', { pickupOnly: true }))
        .find((g) => g.id === 'comenzi')
        ?.subTabs.map((st) => st.id),
    ).toEqual(['comenzi'])
  })

  it('NV5: fiecare secțiune veche a Setărilor e un sub-tab în grupul Setări', () => {
    const setari = NAV_GROUPS.find((g) => g.id === 'setari')
    const ids = setari?.subTabs.map((st) => st.id) ?? []
    for (const section of ['restaurant', 'menu', 'orders', 'account'] as const) {
      const tab = (Object.keys(SETTINGS_SECTION_BY_TAB) as Tab[]).find(
        (t) => SETTINGS_SECTION_BY_TAB[t] === section,
      )
      expect(tab, section).toBeDefined()
      if (tab) {
        expect(ids, section).toContain(tab)
        expect(settingsSectionOf(tab)).toBe(section)
      }
    }
    // Control: ecranele separate din Setări nu sunt secțiuni ale formularului.
    for (const t of ['echipa', 'ture', 'casa-marcat', 'ai'] as Tab[]) {
      expect(settingsSectionOf(t), t).toBeNull()
    }
  })

  it('NV6: `?tab=` și calea panoului', () => {
    expect(tabFromSearch('?tab=tva')).toBe('tva')
    expect(tabFromSearch('?tab=billing')).toBe('settings-account')
    expect(TAB_PARAM_ALIASES.billing).toBe('settings-account')
    for (const bad of ['', '?tab=', '?tab=nu-exista', '?tab=constructor', '?tab=__proto__', '?tab=toString']) {
      expect(tabFromSearch(bad), bad).toBeNull()
    }
    expect(dashboardPathFor('home')).toBe('/dashboard')
    for (const t of ALL_TABS) {
      const path = dashboardPathFor(t)
      const search = path.includes('?') ? path.slice(path.indexOf('?')) : ''
      expect(tabFromSearch(search) ?? 'home', t).toBe(t)
    }
  })
})

describe('dashboardNav — „Toate locațiile" (lotul A)', () => {
  it('NV7: doar adminul cu ≥ 2 localuri vede ecranul, pe orice plan', () => {
    for (const plan of ['free', 'starter', 'growth', 'pro'] as DbPlan[]) {
      expect(visibleIds(ctxFor(plan, { multiLocation: true })), plan).toContain('locatii')
      expect(visibleIds(ctxFor(plan, { multiLocation: false })), plan).not.toContain('locatii')
      // Câmpul lipsă din context = ascuns (fail-closed).
      expect(visibleIds(ctxFor(plan)), plan).not.toContain('locatii')
      expect(
        visibleIds(ctxFor(plan, { multiLocation: true, isAdmin: false })),
        plan,
      ).not.toContain('locatii')
    }
    // Partenerul vede doar tab-urile politicilor lui.
    expect(
      visibleIds(ctxFor('pro', { multiLocation: true, isPartnerTab: (id) => id === 'products' })),
    ).not.toContain('locatii')
    const st = NAV_GROUPS.flatMap((g) => g.subTabs).find((t) => t.id === 'locatii')
    if (!st) throw new Error('locatii lipsește')
    expect(st.multiLocationOnly).toBe(true)
    // Titlul paginii.
    expect(subTabLabel(st, surfaceFor('growth'))).toBe('Toate locațiile')
  })
})
