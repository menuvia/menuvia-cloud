// ─────────────────────────────────────────────────────────────
// fiscalCurrency — moneda meniului pe un restaurant cu bon fiscal (mig 334)
// ─────────────────────────────────────────────────────────────
// Regula de aur: bani + bon fiscal = Planul 3. Bonul (FiscalNet), factura
// Oblio și plata online sunt în lei, deci pe un restaurant cu bon fiscal
// moneda meniului e RON. AUTORITATEA e serverul (mig 334): la CITIRE
// `public_menu_currency` în proiecțiile anon (oaspetele vede lei oricum ar fi
// salvată moneda), la SCRIERE `trg_restaurants_fiscal_currency_ron` (hint
// `fiscal_currency_ron_only`). Aici e doar ce ARATĂ Setările: aceeași regulă,
// pe rândul care se va SALVA (țara din formular), ca selectorul să nu ofere o
// monedă pe care serverul o refuză și previzualizarea să arate ce vede
// oaspetele. Plus ce copiază „Adaugă o locație”: patch-ul regional fără o
// monedă refuzată (`newLocationRegionalPatch`) și recunoașterea refuzului, ca
// fusul și limba să nu cadă odată cu moneda.
import type { PlanSurface } from './planSurface'
import { resolveMenuCurrency, type MenuCurrency } from './currency'
import { regionalPatchFrom, type RegionalPatch, type RegionalSource } from './countries'

/** Hint-ul refuzului de scriere din mig 334 (`trg_restaurants_fiscal_currency_ron`). */
export const FISCAL_CURRENCY_REFUSAL_HINT = 'fiscal_currency_ron_only'

function countryCode(raw: string | null | undefined): string {
  // `restaurants.country` e NOT NULL cu default 'RO' (mig 296): lipsa = RO.
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim().toUpperCase() : 'RO'
}

/**
 * Moneda meniului e blocată pe RON? Oglinda gate-ului de scriere
 * (`restaurant_row_has_feature(owner, NEW.country, 'fiscal_receipt')`):
 *   - `null`  = planul necunoscut (`surface` null) — nu se blochează nimic,
 *               serverul decide (fără text despre bon pe un plan neștiut);
 *   - `false` = țara din FORMULAR nu e România: feature-urile românești nu
 *               există acolo (mig 296), moneda e liberă pe orice plan;
 *   - țara SALVATĂ e România → `surface.fiscal` (nivelul de bani);
 *   - localul revine în România în aceeași salvare → `surface.payments`
 *     (planul owner-ului): nivelul de bani era coborât de țara VECHE, dar
 *     serverul judecă rândul NOU.
 */
export function fiscalCurrencyLocked(
  surface: PlanSurface | null,
  savedCountry: string | null | undefined,
  formCountry: string | null | undefined,
): boolean | null {
  if (!surface) return null
  if (countryCode(formCountry) !== 'RO') return false
  return countryCode(savedCountry) === 'RO' ? surface.fiscal : surface.payments
}

/** Moneda pe care o vede oaspetele (și previzualizarea din Setări). */
export function effectiveMenuCurrency(raw: unknown, locked: boolean | null): MenuCurrency {
  return locked === true ? 'RON' : resolveMenuCurrency(raw)
}

/**
 * Moneda din formular nu e RON pe un local blocat: rândul a rămas salvat cu
 * altă monedă dinaintea urcării pe Planul 3 (planul stă pe cont, nu pe
 * restaurant, deci upgrade-ul nu atinge rândul). Oaspeții văd deja lei, dar
 * plata online la masă citește moneda SALVATĂ și rămâne oprită
 * (`currency_not_supported`, mig 209) până când se salvează RON.
 */
export function fiscalCurrencyDrift(raw: unknown, locked: boolean | null): boolean {
  return locked === true && resolveMenuCurrency(raw) !== 'RON'
}

/**
 * Eroarea întoarsă de o scriere (supabase-js NU aruncă: `{ error }` cu `hint`)
 * e refuzul monedei din mig 334? Contractul e HINT-ul, nu textul.
 */
export function isFiscalCurrencyRefusal(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  return (error as { hint?: unknown }).hint === FISCAL_CURRENCY_REFUSAL_HINT
}

/** Patch-ul regional fără monedă; `null` când nu mai rămâne nimic de trimis. */
export function regionalPatchWithoutCurrency(patch: RegionalPatch): RegionalPatch | null {
  const rest: RegionalPatch = { ...patch }
  delete rest.currency
  return Object.keys(rest).length > 0 ? rest : null
}

/**
 * Ce copiază „Adaugă o locație” (lotul G1) de la locația sursă, FĂRĂ o monedă
 * pe care serverul ar refuza-o. `create_restaurant` face locația nouă în
 * România (RO/RON), iar gate-ul de scriere din 334 judecă rândul NOU (owner +
 * țara din patch): o sursă românească pe Planul 3 cu EUR salvat dinaintea
 * upgrade-ului (drift-ul pe care 334 îl păstrează) ar face UPDATE-ul ÎNTREG să
 * pice (23514) — fusul și limba copiate s-ar fi pierdut odată cu moneda, iar
 * intenția păstrată s-ar fi reîncercat, și refuzat, la fiecare încărcare.
 *   - suprafața e a SURSEI (doar owner-ul adaugă locații: același cont, deci
 *     același plan), judecată cu țara ei salvată, ca `fiscalCurrencyLocked`;
 *   - țara țintă e cea din patch; lipsa ei = România (default-ul locației noi);
 *   - pe un plan NECUNOSCUT moneda rămâne: decide serverul, iar refuzul lui
 *     (`isFiscalCurrencyRefusal`) scoate doar moneda, nu și restul.
 */
export function newLocationRegionalPatch(
  source: RegionalSource | null | undefined,
  surface: PlanSurface | null,
): RegionalPatch | null {
  const patch = regionalPatchFrom(source)
  if (!patch?.currency) return patch
  if (fiscalCurrencyLocked(surface, source?.country, patch.country ?? 'RO') !== true) return patch
  return regionalPatchWithoutCurrency(patch)
}
