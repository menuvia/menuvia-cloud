// src/i18n/useT.ts — hook-ul ecranelor personalului (lotul L0b):
//   const { t, tp, fmt } = useT(commonNs)
//   t('save') · tp('items', 3) · fmt.money(12.5, restaurant.currency)
// Româna e sincronă (dicționarul e importat static de namespace). O altă
// limbă se încarcă la prima cerere: până sosește, hook-ul SUSPENDĂ (aruncă
// promisiunea), iar `<Suspense>`-ul ecranului leneș arată spinner-ul — nu
// apare niciodată un cadru în română pentru un utilizator francez.
// Fără hook-uri după aruncare: traducătorii sunt memoizați pe namespace.
import { makeTranslator, readNamespace, type Dict, type Namespace, type Translator } from './core'
import { makeFormatters, type StaffFormatters } from './format'
import type { StaffLang } from './langs'
import { useUiLang } from './UiLangContext'

export type StaffT<D extends Dict> = Translator<D> & { fmt: StaffFormatters }

const translators = new WeakMap<object, Map<StaffLang, StaffT<Dict>>>()
const formatters = new Map<StaffLang, StaffFormatters>()

function formattersFor(lang: StaffLang): StaffFormatters {
  let f = formatters.get(lang)
  if (!f) {
    f = makeFormatters(lang)
    formatters.set(lang, f)
  }
  return f
}

/**
 * `opts.lang` fixează limba TEXTELOR pe un ecran care nu urmează limba
 * personalului — ecranele fiscale ale Planului 3 rămân în română prin lege
 * (lib/fiscalScreens.ts), chiar dacă își împart textele cu varianta lor
 * nefiscală (BridgeTab: imprimanta de bucătărie pe Planul 2 e tradusă, casa de
 * marcat pe Planul 3 nu). Formatele (`fmt`) urmează în continuare limba
 * utilizatorului. Cache-ul rămâne coerent: cheia e (dicționarul servit, limba
 * utilizatorului), iar limba textelor se deduce din dicționar.
 */
export function useT<D extends Dict>(ns: Namespace<D>, opts?: { lang?: StaffLang }): StaffT<D> {
  const { lang } = useUiLang()
  const r = readNamespace(ns, opts?.lang ?? lang)
  if ('pending' in r) throw r.pending
  // Cheia e dicționarul servit (nu namespace-ul): o încărcare eșuată pune
  // româna în cache, deci traducătorul se reface pe dicționarul real.
  let byLang = translators.get(r.dict)
  if (!byLang) {
    byLang = new Map()
    translators.set(r.dict, byLang)
  }
  let tr = byLang.get(lang) as StaffT<D> | undefined
  if (!tr) {
    // Textele sunt în `r.lang` (poate fi engleza), formatele urmează limba
    // UTILIZATORULUI — un francez fără traducere vede text englezesc, dar
    // data în formatul lui.
    tr = { ...makeTranslator<D>(r.dict, r.lang), fmt: formattersFor(lang) }
    byLang.set(lang, tr as unknown as StaffT<Dict>)
  }
  return tr
}
