// Anti dublu-tap pe listele de staff care se RE-AȘAZĂ după o acțiune
// optimistă (ux-staff-double-tap-advance).
//
// „Gata" pe Bucătărie și „Servit" / „Închide comanda" pe Ospătar scot cardul
// din listă pe loc (update optimist), iar cardul de DEDESUBT urcă exact sub
// deget: al doilea tap al unui dublu-tap marca comanda VECINĂ. Lock-ul pe
// comandă din useOrders nu ajută aici — e altă comandă. Garda de mai jos
// ignoră orice tap pe o acțiune rapidă venit la mai puțin de o fereastră de
// dublu-tap după tap-ul acceptat anterior, pe ORICE card.
//
// 500 ms ≈ pragul de dublu-tap al sistemelor de operare: o a doua acțiune
// DELIBERATĂ (citești cardul următor, apeși) durează mai mult.

export const STAFF_TAP_GUARD_MS = 500

/** Întoarce o funcție care spune dacă tap-ul curent e acceptat. */
export function createTapGuard(
  windowMs: number = STAFF_TAP_GUARD_MS,
  now: () => number = () => Date.now(),
): () => boolean {
  let lastAccepted = Number.NEGATIVE_INFINITY
  return () => {
    const t = now()
    if (t - lastAccepted < windowMs) return false
    lastAccepted = t
    return true
  }
}
