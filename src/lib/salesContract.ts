// src/lib/salesContract.ts
// ─────────────────────────────────────────────────────────────────
// Textele contractului de rețea, pe VERSIUNE. Sursa unică a documentului
// afișat la acceptare: clientul calculează sha256 pe EXACT textul de aici
// (`sha256Hex`), iar serverul păstrează versiunea + hash-ul în istoricul
// append-only al acceptărilor (mig 304).
//
// UN SINGUR text pe versiune, pentru AMBELE roluri: serverul publică o singură
// pereche `{version, text_hash}` (`admin_set_sales_contract_version`) și
// `sales_invite_redeem` compară hash-ul primit cu ACEA amprentă, indiferent dacă
// răscumpără un șef sau un agent. Două texte diferite pe rol (agent / șef) ar
// face ca cel puțin un rol să NU poată accepta niciodată — documentul unei
// versiuni trebuie deci să cuprindă ambele contracte (ex. secțiunea agentului
// și cea a șefului). Texte separate pe rol cer o migrație nouă (un hash pe rol).
//
// Harta e GOALĂ până când avocatul aprobă textul și fondatorul îl publică
// (docs/dosar/03*-contract-*-draft.md sunt DRAFT-uri și NU se leagă aici: o
// versiune marcată DRAFT nici nu poate fi publicată pe server). Consecința e
// FAIL-CLOSED pe ambele capete: FounderPage nu poate publica o versiune fără
// text în aplicație (nu are ce hash să trimită), iar pagina de invitație NU
// permite acceptarea dacă textul lipsește sau dacă sha256-ul lui diferă de
// amprenta publicată (nu se acceptă un document care nu a fost afișat).
//
// Procedura pentru o versiune nouă: adaugi intrarea AICI (cu textul final, o
// versiune NOUĂ — textul unei versiuni deja publicate nu se mai schimbă), faci
// deploy, abia apoi publici versiunea din FounderPage → „Rețea de vânzări”
// (panoul trimite versiunea ȘI sha256-ul textului de aici).
// ─────────────────────────────────────────────────────────────────

export const SALES_CONTRACT_TEXTS: Readonly<Record<string, string>> = {}

/** Textul contractului pentru o versiune, sau `null` dacă bundle-ul nu-l are. */
export function contractTextFor(version: string | null): string | null {
  if (version === null) return null
  // hasOwnProperty: o versiune numită „constructor” / „__proto__” nu are voie
  // să găsească un membru moștenit al obiectului.
  if (!Object.prototype.hasOwnProperty.call(SALES_CONTRACT_TEXTS, version)) return null
  const text: unknown = SALES_CONTRACT_TEXTS[version]
  return typeof text === 'string' && text.trim() !== '' ? text : null
}
