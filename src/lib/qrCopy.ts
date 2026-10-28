// ─────────────────────────────────────────────────────────────
// qrCopy.ts — textul tipărit pe cardurile QR ale meselor.
//
// Defectul (audit v3, S0): PDF-ul de QR-uri promitea „Scanează pentru a
// comanda" pe ORICE plan, dar pe Meniu Digital (Planul 1) comenzile prin QR
// nu există — serverul le respinge (feature `order_qr`, Gate A). Omul scana
// codul de pe masă, vedea doar un meniu, iar cardul tipărit rămânea pe masă.
// ─────────────────────────────────────────────────────────────

export interface QrCardSubtitles {
  ro: string
  en: string
}

/**
 * Subtitlul cardului QR. `canOrder` = planul permite comenzi prin QR
 * (`order_qr`). Apelantul dă `false` când planul nu e cunoscut: un card
 * tipărit care promite comenzi nu se mai poate retrage de pe mese.
 */
export function qrCardSubtitles(canOrder: boolean): QrCardSubtitles {
  return canOrder
    ? { ro: 'Scanează pentru a comanda', en: 'Scan to order' }
    : { ro: 'Scanează pentru a vedea meniul', en: 'Scan to see the menu' }
}
