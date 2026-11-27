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
// oaspetele.
import type { PlanSurface } from './planSurface'
import { resolveMenuCurrency, type MenuCurrency } from './currency'

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
