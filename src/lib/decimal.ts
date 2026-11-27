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

const DECIMAL_SHAPE = /^\d+(\.\d*)?$|^\.\d+$/

// Spațiul din INTERIORUL sumei e acceptat doar ca separator de mii, în grupe
// de exact trei cifre („1 250,50”). Înainte orice spațiu se ștergea înainte
// de validare: „12 50” (spațiu tastat în loc de virgulă) devenea 1250, iar
// „1 2” devenea 12 — o sumă pe care omul n-a tastat-o, trimisă tăcut pe o
// cale de bani (recenzie CodeRabbit pe #392). `\s` prinde și spațiul
// neîntrerupt, pe care îl pun numerele formatate copiate. Regula e aceeași
// pentru TOȚI cititorii de mai jos, inclusiv pentru prețurile din meniu și
// stocuri (lotul C4a): „4 50” la o opțiune nu mai e 450 de lei.
const GROUPED_THOUSANDS = /^\d{1,3}(?:\s\d{3})+(?:[.,]\d*)?$/

/** Forma canonică („1250.50”), sau textul tăiat dacă nu are formă de sumă. */
function normalizeDecimalText(text: string): string {
  const t = text.trim()
  const ungrouped = GROUPED_THOUSANDS.test(t) ? t.replace(/\s+/g, '') : t
  return ungrouped.replace(',', '.')
}

/**
 * „12,50”, „12.5”, „12.”, „7”, „1 250” → număr; gol → null; orice altceva → NaN.
 *
 * Și un număr prea MARE e NaN (recenzia lotului C4a): 309 cifre de 9 au formă
 * de preț, dar `parseFloat` le dă `Infinity`, care trecea de orice
 * `Number.isNaN` și pleca la server ca `null` în JSON — la plafonul Happy Hour,
 * `null` înseamnă „fără plafon”. Regula stă AICI, nu la fiecare câmp, ca toți
 * apelanții (preț, extra, opțiune, stoc, NIR, Happy Hour) s-o primească odată.
 */
export function parseDecimalInput(text: string): number | null {
  const t = normalizeDecimalText(text)
  if (t === '') return null
  if (!DECIMAL_SHAPE.test(t)) return Number.NaN
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * Ca `parseDecimalInput`, dar acceptă și un minus în față („-1,5”, „−1,5” cu
 * semnul tipografic pe care îl afișează lista): diferența de preț a unei
 * opțiuni poate fi o reducere mică (CHECK-ul din mig 120 o permite). Un minus
 * singur e NaN, iar „-0” e 0 (nu -0).
 *
 * Doar minusul (și spațiul de după el) se scoate aici; restul textului trece
 * NESCHIMBAT prin `parseDecimalInput`, deci regula spațiului din interior e
 * aceeași ca fără minus: „-1 250” e -1250, „-12 50” e NaN. Varianta veche
 * ștergea întâi TOATE spațiile, deci „-12 50” ar fi ieșit -1250, tăcut.
 */
export function parseSignedDecimalInput(text: string): number | null {
  const t = text.trim()
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

/**
 * Aceeași formă ca `parseDecimalInput`, dar direct în CENȚI întregi, rotunjiți
 * ZECIMAL la două zecimale, cu jumătatea în sus — ca `numeric(…, 2)` din
 * Postgres, unde ajunge suma. `Math.round(1.005 * 100)` dă 100, fiindcă 1,005
 * nu există în binar (produsul e 100,4999…), deci clientul ar fi trimis 1,00
 * unde serverul ar fi păstrat 1,01. Gol → null; orice altceva → NaN, inclusiv
 * o sumă care nu încape într-un întreg sigur de cenți (un „1” urmat de sute de
 * zerouri e finit ca lei, dar Infinity ca cenți).
 */
export function parseDecimalCents(text: string): number | null {
  const t = normalizeDecimalText(text)
  if (t === '') return null
  if (!DECIMAL_SHAPE.test(t)) return Number.NaN
  const [whole = '', frac = ''] = t.split('.')
  const roundUp = frac.length > 2 && frac.charAt(2) >= '5' ? 1 : 0
  const cents = Number((whole || '0') + frac.padEnd(2, '0').slice(0, 2)) + roundUp
  return Number.isSafeInteger(cents) ? cents : Number.NaN
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
