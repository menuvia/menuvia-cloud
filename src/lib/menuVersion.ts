// ─────────────────────────────────────────────────────────────
// Versiunea meniului public (mig 313: `get_menu_version`).
//
// Un hash care se schimbă la orice epuizare / deblocare și la orice editare de
// produse sau categorii. Meniul QR o întreabă când oaspetele REVINE în tab
// (`visibilitychange`) și refă meniul DOAR dacă s-a schimbat — un produs
// epuizat cât telefonul stătea în buzunar apare „Epuizat” fără un refetch
// complet la fiecare revenire.
//
// `fetchMenuVersion` NU aruncă: o sondă picată (rețea, RPC nedeployat) dă
// `null` = „nu știu”, iar „nu știu” NU declanșează refetch-ul.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase'

export async function fetchMenuVersion(restaurantId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_menu_version', {
      p_restaurant_id: restaurantId,
    })
    if (error) return null
    return typeof data === 'string' && data.length > 0 ? data : null
  } catch {
    return null
  }
}

/**
 * Trebuie refăcut meniul? `next` necunoscut → NU. Versiune de bază
 * necunoscută (prima sondă picase) + versiune cunoscută acum → DA, o dată:
 * nu putem ști ce s-a schimbat între timp.
 */
export function menuVersionChanged(prev: string | null, next: string | null): boolean {
  if (next == null) return false
  return prev !== next
}
