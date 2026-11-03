// ─────────────────────────────────────────────────────────────
// dashboardNav — structura panoului (lotul R2, nov 2026): grupurile din bara
// laterală, sub-tab-urile lor și starea tab-ului în URL (`?tab=…`).
//
// Decizia fondatorului: aceleași ecrane, fiecare într-un SINGUR loc. Harta
// vechi → nou (testele `dashboardNav.test.ts` o țin):
//   Acasă      ← home
//   Locații    ← locatii („Toate locațiile", lotul A — doar pentru adminul cu
//                ≥ 2 localuri; NU e un ecran vechi mutat, e unul nou)
//   Comenzi    ← comenzi („Comenzi live”: un card spre /waiter + Bucătărie),
//                reservations (din Mese & QR), casa-tura (din Rapoarte)
//   Meniu      ← products, categories, modificatori, happy-hour,
//                gestiune (din Rapoarte)
//   Mese & QR  ← mese, arhitectura
//   Rapoarte   ← raport, analytics, tva, invoices
//   Setări     ← settings (fostele pastile interne devin sub-tab-uri:
//                Restaurant / Aspect meniu / Comenzi & plăți / Abonament & cont),
//                echipa, ture, casa-marcat (din Rapoarte), ai
//
// Gate-urile NU s-au mutat: `minTier`/`money`/`adminOnly`/`hiddenPickupOnly`
// sunt exact cele de dinainte, pe fiecare sub-tab (un sub-tab mutat dintr-un
// grup `adminOnly` primește `adminOnly` pe el, ca să nu-și piardă poarta).
// Ce vede planul în interiorul tab-urilor rămâne `planSurface`
// (lib/planSurface.ts); aici se decide doar ÎN CE LOC stă fiecare ecran.
// Gating-ul REAL e server-side (RPC/RLS).
// ─────────────────────────────────────────────────────────────
import type { IconName } from '../components/ui/Icon'
import type { PlanTier } from './features'
import type { PlanSurface } from './planSurface'

export type Tab =
  | 'home'
  | 'locatii'
  | 'products'
  | 'categories'
  | 'modificatori'
  | 'mese'
  | 'comenzi'
  | 'analytics'
  | 'echipa'
  | 'raport'
  | 'arhitectura'
  | 'ture'
  | 'gestiune'
  | 'tva'
  | 'casa-tura'
  | 'casa-marcat'
  | 'happy-hour'
  | 'invoices'
  | 'reservations'
  // Setări: 'settings' rămâne id-ul secțiunii Restaurant, ca linkurile vechi
  // (`/dashboard?tab=settings` din emailuri deja trimise) să meargă în continuare.
  // Cererea de acces a agentului (AgentCard) NU e aici, ci pe Acasă.
  | 'settings'
  | 'settings-menu'
  | 'settings-orders'
  | 'settings-account'
  | 'ai'

export interface SubTab {
  id: Tab
  label: string
  adminOnly?: boolean
  minTier?: PlanTier
  // Suprafață de BANI/BON: minTier se compară cu tier-ul `money` (moneyTier —
  // coborât sub 3 în afara RO, mig 296), nu cu planul. Pe RO identic.
  money?: true
  // Ascuns în modul „doar ridicare" (food truck) — mese/rezervări fără sens.
  hiddenPickupOnly?: boolean
  // Eticheta pe un plan FĂRĂ bon (planSurface.fiscal false): pe Planul 2 fila
  // casei de marcat e doar imprimanta din bucătărie (lotul P).
  labelWithoutFiscal?: string
  // Numele secțiunii „Comenzi & plăți" după ce ARE planul (lotul P, fost
  // `sectionLabel` din SettingsTab): fără plăți „Comenzi", fără comenzi
  // „Meniu QR". Planul necunoscut ia varianta cea mai restrictivă.
  labelWithoutPayments?: string
  labelWithoutOrdering?: string
  // Doar pentru adminul cu ≥ 2 localuri la care e admin (lotul A, decizia
  // fondatorului): „Toate locațiile". Numărul vine din RestaurantContext
  // (lib/locations.ts `hasMultipleLocations`).
  multiLocationOnly?: true
}

export interface NavGroup {
  id: string
  label: string
  icon: IconName
  adminOnly?: boolean
  minTier?: PlanTier
  // Un grup al cărui singur sub-tab vizibil e acesta poartă numele și iconița
  // lui: pe Planul 1 „Comenzi" are doar Rezervările (modulul e permis pe orice
  // plan, mig 086), iar un grup numit „Comenzi" pe un plan fără comenzi ar
  // contrazice lotul P.
  soloSubTab?: { id: Tab; icon: IconName }
  subTabs: SubTab[]
}

export const NAV_GROUPS: NavGroup[] = [
  { id: 'acasa', label: 'Acasă', icon: 'home', subTabs: [{ id: 'home', label: 'Acasă' }] },
  {
    id: 'locatii',
    label: 'Locații',
    icon: 'mapPin',
    adminOnly: true,
    subTabs: [
      { id: 'locatii', label: 'Toate locațiile', adminOnly: true, multiLocationOnly: true },
    ],
  },
  {
    id: 'comenzi',
    label: 'Comenzi',
    icon: 'orders',
    // Fără minTier pe grup: Rezervările sunt pe TOATE planurile (mig 086).
    // Fluxul live și casa au porțile lor pe sub-tab.
    soloSubTab: { id: 'reservations', icon: 'calendar' },
    subTabs: [
      { id: 'comenzi', label: 'Comenzi live', minTier: 2 },
      // adminOnly: ospătarii au deja rezervările în WaiterPage.
      { id: 'reservations', label: 'Rezervări', adminOnly: true, hiddenPickupOnly: true },
      // Mutat din Rapoarte (grup adminOnly) — poarta de rol rămâne pe sub-tab.
      { id: 'casa-tura', label: 'Ture de casă', adminOnly: true, minTier: 3, money: true },
    ],
  },
  {
    id: 'meniu',
    label: 'Meniu',
    icon: 'menu',
    subTabs: [
      { id: 'products', label: 'Produse' },
      { id: 'categories', label: 'Categorii' },
      { id: 'modificatori', label: 'Opțiuni', minTier: 2 },
      { id: 'happy-hour', label: 'Promoții', adminOnly: true, minTier: 2 },
      // Stocuri = feature `stocks` (growth+, mig 142). Mutat din Rapoarte
      // (grup adminOnly) — poarta de rol rămâne pe sub-tab.
      { id: 'gestiune', label: 'Stocuri', adminOnly: true, minTier: 2 },
    ],
  },
  {
    id: 'mese-qr',
    label: 'Mese & QR',
    icon: 'table',
    subTabs: [
      { id: 'mese', label: 'Mese & QR-uri' },
      // Harta sălii (FloorPlanEditor) = feature `floor_plan` (pro/enterprise),
      // gate server mig 154.
      { id: 'arhitectura', label: 'Hartă sală', minTier: 3, hiddenPickupOnly: true },
    ],
  },
  {
    id: 'rapoarte',
    label: 'Rapoarte',
    icon: 'chart',
    adminOnly: true,
    minTier: 2,
    subTabs: [
      { id: 'raport', label: 'Vânzări' },
      { id: 'analytics', label: 'Statistici', minTier: 3 },
      { id: 'tva', label: 'TVA', minTier: 3, money: true },
      { id: 'invoices', label: 'Facturi', minTier: 3, money: true },
    ],
  },
  {
    id: 'setari',
    label: 'Setări',
    icon: 'settings',
    adminOnly: true,
    subTabs: [
      { id: 'settings', label: 'Restaurant' },
      { id: 'settings-menu', label: 'Aspect meniu' },
      {
        id: 'settings-orders',
        label: 'Comenzi & plăți',
        labelWithoutPayments: 'Comenzi',
        labelWithoutOrdering: 'Meniu QR',
      },
      { id: 'echipa', label: 'Echipă', minTier: 2 },
      { id: 'ture', label: 'Program echipă', minTier: 3 },
      // Tichete bucătărie = growth+ (mig 227); fiscalul rămâne tier 3 în tab.
      // Mutat din Rapoarte (ambele grupuri sunt adminOnly).
      {
        id: 'casa-marcat',
        label: 'Casă & tichete',
        labelWithoutFiscal: 'Imprimantă bucătărie',
        minTier: 2,
      },
      { id: 'ai', label: 'Asistent AI', minTier: 2 },
      // Abonamentul (doar proprietarul), planul, MFA, GDPR, ieșirea din cont.
      { id: 'settings-account', label: 'Abonament & cont' },
      // „Consum AI (fondator)" e în /founder, nu aici: e un raport al
      // PLATFORMEI, nu al restaurantului.
    ],
  },
]

/** Toate id-urile de tab cunoscute (pentru validarea `?tab=`). */
export const ALL_TABS: readonly Tab[] = NAV_GROUPS.flatMap((g) => g.subTabs.map((st) => st.id))

// Secțiunile formularului de Setări (SettingsTab): un SINGUR formular, deci o
// singură instanță montată cât timp treci între ele (modificările nesalvate
// rămân). Echipă / Program / Casă / AI sunt ecrane separate.
export type SettingsSection = 'restaurant' | 'menu' | 'orders' | 'account'

export const SETTINGS_SECTION_BY_TAB: Partial<Record<Tab, SettingsSection>> = {
  settings: 'restaurant',
  'settings-menu': 'menu',
  'settings-orders': 'orders',
  'settings-account': 'account',
}

export function settingsSectionOf(tab: Tab): SettingsSection | null {
  return SETTINGS_SECTION_BY_TAB[tab] ?? null
}

export function isSubTabVisible(
  st: SubTab,
  isAdmin: boolean,
  tier: PlanTier,
  moneyTierValue: PlanTier,
  pickupOnly: boolean,
): boolean {
  if (st.adminOnly && !isAdmin) return false
  if (st.minTier && (st.money ? moneyTierValue : tier) < st.minTier) return false
  // Mod „doar ridicare" (food truck): mesele/rezervările nu au sens.
  if (st.hiddenPickupOnly && pickupOnly) return false
  return true
}

/** Eticheta sub-tab-ului pe planul restaurantului (planSurface). */
export function subTabLabel(st: SubTab, surface: PlanSurface | null): string {
  if (st.labelWithoutOrdering || st.labelWithoutPayments) {
    if (surface?.payments === true) return st.label
    if (surface?.ordering === true) return st.labelWithoutPayments ?? st.label
    return st.labelWithoutOrdering ?? st.label
  }
  if (st.labelWithoutFiscal && surface?.fiscal !== true) return st.labelWithoutFiscal
  return st.label
}

export interface NavContext {
  isAdmin: boolean
  tier: PlanTier
  money: PlanTier
  pickupOnly: boolean
  surface: PlanSurface | null
  // Partenerul (mig 286) vede DOAR tab-urile acoperite de politicile lui.
  isPartnerTab: ((id: Tab) => boolean) | null
  // Adminul are ≥ 2 localuri la care e admin („Toate locațiile", lotul A).
  // Lipsă = fals: ecranul nu apare.
  multiLocation?: boolean
}

/**
 * Grupurile vizibile pe rol + plan + mod, cu etichetele finale. Un grup fără
 * niciun sub-tab vizibil dispare complet din bara laterală.
 */
export function visibleNavGroups(ctx: NavContext): NavGroup[] {
  return NAV_GROUPS.map((g) => {
    const subTabs = g.subTabs
      .filter(
        (st) =>
          isSubTabVisible(st, ctx.isAdmin, ctx.tier, ctx.money, ctx.pickupOnly) &&
          // „Toate locațiile" (lotul A): doar cu ≥ 2 localuri de admin.
          (!st.multiLocationOnly || ctx.multiLocation === true) &&
          (ctx.isPartnerTab == null || ctx.isPartnerTab(st.id)),
      )
      .map((st) => ({ ...st, label: subTabLabel(st, ctx.surface) }))
    const only = subTabs.length === 1 ? subTabs[0] : undefined
    if (g.soloSubTab && only && only.id === g.soloSubTab.id) {
      return { ...g, label: only.label, icon: g.soloSubTab.icon, subTabs }
    }
    return { ...g, subTabs }
  }).filter(
    (g) =>
      (!g.adminOnly || ctx.isAdmin) &&
      (!g.minTier || ctx.tier >= g.minTier) &&
      g.subTabs.length > 0,
  )
}

// ── Starea în URL ───────────────────────────────────────────
// `?tab=billing` e ținta CTA-urilor din emailurile de facturare (și din
// PricingPage): cardul „Abonament & facturare" stă în Setări → Abonament & cont.
export const TAB_PARAM_ALIASES: Readonly<Record<string, Tab>> = {
  billing: 'settings-account',
}

/**
 * Tab-ul cerut de `?tab=…` (alias rezolvat), sau `null` când parametrul lipsește
 * ori nu e un tab cunoscut — apelantul cade atunci pe Acasă. Dacă tab-ul e
 * PERMIS pe plan/rol decide panoul, după ce planul e cunoscut.
 */
export function tabFromSearch(search: string): Tab | null {
  const raw = new URLSearchParams(search).get('tab')
  if (!raw) return null
  // `hasOwnProperty`, nu `TAB_PARAM_ALIASES[raw]`: `?tab=constructor` ar găsi
  // altfel funcția de pe prototip și ar întoarce-o drept „tab".
  if (Object.prototype.hasOwnProperty.call(TAB_PARAM_ALIASES, raw)) return TAB_PARAM_ALIASES[raw]
  return ALL_TABS.find((t) => t === raw) ?? null
}

/** Calea panoului pentru un tab (Acasă = fără parametru). */
export function dashboardPathFor(tab: Tab): string {
  return tab === 'home' ? '/dashboard' : `/dashboard?tab=${encodeURIComponent(tab)}`
}
