// Namespace `team`: doar din fila Echipă (TeamManager, chunk LENEȘ în
// DashboardPage, sub Suspense-ul panoului). en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const teamNs = defineNamespace('team', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
