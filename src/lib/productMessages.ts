// src/lib/productMessages.ts — refuzurile serverului din fila Produse, în
// limba personalului (lotul L5a). O singură regulă pentru toată fila
// (lista, fișa produsului, opțiunile, extra-urile, perechile, rețeta,
// ordinea):
//   - în ROMÂNĂ: EXACT `toUserMessage(err, fallback)` de dinainte — inclusiv
//     mesajul românesc al serverului afișat ca atare (ex. „Limită produse
//     atinsă: maxim 15 …”). Hint-urile NU se aplică în română:
//     `describeStaffError` aplică un hint cunoscut ÎNAINTEA lui
//     `toUserMessage`, deci ar fi înlocuit textul serverului (precedentul
//     DiscountModal, lotul L4b);
//   - în altă limbă: hint-urile de business ale filei au textul lor
//     (`product_limit`/`upgrade_plan` — enforce_product_limit, mig 290;
//     `group_not_found`/`product_not_found`/`duplicate_groups` — mig 319),
//     restul cade pe clasa erorii din `common` sau pe textul de rezervă al
//     contextului; un mesaj românesc al serverului NU ajunge pe ecran.
// Traducătorii se primesc ca parametri (tipurile vin doar prin `import type`).
import { describeStaffError } from '../i18n/staffErrors'
import type { StringKey, Translator } from '../i18n/core'
import type commonRo from '../i18n/ns/common/ro'
import type productsRo from '../i18n/ns/products/ro'
import type { IngredientUnit } from './stocks'

export type ProductsTranslator = Pick<Translator<typeof productsRo>, 't' | 'tp' | 'lang'>
export type CommonTranslator = Translator<typeof commonRo>

export function productErrorHints(tr: Pick<ProductsTranslator, 't'>): Readonly<Record<string, string>> {
  const limit = tr.t('hint_productLimit')
  return {
    product_limit: limit,
    upgrade_plan: limit,
    group_not_found: tr.t('hint_groupNotFound'),
    product_not_found: tr.t('hint_productNotFound'),
    duplicate_groups: tr.t('hint_duplicateGroups'),
  }
}

/** Mesajul unui refuz din fila Produse. `fallback` e deja tradus; fără el,
 *  în română `MSG_GENERIC` (ca `toUserMessage(err)`), altfel `err_generic`. */
export function describeProductError(
  err: unknown,
  tr: Pick<ProductsTranslator, 't'>,
  tc: CommonTranslator,
  fallback?: string,
): string {
  return describeStaffError(err, tc, {
    fallback,
    hints: tc.lang === 'ro' ? undefined : productErrorHints(tr),
  })
}

/** Cheile unităților de ingredient (enum `IngredientUnit`, mig 026). */
export const INGREDIENT_UNIT_KEYS = {
  g: 'unit_g',
  kg: 'unit_kg',
  ml: 'unit_ml',
  l: 'unit_l',
  buc: 'unit_buc',
  pachet: 'unit_pachet',
} as const satisfies Record<IngredientUnit, StringKey<typeof productsRo>>

/** Unitatea unui ingredient în limba personalului (rețeta din fișa
 *  produsului). În română e EXACT codul de dinainte; un cod din afara enum-ului
 *  se afișează ca atare, ca înainte. */
export function ingredientUnitLabel(unit: string, tr: Pick<ProductsTranslator, 't'>): string {
  return Object.prototype.hasOwnProperty.call(INGREDIENT_UNIT_KEYS, unit)
    ? tr.t(INGREDIENT_UNIT_KEYS[unit as IngredientUnit])
    : unit
}
