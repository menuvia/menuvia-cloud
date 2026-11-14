// Namespace `kitchen`: doar din ecranul Bucătăriei (KitchenPage, chunk leneș).
// en/fr/de vin prin `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const kitchenNs = defineNamespace('kitchen', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
