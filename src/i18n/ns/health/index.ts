// Namespace `health`: din Scorul de sănătate (HealthScoreTab, montat LENEȘ din
// cardul „Scor meniu” al filei Acasă, sub un `<Suspense>` PROPRIU — într-o
// limbă nouă se suspendă doar conținutul desfășurat al cardului), din
// helperii lui puri (lib/healthLang.ts — primește traducătorul ca parametru și
// importă doar TIPUL namespace-ului) și din HomeTab ÎNSUȘI: antetul cardului
// (eticheta scorului + primele două sugestii) e în afara acelui boundary, deci
// HomeTab cere `health` SUS, lângă `home`. HealthScoreTab cere SUS și
// `common`. en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const healthNs = defineNamespace('health', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
