// src/i18n/navLabels.ts — cheia de dicționar a etichetelor din navigarea
// panoului (lotul L3b). `lib/dashboardNav.ts` rămâne un modul de DATE, cu
// etichetele românești (testele vechi le citesc acolo, iar modulul nu are voie
// să tragă după el dicționare); traducerea se face la RANDARE: DashboardPage
// scrie `t(navLabelKey(st, surface))` în loc de `st.label`.
//
// Reguli, ținute de testul NL1–NL5 (`src/i18n/__tests__/navLabels.test.ts`):
//   - `navLabelKey` oglindește EXACT `subTabLabel` (aceleași ramuri pe plan),
//     iar în română valoarea cheii e eticheta datelor, caracter cu caracter;
//   - `navGroupLabelKey` oglindește `visibleNavGroups` pentru grupul cu un
//     singur sub-tab vizibil (`soloSubTab`: Comenzi pe Planul 1 = „Rezervări”);
//   - un tab nou în `NAV_GROUPS` fără cheie în `ns/dashboard/ro.ts` pică
//     testul, iar un tab nou în tipul `Tab` fără cheie nu compilează.
// Importurile sunt doar de TIP (șterse la compilare): modulul nu aduce nimic.
import type { StringKey } from './core'
import type dashboardRo from './ns/dashboard/ro'
import type { NavGroup, SubTab, Tab } from '../lib/dashboardNav'
import type { PlanSurface } from '../lib/planSurface'

type DashboardKey = StringKey<typeof dashboardRo>
export type NavLabelKey = Extract<DashboardKey, `nav_${string}` | `navGroup_${string}`>

// `satisfies`: fiecare id din `Tab` are cheia `nav_<id>` — altfel eroare de
// compilare aici, nu un text lipsă pe ecran.
const tabKey = (id: Tab): NavLabelKey => `nav_${id}` satisfies DashboardKey

// Variantele pe plan există doar pe câteva sub-tab-uri: testul NL1 verifică
// fiecare cheie produsă, deci cast-ul nu poate ascunde o cheie lipsă.
const variantKey = (id: Tab, variant: 'noPayments' | 'noOrdering' | 'noFiscal'): NavLabelKey =>
  `nav_${id}_${variant}` as NavLabelKey

/** Cheia etichetei unui sub-tab pe planul restaurantului — oglinda lui
 *  `subTabLabel` (lib/dashboardNav.ts). */
export function navLabelKey(st: SubTab, surface: PlanSurface | null): NavLabelKey {
  if (st.labelWithoutOrdering || st.labelWithoutPayments) {
    if (surface?.payments === true) return tabKey(st.id)
    if (surface?.ordering === true) {
      return st.labelWithoutPayments ? variantKey(st.id, 'noPayments') : tabKey(st.id)
    }
    return st.labelWithoutOrdering ? variantKey(st.id, 'noOrdering') : tabKey(st.id)
  }
  if (st.labelWithoutFiscal && surface?.fiscal !== true) return variantKey(st.id, 'noFiscal')
  return tabKey(st.id)
}

/** Cheia etichetei unui grup — pe un grup VIZIBIL (`visibleNavGroups`): cel al
 *  cărui singur sub-tab rămas e `soloSubTab` poartă numele sub-tab-ului. */
export function navGroupLabelKey(g: NavGroup, surface: PlanSurface | null): NavLabelKey {
  const only = g.subTabs.length === 1 ? g.subTabs[0] : undefined
  if (g.soloSubTab && only && only.id === g.soloSubTab.id) return navLabelKey(only, surface)
  return `navGroup_${g.id}` as NavLabelKey
}
