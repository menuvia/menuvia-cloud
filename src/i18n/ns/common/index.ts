// Namespace `common`: importă-l DOAR din ecranele personalului (lazy) —
// importul static aduce `ro.ts` în chunk-ul ecranului; en/fr/de vin prin
// `import()` doar când sunt cerute (SK4 în `staffI18n.test.ts`).
import { defineNamespace } from '../../core'
import ro from './ro'

export const commonNs = defineNamespace('common', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
