// src/lib/salesContract.ts
// ─────────────────────────────────────────────────────────────────
// Textele contractelor de rețea, pe VERSIUNE. Sursa unică a documentului
// afișat la acceptare: clientul calculează sha256 pe EXACT textul de aici
// (`sha256Hex`), iar serverul păstrează versiunea + hash-ul în istoricul
// append-only al acceptărilor (mig 304).
//
// Harta e GOALĂ până când avocatul aprobă textul și fondatorul îl publică
// (docs/dosar/03*-contract-*-draft.md sunt DRAFT-uri și NU se leagă aici: o
// versiune marcată DRAFT nici nu poate fi publicată pe server). Consecința e
// FAIL-CLOSED: dacă serverul publică o versiune pe care acest bundle nu o
// conține, pagina de invitație NU permite acceptarea (nu se acceptă un document
// care nu a fost afișat).
//
// Procedura pentru o versiune nouă: adaugi intrarea AICI (cu textul final), faci
// deploy, abia apoi publici versiunea din FounderPage → „Rețea de vânzări”.
// ─────────────────────────────────────────────────────────────────
import type { SalesRole } from './salesNetwork'

export const SALES_CONTRACT_TEXTS: Readonly<
  Record<string, Readonly<Partial<Record<SalesRole, string>>>>
> = {}

/** Textul contractului pentru o versiune și un rol, sau `null` dacă bundle-ul nu-l are. */
export function contractTextFor(version: string | null, kind: SalesRole): string | null {
  if (version === null) return null
  // hasOwn: o versiune numită „constructor” / „__proto__” nu are voie să găsească
  // un membru moștenit al obiectului.
  if (!Object.prototype.hasOwnProperty.call(SALES_CONTRACT_TEXTS, version)) return null
  const text = SALES_CONTRACT_TEXTS[version][kind]
  return typeof text === 'string' && text.trim() !== '' ? text : null
}
