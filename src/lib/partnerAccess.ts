// partnerAccess.ts — logică PURĂ pentru accesul de partener (mig 286).
//
// Partenerul (afiliat) nu mai e „manager virtual" (mig 187). Primește acces DOAR
// după ce ownerul îl acordă, și DOAR pe meniu + mese/QR — iar în DB asta se
// aplică prin politici dedicate, nu prin funelul is_admin. Rolul „partner" există
// doar în UI (RestaurantContext): DB-ul nu are un rol de partener, iar
// `my_role()` întoarce null pentru el. UI-ul restrâns nu e securitate (RLS e),
// ci evită o interfață de manager goală și plină de erori de permisiune.
import type { MemberRole } from './constants'
import type { PartnerAccessState } from './founder'

// Rolul activ în UI: rolurile din DB + „partner" (vizită de afiliat).
export type UiRole = MemberRole | 'partner'

// Tab-urile dashboard-ului pe care le vede partenerul — exact suprafața pe care
// politicile de partener din DB o acoperă (meniu: produse/categorii/opțiuni;
// mese + QR). Orice alt tab ar interoga tabele pe care partenerul le vede goale.
export const PARTNER_TAB_IDS: readonly string[] = ['products', 'categories', 'modificatori', 'mese']

export function isPartnerTab(tabId: string): boolean {
  return PARTNER_TAB_IDS.includes(tabId)
}

// Tab-ul de pornire al partenerului (nu „home": Acasă citește comenzi/rapoarte).
export const PARTNER_DEFAULT_TAB = 'products'

// Rolul sintetic pentru o vizită „Intră pe cont" pe un restaurant fără
// membership real. `myRole` = rezultatul `my_role(restaurant)`: non-null doar
// pentru fondator (escape-ul is_platform_admin → manager virtual, mig 186);
// null pentru partener. Pe eroare de RPC (necunoscut) cădem pe „partner" —
// fail-closed pe UI: un fondator pe un blip vede un dashboard restrâns, nu
// invers (accesul real e oricum decis de RLS).
export function resolveVisitRole(
  myRole: string | null | undefined,
  rpcFailed: boolean,
): 'manager' | 'partner' {
  if (rpcFailed) return 'partner'
  return myRole != null ? 'manager' : 'partner'
}

export interface PartnerStateView {
  label: string
  tone: 'ok' | 'wait' | 'bad' | 'neutral'
}

// Etichete comune pentru ambele ecrane (Echipă la owner, Afiliat la partener).
export function describePartnerState(state: PartnerAccessState): PartnerStateView {
  switch (state) {
    case 'granted':
      return { label: 'Acces acordat', tone: 'ok' }
    case 'requested':
      return { label: 'Cerere trimisă', tone: 'wait' }
    case 'revoked':
      return { label: 'Acces revocat', tone: 'bad' }
    default:
      return { label: 'Fără acces', tone: 'neutral' }
  }
}
