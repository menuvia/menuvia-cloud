// Namespace `home`: doar din ecranele panoului (HomeTab și cardurile lui,
// SubscriptionCard din Setări, banda de plan din DashboardPage) — toate în
// chunk-uri leneșe ale panoului; en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const homeNs = defineNamespace('home', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
