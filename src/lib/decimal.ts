// ─────────────────────────────────────────────────────────────
// Un preț tastat de om (lotul O5a, audit nov 2026 MENU-07).
//
// Câmpul de preț era `type="number"` și parsat la FIECARE tastă: când omul
// tasta „12.” browserul dădea „12” (sau gol → 0), deci următoarea cifră
// producea 125 — iar pe o tastatură românească „,” nu trecea deloc. Textul
// rămâne acum text; se transformă în număr doar ce are formă de preț.
// ─────────────────────────────────────────────────────────────

const DECIMAL_SHAPE = /^\d+(\.\d*)?$|^\.\d+$/

// Spațiul din INTERIORUL sumei e acceptat doar ca separator de mii, în grupe
// de exact trei cifre („1 250,50”). Înainte orice spațiu se ștergea înainte
// de validare: „12 50” (spațiu tastat în loc de virgulă) devenea 1250, iar
// „1 2” devenea 12 — o sumă pe care omul n-a tastat-o, trimisă tăcut pe o
// cale de bani (recenzie CodeRabbit pe #392). `\s` prinde și spațiul
// neîntrerupt, pe care îl pun numerele formatate copiate.
const GROUPED_THOUSANDS = /^\d{1,3}(?:\s\d{3})+(?:[.,]\d*)?$/

/** Forma canonică („1250.50”), sau textul tăiat dacă nu are formă de sumă. */
function normalizeDecimalText(text: string): string {
  const t = text.trim()
  const ungrouped = GROUPED_THOUSANDS.test(t) ? t.replace(/\s+/g, '') : t
  return ungrouped.replace(',', '.')
}

/** „12,50”, „12.5”, „12.”, „7”, „1 250” → număr; gol → null; orice altceva → NaN. */
export function parseDecimalInput(text: string): number | null {
  const t = normalizeDecimalText(text)
  if (t === '') return null
  if (!DECIMAL_SHAPE.test(t)) return Number.NaN
  return Number.parseFloat(t)
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
