// Namespace `dashboard`: doar din cadrul panoului (DashboardPage, leneș în
// App.tsx), din `navLabels` (tipuri) și din UiLanguageCard (Setări, leneș);
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const dashboardNs = defineNamespace('dashboard', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
