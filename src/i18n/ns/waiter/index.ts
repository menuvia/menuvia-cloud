// Namespace `waiter`: doar din ecranele personalului — pagina de ospătar
// (lazy), panoul „Stadiu mese” (lazy din pagină) și alocarea meselor (lazy din
// panou); `lib/orders.ts` îl atinge DOAR prin `import type`. en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const waiterNs = defineNamespace('waiter', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
