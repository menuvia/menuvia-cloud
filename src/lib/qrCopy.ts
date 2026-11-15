// ─────────────────────────────────────────────────────────────
// qrCopy.ts — textul tipărit pe cardurile QR ale meselor.
//
// Defectul (audit v3, S0): PDF-ul de QR-uri promitea „Scanează pentru a
// comanda" pe ORICE plan, dar pe Meniu Digital (Planul 1) comenzile prin QR
// nu există — serverul le respinge (feature `order_qr`, Gate A). Omul scana
// codul de pe masă, vedea doar un meniu, iar cardul tipărit rămânea pe masă.
//
// Limba cardului (lotul L6a): cardul tipărit e pentru OASPETE, nu pentru
// personal, deci urmează LIMBA DE BAZĂ A MENIULUI (`restaurants.language`,
// lotul O6a; nul / necunoscut = ro), NU limba interfeței personalului. Prima
// linie e în limba de bază, a doua în engleză dacă baza nu e engleza; pe un
// meniu englezesc cardul are o singură linie. Pe un restaurant românesc
// cardul rămâne exact cel de dinainte (ro + en). Tabela e PURĂ, în cele 7
// limbi ale meniului (MENU_LANGS / PUBLIC_MENU_STRINGS) — nu e un namespace
// al personalului (QC1 cere aceleași coduri ca MENU_LANGS).
//
// Fontul (QC6): jsPDF desenează cu Helvetica standard, în codarea WinAnsi
// (cp1252). Diacriticele românești NU sunt desenate: `patchPdfDiacritics`
// (lib/pdf.ts) le TRANSLITEREAZĂ la tipărire (ș→s, ț→t, ă→a, inclusiv â/î).
// Aceeași regulă — caracterul pe care fontul nu-l are devine cel mai apropiat
// pe care îl are — se aplică aici pentru maghiară: ő→ö, ű→ü (și majusculele),
// literele cu dublu accent ascuțit NU sunt în WinAnsi, iar ö/ü sunt; varianta
// ASCII (o/u) ar fi schimbat vocala. é/á/í/ó/ú/ü/ñ/à/è/ç/ä/ß etc. SUNT în
// WinAnsi și rămân. `qrPdfText` se aplică tuturor textelor cardului (și
// numelor de restaurant / mese, date care pot conține ő/ű); textele românești
// trec prin el NESCHIMBATE (transliterarea lor rămâne a patch-ului).
// ─────────────────────────────────────────────────────────────

/** Limbile de bază ale meniului (aceleași 7 ca MENU_LANGS / CHECK-ul din mig 298). */
export const QR_CARD_LANGS = ['ro', 'en', 'de', 'fr', 'it', 'hu', 'es'] as const
export type QrCardLang = (typeof QR_CARD_LANGS)[number]

/** Subtitlul cardului în fiecare limbă a meniului (`ro`/`en` = cele de dinainte). */
export type QrCardSubtitles = Record<QrCardLang, string>

const ORDER: QrCardSubtitles = {
  ro: 'Scanează pentru a comanda',
  en: 'Scan to order',
  de: 'Zum Bestellen scannen',
  fr: 'Scannez pour commander',
  it: 'Scansiona per ordinare',
  hu: 'Olvasd be a rendeléshez',
  es: 'Escanea para pedir',
}

const MENU: QrCardSubtitles = {
  ro: 'Scanează pentru a vedea meniul',
  en: 'Scan to see the menu',
  de: 'Zur Speisekarte scannen',
  fr: 'Scannez pour voir le menu',
  it: 'Scansiona per vedere il menu',
  hu: 'Olvasd be az étlap megtekintéséhez',
  es: 'Escanea para ver el menú',
}

/**
 * Subtitlul cardului QR, în toate limbile meniului. `canOrder` = planul
 * permite comenzi prin QR (`order_qr`). Apelantul dă `false` când planul nu e
 * cunoscut: un card tipărit care promite comenzi nu se mai poate retrage de
 * pe mese.
 */
export function qrCardSubtitles(canOrder: boolean): QrCardSubtitles {
  return { ...(canOrder ? ORDER : MENU) }
}

/** Limba de bază a meniului pentru card: una din cele 7, altfel `ro`. */
export function qrCardLang(language: string | null | undefined): QrCardLang {
  return (QR_CARD_LANGS as readonly string[]).includes(language ?? '') ? (language as QrCardLang) : 'ro'
}

/**
 * Liniile tipărite sub QR, în ordine: limba de bază, apoi engleza dacă baza
 * nu e engleza. Pe `ro` = exact `[ro, en]` de dinainte.
 */
export function qrCardLines(subtitles: QrCardSubtitles, language: string | null | undefined): string[] {
  const base = qrCardLang(language)
  return base === 'en' ? [subtitles.en] : [subtitles[base], subtitles.en]
}

const PDF_FALLBACK: Readonly<Record<string, string>> = { ő: 'ö', ű: 'ü', Ő: 'Ö', Ű: 'Ü' }

/** Textul cardului cu literele pe care Helvetica/WinAnsi nu le are înlocuite
 *  cu cel mai apropiat glif pe care îl are (ő→ö, ű→ü). Româna trece neatinsă. */
export function qrPdfText(s: string): string {
  return s.replace(/[őűŐŰ]/g, (c) => PDF_FALLBACK[c] ?? c)
}
