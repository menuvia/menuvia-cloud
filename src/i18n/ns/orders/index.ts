// Namespace `orders`: doar din ecranele personalului — dialogurile de comandă
// (anulare, editare, opțiuni, istoric), cardurile ospătarului și comanda
// manuală, toate în chunk-urile leneșe ale ecranului de ospătar / bucătărie;
// `lib/orders.ts` și `lib/waiterSteps.ts` îl ating DOAR prin `import type`.
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const ordersNs = defineNamespace('orders', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
