// Namespace `payments`: doar din ecranele personalului — PayModal (din
// WaiterOrderCard, montat de pagina de ospătar, lazy) și DiscountModal (lazy
// din pagină); `lib/orders.ts` îl atinge DOAR prin `import type`. en/fr/de vin
// prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const paymentsNs = defineNamespace('payments', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
