// Anti dublu-tap pe listele de staff care se RE-AȘAZĂ după o acțiune
// optimistă (ux-staff-double-tap-advance).
//
// „Gata" pe Bucătărie și „Servit" / „Închide comanda" pe Ospătar scot cardul
// din listă pe loc (update optimist), iar cardul de DEDESUBT urcă exact sub
// deget: al doilea tap al unui dublu-tap marca comanda VECINĂ. Lock-ul pe
// comandă din useOrders nu ajută aici — e altă comandă. Garda de mai jos
// ignoră un tap pe o acțiune rapidă venit la mai puțin de o fereastră de
// dublu-tap după tap-ul acceptat anterior.
//
// Două domenii, după ce face acțiunea acceptată:
//   - 'list' (implicit): acțiunea MUTĂ cardul (iese din listă / din coloană)
//     → în fereastră e respins orice tap, pe ORICE card: sub deget poate fi
//     acum vecinul;
//   - 'card': cardul rămâne pe loc (ex. „Confirmă" pe Bucătărie: new și
//     confirmed stau în aceeași coloană) → în fereastră e respins doar un tap
//     pe ACELAȘI card (cu RPC-ul rapid, butonul lui arată deja pasul următor).
//     Un tap pe alt card e DELIBERAT — bucătarul confirmă trei comenzi la rând
//     — și trece. Cu o singură fereastră globală, al doilea „Confirmă" era
//     înghițit tăcut.
//
// 500 ms ≈ pragul de dublu-tap al sistemelor de operare: o a doua acțiune
// DELIBERATĂ pe un card care s-a mutat (citești cardul următor, apeși)
// durează mai mult.

export const STAFF_TAP_GUARD_MS = 500

export type TapScope = 'list' | 'card'

/**
 * Întoarce o funcție care spune dacă tap-ul curent e acceptat. `key` = id-ul
 * comenzii; fără el, tap-ul e tratat ca acțiune care mută cardul ('list').
 */
export function createTapGuard(
  windowMs: number = STAFF_TAP_GUARD_MS,
  now: () => number = () => Date.now(),
): (key?: string, scope?: TapScope) => boolean {
  let lastListMove = Number.NEGATIVE_INFINITY
  const lastByKey = new Map<string, number>()
  // Diferență NEGATIVĂ = ceasul a sărit înapoi: nu blocăm tap-urile până
  // ajunge din urmă.
  const within = (t: number, at: number): boolean => t - at >= 0 && t - at < windowMs
  return (key, scope = 'list') => {
    const t = now()
    if (within(t, lastListMove)) return false
    if (key != null) {
      const prev = lastByKey.get(key)
      if (prev != null && within(t, prev)) return false
    }
    // Curățăm intrările ieșite din fereastră (o tabletă stă deschisă toată ziua).
    for (const [k, at] of lastByKey) if (!within(t, at)) lastByKey.delete(k)
    if (key != null) lastByKey.set(key, t)
    if (scope === 'list') lastListMove = t
    return true
  }
}
