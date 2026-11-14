// src/lib/stockMessages.ts — textele calculate ale filei Stocuri, în limba
// personalului (lotul L5b). Pur: traducătorii vin ca parametri (tipurile doar
// prin `import type`), deci modulul nu trage dicționarele în niciun chunk.
//   - erorile fișelor se țin ca DATE (`StockFormError`) și se traduc la RANDARE:
//     o schimbare de limbă cu eroarea pe ecran o retraduce;
//   - refuzurile serverului: în ROMÂNĂ EXACT `toUserMessage(err)` de dinainte
//     (hint-urile NU se aplică în română — `describeStaffError` pune un hint
//     cunoscut ÎNAINTEA mesajului, precedentul DiscountModal L4b / L5a); în
//     altă limbă hint-urile lui `create_purchase_order_atomic` (mig 066) au
//     textul lor, restul cade pe clasa erorii din `common` sau pe rezervă — un
//     mesaj al serverului (românesc sau englezesc intern) nu ajunge pe ecran;
//   - eticheta cotei TVA: `{rate}% ({label})` din `vat_rates` (date), iar
//     rezerva pentru o grupă fără cotă e tradusă (`vat_group`); în română EXACT
//     `getVatLabel` (lib/vat.ts, neatins — oracolul testului).
import { describeStaffError } from '../i18n/staffErrors'
import type { Translator } from '../i18n/core'
import type commonRo from '../i18n/ns/common/ro'
import type stocksRo from '../i18n/ns/stocks/ro'
import type { VatRate } from './vat'

export type StockMessagesTranslator = Pick<Translator<typeof stocksRo>, 't'>
export type StockCommonTranslator = Translator<typeof commonRo>

/** O eroare a unei fișe din fila Stocuri, ținută ca DATE. */
export type StockFormError =
  | { kind: 'nameRequired' }
  | { kind: 'qtyInvalid' }
  | { kind: 'noValidItems' }
  | { kind: 'server'; err: unknown }

export function stockErrorHints(tr: StockMessagesTranslator): Readonly<Record<string, string>> {
  return {
    no_items: tr.t('hint_noItems'),
    invalid_quantity: tr.t('hint_invalidQuantity'),
    invalid_price: tr.t('hint_invalidPrice'),
    invalid_vat: tr.t('hint_invalidVat'),
    ingredient_wrong_restaurant: tr.t('hint_wrongIngredient'),
  }
}

/** Mesajul unui refuz al serverului din fila Stocuri. */
export function describeStockError(
  err: unknown,
  tr: StockMessagesTranslator,
  tc: StockCommonTranslator,
  fallback?: string,
): string {
  return describeStaffError(err, tc, {
    fallback,
    hints: tc.lang === 'ro' ? undefined : stockErrorHints(tr),
  })
}

/** Textul unei erori de fișă, la randare. */
export function stockFormErrorText(
  e: StockFormError,
  tr: StockMessagesTranslator,
  tc: StockCommonTranslator,
): string {
  switch (e.kind) {
    case 'nameRequired':
      return tr.t('err_nameRequired')
    case 'qtyInvalid':
      return tr.t('err_qtyInvalid')
    case 'noValidItems':
      return tr.t('err_noValidItems')
    case 'server':
      return describeStockError(e.err, tr, tc)
  }
}

/** Eticheta cotei unei grupe TVA (cardul ingredientului). */
export function vatGroupLabel(rates: readonly VatRate[], group: number, tr: StockMessagesTranslator): string {
  const r = rates.find((x) => x.vat_group === group)
  return r ? `${r.rate_percent}% (${r.label})` : tr.t('vat_group', { n: group })
}
