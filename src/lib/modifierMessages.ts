// src/lib/modifierMessages.ts — refuzurile serverului din fila Meniu → Opțiuni,
// în limba personalului (lotul L5b). Aceeași regulă ca fila Produse
// (`lib/productMessages.ts`, L5a):
//   - în ROMÂNĂ: EXACT `toUserMessage(err, fallback)` de dinainte — inclusiv
//     mesajul românesc al serverului afișat ca atare. Hint-urile NU se aplică
//     în română (`describeStaffError` aplică un hint cunoscut ÎNAINTEA lui
//     `toUserMessage`, deci ar fi înlocuit textul serverului — precedentul
//     DiscountModal, L4b);
//   - în altă limbă: hint-urile `set_modifier_group_products` (mig 319:
//     `group_not_found`, `product_not_found`, `duplicate_products`) au textul
//     lor, restul cade pe clasa erorii din `common` sau pe rezerva contextului;
//     un mesaj românesc al serverului — sau rezerva românească aruncată de
//     `lib/modifierLinks.ts` — NU ajunge pe ecran.
// Traducătorii se primesc ca parametri (tipurile vin doar prin `import type`).
import { describeStaffError } from '../i18n/staffErrors'
import type { Translator } from '../i18n/core'
import type commonRo from '../i18n/ns/common/ro'
import type modifiersRo from '../i18n/ns/modifiers/ro'

export type ModifiersTranslator = Pick<Translator<typeof modifiersRo>, 't' | 'lang'>
type CommonTranslator = Translator<typeof commonRo>

export function modifierErrorHints(tr: Pick<ModifiersTranslator, 't'>): Readonly<Record<string, string>> {
  return {
    group_not_found: tr.t('hint_groupNotFound'),
    product_not_found: tr.t('hint_productNotFound'),
    duplicate_products: tr.t('hint_duplicateProducts'),
  }
}

/** Mesajul unui refuz din fila Opțiuni. `fallback` e deja tradus; fără el, în
 *  română `MSG_GENERIC` (ca `toUserMessage(err)`), altfel `err_generic`. */
export function describeModifierError(
  err: unknown,
  tr: Pick<ModifiersTranslator, 't'>,
  tc: CommonTranslator,
  fallback?: string,
): string {
  return describeStaffError(err, tc, {
    fallback,
    hints: tc.lang === 'ro' ? undefined : modifierErrorHints(tr),
  })
}
