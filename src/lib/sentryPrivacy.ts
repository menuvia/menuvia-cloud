// src/lib/sentryPrivacy.ts
// Ce date colectează Sentry din browser — sursa UNICĂ, citită de `Sentry.init`
// din main.tsx.
//
// De ce e explicit, categorie cu categorie: Sentry 11 a scos `sendDefaultPii`
// și a INVERSAT implicitul. În v10, opțiunea nesetată (sau `false`, cum o aveam)
// era restrictivă; în v11, un `dataCollection` nesetat colectează tot: date de
// utilizator (inclusiv IP-ul dedus din conexiune), cookie-uri, antete, corpurile
// cererilor și parametrii din URL. A scoate doar `sendDefaultPii` ca să treacă
// typecheck-ul ar fi trimis toate astea în SUA, tăcut (vezi migrarea 10→11 a
// SDK-ului). Pe meniul QR, oaspetele n-are cont: n-are ce căuta la Sentry nici
// IP-ul lui, nici telefonul din formularul de ridicare.
//
// `dataCollection` NU acoperă calea și fragmentul URL-ului (tokenul din /q/,
// /invite/, /echipa/, /sef-vanzari/; #access_token=… din linkul de resetare a
// parolei): pentru ele rămân hook-urile din main.tsx, toate prin
// `scrubTokenPathsDeep` — `beforeSend` (erori), `beforeSendSpan` (spanuri; în
// v11 se trimit în flux, iar `beforeSendTransaction` NU mai rulează) și
// `beforeBreadcrumb`. Sunt a doua plasă pentru categoriile de mai jos și
// SINGURA pentru căi.
import type { BrowserOptions } from '@sentry/react'

export type SentryDataCollection = NonNullable<BrowserOptions['dataCollection']>

// `satisfies`, nu adnotare: tipul obiectului își păstrează cheile, deci
// clichetul de mai jos poate cere ca fiecare categorie să fie SETATĂ aici, nu
// doar „decisă” într-o listă separată.
export const SENTRY_DATA_COLLECTION = {
  // Fără id/email/username completate automat și fără cererea ca serverul
  // Sentry să deducă IP-ul din conexiune.
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  // Explicit, nu „cade pe genAI”: în 11.9.0 configurația REZOLVATĂ pune `mcp`
  // pe `{ inputs: true, outputs: true }` (resolveDataCollectionOptions);
  // fallback-ul pe `genAI` e doar în instrumentarea MCP de azi, cu TODO(v12)
  // să citească valoarea rezolvată (recenzie CodeRabbit pe #323).
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies SentryDataCollection

// Cheile lăsate DELIBERAT pe implicit, fiecare cu motiv. `frameContextLines`:
// liniile din codul NOSTRU din jurul unui cadru de stivă, nu date de
// utilizator. Orice altă categorie se SETEAZĂ în obiectul de mai sus.
type DefaultedKey = 'frameContextLines'

type UnsetKey = Exclude<keyof SentryDataCollection, keyof typeof SENTRY_DATA_COLLECTION | DefaultedKey>

/**
 * Clichet la typecheck: orice categorie din `dataCollection` care nu e nici
 * setată în SENTRY_DATA_COLLECTION, nici trecută în `DefaultedKey`, face tipul
 * de aici `never`, deci atribuirea lui `true` pică. Prinde și o categorie NOUĂ
 * dintr-un SDK viitor (implicitul ei e, de la v11, COLECTAREA) și o cheie scoasă
 * din obiect din greșeală (cazul `mcp`, decisă pe hârtie dar nesetată).
 */
export const SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE: [UnsetKey] extends [never]
  ? true
  : never = true
