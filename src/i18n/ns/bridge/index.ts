// Namespace `bridge`: doar din BridgeTab (chunk leneș al filei „Imprimantă
// bucătărie” / „Casă & tichete”). Pe Planul 3 se cere cu `lang: 'ro'`
// (ecran fiscal, lib/fiscalScreens.ts). en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const bridgeNs = defineNamespace('bridge', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
