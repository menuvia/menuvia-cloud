// Cheile de idempotență pentru scrierile PUBLICE (fără cont): comandă QR,
// comandă pickup, rezervare. Aceeași disciplină peste tot, într-un singur loc:
//
//   * cheia trăiește în `sessionStorage`, ca să supraviețuiască închiderii unui
//     sheet, unui refresh de pagină sau unei reveniri cu Back între un răspuns
//     pierdut pe rețea și retrimitere — exact fereastra în care se produce
//     dublura;
//   * se rotește DOAR pe SUCCES, niciodată „la reset": o rotire prea devreme
//     face ca retrimiterea să pară o cerere nouă (dublură), iar una prea târziu
//     face ca următoarea cerere legitimă să fie deduplicată tăcut de server
//     (comandă/rezervare pierdută, fără niciun semn);
//   * `sessionStorage` poate LIPSI sau arunca (private mode, cotă depășită).
//     Atunci se cade pe o hartă la nivel de modul, care trăiește cât pagina —
//     adică fix cât sesiunea de comandă. O cheie nouă la fiecare apel ar fi
//     anulat exact protecția pentru care există mecanismul (audit v3, runda de
//     recenzie pe cheia pickup).
//
// Din RESID-15 fabrica asta e folosită de TOATE cele trei scrieri publice:
// comanda QR (`menuvia_idem:`), comanda pickup (`menuvia_idem_pickup:`) și
// rezervarea publică. Cheia QR era ultima pe `sessionStorage` direct, iar
// consecința nu era „cheia se pierde": `QrMenuPage` o citește în
// inițializatorul de `useState`, deci pe un browser care blochează cookie-urile
// throw-ul ajungea la `ErrorBoundary`-ul care înfășoară tot arborele și
// oaspetele primea ecran de eroare în loc de meniu.

export interface IdempotencyKeyStore {
  /** Cheia curentă pentru acest scope; o creează dacă nu există. */
  get(scope: string): string
  /** Cheie NOUĂ pentru scope. Se apelează DUPĂ un răspuns de succes. */
  rotate(scope: string): string
}

export function createIdempotencyKeyStore(prefix: string): IdempotencyKeyStore {
  const fallback = new Map<string, string>()
  const storageKeyFor = (scope: string) => prefix + scope

  return {
    get(scope: string): string {
      const storageKey = storageKeyFor(scope)
      try {
        let key = sessionStorage.getItem(storageKey)
        if (!key) {
          key = fallback.get(scope) ?? crypto.randomUUID()
          sessionStorage.setItem(storageKey, key)
        }
        fallback.set(scope, key)
        return key
      } catch {
        let key = fallback.get(scope)
        if (!key) {
          key = crypto.randomUUID()
          fallback.set(scope, key)
        }
        return key
      }
    },

    rotate(scope: string): string {
      const key = crypto.randomUUID()
      const storageKey = storageKeyFor(scope)
      // Fallback-ul se actualizează ÎNTOTDEAUNA; dacă scrierea persistentă
      // eșuează, ȘTERGEM cheia veche din storage — altfel un remount ar reciti
      // cheia cererii deja trimise și serverul ar deduplica tăcut cererea NOUĂ.
      fallback.set(scope, key)
      try {
        sessionStorage.setItem(storageKey, key)
      } catch {
        try {
          sessionStorage.removeItem(storageKey)
        } catch {
          /* storage complet indisponibil — fallback-ul din memorie e sursa */
        }
      }
      return key
    },
  }
}
