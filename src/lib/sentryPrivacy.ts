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

export const SENTRY_DATA_COLLECTION: SentryDataCollection = {
  // Fără id/email/username completate automat și fără cererea ca serverul
  // Sentry să deducă IP-ul din conexiune.
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  // Acoperă și categoria `mcp` acolo unde SDK-ul o are: cade pe `genAI` când
  // nu e setată.
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
}

// Cheile pe care le-am DECIS. `frameContextLines` rămâne pe implicit deliberat:
// sunt liniile din codul NOSTRU din jurul unui cadru de stivă, nu date de
// utilizator. `mcp` cade pe `genAI` (comentariul de mai sus).
type DecidedKey =
  | 'userInfo'
  | 'cookies'
  | 'httpHeaders'
  | 'httpBodies'
  | 'urlQueryParams'
  | 'graphQL'
  | 'genAI'
  | 'databaseQueryData'
  | 'queues'
  | 'stackFrameVariables'
  | 'mcp'
  | 'frameContextLines'

type UndecidedKey = Exclude<keyof SentryDataCollection, DecidedKey>

/**
 * Clichet la typecheck: dacă un SDK nou adaugă o categorie de date în
 * `dataCollection`, tipul de aici devine `never`, atribuirea lui `true` pică și
 * bump-ul nu trece până nu decide cineva categoria nouă. Implicitul unei
 * categorii noi e, de la v11, COLECTAREA — exact ce nu vrem să se întâmple tăcut.
 */
export const SENTRY_DATA_COLLECTION_IS_EXHAUSTIVE: [UndecidedKey] extends [never]
  ? true
  : never = true
