// Namespace `imports`: doar din importurile meniului — AiMenuImport (din fila
// Produse și din onboarding), AiBulkGenerate (din Produse și din Traduceri) și
// ProductsCsvImport (din Produse), toate trei chunk-uri LENEȘE, montate fiecare
// sub propriul `<Suspense fallback={null}>`: într-o limbă ne-română modalul
// apare abia cu dicționarul încărcat, fără să suspende ecranul de dedesubt.
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const importsNs = defineNamespace('imports', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
