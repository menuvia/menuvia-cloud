// src/lib/routeEvents.ts
// Anunțul de navigare emis de `navigate()` din App (pushState nu emite nimic).
// Modul FĂRĂ importuri: App îl citește din chunk-ul de entry, iar
// TermsAcceptanceGate (încărcat lazy, doar cu sesiune) îl ascultă — constanta
// stă aici ca importul ei să nu tragă gate-ul înapoi în entry.
export const ROUTE_CHANGE_EVENT = 'menuvia:route'
