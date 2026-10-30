// ─────────────────────────────────────────────────────────────
// qrTokens.ts — când e voie să se creeze un token QR nou pentru o masă.
//
// Un token NOU activ DEZACTIVEAZĂ tokenul activ vechi al mesei (trigger
// trg_single_active_qr_token, mig 119): QR-ul deja TIPĂRIT și lipit pe masă
// încetează să funcționeze. Deci „masa n-are QR” trebuie să fie un FAPT citit
// din bază, nu ce rămâne când citirea a picat.
//
// Defectul (code-health-qr-token-unknown-rotates): în Mese & QR, o citire picată
// a token-urilor (blip de rețea) era ignorată — `ensureTokens` (rulat la fiecare
// salvare de masă și la generarea în lot) vedea atunci TOATE mesele „fără QR” și
// inseră câte un token nou pentru fiecare, adică rotea tăcut QR-urile tipărite
// ale întregului restaurant; lista afișa la fel „Fără QR” cu un „Generează QR”
// care rotea masa dintr-o apăsare, fără confirmare.
// ─────────────────────────────────────────────────────────────

/**
 * Mesele cărora le lipsește tokenul activ. `null` = NU se știe (citirea
 * token-urilor activi a picat sau n-a întors nimic): apelantul nu generează
 * nimic — un token nou ar opri QR-ul tipărit al mesei.
 */
export function tablesMissingActiveToken(
  tableIds: readonly string[],
  active: { data: ReadonlyArray<{ table_id: string }> | null; error: unknown },
): string[] | null {
  if (active.error || !active.data) return null
  const covered = new Set(active.data.map((r) => r.table_id))
  return tableIds.filter((id) => !covered.has(id))
}
