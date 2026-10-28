// src/lib/postLoginRedirect.ts
// Ieșirea din /auth după login: UN singur mecanism, mereu `replace`.
//
// Defectul prins de E2E (03-dashboard-nav „back button does not redirect to
// /auth"): după login, două căi independente duc omul din /auth — efectul de
// auto-redirect din App.tsx (async) și `onSuccess` din AuthPage (async de când
// destinația pe rol se citește din bază). Dacă `onSuccess` ajungea primul, făcea
// PUSH (/auth → /dashboard), iar efectul înlocuia apoi intrarea NOUĂ: intrarea
// /auth rămânea în istoric și Back ducea înapoi pe ea.
//
// Regula: orice ieșire din /auth se face cu `replace` (intrarea /auth dispare, în
// ORICE ordine de execuție) și doar cât omul este încă pe /auth — cine ajunge al
// doilea vede că drumul a fost deja ales și nu-l suprascrie (nici cu aceeași
// destinație, nici cu una diferită).

export interface AuthExitEnv {
  /** Calea curentă din bara de adrese. */
  pathname: () => string
  /** `history.replaceState` + re-sincronizarea rutei; NU adaugă intrare în istoric. */
  replace: (path: string) => void
}

/**
 * Înlocuiește intrarea /auth cu `dest`. Întoarce `true` dacă a făcut-o și `false`
 * dacă omul nu mai e pe /auth (altă cale de redirect a ajuns prima).
 */
export function leaveAuth(env: AuthExitEnv, dest: string): boolean {
  if (env.pathname() !== '/auth') return false
  env.replace(dest)
  return true
}
