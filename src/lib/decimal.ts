// ─────────────────────────────────────────────────────────────
// Un preț tastat de om (lotul O5a, audit nov 2026 MENU-07).
//
// Câmpul de preț era `type="number"` și parsat la FIECARE tastă: când omul
// tasta „12.” browserul dădea „12” (sau gol → 0), deci următoarea cifră
// producea 125 — iar pe o tastatură românească „,” nu trecea deloc. Textul
// rămâne acum text; se transformă în număr doar ce are formă de preț.
//
// Lotul C4a a dus regula și în restul meniului și al stocurilor (prețul
// opțiunii, al extra-ului, ingredientul, NIR-ul, Happy Hour): acolo
// `parseFloat(text) || 0` făcea din „4,50” o opțiune GRATUITĂ, iar un preț
// unitar de 0 intra în costul mediu ponderat (mig 251). Un text fără formă
// de număr e acum o EROARE lângă câmp, niciodată un 0 tăcut.
// ─────────────────────────────────────────────────────────────

/** „12,50”, „12.5”, „12.”, „7” → număr; gol → null; orice altceva → NaN. */
export function parseDecimalInput(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(',', '.')
  if (t === '') return null
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return Number.NaN
  return Number.parseFloat(t)
}

/**
 * Ca `parseDecimalInput`, dar acceptă și un minus în față („-1,5”, „−1,5” cu
 * semnul tipografic pe care îl afișează lista): diferența de preț a unei
 * opțiuni poate fi o reducere mică (CHECK-ul din mig 120 o permite). Un minus
 * singur e NaN, iar „-0” e 0 (nu -0).
 */
export function parseSignedDecimalInput(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '')
  if (t === '') return null
  const negative = t.startsWith('-') || t.startsWith('−')
  const n = parseDecimalInput(negative ? t.slice(1) : t)
  if (n == null) return Number.NaN
  if (Number.isNaN(n)) return n
  return negative && n !== 0 ? -n : n
}

/** Valoarea pentru o PREVIZUALIZARE (totalul unui rând de NIR): gol sau invalid → 0. */
export function decimalOrZero(text: string): number {
  const n = parseDecimalInput(text)
  return n == null || Number.isNaN(n) ? 0 : n
}

/** Prețul de pornire în câmp: 0 (produs nou) = câmp gol. */
export function priceInputText(price: number | null | undefined): string {
  return price != null && price !== 0 ? String(price) : ''
}
