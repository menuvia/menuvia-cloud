// Namespace `floorplan`: doar din editorul hărții sălii (FloorPlanEditor,
// chunk LENEȘ în DashboardPage, sub Suspense-ul panoului). en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const floorplanNs = defineNamespace('floorplan', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
