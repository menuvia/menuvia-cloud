// Namespace `locations`: doar din fila „Toate locațiile” (LocationsTab, chunk
// LENEȘ în DashboardPage, sub Suspense-ul panoului) și din helperul ei pur
// `formatLastOrderT` (lib/locations.ts — primește traducătorul ca parametru
// și importă doar TIPUL namespace-ului, fiindcă lib/locations e în graful
// static al DashboardPage). en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const locationsNs = defineNamespace('locations', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
