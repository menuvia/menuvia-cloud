// Namespace `translations`: doar din ecranul Meniu → Traduceri (TranslationsTab
// + TranslationRow, chunk leneș) și din traducerile fișei produsului
// (ProductTranslations, ExtraTranslations, din chunk-ul leneș al filei
// Produse). en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const translationsNs = defineNamespace('translations', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
