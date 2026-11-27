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

/**
 * „12,50”, „12.5”, „12.”, „7” → număr; gol → null; orice altceva → NaN.
 *
 * Și un număr prea MARE e NaN (recenzia lotului C4a): 309 cifre de 9 au formă
 * de preț, dar `parseFloat` le dă `Infinity`, care trecea de orice
 * `Number.isNaN` și pleca la server ca `null` în JSON — la plafonul Happy Hour,
 * `null` înseamnă „fără plafon”. Regula stă AICI, nu la fiecare câmp, ca toți
 * apelanții (preț, extra, opțiune, stoc, NIR, Happy Hour) s-o primească odată.
 */
export function parseDecimalInput(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(',', '.')
  if (t === '') return null
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return Number.NaN
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : Number.NaN
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

/**
 * Costul unitar de pornire pe un rând de NIR, la precizia COLOANEI
 * (`ingredients.cost_per_unit` e numeric(10,4), mig 026). Un ingredient pe
 * g/ml costă de regulă sub un ban pe unitate (făina la 3,5 lei/kg = 0,0035
 * lei/g): cu `toFixed(2)` câmpul pornea „0.00” — un 0 EXPLICIT, care trecea de
 * „Completează prețul unitar” și intra în costul mediu ponderat (mig 251; pe
 * stoc ≤ 0 costul devenea exact 0) — sau „0.01” (+67% la laptele de 0,006).
 * Textul trece neschimbat prin `parseDecimalInput` (fără exponent: sub 1e-7
 * `String` ar scrie „1e-7”, pe care parserul îl respinge). Un cost 0 sau care
 * la 4 zecimale ar ieși 0 lasă câmpul GOL, deci prețul se cere explicit.
 */
export function unitCostInputText(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return ''
  const rounded = Number(cost.toFixed(4))
  return rounded > 0 ? String(rounded) : ''
}
