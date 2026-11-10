// Namespace `products`: doar din fila Produse a panoului (ProductsTab,
// ProductsToolbar, ProductOrderModal — chunk leneș). en/fr/de vin prin
// `import()` (SK4).
import { defineNamespace } from '../../core'
import ro from './ro'

export const productsNs = defineNamespace('products', ro, {
  en: () => import('./en'),
  fr: () => import('./fr'),
  de: () => import('./de'),
})
