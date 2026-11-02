// src/lib/roleRouting.ts
// Fiecare rol pe ecranul lui, și DUPĂ login, nu doar la login (lib/postLogin.ts).
//
// /dashboard nu avea gardă de rol: un ospătar sau un bucătar care deschidea
// /dashboard (bookmark, butonul Back, linkul din „Nu ai acces”) vedea editorul
// complet de meniu și mese — și fiecare salvare era refuzată de server. Acum
// rolul restaurantului ACTIV decide (RestaurantContext `activeRole`): cu
// membership-uri mixte (patron la A, ospătar la B) contează restaurantul ales,
// iar din /waiter sau /kitchen omul îl poate schimba cu selectorul de acolo.
// Owner, manager și partenerul (vizită de agent, mig 286) rămân pe /dashboard;
// rolul necunoscut (null — fără membership sau eroare de încărcare) la fel:
// acolo AppRouter arată onboarding-ul sau eroarea, nu o redirecționare oarbă.
import type { UiRole } from './partnerAccess'

export type StaffHomePath = '/waiter' | '/kitchen'

/** Ecranul de lucru al personalului pentru rolul activ; `null` = rămâne pe /dashboard. */
export function staffHomeForRole(role: UiRole | null): StaffHomePath | null {
  if (role === 'waiter') return '/waiter'
  if (role === 'kitchen') return '/kitchen'
  return null
}

/**
 * Unde duce butonul din ecranul „Nu ai acces la această pagină”. Înainte ducea
 * mereu la /dashboard — adică, pentru personal, înapoi în editorul pe care nu-l
 * poate folosi. Acum: ecranul rolului (bucătarul de pe /waiter → /kitchen),
 * altfel /dashboard.
 */
export function noAccessDestination(role: UiRole | null): StaffHomePath | '/dashboard' {
  return staffHomeForRole(role) ?? '/dashboard'
}

/**
 * Restaurantul implicit când nu există unul salvat (dispozitiv nou, cheie
 * ștearsă): întâi unul unde omul e OWNER, apoi MANAGER, abia apoi primul din
 * listă. Cu `rows[0]` (ordonat după restaurant_id) un patron care e și bucătar
 * în alt local putea porni pe localul de bucătărie — și garda de pe /dashboard
 * îl trimitea pe /kitchen din propriul cont. Ordinea din listă se păstrează în
 * interiorul fiecărui rol (stabilă de la o încărcare la alta).
 */
export function defaultActiveRestaurantId(
  rows: ReadonlyArray<{ restaurant_id: string; role: UiRole }>,
): string | null {
  const pick =
    rows.find((r) => r.role === 'owner') ?? rows.find((r) => r.role === 'manager') ?? rows[0]
  return pick?.restaurant_id ?? null
}
