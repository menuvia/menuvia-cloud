// ─────────────────────────────────────────────────────────────
// Un preț tastat de om (lotul O5a, audit nov 2026 MENU-07).
//
// Câmpul de preț era `type="number"` și parsat la FIECARE tastă: când omul
// tasta „12.” browserul dădea „12” (sau gol → 0), deci următoarea cifră
// producea 125 — iar pe o tastatură românească „,” nu trecea deloc. Textul
// rămâne acum text; se transformă în număr doar ce are formă de preț.
// ─────────────────────────────────────────────────────────────

/** „12,50”, „12.5”, „12.”, „7” → număr; gol → null; orice altceva → NaN. */
export function parseDecimalInput(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(',', '.')
  if (t === '') return null
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return Number.NaN
  return Number.parseFloat(t)
}

/** Prețul de pornire în câmp: 0 (produs nou) = câmp gol. */
export function priceInputText(price: number | null | undefined): string {
  return price != null && price !== 0 ? String(price) : ''
}
