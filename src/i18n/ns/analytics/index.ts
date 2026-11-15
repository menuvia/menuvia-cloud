// Namespace `analytics`: doar din fila Statistici (AnalyticsTab, chunk LENEȘ
// în DashboardPage — trage după el recharts —, sub Suspense-ul panoului).
// AnalyticsTab cere SUS și `common` („Reîncearcă”, clasele de erori), deci o
// singură suspendare la prima randare într-o limbă nouă. en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const analyticsNs = defineNamespace('analytics', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
